// Opt-in, real PostgreSQL + authenticated HTTP regression. No .env or live app.
// Run: SCMU_BONRATE_INTEGRATION=1 node scripts/test-bonrate-post-delivery.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.env.SCMU_BONRATE_INTEGRATION !== '1') {
  console.error('REFUSED: set SCMU_BONRATE_INTEGRATION=1 to create a disposable local test schema.');
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const require = createRequire(path.join(backend, 'package.json'));
const schema = 'bonrate_test_' + randomBytes(12).toString('hex');
assert.match(schema, /^bonrate_test_[a-f0-9]{24}$/);
const database = new URL('postgresql://scmu_demo@127.0.0.1:55432/scmu_demo');
database.searchParams.set('schema', schema);
database.searchParams.set('connection_limit', '4');
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, '55432');
assert.equal(database.pathname, '/scmu_demo');
assert.equal(database.username, 'scmu_demo');
assert.equal(database.password, '');
// Set isolation before loading any backend module or Prisma client.
process.env.DATABASE_URL = database.href;
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.NODE_ENV = 'test';
const originalCwd = process.cwd();
const scratchBase = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE, 'AppData/Local'), 'hermes/cache/scratch');
assert(path.isAbsolute(scratchBase), 'Hermes scratch must be an absolute directory');
const uploads = new Set();
const checks = [];
let scratch, prisma, server, schemaCreated = false, cleanupVerified = false, failure;
let token, base, journeyId, billIds = [], workId;
const psql = 'C:/Program Files/PostgreSQL/14/bin/psql.exe';
const cleanEnv = () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^PG|^(DIRECT_URL|SHADOW_DATABASE_URL)$/.test(key)) delete env[key];
  return { ...env, PGPASSWORD: '', PGPASSFILE: path.join(scratch, 'no-pgpass'), PGSERVICEFILE: path.join(scratch, 'no-pgservice'), PGCONNECT_TIMEOUT: '8' };
};
function sql(statement) {
  // Only schema management/catalog assertions use this connection, never app tables.
  const result = spawnSync(psql, ['-X', '-w', '-h', '127.0.0.1', '-p', '55432', '-U', 'scmu_demo', '-d', 'scmu_demo', '-v', 'ON_ERROR_STOP=1', '-At', '-c', statement], { cwd: scratch, env: cleanEnv(), encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (result.error || result.status !== 0) {
    const message = String(result.stderr || result.error?.message || 'unknown error').replace(/postgresql:\/\/\S+/g, '[redacted database URL]').slice(0, 700);
    throw new Error(`Local PostgreSQL schema administration blocked (exit ${result.status}): ${message}`);
  }
  return result.stdout.trim();
}
async function request(url, { method = 'GET', body, auth = true, status = 200, binary = false } = {}) {
  const response = await fetch(base + url, {
    method,
    headers: { ...(auth ? { Authorization: 'Bearer ' + token } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); } catch { data = bytes.toString('utf8').slice(0, 500); }
  const allowed = Array.isArray(status) ? status : [status];
  assert(allowed.includes(response.status), `${method} ${url}: expected ${allowed.join('/')}, got ${response.status}: ${JSON.stringify(data).slice(0, 850)}`);
  if (binary) { assert.match(response.headers.get('content-type') || '', /application\/pdf/); return bytes; }
  return data;
}
const endpoint = suffix => `/journeys/${journeyId}/driver-operations${suffix}`;
const parent = () => prisma.shippingJourney.findUniqueOrThrow({ where: { id: journeyId } });
const version = async () => (await parent()).version;
async function durableState() {
  const row = await parent();
  return { row, audit: await prisma.activityLog.count(), bills: await prisma.seaBill.findMany({ where: { id: { in: billIds } }, orderBy: { id: 'asc' } }), charges: await prisma.jobCharge.count(), payments: await prisma.jobPayment.count(), files: await prisma.journeyFile.count() };
}
async function rejectedWithoutWrites(label, suffix, body, statuses = [409, 422], method = 'POST') {
  const before = await durableState();
  await request(endpoint(suffix), { method, body: { version: before.row.version, ...body }, status: statuses });
  assert.deepEqual(await durableState(), before, label + ': rejected request must not change persisted version, JSON, bills, audit, files, costs or payments');
  checks.push(label);
}
async function receiptPdf(label) {
  const PDFDocument = require('pdfkit');
  const pdf = new PDFDocument({ size: 'A4' });
  const chunks = [];
  pdf.on('data', chunk => chunks.push(chunk));
  const done = once(pdf, 'end');
  pdf.text('TEST ONLY - ' + label).text('Actual delivery evidence, isolated integration fixture.');
  pdf.end();
  await done;
  return Buffer.concat(chunks);
}
async function uploadReceipt(index) {
  const name = `test-only-receipt-${index}.pdf`;
  const form = new FormData();
  form.set('version', String(await version()));
  form.set('category', 'DELIVERY_RECEIPT');
  form.set('note', 'Disposable integration evidence ' + index);
  const bytes = await receiptPdf(name);
  form.set('file', new Blob([bytes], { type: 'application/pdf' }), name);
  const result = await request(endpoint('/evidence'), { method: 'POST', body: form, status: 201 });
  const saved = await prisma.journeyFile.findUniqueOrThrow({ where: { id: result.id } });
  assert.equal(saved.journeyId, journeyId);
  assert.equal(saved.category, 'DELIVERY_RECEIPT');
  assert.equal(saved.originalName, name);
  const filename = path.join(backend, 'uploads/job-documents', saved.filename);
  uploads.add(filename);
  assert.deepEqual(await readFile(filename), bytes);
  return saved.id;
}
async function parsePdf(bytes) {
  // pdfjs 6 requires the real canvas DOM primitives on Node 22.
  const canvas = require('@napi-rs/canvas');
  for (const key of ['DOMMatrix', 'ImageData', 'Path2D']) if (!globalThis[key] && canvas[key]) globalThis[key] = canvas[key];
  const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true, isEvalSupported: false });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map(item => item.str || '').join(' '));
    return pages.join(' ').replace(/\s+/g, ' ');
  } finally { await task.destroy(); }
}
try {
  await mkdir(scratchBase, { recursive: true });
  scratch = await mkdtemp(path.join(scratchBase, 'bonrate-integration-'));
  process.chdir(scratch); // CLI dotenv discovery never sees repository .env files.
  process.env.DOTENV_CONFIG_PATH = path.join(scratch, 'no-dotenv');
  const sourcePrisma = path.join(backend, 'prisma');
  const isolatedPrisma = path.join(scratch, 'prisma');
  await mkdir(isolatedPrisma);
  await cp(path.join(sourcePrisma, 'schema.prisma'), path.join(isolatedPrisma, 'schema.prisma'));
  await cp(path.join(sourcePrisma, 'migrations'), path.join(isolatedPrisma, 'migrations'), { recursive: true });
  // Fail closed if a migration could escape the isolated URL's search_path.
  for (const entry of await readdir(path.join(isolatedPrisma, 'migrations'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const migration = await readFile(path.join(isolatedPrisma, 'migrations', entry.name, 'migration.sql'), 'utf8');
    assert(!/(?:\bpublic\s*\.|"public"\s*\.|\b(?:CREATE|ALTER|DROP)\s+(?:SCHEMA|DATABASE|EXTENSION)|\bsearch_path\b|\bSET\s+ROLE\b|\bdblink\b)/i.test(migration), 'Unsafe cross-schema migration: ' + entry.name);
  }
  assert.equal(sql(`SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspname = '${schema}'`), '0');
  sql(`CREATE SCHEMA "${schema}" AUTHORIZATION scmu_demo`);
  schemaCreated = true;
  const migrate = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(isolatedPrisma, 'schema.prisma')], { cwd: scratch, env: cleanEnv(), encoding: 'utf8', timeout: 180000, windowsHide: true });
  assert(!migrate.error && migrate.status === 0, `Isolated migrate deploy failed (exit ${migrate.status}); CLI output suppressed to avoid connection disclosure`);
  checks.push('unique isolated schema migrated without dotenv');
  prisma = require('../backend/src/prisma');
  assert.equal((await prisma.$queryRawUnsafe('SELECT current_schema() AS schema'))[0].schema, schema);
  const companyId = 'dd597ed2-fad1-5482-ab82-8f2bb84d8852';
  // Migrations seed the fixed internal company inside this fresh isolated schema.
  await prisma.company.upsert({ where: { id: companyId }, create: { id: companyId, name: 'SCMU Integration TEST ONLY', type: 'SHIPPER', isInternal: true, isActive: true }, update: { name: 'SCMU Integration TEST ONLY', type: 'SHIPPER', isInternal: true, isActive: true } });
  const user = await prisma.user.create({ data: { name: 'Isolated Test Staff', email: `bonrate-${schema}@example.invalid`, password: await require('bcryptjs').hash(randomBytes(32).toString('hex'), 4), role: 'ADMIN', isActive: true, companyId } });
  token = require('jsonwebtoken').sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const driver = await prisma.driver.create({ data: { name: 'Isolated Driver', phone: 'TEST-' + randomUUID(), licenseNo: 'TEST-' + randomUUID(), employmentType: 'INTERNAL', companyId, isActive: true } });
  const vehicle = await prisma.vehicle.create({ data: { registrationNo: 'TEST-BONRATE', type: 'TRUCK', capacity: 10, ownershipType: 'OWN', companyId, isActive: true } });
  const journey = await prisma.shippingJourney.create({ data: { number: 'TEST-JOURNEY', vesselName: 'TEST VESSEL', voyageNumber: 'TEST-01', period: '2026-01', destination: 'TEST DESTINATION', createdById: user.id, data: {} } });
  journeyId = journey.id;
  const containers = [{ number: 'TESTCONT001', size: '20', seal: 'TESTSEAL001' }, { number: 'TESTCONT002', size: '20', seal: 'TESTSEAL002' }];
  for (let i = 0; i < 2; i++) {
    const job = await prisma.jobOrder.create({ data: { jobNumber: 'TEST-JOB-' + i, title: 'Test-only delivery job', customerId: companyId, createdById: user.id, originCity: 'Test Port', destCity: 'Test Warehouse', cargoDescription: 'Test cargo' } });
    const shipment = await prisma.shipment.create({ data: { shipmentNumber: 'TEST-SHIPMENT-' + i, jobId: job.id, mode: 'SEA', shipperCompanyId: companyId, originCity: 'Test Port', originState: 'Test State', destCity: 'Test Warehouse', destState: 'Test State', loadingDate: new Date('2026-01-01T00:00:00Z'), createdById: user.id } });
    const document = await prisma.jobDocument.create({ data: { jobId: job.id, shipmentId: shipment.id, type: 'BILL_OF_LADING', title: 'Test B/L', required: true } });
    const bill = await prisma.seaBill.create({ data: { jobId: job.id, shipmentId: shipment.id, documentId: document.id, journeyId, billNumber: 'TEST-BL-' + i, containers, registerData: {} } });
    billIds.push(bill.id);
  }
  const scheme = await prisma.driverRateScheme.create({ data: { code: 'TEST-ONE-RB', name: 'Test one trip', size: '20', rb: 1, rk: 0, enabled: true } });
  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  // Observe only files generated by our own HTTP requests, including error paths.
  app.use((req, res, next) => { res.on('finish', () => { if (req.file?.path) uploads.add(path.resolve(req.file.path)); }); next(); });
  app.use('/journeys', require('../backend/src/routes/journeys'));
  app.use('/bl-register', require('../backend/src/routes/blRegister'));
  app.use((req, res) => res.status(404).json({ message: 'Route not implemented' }));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  await request(endpoint(''), { auth: false, status: 401 });
  await request(endpoint(''));
  checks.push('real JWT authentication rejects anonymous requests and accepts isolated user');
  const evidenceIds = [];
  for (let i = 0; i < 10; i++) evidenceIds.push(await uploadReceipt(i));
  checks.push('10 distinct real multipart PDF receipts saved and read back byte-for-byte');
  // Direct bonrate recording/printing needs no container quota scheme.
  const deliveries = evidenceIds.map((id, i) => ({ id: randomUUID(), billId: billIds[i % 2], containerNumber: containers[0].number, recipient: `Recipient-${String(i + 1).padStart(2, '0')}`, destination: `Warehouse-${i + 1}`, receivedDate: `2026-01-${String(i + 2).padStart(2, '0')}`, receiptReference: `RECEIPT-${String(i + 1).padStart(2, '0')}`, evidenceFileIds: [id], items: [{ owner: `Owner-${String(i + 1).padStart(2, '0')}`, collyCount: i + 1, collyType: 'BOX', goodsType: 'Test Goods', packageWeightKg: 25 }] }));
  const work = { billId: billIds[0], containerNumber: containers[0].number, driverId: driver.id, vehicleId: vehicle.id, origin: 'Test Port', destination: 'Ten completed deliveries', rateType: 'RB', items: [], deliveries, recordingPolicy: 'LEGACY' };
  for (const [label, change] of [
    ['partial delivery rejected', w => { w.deliveries[0].recipient = ''; }],
    ['future receipt date rejected', w => { w.deliveries[0].receivedDate = '2999-01-01'; }],
    ['invalid calendar date rejected', w => { w.deliveries[0].receivedDate = '2026-02-30'; }],
    ['invalid optional evidence rejected', w => { w.deliveries[0].evidenceFileIds = ['missing-proof']; }],
    ['cross-container child rejected', w => { w.deliveries[0].containerNumber = containers[1].number; }],
    ['new parent-only work rejected', w => { delete w.deliveries; w.items = deliveries[0].items; w.receivedDate = '2026-01-11'; w.evidenceFileIds = [evidenceIds[0]]; }],
    ['new work requires driver name when entered manually', w => { w.driverId = null; w.driverName = ''; }],
    ['new work requires vehicle number when entered manually', w => { w.vehicleId = null; w.vehicleNumber = ''; }],
  ]) {
    const invalid = structuredClone(work); change(invalid);
    await rejectedWithoutWrites(label, '/works', { work: invalid });
  }
  const saved = await request(endpoint('/works'), { method: 'POST', body: { version: await version(), work }, status: 201 });
  workId = saved.id;
  assert.equal(saved.recordingPolicy, 'POST_DELIVERY');
  assert.equal(saved.receivedDate, '2026-01-11');
  assert.equal(saved.driverId, driver.id);
  assert.equal(saved.vehicleId, vehicle.id);
  assert.equal(saved.deliveries.length, 10);
  assert.deepEqual(saved.deliveries.map(d => d.receiptReference), deliveries.map(d => d.receiptReference));
  const loaded = (await request(endpoint(''))).works.find(w => w.id === workId);
  assert.equal(loaded.recordingPolicy, 'POST_DELIVERY');
  assert.deepEqual(loaded.deliveries, saved.deliveries);
  assert.deepEqual((await parent()).data.driverOperations.works.find(w => w.id === workId), saved);
  checks.push('save and reload persist server POST_DELIVERY, 10 deliveries, references and latest completion date');
  const dispatchBody = { documentType: 'BONRATE' };
  const approvalsBefore = await prisma.directorApproval.count();
  let ops = await request(endpoint(''));
  assert.equal(ops.works.find(w => w.id === workId).status, 'DRAFT');
  assert.deepEqual(ops.budgets, []);
  const issueVersion = await version();
  const snapshot = await request(endpoint(`/works/${workId}/dispatch`), { method: 'POST', body: { version: issueVersion, ...dispatchBody }, status: 201 });
  assert.equal(snapshot.documentType, 'BONRATE');
  assert.equal(snapshot.receivedDate, '2026-01-11');
  assert.equal(snapshot.taskDate, '2026-01-11', 'publication date follows latest actual receipt');
  assert.equal(snapshot.deliveries.length, 10);
  const persisted = (await parent()).data.driverOperations.works.find(w => w.id === workId);
  assert.equal(persisted.bonrateIssued, true);
  assert.equal(persisted.dispatches.length, 1);
  assert.deepEqual(persisted.dispatches[0], snapshot);
  const history = await request(endpoint(`/works/${workId}/dispatches`));
  assert.equal(history.data.length, 1);
  assert.deepEqual(history.data[0], snapshot);
  const pdfPath = endpoint(`/works/${workId}/dispatches/${snapshot.id}/pdf`);
  const bytes = await request(pdfPath, { binary: true });
  assert.deepEqual(bytes, Buffer.from(snapshot.pdfBase64, 'base64'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), snapshot.pdfSha256);
  const pdfText = await parsePdf(bytes);
  for (const child of deliveries) for (const value of [child.recipient, child.receiptReference, child.items[0].owner]) assert(pdfText.includes(value), 'Saved PDF missing ' + value);
  assert(pdfText.includes('2026-01-11'), 'PDF must contain latest completion date');
  assert.equal(persisted.status, 'DRAFT', 'direct printing must not silently verify for payroll');
  assert.equal(await prisma.directorApproval.count(), approvalsBefore);
  checks.push('DRAFT directly prints without confirmation, submission, verification, quota scheme or director approval; saved nota independently parsed');
  for (const retryVersion of [issueVersion, await version()]) {
    const before = await durableState();
    const retry = await request(endpoint(`/works/${workId}/dispatch`), { method: 'POST', body: { version: retryVersion, ...dispatchBody }, status: [200, 201] });
    assert.deepEqual(retry, snapshot);
    assert.deepEqual(await durableState(), before, 'idempotent publication cannot write');
    assert.deepEqual(await request(pdfPath, { binary: true }), bytes);
  }
  for (const documentType of ['TRANSPORT_ORDER', 'DELIVERY_NOTE']) await rejectedWithoutWrites(documentType + ' blocked', `/works/${workId}/dispatch`, { documentType, confirmed: true });
  await rejectedWithoutWrites('post-issue cancellation blocked', `/works/${workId}/status`, { status: 'CANCELLED', reason: 'Test lock enforcement' }, 409);
  await rejectedWithoutWrites('post-issue edit blocked', `/works/${workId}`, { work }, 409, 'PUT');
  const beforeLegacy = await durableState();
  await request(`/journeys/${journeyId}/driver-bons`, { method: 'POST', body: { version: beforeLegacy.row.version, bon: { rateType: 'RB' } }, status: 409 });
  assert.deepEqual(await durableState(), beforeLegacy);
  // Change only unrelated test-only master metadata, never locked work/container data.
  await prisma.company.update({ where: { id: companyId }, data: { name: 'TEST metadata changed after snapshot' } });
  await prisma.driver.update({ where: { id: driver.id }, data: { name: 'TEST master renamed after snapshot' } });
  await prisma.vehicle.update({ where: { id: vehicle.id }, data: { registrationNo: 'TEST-RENAMED' } });
  assert.deepEqual(await request(pdfPath, { binary: true }), bytes, 'Stored PDF must not rerender against changed master metadata');
  assert.deepEqual((await request(endpoint(`/works/${workId}/dispatches`))).data, [snapshot]);
  ops = await request(endpoint(''));
  assert.deepEqual(ops.budgets, []);
  assert.equal((await parent()).data.driverOperations.works.find(w => w.id === workId).dispatches.length, 1);
  for (const billId of billIds) {
    const projection = await request(`/bl-register/${billId}/driver-operations`);
    const projected = projection.works.find(w => w.id === workId);
    assert.equal(projected.recordingPolicy, 'POST_DELIVERY');
    assert.equal(projected.bonrateIssued, true);
    assert.equal(projected.readOnly, true);
    assert(projected.deliveries.every(d => d.billId === billId));
    assert.equal(projected.deliveries.length, 5);
    const foreign = deliveries.filter(d => d.billId !== billId);
    for (const child of foreign) assert(!JSON.stringify(projection).includes(child.recipient), 'bill projection leaks sibling recipient');
    assert(!JSON.stringify(projection).includes(snapshot.pdfBase64), 'bill projection must not embed aggregate PDF bytes');
  }
  const destinationMaster = await prisma.route.create({ data: { name: 'Test delivery destination', originCity: '', originState: '', destCity: 'Test Master Depot', destState: '', isActive: true } });
  for (const rateType of ['RB', 'RK', 'TONASE', 'RBS']) for (const scope of ['journey', 'bill']) {
    const extraEndpoint = suffix => scope === 'bill' ? `/bl-register/${billIds[0]}/driver-operations${suffix}` : endpoint(suffix);
    const manual = { ...structuredClone(work), rateType, driverId: null, vehicleId: null, driverName: 'Manual Test Driver', vehicleNumber: 'TEST MANUAL', receiptReference: null };
    if (scope === 'bill') manual.deliveries = manual.deliveries.filter(d => d.billId === billIds[0]);
    manual.deliveries.forEach(d => { d.evidenceFileIds = []; });
    manual.deliveries[0].routeId = destinationMaster.id;
    manual.deliveries[0].destination = 'Client forged destination';
    const extra = await request(extraEndpoint('/works'), { method: 'POST', body: { version: await version(), work: manual }, status: 201 });
    assert.equal(extra.driverId, null); assert.equal(extra.vehicleId, null);
    assert.equal(extra.driverName, manual.driverName); assert.equal(extra.vehicleNumber, manual.vehicleNumber);
    assert.equal(extra.deliveries[0].destination, 'Test Master Depot');
    const reloaded = (await request(endpoint(''))).works.find(w => w.id === extra.id);
    assert(reloaded.deliveries.every(d => d.evidenceFileIds.length === 0), 'optional attachments remain empty after reload');
    assert.equal(reloaded.rateType, rateType); assert.equal(reloaded.deliveries[0].routeId, destinationMaster.id);
    assert.deepEqual((await request(endpoint(''))).budgets, []);
    const printed = await request(extraEndpoint(`/works/${extra.id}/dispatch`), { method: 'POST', body: { version: await version(), ...dispatchBody }, status: 201 });
    const manualPdf = await request(extraEndpoint(`/works/${extra.id}/dispatches/${printed.id}/pdf`), { binary: true });
    assert((await parsePdf(manualPdf)).includes('Manual Test Driver'));
    assert.equal((await parent()).data.driverOperations.works.find(w => w.id === extra.id).status, 'DRAFT');
    assert.equal(await prisma.directorApproval.count(), approvalsBefore);
  }
  checks.push('all four types directly print in bill/journey scopes without attachments, approval or budget; identities and master destination retained');
  assert.equal(await prisma.jobCharge.count(), 0);
  assert.equal(await prisma.jobPayment.count(), 0);
  checks.push('one immutable snapshot; retries identical; cancellation/edit/pre-delivery documents blocked; no quotas or financial side effects; bill projection safe');
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors = [];
  if (server) {
    try { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } catch (error) { cleanupErrors.push(error.message); }
  }
  if (prisma) {
    try {
      // Schema-isolated readback of exact owned upload rows also covers response errors.
      if (journeyId) for (const file of await prisma.journeyFile.findMany({ where: { journeyId }, select: { filename: true } })) uploads.add(path.join(backend, 'uploads/job-documents', file.filename));
    } catch (error) { cleanupErrors.push('Could not enumerate owned upload rows: ' + error.message); }
    try { await prisma.$disconnect(); } catch (error) { cleanupErrors.push(error.message); }
  }
  for (const filename of uploads) {
    try {
      assert.equal(path.dirname(filename), path.join(backend, 'uploads/job-documents'));
      assert.match(path.basename(filename), /^[a-f0-9-]{36}\.pdf$/i);
      await unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await assert.rejects(stat(filename), { code: 'ENOENT' });
    } catch (error) { cleanupErrors.push('Owned upload cleanup failed: ' + error.message); }
  }
  if (schemaCreated) {
    try {
      sql(`DROP SCHEMA "${schema}" CASCADE`);
      assert.equal(sql(`SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspname = '${schema}'`), '0');
      cleanupVerified = true;
    } catch (error) { cleanupErrors.push(error.message); }
  }
  token = undefined;
  delete process.env.JWT_SECRET;
  delete process.env.DATABASE_URL;
  process.chdir(originalCwd);
  if (scratch) {
    try { await rm(scratch, { recursive: true, force: true, maxRetries: 12, retryDelay: 200 }); await assert.rejects(stat(scratch), { code: 'ENOENT' }); } catch (error) { cleanupErrors.push('Scratch cleanup failed: ' + error.message); }
  }
  if (cleanupErrors.length) failure = new AggregateError([...(failure ? [failure] : []), ...cleanupErrors.map(message => new Error(message))], 'Integration failed and/or cleanup incomplete');
  const errors = failure instanceof AggregateError ? failure.errors.map(error => error.message) : failure ? [failure.message] : [];
  console.log(JSON.stringify({ result: failure ? 'RED' : 'GREEN', artifact: 'scripts/test-bonrate-post-delivery.mjs', checks, schema, schemaCreated, cleanupVerified, ownedUploadsRemoved: uploads.size, scratchRemoved: Boolean(scratch) && !cleanupErrors.some(message => message.includes('Scratch')), errors }, null, 2));
  if (failure) process.exitCode = 1;
}

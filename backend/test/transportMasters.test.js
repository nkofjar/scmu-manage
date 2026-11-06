const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { randomUUID } = require('node:crypto');
const prisma = require('../src/prisma');
const internalId = 'dd597ed2-fad1-5482-ab82-8f2bb84d8852';
const vendorId = '6cda1e17-d46e-4105-a410-aac9c0290a17';
function fixture() {
  const rows = { vehicle: [], driver: [], masterDocument: [] }, originals = [];
  const companies = [{ id: internalId, name: 'SCMU', isInternal: true, isActive: true }, { id: vendorId, name: 'Vendor', isInternal: false, isActive: true }];
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => key === 'OR' ? value.some(w => matches(row, w)) : value && typeof value === 'object' ? String(row[key] || '').toLowerCase().includes(String(value.contains).toLowerCase()) : row[key] === value);
  function replace(obj, key, value) { originals.push(() => { obj[key] = value; }); obj[key] = value; }
  for (const kind of Object.keys(rows)) {
    if (!prisma[kind]) { replace(prisma, kind, {}); }
    const model = prisma[kind];
    const present = row => row && ({ ...row, company: companies.find(c => c.id === row.companyId) || null, _count: { trips: 0 } });
    replace(model, 'findUnique', async ({ where, include }) => { const result = present(rows[kind].find(r => matches(r, where))); if (result && !include?.trips) delete result.trips; return result; });
    replace(model, 'findFirst', async ({ where }) => present(rows[kind].find(r => matches(r, where))));
    replace(model, 'findMany', async ({ where, skip = 0, take }) => rows[kind].filter(r => matches(r, where)).slice(skip, take ? skip + take : undefined).map(present));
    replace(model, 'count', async ({ where }) => rows[kind].filter(r => matches(r, where)).length);
    replace(model, 'create', async ({ data }) => { const row = { id: randomUUID(), isActive: true, version: 1, createdAt: new Date(), updatedAt: new Date(), ...data }; rows[kind].push(row); return present(row); });
    replace(model, 'update', async ({ where, data }) => { const row = rows[kind].find(r => matches(r, where)); if (!row) throw Object.assign(new Error('Missing'), { code: 'P2025' }); for (const [k,v] of Object.entries(data)) row[k] = v?.increment ? row[k] + v.increment : v; return present(row); });
    replace(model, 'updateMany', async ({ where, data }) => { const selected = rows[kind].filter(r => matches(r, where)); for (const row of selected) for (const [k,v] of Object.entries(data)) row[k] = v?.increment ? row[k] + v.increment : v; return { count: selected.length }; });
  }
  replace(prisma.company, 'findUnique', async ({ where }) => companies.find(c => c.id === where.id));
  replace(prisma, '$transaction', async work => work(prisma));
  return { rows, companies, restore: () => originals.reverse().forEach(f => f()) };
}
async function withApp(run) {
  const f = fixture(), app = express(); app.use(express.json());
  app.use((req, res, next) => { if (req.headers['x-role']) req.user = { id: 'staff', role: req.headers['x-role'] }; next(); });
  app.use('/fleet', require('../src/routes/fleet')); app.use('/drivers', require('../src/routes/drivers'));
  app.use((err, req, res, next) => res.status(err.code === 'P2002' ? 409 : err.status || 500).json({ message: err.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const root = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, body, method = body ? 'POST' : 'GET', role = 'ADMIN') => {
    const response = await fetch(root + url, { method, headers: { ...(role ? { 'x-role': role } : {}), ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, body: body ? body instanceof FormData ? body : JSON.stringify(body) : undefined });
    return { status: response.status, data: response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text() };
  };
  try { await run({ ...f, request, root }); } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); f.restore(); }
}
const vehicle = () => ({ registrationNo: 'PA 1234 A', type: 'TRUCK', capacity: 8, ownershipType: 'OWN', companyId: internalId, stnkExpiry: '2027-05-01', kirExpiry: '2027-06-02' });
const driver = () => ({ name: 'Sopir Test', phone: '081234567', licenseNo: 'SIM-123', licenseClass: 'B II', licenseExpiry: '2027-05-01', employmentType: 'VENDOR', companyId: vendorId });
test('fleet create stores explicit ownership and compliance dates without guessing legacy fitness', () => withApp(async ({ request }) => {
  const result = await request('/fleet', vehicle()); assert.equal(result.status, 201); assert.equal(result.data.ownershipType, 'OWN');
  assert.equal(result.data.stnkExpiry, '2027-05-01T00:00:00.000Z'); assert.equal(result.data.kirExpiry, '2027-06-02T00:00:00.000Z');
  assert.equal(result.data.version, 1); assert.equal(result.data.company.isInternal, true); assert.equal(result.data.fitnessExpiry, undefined);
}));
test('driver create retains SIM category, expiry and explicit vendor employer', () => withApp(async ({ request }) => {
  const result = await request('/drivers', driver()); assert.equal(result.status, 201); assert.equal(result.data.employmentType, 'VENDOR');
  assert.equal(result.data.licenseClass, 'B II'); assert.equal(result.data.licenseExpiry, '2027-05-01T00:00:00.000Z'); assert.equal(result.data.company.isInternal, false);
}));
test('master creation rejects invalid values and incompatible or inactive company without writes', () => withApp(async ({ request, rows, companies }) => {
  const inactiveId = randomUUID(); companies.push({ id: inactiveId, isActive: false, isInternal: false });
  for (const [url, base, changes] of [
    ['/fleet', vehicle(), [{ ownershipType: 'VENDOR', companyId: internalId }, { ownershipType: 'OWN', companyId: vendorId }, { ownershipType: 'GUESSED' }, { ownershipType: 'VENDOR', companyId: '' }, { companyId: inactiveId }, { companyId: randomUUID() }, { companyId: 'bad-id' }, { stnkExpiry: '2027-02-29' }, { kirExpiry: '2027-13-01' }, { stnkExpiry: false }, { type: 'BOAT' }, { capacity: -1 }, { capacity: '' }, { year: 2026.5 }, { isActive: 'false' }]],
    ['/drivers', driver(), [{ employmentType: 'INTERNAL', companyId: vendorId }, { employmentType: 'VENDOR', companyId: internalId }, { employmentType: 'VENDOR', companyId: null }, { licenseExpiry: '2027-02-30' }, { name: '' }, { phone: '' }, { licenseNo: '' }, { licenseClass: 123 }]],
  ]) for (const change of changes) { const result = await request(url, { ...base, ...change }); assert.equal(result.status, 422, JSON.stringify(change)); }
  assert.equal(rows.vehicle.length + rows.driver.length, 0);
}));
test('unclassified legacy-compatible creation never infers an owner or employer', () => withApp(async ({ request }) => {
  const body = vehicle(); delete body.ownershipType; delete body.companyId;
  const result = await request('/fleet', body); assert.equal(result.status, 201); assert.equal(result.data.ownershipType, null); assert.equal(result.data.companyId, null);
}));
test('edit and deactivate require matching version, retain legacy unknowns and allow nullable dates', () => withApp(async ({ request, rows }) => {
  for (const [url, body] of [['/fleet', vehicle()], ['/drivers', driver()]]) {
    const created = (await request(url, body)).data;
    for (const change of [{ version: 7 }, {}, { version: 1, isActive: 'false' }, { version: 1, companyId: 'invalid' }, { version: 1, [url === '/fleet' ? 'kirExpiry' : 'licenseExpiry']: '2027-02-29' }]) {
      const result = await request(`${url}/${created.id}`, change, 'PUT'); assert([409, 422].includes(result.status), JSON.stringify(result));
    }
    const dates = url === '/fleet' ? { stnkExpiry: '', kirExpiry: null, registrationNo: 'PA 9999' } : { licenseExpiry: '', licenseClass: '' };
    const edited = await request(`${url}/${created.id}`, { version: 1, ...dates }, 'PUT'); assert.equal(edited.status, 200); assert.equal(edited.data.version, 2);
    assert.equal(edited.data[url === '/fleet' ? 'stnkExpiry' : 'licenseExpiry'], null);
    assert.equal((await request(`${url}/${created.id}`, { version: 1 }, 'DELETE')).status, 409);
    assert.equal((await request(`${url}/${created.id}`, { version: 2 }, 'DELETE')).status, 200);
    assert.equal((await request(url)).data.total, 0);
    const all = await request(`${url}?active=all`); assert.equal(all.data.total, 1); assert.equal(all.data.data[0].isActive, false); assert.equal(all.data.data[0].version, 3);
    const restored = await request(`${url}/${created.id}`, { version: 3, isActive: true }, 'PUT'); assert.equal(restored.status, 200); assert.equal(restored.data.isActive, true);
  }
  const legacy = { id: randomUUID(), registrationNo: 'Legacy', type: 'TRUCK', capacity: 1, companyId: vendorId, ownershipType: null, version: 1, isActive: true }; rows.vehicle.push(legacy);
  const edited = await request(`/fleet/${legacy.id}`, { version: 1, model: 'New' }, 'PUT'); assert.equal(edited.status, 200); assert.equal(edited.data.ownershipType, null);
  assert.equal((await request('/fleet/not-id')).status, 422); assert.equal((await request(`/drivers/${randomUUID()}`)).status, 404);
}));
test('master lists paginate past 200 records, include company ownership and expose advisory compliance', () => withApp(async ({ request, rows }) => {
  for (let i = 0; i < 241; i++) rows.vehicle.push({ ...vehicle(), id: randomUUID(), companyId: internalId, isActive: i !== 240, version: 1, stnkExpiry: null, kirExpiry: new Date('2020-01-01') });
  const a = await request('/fleet?limit=200'), b = await request('/fleet?limit=200&page=2');
  assert.equal(a.data.total, 240); assert.equal(a.data.data.length, 200); assert.equal(b.data.data.length, 40); assert.equal(b.data.data[0].company.isInternal, true);
  assert.equal(b.data.data[0].compliance.stnk.status, 'unknown'); assert.equal(b.data.data[0].compliance.kir.status, 'expired');
  assert.equal((await request('/fleet?active=false')).data.total, 1); assert.equal((await request('/fleet?active=all')).data.total, 241);
  for (const query of ['active=maybe', 'ownershipType=FAKE', 'companyId=invalid', 'type=FAKE', 'limit=201']) assert.equal((await request('/fleet?' + query)).status, 422, query);
  for (const url of ['/fleet', '/drivers']) { assert.equal((await request(url, null, 'GET', null)).status, 401); assert.equal((await request(url, null, 'GET', 'CUSTOMER')).status, 403); }
}));
test('compliance is date-only and advisory in Jayapura, including the UTC day boundary', () => {
  const { compliance } = require('../src/services/transportMasters'), now = new Date('2026-01-01T23:59:59Z');
  for (const [date, status] of [[null, 'unknown'], ['2025-12-31', 'expired'], ['2026-01-01', 'expired'], ['2026-01-02', 'expiring'], ['2026-02-01', 'expiring'], ['2026-02-02', 'valid']]) assert.equal(compliance(date, now).status, status, String(date));
});
test('own vehicles and internal drivers use the canonical SCMU company, not another internal-labelled company', () => withApp(async ({ request, rows, companies }) => {
  const anotherInternalId = randomUUID(); companies.push({ id: anotherInternalId, name: 'Other internal', isInternal: true, isActive: true });
  for (const [url, body] of [['/fleet', vehicle()], ['/drivers', { ...driver(), employmentType: 'INTERNAL' }]]) {
    const result = await request(url, { ...body, companyId: anotherInternalId });
    assert.equal(result.status, 422);
  }
  assert.equal(rows.vehicle.length + rows.driver.length, 0);
}));
test('master documents roundtrip authenticated bounded multipart, retain history, and scope downloads to parent', () => withApp(async ({ request, rows }) => {
  const cleanup = [], files = require('../src/services/jobFiles');
  function form(category, version = 1, bytes = '%PDF-1.4\nMaster document', mime = 'application/pdf') { const data = new FormData(); data.set('category', category); data.set('version', String(version)); data.set('file', new Blob([bytes], { type: mime }), 'scan.pdf'); return data; }
  try {
    const v = (await request('/fleet', vehicle())).data, d = (await request('/drivers', driver())).data;
    assert.deepEqual((await request(`/fleet/${v.id}/documents`)).data, { data: [], version: 1 });
    const upload = await request(`/fleet/${v.id}/documents`, form('STNK')); assert.equal(upload.status, 201, JSON.stringify(upload.data)); assert.equal(upload.data.category, 'STNK'); assert.equal(upload.data.version, 2); assert.equal(upload.data.filename, undefined);
    cleanup.push(rows.masterDocument.at(-1).filename);
    const download = await request(`/fleet/${v.id}/documents/${upload.data.id}/download`); assert.equal(download.status, 200); assert.equal(download.data, '%PDF-1.4\nMaster document');
    assert.equal((await request(`/drivers/${d.id}/documents/${upload.data.id}/download`)).status, 404);
    const second = await request(`/fleet/${v.id}/documents`, form('KIR', 2)); assert.equal(second.status, 201); cleanup.push(rows.masterDocument.at(-1).filename);
    assert.equal((await request(`/fleet/${v.id}/documents`)).data.data.length, 2);
    assert.equal((await request(`/fleet/${v.id}`, { version: 3 }, 'DELETE')).status, 200);
    assert.equal((await request(`/fleet/${v.id}/documents/${upload.data.id}/download`)).status, 200);
    assert.equal((await request(`/fleet/${v.id}/documents`, form('STNK', 4))).status, 409);
    const sim = await request(`/drivers/${d.id}/documents`, form('SIM')); assert.equal(sim.status, 201); cleanup.push(rows.masterDocument.at(-1).filename);
    assert.equal((await request(`/drivers/${d.id}/documents`)).data.data[0].category, 'SIM');
    assert.equal((await request(`/drivers/${d.id}/documents/${sim.data.id}/download`, null, 'GET', null)).status, 401);
  } finally { await Promise.all(cleanup.map(filename => files.removeFile(filename))); }
}));
test('upload validation, stale versions and persistence failure leave no bytes or metadata', () => withApp(async ({ request, rows }) => {
  const fs = require('node:fs/promises'), path = require('node:path'), files = require('../src/services/jobFiles'), directory = path.dirname(files.filePath('probe'));
  const initial = (await fs.readdir(directory)).sort(), v = (await request('/fleet', vehicle())).data;
  const make = (category, version, bytes, mime = 'application/pdf') => { const f = new FormData(); f.set('category', category); f.set('version', version); if (bytes !== null) f.set('file', new Blob([bytes], { type: mime }), 'scan.pdf'); return f; };
  for (const [form, status] of [[make('SIM', '1', '%PDF-1.4'), 422], [make('STNK', '9', '%PDF-1.4'), 409], [make('STNK', '1', 'fake pdf'), 415], [make('STNK', '1', 'text', 'text/plain'), 415], [make('STNK', '1', null), 422], [make('STNK', '1', Buffer.alloc(5 * 1024 * 1024 + 1)), 413]]) {
    assert.equal((await request(`/fleet/${v.id}/documents`, form)).status, status); assert.equal(rows.masterDocument.length, 0);
  }
  const original = prisma.masterDocument.create; prisma.masterDocument.create = async () => { throw Object.assign(new Error('fixture write failed'), { status: 503 }); };
  try { assert.equal((await request(`/fleet/${v.id}/documents`, make('STNK', '1', '%PDF-1.4'))).status, 503); } finally { prisma.masterDocument.create = original; }
  assert.deepEqual((await fs.readdir(directory)).sort(), initial); assert.equal(rows.masterDocument.length, 0);
}));
test('concurrent compare-and-swap failure rejects updates before overwriting a newer master', () => withApp(async ({ request }) => {
  const row = (await request('/fleet', vehicle())).data, original = prisma.vehicle.updateMany;
  prisma.vehicle.updateMany = async () => ({ count: 0 });
  try { assert.equal((await request(`/fleet/${row.id}`, { version: 1, model: 'Stale' }, 'PUT')).status, 409); } finally { prisma.vehicle.updateMany = original; }
  assert.equal((await request(`/fleet/${row.id}`)).data.model, undefined);
}));
test('master detail retains recent trip history and legacy compliance fields', () => withApp(async ({ request, rows }) => {
  const row = (await request('/fleet', vehicle())).data;
  Object.assign(rows.vehicle[0], { fitnessExpiry: new Date('2028-01-01'), trips: [{ id: 'trip', driver: { name: 'Driver history' } }] });
  const result = await request(`/fleet/${row.id}`); assert.equal(result.status, 200); assert.equal(result.data.trips[0].driver.name, 'Driver history'); assert.equal(result.data.fitnessExpiry, '2028-01-01T00:00:00.000Z');
}));
test('master document upload applies the shared upload rate limit before storing bytes', () => withApp(async ({ request, rows }) => {
  const v = (await request('/fleet', vehicle())).data;
  let limited = false;
  for (let n = 0; n < 31; n++) { const response = await request(`/fleet/${v.id}/documents`, {}); if (response.status === 429) { limited = true; break; } assert.equal(response.status, 422); }
  assert.equal(limited, true); assert.equal(rows.masterDocument.length, 0);
}));
test('queued file purge retains bytes referenced only by an append-only master document', async () => {
  const fs = require('node:fs/promises'), files = require('../src/services/jobFiles');
  const filename = randomUUID() + '.pdf', original = prisma.$transaction;
  await fs.writeFile(files.filePath(filename), '%PDF-1.4\nRetained master');
  let removedTask = false;
  const empty = { count: async () => 0 };
  prisma.$transaction = async fn => fn({
    documentFilePurge: { findUnique: async () => ({ filename }), delete: async () => { removedTask = true; } },
    seaBillFile: empty, jobDocument: empty, bLImportSession: empty, journeyFile: empty,
    masterDocument: { count: async () => 1 },
  });
  try {
    const result = await require('../src/services/documentFilePurge').purge(filename);
    assert.equal(result.sharedFileRetained, true);
    await fs.access(files.filePath(filename)); assert.equal(removedTask, true);
  } finally { prisma.$transaction = original; await files.removeFile(filename); }
});
module.exports = { withApp, vehicle, driver, internalId, vendorId };

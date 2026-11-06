const { randomUUID } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { fail, text, choice, date, integer, decimal, audit } = require('./jpt');
const { costFields, operatingCostTypeSnapshot } = require('./transport');
const sea = require('./seaBills');

const json = value => JSON.parse(JSON.stringify(value));
const optionalText = (value, name, max = 500) => text(value, name, max, true);
const isoDate = value => date(value, true)?.toISOString() || null;
const numeric = (value, name, scale = 3) => decimal(String(value ?? 0), name, scale).toFixed(scale);
const nullableNumeric = (value, name, scale = 3) => value == null || value === '' ? null : numeric(value, name, scale);
const defaultOperational = () => ({
  packing: { status: 'DRAFT', headerStatus: 'DRAFT', headerNumber: null, sourceFileIds: [], groups: [] },
  deadlines: { etaDate: null, storageUntil: null, demurrageFrom: null, emptyReturnDue: null },
  unloading: { status: 'PENDING', inspectedAt: null, staffName: null, declaredPackages: 0, actualPackages: 0, damagedPackages: 0, notes: null, evidenceFileIds: [] },
});

function packingItem(row, sequence, confirmed = false) {
  fail(row && typeof row === 'object' && !Array.isArray(row), 'Packing item must be valid');
  if (confirmed) fail(row.packages != null && row.packages !== '', 'Isi jumlah setiap barang. Nol harus dinyatakan secara eksplisit.');
  return {
    id: typeof row.id === 'string' && row.id ? row.id.slice(0, 100) : randomUUID(), sequence,
    itemDate: isoDate(row.itemDate), itemDateText: optionalText(row.itemDateText, 'Source date text', 100), shop: optionalText(row.shop, 'Shop', 200),
    sourceSheet: optionalText(row.sourceSheet, 'Source worksheet', 100), sourceRow: row.sourceRow == null ? null : integer(row.sourceRow, 'Source row', 1, 10000),
    description: confirmed ? text(row.description, 'Item description', 500) : optionalText(row.description, 'Item description', 500),
    quantity: numeric(row.quantity ?? 0, 'Item quantity', 4), packages: row.packages == null || row.packages === '' ? null : integer(row.packages, 'Item packages', 0, 1000000),
    lengthCm: nullableNumeric(row.lengthCm, 'Length', 3), widthCm: nullableNumeric(row.widthCm, 'Width', 3), heightCm: nullableNumeric(row.heightCm, 'Height', 3),
    volumeCbm: nullableNumeric(row.volumeCbm, 'Volume', 4), sourceVolume: nullableNumeric(row.sourceVolume, 'Source volume', 4), marks: optionalText(row.marks, 'Marks', 300),
    ...(row.packageUnit!==undefined?{packageUnit:text(row.packageUnit,'Satuan kemasan',30).toUpperCase()}:{}),
  };
}

function packingGroup(row, index, bill, sourceIds, confirmed = false) {
  fail(row && typeof row === 'object' && !Array.isArray(row), 'Packing group must be valid');
  const containerNumber = text(row.containerNumber, 'Container number', 50, true)?.toUpperCase()||null;
  const sourceFileId = optionalText(row.sourceFileId, 'Packing source', 100);
  fail(!sourceFileId || sourceIds.includes(sourceFileId), 'Pilih berkas sumber yang terlampir pada B/L ini untuk penerima tersebut.');
  if ((bill.files || []).some(file => file.id === sourceFileId && file.scope?.type === 'SHARED')) {
    const canonical = require('./packingImport').canonical;
    fail(containerNumber && (bill.containers || []).some(c => canonical(c.number) === canonical(containerNumber)), 'Kelompok sumber bersama harus menggunakan kontainer pada B/L ini.', 409);
  }
  const items = Array.isArray(row.items) ? row.items.map((item,sequence)=>packingItem(item,sequence,confirmed)) : null;
  fail(items && items.length <= 500, 'Enter up to 500 packing items per recipient');
  return {
    id: typeof row.id === 'string' && row.id ? row.id.slice(0, 100) : randomUUID(), sequence: index + 1,
    sourceFileId, containerNumber, sealNumber: optionalText(row.sealNumber, 'Seal number', 100),
    size: row.size == null || row.size === '' ? null : choice(String(row.size), ['20', '21', '40'], 'Container size'),
    recipientName: confirmed ? text(row.recipientName, 'Recipient / mark', 250) : optionalText(row.recipientName, 'Recipient / mark', 250), recipientAddress: optionalText(row.recipientAddress, 'Recipient address', 1000),
    recipientPhone: optionalText(row.recipientPhone, 'Recipient phone', 80), notes: optionalText(row.notes, 'Packing notes', 1000),
    sourceMark: optionalText(row.sourceMark, 'Source mark', 1500), sourceSheet: optionalText(row.sourceSheet, 'Source worksheet', 100), sourceRow: row.sourceRow == null ? null : integer(row.sourceRow, 'Source row', 1, 10000), items,
    ...(row.dataLevel==='SUMMARY'?{dataLevel:'SUMMARY',goodsSummary:optionalText(row.goodsSummary,'Ringkasan muatan',2000),summaryPackages:row.summaryPackages==null||row.summaryPackages===''?null:integer(row.summaryPackages,'Jumlah ringkasan',0,1000000),packageUnit:(optionalText(row.packageUnit,'Satuan kemasan',30)||'KOLI').toUpperCase()}:{}),
    ...(row.instructions!==undefined?{instructions:optionalText(row.instructions,'Instruksi lapangan',2000)}:{}),
  };
}

function normalizeOperational(input, bill) {
  fail(input && typeof input === 'object' && !Array.isArray(input), 'Operational workspace must be an object');
  const sourceFiles = (bill.files || []).filter(file => ['PACKING_LIST', 'INTERNAL_PACKING_LIST'].includes(file.category));
  const sourceIds = Array.isArray(input.packing?.sourceFileIds) ? [...new Set(input.packing.sourceFileIds)] : [];
  fail(sourceIds.length <= 100 && sourceIds.every(id => sourceFiles.some(file => file.id === id)), 'Select valid attached Packing Lists');
  const packingStatus = choice(input.packing?.status || 'DRAFT', ['DRAFT', 'CONFIRMED'], 'Packing transcription status');
  if (packingStatus === 'CONFIRMED' && sourceFiles.some(file => sourceIds.includes(file.id) && file.scope?.type === 'SHARED')) fail(input.packing?.scopeConfirmed === true, 'Konfirmasikan hanya bagian sumber bersama milik B/L ini sebelum membuat PL internal.', 409);
  const groups = Array.isArray(input.packing?.groups) ? input.packing.groups.map((row, index) => packingGroup(row, index, bill, sourceIds, packingStatus === 'CONFIRMED')) : null;
  fail(groups && groups.length <= 200, 'Enter up to 200 Packing List recipient groups');
  if (packingStatus === 'CONFIRMED') fail(sourceIds.length && groups.length, 'Pilih minimal satu PL mitra dan terapkan hasil impor atau isi rincian penerima sebelum konfirmasi. Jika tanpa berkas, pilih Input manual.');
  const deadlines = {
    etaDate: isoDate(input.deadlines?.etaDate), storageUntil: isoDate(input.deadlines?.storageUntil),
    demurrageFrom: isoDate(input.deadlines?.demurrageFrom), emptyReturnDue: isoDate(input.deadlines?.emptyReturnDue),
  };
  fail(!deadlines.storageUntil || !deadlines.demurrageFrom || deadlines.demurrageFrom >= deadlines.storageUntil, 'Demurrage date must not precede the storage deadline');
  const evidenceFileIds = Array.isArray(input.unloading?.evidenceFileIds) ? [...new Set(input.unloading.evidenceFileIds)] : [];
  fail(evidenceFileIds.length <= 50 && evidenceFileIds.every(id => (bill.files || []).some(file => file.id === id)), 'Select valid unloading evidence files');
  const unloading = {
    status: choice(input.unloading?.status || 'PENDING', ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISCREPANCY'], 'Unloading status'),
    inspectedAt: isoDate(input.unloading?.inspectedAt), staffName: optionalText(input.unloading?.staffName, 'Inspector', 200),
    declaredPackages: integer(input.unloading?.declaredPackages ?? 0, 'Declared packages', 0, 1000000),
    actualPackages: integer(input.unloading?.actualPackages ?? 0, 'Actual packages', 0, 1000000),
    damagedPackages: integer(input.unloading?.damagedPackages ?? 0, 'Damaged packages', 0, 1000000),
    notes: optionalText(input.unloading?.notes, 'Unloading notes', 3000), evidenceFileIds,
  };
  if (['COMPLETED', 'DISCREPANCY'].includes(unloading.status)) fail(unloading.inspectedAt && unloading.staffName, 'Record inspection time and staff before completing unloading');
  if (unloading.status === 'COMPLETED') fail(unloading.declaredPackages === unloading.actualPackages && unloading.damagedPackages === 0, 'Use discrepancy status when package totals differ or damage exists');
  if (unloading.status === 'DISCREPANCY') fail(unloading.notes, 'Explain the unloading discrepancy');
  return {
    packing: { status: packingStatus, headerStatus: choice(input.packing?.headerStatus || 'DRAFT', ['DRAFT', 'READY'], 'Packing Header status'), headerNumber: optionalText(input.packing?.headerNumber, 'Packing Header number', 100), sourceFileIds: sourceIds, groups, ...(input.packing?.scopeConfirmed === true ? {scopeConfirmed:true} : {}), ...(input.packing?.comparisonBasis?{comparisonBasis:require('./packingSources').basis(input.packing.comparisonBasis)}:{}),...(input.packing?.sourceIdentity?{sourceIdentity:require('./packingSources').sourceIdentity(input.packing.sourceIdentity)}:{}),...(input.packing?.sourceHeading?{sourceHeading:text(input.packing.sourceHeading,'Judul sumber',2000,true)}:{}) },
    deadlines, unloading,
  };
}

function operationalOf(bill) {
  return { ...defaultOperational(), ...(bill.registerData?.operational || {}), packing: { ...defaultOperational().packing, ...(bill.registerData?.operational?.packing || {}) }, deadlines: { ...defaultOperational().deadlines, ...(bill.registerData?.operational?.deadlines || {}) }, unloading: { ...defaultOperational().unloading, ...(bill.registerData?.operational?.unloading || {}) } };
}

function presentCost(row) {
  return { ...row, estimatedAmount: row.estimatedAmount.toFixed(2), actualAmount: row.actualAmount?.toFixed(2) || null, vendorName: row.vendor?.name || null, line: row.tariffSnapshot?.line || null, evidenceFileId: row.tariffSnapshot?.evidenceFileId || null };
}

async function get(tx, id) {
  const bill = await require('./blRegister').get(tx, id);
  const operational = operationalOf(bill);
  const costs = await tx.jobCharge.findMany({ where: { jobId: bill.jobId, kind: 'COST', tariffSnapshot: { path: ['billId'], equals: id } }, include: { vendor: { select: { id: true, name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  return { operational, costs: costs.map(presentCost) };
}

async function update(tx, user, id, body) {
  const bill = await require('./blRegister').get(tx, id);
  await sea.getBill(tx, bill.jobId, id, body.version);
  const operational = normalizeOperational(body.operational, bill);
  const before = operationalOf(bill);
  const recap=require('./packingRecap');
  if(bill.registerData?.internalRecap?.valid&&recap.fingerprint(bill)!==recap.fingerprint({...bill,registerData:{...bill.registerData,operational}}))await recap.invalidateShared(tx,user,bill);
  if (JSON.stringify([before.packing.status,before.packing.groups,before.packing.sourceFileIds,before.deadlines]) !== JSON.stringify([operational.packing.status,operational.packing.groups,operational.packing.sourceFileIds,operational.deadlines])) operational.packing.headerStatus = 'DRAFT';
  const registerData = { ...(bill.registerData || {}), workflowVersion:2, operational: json(operational) };
  await tx.seaBill.update({ where: { id }, data: { registerData, version: { increment: 1 } } });
  await audit(tx, user, 'BL_OPERATIONAL_WORKSPACE_UPDATED', 'JobOrder', bill.jobId, { seaBillId: id, operational });
  return { operational, version: bill.version + 1 };
}

async function createCost(tx, user, id, body, context = {}) {
  const bill = await require('./blRegister').get(tx, id);
  await sea.getBill(tx, bill.jobId, id, body.version);
  const quantity = decimal(String(body.quantity), 'Quantity', 4, true);
  const unitPrice = decimal(String(body.unitPrice), 'Unit price', 2, true);
  const amount = quantity.mul(unitPrice).toDecimalPlaces(2);
  fail(amount.lte('999999999999'), 'Operational cost total exceeds limit');
  const fields = await costFields(tx, bill.jobId, { costSource: body.costSource, costCategory: body.costCategory, vendorId: body.vendorId || null });
  const evidenceFileId = optionalText(body.evidenceFileId, 'Evidence file', 100);
  fail(!evidenceFileId || bill.files.some(file => file.id === evidenceFileId), 'Select an attached evidence file');
  const line = { description: text(body.description, 'Description', 300), quantity: quantity.toFixed(4), unit: text(body.unit || 'JOB', 'Unit', 30), unitPrice: unitPrice.toFixed(2), amount: amount.toFixed(2), vatIncluded: Boolean(body.vatIncluded), vatRate: optionalText(body.vatRate, 'VAT rate', 20), pph23Applicable: Boolean(body.pph23Applicable) };
  const operatingCostType = await operatingCostTypeSnapshot(tx, body);
  const snapshot = json({ billId: id, type: 'OPERATIONAL_COST', line, evidenceFileId, currency: 'IDR', ...(operatingCostType ? { operatingCostType } : {}), ...(context.driverBonId?{driverBonId:context.driverBonId}: {}),...(context.driverRateSnapshot?{driverRateSnapshot:context.driverRateSnapshot}:{}) });
  const charge = await tx.jobCharge.create({ data: { jobId: bill.jobId, shipmentId: null, kind: 'COST', status: 'PROPOSED', ...(context.driverBonId?{tariffKey:'BONRATE:'+context.driverBonId}:{}), ...fields, description: line.description, estimatedAmount: amount, tariffSnapshot: snapshot, notes: optionalText(body.notes, 'Cost notes', 2000), createdById: user.id } });
  const approval = await require('./director').submit(tx, user, 'CHARGE_APPROVE', charge.id, { actualAmount: amount.toFixed(2) }, 'Operational cost recorded from the B/L workspace.');
  await tx.seaBill.update({ where: { id }, data: { version: { increment: 1 } } });
  await audit(tx, user, 'BL_OPERATIONAL_COST_PROPOSED', 'JobOrder', bill.jobId, { seaBillId: id, chargeId: charge.id, snapshot });
  return { charge: presentCost({ ...charge, vendor: fields.vendorId ? await tx.company.findUnique({ where: { id: fields.vendorId }, select: { id: true, name: true } }) : null }), approval, version: bill.version + 1 };
}

module.exports = { defaultOperational, normalizeOperational, packingGroup, operationalOf, get, update, createCost };

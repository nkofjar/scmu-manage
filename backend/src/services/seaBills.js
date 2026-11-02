const { fail, text, decimal, integer, date, choice, sum, mutableJob, audit } = require('./jpt');
const { isDeepStrictEqual } = require('node:util');
const { Prisma } = require('@prisma/client');
const json = value => JSON.parse(JSON.stringify(value));
const CARGO_SELECT = { id: true, jobId: true, direction: true, recordNumber: true, externalNumber: true, senderName: true, recipientName: true, packages: true, grossWeightKg: true, volumeCbm: true };
const seaInclude = {
  journey: { select: { id:true,number:true,vesselName:true,voyageNumber:true,archivedAt:true,deletedAt:true } },
  shipment: { select: { id: true, jobId: true, shipmentNumber: true, mode: true, status: true, carrierId:true, originCity:true, destCity:true, vesselFlight: true, containerNumber: true, sealNumber: true } },
  allocations: { orderBy: { packingListId: 'asc' }, include: { packingList: { select: CARGO_SELECT } } },
  files: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
  history: { orderBy: { version: 'desc' } },
};
const metaKeys = ['documentKind','billNumber','issueDate','carrierName','vesselName','voyageNumber','portOfLoading','portOfDischarge','shipperName','consigneeName','containers','packages','grossWeightKg','volumeCbm'];
const normalized = (value, scale) => decimal(String(value ?? 0), 'Cargo quantity', scale).toFixed(scale);
function declared(packing) {
  return { packages: packing.packages, grossWeightKg: packing.grossWeightKg == null ? null : normalized(packing.grossWeightKg, 3), volumeCbm: packing.volumeCbm == null ? null : normalized(packing.volumeCbm, 4), senderName: packing.senderName, recipientName: packing.recipientName, externalNumber: packing.externalNumber || packing.recordNumber };
}
function contentSnapshot(bill) {
  return { ...Object.fromEntries(metaKeys.map(key => [key, key === 'containers' ? (bill.containers || []).map(({number,seal}) => ({number,seal})) : key === 'issueDate' ? bill[key] ? new Date(bill[key]).toISOString() : null : key === 'grossWeightKg' ? normalized(bill[key], 3) : key === 'volumeCbm' ? normalized(bill[key], 4) : bill[key] ?? null])),
    ...(bill.notifyPartyName ? {notifyPartyName:bill.notifyPartyName} : {}),
    ...(bill.onBoardDate ? {onBoardDate:new Date(bill.onBoardDate).toISOString()} : {}),
    transport: bill.shipment ? Object.fromEntries(['mode','carrierId','originCity','destCity','vesselFlight','containerNumber','sealNumber'].map(key=>[key,bill.shipment[key]??null])) : null,
    allocations: (bill.allocations || []).map(row => ({ packingListId: row.packingListId, packages: row.packages, grossWeightKg: row.grossWeightKg == null ? null : normalized(row.grossWeightKg, 3), volumeCbm: row.volumeCbm == null ? null : normalized(row.volumeCbm, 4), scope: row.scope || null, declaredSnapshot: row.declaredSnapshot })).sort((a,b) => a.packingListId.localeCompare(b.packingListId)) };
}
const STATUSES = ['REGISTERED','READY','GATE_OUT','DOORING','STRIPPED','EMPTY_RETURNED'];
const DATE_KEYS = ['plannedDeliveryAt','gateOutAt','strippedAt','emptyReturnedAt','freeTimeUntil'];
const OP_TEXT_KEYS = ['goodsDescription','destinationAddress','vehicleNumber','driverName','vendorName','notes'];
function operational(row, defaults = false) {
  const clean = {...row};
  if (defaults || row.size !== undefined) clean.size = row.size == null || row.size === '' ? null : choice(String(row.size), ['20','21','40'], 'Size');
  if (defaults || row.status !== undefined) clean.status = choice(row.status || 'REGISTERED', STATUSES, 'Container status');
  for (const key of DATE_KEYS) if (defaults || row[key] !== undefined) clean[key] = date(row[key], true)?.toISOString() || null;
  for (const key of OP_TEXT_KEYS) if (defaults || row[key] !== undefined) clean[key] = text(row[key], key, 2000, true);
  fail(clean.status !== 'EMPTY_RETURNED' || clean.emptyReturnedAt, 'Record an empty-return date for an empty-returned container');
  const events = ['gateOutAt','strippedAt','emptyReturnedAt'].map(key => clean[key]).filter(Boolean);
  fail(events.every((value, index) => !index || value >= events[index - 1]), 'Container events must be chronological');
  return clean;
}
function historicalOperational(row) {
  const safely = (read, fallback) => { try { return read(); } catch (error) { if (error.status !== 422) throw error; return fallback; } };
  const clean = {...row, size: safely(() => row.size == null || row.size === '' ? null : choice(String(row.size), ['20','21','40'], 'Size'), null), status: safely(() => choice(row.status || 'REGISTERED', STATUSES, 'Container status'), 'REGISTERED')};
  for (const key of DATE_KEYS) clean[key] = safely(() => date(row[key], true)?.toISOString() || null, null);
  for (const key of OP_TEXT_KEYS) clean[key] = safely(() => text(row[key], key, 2000, true), null);
  const events = ['gateOutAt','strippedAt','emptyReturnedAt'].map(key => clean[key]).filter(Boolean);
  if (!events.every((value, index) => !index || value >= events[index - 1])) {
    for (const key of ['gateOutAt','strippedAt','emptyReturnedAt']) clean[key] = null;
  }
  if (clean.status === 'EMPTY_RETURNED' && !clean.emptyReturnedAt) clean.status = 'REGISTERED';
  return clean;
}
function metadata(body, suppliedContainers, registeredContainers = []) {
  const containers = body.containers || [];
  fail(Array.isArray(containers) && containers.length <= 100, 'Enter up to 100 containers');
  fail(containers.every(row=>row&&typeof row==='object'&&!Array.isArray(row)), 'Container details must be valid');
  const clean = containers.map(row => {
    const identity = { ...row, number: text(row.number, 'Container number', 50).toUpperCase(), seal: text(row.seal, 'Seal number', 100, true) };
    if (suppliedContainers === undefined) return operational(identity);
    const supplied = suppliedContainers.find(item => String(item?.number || '').trim().toUpperCase() === identity.number) || {};
    const registered = registeredContainers.find(item => item.number === identity.number) || {};
    const checked = operational({ ...historicalOperational({ ...identity, ...registered }), ...supplied });
    // Validate explicit fields, but never destructively rewrite historical extras.
    for (const key of ['size','status',...DATE_KEYS,...OP_TEXT_KEYS]) if (supplied[key] !== undefined) identity[key] = checked[key];
    return identity;
  });
  fail(new Set(clean.map(row => row.number)).size === clean.length, 'Container numbers must be distinct');
  return { documentKind: choice(body.documentKind || 'BILL_OF_LADING', ['BILL_OF_LADING','SEA_WAYBILL'], 'Sea document type'),
    billNumber: text(body.billNumber, 'BL number', 100, true), issueDate: date(body.issueDate, true),
    ...(body.onBoardDate!==undefined?{onBoardDate:date(body.onBoardDate,true)}:{}),
    ...(body.notifyPartyName!==undefined?{notifyPartyName:text(body.notifyPartyName,'Notify party',200,true)}:{}),
    ...Object.fromEntries(['carrierName','vesselName','voyageNumber','portOfLoading','portOfDischarge','shipperName','consigneeName'].map(key => [key, text(body[key], key, 200, true)])),
    containers: clean, packages: integer(body.packages ?? 0, 'Packages', 0), grossWeightKg: decimal(String(body.grossWeightKg ?? 0), 'Gross weight', 3), volumeCbm: decimal(String(body.volumeCbm ?? 0), 'Volume', 4),
    notes: text(body.notes, 'Notes', 3000, true), reviewIssues: text(body.reviewIssues, 'Review issues', 2000, true) };
}
async function allocationData(tx, job, shipmentId, billId, rows) {
  fail(Array.isArray(rows)&&rows.every(row=>row&&typeof row==='object'&&typeof row.packingListId==='string'), 'Select valid packing lists');
  fail(Array.isArray(rows) && rows.length <= 100 && new Set(rows.map(row => row.packingListId)).size === rows.length, 'Select distinct packing lists, up to 100');
  const packing = await tx.packingList.findMany({ where: { id: { in: rows.map(row => row.packingListId) }, jobId: job.id, direction: job.jobType === 'RECEIVER' ? 'INBOUND' : 'OUTBOUND' }, select: CARGO_SELECT });
  fail(packing.length === rows.length, 'Packing lists must belong to this job and match its role');
  const others = await tx.seaBillCargo.findMany({ where: { packingListId: { in: rows.map(row => row.packingListId) }, bill: { shipmentId, ...(billId ? { id: { not: billId } } : {}) } } });
  return rows.map(row => {
    const source = packing.find(item => item.id === row.packingListId);
    const data = { packingListId: source.id, packages: integer(row.packages, 'Allocated packages'), grossWeightKg: source.grossWeightKg == null ? null : decimal(String(row.grossWeightKg ?? 0), 'Allocated weight', 3), volumeCbm: source.volumeCbm == null ? null : decimal(String(row.volumeCbm ?? 0), 'Allocated volume', 4), scope: text(row.scope, 'Cargo scope / marks', 500, true), declaredSnapshot: declared(source) };
    const used = others.filter(item => item.packingListId === source.id);
    fail(data.packages + used.reduce((total,item) => total + item.packages, 0) <= source.packages && (source.grossWeightKg == null || data.grossWeightKg.plus(sum(used,item=>item.grossWeightKg)).lte(source.grossWeightKg)) && (source.volumeCbm == null || data.volumeCbm.plus(sum(used,item=>item.volumeCbm)).lte(source.volumeCbm)), 'Allocated cargo exceeds the packing list balance for this sea leg', 409);
    if (data.packages < source.packages) fail(data.scope, 'Describe the package marks or cargo portion for a partial allocation');
    return data;
  });
}
function issues(bill) {
  const list = [];
  // Optional transcribed totals are compared only when supplied. The original
  // uploaded document and the operator's checks remain the primary reference.
  const weight=decimal(String(bill.grossWeightKg ?? 0),'Weight',3);const volume=decimal(String(bill.volumeCbm ?? 0),'Volume',4);
  if (bill.allocations.some(row => row.grossWeightKg == null || row.volumeCbm == null)) list.push('SEA_PACKING_INCOMPLETE');
  if (bill.allocations.length && (bill.packages>0 && bill.packages !== bill.allocations.reduce((total,row)=>total+row.packages,0) || weight.gt(0) && bill.allocations.every(row=>row.grossWeightKg!=null) && !weight.eq(sum(bill.allocations,row=>row.grossWeightKg)) || volume.gt(0) && bill.allocations.every(row=>row.volumeCbm!=null) && !volume.eq(sum(bill.allocations,row=>row.volumeCbm)))) list.push('SEA_CARGO_DIFFERENCE');
  if (bill.allocations.some(row => !isDeepStrictEqual(row.declaredSnapshot, declared(row.packingList)) )) list.push('SEA_PACKING_CHANGED');
  if (bill.approvedSnapshot && !isDeepStrictEqual(bill.approvedSnapshot, contentSnapshot(bill))) list.push('SEA_MATERIAL_CHANGE');
  if (bill.reviewIssues) list.push('SEA_REPORTED_ISSUE');
  return list;
}
function receipt(bill) {
  const latest = bill.files.find(file=>['DRAFT','FINAL'].includes(file.category) && file.contentVersion===bill.contentVersion);
  return latest?.category==='FINAL' ? 'SEA_FINAL_RECEIVED' : latest ? 'SEA_DRAFT_RECEIVED' : 'SEA_NOT_RECEIVED';
}
function present(bill) {
  const keys = ['grossWeightKg', 'volumeCbm'];
  const missingDocuments = Object.fromEntries(keys.map(key => [key, bill.allocations.filter(row => row[key] == null).length]));
  const knownTotals = Object.fromEntries(keys.map(key => [key, bill.allocations.some(row => row[key] != null) ? sum(bill.allocations,row=>row[key]).toFixed(key==='volumeCbm'?4:3) : null]));
  return { ...bill, receiptStatus: receipt(bill), issues: issues(bill), totals: { packages: bill.allocations.reduce((total,row)=>total+row.packages,0), ...Object.fromEntries(keys.map(key=>[key,missingDocuments[key]?null:knownTotals[key]??(key==='volumeCbm'?'0.0000':'0.000')])), knownTotals, missingDocuments } };
}
async function getBill(tx, jobId, id, version, editing = true) {
  if (editing) await mutableJob(tx, jobId);
  const bill = await tx.seaBill.findFirst({ where: { id, jobId }, include: seaInclude });
  fail(bill, 'Sea transport document not found', 404);
  if (editing) { fail(!bill.archivedAt&&!bill.registerData?.archivedAt,'Archived register records are read-only',409); fail(bill.shipment.mode === 'SEA' && bill.shipment.status !== 'CANCELLED', 'Select an active sea transport leg', 409); fail(integer(version, 'Version') === bill.version, 'Sea document changed; reload before saving', 409); }
  return bill;
}
async function history(tx, user, billId, action, note, metadata = {}) {
  const bill = await tx.seaBill.findUnique({ where: { id: billId }, include: seaInclude });
  await tx.seaBillRevision.create({ data: { billId, version: bill.version, action, createdById: user?.id, note: text(note, 'Revision note', 2000, true), snapshot: json({ ...contentSnapshot(bill), contentVersion: bill.contentVersion, receiptStatus: receipt(bill), internalStatus: bill.internalStatus, reviewIssues: bill.reviewIssues, notes: bill.notes, reviewedById: bill.reviewedById, reviewedAt: bill.reviewedAt, reviewChecks: bill.reviewChecks, releaseStatus: bill.releaseStatus, releaseMethod: bill.releaseMethod, releaseReference: bill.releaseReference, releaseNote: bill.releaseNote, releaseProofId: bill.releaseProofId, releasedAt: bill.releasedAt, files: bill.files.map(file=>({ id:file.id, category:file.category, originalName:file.originalName, contentVersion:file.contentVersion })) }) } });
  if (user?.id) await audit(tx, user, action, 'JobOrder', bill.jobId, { ...metadata, seaBillId: billId, version: bill.version });
  return getBill(tx, bill.jobId, billId, undefined, false);
}
async function registerIdentity(tx, billNumber, before, conflictMessage = 'This BL number is already registered') {
  const identity = billNumber ? text(billNumber, 'BL number', 100).toUpperCase() : null;
  // Unchanged historical duplicates are grandfathered, never backfilled destructively.
  if (before && identity === (before.billNumber?.trim().toUpperCase() || null)) return before.registerIdentity ?? null;
  if (identity) {
    const found = await tx.seaBill.findFirst({ where: require('./registerLifecycle').currentNumberWhere(billNumber, before?.id) });
    fail(!found, conflictMessage, 409);
  }
  return identity;
}
async function createBill(tx, user, jobId, body, automatic = false) {
  const job = await mutableJob(tx, jobId);
  const leg = await tx.shipment.findFirst({ where: { id: body.shipmentId, jobId, mode: 'SEA', status: { not: 'CANCELLED' } }, include: { carrier: true } }); fail(leg, 'Select an active sea transport leg');
  const fields = metadata(automatic ? {} : body);
  const identity = await registerIdentity(tx, fields.billNumber);
  let document;
  if (body.documentId) {
    document = await tx.jobDocument.findFirst({ where: { id: body.documentId, jobId, type: { in: ['BILL_OF_LADING','SEA_WAYBILL'] }, seaBill: null } });
    fail(document && (!document.shipmentId || document.shipmentId === leg.id), 'Select an unlinked sea document from this job');
    document = await tx.jobDocument.update({ where: { id: document.id }, data: { shipmentId: leg.id, required: true, customerVisible: false } });
  } else document = await tx.jobDocument.create({ data: { jobId, shipmentId: leg.id, type: body.documentKind || 'BILL_OF_LADING', title: `BL / Sea waybill - ${leg.shipmentNumber}`, required: true, customerVisible: false } });
  const allocations = await allocationData(tx, job, leg.id, null, body.allocations || []);
  const bill = await tx.seaBill.create({ data: { jobId, shipmentId: leg.id, documentId: document.id, ...fields, registerIdentity: identity, allocations: { create: allocations } } });
  if (document.filename) await tx.seaBillFile.create({ data: { billId: bill.id, category: 'LEGACY', contentVersion: 1, filename: document.filename, originalName: document.originalName || document.filename, mimeType: document.mimeType || 'application/pdf', size: document.size || 0, uploadedById: document.uploadedById, note: 'Existing attachment preserved; confirm its document stage before uploading a final revision.' } });
  return history(tx, user, bill.id, 'SEA_BILL_CREATED', body.revisionNote);
}
const invalidate = { internalStatus: 'SEA_UNCHECKED', reviewedContentVersion: null, reviewedAt: null, reviewedById: null, reviewChecks: Prisma.DbNull, releaseStatus: 'SEA_RELEASE_PENDING', releaseMethod: null, releaseReference: null, releaseNote: null, releaseProofId: null, releasedAt: null, releasedById: null };
async function updateBill(tx, user, jobId, id, body) {
  const bill = await getBill(tx, jobId, id, body.version); const job = await mutableJob(tx, jobId);
  const mergedContainers = body.containers === undefined ? bill.containers : Array.isArray(body.containers) ? body.containers.map(row=>({...(bill.containers||[]).find(old=>old.number===String(row?.number||'').trim().toUpperCase()),...row})) : body.containers;
  const fields = metadata({ ...bill, ...body, containers:mergedContainers }, body.containers ?? [], bill.registerData?.containers || []); const allocations = await allocationData(tx, job, bill.shipmentId, bill.id, body.allocations ?? bill.allocations);
  const identity = await registerIdentity(tx, fields.billNumber, bill);
  if(body.containers!==undefined)await require('./driverOperations').assertBillChange(tx,bill,require('./blRegister').normalize({containers:body.containers},bill).containers);
  const registerData = body.containers !== undefined && Array.isArray(bill.registerData?.containers)
    ? { ...bill.registerData, containers: require('./blRegister').normalize({ containers: body.containers }, { ...bill, containers: fields.containers }).containers }
    : undefined;
  const changed = !isDeepStrictEqual(contentSnapshot(bill), contentSnapshot({ ...fields, shipment:bill.shipment, allocations })) || fields.reviewIssues !== bill.reviewIssues;
  const note = text(body.revisionNote, 'Revision note', 2000, !bill.approvedSnapshot || !changed);
  await tx.seaBillCargo.deleteMany({ where: { billId: id } });
  await tx.seaBill.update({ where: { id }, data: { ...fields, registerIdentity: identity, ...(registerData ? { registerData: json(registerData) } : {}), version: { increment: 1 }, ...(changed ? invalidate : {}), allocations: { create: allocations } } });
  if (changed) await tx.jobDocument.update({ where: { id: bill.documentId }, data: { status: receipt(bill)==='SEA_NOT_RECEIVED' ? 'PENDING' : 'UPLOADED', verifiedById: null, type: fields.documentKind } });
  return history(tx, user, id, 'SEA_BILL_UPDATED', note);
}
async function attach(tx, user, jobId, id, body, file) {
  const bill = await getBill(tx, jobId, id, body.version);
  fail(!bill.archivedAt&&!bill.registerData?.archivedAt, 'Archived register records are read-only', 409);
  const category = choice(body.category, ['DRAFT','FINAL','RELEASE','DELIVERY_ORDER','PACKING_LIST','INTERNAL_PACKING_LIST','PACKING_HEADER','RECEIVING_REPORT','INVOICE','MANIFEST','WAYBILL','POD','TAX_INVOICE','PPH23_CERTIFICATE','DRIVER_BON','PAYMENT_PROOF','SUPPORTING'], 'Sea attachment category');
  const referenceRequired=['DELIVERY_ORDER','RECEIVING_REPORT'].includes(category);
  const externalNumber = text(body.externalNumber, 'Document number', 100, !referenceRequired);
  const documentDate = date(body.documentDate, !referenceRequired);
  if(category==='RECEIVING_REPORT')require('./registerFields').calendarDate(body.documentDate,'Tanggal Berita Acara');
  const resets = ['DRAFT','FINAL'].includes(category);
  fail(body.materialChange===undefined || [true,false,'true','false'].includes(body.materialChange), 'Material change flag is invalid');
  const materialChange=body.materialChange===true || body.materialChange==='true';
  fail(!materialChange || resets, 'Report material changes on a BL draft or final document');
  const note = text(body.note, 'Revision note', 2000, !materialChange);
  const contentVersion=resets && bill.files.some(row=>['DRAFT','FINAL'].includes(row.category)) ? bill.contentVersion+1 : bill.contentVersion;
  const uploaded = await tx.seaBillFile.create({ data: { billId: id, category, contentVersion, filename: file.filename, originalName: text(file.originalname, 'Filename', 255), mimeType: file.mimetype, size: file.size, externalNumber, documentDate, note, uploadedById: user.id } });
  if(category==='INTERNAL_PACKING_LIST')await tx.seaBill.update({where:{id},data:{registerData:{...bill.registerData,internalPackingList:{filename:uploaded.filename,sourceType:'UPLOADED',number:externalNumber||uploaded.originalName}}}});
  await tx.seaBill.update({ where: { id }, data: { version: { increment: 1 }, ...(resets ? { ...invalidate, contentVersion, registerData: { ...(bill.registerData || {}), documentState: { ...(bill.registerData?.documentState || {}), blMissing: false } } } : {}), ...(materialChange ? { reviewIssues: note } : {}) } });
  if (resets) await tx.jobDocument.update({ where: { id: bill.documentId }, data: { filename: uploaded.filename, originalName: uploaded.originalName, mimeType: uploaded.mimeType, size: uploaded.size, uploadedById: user.id, status: 'UPLOADED', verifiedById: null } });
  return history(tx, user, id, 'SEA_FILE_UPLOADED', note);
}
const checkKeys = ['parties','route','containers','cargo','finalDocument'];
async function verification(tx, jobId, id, body) {
  const bill = await getBill(tx, jobId, id, body.version);
  fail(receipt(bill) === 'SEA_FINAL_RECEIVED', 'Upload a final document for the current cargo revision', 409);
  fail(bill.allocations.length, 'Link the packing lists or cargo portions covered by this BL', 409);
  fail(body.checks && checkKeys.every(key=>body.checks[key] === true), 'Confirm all five BL checks before verification');
  const job = await mutableJob(tx, jobId);
  await allocationData(tx, job, bill.shipmentId, id, bill.allocations);
  // A changed packing list must first be explicitly reselected/saved, even when
  // the director is reviewing another discrepancy. This refreshes its snapshot.
  fail(!issues(bill).includes('SEA_PACKING_CHANGED'), 'Packing list changed; review and save the cargo links again', 409);
  return { bill, checks: Object.fromEntries(checkKeys.map(key=>[key,true])), issues: issues(bill) };
}
async function markMatched(tx, user, prepared, note, action = 'SEA_BILL_VERIFIED') {
  const { bill, checks } = prepared;
  await tx.seaBill.update({ where: { id: bill.id }, data: { internalStatus: 'SEA_MATCHED', reviewedContentVersion: bill.contentVersion, reviewedAt: new Date(), reviewedById: user.id, reviewChecks: checks, approvedSnapshot: contentSnapshot(bill), version: { increment: 1 } } });
  await tx.jobDocument.update({ where: { id: bill.documentId }, data: { status: 'VERIFIED', verifiedById: user.id } });
  return history(tx, user, bill.id, action, note);
}
async function verify(tx, user, jobId, id, body) {
  const prepared = await verification(tx, jobId, id, body); fail(!prepared.issues.length, 'Submit BL discrepancies or material changes for director approval', 403);
  return markMatched(tx, user, prepared, body.note);
}
async function correction(tx, user, jobId, id, body) {
  const bill = await getBill(tx, jobId, id, body.version); const note = text(body.note, 'Correction explanation', 2000);
  await tx.seaBill.update({ where: { id }, data: { ...invalidate, internalStatus: 'SEA_CORRECTION', reviewIssues: note, version: { increment: 1 } } });
  await tx.jobDocument.update({ where: { id: bill.documentId }, data: { status: 'UPLOADED', verifiedById: null } });
  return history(tx, user, id, 'SEA_BILL_CORRECTION', note);
}
async function confirmRelease(tx, user, jobId, id, body) {
  const bill = await getBill(tx, jobId, id, body.version);
  fail(bill.internalStatus === 'SEA_MATCHED' && bill.reviewedContentVersion === bill.contentVersion && !issues(bill).includes('SEA_PACKING_CHANGED'), 'Verify the current BL internally before recording carrier release', 409);
  const proof = bill.files.find(file=>file.id===body.proofId && ['RELEASE','DELIVERY_ORDER'].includes(file.category) && file.contentVersion===bill.contentVersion);
  fail(proof, 'Attach carrier release evidence or a delivery order for this revision', 409);
  const releasedAt = date(body.releasedAt); fail(releasedAt.getTime() <= Date.now()+60000, 'Carrier release date cannot be in the future');
  await tx.seaBill.update({ where: { id }, data: { releaseStatus: 'SEA_RELEASE_CONFIRMED', releaseMethod: choice(body.method, ['ORIGINAL_SURRENDER','TELEX','SEA_WAYBILL','ELECTRONIC','OTHER'], 'Release method'), releaseReference: text(body.reference, 'Carrier confirmation reference', 200), releaseNote: text(body.note, 'Carrier confirmation note', 2000), releaseProofId: proof.id, releasedAt, releasedById: user.id, version: { increment: 1 } } });
  return history(tx, user, id, 'SEA_RELEASE_RECORDED', body.note);
}
function checkSeaClosure(job) {
  const legs=(job.shipments || []).filter(leg=>leg.mode==='SEA'&&leg.status!=='CANCELLED');
  const bills = (job.seaBills || []).filter(bill=>legs.some(leg=>leg.id===bill.shipmentId));
  fail(legs.every(leg=>bills.some(bill=>bill.shipmentId===leg.id)), 'Record a sea document for every active sea transport leg',409);
  for (const bill of bills) {
    if (bill.registerNumber || bill.registerData?.containers?.length) {
      const operational=require('./blRegister').normalize({},bill).containers;
      fail(operational.every(row=>row.status==='EMPTY_RETURNED' && row.emptyReturnedAt), 'Return every registered container with an empty-return date before closing',409);
    }
    fail(bill.internalStatus==='SEA_MATCHED' && bill.reviewedContentVersion===bill.contentVersion && !issues(bill).includes('SEA_PACKING_CHANGED'), 'Verify current sea documents and packing links before closing', 409);
    if (job.jobType==='RECEIVER') fail(bill.releaseStatus==='SEA_RELEASE_CONFIRMED' && bill.releaseProofId, 'Record carrier release evidence for receiving sea shipments before closing', 409);
  }
}
async function transportChanged(tx,user,before,after) {
  const keys=['mode','carrierId','originCity','destCity','vesselFlight','containerNumber','sealNumber'];
  const active=after.mode==='SEA'&&after.status!=='CANCELLED';
  const bills=await tx.seaBill.findMany({where:{shipmentId:after.id}});
  if(active&&!bills.length) await createBill(tx,user,after.jobId,{shipmentId:after.id},true);
  if(keys.some(key=>before[key]!==after[key]) || before.status!==after.status&&[before.status,after.status].includes('CANCELLED')) {
    for(const bill of bills) {
      await tx.seaBill.update({where:{id:bill.id},data:{...invalidate,contentVersion:{increment:1},version:{increment:1}}});
      await tx.jobDocument.update({where:{id:bill.documentId},data:{required:active,status:'PENDING',verifiedById:null}});
      await history(tx,user,bill.id,'SEA_TRANSPORT_CHANGED','Transport details changed; check the BL and release evidence again.');
    }
  }
}
module.exports = { registerIdentity, operational, historicalOperational, STATUSES, seaInclude, CARGO_SELECT, metadata, declared, contentSnapshot, allocationData, issues, present, receipt, getBill, history, createBill, updateBill, attach, verification, markMatched, verify, correction, confirmRelease, checkSeaClosure, checkKeys, transportChanged };

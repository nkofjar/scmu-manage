const { Prisma } = require('@prisma/client');
const { STAFF, fail, text, audit } = require('./jpt');
const sea = require('./seaBills');
const files = require('./jobFiles');
const workspace = require('./blWorkspace');

const include = { ...sea.seaInclude, document: true, allocations: { include: { packingList: { include: { document: true } } } } };
async function get(tx, id) {
  const bill = await tx.seaBill.findUnique({ where: { id }, include });
  fail(bill, 'Pengiriman tidak ditemukan.', 404); return require('./documentScope').annotate(tx,bill);
}
function linkedFiles(bill) {
  const rows = (bill.files || []).map(file => ({ ...file, source: 'ATTACHMENT' }));
  if (bill.document?.filename && !rows.some(row => row.filename === bill.document.filename)) rows.push({ ...bill.document, category: 'FINAL', source: 'LEGACY_BL' });
  for (const allocation of bill.allocations || []) {
    const doc = allocation.packingList?.document;
    if (doc?.filename && !rows.some(row => row.id === doc.id || row.filename === doc.filename)) rows.push({ ...doc, category: 'PACKING_LIST', source: 'LINKED_PACKING', packingListId: allocation.packingListId });
  }
  return rows.map(file => file.scope ? file : require('./documentScope').metadata(bill,file));
}
const publicFile = file => Object.fromEntries(['id', 'category', 'source', 'originalName', 'mimeType', 'size', 'contentVersion', 'note', 'createdAt', 'uploadedById', 'packingListId','externalNumber','documentDate','scope','readOnly','mappingWarning'].map(key => [key, file[key]]));
function availability(bill) {
  const rows = linkedFiles(bill); const has = category => rows.some(file => file.category === category);
  return { billOfLading: !bill.registerData?.documentState?.blMissing && rows.some(f => ['DRAFT', 'FINAL', 'LEGACY'].includes(f.category)), packingList: has('PACKING_LIST')||require('./internalPacking').ready(bill), supporting: has('SUPPORTING'), internalPackingList: require('./internalPacking').ready(bill), fieldInspection:require('./packingFieldChecks').status(bill), receivingReport:has('RECEIVING_REPORT'), packingHeader: has('PACKING_HEADER'), invoice: has('INVOICE'), deliveryOrder: has('DELIVERY_ORDER'), taxInvoice: has('TAX_INVOICE'), pph23Certificate: has('PPH23_CERTIFICATE') };
}

async function remove(tx, user, id, fileId, body) {
  fail(STAFF.includes(user?.role), 'Hanya Admin dan Super Admin yang dapat menghapus lampiran.', 403);
  const bill = await get(tx, id); await sea.getBill(tx, bill.jobId, id, body.version);
  const reason = text(body.reason, 'Alasan penghapusan', 2000);
  const selected = linkedFiles(bill).find(row => row.id === fileId);
  fail(selected, 'Lampiran tidak ditemukan pada pengiriman ini.', 404);
  fail(!linkedFiles(bill).some(file => file.filename === selected.filename && file.scope?.type === 'VOYAGE'), 'Rekap voyage hanya referensi. Kelola dokumen pada pengiriman induk.', 409);
  files.filePath(selected.filename); // Validate the server-owned basename before queuing disk cleanup.
  const aliases = (bill.files || []).filter(f => f.filename === selected.filename);
  const linkedPackings = (bill.allocations || []).filter(a => a.packingList?.document?.filename === selected.filename);
  const removedIds = new Set([fileId, ...aliases.map(f => f.id), ...linkedPackings.map(a => a.packingList.document.id)]);
  if(bill.journeyId){const parent=await tx.shippingJourney.findUnique({where:{id:bill.journeyId}});if(parent){const ops=require('./driverOperations');fail(![...removedIds].some(id=>ops.references(ops.state(parent),id)),'Lampiran masih digunakan sebagai bukti pekerjaan atau pembayaran sopir.',409);}}
  const categories = new Set([selected.category, ...aliases.map(f => f.category)]);
  const linkedPacking = selected.source === 'LINKED_PACKING' || linkedPackings.length > 0;
  const activeBL = selected.source === 'LEGACY_BL' || bill.document?.filename === selected.filename || aliases.some(f => ['DRAFT', 'FINAL'].includes(f.category) && f.contentVersion === bill.contentVersion);
  const packingSource = linkedPacking || categories.has('PACKING_LIST') || categories.has('INTERNAL_PACKING_LIST');
  const operational = structuredClone(workspace.operationalOf(bill));
  const packing = operational.packing;
  const report=structuredClone(bill.registerData?.receivingReport||{});
  const manual=structuredClone(bill.registerData?.manualPacking||{});
  const manualSource=Boolean(manual.sourceFileIds?.some(value=>removedIds.has(value))||manual.groups?.some(g=>removedIds.has(g.sourceFileId)));
  if(manualSource){manual.status='DRAFT';manual.sourceFileIds=(manual.sourceFileIds||[]).filter(value=>!removedIds.has(value));manual.groups=(manual.groups||[]).map(g=>removedIds.has(g.sourceFileId)?{...g,sourceFileId:null}:g);}
  const reportSource=Boolean(report.sourceFileIds?.some(value=>removedIds.has(value))||report.groups?.some(g=>removedIds.has(g.sourceFileId)));
  if(reportSource){report.status='DRAFT';report.sourceFileIds=report.sourceFileIds.filter(value=>!removedIds.has(value));report.groups=report.groups.map(g=>removedIds.has(g.sourceFileId)?{...g,sourceFileId:null}:g);}
  const transcribed = packing.sourceFileIds.some(value => removedIds.has(value)) || packing.groups.some(g => removedIds.has(g.sourceFileId));
  const evidence = operational.unloading.evidenceFileIds.some(value => removedIds.has(value));
  const fieldInspection=bill.registerData?.packingFieldCheck;
  const removedFieldEvidence=fieldInspection?.evidenceFileIds?.some(value=>removedIds.has(value));
  const partnerPackingSummaries=Object.fromEntries(Object.entries(bill.registerData?.partnerPackingSummaries||{}).filter(([key])=>!removedIds.has(key)));
  const affectedBonIds=[];
  const driverBons=(bill.registerData?.driverBons||[]).map(bon=>{
    if(!bon.evidenceFileIds?.some(value=>removedIds.has(value)))return bon;
    affectedBonIds.push(bon.id);
    return {...bon,evidenceFileIds:bon.evidenceFileIds.filter(value=>!removedIds.has(value)),evidenceNotice:'Lampiran bonrate sebelumnya dihapus. Periksa riwayat penghapusan dokumen.',updatedAt:new Date().toISOString(),updatedById:user.id,updatedByName:user.name||user.id};
  });
  if (transcribed) {
    packing.sourceFileIds = packing.sourceFileIds.filter(value => !removedIds.has(value));
    packing.groups = packing.groups.map(group => removedIds.has(group.sourceFileId) ? { ...group, sourceFileId: null } : group);
    packing.status = 'DRAFT';
  }
  operational.unloading.evidenceFileIds = operational.unloading.evidenceFileIds.filter(value => !removedIds.has(value));
  if (activeBL || packingSource || transcribed || reportSource || manualSource || categories.has('PACKING_HEADER')) packing.headerStatus = 'DRAFT';
  if (activeBL && packing.groups.length) packing.status = 'DRAFT';

  if (aliases.length) await tx.seaBillFile.deleteMany({ where: { billId: id, id: { in: aliases.map(f => f.id) } } });
  if (linkedPacking) await tx.seaBillCargo.deleteMany({ where: { billId: id, packingListId: { in: linkedPackings.map(a => a.packingListId) } } });
  if (bill.document?.filename === selected.filename) await tx.jobDocument.update({ where: { id: bill.documentId }, data: { filename: null, originalName: null, mimeType: null, size: null, uploadedById: null, status: 'PENDING', verifiedById: null } });
  const resetReview = activeBL || packingSource || transcribed || reportSource || manualSource;
  if(resetReview)await require('./packingRecap').invalidateShared(tx,user,bill);
  const resetRelease = resetReview || removedIds.has(bill.releaseProofId);
  const affectedHeaderBills = [];
  const currentHeader = (bill.files || []).find(f => f.category === 'PACKING_HEADER');
  if (resetReview && currentHeader) {
    const shared = await tx.seaBillFile.findMany({ where: { category: 'PACKING_HEADER', filename: currentHeader.filename, billId: { not: id } }, select: { billId: true } });
    for (const relatedId of [...new Set(shared.map(row => row.billId))].sort()) {
      const related = await tx.seaBill.findUnique({ where: { id: relatedId }, select: { id: true, jobId: true, registerData: true, files: { where: { category: 'PACKING_HEADER' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } } });
      if (!related || related.files[0]?.filename !== currentHeader.filename || related.registerData?.operational?.packing?.headerStatus === 'DRAFT') continue;
      const derived = workspace.operationalOf(related); derived.packing.headerStatus = 'DRAFT';
      await tx.seaBill.update({ where: { id: relatedId }, data: { registerData: { ...related.registerData, operational: derived }, version: { increment: 1 } } });
      await audit(tx, user, 'PACKING_HEADER_SOURCE_REMOVED', 'JobOrder', related.jobId, { seaBillId: relatedId, sourceBillId: id, sourceFileId: fileId, originalName: selected.originalName, reason });
      affectedHeaderBills.push(relatedId);
    }
  }
  const registerData = { ...bill.registerData, ...(bill.registerData?.partnerPackingSummaries?{partnerPackingSummaries}:{}), ...(affectedBonIds.length?{driverBons}:{}), ...(reportSource?{receivingReport:report}:{}),...(manualSource?{manualPacking:manual}:{}),...(removedFieldEvidence?{packingFieldCheck:{...fieldInspection,status:'DRAFT',evidenceFileIds:fieldInspection.evidenceFileIds.filter(value=>!removedIds.has(value))}}:{}), operational, documentState: { ...(bill.registerData?.documentState || {}), revision: (bill.registerData?.documentState?.revision || 0) + 1, ...(activeBL ? { blMissing: true } : {}) } };
  await tx.seaBill.update({ where: { id }, data: {
    registerData, version: { increment: 1 }, ...(activeBL ? { contentVersion: { increment: 1 } } : {}),
    ...(resetReview ? { internalStatus: 'SEA_UNCHECKED', reviewedContentVersion: null, reviewedAt: null, reviewedById: null, reviewChecks: Prisma.DbNull, approvedSnapshot: Prisma.DbNull } : {}),
    ...(resetRelease ? { releaseStatus: 'SEA_RELEASE_PENDING', releaseMethod: null, releaseReference: null, releaseNote: null, releaseProofId: null, releasedAt: null, releasedById: null } : {}),
  } });
  if (resetReview && bill.document?.filename !== selected.filename) await tx.jobDocument.update({ where: { id: bill.documentId }, data: { status: bill.document?.filename ? 'UPLOADED' : 'PENDING', verifiedById: null } });
  // Persist cleanup intent in the same transaction; retrying cleanup never deletes a referenced file.
  await tx.documentFilePurge.upsert({ where: { filename: selected.filename }, create: { filename: selected.filename }, update: { requestedAt: new Date() } });
  await sea.history(tx, user, id, 'SHIPMENT_FILE_DELETED', reason, { fileId, removedFileIds: [...removedIds], originalName: selected.originalName, category: selected.category, reason, resetReview, resetRelease, retainedPackingGroups: transcribed, detachedLegacySource: linkedPacking, removedUnloadingEvidence: evidence, affectedHeaderBills, affectedBonIds });
  return { filename: selected.filename, version: bill.version + 1, resetReview, resetRelease, requiresPackingReview: activeBL || packingSource || transcribed || reportSource || manualSource, detachedLegacySource: linkedPacking };
}
function selectedFiles(bill, ids) {
  fail(Array.isArray(ids) && ids.length > 0 && ids.length <= 1000 && ids.every(id => typeof id === 'string' && id.length > 0), 'Pilih 1 sampai 1000 lampiran.');
  fail(new Set(ids).size === ids.length, 'Pilihan lampiran tidak boleh berulang.');
  const rows = linkedFiles(bill);
  return ids.map(id => { const row = rows.find(file => file.id === id); fail(row, 'Lampiran tidak ditemukan pada pengiriman ini.', 404); return row; });
}
// Called inside one serializable transaction. Validate the entire selection before mutation.
async function removeMany(tx, user, id, body) {
  const bill = await get(tx, id); const selected = selectedFiles(bill, body.fileIds);
  await sea.getBill(tx, bill.jobId, id, body.version);
  const results = []; const filenames = new Set(); let version = bill.version;
  for (const file of selected) {
    if (filenames.has(file.filename)) continue; // Aliases are detached together by remove().
    const result = await remove(tx, user, id, file.id, { version, reason: body.reason });
    filenames.add(file.filename); results.push(result); version = result.version;
  }
  return { results, removedCount: selected.length, version };
}
async function packingSnapshot(tx, id, fileId) {
  const bill = await get(tx, id); const [file] = selectedFiles(bill, [fileId]);
  fail(file.category !== 'INTERNAL_PACKING_RECAP', 'Rekap voyage hanya referensi, bukan Packing List B/L ini.', 409);
  fail(file.category === 'INTERNAL_PACKING_LIST', 'Pilih Packing List internal yang dibuat sistem.');
  const log = await tx.activityLog.findFirst({ where: { entity: 'JobOrder', entityId: bill.jobId, action: 'INTERNAL_PACKING_LIST_CREATED', metadata: { path: ['fileId'], equals: fileId } }, select: { metadata: true }, orderBy: { createdAt: 'desc' } });
  fail(log?.metadata?.seaBillId === id && log.metadata.snapshot, 'Data cetak lampiran ini tidak tersedia. Buka Kelola Packing List untuk membuat dokumen PDF dan Excel.');
  return log.metadata.snapshot; // Print the selected historical document, never today's replacement data.
}
module.exports = { get, linkedFiles, publicFile, availability, remove, removeMany, selectedFiles, packingSnapshot };

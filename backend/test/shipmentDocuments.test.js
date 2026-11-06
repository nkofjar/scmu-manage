const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const sea = require('../src/services/seaBills');
const documents = require('../src/services/shipmentDocuments');
const workspace = require('../src/services/blWorkspace');
const jobFiles = require('../src/services/jobFiles');
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const operational = workspace.defaultOperational(); operational.packing.headerStatus = 'READY';
  const state = { bill: { ...sea.metadata({ billNumber: 'BL-TEST', containers: [{ number: 'TEST0000001', seal: '001' }] }), id: 'bill', jobId: 'job', documentId: 'doc', version: 1, contentVersion: 3, internalStatus: 'SEA_MATCHED', reviewedContentVersion: 3, releaseStatus: 'SEA_RELEASE_CONFIRMED', releaseProofId: 'proof', registerData: { operational }, shipment: { mode: 'SEA', status: 'PENDING' }, files: [{ id: 'current', category: 'FINAL', filename: 'current.pdf', originalName: 'Wrong BL.pdf', contentVersion: 3 }, { id: 'old', category: 'FINAL', filename: 'old.pdf', originalName: 'Old BL.pdf', contentVersion: 2 }], allocations: [] }, doc: { id: 'doc', filename: 'current.pdf', originalName: 'Wrong BL.pdf', status: 'VERIFIED' }, audit: [], history: [], queue: [], status: 'IN_PROGRESS' };
  const read = () => clone({ ...state.bill, document: state.doc });
  const tx = {
    seaBill: { findUnique: async () => read(), findFirst: async () => read(), update: async ({ data }) => { for (const [key, value] of Object.entries(data)) state.bill[key] = value === Prisma.DbNull ? null : value?.increment !== undefined ? state.bill[key] + value.increment : value; return read(); } },
    jobOrder: { findUnique: async () => ({ id: 'job', status: state.status }) },
    seaBillFile: { deleteMany: async ({ where }) => { state.bill.files = state.bill.files.filter(file => !where.id.in.includes(file.id)); } },
    seaBillCargo: { deleteMany: async ({ where }) => { state.bill.allocations = state.bill.allocations.filter(a => !where.packingListId.in.includes(a.packingListId)); } },
    jobDocument: { update: async ({ data }) => Object.assign(state.doc, data) },
    activityLog: { create: async ({ data }) => state.audit.push(data) }, seaBillRevision: { create: async ({ data }) => state.history.push(data) },
    documentFilePurge: { upsert: async ({ create }) => state.queue.push(create) },
  };
  return { state, tx };
}
const user = { id: 'admin', role: 'ADMIN' };
const body = { version: 1, reason: 'Salah memilih file' };
test('batch deletion validates the complete selection and chains versions inside one transaction', async () => {
  const {state,tx}=fixture();
  await assert.rejects(documents.removeMany(tx,user,'bill',{...body,fileIds:['current','foreign']}));
  assert.equal(state.bill.version,1);assert.equal(state.bill.files.length,2);
  await assert.rejects(documents.removeMany(tx,user,'bill',{...body,fileIds:['current','current']}));
  const result=await documents.removeMany(tx,user,'bill',{...body,fileIds:['old','current']});
  assert.equal(result.removedCount,2);assert.equal(result.version,3);assert.equal(state.bill.files.length,0);
  assert.equal(state.audit.length,2);assert.equal(state.queue.length,2);
});
test('batch aliases are removed once and printing uses the selected file snapshot, never current source', async () => {
  const {state,tx}=fixture();state.bill.files.push({id:'alias',category:'SUPPORTING',filename:'old.pdf'});
  const result=await documents.removeMany(tx,user,'bill',{...body,fileIds:['old','alias']});
  assert.equal(result.results.length,1);assert.equal(state.bill.version,2);
  state.bill.files.push({id:'generated',category:'INTERNAL_PACKING_LIST',filename:'generated.xlsx'});
  const snapshot={billNumber:'HISTORICAL',documentNumber:'PL-OLD',groups:[]};
  tx.activityLog.findFirst=async({where})=>{assert.equal(where.entityId,'job');assert.equal(where.metadata.equals,'generated');return {metadata:{seaBillId:'bill',snapshot}};};
  assert.deepEqual(await documents.packingSnapshot(tx,'bill','generated'),snapshot);
  await assert.rejects(documents.packingSnapshot(tx,'bill','foreign'));
  await assert.rejects(documents.packingSnapshot(tx,'bill','current'));
  tx.activityLog.findFirst=async()=>({metadata:{seaBillId:'foreign',snapshot}});
  await assert.rejects(documents.packingSnapshot(tx,'bill','generated'));
});
test('a selected-bill packing recap can be detached without treating it as voyage output',async()=>{
  const {state,tx}=fixture();
  state.bill.files.push({id:'recap',category:'INTERNAL_PACKING_RECAP',filename:'selected-recap.xlsx'});
  state.bill.registerData.internalRecap={filename:'selected-recap.xlsx',valid:true};
  const result=await documents.remove(tx,user,'bill','recap',body);
  assert.equal(result.version,2);
  assert(!state.bill.files.some(file=>file.id==='recap'));
  assert.equal(state.bill.internalStatus,'SEA_MATCHED');
  assert.deepEqual(state.queue,[{filename:'selected-recap.xlsx'}]);
});

test('deleting the active BL removes only its attachment, invalidates checks and never promotes an old BL', async () => {
  const { state, tx } = fixture();
  const result = await documents.remove(tx, user, 'bill', 'current', body);
  assert.equal(result.version, 2); assert.equal(state.bill.version, 2); assert.equal(state.bill.contentVersion, 4);
  assert.equal(state.bill.files.length, 1); assert.equal(state.bill.files[0].id, 'old'); assert.equal(state.doc.filename, null);
  assert.equal(documents.availability({ ...state.bill, document: state.doc }).billOfLading, false);
  assert.equal(state.bill.internalStatus, 'SEA_UNCHECKED'); assert.equal(state.bill.releaseStatus, 'SEA_RELEASE_PENDING');
  assert.equal(state.bill.registerData.operational.packing.headerStatus, 'DRAFT'); assert.equal(state.bill.containers.length, 1);
  assert.deepEqual(state.queue, [{ filename: 'current.pdf' }]); assert.equal(state.audit.length, 1);
  assert.equal(state.audit[0].metadata.originalName, 'Wrong BL.pdf'); assert.equal(state.audit[0].metadata.reason, body.reason); assert.equal(state.audit[0].userId, 'admin');
  assert.equal(state.history[0].action, 'SHIPMENT_FILE_DELETED');
});
test('deleting an old BL version preserves current verification, release and current file', async () => {
  const { state, tx } = fixture(); await documents.remove(tx, user, 'bill', 'old', body);
  assert.equal(state.doc.filename, 'current.pdf'); assert.equal(state.bill.contentVersion, 3); assert.equal(state.bill.internalStatus, 'SEA_MATCHED');
  assert.equal(state.bill.releaseStatus, 'SEA_RELEASE_CONFIRMED'); assert.equal(state.bill.registerData.operational.packing.headerStatus, 'READY');
  assert.equal(documents.availability({ ...state.bill, document: state.doc }).billOfLading, true);
});
test('removing a Packing List source keeps transcribed item data but clears source links and requires another review', async () => {
  const { state, tx } = fixture(); state.bill.files.push({ id: 'source', category: 'PACKING_LIST', filename: 'source.xlsx', originalName: 'Source.xlsx' });
  const packing = state.bill.registerData.operational.packing; packing.sourceFileIds = ['source']; packing.status = 'CONFIRMED'; packing.groups = [{ id: 'group', sourceFileId: 'source', recipientName: 'Penerima', items: [{ description: 'Muatan', packages: 5 }] }];
  await documents.remove(tx, user, 'bill', 'source', body);
  const after = state.bill.registerData.operational.packing; assert.equal(after.status, 'DRAFT'); assert.equal(after.headerStatus, 'DRAFT'); assert.equal(after.groups[0].sourceFileId, null); assert.equal(after.groups[0].items[0].packages, 5); assert.deepEqual(after.sourceFileIds, []);
  assert.equal(state.doc.filename, 'current.pdf'); assert.equal(state.bill.contentVersion, 3); assert.equal(state.bill.internalStatus, 'SEA_UNCHECKED');
});
test('legacy BL deletion clears its file pointer while retaining its required document record', async () => {
  const { state, tx } = fixture(); state.bill.files = [];
  await documents.remove(tx, user, 'bill', 'doc', body);
  assert.equal(state.doc.id, 'doc'); assert.equal(state.doc.filename, null); assert.equal(documents.linkedFiles({ ...state.bill, document: state.doc }).length, 0);
});

test('deleting a partner original removes only its quick summary and keeps other summaries',async()=>{
 const {state,tx}=fixture();state.bill.files.push({id:'summary-source',category:'PACKING_LIST',filename:'source-summary.xlsx'});state.bill.registerData.partnerPackingSummaries={'summary-source':{summary:{rows:[]}},other:{summary:{rows:[{containerNumber:'KEEP'}]}}};
 await documents.remove(tx,user,'bill','summary-source',body);assert.equal(state.bill.registerData.partnerPackingSummaries['summary-source'],undefined);assert.equal(state.bill.registerData.partnerPackingSummaries.other.summary.rows[0].containerNumber,'KEEP');
});

test('removing a voucher attachment preserves assignment and payment records with an audit notice', async()=>{
 const {state,tx}=fixture();state.bill.files.push({id:'bon-file',category:'DRIVER_BON',filename:'bon.txt'});state.bill.registerData.driverBons=[{id:'bon',number:'BON-1',status:'COMPLETED',paymentStatus:'PAID',amount:'100.00',evidenceFileIds:['bon-file']}];
 await documents.remove(tx,user,'bill','bon-file',body);const bon=state.bill.registerData.driverBons[0];assert.deepEqual(bon.evidenceFileIds,[]);assert.equal(bon.status,'COMPLETED');assert.equal(bon.paymentStatus,'PAID');assert.equal(bon.amount,'100.00');assert.match(bon.evidenceNotice,/dihapus/);assert.deepEqual(state.audit[0].metadata.affectedBonIds,['bon']);
});

test('removing optional manual evidence retains the entered cargo and requires review again', async () => {
  const {state,tx}=fixture();state.bill.files.push({id:'evidence',category:'SUPPORTING',filename:'evidence.txt',originalName:'Catatan.txt'});
  state.bill.registerData.manualPacking={status:'CONFIRMED',basis:'Catatan admin',sourceFileIds:['evidence'],groups:[{id:'g',sourceFileId:'evidence',recipientName:'Toko',items:[{description:'Muatan',packages:98}]}]};
  await documents.remove(tx,user,'bill','evidence',body);
  const manual=state.bill.registerData.manualPacking;
  assert.equal(manual.status,'DRAFT');assert.deepEqual(manual.sourceFileIds,[]);assert.equal(manual.groups[0].sourceFileId,null);assert.equal(manual.groups[0].items[0].packages,98);assert.equal(manual.basis,'Catatan admin');
  assert.equal(state.bill.registerData.operational.packing.headerStatus,'DRAFT');assert.equal(state.bill.internalStatus,'SEA_UNCHECKED');assert.equal(state.bill.releaseStatus,'SEA_RELEASE_PENDING');assert.equal(state.doc.filename,'current.pdf');
});
test('deleting a source also marks a currently shared Packing Header on another shipment for review', async () => {
  const { state, tx } = fixture(); state.bill.files.unshift({ id: 'header-a', category: 'PACKING_HEADER', filename: 'shared.xlsx' });
  const related = { id: 'other', jobId: 'other-job', version: 5, registerData: { operational: workspace.defaultOperational() }, files: [{ filename: 'shared.xlsx' }] }; related.registerData.operational.packing.headerStatus = 'READY';
  const find = tx.seaBill.findUnique; const update = tx.seaBill.update;
  tx.seaBillFile.findMany = async () => [{ billId: 'other' }];
  tx.seaBill.findUnique = async query => query.where.id === 'other' ? clone(related) : find(query);
  tx.seaBill.update = async query => query.where.id === 'other' ? Object.assign(related, { registerData: query.data.registerData, version: related.version + 1 }) : update(query);
  await documents.remove(tx, user, 'bill', 'current', body);
  assert.equal(related.registerData.operational.packing.headerStatus,'DRAFT'); assert.equal(related.version,6);
  assert(state.audit.some(row=>row.action==='PACKING_HEADER_SOURCE_REMOVED'&&row.entityId==='other-job'));
});
test('a legacy linked packing original is detached only from this BL, including hidden attachment aliases', async () => {
  const { state, tx } = fixture(); const original = { id: 'packing-doc', filename: 'source.pdf', originalName: 'Original PL.pdf' };
  state.bill.files.push({ id: 'alias', filename: 'source.pdf', originalName: 'Original PL.pdf', category: 'PACKING_LIST' });
  state.bill.allocations = [{ packingListId: 'packing', packingList: { document: original } }];
  await documents.remove(tx, user, 'bill', 'alias', body);
  assert.equal(state.bill.allocations.length, 0); assert.equal(original.filename, 'source.pdf');
  assert(!documents.linkedFiles({ ...state.bill, document: state.doc }).some(f => f.filename === 'source.pdf'));
});
test('release evidence deletion resets release only; deleting a generated header preserves BL verification', async () => {
  for (const [id, category] of [['proof', 'SUPPORTING'], ['head', 'PACKING_HEADER']]) {
    const { state, tx } = fixture(); state.bill.files.push({ id, category, filename: id + '.pdf', originalName: id + '.pdf' });
    await documents.remove(tx, user, 'bill', id, body); assert.equal(state.bill.internalStatus, 'SEA_MATCHED');
    assert.equal(state.bill.releaseStatus, id === 'proof' ? 'SEA_RELEASE_PENDING' : 'SEA_RELEASE_CONFIRMED');
    assert.equal(state.bill.registerData.operational.packing.headerStatus, id === 'head' ? 'DRAFT' : 'READY');
  }
});
test('foreign roles, stale versions, closed/archived records, missing files and empty reasons do not mutate data', async () => {
  for (const scenario of ['role', 'version', 'closed', 'archived', 'file', 'reason']) {
    const { state, tx } = fixture(); if (scenario === 'closed') state.status = 'CLOSED'; if (scenario === 'archived') state.bill.archivedAt = '2026-10-27';
    await assert.rejects(documents.remove(tx, scenario === 'role' ? { ...user, role: 'CUSTOMER' } : user, 'bill', scenario === 'file' ? 'foreign' : 'current', { ...body, ...(scenario === 'version' ? { version: 99 } : {}), ...(scenario === 'reason' ? { reason: '' } : {}) }));
    assert.equal(state.bill.files.length, 2); assert.equal(state.bill.version, 1); assert.equal(state.audit.length, 0); assert.equal(state.queue.length, 0);
  }
});
test('physical purge retains shared files, removes the final reference, and retries failed cleanup durably', async () => {
  const prisma = require('../src/prisma'); const purge = require('../src/services/documentFilePurge').purge;
  const filename = randomUUID() + '.pdf';
  const prior = { transaction: prisma.$transaction, updateMany: prisma.documentFilePurge.updateMany, unlink: fs.unlink };
  let references = 1; let queued = true; let attempts = 0; let exists = true;
  const unlink = async target => { assert.equal(target,jobFiles.filePath(filename)); exists=false; };
  const tx = { documentFilePurge: { findUnique: async () => queued ? { filename } : null, delete: async () => { queued = false; } }, seaBillFile: { count: async () => references }, jobDocument: { count: async () => 0 } };
  prisma.$transaction = async fn => fn(tx); prisma.documentFilePurge.updateMany = async () => { attempts++; };
  try {
    fs.unlink=unlink;
    assert.equal((await purge(filename)).sharedFileRetained, true); assert.equal(exists,true);
    references = 0; queued = true; fs.unlink = async () => { throw Object.assign(new Error('locked'), { code: 'EACCES' }); };
    assert.equal((await purge(filename)).cleanupPending, true); assert.equal(queued, true); assert.equal(attempts, 1);
    fs.unlink = unlink; assert.equal((await purge(filename)).cleanupPending, false); assert.equal(queued, false); assert.equal(exists,false);
  } finally { prisma.$transaction = prior.transaction; prisma.documentFilePurge.updateMany = prior.updateMany; fs.unlink = prior.unlink; }
});

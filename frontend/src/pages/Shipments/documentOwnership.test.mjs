import test from 'node:test';
import assert from 'node:assert/strict';
import {documentOwner,documentOptions,documentVisible,isReceiptReference,availableEvidence,evidenceStatusLabel} from './documentOwnership.mjs';

test('each document has one owning workflow and legacy supporting categories stay accessible',()=>{
 for(const category of ['FINAL','DRAFT','LEGACY','BILL_OF_LADING'])assert.equal(documentOwner(category),'BL');
 for(const category of ['PACKING_LIST','INTERNAL_PACKING_LIST','PACKING_HEADER','INTERNAL_PACKING_RECAP'])assert.equal(documentOwner(category),'PACKING');
 for(const category of ['DELIVERY_RECEIPT','POD','DRIVER_BON'])assert.equal(documentOwner(category),'DRIVER');
 for(const category of ['SUPPORTING','RECEIVING_REPORT','PAYMENT_PROOF','INVOICE','MANIFEST','WAYBILL','RELEASE','CUSTOM_LEGACY'])assert.equal(documentOwner(category),'SUPPORTING');
 assert(!documentOptions('SUPPORTING').some(([category])=>documentOwner(category)!=='SUPPORTING'));
 assert.deepEqual(documentOptions('BL').map(([category])=>category),['DRAFT','FINAL']);
 assert.deepEqual(documentOptions('PACKING').map(([category])=>category),['PACKING_LIST']);
 assert(!documentVisible({category:'PACKING_LIST'},'SUPPORTING'));
 assert(documentVisible({category:'DELIVERY_RECEIPT'},'SUPPORTING'));
 assert(isReceiptReference({category:'POD'},'SUPPORTING'));
 assert(!isReceiptReference({category:'POD'},'PACKING'));
});

test('receipt selection uses a receipt alias once while retaining the primary supporting owner',()=>{
 for(const category of ['POD','DELIVERY_RECEIPT']){
  const file={id:'support',category:'SUPPORTING',evidenceId:'support',evidenceIds:['support','receipt','receipt-2'],evidenceAliases:[{id:'support',category:'SUPPORTING'},{id:'receipt',category},{id:'receipt-2',category:'DELIVERY_RECEIPT'}]};
  const before=structuredClone(file),selected=availableEvidence([file],'edit',[]);
  assert.equal(selected.length,1);assert.equal(selected[0].evidenceId,'receipt');assert.equal(selected[0].id,'support');assert.equal(documentOwner(selected[0].category),'SUPPORTING');assert.deepEqual(file,before);
 }
});

test('payment selection uses only a payment alias for a mixed-category file',()=>{
 const file={id:'bill:support',category:'SUPPORTING',evidenceId:'support',evidenceIds:['support','receipt','payment'],evidenceAliases:[{id:'support',category:'SUPPORTING'},{id:'receipt',category:'POD'},{id:'payment',category:'PAYMENT_PROOF'}]};
 const before=structuredClone(file),selected=availableEvidence([file],'payment',[]);
 assert.equal(selected.length,1);assert.equal(selected[0].evidenceId,'payment');assert.equal(selected[0].category,'SUPPORTING');assert.deepEqual(file,before);
 assert.equal(availableEvidence([{...file,evidenceAliases:file.evidenceAliases.slice(0,2)}],'payment',[]).length,0);
});

test('linked grandfather aliases keep their exact IDs even when a valid new-work alias exists',()=>{
 const file={id:'bill:support',evidenceId:'support',category:'SUPPORTING',evidenceIds:['support','old-packing','receipt','payment'],evidenceAliases:[{id:'support',category:'SUPPORTING'},{id:'old-packing',category:'PACKING_LIST'},{id:'receipt',category:'DELIVERY_RECEIPT'},{id:'payment',category:'PAYMENT_PROOF'}]};
 for(const type of ['edit','payment']){
  const selected=availableEvidence([file],type,['old-packing']);
  assert.equal(selected.length,1);assert.equal(selected[0].evidenceId,'old-packing');assert.equal(selected[0].id,file.id);
 }
 const legacy={id:'legacy',category:'PACKING_LIST',evidenceIds:['raw-primary','linked-legacy']};
 for(const type of ['edit','payment']){
  assert.equal(availableEvidence([legacy],type,[]).length,0);
  assert.equal(availableEvidence([legacy],type,['linked-legacy'])[0].evidenceId,'linked-legacy');
 }
});

test('new work selects receipts only; old aliases and linked legacy evidence are retained without a duplicate selection',()=>{
 const files=[{id:'j1',evidenceId:'j1',evidenceIds:['j1','alias'],category:'DELIVERY_RECEIPT'},{id:'p',evidenceId:'p',category:'PACKING_LIST'},{id:'s',evidenceId:'s',category:'SUPPORTING'},{id:'pay',evidenceId:'pay',category:'PAYMENT_PROOF'},{id:'pod',evidenceId:'pod',category:'POD'}];
 assert.deepEqual(availableEvidence(files,'edit',[]).map(f=>f.id),['j1','pod']);
 assert.deepEqual(availableEvidence(files,'edit',['s','alias']).map(f=>f.id),['j1','s','pod']);
 assert.deepEqual(availableEvidence(files,'payment',[]).map(f=>f.id),['pay']);
 assert.equal(evidenceStatusLabel('MISSING'),'Belum ada bukti');
 assert.equal(evidenceStatusLabel('UPLOADED'),'Bukti sudah diunggah');
 assert.equal(evidenceStatusLabel('READY'),'Siap dibuat bonrate');
 assert.equal(evidenceStatusLabel('IN_BON'),'Sudah masuk bonrate');
});

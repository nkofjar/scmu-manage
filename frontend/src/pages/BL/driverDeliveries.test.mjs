import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryProgress,editDeliveries,scopedDeliveryFiles,workEvidenceIds,driverWorkPayload} from './driverDeliveriesModel.mjs';
test('five stops remain one work and completion month follows latest actual complete receipt',()=>{
 const deliveries=Array.from({length:5},(_,i)=>({billId:'a',containerNumber:'C1',recipient:'Recipient '+i,destination:'Depot',items:[{label:'Rice',packaging:'Sack',quantity:2}],receivedDate:i===4?'':'2026-10-31',evidenceFileIds:i===4?[]:['p'+i]}));
 assert.deepEqual(deliveryProgress({deliveries}),{complete:4,total:5,receivedDate:''});
 deliveries[4]={...deliveries[4],receivedDate:'2026-11-01',evidenceFileIds:['p4']};
 assert.deepEqual(deliveryProgress({deliveries}),{complete:5,total:5,receivedDate:'2026-11-01'});
 assert.equal(workEvidenceIds({deliveries}).length,5);
});
test('legacy values are projected for editing without destroying historical fields',()=>{
 const work={billId:'a',containerNumber:'C1',destination:'Depot',receivedDate:'2026-11-01',receiptReference:'OLD',instructions:'Old instructions',items:[{owner:'Owner',goodsType:'Rice',collyType:'Sack',collyCount:2}],evidenceFileIds:['p']};
 const [d]=editDeliveries(work);assert.equal(d.recipient,'Owner');assert.equal(d.items[0].label,'Rice');assert.equal(d.items[0].quantity,2);assert.equal(work.receiptReference,'OLD');
});
test('evidence scope permits own BL only, excluding unsupported journey-common proofs; endpoints survive',()=>{
 const files=[{id:'a',evidenceId:'pa',billIds:['a'],endpoint:'/a'},{id:'b',evidenceId:'pb',billIds:['b']},{id:'shared',billIds:['a','b']},{id:'common',source:'JOURNEY',billIds:[]},{id:'old',source:'BILL'},{id:'common-untagged',source:'JOURNEY'}];
 assert.deepEqual(scopedDeliveryFiles(files,'a').map(f=>f.id),['a','shared']);assert.deepEqual(scopedDeliveryFiles(files,'a',{selectedBillId:'a'}).map(f=>f.id),['a','shared','old']);
 assert.equal(scopedDeliveryFiles(files,'a')[0].endpoint,'/a');
});

test('server goods keys roundtrip into backend-only payload preserving historical values',()=>{const source={instructions:'Historical',receiptReference:'OLD',deliveries:[{billId:'a',recipient:'Recipient',items:[{goodsType:'Rice',collyType:'Sack',collyCount:2,owner:'Owner'}]}]};const draft={...source,deliveries:editDeliveries(source)};assert.equal(draft.deliveries[0].items[0].label,'Rice');const payload=driverWorkPayload(draft);assert.equal(payload.deliveries[0].items[0].goodsType,'Rice');assert.deepEqual(payload.deliveries[0].items[0],{goodsType:'Rice',collyType:'Sack',collyCount:2,owner:'Owner',packageWeightKg:null});assert.equal(payload.instructions,'Historical');assert.equal(source.deliveries[0].items[0].label,undefined);});

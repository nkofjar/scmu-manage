import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryProgress,editDeliveries,scopedDeliveryFiles,workEvidenceIds,driverWorkPayload,blankDriverWork} from './driverDeliveriesModel.mjs';
test('editing empty historical goods restores one editable row and retains every legacy item and child destination',()=>{
 const source={id:'legacy',deliveries:[{routeId:'old-route',destination:'Old snapshot',items:[]},{items:[{goodsType:'Rice',collyType:'Sack',collyCount:2},{goodsType:'Oil',collyType:'Box',collyCount:3}]}]};
 const edited=editDeliveries(source);assert.equal(edited[0].items.length,1);assert.equal(edited[0].routeId,'old-route');assert.equal(edited[0].destination,'Old snapshot');assert.equal(edited[1].items.length,2);assert.equal(edited[1].items[1].label,'Oil');assert.equal(source.deliveries[0].items.length,0);
 assert.equal(driverWorkPayload({...source,deliveries:edited}).deliveries[1].items.length,2);
});
test('new bonrate is explicitly post-delivery; legacy payload remains legacy',()=>{
 assert.equal(blankDriverWork('a','C1').recordingPolicy,'POST_DELIVERY');
 assert.equal(driverWorkPayload({id:'legacy',deliveries:[]}).recordingPolicy,undefined);
});
test('post-delivery payload saves ten completed owners as one work and rejects any incomplete or foreign-container child',()=>{
 const form={...blankDriverWork('a','C1'),deliveries:Array.from({length:10},(_,i)=>({billId:i%2?'b':'a',containerNumber:'C1',recipient:'Receiver '+i,destination:'Depot',receiptReference:'BST-'+i,receivedDate:'2026-01-01',evidenceFileIds:['p'+i],items:[{owner:'Owner '+i,label:'Rice',packaging:'Sack',quantity:2}]}))};
 const saved=driverWorkPayload(form);assert.equal(saved.deliveries.length,10);assert.equal(saved.receivedDate,'2026-01-01');assert.equal(saved.deliveries[9].receiptReference,'BST-9');assert.equal(saved.deliveries[9].items[0].owner,'Owner 9');
 for(const [key,value] of [['recipient',''],['destination',''],['receivedDate',''],['receivedDate','2999-01-01'],['items',[]],['containerNumber','C2'],['billId','']]){
  const invalid=structuredClone(form);invalid.deliveries[4][key]=value;assert.throws(()=>driverWorkPayload(invalid),/serah terima/i,key);
 }
 const invalid=structuredClone(form);invalid.deliveries[0].items[0].owner='';assert.throws(()=>driverWorkPayload(invalid),/serah terima/i);
 assert.throws(()=>driverWorkPayload({...form,deliveries:[]}),/serah terima/i);
});
test('completed post-delivery work saves without attachments while retaining existing selected evidence and historical weight',()=>{
 const child={billId:'a',containerNumber:'C1',recipient:'Receiver',destination:'Depot',receivedDate:'2026-01-01',evidenceFileIds:[],items:[{owner:'Owner',label:'Rice',packaging:'Sack',quantity:2,packageWeightKg:'25.50'}]};
 const form={...blankDriverWork('a','C1'),deliveries:[child,{...structuredClone(child),evidenceFileIds:['existing-proof']}]};
 assert.deepEqual(deliveryProgress(form),{complete:2,total:2,receivedDate:'2026-01-01'});
 const payload=driverWorkPayload(form);assert.deepEqual(payload.deliveries.map(d=>d.evidenceFileIds),[[],['existing-proof']]);assert.equal(payload.deliveries[0].items[0].packageWeightKg,'25.50');
 const source={...payload,id:'stored'};const resaved=driverWorkPayload({...source,deliveries:editDeliveries(source)});assert.deepEqual(resaved.deliveries.map(d=>d.items[0].packageWeightKg),['25.50','25.50']);assert.equal(child.items[0].packageWeightKg,'25.50');
});
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

test('aggregate receipt chooser keeps journey uploads reachable without exposing them in bill scope',()=>{
 const file={id:'journey',source:'JOURNEY',category:'DELIVERY_RECEIPT',billIds:[],endpoint:'/journeys/j/files/journey'};
 assert.deepEqual(scopedDeliveryFiles([file],'a',{allowJourney:true}).map(f=>f.id),['journey']);
 assert.equal(scopedDeliveryFiles([file],'a',{selectedBillId:'a'}).length,0);
 assert.equal(scopedDeliveryFiles([{...file,category:'PAYMENT_PROOF'}],'a',{allowJourney:true}).length,0);
 assert.equal(scopedDeliveryFiles([file],'',{allowJourney:true}).length,0);
});
test('child receipt chooser resolves mixed-category aliases and keeps previously selected raw IDs',()=>{
 const file={id:'raw',category:'SUPPORTING',billIds:['a'],evidenceIds:['raw','receipt'],evidenceAliases:[{id:'raw',category:'SUPPORTING'},{id:'receipt',category:'DELIVERY_RECEIPT'}]};
 assert.equal(scopedDeliveryFiles([file],'a')[0]?.evidenceId,'receipt');
 assert.equal(scopedDeliveryFiles([file],'a',{linked:['raw']})[0]?.evidenceId,'raw');
});
test('server goods keys roundtrip into backend-only payload preserving historical values',()=>{const source={id:'legacy',instructions:'Historical',receiptReference:'OLD',deliveries:[{billId:'a',recipient:'Recipient',items:[{goodsType:'Rice',collyType:'Sack',collyCount:2,owner:'Owner'}]}]};const draft={...source,deliveries:editDeliveries(source)};assert.equal(draft.deliveries[0].items[0].label,'Rice');const payload=driverWorkPayload(draft);assert.equal(payload.deliveries[0].items[0].goodsType,'Rice');assert.deepEqual(payload.deliveries[0].items[0],{goodsType:'Rice',collyType:'Sack',collyCount:2,owner:'Owner',packageWeightKg:null});assert.equal(payload.instructions,'Historical');assert.equal(source.deliveries[0].items[0].label,undefined);});

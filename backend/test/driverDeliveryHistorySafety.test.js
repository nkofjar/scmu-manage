const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./billDriverOperations.test');
const operations=require('../src/services/driverOperations'),dispatch=require('../src/services/driverDispatch');
const user={id:'staff',role:'ADMIN'};
function input(f){return {...f.work,deliveries:[{id:'one',billId:'a',containerNumber:'C1',recipient:'A',destination:'A',items:f.work.items,receivedDate:'2026-01-02',evidenceFileIds:['own']},{id:'two',billId:'b',containerNumber:'C2',recipient:'B',destination:'B',items:f.work.items,receivedDate:'2026-02-03',evidenceFileIds:['foreign']}]};}
function company(f){f.tx.company={findUnique:async({where})=>({id:where.id,name:'SCMU',isInternal:true,isActive:true})};}
test('explicit flat B/L ownership rejects sibling receipts on save and status changes',async()=>{
 for(const action of ['create','save','submit','verify']){
  const f=fixture();f.work.evidenceFileIds=['foreign'];if(action==='verify')f.work.status='SUBMITTED';
  await assert.rejects(['create','save'].includes(action)?operations.saveWork(f.tx,user,'j',action==='create'?null:'work-a',{version:1,work:f.work}):operations.transition(f.tx,user,'j','work-a',{version:1,status:action==='submit'?'SUBMITTED':'VERIFIED',proofChecked:true}),e=>e.status===422);
  assert.equal(f.writes.length,0);
 }
});
test('editable single-B/L multiple deliveries retain explicit primary quota container on roundtrip',async()=>{
 const f=fixture(),scoped=require('../src/services/billDriverOperations');f.a.containers.push({number:'C3',size:'20'});
 const work=input(f);work.containerNumber='C3';work.deliveries[1]={...work.deliveries[1],billId:'a',containerNumber:'C3',evidenceFileIds:['own']};
 await operations.saveWork(f.tx,user,'j','work-a',{version:1,work});
 const projected=(await scoped.list(f.tx,'a')).works.find(w=>w.id==='work-a');assert.equal(projected.containerNumber,'C3');assert.equal(projected.containerKey,'C3');
 const saved=await scoped.saveWork(f.tx,user,'a','work-a',{version:2,work:projected});assert.equal(saved.containerNumber,'C3');assert.equal(operations.state(f.parent).works.find(w=>w.id==='work-a').containerKey,'C3');
});
test('changed source seal publishes a new immutable revision rather than deduplicating stale source',async()=>{
 const f=fixture();company(f);f.work.taskDate='2026-01-01';f.a.containers[0].seal='S1';
 const body={version:1,documentType:'DELIVERY_NOTE',confirmed:true};const first=await dispatch.issueBill(f.tx,user,'a','work-a',body),bytes=dispatch.pdf(first);
 f.a.containers[0].seal='S2';f.parent.version++;
 const second=await dispatch.issueBill(f.tx,user,'a','work-a',{...body,version:f.parent.version});assert.notEqual(second.id,first.id);assert.equal(second.seal,'S2');assert.deepEqual(dispatch.pdf(await dispatch.getBill(f.tx,'a','work-a',first.id)),bytes);
 assert.equal((await dispatch.issueBill(f.tx,user,'a','work-a',{...body,version:f.parent.version})).id,second.id);
});
test('aggregate mutations reject archived primary and secondary sources before writes',async()=>{
 for(const id of ['a','b'])for(const legacy of [false,true])for(const action of ['create','edit','submit','verify']){
  const f=fixture(),work=input(f);let version=1;
  if(action!=='create'){await operations.saveWork(f.tx,user,'j','work-a',{version,work});version++;}
  if(action==='verify'){await operations.transition(f.tx,user,'j','work-a',{version,status:'SUBMITTED'});version++;}
  const bill=id==='a'?f.a:f.b;if(legacy)bill.registerData.archivedAt='2026-03-01';else bill.archivedAt=new Date('2026-03-01');const writes=f.writes.length;
  const call=['create','edit'].includes(action)?operations.saveWork(f.tx,user,'j',action==='create'?null:'work-a',{version,work}):operations.transition(f.tx,user,'j','work-a',{version,status:action==='submit'?'SUBMITTED':'VERIFIED',proofChecked:true});
  await assert.rejects(call,e=>e.status===409,`${id}/${legacy}/${action}`);assert.equal(f.writes.length,writes);
 }
});
test('historical dispatch membership survives removing secondary delivery without authorizing unrelated work',async()=>{
 const f=fixture();company(f);let work=await operations.saveWork(f.tx,user,'j','work-a',{version:1,work:input(f)});
 const saved=await dispatch.issueBill(f.tx,user,'a','work-a',{version:2,documentType:'DELIVERY_NOTE',taskDate:'2026-01-01',confirmed:true}),bytes=dispatch.pdf(saved);
 work={...work,deliveries:work.deliveries.slice(0,1)};await operations.saveWork(f.tx,user,'j','work-a',{version:3,work});
 const historical=await dispatch.getBill(f.tx,'b','work-a',saved.id);assert.deepEqual(dispatch.pdf(historical),bytes);assert(!JSON.stringify(historical).includes('"own"'));
 assert.equal((await dispatch.listBill(f.tx,'b','work-a')).data.length,1);
 await assert.rejects(dispatch.issueBill(f.tx,user,'b','work-a',{version:4,documentType:'DELIVERY_NOTE',confirmed:true}),e=>e.status===404);
 await assert.rejects(dispatch.getBill(f.tx,'b','work-b',saved.id),e=>e.status===404);
 await assert.rejects(dispatch.getBill(f.tx,'missing','work-a',saved.id),e=>e.status===404||e.status===422);
});
test('legacy receipt-only edits publish a fresh revision while previous bytes remain immutable',async()=>{
 const f=fixture();company(f);f.work.taskDate='2026-01-01';await operations.saveWork(f.tx,user,'j','work-a',{version:1,work:f.work});const body={version:2,documentType:'DELIVERY_NOTE',confirmed:true};
 const first=await dispatch.issueBill(f.tx,user,'a','work-a',body),bytes=dispatch.pdf(first);
 const current=operations.state(f.parent).works.find(w=>w.id==='work-a');await operations.saveWork(f.tx,user,'j','work-a',{version:3,work:{...current,receivedDate:'2026-02-03',receiptReference:'REC2',evidenceFileIds:[]}});
 const second=await dispatch.issueBill(f.tx,user,'a','work-a',{...body,version:4});assert.notEqual(second.id,first.id);assert.equal(second.receivedDate,'2026-02-03');assert.equal(second.receiptReference,'REC2');assert.deepEqual(second.evidenceFileIds,[]);
 assert.deepEqual(dispatch.pdf(await dispatch.getBill(f.tx,'a','work-a',first.id)),bytes);
});

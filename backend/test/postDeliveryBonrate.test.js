const test=require('node:test'),assert=require('node:assert/strict');
const ops=require('../src/services/driverOperations'),dispatch=require('../src/services/driverDispatch');
const {fixture}=require('./billDriverOperations.test');
const user={id:'staff',name:'Staff',role:'ADMIN'};
function setup(){const f=fixture(),company={id:'dd597ed2-fad1-5482-ab82-8f2bb84d8852',name:'SCMU',isInternal:true,isActive:true};f.tx.driver={findUnique:async()=>({id:'driver',name:'Driver',isActive:true,employmentType:'INTERNAL',companyId:'dd597ed2-fad1-5482-ab82-8f2bb84d8852',company})};f.tx.vehicle={findUnique:async()=>({id:'vehicle',registrationNo:'PA123',isActive:true,ownershipType:'OWN',companyId:'dd597ed2-fad1-5482-ab82-8f2bb84d8852',company})};f.tx.company={findUnique:async({where})=>({id:where.id,name:'SCMU',isInternal:true,isActive:true})};return f;}
function input(f){return {...f.work,driverId:'driver',vehicleId:'vehicle',items:[],deliveries:[{id:'delivery',billId:'a',containerNumber:'C1',recipient:'Owner One',destination:'Store One',items:[{owner:'Owner One',collyCount:2,collyType:'SAK',goodsType:'Rice',packageWeightKg:25}],receivedDate:'2026-01-02',receiptReference:'RECEIPT-001',evidenceFileIds:['own']}]};}
test('new saved work enforces POST_DELIVERY even when client omits or forges policy; legacy edits remain legacy',async()=>{
 for(const policy of [undefined,null,'LEGACY','POST_DELIVERY']){const f=setup(),work=input(f);work.recordingPolicy=policy;const saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work});assert.equal(saved.recordingPolicy,'POST_DELIVERY');assert.equal(saved.receivedDate,'2026-01-02');const edited=await ops.saveWork(f.tx,user,'j',saved.id,{version:2,work:{...saved,recordingPolicy:null}});assert.equal(edited.recordingPolicy,'POST_DELIVERY');}
 const f=fixture(),saved=await ops.saveWork(f.tx,user,'j','work-a',{version:1,work:{...f.work,recordingPolicy:'POST_DELIVERY'}});assert.notEqual(saved.recordingPolicy,'POST_DELIVERY');
});
test('completed children without uploads save, reload, submit, verify and publish in both scopes',async()=>{
 const scoped=require('../src/services/billDriverOperations');
 for(const scope of ['journey','bill'])for(const rateType of ['RB','RK','TONASE','RBS'])for(const selection of [[],undefined]){
  const f=setup(),work={...input(f),rateType,driverId:null,vehicleId:null};f.parent.data.driverOperations.recaps=[];
  work.deliveries[0].evidenceFileIds=selection;delete work.evidenceFileIds;
  const saved=await (scope==='bill'?scoped.saveWork(f.tx,user,'a',null,{version:1,work}):ops.saveWork(f.tx,user,'j',null,{version:1,work}));
  assert.equal(saved.receivedDate,'2026-01-02');assert.deepEqual(saved.evidenceFileIds,[]);assert.deepEqual(saved.deliveries[0].evidenceFileIds,[]);
  const reloaded=(await (scope==='bill'?scoped.list(f.tx,'a'):ops.list(f.tx,'j'))).works.find(w=>w.id===saved.id);assert.deepEqual(reloaded.deliveries[0].evidenceFileIds,[]);
  const move=body=>scope==='bill'?scoped.transition(f.tx,user,'a',saved.id,body):ops.transition(f.tx,user,'j',saved.id,body);
  await move({version:2,status:'SUBMITTED'});await assert.rejects(move({version:3,status:'VERIFIED'}),e=>e.status===422&&/realisasi pengantaran/i.test(e.message));assert.equal(f.parent.version,3);
  await move({version:3,status:'VERIFIED',proofChecked:true});
  const issued=await (scope==='bill'?dispatch.issueBill(f.tx,user,'a',saved.id,{version:4,documentType:'BONRATE',confirmed:true}):dispatch.issueJourney(f.tx,user,'j',saved.id,{version:4,documentType:'BONRATE',confirmed:true}));
  assert.deepEqual(issued.evidenceFileIds,[]);assert.deepEqual(issued.deliveries[0].evidenceFileIds,[]);assert.equal(f.parent.data.driverOperations.works.find(w=>w.id===saved.id).status,'VERIFIED');assert.equal(f.parent.version,5);
  assert.deepEqual(ops.usage(ops.state(f.parent),'C1'),{rb:rateType==='RB'?1:0,rk:rateType==='RK'?1:0});
 }
});
test('attachment-free child readiness is derived in aggregate and bill views without mutating history',async()=>{
 const scoped=require('../src/services/billDriverOperations');
 for(const status of ['DRAFT','REJECTED','SUBMITTED','VERIFIED','CANCELLED']){
  const f=setup(),work=input(f);f.parent.data.driverOperations.recaps=[];work.deliveries[0].evidenceFileIds=[];
  const saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work}),stored=f.parent.data.driverOperations.works.find(w=>w.id===saved.id);stored.status=status;
  const before=structuredClone(f.parent),expected=['SUBMITTED','VERIFIED'].includes(status)?'IN_BON':['DRAFT','REJECTED'].includes(status)?'READY':'MISSING';
  assert.equal((await ops.list(f.tx,'j')).works.find(w=>w.id===saved.id).evidenceStatus,expected,status);
  assert.equal((await scoped.list(f.tx,'a')).works.find(w=>w.id===saved.id).evidenceStatus,expected,status);
  assert.deepEqual(f.parent,before);assert.equal(f.writes.length,1);
 }
});
test('optional child selections still reject malformed, missing, sibling and wrong-category evidence',async()=>{
 const scoped=require('../src/services/billDriverOperations');
 for(const scope of ['journey','bill'])for(const ids of [false,0,'own',['missing'],['foreign'],['own','own'],['supporting']]){
  const f=setup(),work=input(f);f.a.files.push({id:'supporting',filename:'supporting.pdf',category:'SUPPORTING'});work.deliveries[0].evidenceFileIds=ids;
  await assert.rejects(scope==='bill'?scoped.saveWork(f.tx,user,'a',null,{version:1,work}):ops.saveWork(f.tx,user,'j',null,{version:1,work}),e=>e.status===422,`${scope}: ${JSON.stringify(ids)}`);
  assert.equal(f.writes.length,0);
 }
});
test('provided optional child evidence is revalidated on edit, submission, verification and publication',async()=>{
 const scoped=require('../src/services/billDriverOperations');
 for(const scope of ['journey','bill'])for(const action of ['edit','submit','verify','publish'])for(const change of ['missing','sibling','category']){
  const f=setup(),work=input(f),saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work});
  if(['verify','publish'].includes(action))await ops.transition(f.tx,user,'j',saved.id,{version:2,status:'SUBMITTED'});
  if(action==='publish')await ops.transition(f.tx,user,'j',saved.id,{version:3,status:'VERIFIED',proofChecked:true});
  if(change==='missing')f.a.files=[];else if(change==='category')f.a.files[0].category='SUPPORTING';else f.parent.data.driverOperations.works.find(w=>w.id===saved.id).deliveries[0].evidenceFileIds=['foreign'];
  const before=structuredClone(f.parent),writes=f.writes.length,version=f.parent.version,stored=f.parent.data.driverOperations.works.find(w=>w.id===saved.id);
  const call=action==='edit'?(scope==='bill'?scoped.saveWork(f.tx,user,'a',saved.id,{version,work:stored}):ops.saveWork(f.tx,user,'j',saved.id,{version,work:stored})):action==='publish'?(scope==='bill'?dispatch.issueBill(f.tx,user,'a',saved.id,{version,documentType:'BONRATE',confirmed:true}):dispatch.issueJourney(f.tx,user,'j',saved.id,{version,documentType:'BONRATE',confirmed:true})):(scope==='bill'?scoped.transition(f.tx,user,'a',saved.id,{version,status:action==='submit'?'SUBMITTED':'VERIFIED',proofChecked:true}):ops.transition(f.tx,user,'j',saved.id,{version,status:action==='submit'?'SUBMITTED':'VERIFIED',proofChecked:true}));
  await assert.rejects(call,e=>e.status===422,`${scope} ${action} ${change}`);assert.deepEqual(f.parent,before);assert.equal(f.writes.length,writes);
 }
});
test('post-delivery save rejects incomplete actuals or a different physical container, including edits',async()=>{
 for(const field of ['deliveries','recipient','destination','items','owner','collyCount','collyType','goodsType','receivedDate','containerNumber']){
  const f=setup(),work=input(f);if(field==='deliveries')delete work.deliveries;else if(field==='containerNumber'){f.b.containers.push({number:'C1',size:'20'});work.deliveries.push({...work.deliveries[0],id:'two',billId:'b',containerNumber:'C2',evidenceFileIds:['foreign']});}else if(['owner','collyCount','collyType','goodsType'].includes(field))work.deliveries[0].items[0][field]=null;else work.deliveries[0][field]=field==='items'?[]:null;
  await assert.rejects(ops.saveWork(f.tx,user,'j',null,{version:1,work}),field);assert.equal(f.writes.length,0,field);
 }
 const f=setup(),saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work:input(f)});saved.deliveries[0].recipient=null;await assert.rejects(ops.saveWork(f.tx,user,'j',saved.id,{version:2,work:saved}));assert.equal(f.writes.length,1);
});
test('journey receipt evidence and child receipt references persist across same-container cross-B/L realization',async()=>{
 const f=setup(),work=input(f);f.b.containers.push({number:'C1',size:'20'});f.parent.files=[{id:'journey-receipt',filename:'receipt.pdf',category:'DELIVERY_RECEIPT'}];work.deliveries[0].evidenceFileIds=['journey-receipt'];work.deliveries.push({...work.deliveries[0],id:'second',billId:'b',recipient:'Owner Two',receivedDate:'2026-02-03',receiptReference:'RECEIPT-002',evidenceFileIds:['foreign']});delete work.items;
 const saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work});assert.equal(saved.receivedDate,'2026-02-03');assert.equal(saved.deliveries[0].receiptReference,'RECEIPT-001');assert.equal(saved.deliveries[1].receiptReference,'RECEIPT-002');
 await ops.transition(f.tx,user,'j',saved.id,{version:2,status:'SUBMITTED'});await ops.transition(f.tx,user,'j',saved.id,{version:3,status:'VERIFIED',proofChecked:true});assert.deepEqual(ops.usage(ops.state(f.parent),'C1'),{rb:1,rk:0});
 const scoped=require('../src/services/billDriverOperations');for(const billId of ['a','b']){const view=(await scoped.list(f.tx,billId)).works.find(w=>w.id===saved.id);assert.equal(view.recordingPolicy,'POST_DELIVERY');assert(!JSON.stringify(view).includes('journey-receipt'));assert(!JSON.stringify(view).includes(JSON.stringify(billId==='a'?'foreign':'own')));}
 for(const change of ['foreign','supporting','archived']){const g=setup(),w=input(g);g.parent.files=[{id:'journey',filename:'receipt.pdf',category:change==='supporting'?'SUPPORTING':'POD'}];w.deliveries[0].evidenceFileIds=[change==='foreign'?'foreign':'journey'];if(change==='archived')g.a.archivedAt=new Date();await assert.rejects(ops.saveWork(g.tx,user,'j',null,{version:1,work:w}));assert.equal(g.writes.length,0);}
});
test('BONRATE publishes a complete draft and remains immutable across versions, source edits and archived history',async()=>{
 const f=setup(),saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work:input(f)}),body={version:2,documentType:'BONRATE',confirmed:true};
 const snapshot=await dispatch.issueBill(f.tx,user,'a',saved.id,body);assert.equal(snapshot.documentType,'BONRATE');assert.equal(snapshot.receivedDate,'2026-01-02');assert.equal(snapshot.taskDate,'2026-01-02');assert.equal(snapshot.recordingPolicy,'POST_DELIVERY');assert.equal(snapshot.deliveries[0].receiptReference,'RECEIPT-001');const bytes=dispatch.pdf(snapshot);assert(bytes.length>1000);
 assert.equal(f.parent.data.driverOperations.works.find(w=>w.id===saved.id).status,'DRAFT');
 f.parent.data.driverOperations.works.find(w=>w.id===saved.id).instructions='CHANGED';
 const retry=await dispatch.issueBill(f.tx,user,'a',saved.id,{...body,version:3,taskDate:'2999-01-01'});assert.equal(retry.id,snapshot.id);assert.deepEqual(dispatch.pdf(retry),bytes);assert.equal(f.parent.version,3);
 f.parent.archivedAt=new Date();f.a.archivedAt=new Date();assert.deepEqual(dispatch.pdf(await dispatch.getBill(f.tx,'a',saved.id,snapshot.id)),bytes);assert.equal((await dispatch.listBill(f.tx,'a',saved.id)).data.length,1);
 for(const type of ['TRANSPORT_ORDER','DELIVERY_NOTE']){const g=setup(),w=await ops.saveWork(g.tx,user,'j',null,{version:1,work:input(g)});await assert.rejects(dispatch.issueBill(g.tx,user,'a',w.id,{version:2,documentType:type,taskDate:'2026-01-02',confirmed:true}),e=>e.status===409);assert.equal(g.writes.length,1);}
 const legacy=setup();await assert.rejects(dispatch.issueBill(legacy.tx,user,'a','work-a',{version:1,documentType:'BONRATE',confirmed:true}),e=>e.status===409);assert.equal(legacy.writes.length,0);
});
test('journey publication and history return exact aggregate snapshot without leaking evidence into bill projections',async()=>{
 const f=setup(),work=input(f);f.parent.data.driverOperations.recaps=[];f.b.containers.push({number:'C1',size:'20'});f.parent.files=[{id:'journey-proof',filename:'journey.pdf',category:'POD'}];work.deliveries[0].evidenceFileIds=['journey-proof'];work.deliveries.push({...work.deliveries[0],id:'two',billId:'b',evidenceFileIds:['foreign']});const saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work});await ops.transition(f.tx,user,'j',saved.id,{version:2,status:'SUBMITTED'});await ops.transition(f.tx,user,'j',saved.id,{version:3,status:'VERIFIED',proofChecked:true});
 const snapshot=await dispatch.issueJourney(f.tx,user,'j',saved.id,{version:4,documentType:'BONRATE',confirmed:true});assert.deepEqual(snapshot.evidenceFileIds,['journey-proof','foreign']);assert.equal((await dispatch.listJourney(f.tx,'j',saved.id)).data[0].id,snapshot.id);assert.deepEqual(dispatch.pdf(await dispatch.getJourney(f.tx,'j',saved.id,snapshot.id)),dispatch.pdf(snapshot));await assert.rejects(dispatch.getJourney(f.tx,'j','work-b',snapshot.id),e=>e.status===404);
 for(const id of ['a','b']){const history=await dispatch.listBill(f.tx,id,saved.id);assert(!JSON.stringify(history.data.map(d=>({...d,pdfBase64:undefined}))).includes('journey-proof'));}
 const retry=await dispatch.issueJourney(f.tx,user,'j',saved.id,{version:4,documentType:'BONRATE',confirmed:true});assert.equal(retry.id,snapshot.id);assert.equal(f.parent.version,5);
});
test('journey HTTP exposes aggregate BONRATE issue, history and immutable PDF with bill-route parity',async()=>{
 const express=require('express'),jwt=require('jsonwebtoken'),prisma=require('../src/prisma'),f=setup(),saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work:input(f)});f.parent.data.driverOperations.budgets=[];const original={};for(const k of ['user','seaBill','shippingJourney','company','activityLog','$transaction'])original[k]=prisma[k];const oldSecret=process.env.JWT_SECRET;process.env.JWT_SECRET='post-delivery-test-secret';let server;
 try{Object.assign(prisma,f.tx);prisma.user={findUnique:async()=>({...user,isActive:true})};prisma.$transaction=async fn=>fn(f.tx);const app=express();app.use(express.json());app.use('/api/journeys',require('../src/routes/journeys'));app.use(require('../src/middleware/errorHandler').errorHandler);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/journeys/j/driver-operations/works/${saved.id}`,headers={'Content-Type':'application/json',Authorization:'Bearer '+jwt.sign({id:user.id},process.env.JWT_SECRET)},body=JSON.stringify({version:2,documentType:'BONRATE'});assert.equal((await fetch(base+'/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body})).status,401);const issued=await fetch(base+'/dispatch',{method:'POST',headers,body});assert.equal(issued.status,201);const snapshot=await issued.json();const history=await fetch(base+'/dispatches',{headers});assert.equal(history.status,200);assert.equal((await history.json()).data[0].id,snapshot.id);const pdf=await fetch(base+`/dispatches/${snapshot.id}/pdf`,{headers});assert.equal(pdf.status,200);assert.equal(pdf.headers.get('cache-control'),'private, no-store');assert.deepEqual(Buffer.from(await pdf.arrayBuffer()),dispatch.pdf(snapshot));assert.equal((await fetch(base+'/dispatch',{method:'POST',headers,body})).status,201);assert.equal(f.parent.version,3);assert.equal(f.parent.data.driverOperations.works.find(w=>w.id===saved.id).status,'DRAFT');assert.deepEqual(f.parent.data.driverOperations.budgets,[]);
 }finally{if(server)await new Promise(r=>server.close(r));Object.assign(prisma,original);if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;}
});
test('BONRATE PDF prints actual deliveries once, receipt references, units and RB/RK title',async()=>{
 for(const rateType of ['RB','RK','TONASE','RBS']){const f=setup(),work=input(f);work.rateType=rateType;work.deliveries.push({...work.deliveries[0],id:'two',recipient:'Owner Two',items:[{owner:'Owner Two',collyCount:3,collyType:'DRUM',goodsType:'Oil'}],receivedDate:'2026-02-03',receiptReference:'RECEIPT-002'});const saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work});await ops.transition(f.tx,user,'j',saved.id,{version:2,status:'SUBMITTED'});await ops.transition(f.tx,user,'j',saved.id,{version:3,status:'VERIFIED',proofChecked:true});const snapshot=await dispatch.issueJourney(f.tx,user,'j',saved.id,{version:4,documentType:'BONRATE',confirmed:true});const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs'),pdf=await getDocument({data:new Uint8Array(dispatch.pdf(snapshot)),useSystemFonts:true}).promise;let text='';for(let n=1;n<=pdf.numPages;n++)text+=(await(await pdf.getPage(n)).getTextContent()).items.map(i=>i.str).join(' ');await pdf.cleanup();for(const expected of ['SURAT JALAN MOBIL',`BONRATE ${rateType}`,'2026-02-03','2026-01-02','RECEIPT-001','RECEIPT-002','SAK','DRUM','25 kg/kemasan'])assert(text.includes(expected),expected);assert.equal(text.split('Rice').length-1,1);assert.equal(text.split('Oil').length-1,1);}
});
test('issued BONRATE locks save and cancellation and exposes safe issued flags',async()=>{
 const f=setup();f.parent.data.driverOperations.recaps=[];const work=await ops.saveWork(f.tx,user,'j',null,{version:1,work:input(f)});await ops.transition(f.tx,user,'j',work.id,{version:2,status:'SUBMITTED'});await ops.transition(f.tx,user,'j',work.id,{version:3,status:'VERIFIED',proofChecked:true});await dispatch.issueJourney(f.tx,user,'j',work.id,{version:4,documentType:'BONRATE',confirmed:true});
 await assert.rejects(ops.transition(f.tx,user,'j',work.id,{version:5,status:'CANCELLED',reason:'Cancel'}),e=>e.status===409);assert.equal(f.parent.version,5);assert.deepEqual(ops.usage(ops.state(f.parent),'C1'),{rb:1,rk:0});const stored=f.parent.data.driverOperations.works.find(w=>w.id===work.id);stored.status='DRAFT';await assert.rejects(ops.saveWork(f.tx,user,'j',work.id,{version:5,work:stored}),e=>e.status===409);assert.equal(f.parent.version,5);
 const bill=(await require('../src/services/billDriverOperations').list(f.tx,'a')).works.find(w=>w.id===work.id),aggregate=(await ops.list(f.tx,'j')).works.find(w=>w.id===work.id);assert.equal(bill.bonrateIssued,true);assert.equal(bill.recordingPolicy,'POST_DELIVERY');assert.equal(aggregate.bonrateIssued,true);assert.equal(stored.bonrateIssued,true);assert.equal(bill.dispatches,undefined);
});
test('post-delivery records accept manual identities on create and existing MASTER_IDS edits without trusting client classification',async()=>{
 for(const edit of [false,true]){const f=setup();let work=input(f),id=null,version=1;if(edit){const saved=await ops.saveWork(f.tx,user,'j',null,{version,work});work=saved;id=saved.id;version++;f.parent.data.driverOperations.works.find(w=>w.id===id).identityPolicy='MASTER_IDS';}Object.assign(work,{driverId:null,vehicleId:null,driverName:' Manual   Driver ',vehicleNumber:'pa 999',driverEmploymentType:'INTERNAL',vehicleOwnershipType:'OWN',identityPolicy:'MASTER_IDS'});const saved=await ops.saveWork(f.tx,user,'j',id,{version,work});assert.equal(saved.driverId,null);assert.equal(saved.vehicleId,null);assert.equal(saved.driverName,'Manual Driver');assert.equal(saved.vehicleNumber,'PA 999');assert.equal(saved.driverEmploymentType,null);assert.equal(saved.vehicleOwnershipType,null);assert.notEqual(saved.identityPolicy,'MASTER_IDS');await ops.transition(f.tx,user,'j',saved.id,{version:version+1,status:'SUBMITTED'});}
 for(const field of ['driverName','vehicleNumber']){const f=setup(),work={...input(f),driverId:null,vehicleId:null};work[field]=' ';await assert.rejects(ops.saveWork(f.tx,user,'j',null,{version:1,work}),e=>[409,422].includes(e.status));assert.equal(f.writes.length,0);}
});
test('post-delivery validation cannot grandfather changed receipt categories or cross-container stored children',async()=>{
 for(const change of ['category','container']){const f=setup(),work=await ops.saveWork(f.tx,user,'j',null,{version:1,work:input(f)});if(change==='category')f.a.files[0].category='SUPPORTING';else{const stored=f.parent.data.driverOperations.works.find(w=>w.id===work.id);stored.deliveries[0].containerNumber='SHARED';stored.deliveries[0].containerKey='SHARED';}await assert.rejects(ops.transition(f.tx,user,'j',work.id,{version:2,status:'SUBMITTED'}));assert.equal(f.writes.length,1);}
});
test('bill-scoped completed child accepts journey receipt without exposing its evidence identifiers',async()=>{
 const f=setup();f.parent.files=[{id:'journey-proof',filename:'journey.pdf',category:'POD'}];const work=input(f);work.deliveries[0].evidenceFileIds=['journey-proof'];work.evidenceFileIds=['journey-proof'];const scoped=require('../src/services/billDriverOperations'),saved=await scoped.saveWork(f.tx,user,'a',null,{version:1,work});assert.equal(saved.recordingPolicy,'POST_DELIVERY');assert.deepEqual(saved.evidenceFileIds,[]);assert(!JSON.stringify(saved).includes('journey-proof'));await scoped.transition(f.tx,user,'a',saved.id,{version:2,status:'SUBMITTED'});assert.equal(f.parent.version,3);
});
test('separate realized works may share receipt evidence and reference while reserving one rit each',async()=>{
 const f=setup();for(let i=0;i<2;i++){const work=await ops.saveWork(f.tx,user,'j',null,{version:1+i*2,work:input(f)});await ops.transition(f.tx,user,'j',work.id,{version:2+i*2,status:'SUBMITTED'});}assert.deepEqual(ops.usage(ops.state(f.parent),'C1'),{rb:2,rk:0});
});
test('TONASE and RBS remain distinct saved rate types in aggregate and bill projections',async()=>{
 const scoped=require('../src/services/billDriverOperations');for(const rateType of ['TONASE','RBS']){const f=setup(),work={...input(f),rateType};f.parent.data.driverOperations.recaps=[];const saved=await scoped.saveWork(f.tx,user,'a',null,{version:1,work});assert.equal(saved.rateType,rateType);assert.equal((await scoped.list(f.tx,'a')).works.find(w=>w.id===saved.id).rateType,rateType);assert.equal((await ops.list(f.tx,'j')).works.find(w=>w.id===saved.id).rateType,rateType);const edited=await scoped.saveWork(f.tx,user,'a',saved.id,{version:2,work:{...f.parent.data.driverOperations.works.find(w=>w.id===saved.id),notes:'Edited'}});assert.equal(edited.rateType,rateType);}
});
test('TONASE and RBS transitions never require, lock or consume RB/RK budgets',async()=>{
 const scoped=require('../src/services/billDriverOperations');for(const rateType of ['TONASE','RBS'])for(const scope of ['journey','bill'])for(const budgetMode of ['none','exhausted']){const f=setup(),work={...input(f),rateType};if(budgetMode==='none')f.parent.data.driverOperations.budgets=[];else{f.parent.data.driverOperations.budgets[0].rb=0;f.parent.data.driverOperations.budgets[0].rk=0;f.work.status='VERIFIED';}const budgets=structuredClone(f.parent.data.driverOperations.budgets),beforeUsage=ops.usage(ops.state(f.parent),'C1');const saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work});const move=body=>scope==='bill'?scoped.transition(f.tx,user,'a',saved.id,body):ops.transition(f.tx,user,'j',saved.id,body);await move({version:2,status:'SUBMITTED'});assert.deepEqual(ops.usage(ops.state(f.parent),'C1'),beforeUsage);await move({version:3,status:'VERIFIED',proofChecked:true});assert.deepEqual(f.parent.data.driverOperations.budgets,budgets);assert.deepEqual(ops.usage(ops.state(f.parent),'C1'),beforeUsage);await move({version:4,status:'CANCELLED',reason:'No quota'});assert.deepEqual(f.parent.data.driverOperations.budgets,budgets);assert.deepEqual(ops.usage(ops.state(f.parent),'C1'),beforeUsage);}
});
test('each child master route resolves authoritative destination and retains snapshot through edit and publication',async()=>{
 const f=setup();f.parent.data.driverOperations.recaps=[];let calls=0;f.tx.route={findUnique:async({where})=>{calls++;return {id:where.id,isActive:true,name:'Delivery route',originCity:'Port',originState:'Papua',destCity:'Store '+where.id,destState:'Papua'};}};const work=input(f);work.deliveries[0].routeId='one';work.deliveries[0].routeSnapshot={destCity:'FORGED'};work.deliveries[0].destination='FORGED';work.deliveries.push({...work.deliveries[0],id:'second',routeId:'two'});const saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work});assert.equal(calls,2);assert.equal(saved.deliveries[0].destination,'Store one, Papua');assert.equal(saved.deliveries[1].destination,'Store two, Papua');assert.equal(saved.deliveries[0].routeSnapshot.destCity,'Store one');
 f.tx.route.findUnique=async()=>{throw Error('unchanged historical route must not be reloaded');};const edit=structuredClone(saved);for(const d of edit.deliveries){d.destination='FORGED';d.routeSnapshot={destCity:'FORGED'};}const edited=await ops.saveWork(f.tx,user,'j',saved.id,{version:2,work:edit});assert.deepEqual(edited.deliveries,saved.deliveries);await ops.transition(f.tx,user,'j',saved.id,{version:3,status:'SUBMITTED'});await ops.transition(f.tx,user,'j',saved.id,{version:4,status:'VERIFIED',proofChecked:true});const snapshot=await dispatch.issueJourney(f.tx,user,'j',saved.id,{version:5,documentType:'BONRATE',confirmed:true});assert.deepEqual(snapshot.deliveries.map(d=>d.routeSnapshot),saved.deliveries.map(d=>d.routeSnapshot));assert.deepEqual((await dispatch.getJourney(f.tx,'j',saved.id,snapshot.id)).deliveries,snapshot.deliveries);
 for(const inactive of [null,{id:'inactive',isActive:false}]){const g=setup(),w=input(g);g.tx.route={findUnique:async()=>inactive};w.deliveries[0].routeId='inactive';await assert.rejects(ops.saveWork(g.tx,user,'j',null,{version:1,work:w}),e=>e.status===422&&/rute aktif/i.test(e.message));assert.equal(g.writes.length,0);}
});
test('persisted MASTER_IDS marker does not override valid manual identity readiness',async()=>{
 const f=setup(),saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work:{...input(f),driverId:null,vehicleId:null}});f.parent.data.driverOperations.works.find(w=>w.id===saved.id).identityPolicy='MASTER_IDS';await ops.transition(f.tx,user,'j',saved.id,{version:2,status:'SUBMITTED'});assert.equal(f.parent.version,3);
});
test('non-quota works do not lock scheme selection or report an RB/RK budget locked',async()=>{
 for(const rateType of ['TONASE','RBS']){const f=setup();f.parent.data.driverOperations.recaps=[];f.tx.driverRateScheme={findUnique:async()=>({id:'scheme',name:'Scheme',enabled:true,size:'20',version:1,rb:3,rk:1})};const saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work:{...input(f),rateType}});await ops.transition(f.tx,user,'j',saved.id,{version:2,status:'SUBMITTED'});assert.equal((await ops.list(f.tx,'j')).budgets[0].locked,false);await ops.setBudget(f.tx,user,'j',{version:3,containerNumber:'C1',schemeId:'scheme'});assert.deepEqual(ops.usage(ops.state(f.parent),'C1'),{rb:0,rk:0});}
});
test('non-quota works do not require quota-only reconciliation of legacy RB/RK bons',async()=>{
 for(const rateType of ['TONASE','RBS']){const f=setup();f.parent.data.driverBons=[{id:'legacy',status:'DRAFT',rbCount:1,rkCount:0}];f.parent.data.driverOperations.budgets=[];const saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work:{...input(f),rateType}});await ops.transition(f.tx,user,'j',saved.id,{version:2,status:'SUBMITTED'});await ops.transition(f.tx,user,'j',saved.id,{version:3,status:'VERIFIED',proofChecked:true});assert.deepEqual(ops.usage(ops.state(f.parent),'C1'),{rb:0,rk:0});}
});
test('direct BONRATE publication needs neither confirmation nor budget in either scope and never changes financial state',async()=>{
 for(const scope of ['journey','bill'])for(const rateType of ['RB','RK','TONASE','RBS'])for(const budgetMode of ['none','exhausted'])for(const status of ['DRAFT','SUBMITTED','VERIFIED','REJECTED']){
  const f=setup(),work={...input(f),rateType,driverId:null,vehicleId:null};work.deliveries[0].evidenceFileIds=[];
  const saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work});
  const stored=f.parent.data.driverOperations.works.find(w=>w.id===saved.id);stored.status=status;
  if(budgetMode==='none')f.parent.data.driverOperations.budgets=[];
  else {Object.assign(f.parent.data.driverOperations.budgets[0],{rb:0,rk:0,lockedAt:'historic',approvedById:'historic-director'});f.parent.data.driverOperations.works[0].status='VERIFIED';}
  f.parent.data.driverOperations.quotaRequests=[{id:'existing-quota',status:'PENDING'}];f.parent.data.driverOperations.paymentRequests=[{id:'existing-payment',status:'PENDING'}];
  const forbidden=async()=>{assert.fail('Printing must not query or write approval, quota, wage, cost or payment models');};
  for(const model of ['directorApproval','driverRateScheme','jobCharge','payment','jobPayment','driverPayroll'])f.tx[model]=new Proxy({},{get:()=>forbidden});
  const before=structuredClone(f.parent.data),usage=ops.usage(ops.state(f.parent),'C1'),writes=f.writes.length;
  const snapshot=await (scope==='bill'?dispatch.issueBill(f.tx,user,'a',saved.id,{version:2,documentType:'BONRATE'}):dispatch.issueJourney(f.tx,user,'j',saved.id,{version:2,documentType:'BONRATE'}));
  assert.equal(snapshot.documentType,'BONRATE');assert.equal(snapshot.rateType,rateType);assert.equal(snapshot.taskDate,'2026-01-02');assert.deepEqual(snapshot.evidenceFileIds,[]);assert(dispatch.pdf(snapshot).length>1000);
  const after=structuredClone(f.parent.data),published=after.driverOperations.works.find(w=>w.id===saved.id);assert.equal(published.status,status);assert.equal(published.bonrateIssued,true);assert.equal(published.dispatches.length,1);delete published.bonrateIssued;published.dispatches=before.driverOperations.works.find(w=>w.id===saved.id).dispatches;
  assert.deepEqual(after,before,`${scope} ${rateType} ${budgetMode} ${status}`);assert.deepEqual(ops.usage(ops.state(f.parent),'C1'),usage);assert.equal(f.writes.length,writes+1);assert.equal(f.parent.version,3);
  const retry=await (scope==='bill'?dispatch.issueBill(f.tx,user,'a',saved.id,{version:2,documentType:'BONRATE'}):dispatch.issueJourney(f.tx,user,'j',saved.id,{version:2,documentType:'BONRATE'}));
  assert.equal(retry.id,snapshot.id);assert.deepEqual(dispatch.pdf(retry),dispatch.pdf(snapshot));assert.equal(f.writes.length,writes+1);
 }
});
test('direct publication refuses a new immutable snapshot for payroll-locked work but permits exact reprints',async()=>{
 for(const scope of ['journey','bill']){
  const f=setup(),saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work:input(f)}),stored=f.parent.data.driverOperations.works.find(w=>w.id===saved.id);
  stored.payrollId='locked-payroll';const before=structuredClone(f.parent),issue=()=>scope==='bill'?dispatch.issueBill(f.tx,user,'a',saved.id,{version:2,documentType:'BONRATE'}):dispatch.issueJourney(f.tx,user,'j',saved.id,{version:2,documentType:'BONRATE'});
  await assert.rejects(issue,e=>e.status===409&&/rekap upah/i.test(e.message));assert.deepEqual(f.parent,before);assert.equal(f.writes.length,1);
  delete stored.payrollId;const snapshot=await issue();f.parent.data.driverOperations.works.find(w=>w.id===saved.id).payrollId='locked-payroll';const retry=await issue();assert.equal(retry.id,snapshot.id);assert.deepEqual(dispatch.pdf(retry),dispatch.pdf(snapshot));assert.equal(f.writes.length,2);
 }
});
test('direct publication keeps readiness, lifecycle, source ownership, optional evidence and version guards',async()=>{
 for(const scope of ['journey','bill'])for(const change of ['cancelled','unknown-status','parent-archived','parent-deleted','bill-archived','bill-register-archived','bill-deleted','sibling-archived','recipient','destination','goods','received-date','completion-date','container-size','child-container','seal','missing-evidence','foreign-evidence','category','role','version','sibling-work']){
  const f=setup(),saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work:input(f)}),stored=f.parent.data.driverOperations.works.find(w=>w.id===saved.id);let actor=user,version=2,workId=saved.id;
  if(change==='cancelled')stored.status='CANCELLED';if(change==='unknown-status')stored.status='UNKNOWN';if(change==='parent-archived')f.parent.archivedAt='2026-01-03';if(change==='parent-deleted')f.parent.deletedAt='2026-01-03';if(change==='bill-archived')f.a.archivedAt='2026-01-03';if(change==='bill-register-archived')f.a.registerData.archivedAt='2026-01-03';if(change==='bill-deleted')f.a.registerData.trash={deletedAt:'2026-01-03'};
  if(change==='sibling-archived'){f.b.containers.push({number:'C1',size:'20'});stored.deliveries.push({...structuredClone(stored.deliveries[0]),id:'sibling',billId:'b',evidenceFileIds:['foreign']});f.b.archivedAt='2026-01-03';}
  if(change==='recipient')stored.deliveries[0].recipient=null;if(change==='destination')stored.deliveries[0].destination=null;if(change==='goods')stored.deliveries[0].items=[];if(change==='received-date')stored.deliveries[0].receivedDate='2999-01-01';if(change==='completion-date')stored.receivedDate='2026-01-01';if(change==='container-size')f.a.containers[0].size='40';if(change==='child-container')stored.deliveries[0].containerNumber='SHARED';if(change==='seal')f.a.containers[0].seal='NEW-SEAL';
  if(change==='missing-evidence')f.a.files=[];if(change==='foreign-evidence')stored.deliveries[0].evidenceFileIds=['foreign'];if(change==='category')f.a.files[0].category='SUPPORTING';if(change==='role')actor={...user,role:'CUSTOMER'};if(change==='version')version=1;if(change==='sibling-work')workId=scope==='bill'?'work-b':'missing';
  const before=structuredClone(f.parent);await assert.rejects(scope==='bill'?dispatch.issueBill(f.tx,actor,'a',workId,{version,documentType:'BONRATE'}):dispatch.issueJourney(f.tx,actor,'j',workId,{version,documentType:'BONRATE'}),e=>[403,404,409,422].includes(e.status),`${scope} ${change}`);assert.deepEqual(f.parent,before);assert.equal(f.writes.length,1);
 }
});
test('unissued completed BONRATE can still be cancelled without allocating quota',async()=>{
 const scoped=require('../src/services/billDriverOperations');for(const scope of ['journey','bill']){const f=setup(),saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work:input(f)});f.parent.data.driverOperations.budgets=[];const move=body=>scope==='bill'?scoped.transition(f.tx,user,'a',saved.id,body):ops.transition(f.tx,user,'j',saved.id,body);await move({version:2,status:'CANCELLED',reason:'Recorded in error'});assert.equal(f.parent.data.driverOperations.works.find(w=>w.id===saved.id).status,'CANCELLED');assert.deepEqual(f.parent.data.driverOperations.budgets,[]);const writes=f.writes.length;await assert.rejects(scope==='bill'?dispatch.issueBill(f.tx,user,'a',saved.id,{version:3,documentType:'BONRATE'}):dispatch.issueJourney(f.tx,user,'j',saved.id,{version:3,documentType:'BONRATE'}),e=>e.status===409);assert.equal(f.writes.length,writes);}
});
test('printed draft remains financially ineligible and exact historical BONRATE never rerenders',async()=>{
 for(const scope of ['journey','bill']){
  const f=setup(),saved=await ops.saveWork(f.tx,user,'j',null,{version:1,work:input(f)}),issue=()=>scope==='bill'?dispatch.issueBill(f.tx,user,'a',saved.id,{version:2,documentType:'BONRATE'}):dispatch.issueJourney(f.tx,user,'j',saved.id,{version:2,documentType:'BONRATE'}),snapshot=await issue(),bytes=dispatch.pdf(snapshot);
  await assert.rejects(ops.wageEstimate(f.tx,'j',{version:3,periodFrom:'2026-01-01',periodTo:'2026-01-31',workIds:[saved.id]}),e=>e.status===409);assert.equal(f.parent.version,3);
  const renderer=require('../src/services/bonratePdf'),original=renderer.renderBonratePdf;
  try{renderer.renderBonratePdf=async()=>{assert.fail('Saved immutable BONRATE must never rerender');};f.tx.company.findUnique=async()=>{assert.fail('Historical company must not be reloaded');};const stored=f.parent.data.driverOperations.works.find(w=>w.id===saved.id);stored.deliveries[0].recipient=null;stored.deliveries[0].evidenceFileIds=['deleted-proof'];f.parent.archivedAt='2026-01-03';f.a.archivedAt='2026-01-03';
   const replay=await issue();assert.equal(replay.id,snapshot.id);assert.deepEqual(dispatch.pdf(replay),bytes);assert.equal(f.parent.version,3);
   const historical=scope==='bill'?await dispatch.getBill(f.tx,'a',saved.id,snapshot.id):await dispatch.getJourney(f.tx,'j',saved.id,snapshot.id);assert.deepEqual(dispatch.pdf(historical),bytes);historical.pdfBase64=Buffer.from('corrupt saved PDF').toString('base64');assert.throws(()=>dispatch.pdf(historical),e=>e.status===409);assert.equal(f.writes.length,2);
  }finally{renderer.renderBonratePdf=original;}
 }
});
test('legacy dispatch retains explicit confirmation for both document types',async()=>{
 for(const documentType of ['TRANSPORT_ORDER','DELIVERY_NOTE'])for(const confirmed of [undefined,false]){
  const f=setup();await assert.rejects(dispatch.issueBill(f.tx,user,'a','work-a',{version:1,documentType,confirmed}),e=>e.status===422&&/Konfirmasikan/i.test(e.message));assert.equal(f.writes.length,0);
 }
});
module.exports={setup,input,user};

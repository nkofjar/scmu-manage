const test=require('node:test'),assert=require('node:assert/strict');
const packing=require('../src/services/voyagePacking'),journeys=require('../src/services/journeys'),overview=require('../src/services/journeyOverview');
function fixture(){
 const journey={id:'journey',number:'PGR-1',version:1,vesselName:'KM UJI',voyageNumber:'10',period:'2026-11',destination:'Merauke',data:{keep:true},files:[]};
 const bills=[1,2].map(n=>({id:'b'+n,journeyId:journey.id,jobId:'job'+n,version:1,contentVersion:1,billNumber:'BL'+n,vesselName:journey.vesselName,voyageNumber:journey.voyageNumber,portOfDischarge:journey.destination,packages:100,shipperName:'Sender',consigneeName:'Receiver',containers:[{number:'CONT'+n,seal:'SEAL'}],files:[],allocations:[],shipment:{mode:'SEA',status:'PENDING'},registerData:{register:{packageUnit:'SAK'},containers:[{number:'CONT'+n,seal:'SEAL',size:'20',goodsDescription:'Rice'}]}}));
 journey.bills=bills;const logs=[],writes=[];
 const tx={seaBill:{findFirst:async({where})=>bills.find(b=>b.id===where.id),findUnique:async({where})=>bills.find(b=>b.id===where.id),update:async({where,data})=>{writes.push(data);const b=bills.find(b=>b.id===where.id);Object.assign(b,{...data,version:b.version+1});return b;}},jobOrder:{findUnique:async()=>({status:'IN_PROGRESS'})},shippingJourney:{findUnique:async()=>journey,findMany:async()=>[journey],update:async({data})=>{writes.push(data);return Object.assign(journey,{...data,version:journey.version+1});}},seaBillFile:{create:async({data})=>{writes.push(data);const file={...data,id:'f'+writes.length};bills.find(b=>b.id===data.billId).files.push(file);return file;}},activityLog:{create:async({data})=>logs.push(data),findMany:async()=>logs}};
 const save=async()=>{const body={selection:bills.map(b=>({id:b.id,version:b.version})),config:{number:'RPL-1'}},data=(await packing.read(tx,body)).data;return packing.save(tx,{id:'staff'},{...body,confirmed:true,fingerprint:data.fingerprint},{filename:'saved.xlsx'},data);};
 return {journey,bills,tx,logs,writes,save};
}
test('journey list packing status is DRAFT until publication and SAVED immediately after version-incrementing save',async()=>{
 const f=fixture();assert.equal(overview.facts(f.journey).outputStatus,'DRAFT');assert.equal(overview.facts(f.journey).savedAt,null);
 const preview=(await packing.read(f.tx,{selection:f.bills.map(b=>({id:b.id,version:b.version})),config:{number:'PREVIEW'}})).data;
 assert(preview.records.every(r=>r.rows.every(row=>row.sourceType==='BL_MANUAL')));
 const snapshot=await f.save(),pointer=structuredClone(f.journey.data.voyagePacking),before=structuredClone(f.journey),writes=f.writes.length;
 assert.equal(f.bills[0].version,2);assert.equal(f.journey.version,2);
 const result=await journeys.list(f.tx),facts=result.data[0].packing;
 assert.equal(facts.outputStatus,'SAVED');assert.equal(facts.savedAt,snapshot.generatedAt);assert.equal(result.data[0].billCount,2);assert.equal(result.data[0].containerCount,2);
 assert.match(pointer.sourceSignature,/^[a-f0-9]{64}$/);assert.equal(f.writes.length,writes);assert.deepEqual(f.journey,before);assert.equal(f.journey.data.keep,true);
 const file=f.bills[0].files.find(file=>file.category===packing.CATEGORY);assert.deepEqual(await packing.savedSnapshot(f.tx,'b1',file.id),snapshot);
});

function partner(bill){
 bill.files.push({id:'pl',filename:'partner.xlsx',originalName:'Partner.xlsx',category:'PACKING_LIST'});
 bill.registerData.operational={packing:{status:'CONFIRMED',sourceFileIds:['pl'],groups:[{id:'group',containerNumber:'CONT1',sourceFileId:'pl',recipientName:'Shop',recipientAddress:'Address',items:[{id:'item',description:'Rice',packages:7,packageUnit:'SAK'}]}]}};
}
test('published recap becomes CHANGED for membership, versions, cargo, source files and journey metadata without rewriting saved output',async()=>{
 const changes={
  added:f=>f.bills.push({...structuredClone(f.bills[1]),id:'b3',billNumber:'BL3'}),
  removed:f=>f.bills.pop(),trashed:f=>f.bills[0].registerData.trash={deletedAt:'2026-11-01'},archived:f=>f.bills[0].archivedAt='2026-11-01',
  version:f=>f.bills[0].version++,contentVersion:f=>f.bills[0].contentVersion++,cargo:f=>f.bills[1].registerData.containers[0].goodsDescription='Cement',quantity:f=>f.bills[0].packages=101,
  consignee:f=>f.bills[0].consigneeName='New receiver',seal:f=>f.bills[0].containers[0].seal='NEW',
  partner:f=>f.bills[0].registerData.operational.packing.groups[0].recipientAddress='New address',
  item:f=>f.bills[0].registerData.operational.packing.groups[0].items[0].packages=8,
  source:f=>f.bills[0].files.find(file=>file.id==='pl').filename='replacement.xlsx',
  unconfirmed:f=>f.bills[0].registerData.operational.packing.status='DRAFT',
  remapped:f=>f.bills[0].registerData.operational.packing.groups[0].containerNumber='OTHER',
  period:f=>f.journey.period='2026-12',destination:f=>f.journey.destination='Jayapura',
  departure:f=>f.journey.departureDate='2026-11-02',arrival:f=>f.journey.arrivalDate='2026-11-03',notes:f=>f.journey.notes='New handling',voyage:f=>f.journey.voyageNumber='11',
  missingOutput:f=>f.bills[0].files=f.bills[0].files.filter(file=>file.category!==packing.CATEGORY)
 };
 for(const [name,change] of Object.entries(changes)){
  const f=fixture();partner(f.bills[0]);await f.save();assert.equal(overview.facts(f.journey).outputStatus,'SAVED',name+' baseline');
  const pointer=structuredClone(f.journey.data.voyagePacking),logs=structuredClone(f.logs),writes=f.writes.length;
  change(f);const facts=(await journeys.list(f.tx)).data[0].packing;
  assert.equal(facts.outputStatus,'CHANGED',name);assert.equal(facts.savedAt,pointer.generatedAt,name);assert.deepEqual(f.journey.data.voyagePacking,pointer,name);assert.deepEqual(f.logs,logs,name);assert.equal(f.writes.length,writes,name);
 }
});
test('legacy pointers without a source signature are cautiously CHANGED, and attachments alone do not imply publication',async()=>{
 const f=fixture();f.bills[0].files.push({id:'old',filename:'legacy.xlsx',category:packing.CATEGORY});
 assert.equal(overview.facts(f.journey).outputStatus,'DRAFT');await f.save();
 delete f.journey.data.voyagePacking.sourceSignature;
 assert.equal(overview.facts(f.journey).outputStatus,'CHANGED');assert.equal(overview.facts(f.journey).savedAt,f.journey.data.voyagePacking.generatedAt);
 delete f.journey.data.voyagePacking.generatedAt;assert.equal(overview.facts(f.journey).savedAt,null);
});
test('input ordering and publication-only bookkeeping never mark a saved recap changed',async()=>{
 const f=fixture();partner(f.bills[0]);await f.save();f.bills.reverse();f.bills[0].files.reverse();f.journey.version++;f.journey.updatedAt=new Date();f.journey.data.driverOperations={works:[]};
 assert.equal(overview.facts(f.journey).outputStatus,'SAVED');
});

test('journey metadata changed since preview rejects publication before any writes',async()=>{
 for(const key of ['departureDate','arrivalDate','notes','vesselId']){
  const f=fixture(),body={selection:f.bills.map(b=>({id:b.id,version:b.version})),config:{number:'REVIEWED'}};
  const {data}=await packing.read(f.tx,body);f.journey[key]=key.endsWith('Date')?'2026-11-04':'changed';
  await assert.rejects(packing.save(f.tx,{id:'staff'},{...body,confirmed:true,fingerprint:data.fingerprint},{filename:'no.xlsx'},data),error=>error.status===409,key);
  assert.equal(f.writes.length,0,key);
 }
});

test('active journey membership changes after preview reject publication before writes',async()=>{
 for(const change of [f=>f.bills.push({...structuredClone(f.bills[1]),id:'b3',billNumber:'BL3'}),f=>f.bills.pop(),f=>{f.bills[1].registerData.trash={deletedAt:'2026-11-04'};},f=>{f.bills[1].archivedAt='2026-11-04';}]){
  const f=fixture(),body={selection:[{id:'b1',version:1}],config:{number:'REVIEWED'}};
  const {data}=await packing.read(f.tx,body);change(f);f.journey.version++;
  await assert.rejects(packing.save(f.tx,{id:'staff'},{...body,confirmed:true,fingerprint:data.fingerprint},{filename:'no.xlsx'},data),error=>error.status===409);
  assert.equal(f.writes.length,0);
 }
});
test('separate packing header metadata does not change the shipment source signature',async()=>{
 const f=fixture();partner(f.bills[0]);await f.save();
 f.bills[0].registerData.operational.packing.headerNumber='HEAD-2';
 f.bills[0].registerData.operational.packing.headerStatus='READY';
 assert.equal((await journeys.list(f.tx)).data[0].packing.outputStatus,'SAVED');
});
test('historical snapshot remains readable beyond 200 newer publications with exact bill and file ownership',async()=>{
 const f=fixture(),snapshot=await f.save(),file=f.bills[0].files.find(file=>file.category===packing.CATEGORY);
 const original=f.logs.find(log=>log.metadata.fileId===file.id);
 const newer=Array.from({length:205},(_,i)=>({metadata:{seaBillId:'b1',fileId:'new-'+i,snapshot:{kind:packing.kind}}}));
 f.tx.activityLog.findMany=async({where,take})=>{
  const filters=(where.AND||[]).filter(filter=>filter.metadata);
  return [...newer,original].filter(log=>filters.every(filter=>log.metadata[filter.metadata.path[0]]===filter.metadata.equals)).slice(0,take);
 };
 assert.deepEqual(await packing.savedSnapshot(f.tx,'b1',file.id),snapshot);
 original.metadata.seaBillId='b2';
 await assert.rejects(packing.savedSnapshot(f.tx,'b1',file.id),error=>error.status===404);
});

test('external partner source ownership changes are detected through the same document scope lookup as publication',async()=>{
 const f=fixture();partner(f.bills[0]);let shared=false;
 f.tx.seaBillFile.findMany=async()=>shared?[{filename:'partner.xlsx',bill:{id:'outside',billNumber:'OTHER'}}]:[];
 await f.save();assert.equal((await journeys.list(f.tx)).data[0].packing.outputStatus,'SAVED');
 shared=true;assert.equal((await journeys.list(f.tx)).data[0].packing.outputStatus,'CHANGED');
 // Saving an explicitly reviewed shared mapping must also remain SAVED on list reads.
 f.bills[0].registerData.operational.packing.scopeConfirmed=true;await f.save();
 assert.equal((await journeys.list(f.tx)).data[0].packing.outputStatus,'SAVED');
});

test('authenticated journey HTTP list and detail expose savedAt and status without publication side effects',async()=>{
 const express=require('express'),prisma=require('../src/prisma'),f=fixture();f.tx.seaBillFile.findMany=async()=>[];f.tx.seaBillCargo={findMany:async()=>[]};await f.save();const restore=[];
 for(const [model,methods] of Object.entries(f.tx))for(const [method,fn] of Object.entries(methods)){const original=prisma[model][method];restore.push(()=>prisma[model][method]=original);prisma[model][method]=fn;}
 const original=prisma.$transaction;prisma.$transaction=async work=>work(prisma);restore.push(()=>prisma.$transaction=original);
 const app=express();app.use((req,res,next)=>{req.user={id:'staff',role:'ADMIN'};next();});app.use('/journeys',require('../src/routes/journeys'));app.use((error,req,res,next)=>res.status(error.status||500).json({message:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const root=`http://127.0.0.1:${server.address().port}/journeys`,writes=f.writes.length;
 try{
  for(const path of ['', '/journey']){const response=await fetch(root+path),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));const row=path?body:body.data[0];assert.equal(row.packing.outputStatus,'SAVED');assert.equal(row.packing.savedAt,f.journey.data.voyagePacking.generatedAt);}
  f.bills[0].version++;const response=await fetch(root);assert.equal((await response.json()).data[0].packing.outputStatus,'CHANGED');assert.equal(f.writes.length,writes);
 }finally{await new Promise(resolve=>server.close(resolve));for(const reset of restore.reverse())reset();}
});

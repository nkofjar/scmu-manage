const test=require('node:test'),assert=require('node:assert/strict');
const service=require('../src/services/journeys'),sea=require('../src/services/seaBills');
const admin={id:'admin',role:'ADMIN'};
function fixture(){
 const source={id:'source',journeyId:'journey',category:'SUPPORTING',filename:'journey-support.txt',originalName:'support.txt',mimeType:'text/plain',size:10,createdAt:new Date('2026-10-01')};
 const bill=id=>({...sea.metadata({billNumber:'BL-'+id}),id,journeyId:'journey',jobId:'job-'+id,version:2,contentVersion:1,registerData:{},files:[],allocations:[],shipment:{mode:'SEA',status:'PENDING'}});
 const row={id:'journey',number:'PGR-1',version:3,data:{},files:[source],bills:[bill('a'),bill('b')]},writes=[],logs=[],revisions=[];
 const find=id=>row.bills.find(b=>b.id===id);
 const update=(target,data)=>{writes.push(data);for(const [k,v]of Object.entries(data))target[k]=v?.increment!==undefined?target[k]+v.increment:v;return target;};
 const tx={
  shippingJourney:{findUnique:async()=>row,update:async({data})=>update(row,data)},
  seaBill:{findFirst:async({where})=>find(where.id),findUnique:async({where})=>find(where.id),update:async({where,data})=>update(find(where.id),data)},
  jobOrder:{findUnique:async()=>({status:'IN_PROGRESS'})},
  seaBillFile:{findMany:async()=>row.bills.flatMap(b=>b.files),count:async()=>row.bills.flatMap(b=>b.files).filter(f=>f.filename===source.filename).length,create:async({data})=>{writes.push(data);const f={id:'alias-'+writes.length,...data};find(data.billId).files.push(f);return f;},delete:async({where})=>{for(const b of row.bills)b.files=b.files.filter(f=>f.id!==where.id);writes.push(where);}},
  seaBillRevision:{findMany:async()=>revisions,create:async({data})=>{revisions.push(data);return data;}},
  activityLog:{findMany:async()=>logs,create:async({data})=>{logs.push(data);return data;}},
  journeyFile:{delete:async({where})=>{row.files=row.files.filter(f=>f.id!==where.id);writes.push(where);}},
  jobDocument:{count:async()=>0},
  documentFilePurge:{upsert:async q=>{writes.push(q);return q;}}
 };
 const linked=(b,id='linked-'+b)=>{const f={...source,id,billId:b,externalNumber:source.id,contentVersion:1};delete f.journeyId;find(b).files.push(f);return f;};
 return {tx,row,writes,logs,revisions,source,linked};
}
test('exact set adds, replaces and clears only proven supporting relations without purging sources or resetting release',async()=>{
 const f=fixture();
 let result=await service.setFileLinks(f.tx,admin,'journey','source',{version:3,billIds:['a','a']});
 assert.deepEqual(result.billIds,['a']);assert.equal(result.version,4);assert.equal(f.row.bills[0].files[0].externalNumber,'source');
 const first=f.row.bills[0].files[0].id;f.row.bills[0].releaseStatus='SEA_RELEASE_CONFIRMED';
 result=await service.setFileLinks(f.tx,admin,'journey','source',{version:4,billIds:['b']});
 assert.deepEqual(result.billIds,['b']);assert.equal(f.row.bills[0].files.length,0);assert.equal(f.row.bills[0].releaseStatus,'SEA_RELEASE_CONFIRMED');
 result=await service.setFileLinks(f.tx,admin,'journey','source',{version:5,billIds:[]});
 assert.deepEqual(result.billIds,[]);assert.equal(f.row.files.length,1);assert.equal(f.row.bills[1].files.length,0);
 assert.equal(f.revisions[0].snapshot.files[0].id,first);assert.equal(f.logs.at(-1).action,'JOURNEY_FILE_LINKS_UPDATED');assert(!f.writes.some(w=>w.create?.filename));
});
test('exact set validates all targets, versions, ownership and read-only states before any writes',async()=>{
 const cases=[
  [f=>{}, {version:3,billIds:['a','foreign']},422],
  [f=>{}, {version:3,billIds:['a',null]},422],
  [f=>{}, {version:3,billIds:Array(101).fill('a')},422],
  [f=>{}, {billIds:[]},422],
  [f=>{}, {version:2,billIds:[]},409],
  [f=>{f.row.archivedAt=new Date();}, {version:3,billIds:[]},409],
  [f=>{f.row.deletedAt=new Date();}, {version:3,billIds:[]},409],
  [f=>{f.row.bills[1].archivedAt=new Date();}, {version:3,billIds:['a','b']},409],
  [f=>{f.row.bills[1].registerData.archivedAt='2026-10-01';}, {version:3,billIds:['a','b']},409],
  [f=>{f.row.bills[1].registerData.trash={deletedAt:'2026-10-01'};}, {version:3,billIds:['a','b']},409],
  [f=>{f.source.category='PACKING_LIST';}, {version:3,billIds:[]},422],
  [f=>{f.source.readOnly=true;}, {version:3,billIds:[]},409],
 ];
 for(const [setup,body,status]of cases){const f=fixture();setup(f);await assert.rejects(service.setFileLinks(f.tx,admin,'journey','source',body),e=>e.status===status);assert.equal(f.writes.length,0);assert.equal(f.logs.length,0);}
 const f=fixture();await assert.rejects(service.setFileLinks(f.tx,{id:'user',role:'CUSTOMER'},'journey','source',{version:3,billIds:[]}),e=>e.status===403);await assert.rejects(service.setFileLinks(f.tx,admin,'journey','foreign',{version:3,billIds:[]}),e=>e.status===404);assert.equal(f.writes.length,0);
});
test('unlink refuses unproven independent, other-category and hidden legacy aliases',async()=>{
 for(const kind of ['unproven','other-source','category','legacy','allocation']){
  const f=fixture(),alias=f.linked('b');
  if(kind==='unproven')alias.externalNumber=null;if(kind==='other-source')alias.externalNumber='different';if(kind==='category')alias.category='PAYMENT_PROOF';
  if(kind==='legacy')f.row.bills[1].document={id:'legacy',filename:f.source.filename};
  if(kind==='allocation')f.row.bills[1].allocations=[{packingListId:'packing',packingList:{document:{id:'legacy-packing',filename:f.source.filename}}}];
  await assert.rejects(service.setFileLinks(f.tx,admin,'journey','source',{version:3,billIds:['a']}),e=>e.status===409);assert.equal(f.writes.length,0);assert.equal(f.row.bills[1].files.length,1);
 }
 const f=fixture();const independent=f.linked('a');independent.externalNumber=null;
 await service.setFileLinks(f.tx,admin,'journey','source',{version:3,billIds:['a']});assert.deepEqual(f.row.bills[0].files,[independent]);
});
test('unlink blocks operational evidence, packing/report/checklist and immutable historical use without invalidation',async()=>{
 const setups=[
  (f,a)=>{f.row.data.driverOperations={works:[{evidenceFileIds:[a.id]}]};},
  (f,a)=>{f.row.data.driverOperations={quotaRequests:[{evidenceFileIds:[a.id]}]};},
  (f,a)=>{f.row.data.driverOperations={paymentRequests:[{evidenceFileIds:[a.id]}]};},
  (f,a)=>{f.row.data.driverOperations={recaps:[{works:[{evidenceFileIds:[a.id]}]}]};},
  (f,a)=>{f.row.data.driverBons=[{evidenceFileIds:[a.id]}];},
  (f,a)=>{f.row.data.driverBons=[{evidenceFileIds:['source']}];},
  (f,a)=>{f.row.bills[1].releaseProofId=a.id;},
  (f,a)=>{f.row.bills[1].registerData.manualPacking={sourceFileIds:[a.id]};},
  (f,a)=>{f.row.bills[1].registerData.receivingReport={groups:[{sourceFileId:a.id}]};},
  (f,a)=>{f.row.bills[1].registerData.operational={packing:{groups:[{sourceFileId:a.id}]}};},
  (f,a)=>{f.row.bills[1].registerData.packingFieldCheck={evidenceFileIds:[a.id]};},
  (f,a)=>{f.row.bills[0].registerData.manualPacking={sourceFileIds:[a.id]};},
  (f,a)=>{f.revisions.push({snapshot:{releaseProofId:a.id}});},
  (f,a)=>{f.logs.push({action:'INTERNAL_PACKING_LIST_CREATED',metadata:{snapshot:{sources:[{id:a.id,filename:a.filename}]}}});},
 ];
 for(const setup of setups){const f=fixture(),alias=f.linked('b');setup(f,alias);const before=JSON.stringify(f.row);await assert.rejects(service.setFileLinks(f.tx,admin,'journey','source',{version:3,billIds:['a']}),e=>e.status===409);assert.equal(f.writes.length,0);assert.equal(JSON.stringify(f.row),before);}
});
test('unlink refuses archived/trash or read-only linked attachments and retains the entire set',async()=>{
 for(const setup of [(f,a)=>{f.row.bills[1].archivedAt=new Date();},(f,a)=>{f.row.bills[1].registerData.trash={deletedAt:'2026-10-01'};},(f,a)=>{a.readOnly=true;}]){
  const f=fixture(),alias=f.linked('b');setup(f,alias);await assert.rejects(service.setFileLinks(f.tx,admin,'journey','source',{version:3,billIds:['a']}),e=>e.status===409);assert.equal(f.writes.length,0);
 }
});
test('safe deletion requires reason/version/role, known ownership and rejects every linked or used reference',async()=>{
 for(const setup of [f=>{f.linked('a');},f=>{f.row.bills[0].document={id:'legacy',filename:f.source.filename};},f=>{f.row.bills[0].archivedAt=new Date();f.linked('a');},f=>{f.row.bills[0].registerData.trash={deletedAt:'2026-10-01'};f.row.bills[0].allocations=[{packingList:{document:{id:'packing',filename:f.source.filename}}}];}]){
  const f=fixture();setup(f);await assert.rejects(service.removeFile(f.tx,admin,'journey','source',{version:3,reason:'Wrong upload'}),e=>e.status===409&&/Lepaskan tautan/.test(e.message));assert.equal(f.writes.length,0);
 }
 for(const [setup,body,user,status]of [
  [f=>{}, {reason:'remove'},admin,422], [f=>{}, {version:2,reason:'remove'},admin,409], [f=>{}, {version:3,reason:'  '},admin,422],
  [f=>{}, {version:3,reason:'remove'},{id:'other',role:'CUSTOMER'},403],
  [f=>{f.row.archivedAt=new Date();},{version:3,reason:'remove'},admin,409], [f=>{f.row.deletedAt=new Date();},{version:3,reason:'remove'},admin,409],
  [f=>{f.source.readOnly=true;},{version:3,reason:'remove'},admin,409], [f=>{f.source.category='UNKNOWN';},{version:3,reason:'remove'},admin,422],
  [f=>{f.row.data.driverBons=[{evidenceFileIds:['source']}];},{version:3,reason:'remove'},admin,409],
  [f=>{f.row.data.driverOperations={paymentRequests:[{evidenceFileIds:['source']}]};},{version:3,reason:'remove'},admin,409],
  [f=>{f.logs.push({action:'PACKING_HEADER_CREATED',metadata:{snapshot:{sources:[{id:'source'}]}}});},{version:3,reason:'remove'},admin,409],
 ]){const f=fixture();setup(f);await assert.rejects(service.removeFile(f.tx,user,'journey','source',body),e=>e.status===status);assert.equal(f.writes.length,0);}
 const f=fixture();await assert.rejects(service.removeFile(f.tx,admin,'journey','foreign',{version:3,reason:'remove'}),e=>e.status===404);assert.equal(f.writes.length,0);
});
test('safe deletion queues only the parent source and audits a reason without altering B/L or history',async()=>{
 for(const category of ['SUPPORTING','MANIFEST','WAYBILL','RELEASE','POWER_OF_ATTORNEY','PACKING_LIST','DELIVERY_RECEIPT']){
  const f=fixture();f.source.category=category;const bills=JSON.stringify(f.row.bills);
  const result=await service.removeFile(f.tx,admin,'journey','source',{version:3,reason:'Duplicate upload'});
  assert.equal(result.filename,f.source.filename);assert.equal(result.version,4);assert.equal(f.row.files.length,0);assert.equal(f.row.version,4);assert.equal(JSON.stringify(f.row.bills),bills);
  assert.equal(f.logs[0].action,'JOURNEY_FILE_REMOVED');assert.equal(f.logs[0].metadata.reason,'Duplicate upload');assert(f.writes.some(w=>w.create?.filename===f.source.filename));
 }
});
test('HTTP exact set supports empty selections and retains additive POST clients; DELETE unlinks first then purges',async()=>{
 const express=require('express'),prisma=require('../src/prisma'),purger=require('../src/services/documentFilePurge');
 const f=fixture(),saved=[],purged=[];const transaction=prisma.$transaction,purge=purger.purge;let server;
 for(const [model,methods]of Object.entries(f.tx))for(const [method,fn]of Object.entries(methods)){saved.push([prisma[model],method,prisma[model][method]]);prisma[model][method]=fn;}
 prisma.$transaction=async(fn,options)=>{assert.equal(options.isolationLevel,'Serializable');return fn(prisma);};purger.purge=async name=>{purged.push(name);return {cleanupPending:false};};
 try{
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={...admin,role:req.headers['x-role']||admin.role};next();});app.use('/journeys',require('../src/routes/journeys'));app.use((error,req,res,next)=>res.status(error.status||500).json({message:error.message}));
  server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));const root=`http://127.0.0.1:${server.address().port}/journeys/journey/files/source`;
  const send=(method,path,body,role)=>fetch(root+path,{method,headers:{'content-type':'application/json',...(role?{'x-role':role}:{})},body:JSON.stringify(body)});
  let response=await send('PUT','/link',{version:3,billIds:['a']});assert.equal(response.status,200);assert.deepEqual((await response.json()).billIds,['a']);
  response=await send('DELETE','',{version:4,reason:'Duplicate'});assert.equal(response.status,409);assert.match((await response.json()).message,/Lepaskan tautan/);assert.deepEqual(purged,[]);
  response=await send('PUT','/link',{version:3,billIds:[]});assert.equal(response.status,409);
  response=await send('PUT','/link',{version:4,billIds:[]},'CUSTOMER');assert.equal(response.status,403);
  response=await send('PUT','/link',{version:4,billIds:[]});assert.equal(response.status,200);assert.equal((await response.json()).version,5);
  response=await send('POST','/link',{version:5,billIds:['b']});assert.equal(response.status,200);assert.equal(f.row.bills[1].files.length,1);
  response=await send('PUT','/link',{version:6,billIds:[]});assert.equal(response.status,200);
  response=await send('DELETE','',{version:7,reason:'Duplicate'});assert.equal(response.status,200);assert.equal((await response.json()).removed,true);assert.deepEqual(purged,[f.source.filename]);
 }finally{for(const [model,method,fn]of saved)model[method]=fn;prisma.$transaction=transaction;purger.purge=purge;if(server)await new Promise(resolve=>server.close(resolve));}
});
module.exports={fixture,admin};

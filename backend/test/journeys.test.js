const test=require('node:test'),assert=require('node:assert/strict'),service=require('../src/services/journeys');
test('journey identity separates voyage periods and destinations; drafts are never silently merged',()=>{
 const base={vesselName:'KM. TANTO SIAP',voyageNumber:'V.165',period:'2026',destination:'Merauke'};
 assert.equal(service.keyOf(base),service.keyOf({...base,vesselName:'TANTO SIAP',voyageNumber:'165'}));
 assert.notEqual(service.keyOf(base),service.keyOf({...base,period:'2027'}));assert.notEqual(service.keyOf(base),service.keyOf({...base,destination:'Jayapura'}));
 assert.equal(service.keyOf({...base,voyageNumber:null}),null);assert.throws(()=>service.normalize({period:'2026-13'}));assert.throws(()=>service.normalize({departureDate:'2026-10-30',arrivalDate:'2026-10-01'}));
});
test('supporting document policy keeps B/L, partner PL, and delivery receipt on their owning tabs',()=>{
 const allowed=['SUPPORTING','RECEIVING_REPORT','PAYMENT_PROOF','DELIVERY_ORDER','INVOICE'];
 for(const category of allowed)assert.equal(service.isSupportingDocumentCategory(category),true,category);
 for(const category of ['DRAFT','FINAL','BILL_OF_LADING','PACKING_LIST','INTERNAL_PACKING_LIST','DELIVERY_RECEIPT','DRIVER_BON'])assert.equal(service.isSupportingDocumentCategory(category),false,category);
});
function uploadFixture(){
 const row={id:'parent',version:3,data:{},files:[],bills:[]},writes=[],logs=[];
 const tx={shippingJourney:{findUnique:async()=>row,update:async q=>{writes.push(q);row.version++;return row;}},journeyFile:{create:async({data})=>{const f={id:'file-'+row.files.length,...data};row.files.push(f);writes.push(f);return f;}},activityLog:{create:async({data})=>{logs.push(data);return data;}}};
 // Plain text attachments exercise real attachment validation without a filesystem mock.
 const file={filename:'fixture.txt',originalname:'fixture.txt',mimetype:'text/plain',size:10};
 return {row,tx,writes,logs,file};
}
test('supporting uploads retain general legacy categories but never accept reserved ownership categories',async()=>{
 for(const category of ['MANIFEST','WAYBILL','TAX_INVOICE','PPH23_CERTIFICATE','RELEASE']){
  const f=uploadFixture();await service.attach(f.tx,{id:'staff'},'parent',{version:3,category},f.file);
  assert.equal(f.row.files[0].category,category);assert.equal(f.logs[0].action,'JOURNEY_SUPPORTING_FILE_UPLOADED');assert.equal(f.row.version,4);
 }
 for(const category of ['DRAFT','FINAL','LEGACY','BILL_OF_LADING','PACKING_LIST','INTERNAL_PACKING_LIST','INTERNAL_PACKING_RECAP','PACKING_HEADER','DELIVERY_RECEIPT','POD','DRIVER_BON','UNRECOGNIZED_NEW_UPLOAD']){
  const f=uploadFixture();await assert.rejects(service.attach(f.tx,{id:'staff'},'parent',{version:3,category},f.file));assert.equal(f.writes.length,0);assert.equal(f.logs.length,0);
 }
 for(const category of ['MANIFEST','WAYBILL','OLD_CUSTOM_CATEGORY'])assert.equal(service.isSupportingDocumentCategory(category),true);
 for(const category of ['LEGACY','INTERNAL_PACKING_RECAP','PACKING_HEADER','POD'])assert.equal(service.isSupportingDocumentCategory(category),false);
});
test('packing and driver upload boundaries enforce their policy, audit owner and optimistic lifecycle guards',async()=>{
 for(const [method,categories,action] of [['attachPacking',['PACKING_LIST'],'JOURNEY_PACKING_FILE_UPLOADED'],['attachDriverEvidence',['DELIVERY_RECEIPT','PAYMENT_PROOF'],'DRIVER_EVIDENCE_UPLOADED']]){
  for(const category of categories){const f=uploadFixture();await service[method](f.tx,{id:'staff'},'parent',{version:3,category},f.file);assert.equal(f.logs[0].action,action);assert.equal(f.row.files[0].category,category);}
  for(const category of ['FINAL','INTERNAL_PACKING_RECAP','DRIVER_BON','SUPPORTING',...(method==='attachPacking'?['DELIVERY_RECEIPT']:['PACKING_LIST'])]){
   const f=uploadFixture();await assert.rejects(service[method](f.tx,{id:'staff'},'parent',{version:3,category},f.file),e=>method==='attachPacking'?/Packing List/.test(e.message):/Bonrate/.test(e.message));assert.equal(f.writes.length,0);
  }
 }
 for(const method of ['attach','attachPacking','attachDriverEvidence'])for(const closed of ['stale','archivedAt','deletedAt']){
  const f=uploadFixture();if(closed!=='stale')f.row[closed]=new Date();
  await assert.rejects(service[method](f.tx,{id:'staff'},'parent',{version:closed==='stale'?2:3,category:method==='attach'?'SUPPORTING':method==='attachPacking'?'PACKING_LIST':'DELIVERY_RECEIPT'},f.file),e=>e.status===409);assert.equal(f.writes.length,0);assert.equal(f.logs.length,0);
 }
});
test('packing HTTP upload persists on its owning endpoint and removes rejected multipart files',async()=>{
 const express=require('express'),fs=require('node:fs/promises'),prisma=require('../src/prisma'),jobFiles=require('../src/services/jobFiles');
 const f=uploadFixture(),saved=[],created=[];let server;
 const originalTransaction=prisma.$transaction;
 for(const [model,methods]of Object.entries(f.tx))for(const [method,fn]of Object.entries(methods)){saved.push([prisma[model],method,prisma[model][method]]);prisma[model][method]=fn;}
 prisma.$transaction=async fn=>fn(prisma);
 const originalUpload=jobFiles.uploadAny;
 jobFiles.uploadAny=(req,res,done)=>originalUpload(req,res,error=>{if(req.file)created.push(req.file.filename);done(error);});
 try{
  const app=express();app.use((req,res,next)=>{req.user={id:'staff',role:'ADMIN'};next();});app.use('/journeys',require('../src/routes/journeys'));app.use((error,req,res,next)=>res.status(error.status||500).json({message:error.message}));
  server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));const root=`http://127.0.0.1:${server.address().port}/journeys/parent/packing-files`;
  const send=async(category,version)=>{const data=new FormData();data.set('category',category);data.set('version',String(version));data.set('file',new Blob(['packing source'],{type:'text/plain'}),'source.txt');return fetch(root,{method:'POST',body:data});};
  let response=await send('PACKING_LIST',3);assert.equal(response.status,201);const body=await response.json();assert.equal(body.id,f.row.files[0].id);assert.equal(f.logs[0].action,'JOURNEY_PACKING_FILE_UPLOADED');await fs.access(jobFiles.filePath(created[0]));
  for(const [category,version,closed,status]of [['FINAL',4,false,422],['PACKING_LIST',3,false,409],['PACKING_LIST',4,true,409]]){
   f.row.archivedAt=closed?new Date():null;response=await send(category,version);assert.equal(response.status,status);await assert.rejects(fs.access(jobFiles.filePath(created.at(-1))),e=>e.code==='ENOENT');assert.equal(f.row.files.length,1);
  }
 }finally{
  for(const [model,method,fn]of saved)model[method]=fn;prisma.$transaction=originalTransaction;jobFiles.uploadAny=originalUpload;if(server)await new Promise(resolve=>server.close(resolve));
  for(const name of created)await jobFiles.removeFile(name);
 }
});
test('parent counts physical containers and shared files once, with all B/L references retained',async()=>{
 const bill=(id,number,origin)=>({id,billNumber:number,jobId:'job-'+id,portOfLoading:origin,containers:[{number:'CONT1',seal:'S'}],registerData:{},files:[{id:'file-'+id,filename:'shared.xlsx',originalName:'rekap.xlsx',category:'INTERNAL_PACKING_RECAP'}],allocations:[]});
 const row={id:'parent',version:1,data:{},files:[{id:'note',filename:'note.txt',originalName:'note.txt',category:'SUPPORTING'}],bills:[bill('a','BL1','Surabaya'),bill('b','BL2','Makassar')]};
 const tx={shippingJourney:{findUnique:async()=>row}};const counts=service.summary(row);assert.equal(counts.billCount,2);assert.equal(counts.containerCount,1);assert.equal(counts.documentCount,2);assert.equal(counts.containers[0].billIds.length,2);
 const docs=await service.documents(tx,'parent');assert.equal(docs.data.length,2);assert.deepEqual(docs.data.find(f=>f.originalName==='rekap.xlsx').billNumbers,['BL1','BL2']);assert(docs.data.every(f=>f.filename===undefined));
});
test('filename deduplication keeps raw evidence aliases including hidden legacy and linked packing IDs',async()=>{
 const common={filename:'shared.txt',originalName:'Shared',category:'SUPPORTING'};
 const row={id:'j',version:1,files:[{...common,id:'journey-a'},{...common,id:'journey-b'}],bills:[{id:'bill',billNumber:'BL1',registerData:{},files:[{...common,id:'bill-file'}],document:{...common,id:'legacy-document'},allocations:[{packingList:{document:{...common,id:'packing-document'}}}]}]};
 const result=await service.documents({shippingJourney:{findUnique:async()=>row}},'j');assert.equal(result.data.length,1);assert.deepEqual(new Set(result.data[0].evidenceIds),new Set(['journey-a','journey-b','bill-file','legacy-document','packing-document']));assert.equal(result.data[0].filename,undefined);
});
test('filename deduplication exposes every category alias without changing the primary document owner',async()=>{
 const common={filename:'mixed.txt',originalName:'Mixed'};
 const row={id:'j',version:1,files:[{...common,id:'support',category:'SUPPORTING'},{...common,id:'receipt',category:'DELIVERY_RECEIPT'}],bills:[{id:'bill',billNumber:'BL1',registerData:{},files:[{...common,id:'pod',category:'POD'},{...common,id:'payment',category:'PAYMENT_PROOF'}],document:{...common,id:'legacy'},allocations:[{packingList:{document:{...common,id:'packing'}}}]}]};
 const before=structuredClone(row),result=await service.documents({shippingJourney:{findUnique:async()=>row}},'j');
 assert.equal(result.data.length,1);const file=result.data[0];assert.equal(file.id,'support');assert.equal(file.category,'SUPPORTING');
 assert.deepEqual(file.evidenceAliases,[{id:'support',category:'SUPPORTING'},{id:'receipt',category:'DELIVERY_RECEIPT'},{id:'pod',category:'POD'},{id:'payment',category:'PAYMENT_PROOF'},{id:'legacy',category:'FINAL'},{id:'packing',category:'PACKING_LIST'}]);
 assert.deepEqual(file.evidenceIds,file.evidenceAliases.map(alias=>alias.id));assert.equal(file.filename,undefined);assert.deepEqual(row,before);
});
test('B/L attachment rejects a different vessel or destination and closed parent states',async()=>{
 const row={id:'parent',vesselName:'TANTO SIAP',voyageNumber:'165',period:'2026',destination:'Merauke',data:{},files:[],bills:[]};const tx={shippingJourney:{findUnique:async()=>row,findFirst:async()=>null}};
 assert.equal((await service.forBill(tx,{id:'admin'},{journeyId:'parent',vesselName:'KM TANTO SIAP',voyageNumber:'165',portOfDischarge:'MERAUKE'})).id,'parent');
 await assert.rejects(service.forBill(tx,{}, {journeyId:'parent',vesselName:'OTHER'}),e=>e.status===409);row.deletedAt=new Date();await assert.rejects(service.forBill(tx,{}, {journeyId:'parent'}),e=>e.status===409);
});
test('cost aggregation loads each job once and keeps proposed amounts out of approved totals',async()=>{
 const row={id:'parent',data:{},files:[],bills:[{id:'a',jobId:'same',registerData:{}},{id:'b',jobId:'same',registerData:{}}],sharedJobId:'shared'};let query;
 const {Prisma}=require('@prisma/client');const tx={shippingJourney:{findUnique:async()=>row},jobCharge:{findMany:async q=>{query=q;return[{id:'c1',jobId:'shared',kind:'COST',status:'APPROVED',estimatedAmount:new Prisma.Decimal('1000'),actualAmount:new Prisma.Decimal('1000')},{id:'c2',jobId:'same',kind:'COST',status:'PROPOSED',estimatedAmount:new Prisma.Decimal('9000')}];}}};
 const result=await service.costs(tx,'parent');assert.deepEqual(query.where.jobId.in,['same','shared']);assert.equal(result.approvedCost,'1000.00');assert.equal(result.data[0].scope,'Bersama');
});

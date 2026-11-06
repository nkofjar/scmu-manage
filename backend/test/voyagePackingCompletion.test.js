const test=require('node:test'),assert=require('node:assert/strict');
const service=require('../src/services/voyagePacking');
function fixture(){
 const bill={id:'b1',jobId:'j',version:1,contentVersion:1,billNumber:'BL1',vesselName:'KM UJI',voyageNumber:'10',containers:[{number:'CONT1',seal:'SEAL'}],files:[],allocations:[],shipment:{mode:'SEA',status:'PENDING'},registerData:{containers:[{number:'CONT1',seal:'SEAL',size:'20'}]}};
 const tx={seaBill:{findUnique:async()=>bill,findFirst:async()=>bill},jobOrder:{findUnique:async()=>({status:'IN_PROGRESS'})}};
 return {tx,bills:[bill],body:{selection:[{id:bill.id,version:1}],config:{number:'RPL'}}};
}
function partner(bill){
 bill.files=[{id:'pl',filename:'partner.xlsx',originalName:'Original.xlsx',category:'PACKING_LIST'}];
 bill.registerData.operational={packing:{status:'CONFIRMED',sourceFileIds:['pl'],groups:[{id:'g',containerNumber:'CONT1',sourceFileId:'pl',recipientName:'Shop A',items:[{id:'i',description:'Rice',packages:7,packageUnit:'SAK'}]}]}};
}

test('voyage recap retains field instructions in recipients and both workbook sheets',async()=>{
 const f=fixture();partner(f.bills[0]);
 f.bills[0].registerData.operational.packing.groups[0].instructions='Unload at rear gate only';
 const {data}=await service.read(f.tx,f.body),row=data.records[0].rows[0];
 assert.equal(row.recipients[0].instructions,'Unload at rear gate only');
 const book=await service.workbook(data);
 for(const name of ['Packing List Kapal','Sumber B-L'])assert.match(JSON.stringify(book.getWorksheet(name).getSheetValues()).replace(/\\n/g,''),/Unload at rear gate only/);
 assert.equal((await service.read(f.tx,{...f.body,config:service.configOf(data)})).data.fingerprint,data.fingerprint);
});

test('inferred single-container BL cargo survives actual frontend config roundtrip',async()=>{
 const {voyageConfig}=await import('../../frontend/src/pages/BL/voyagePackingPrint.mjs');
 for(const packages of [0,12]){
  const f=fixture();Object.assign(f.bills[0],{packages,consigneeName:'Warehouse'});f.bills[0].registerData.register={packageUnit:'SAK'};
  const first=(await service.read(f.tx,f.body)).data;
  const next=(await service.read(f.tx,{...f.body,config:voyageConfig(first)})).data;
  assert.deepEqual(next,first);assert.equal(first.records[0].rows[0].quantity,packages);
 }
});

test('operations API previews, saves and retrieves the exact mixed-source workbook snapshot',async()=>{
 const express=require('express'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const prisma=require('../src/prisma'),files=require('../src/services/jobFiles'),f=fixture();partner(f.bills[0]);
 f.bills[0].consigneeName='Warehouse';f.bills[0].registerData.containers.push({number:'CONT2'});f.bills[0].containers.push({number:'CONT2'});
 const logs=[],bill=f.bills[0],tx=f.tx;
 tx.seaBill.update=async({data})=>{bill.registerData=data.registerData;bill.version++;return bill;};
 tx.seaBillFile={findMany:async()=>[],create:async({data})=>{const file={id:'output',...data};bill.files.push(file);return file;}};
 tx.seaBillCargo={findMany:async()=>[]};tx.activityLog={create:async({data})=>{logs.push(data);return data;},findMany:async()=>logs};
 const replacements=[[prisma.seaBill,'findUnique',tx.seaBill.findUnique],[prisma.seaBill,'findFirst',tx.seaBill.findFirst],[prisma.jobOrder,'findUnique',tx.jobOrder.findUnique],[prisma.seaBillFile,'findMany',tx.seaBillFile.findMany],[prisma.seaBillCargo,'findMany',tx.seaBillCargo.findMany],[prisma.activityLog,'findMany',tx.activityLog.findMany],[prisma,'$transaction',async work=>work(tx)]];
 const originals=replacements.map(([object,key])=>object[key]);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'voyage-api-')),filePath=files.filePath;files.filePath=name=>path.join(directory,name);
 replacements.forEach(([object,key,value])=>{object[key]=value;});
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:'admin',role:'ADMIN'};next();});app.use('/operations',require('../src/routes/operations'));app.use((err,req,res,next)=>res.status(err.status||500).json({message:err.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}/operations/voyage-packing`;
 const post=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  const preview=await fetch(base+'/preview',post(f.body));assert.equal(preview.status,200);const data=await preview.json();
  assert.deepEqual(data.records[0].rows.map(r=>r.sourceType),['PARTNER_PL','BL_MANUAL']);
  const config=service.configOf(data);
  const rejected=await fetch(base,post({...f.body,config,confirmed:true,fingerprint:'stale'}));assert.equal(rejected.status,409);assert.equal(logs.length,0);
  const saved=await fetch(base,post({...f.body,config,confirmed:true,fingerprint:data.fingerprint}));assert.equal(saved.status,200);assert.match(saved.headers.get('content-type'),/spreadsheetml/);assert((await saved.arrayBuffer()).byteLength>1000);
  const snapshot=await fetch(base+'/b1/output');assert.equal(snapshot.status,200);const persisted=await snapshot.json();assert.equal(persisted.fingerprint,data.fingerprint);assert.deepEqual(persisted.records,data.records);assert.equal(logs.length,1);
  assert.equal((await fs.readdir(directory)).length,1);
 }finally{
  await new Promise(resolve=>server.close(resolve));replacements.forEach(([object,key],i)=>{object[key]=originals[i];});files.filePath=filePath;await fs.rm(directory,{recursive:true,force:true});
 }
});

test('partner identity conflicts remain explicit in preview and source workbook',async()=>{
 const f=fixture();partner(f.bills[0]);
 const sourceIdentity={vesselName:'KM OTHER',voyageNumber:'11',billNumber:'BL-OTHER'};
 f.bills[0].registerData.operational.packing.sourceIdentity=sourceIdentity;
 const {data}=await service.read(f.tx,f.body),row=data.records[0].rows[0];
 assert.equal(row.sourceType,'PARTNER_PL');
 assert.deepEqual(row.sources[0].sourceIdentity,sourceIdentity);
 for(const value of Object.values(sourceIdentity))assert(data.warnings.some(w=>w.includes(value)),value);
 const book=await service.workbook(data);
 for(const value of Object.values(sourceIdentity))assert(JSON.stringify(book.getWorksheet('Sumber B-L').getSheetValues()).includes(value),value);
});

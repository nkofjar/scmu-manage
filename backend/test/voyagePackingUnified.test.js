const test=require('node:test'),assert=require('node:assert/strict'),service=require('../src/services/voyagePacking');
function fixture(){
 const journey={id:'journey',version:1,vesselName:'KM UJI',voyageNumber:'10',period:'2026-11',data:{keep:'existing'}};
 const bills=[1,2].map(n=>({id:'b'+n,journeyId:journey.id,jobId:'job'+n,version:1,contentVersion:1,billNumber:'BL'+n,vesselName:journey.vesselName,voyageNumber:journey.voyageNumber,packages:999,shipperName:'SAME',consigneeName:'SCMU',containers:[{number:'CONT'+n,seal:'BL-SEAL'}],files:[],allocations:[],shipment:{mode:'SEA',status:'PENDING'},registerData:{containers:[{number:'CONT'+n,seal:'BL-SEAL',size:'20',goodsDescription:'BL cargo'}]}}));
 const logs=[];const tx={seaBill:{findFirst:async({where})=>bills.find(b=>b.id===where.id),findUnique:async({where})=>bills.find(b=>b.id===where.id),update:async({where,data})=>{const b=bills.find(b=>b.id===where.id);Object.assign(b,{...data,version:b.version+1});return b;}},jobOrder:{findUnique:async()=>({status:'IN_PROGRESS'})},shippingJourney:{findUnique:async({where})=>where.id===journey.id?journey:null,update:async({data})=>Object.assign(journey,{...data,version:journey.version+1})},seaBillFile:{create:async({data})=>{const f={...data,id:'f'+logs.length};bills.find(b=>b.id===data.billId).files.push(f);return f;}},activityLog:{create:async({data})=>logs.push(data),findMany:async()=>logs}};
 journey.bills=bills;
 return {tx,bills,journey,logs,body:{selection:bills.map(b=>({id:b.id,version:1})),config:{number:'RPL'}}};
}
function partner(bill){bill.files.push({id:'pl',filename:'partner.xlsx',originalName:'Original.xlsx',category:'PACKING_LIST'});bill.registerData.operational={packing:{status:'CONFIRMED',sourceFileIds:['pl'],groups:[{id:'g1',containerNumber:'CONT-1',sealNumber:'BL-SEAL',sourceFileId:'pl',recipientName:'Shop A',recipientAddress:'Address A',recipientPhone:'123',notes:'Handle gently',items:[{id:'i1',description:'Rice',packages:7,packageUnit:'SAK',sourceSheet:'PL',sourceRow:4}]}]}};}
test('one recap uses reviewed mapped partner cargo and manual BL fallback without merging BL identities',async()=>{
 const f=fixture();partner(f.bills[0]);const {data}=await service.read(f.tx,f.body),row=data.records[0].rows[0];
 assert.equal(row.sourceType,'PARTNER_PL');assert.equal(data.records[1].rows[0].sourceType,'BL_MANUAL');assert.equal(data.groups.length,2);assert.equal(data.journeyId,'journey');
 assert.equal(row.quantity,7);assert.equal(row.unit,'SAK');assert.equal(row.description,'Rice');assert.deepEqual(row.recipients,[{name:'Shop A',address:'Address A',phone:'123',notes:'Handle gently',quantity:7,unit:'SAK'}]);assert.equal(row.sources[0].id,'pl');assert.equal(row.sources[0].groups[0].items[0].sourceRow,4);assert.equal(data.records[1].rows[0].quantity,null);
 assert.equal(service.configOf(data).rows[0].sourceType,'PARTNER_PL');
});
module.exports={fixture,partner};
test('Excel suppresses the single header recipient name but preserves allocations, instructions and source details',async()=>{
 const f=fixture(),{data}=await service.read(f.tx,f.body),g=data.groups[0];g.recipient='TOKO UTAMA';
 g.rows[0].recipients=[{name:'  toko  utama ',quantity:0,unit:'DUS',address:'Gudang A',phone:'081',notes:'Tunggu bayar',instructions:'Pintu belakang'}];
 data.records[0].rows[0].recipients=g.rows[0].recipients;
 const before=structuredClone(data),book=await service.workbook(data),loaded=new (require('exceljs').Workbook)();await loaded.xlsx.load(await book.xlsx.writeBuffer());
 const cells=[];loaded.getWorksheet('Packing List Kapal').eachRow(r=>r.eachCell(c=>{if(typeof c.value==='string')cells.push(c.value);}));
 const text=cells.join('\n').replace(/\n/g,'');assert.doesNotMatch(text,/toko  utama/);
 for(const value of ['PENERIMA: TOKO UTAMA','Gudang A','081','Tunggu bayar','Pintu belakang','0 DUS'])assert(text.includes(value));
 assert.match(JSON.stringify(loaded.getWorksheet('Sumber B-L').getSheetValues()),/toko  utama/,'original recipient remains in source detail');
 g.rows[0].recipients.push({name:'TOKO LAIN',quantity:2,unit:'SAK'});
 const multi=await service.workbook(data);assert.match(JSON.stringify(multi.getWorksheet('Packing List Kapal').getSheetValues()),/toko  utama/);assert.match(JSON.stringify(multi.getWorksheet('Packing List Kapal').getSheetValues()),/TOKO LAIN/);
 data.groups[0].rows[0].recipients.pop();assert.deepEqual(data,before);
});
test('journey scope rejects archived/deleted journeys, trash bills, mixed linkage and periods',async()=>{
 for(const change of [f=>f.journey.archivedAt='2026-11-01',f=>f.journey.deletedAt='2026-11-01',f=>f.bills[0].registerData.trash={deletedAt:'2026-11-01'},f=>f.bills[1].journeyId='other',f=>f.bills[1].journeyId=null,f=>{f.bills[0].voyage={period:'2026-10'};f.bills[1].voyage={period:'2026-11'};},f=>f.journey.voyageNumber='11']){
  const f=fixture();change(f);await assert.rejects(service.read(f.tx,f.body));
 }
});
test('saving mixed sources replaces journey current pointer while retaining previous file revisions and snapshots',async()=>{
 const f=fixture();partner(f.bills[0]);const first=(await service.read(f.tx,f.body)).data;
 const saved=await service.save(f.tx,{id:'admin'},{selection:f.body.selection,confirmed:true,fingerprint:first.fingerprint},{filename:'recap1.xlsx'},first);
 assert.equal(f.journey.data.voyagePacking.filename,'recap1.xlsx');assert.equal(f.journey.data.keep,'existing');assert.equal(f.journey.data.voyagePacking.fingerprint,saved.fingerprint);
 f.body.selection=f.bills.map(b=>({id:b.id,version:b.version}));const next=(await service.read(f.tx,f.body)).data;await service.save(f.tx,{id:'admin'},{selection:f.body.selection,confirmed:true,fingerprint:next.fingerprint},{filename:'recap2.xlsx'},next);
 assert.equal(f.journey.data.voyagePacking.filename,'recap2.xlsx');assert.equal(f.bills[0].files.filter(f=>f.category===service.CATEGORY).length,2);
 assert.equal((await service.savedSnapshot(f.tx,'b1','f0')).records[0].rows[0].sources[0].groups[0].recipientName,'Shop A');
});
test('workbook prints reviewed recipients, provenance and seal conflict warnings without replacing BL seal',async()=>{
 const f=fixture();partner(f.bills[0]);f.bills[0].registerData.operational.packing.groups[0].sealNumber='PARTNER-SEAL';const {data}=await service.read(f.tx,f.body),row=data.records[0].rows[0];assert.equal(row.seal,'BL-SEAL');assert.match(data.warnings.join(' '),/Konflik segel/);
 const book=await service.workbook(data);const printable=JSON.stringify(book.getWorksheet('Packing List Kapal').getSheetValues());assert.match(printable,/Shop A/);assert.match(printable,/Address A/);assert.match(printable,/123/);assert.match(printable,/Handle gently/);assert.match(printable,/Konflik segel/);
 const sources=JSON.stringify(book.getWorksheet('Sumber B-L').getSheetValues());assert.match(sources,/PARTNER_PL/);assert.match(sources,/PARTNER-SEAL/);assert.match(sources,/Original.xlsx/);
 const buffer=await book.xlsx.writeBuffer();assert(buffer.byteLength>1000);
});
test('Excel distinguishes missing package quantities from the known container and recipient counts',async()=>{
 const ExcelJS=require('exceljs'),f=fixture();f.body.selection=[f.body.selection[0]];f.bills[0].packages=null;
 f.bills[0].containers=Array.from({length:6},(_,i)=>({number:'CONT'+(i+1)}));f.bills[0].registerData.containers=structuredClone(f.bills[0].containers);
 const {data}=await service.read(f.tx,f.body),book=await service.workbook(data),loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await book.xlsx.writeBuffer());
 const values=[];loaded.getWorksheet('Packing List Kapal').eachRow(row=>row.eachCell(cell=>values.push(typeof cell.value==='string'?cell.value:cell.value?.richText?.map(t=>t.text).join('')||'')));
 const printed=values.join('\n').replace(/\n/g,'');
 assert.match(printed,/JUMLAH KONT\.: 6/);assert.doesNotMatch(printed,/belum diisi|belum diketahui|belum dicatat|tidak dialokasikan/i);
 assert.doesNotMatch(printed,/Jumlah penerima belum diketahui|Jumlah kontainer belum diketahui|total B\/L tidak dialokasikan/);
 for(const c of f.bills[0].containers)assert(printed.includes(c.number));
 const details=loaded.getWorksheet('Sumber B-L');assert.equal(details.rowCount,7);for(let n=2;n<=details.rowCount;n++){assert.equal(details.getRow(n).getCell(7).value,null);assert.equal(details.getRow(n).getCell(8).value,null);}
});
test('duplicate reviewed source group identities cannot double count partner cargo',async()=>{
 const f=fixture();partner(f.bills[0]);const packing=f.bills[0].registerData.operational.packing;packing.groups.push(structuredClone(packing.groups[0]));
 const {data}=await service.read(f.tx,f.body);assert.equal(data.records[0].rows[0].sourceType,'BL_MANUAL');assert.match(data.warnings.join(' '),/duplikat/i);
 f.body.config.rows=[{key:'b1:CONT1',sourceType:'PARTNER_PL'}];await assert.rejects(service.read(f.tx,f.body));
});
test('summary partner units remain unknown when absent and incomplete confirmed attachments surface warnings',async()=>{
 const f=fixture();partner(f.bills[0]);const g=f.bills[0].registerData.operational.packing.groups[0];Object.assign(g,{dataLevel:'SUMMARY',summaryPackages:12,goodsSummary:'Cargo',items:[]});
 const row=(await service.read(f.tx,f.body)).data.records[0].rows[0];assert.equal(row.unit,null);assert.equal(row.quantity,null);assert.deepEqual(row.sourceWarnings,[]);
 f.bills[0].registerData.operational.packing.groups=[];const {data}=await service.read(f.tx,f.body);assert.match(data.warnings.join(' '),/PL mitra.*(?:lengkap|dipetakan)/i);
});
test('selected reviewed source changes between preview and save reject before file writes even without a version change',async()=>{
 for(const change of [b=>b.registerData.operational.packing.groups[0].recipientAddress='Changed',b=>b.registerData.operational.packing.groups[0].items[0].packages=9,b=>b.files[0].filename='replacement.xlsx',b=>b.registerData.operational.packing.status='DRAFT',b=>b.registerData.operational.packing.groups[0].containerNumber='OTHER']){
  const f=fixture();partner(f.bills[0]);const {data}=await service.read(f.tx,f.body);change(f.bills[0]);await assert.rejects(service.save(f.tx,{id:'admin'},{selection:f.body.selection,confirmed:true,fingerprint:data.fingerprint},{filename:'no.xlsx'},data),e=>e.status===409);assert.equal(f.logs.length,0);assert(!f.bills.some(b=>b.files.some(f=>f.filename==='no.xlsx')));
 }
});
test('shared partner mapping must be explicitly confirmed and mapped to a container on this BL',async()=>{
 const f=fixture();partner(f.bills[0]);f.tx.seaBillFile.findMany=async()=>[{filename:'partner.xlsx',bill:{id:'b2',billNumber:'BL2'}}];
 let data=(await service.read(f.tx,f.body)).data;assert.equal(data.records[0].rows[0].sourceType,'BL_MANUAL');assert.match(data.warnings.join(' '),/bersama/);
 f.bills[0].registerData.operational.packing.scopeConfirmed=true;data=(await service.read(f.tx,f.body)).data;assert.equal(data.records[0].rows[0].sourceType,'PARTNER_PL');
 f.bills[0].registerData.operational.packing.groups[0].containerNumber='CONT2';data=(await service.read(f.tx,f.body)).data;assert.equal(data.records[0].rows[0].sourceType,'BL_MANUAL');assert.match(data.warnings.join(' '),/dipetakan/);
 f.body.config.rows=[{key:'b1:CONT1',sourceType:'PARTNER_PL'}];await assert.rejects(service.read(f.tx,f.body));
});
test('partner recipients and cargo cannot be forged by client edits; explicit manual choice warns',async()=>{
 const f=fixture();partner(f.bills[0]);f.body.config.rows=[{key:'b1:CONT1',description:'FORGED',quantity:500,unit:'BOX',recipients:[{name:'FORGED'}],sources:[],notes:'Print note'}];let data=(await service.read(f.tx,f.body)).data,row=data.records[0].rows[0];assert.equal(row.quantity,7);assert.equal(row.description,'Rice');assert.equal(row.recipients[0].name,'Shop A');assert.equal(row.notes,'Print note');
 f.body.config.rows[0].sourceType='BL_MANUAL';data=(await service.read(f.tx,f.body)).data;row=data.records[0].rows[0];assert.equal(row.quantity,500);assert.equal(row.recipients[0].name,'SCMU');assert.match(data.warnings.join(' '),/eksplisit/);
 f.body.config.rows[0].sourceType='RECEIVING_REPORT';await assert.rejects(service.read(f.tx,f.body));
});
test('BL aggregate needs one container and explicit unit; receiving actuals and internal PL are never planned cargo',async()=>{
 const f=fixture();f.bills[0].registerData.receivingReport={status:'CONFIRMED',groups:[{summaryPackages:555,packageUnit:'SAK'}]};f.bills[0].registerData.internalPackingList={sourceType:'RECEIVING_REPORT'};let data=(await service.read(f.tx,f.body)).data;assert.equal(data.records[0].rows[0].quantity,null);
 f.bills[0].registerData.register={packageUnit:'SAK'};data=(await service.read(f.tx,f.body)).data;assert.equal(data.records[0].rows[0].quantity,999);assert.equal(data.records[0].rows[0].unit,'SAK');
 f.bills[0].containers.push({number:'EXTRA'});f.bills[0].registerData.containers.push({number:'EXTRA'});data=(await service.read(f.tx,f.body)).data;assert(data.records[0].rows.every(r=>r.quantity===null));
});
test('missing manual package counts preserve known container identities and only explain real multi-container BL totals',async()=>{
 const cases=[
  {count:1,packages:null,unit:null},
  {count:1,packages:120,unit:null},
  {count:1,packages:null,unit:'SAK'},
  {count:6,packages:null,unit:null},
  {count:6,packages:120,unit:null},
  {count:6,packages:120,unit:'SAK'},
  {count:6,packages:0,unit:'SAK'},
  {count:1,packages:120,unit:'SAK',expected:120},
  {count:1,packages:0,unit:'SAK',expected:0},
  {count:6,packages:120,unit:'SAK',manual:0,expected:0},
 ];
 for(const scenario of cases){
  const f=fixture(),bill=f.bills[0];f.body.selection=[f.body.selection[0]];
  bill.packages=scenario.packages;bill.registerData.register={packageUnit:scenario.unit};
  bill.containers=Array.from({length:scenario.count},(_,i)=>({number:'CONT'+(i+1),seal:'SEAL'+i}));bill.registerData.containers=structuredClone(bill.containers);
  if(Object.hasOwn(scenario,'manual'))f.body.config.rows=bill.containers.map(c=>({key:bill.id+':'+c.number,quantity:scenario.manual,unit:'BOX'}));
  const {data}=await service.read(f.tx,f.body),rows=data.records[0].rows;
  assert.equal(data.containerCount,scenario.count);assert.deepEqual(rows.map(r=>r.number),bill.containers.map(c=>c.number));assert.deepEqual(rows.map(r=>r.seal),bill.containers.map(c=>c.seal));
  for(const row of rows){
   assert.equal(row.quantity,scenario.expected??null);assert.equal(row.unit,Object.hasOwn(scenario,'manual')?'BOX':scenario.unit);assert.equal(row.sources[0].declaredPackages,scenario.packages);
   assert.deepEqual(row.sourceWarnings,[],'Missing optional package data is blank, not a warning');
   assert.doesNotMatch(row.sourceWarnings.join(' '),/(?:jumlah|total) kontainer.*(?:belum|tidak) diketahui/i);
  }
 }
});
test('different partner units do not collapse to a misleading container total',async()=>{
 const f=fixture();partner(f.bills[0]);f.bills[0].registerData.operational.packing.groups.push({id:'summary',containerNumber:'CONT1',sourceFileId:'pl',recipientName:'Shop B',dataLevel:'SUMMARY',summaryPackages:3,packageUnit:'BOX',goodsSummary:'Boxes',items:[]});const row=(await service.read(f.tx,f.body)).data.records[0].rows[0];assert.equal(row.quantity,null);assert.equal(row.unit,null);assert.deepEqual(row.recipients.map(r=>r.quantity),[7,3]);assert.equal(row.sources[0].groups.length,2);
});
test('confirmed partner package warnings never describe the known container count as unknown',async()=>{
 for(const count of [1,6])for(const kind of ['mixed','unknown','zero']){
  const f=fixture(),bill=f.bills[0];partner(bill);f.body.selection=[f.body.selection[0]];
  bill.containers=Array.from({length:count},(_,i)=>({number:'CONT'+(i+1),seal:'BL-SEAL'}));bill.registerData.containers=structuredClone(bill.containers);
  const packing=bill.registerData.operational.packing,g=packing.groups[0];
  if(kind==='mixed')packing.groups.push({...g,id:'g2',recipientName:'Shop B',items:[{id:'i2',description:'Boxes',packages:3,packageUnit:'BOX'}]});
  if(kind==='unknown')Object.assign(g,{dataLevel:'SUMMARY',summaryPackages:12,goodsSummary:'Cargo',packageUnit:null,items:[]});
  if(kind==='zero')g.items[0].packages=0;
  const {data}=await service.read(f.tx,f.body),row=data.records[0].rows[0];
  assert.equal(data.containerCount,count);assert.deepEqual(data.records[0].rows.map(r=>r.number),bill.containers.map(c=>c.number));assert.equal(row.sourceType,'PARTNER_PL');
  assert.equal(row.quantity,kind==='zero'?0:null);assert.equal(row.unit,kind==='zero'?'SAK':null);
  assert.deepEqual(row.recipients.map(r=>r.quantity),kind==='mixed'?[7,3]:kind==='unknown'?[null]:[0]);
  assert.deepEqual(row.sourceWarnings,[],'Unavailable package totals stay blank while recipient details remain intact');
  assert.doesNotMatch(data.warnings.join(' '),/(?:jumlah|total) kontainer.*(?:belum|tidak) diketahui/i);
 }
});
test('same physical container across BLs retains each identity and exposes conflicting seals',async()=>{
 const f=fixture();f.bills[1].containers[0]={number:'CONT1',seal:'OTHER'};f.bills[1].registerData.containers[0]={number:'CONT1',seal:'OTHER'};const {data}=await service.read(f.tx,f.body);assert.match(data.warnings.join(' '),/Konflik segel/);assert.equal(data.records[0].rows[0].seal,'BL-SEAL');assert.equal(data.records[1].rows[0].seal,'OTHER');assert.equal(data.groups.length,2);
});
test('long recipient output uses continuation rows with sufficient height and never drops the last recipient',async()=>{
 const f=fixture();partner(f.bills[0]);const packing=f.bills[0].registerData.operational.packing,g=packing.groups[0];packing.groups=Array.from({length:80},(_,i)=>({...g,id:'g'+i,recipientName:'Recipient '+i,recipientAddress:null,recipientPhone:null,notes:null}));const {data}=await service.read(f.tx,f.body);const book=await service.workbook(data),sheet=book.getWorksheet('Packing List Kapal');assert.match(JSON.stringify(sheet.getSheetValues()),/Recipient 79/);
 sheet.eachRow(row=>{for(const index of [3,7]){const value=row.getCell(index).value;if(typeof value==='string'&&value.includes('Recipient '))assert(row.height>=value.split('\n').length*14+12);}});
});
test('master voyage period lookup rejects a mismatched journey period when register does not include voyage relation',async()=>{
 const f=fixture();for(const bill of f.bills)bill.voyageId='voyage';f.tx.voyage={findUnique:async()=>({id:'voyage',period:'2025-11'})};await assert.rejects(service.read(f.tx,f.body),/periode/i);
});
test('journey scope metadata is snapshotted and changing its period invalidates reviewed output',async()=>{
 const f=fixture();const {data}=await service.read(f.tx,f.body);assert.equal(data.period,'2026-11');f.journey.period='2026-12';await assert.rejects(service.save(f.tx,{id:'admin'},{selection:f.body.selection,confirmed:true,fingerprint:data.fingerprint},{filename:'no.xlsx'},data),e=>e.status===409);assert.equal(f.logs.length,0);
});
test('ambiguous canonical container aliases in one BL cannot allocate the same partner group twice',async()=>{
 const f=fixture();partner(f.bills[0]);f.bills[0].containers.push({number:'CONT-1'});f.bills[0].registerData.containers.push({number:'CONT-1'});await assert.rejects(service.read(f.tx,f.body),/duplikat/i);
});
test('operations HTTP preview and save return a real mixed-source workbook and readable historical snapshot',async()=>{
 const express=require('express'),prisma=require('../src/prisma'),fs=require('node:fs/promises'),files=require('../src/services/jobFiles'),ExcelJS=require('exceljs'),f=fixture();partner(f.bills[0]);f.tx.seaBillFile.findMany=async()=>[];f.tx.seaBillCargo={findMany:async()=>[]};const restore=[];
 for(const [model,methods] of Object.entries(f.tx))for(const [method,fn] of Object.entries(methods)){const original=prisma[model][method];restore.push(()=>prisma[model][method]=original);prisma[model][method]=fn;}
 const originalTransaction=prisma.$transaction;prisma.$transaction=async work=>work(prisma);restore.push(()=>prisma.$transaction=originalTransaction);
 const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.headers['x-test-role'])req.user={id:'admin',role:req.headers['x-test-role']};next();});app.use('/operations',require('../src/routes/operations'));app.use((error,req,res,next)=>res.status(error.status||500).json({message:error.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const root=`http://127.0.0.1:${server.address().port}/operations/voyage-packing`,headers={'Content-Type':'application/json','x-test-role':'ADMIN'};
 try{
  assert.equal((await fetch(root+'/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(f.body)})).status,401);
  const preview=await fetch(root+'/preview',{method:'POST',headers,body:JSON.stringify(f.body)});const data=await preview.json();assert.equal(preview.status,200,JSON.stringify(data));assert.equal(data.records[0].rows[0].sourceType,'PARTNER_PL');
  const response=await fetch(root,{method:'POST',headers,body:JSON.stringify({...f.body,config:service.configOf(data),fingerprint:data.fingerprint,confirmed:true})});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/spreadsheetml/);const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await response.arrayBuffer()));assert(book.getWorksheet('Packing List Kapal'));
  const filename=f.journey.data.voyagePacking.filename;assert((await fs.stat(files.filePath(filename))).size>1000);const recap=f.bills[0].files.find(f=>f.category===service.CATEGORY),snapshot=await fetch(root+'/b1/'+recap.id,{headers});assert.equal(snapshot.status,200);assert.equal((await snapshot.json()).records[0].rows[0].recipients[0].name,'Shop A');
 }finally{await new Promise(r=>server.close(r));for(const fn of restore.reverse())fn();for(const filename of new Set(f.bills.flatMap(b=>b.files.filter(f=>f.category===service.CATEGORY).map(f=>f.filename))))await files.removeFile(filename);}
});

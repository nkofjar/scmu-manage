const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./billDriverOperations.test');
const operations=require('../src/services/driverOperations'),scoped=require('../src/services/billDriverOperations');
const service=(()=>{try{return require('../src/services/driverDispatch');}catch(e){if(e.code==='MODULE_NOT_FOUND')return {};throw e;}})();
const user={id:'staff',role:'ADMIN'};
function setup(){const f=fixture();f.work.receivedDate=null;f.work.receiptReference=null;f.work.evidenceFileIds=[];f.work.taskDate='2027-01-02';f.work.instructions='Collect sealed container';f.a.containers[0].seal='SEAL-01';f.parent.vesselName='Kapal SCMU';f.parent.voyageNumber='V01';f.tx.company={findFirst:async()=>({id:'decoy',name:'Wrong internal header',isInternal:true,isActive:true}),findUnique:async({where})=>where.id===require('../src/services/access').INTERNAL_COMPANY_ID?{id:where.id,name:'SCMU Logistics',isInternal:true,isActive:true,address:null,phone:null,email:null}:null};return f;}
test('dispatch snapshots issue before receipt and retry after commit without duplicate writes',async()=>{
 assert.equal(typeof service.issueBill,'function');const f=setup(),body={version:1,taskDate:'2027-02-01',documentType:'TRANSPORT_ORDER',confirmed:true};
 const saved=await service.issueBill(f.tx,user,'a','work-a',body);assert.equal(saved.taskDate,'2027-02-01');assert.equal(saved.driverName,'Driver');assert.equal(saved.billNumber,'BL-A');assert.equal(saved.seal,'SEAL-01');assert.equal(saved.company.name,'SCMU Logistics');assert.equal(typeof saved.pdfBase64,'string');assert.equal(typeof saved.pdfSha256,'string');assert.equal(saved.issuer.id,'staff');assert.equal(saved.source.workId,'work-a');assert.equal(saved.instructions,'Collect sealed container');assert.equal(f.parent.version,2);
 const repeated=await service.issueBill(f.tx,user,'a','work-a',body);assert.deepEqual(repeated,saved);assert.equal(f.parent.version,2);assert.equal((await service.listBill(f.tx,'a','work-a')).data.length,1);
 Object.assign(f.parent.data.driverOperations.works.find(w=>w.id==='work-a'),{driverName:'Changed',instructions:'Changed'});f.a.billNumber='CHANGED';
 const historical=await service.getBill(f.tx,'a','work-a',saved.id);assert.deepEqual(historical,saved);assert.equal(historical.driverName,'Driver');
 for(const target of ['b','missing'])await assert.rejects(service.getBill(f.tx,target,'work-a',saved.id),e=>e.status===404||e.status===422);
});
test('draft editing preserves identity IDs, original names and dispatch history but permits future task date',async()=>{
 const f=setup();Object.assign(f.work,{driverId:'d',vehicleId:'v',driverEmploymentType:'INTERNAL',driverCompanyId:'co',driverCompanyName:'Company',dispatches:[{id:'immutable',driverName:'Original'}]});
 const saved=await scoped.saveWork(f.tx,user,'a','work-a',{version:1,work:{...f.work,driverId:undefined,vehicleId:undefined,driverName:'Replacement',vehicleNumber:'FAKE',dispatches:[],receivedDate:null,taskDate:'2027-03-01',instructions:'Handle with care'}});
 assert.equal(saved.driverId,'d');assert.equal(saved.vehicleId,'v');assert.equal(saved.driverName,'Driver');assert.equal(saved.vehicleNumber,'PA123');assert.equal(saved.taskDate,'2027-03-01');assert.equal(saved.receivedDate,null);assert.equal(saved.instructions,'Handle with care');assert.deepEqual(saved.dispatches,[{id:'immutable',driverName:'Original'}]);
});
test('dispatch refuses incomplete, cancelled, stale, archived and sibling assignments before writing',async()=>{
 assert.equal(typeof service.issueBill,'function');
 for(const change of ['missing-driver','cancelled','stale','archived','sibling','conflict']){
  const f=setup();let id='work-a',version=1;if(change==='missing-driver')f.work.driverName=null;if(change==='cancelled')f.work.status='CANCELLED';if(change==='stale')version=9;if(change==='archived')f.parent.archivedAt=new Date();if(change==='sibling')id='work-b';if(change==='conflict'){f.work.containerKey='SHARED';f.work.containerNumber='SHARED';f.a.containers[1].seal='A';f.b.containers[1].seal='B';}
  await assert.rejects(service.issueBill(f.tx,user,'a',id,{version,documentType:'TRANSPORT_ORDER',confirmed:true}),change);assert.equal(f.writes.length,0,change);
 }
});
test('saved dispatch produces real parseable PDF and reprints without consulting current master',async()=>{
 assert.equal(typeof service.pdf,'function');const f=setup(),saved=await service.issueBill(f.tx,user,'a','work-a',{version:1,documentType:'DELIVERY_NOTE',confirmed:true});
 f.tx.company.findFirst=async()=>{throw Error('Current header must not be read');};f.parent.archivedAt=new Date();
 const stored=await service.getBill(f.tx,'a','work-a',saved.id),bytes=await service.pdf(stored);assert(Buffer.isBuffer(bytes));assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const doc=await getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;let text='';for(let n=1;n<=doc.numPages;n++)text+=(await(await doc.getPage(n)).getTextContent()).items.map(i=>i.str).join(' ');await doc.cleanup();
 for(const expected of ['SURAT JALAN','SCMU Logistics','BL-A','Driver','PA123','SEAL-01','Collect sealed container','2027-01-02','SCMU','Sopir','Penerima'])assert(text.includes(expected),expected);
 assert(!text.includes('undefined'));assert(!text.includes('null'));
});
module.exports={setup,user};

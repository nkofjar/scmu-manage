const test=require('node:test'),assert=require('node:assert/strict');
const service=require('../src/services/driverBons');
const user={id:'admin',name:'Admin Uji',role:'ADMIN'};
const body=()=>({number:'',bonDate:'2026-01-02',status:'DRAFT',driverName:'Sopir Uji',vehicleNumber:'pa 1234 aa',origin:'Pelabuhan Merauke',destination:'Gudang Merauke',tripCount:2,containerNumbers:['CONT1'],evidenceFileIds:['f'],amount:'3750000.25',paymentStatus:'UNPAID'});
function fixture(){const bill={id:'b',jobId:'j',version:1,contentVersion:1,containers:[{number:'CONT1',seal:'001',size:'40'}],files:[{id:'f',filename:'x.txt'}],allocations:[],shipment:{mode:'SEA',status:'PENDING'},registerData:{manualPacking:{basis:'KEEP'},driverBons:[]}};const audit=[];let closed=false;const tx={seaBill:{findUnique:async()=>bill,findFirst:async()=>bill,update:async({data})=>{for(const[k,v]of Object.entries(data))bill[k]=v?.increment?bill[k]+v.increment:v;return bill;}},jobOrder:{findUnique:async()=>({id:'j',status:closed?'CLOSED':'IN_PROGRESS'})},activityLog:{create:async({data})=>audit.push(data)}};return {bill,tx,audit,close:()=>{closed=true;}};}
test('new standalone legacy bon creation is blocked with journey post-delivery guidance before writes',async()=>{
 const {bill,tx,audit}=fixture();await assert.rejects(service.save(tx,user,'b',null,{version:1,bon:body()}),e=>e.status===409&&/pengiriman|journey/i.test(e.message));assert.equal(bill.version,1);assert.equal(audit.length,0);
});
function stored(bill,input=body(),id='legacy'){const bon={...service.normalize(input,bill),id,createdById:user.id,createdByName:user.name,createdAt:'2026-01-02T00:00:00Z'};bill.registerData.driverBons.push(bon);return bon;}
test('multiple stored legacy vouchers retain document data, exact money and trusted author on edits',async()=>{
 const {bill,tx,audit}=fixture();const first=stored(bill,body(),'first'),second=stored(bill,body(),'second');const a=await service.save(tx,user,'b',first.id,{version:1,bon:{...first,createdById:'FORGED'}});const b=await service.save(tx,user,'b',second.id,{version:2,bon:second});
 assert.notEqual(a.bon.id,b.bon.id);assert.notEqual(a.bon.number,b.bon.number);assert.match(a.bon.number,/^BON-SCMU-/);assert.equal(a.bon.createdById,user.id);assert.equal(a.bon.amount,'3750000.25');assert.equal(a.bon.vehicleNumber,'PA 1234 AA');assert.equal(bill.registerData.manualPacking.basis,'KEEP');assert.equal(bill.contentVersion,1);assert.equal(bill.containers[0].seal,'001');assert.equal(audit[0].action,'DRIVER_BON_UPDATED');assert.equal((await service.list(tx,'b')).data.length,2);
});
test('ownership, dates, counts, money and payment recording are validated before writes',async()=>{
 for(const change of [{containerNumbers:['OTHER']},{evidenceFileIds:['FOREIGN']},{evidenceFileIds:['f','f']},{tripCount:0},{amount:'-1'},{bonDate:'2026-02-30'},{paymentStatus:'PAID',paymentDate:''},{paymentStatus:'PAID',paymentDate:'2026-01-01'},{paymentStatus:'UNPAID',amount:''},{status:'COMPLETED'}]){
  const {bill,tx,audit}=fixture();const old=stored(bill);await assert.rejects(service.save(tx,user,'b',old.id,{version:1,bon:{...body(),...change}}));assert.equal(bill.version,1);assert.equal(audit.length,0);
 }
 const {bill,tx}=fixture();stored(bill);await service.save(tx,user,'b','legacy',{version:1,bon:{...body(),amount:'',paymentStatus:'NOT_RECORDED',containerNumbers:[],evidenceFileIds:[]}});assert.equal(bill.registerData.driverBons[0].amount,null);
});
test('stale versions, archived/closed bills, foreign roles and foreign voucher IDs cannot mutate',async()=>{
 for(const scenario of ['stale','archived','closed','role','foreign']){const {bill,tx,audit,close}=fixture();stored(bill);if(scenario==='archived')bill.archivedAt=new Date();if(scenario==='closed')close();await assert.rejects(service.save(tx,scenario==='role'?{id:'external',role:'CUSTOMER'}:user,'b',scenario==='foreign'?'foreign':'legacy',{version:scenario==='stale'?99:1,bon:body()}));assert.equal(bill.version,1);assert.equal(audit.length,0);}
});
test('assignment progresses explicitly, cancellation needs a reason and cannot be reversed',async()=>{
 const {bill,tx,audit}=fixture();stored(bill);let result=await service.save(tx,user,'b','legacy',{version:1,bon:body()});
 await assert.rejects(service.save(tx,user,'b',result.bon.id,{version:bill.version,bon:{...result.bon,status:'COMPLETED',completedDate:'2026-01-02'}}));
 result=await service.save(tx,user,'b',result.bon.id,{version:bill.version,bon:{...result.bon,status:'ASSIGNED'}});assert.equal(result.bon.status,'ASSIGNED');
 await assert.rejects(service.save(tx,user,'b',result.bon.id,{version:bill.version,bon:{...result.bon,status:'CANCELLED'}}));
 result=await service.save(tx,user,'b',result.bon.id,{version:bill.version,bon:{...result.bon,status:'CANCELLED',cancellationReason:'Salah penugasan'}});assert.equal(audit.at(-1).metadata.before.status,'ASSIGNED');assert.equal(result.bon.cancellationReason,'Salah penugasan');
 await assert.rejects(service.save(tx,user,'b',result.bon.id,{version:bill.version,bon:{...result.bon,status:'DRAFT'}}));
});
test('completion locks assignment but allows later payment notes without creating financial transactions',async()=>{
 const {bill,tx}=fixture();stored(bill);let result=await service.save(tx,user,'b','legacy',{version:1,bon:{...body(),status:'ASSIGNED'}});
 result=await service.save(tx,user,'b',result.bon.id,{version:bill.version,bon:{...result.bon,status:'IN_PROGRESS'}});
 result=await service.save(tx,user,'b',result.bon.id,{version:bill.version,bon:{...result.bon,status:'COMPLETED',completedDate:'2026-01-03'}});
 await assert.rejects(service.save(tx,user,'b',result.bon.id,{version:bill.version,bon:{...result.bon,driverName:'Changed'}}));
 result=await service.save(tx,user,'b',result.bon.id,{version:bill.version,bon:{...result.bon,paymentStatus:'PAID',paymentDate:'2026-01-04',notes:'Dicatat dari bukti pembayaran'}});assert.equal(result.bon.paymentStatus,'PAID');assert.equal(result.bon.driverName,'Sopir Uji');assert.equal(bill.registerAmount,undefined);
});
test('voucher numbers are unique within a BL even when entered manually',async()=>{
 const {bill,tx}=fixture();stored(bill,{...body(),number:'bon-test'},'first');stored(bill,body(),'second');await assert.rejects(service.save(tx,user,'b','second',{version:bill.version,bon:{...body(),number:'BON-TEST'}}),e=>e.status===409);assert.equal(bill.registerData.driverBons.length,2);
});
test('voucher cost is proposed exactly once through the director cost service and freezes its source amount',async()=>{
 const {bill,tx}=fixture();const bon={...require('../src/services/driverBons').normalize({...body(),status:'ASSIGNED'},bill),id:'bon',status:'COMPLETED',completedDate:'2026-01-03',createdAt:new Date().toISOString()};bill.registerData.driverBons=[bon];
 const workspace=require('../src/services/blWorkspace'),original=workspace.createCost;let count=0;tx.jobCharge={findUnique:async()=>null};
 workspace.createCost=async(_tx,_user,id,input,context)=>{count++;assert.equal(input.unitPrice,'3750000.25');assert.equal(context.driverBonId,'bon');assert.equal(input.costCategory,'DRIVER_ALLOWANCE');bill.version++;return {charge:{id:'charge'},approval:{id:'approval'},version:bill.version};};
 try{await service.proposeCost(tx,user,'b','bon',{version:1,confirmed:true});assert.equal(count,1);assert.equal(bill.registerData.driverCostProposals[0].chargeId,'charge');await assert.rejects(service.proposeCost(tx,user,'b','bon',{version:bill.version,confirmed:true}),e=>e.status===409);assert.equal(count,1);await assert.rejects(service.save(tx,user,'b','bon',{version:bill.version,bon:{...bon,amount:'1'}}),e=>e.status===409);}finally{workspace.createCost=original;}
});

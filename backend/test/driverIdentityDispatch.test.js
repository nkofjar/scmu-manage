const test=require('node:test'),assert=require('node:assert/strict');
const identity=require('../src/services/driverIdentity');
const {INTERNAL_COMPANY_ID}=require('../src/services/access');
const d={id:'d',name:'Same Name',isActive:true,companyId:INTERNAL_COMPANY_ID,employmentType:'INTERNAL',licenseClass:'BII',licenseExpiry:'2028-01-01',company:{id:INTERNAL_COMPANY_ID,name:'SCMU',isActive:true,isInternal:true}};
const v={id:'v',registrationNo:'PA123',isActive:true,companyId:INTERNAL_COMPANY_ID,ownershipType:'OWN',company:d.company};
function masters(){return {company:{findUnique:async({where})=>where.id===INTERNAL_COMPANY_ID?d.company:null},driver:{findUnique:async({where})=>where.id==='d'?d:null,findMany:async()=>[d,{...d,id:'d2'}]},vehicle:{findUnique:async({where})=>where.id==='v'?v:null,findMany:async()=>[v]},shippingJourney:{findMany:async()=>[{data:{driverOperations:{works:[{id:'old',driverName:'Same Name',vehicleNumber:'PA123'}]}}}]},seaBill:{findMany:async()=>[]}};}
test('explicit master IDs are authoritative while legacy names never resolve by name',async()=>{
 const tx=masters(),saved=await identity.resolve(tx,{driverId:'d',vehicleId:'v',driverName:'Fake',vehicleNumber:'FAKE'});
 assert.equal(saved.driverName,'Same Name');assert.equal(saved.vehicleNumber,'PA123');assert.equal(saved.driverEmploymentType,'INTERNAL');assert.equal(saved.vehicleOwnershipType,'OWN');assert.equal(saved.driverCompanyId,INTERNAL_COMPANY_ID);
 const legacy=await identity.resolve(tx,{driverName:'Same Name',vehicleNumber:'PA123'});assert.equal(legacy.driverId,null);assert.equal(legacy.vehicleId,null);
 await assert.rejects(identity.resolve(tx,{driverId:'missing'}),e=>e.status===422);
 const options=await identity.options(tx);assert.equal(options.drivers.filter(x=>x.id).length,2);assert.equal(options.drivers.find(x=>x.id==='d').employmentType,'INTERNAL');assert.equal(options.drivers.find(x=>x.id==='d').companyId,INTERNAL_COMPANY_ID);assert.equal(options.drivers.find(x=>x.id==='d').licenseClass,'BII');assert(options.drivers.some(x=>!x.id&&x.unresolved));
});
module.exports={masters,d,v};

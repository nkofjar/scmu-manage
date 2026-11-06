const test=require('node:test'),assert=require('node:assert/strict');
const identity=require('../src/services/driverIdentity'),{masters,d,v}=require('./driverIdentityDispatch.test');
test('compliance snapshots are server-owned, preserved on edits and cleared on identity removal',async()=>{
 const tx=masters(),saved=await identity.resolve(tx,{driverId:'d',vehicleId:'v',compliance:{driver:{licenseClass:'FAKE'}}});assert.equal(saved.compliance.driver.licenseClass,'BII');
 const edited=await identity.resolve(tx,{driverId:'d',vehicleId:'v',compliance:{driver:{licenseClass:'FAKE'}}},saved);assert.deepEqual(edited.compliance,saved.compliance);
 const removed=await identity.resolve(tx,{driverId:null,vehicleId:null,driverName:'Legacy',vehicleNumber:'LEGACY',driverEmploymentType:'INTERNAL',compliance:saved.compliance},saved);assert.equal(removed.driverId,null);assert.equal(removed.driverEmploymentType,null);assert.equal(removed.compliance.driver,null);
});
test('new assignments require classified company-consistent canonical identities',async()=>{
 for(const kind of ['driver','vehicle'])for(const fault of ['missing-class','wrong-company','noncanonical']){
  const tx=masters(),original=kind==='driver'?d:v,row=structuredClone(original),field=kind==='driver'?'employmentType':'ownershipType';
  if(fault==='missing-class')row[field]=null;
  if(fault==='wrong-company')row.company.isInternal=false;
  if(fault==='noncanonical'){row.companyId='other-internal';row.company.id=row.companyId;}
  tx[kind].findUnique=async()=>row;
  await assert.rejects(identity.resolve(tx,{[kind+'Id']:row.id}),e=>[409,422].includes(e.status),kind+':'+fault);
 }
 for(const kind of ['driver','vehicle']){
  const tx=masters(),row={...(kind==='driver'?d:v),companyId:'vendor',company:{id:'vendor',name:'Vendor',isActive:true,isInternal:false},[kind==='driver'?'employmentType':'ownershipType']:'VENDOR'};tx[kind].findUnique=async()=>row;
  assert.equal((await identity.resolve(tx,{[kind+'Id']:row.id}))[kind+'CompanyId'],'vendor');
  row.company.isInternal=true;await assert.rejects(identity.resolve(tx,{[kind+'Id']:row.id}));
 }
});
test('explicit IDs reject inactive and company mismatches rather than accepting names',async()=>{
 const tx=masters();tx.driver.findUnique=async()=>({...d,isActive:false});await assert.rejects(identity.resolve(tx,{driverId:'d'}));
 tx.driver.findUnique=async()=>d;await assert.rejects(identity.resolve(tx,{driverId:'d',driverCompanyId:'foreign'}));
 tx.vehicle.findUnique=async()=>({...v,company:{...v.company,isActive:false}});await assert.rejects(identity.resolve(tx,{vehicleId:'v'}));
});

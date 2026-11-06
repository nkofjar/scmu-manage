const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./billDriverOperations.test');
const operations=require('../src/services/driverOperations');
const {masters}=require('./driverIdentityDispatch.test');
test('new name-only drafts cannot become verified payroll-dead-ends and can be mapped before submission',async()=>{
 const f=fixture(),user={id:'staff',role:'ADMIN'},saved=await operations.saveWork(f.tx,user,'j',null,{version:1,work:{...f.work,driverId:null,vehicleId:null,identityPolicy:null,receiptReference:'NEW-RECEIPT'}});
 await assert.rejects(operations.transition(f.tx,user,'j',saved.id,{version:2,status:'SUBMITTED'}),e=>e.status===409&&/master/i.test(e.message));assert.equal(f.parent.version,2);
 const models=masters();Object.assign(f.tx,{driver:models.driver,vehicle:models.vehicle,company:models.company});
 await operations.saveWork(f.tx,user,'j',saved.id,{version:2,work:{...saved,driverId:'d',vehicleId:'v'}});
 const submitted=await operations.transition(f.tx,user,'j',saved.id,{version:3,status:'SUBMITTED'});assert.equal(submitted.status,'SUBMITTED');
 const verified=await operations.transition(f.tx,user,'j',saved.id,{version:4,status:'VERIFIED',proofChecked:true});assert.equal(verified.status,'VERIFIED');assert.equal(verified.driverId,'d');
});
test('verified internal work creates one wage charge and payroll-locked work is never charged twice',async t=>{
 const f=fixture(),user={id:'staff',role:'ADMIN'};Object.assign(f.work,{status:'VERIFIED',driverId:'d',driverEmploymentType:'INTERNAL'});
 f.tx.jptTariff={findMany:async()=>[{id:'tariff',code:'RB20',version:1,enabled:true,confirmationRequired:false,rateType:'RB',size:'20',unit:'RIT',unitPrice:'150000.00'}]};
 const jobs=require('../src/services/journeys');let costs=0;t.mock.method(jobs,'createCost',async()=>{costs++;f.parent.version++;return {charge:{id:'one-charge'},approval:{id:'one-approval'}};});
 const body={version:1,periodFrom:'2026-01-01',periodTo:'2026-01-31',workIds:['work-a']},estimate=await operations.wageEstimate(f.tx,'j',body);assert.equal(estimate.amount,'150000.00');assert.equal(estimate.lines[0].quantity,1);
 const saved=await operations.createWage(f.tx,user,'j',{...body,confirmed:true,fingerprint:estimate.fingerprint});assert.equal(saved.chargeId,'one-charge');assert.equal(costs,1);assert.equal(f.parent.data.driverOperations.works[0].payrollId,saved.id);
 for(const version of [1,f.parent.version])await assert.rejects(operations.createWage(f.tx,user,'j',{...body,version,confirmed:true,fingerprint:estimate.fingerprint}),e=>e.status===409);assert.equal(costs,1);
 await assert.rejects(operations.transition(f.tx,user,'j','work-a',{version:f.parent.version,status:'CANCELLED',reason:'No double pay'}),e=>e.status===409);
});
test('wages never merge different explicit driver IDs even when normalized names collide',async()=>{
 const f=fixture();Object.assign(f.work,{status:'VERIFIED',driverId:'d1',driverEmploymentType:'INTERNAL',driverName:'Same Name'});
 f.parent.data.driverOperations.works.push({...f.work,id:'other-id',driverId:'d2',driverName:' same   name '});
 await assert.rejects(operations.wageEstimate(f.tx,'j',{version:1,periodFrom:'2026-01-01',periodTo:'2026-01-31',workIds:['work-a','other-id']}),e=>e.status===422&&/satu sopir/.test(e.message));assert.equal(f.writes.length,0);
});
test('internal wage flow rejects vendor and unmapped works before rates or costs',async()=>{
 for(const employmentType of ['VENDOR',null]){
  const f=fixture();Object.assign(f.work,{status:'VERIFIED',driverId:employmentType?'vendor':null,driverEmploymentType:employmentType});
  await assert.rejects(operations.wageEstimate(f.tx,'j',{version:1,periodFrom:'2026-01-01',periodTo:'2026-01-31',workIds:['work-a']}),e=>e.status===409&&/vendor|petakan/i.test(e.message));assert.equal(f.writes.length,0);
 }
});

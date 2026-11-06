const test=require('node:test'),assert=require('node:assert/strict');
const {setup,user}=require('./driverDispatch.test'),dispatch=require('../src/services/driverDispatch'),scoped=require('../src/services/billDriverOperations');
test('issuing an inferred legacy assignment fixes its bill ownership before later edits',async()=>{
 const f=setup();f.work.billId=null;const saved=await dispatch.issueBill(f.tx,user,'a','work-a',{version:1,documentType:'TRANSPORT_ORDER',confirmed:true});assert.equal(saved.billId,'a');assert.equal(f.parent.data.driverOperations.works.find(w=>w.id==='work-a').billId,'a');
});
test('pre-receipt dispatch never submits verifies reserves counts or creates wages',async()=>{
 const f=setup();await dispatch.issueBill(f.tx,user,'a','work-a',{version:1,documentType:'TRANSPORT_ORDER',confirmed:true});
 const work=f.parent.data.driverOperations.works.find(w=>w.id==='work-a');assert.equal(work.status,'DRAFT');assert.equal(work.payrollId,undefined);assert.deepEqual(require('../src/services/driverOperations').usage(f.parent.data.driverOperations,'C1'),{rb:0,rk:0});
 await assert.rejects(scoped.transition(f.tx,user,'a','work-a',{version:2,status:'SUBMITTED'}));
 await assert.rejects(scoped.transition(f.tx,user,'a','work-a',{version:2,status:'VERIFIED',proofChecked:true}));
 await assert.rejects(require('../src/services/driverOperations').createWage(f.tx,user,'j',{version:2,periodFrom:'2026-01-01',periodTo:'2026-01-31',workIds:['work-a'],confirmed:true}));
 f.tx.shippingJourney.findMany=async()=>[f.parent];assert.equal((await require('../src/services/driverTrips').list(f.tx,{month:'2026-01'})).total,0);assert.equal(f.parent.version,2);
});
test('saved dispatch retains original receipt references when later draft evidence is removed',async()=>{
 const f=setup();Object.assign(f.work,{evidenceFileIds:['own'],receiptReference:'REC-ORIGINAL',receivedDate:'2026-01-02'});
 const saved=await dispatch.issueBill(f.tx,user,'a','work-a',{version:1,documentType:'DELIVERY_NOTE',confirmed:true});assert.deepEqual(saved.evidenceFileIds,['own']);assert.equal(saved.receiptReference,'REC-ORIGINAL');
 const work=f.parent.data.driverOperations.works.find(w=>w.id==='work-a');await scoped.saveWork(f.tx,user,'a','work-a',{version:2,work:{...work,evidenceFileIds:[],receiptReference:null,receivedDate:null}});
 const ops=require('../src/services/driverOperations');assert(ops.references(ops.state(f.parent),'own'));assert.deepEqual((await dispatch.getBill(f.tx,'a','work-a',saved.id)).evidenceFileIds,['own']);
});
test('stored PDF corruption is rejected instead of rerendering a mutable fallback',async()=>{
 const f=setup(),saved=await dispatch.issueBill(f.tx,user,'a','work-a',{version:1,documentType:'TRANSPORT_ORDER',confirmed:true});saved.pdfBase64=Buffer.from('not the saved PDF').toString('base64');assert.throws(()=>dispatch.pdf(saved),e=>e.status===409);delete saved.pdfBase64;assert.throws(()=>dispatch.pdf(saved),e=>e.status===409);
});
test('published dispatch prevents aggregate bill reassignment and preserves immutable bytes on ordinary edits',async()=>{
 const f=setup(),body={version:1,documentType:'TRANSPORT_ORDER',confirmed:true},saved=await dispatch.issueBill(f.tx,user,'a','work-a',body),bytes=dispatch.pdf(saved);
 const work=f.parent.data.driverOperations.works.find(w=>w.id==='work-a');
 await assert.rejects(require('../src/services/driverOperations').saveWork(f.tx,user,'j','work-a',{version:2,work:{...work,billId:'b',containerNumber:'C2'}}),e=>e.status===409);assert.equal(f.parent.version,2);
 await scoped.saveWork(f.tx,user,'a','work-a',{version:2,work:{...work,instructions:'Updated',dispatches:[],compliance:{driver:{licenseClass:'FAKE'}}}});
 const current=f.parent.data.driverOperations.works.find(w=>w.id==='work-a');await require('../src/services/driverOperations').saveWork(f.tx,user,'j','work-a',{version:3,work:{...current,billId:undefined}});assert.equal(f.parent.data.driverOperations.works.find(w=>w.id==='work-a').billId,'a');
 const historical=await dispatch.getBill(f.tx,'a','work-a',saved.id);assert.deepEqual(dispatch.pdf(historical),bytes);assert.equal(historical.instructions,'Collect sealed container');
});

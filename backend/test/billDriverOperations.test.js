const test=require('node:test'),assert=require('node:assert/strict');
const scoped=(()=>{try{return require('../src/services/billDriverOperations');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;return {};}})();
function fixture(){
 const a={id:'a',jobId:'job',journeyId:'j',billNumber:'BL-A',version:1,containers:[{number:'C1',size:'20'},{number:'SHARED',size:'20'}],registerData:{},files:[{id:'own',filename:'own.pdf',originalName:'Own receipt',category:'POD'}],allocations:[]};
 const b={...structuredClone(a),id:'b',billNumber:'BL-B',containers:[{number:'C2',size:'20'},{number:'SHARED',size:'20'}],files:[{id:'foreign',filename:'foreign.pdf',originalName:'Foreign receipt',category:'POD'}]};
 const work={id:'work-a',billId:'a',containerNumber:'C1',containerKey:'C1',size:'20',status:'DRAFT',driverName:'Driver',vehicleNumber:'PA123',origin:'Port',destination:'Warehouse',rateType:'RB',receivedDate:'2026-01-02',receiptReference:'REC1',items:[{owner:'Owner',collyCount:1,collyType:'BOX',goodsType:'Goods'}],evidenceFileIds:['own']};
 const parent={id:'j',number:'J1',version:1,data:{driverOperations:{works:[work,{...work,id:'work-b',billId:'b',containerNumber:'C2',containerKey:'C2',evidenceFileIds:['foreign']},{...work,id:'unmapped',billId:null,containerNumber:'SHARED',containerKey:'SHARED',evidenceFileIds:[]}],budgets:[{containerKey:'C1',number:'C1',size:'20',rb:2,rk:1}],recaps:[{id:'secret-payroll',amount:'999'}]}},bills:[a,b],files:[]};
 const writes=[],tx={seaBill:{findUnique:async({where})=>[a,b].find(bill=>bill.id===where.id),update:async({where,data})=>{writes.push(data);const bill=[a,b].find(b=>b.id===where.id);bill.version+=data.version?.increment||0;return bill;}},shippingJourney:{findUnique:async()=>parent,update:async({data})=>{writes.push(data);if(data.data)parent.data=structuredClone(data.data);parent.version+=data.version?.increment||0;return parent;}},activityLog:{create:async({data})=>data}};
 return {a,b,parent,work,tx,writes};
}
test('selected bill management returns only owned work, evidence and containers, never payroll or sibling rows',async()=>{
 assert.equal(typeof scoped.list,'function','scoped list is implemented');const f=fixture(),result=await scoped.list(f.tx,'a');
 assert.deepEqual(result.works.map(w=>w.id),['work-a']);assert.deepEqual(result.files.map(f=>f.evidenceId),['own']);assert.deepEqual(result.containers.map(c=>c.number),['C1','SHARED']);assert.equal(result.mappingRequired,true);assert.equal(result.version,1);assert.equal(result.recaps,undefined);assert.equal(result.payments,undefined);assert.equal(result.works[0].evidenceStatus,'READY');assert(!JSON.stringify(result).includes('foreign.pdf'));
});
test('scoped CRUD rejects sibling work, containers, evidence and explicit reassignment before writing',async()=>{
 assert.equal(typeof scoped.saveWork,'function','scoped save is implemented');
 for(const change of ['foreign-work','foreign-container','foreign-evidence','foreign-bill','unmapped','stale','archived','trashed']){
  const f=fixture();let id='work-a',work={...f.work};
  if(change==='foreign-work')id='work-b';if(change==='unmapped')id='unmapped';if(change==='foreign-container')work.containerNumber='C2';if(change==='foreign-evidence')work.evidenceFileIds=['foreign'];if(change==='foreign-bill')work.billId='b';if(change==='archived')f.a.archivedAt=new Date();if(change==='trashed')f.a.registerData.trash={deletedAt:'2026-01-03'};
  await assert.rejects(scoped.saveWork(f.tx,{id:'staff',role:'ADMIN'},'a',id,{version:change==='stale'?2:1,work}),change);assert.equal(f.writes.length,0,change);
 }
 const f=fixture(),saved=await scoped.saveWork(f.tx,{id:'staff',role:'ADMIN'},'a','work-a',{version:1,work:{...f.work,billId:undefined,containerNumber:'SHARED',deliveries:[{id:'completed',billId:'a',containerNumber:'SHARED',recipient:'Owner',destination:'Warehouse',items:f.work.items,receivedDate:f.work.receivedDate,evidenceFileIds:['own']}]}});assert.equal(saved.billId,'a');assert.equal(saved.status,'DRAFT');assert.equal(f.parent.version,2);assert.equal(f.parent.data.driverOperations.works.find(w=>w.id==='work-b').billId,'b');
});
test('scoped status enforces ownership and evidence before delegating shared quota and verification rules',async()=>{
 assert.equal(typeof scoped.transition,'function','scoped status is implemented');
 for(const id of ['work-b','unmapped']){const f=fixture();await assert.rejects(scoped.transition(f.tx,{id:'staff',role:'ADMIN'},'a',id,{version:1,status:'CANCELLED',reason:'No delivery'}),e=>e.status===404);assert.equal(f.writes.length,0);}
 const f=fixture();await scoped.transition(f.tx,{id:'staff',role:'ADMIN'},'a','work-a',{version:1,status:'SUBMITTED'});assert.equal(f.parent.data.driverOperations.works[0].status,'SUBMITTED');
 await assert.rejects(scoped.transition(f.tx,{id:'staff',role:'ADMIN'},'a','work-a',{version:2,status:'VERIFIED'}));
 await scoped.transition(f.tx,{id:'staff',role:'ADMIN'},'a','work-a',{version:2,status:'VERIFIED',proofChecked:true});assert.equal(f.parent.data.driverOperations.works[0].status,'VERIFIED');
 const g=fixture();g.work.evidenceFileIds=['foreign'];await assert.rejects(scoped.transition(g.tx,{id:'staff',role:'ADMIN'},'a','work-a',{version:1,status:'SUBMITTED'}));assert.equal(g.writes.length,0);
});
test('scoped evidence upload attaches only to selected B/L and advances shared version',async()=>{
 assert.equal(typeof scoped.attachEvidence,'function','scoped upload is implemented');const f=fixture(),created=[];
 f.tx.seaBillFile={create:async({data})=>{const file={...data,id:'new-proof'};created.push(file);f.a.files.push(file);return file;}};
 const result=await scoped.attachEvidence(f.tx,{id:'staff',role:'ADMIN'},'a',{version:1},{filename:'receipt.txt',originalname:'receipt.txt',mimetype:'text/plain',size:5});
 assert.equal(result.id,'new-proof');assert.equal(created[0].billId,'a');assert.equal(created[0].category,'DELIVERY_RECEIPT');assert.equal(f.b.files.length,1);assert.equal(f.parent.version,2);assert.equal(f.a.version,2);
 const g=fixture();g.parent.archivedAt=new Date();await assert.rejects(scoped.attachEvidence(g.tx,{id:'staff',role:'ADMIN'},'a',{version:1},{filename:'x',size:5}));assert.equal(g.writes.length,0);
});
test('register exposes scoped modern work and evidence HTTP routes',()=>{
 const routes=require('../src/routes/blRegister').stack.filter(layer=>layer.route).map(layer=>`${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
 for(const route of ['GET /:id/driver-operations','POST /:id/driver-operations/works','PUT /:id/driver-operations/works/:workId','POST /:id/driver-operations/works/:workId/status','POST /:id/driver-operations/evidence'])assert(routes.includes(route),route);
});
test('container choices never expose sibling B/L identifiers',async()=>{
 const f=fixture(),result=await scoped.list(f.tx,'a');assert.deepEqual(result.containers.find(c=>c.number==='SHARED').billIds,['a']);
});
test('scoped mutation responses use the same work allowlist and evidence projection as GET',async()=>{
 for(const [from,status] of [['DRAFT','SUBMITTED'],['SUBMITTED','VERIFIED'],['SUBMITTED','REJECTED'],['DRAFT','CANCELLED']]){
  const f=fixture();Object.assign(f.work,{status:from,amount:'999',payments:[{amount:'999'}],privatePayroll:'secret'});
  if(['REJECTED','CANCELLED'].includes(status))f.work.evidenceFileIds=['own','foreign'];
  const result=await scoped.transition(f.tx,{id:'staff',role:'ADMIN'},'a','work-a',{version:1,status,proofChecked:true,reason:'Reviewed'});
  const listed=(await scoped.list(f.tx,'a')).works.find(w=>w.id==='work-a');
  assert.deepEqual(result,listed,status);assert.equal(result.amount,undefined);assert.equal(result.privatePayroll,undefined);assert.deepEqual(result.evidenceFileIds,['own']);
  assert.equal(f.parent.version,2);assert.equal(f.parent.data.driverOperations.works.find(w=>w.id==='work-b').status,'DRAFT');
 }
 const f=fixture(),saved=await scoped.saveWork(f.tx,{id:'staff',role:'ADMIN'},'a','work-a',{version:1,work:f.work});
 assert.deepEqual(saved,(await scoped.list(f.tx,'a')).works.find(w=>w.id===saved.id));
});
test('scoped readiness validates original evidence rather than its safe response projection',async()=>{
 for(const ids of [['own','foreign'],['own','deleted'],['own','own']]){
  const f=fixture();f.work.evidenceFileIds=ids;
  const result=await scoped.list(f.tx,'a');
  assert.equal(result.works[0].evidenceStatus,'UPLOADED',JSON.stringify(ids));
  assert(!result.works[0].evidenceFileIds.includes('foreign'));assert(!result.works[0].evidenceFileIds.includes('deleted'));
  await assert.rejects(scoped.transition(f.tx,{id:'staff',role:'ADMIN'},'a','work-a',{version:1,status:'SUBMITTED'}),e=>e.status===422);assert.equal(f.writes.length,0);
 }
});
test('scoped readiness checks stored container size without normalizing stale work into READY',async()=>{
 for(const status of ['DRAFT','REJECTED']){
  const f=fixture();Object.assign(f.work,{status,size:'40'});
  const result=await scoped.list(f.tx,'a');assert.equal(result.works[0].size,'40');assert.equal(result.works[0].evidenceStatus,'UPLOADED');
  if(status==='DRAFT')await assert.rejects(scoped.transition(f.tx,{id:'staff',role:'ADMIN'},'a','work-a',{version:1,status:'SUBMITTED'}),e=>e.status===409);
  assert.equal(f.writes.length,0);
 }
});
test('shared container choices use selected B/L size and seal regardless of sibling ordering',async()=>{
 for(const siblingFirst of [true,false]){
  const f=fixture();Object.assign(f.a.containers[1],{size:'40',seal:'SELECTED'});Object.assign(f.b.containers[1],{size:'20',seal:'SIBLING'});
  if(siblingFirst)f.parent.bills.reverse();
  const result=await scoped.list(f.tx,'a'),container=result.containers.find(c=>c.number==='SHARED');
  assert.equal(container.size,'40');assert.equal(container.seal,'SELECTED');assert.deepEqual(container.billIds,['a']);assert.equal(f.writes.length,0);
 }
});
test('scoped save rejects conflicting shared container identities before writing',async()=>{
 for(const field of ['size','seal'])for(const siblingFirst of [true,false])for(const workId of [null,'work-a']){
  const f=fixture();Object.assign(f.a.containers[1],{size:'40',seal:'SELECTED'});Object.assign(f.b.containers[1],{size:'40',seal:'SELECTED',[field]:field==='size'?'20':'SIBLING'});
  if(siblingFirst)f.parent.bills.reverse();
  await assert.rejects(scoped.saveWork(f.tx,{id:'staff',role:'ADMIN'},'a',workId,{version:1,work:{...f.work,containerNumber:'SHARED'}}),e=>e.status===409,`${field}, sibling first ${siblingFirst}, work ${workId}`);
  assert.equal(f.writes.length,0);assert.equal(f.parent.version,1);
 }
});
test('scoped transitions reject sibling identity conflicts even when aggregate work and budget agree',async()=>{
 for(const field of ['size','seal'])for(const status of ['SUBMITTED','VERIFIED','REJECTED','CANCELLED']){
  const f=fixture();Object.assign(f.a.containers[1],{size:'40',seal:'SELECTED'});Object.assign(f.b.containers[1],{size:field==='size'?'20':'40',seal:field==='seal'?'SIBLING':'SELECTED'});f.parent.bills.reverse();
  Object.assign(f.work,{containerNumber:'SHARED',containerKey:'SHARED',size:field==='size'?'20':'40',status:['VERIFIED','REJECTED'].includes(status)?'SUBMITTED':'DRAFT'});
  f.parent.data.driverOperations.budgets.push({containerKey:'SHARED',number:'SHARED',size:f.work.size,rb:2,rk:1});
  await assert.rejects(scoped.transition(f.tx,{id:'staff',role:'ADMIN'},'a','work-a',{version:1,status,proofChecked:true,reason:'Reviewed'}),e=>e.status===409,`${field}: ${status}`);
  assert.equal(f.writes.length,0);assert.equal(f.parent.version,1);
 }
});
test('shared identity conflicts cannot be advertised READY even when selected work size agrees',async()=>{
 const f=fixture();Object.assign(f.work,{containerNumber:'SHARED',containerKey:'SHARED'});f.a.containers[1].seal='SELECTED';f.b.containers[1].seal='SIBLING';
 assert.equal((await scoped.list(f.tx,'a')).works[0].evidenceStatus,'UPLOADED');assert.equal(f.writes.length,0);
});
module.exports={fixture};

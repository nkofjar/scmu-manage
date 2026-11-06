const test=require('node:test'),assert=require('node:assert/strict');
const ops=require('../src/services/driverOperations');
test('container allowance counts trips across drivers and B/Ls, never goods rows or photos',()=>{
 const data={works:[{id:'a',containerKey:'C1',status:'SUBMITTED',rateType:'RB',items:[1,2,3],evidenceFileIds:['1','2']},{id:'b',containerKey:'C1',status:'VERIFIED',rateType:'RB',driverName:'Other'},{id:'c',containerKey:'C1',status:'DRAFT',rateType:'RB'},{id:'d',containerKey:'C1',status:'CANCELLED',rateType:'RK'},{id:'e',containerKey:'C2',status:'VERIFIED',rateType:'RB'}]};
 assert.deepEqual(ops.usage(data,'C1'),{rb:2,rk:0});ops.checkCapacity(data,{containerKey:'C1',number:'C1',rb:3,rk:0},null,'RB');assert.throws(()=>ops.checkCapacity(data,{containerKey:'C1',number:'C1',rb:2,rk:2},null,'RB'),e=>e.status===409);ops.checkCapacity(data,{containerKey:'C1',number:'C1',rb:2,rk:2},null,'RK');
 assert.deepEqual(ops.checkCapacity(data,{containerKey:'C1',number:'C1',rb:2,rk:0},'a','RB'),{rb:2,rk:0});
});
test('draft retains incomplete data; submission requires actual goods and delivery evidence',()=>{
 const row={id:'j',vesselName:'Vessel',voyageNumber:'1',files:[{id:'proof',filename:'p'}],bills:[]};const draft=ops.normalizeWork({items:[],evidenceFileIds:[],rateType:'RK'},row);assert.match(draft.number,/^BON-SCMU-/);assert.equal(draft.rateType,'RK');assert.equal(draft.status,'DRAFT');assert.throws(()=>ops.ready(draft));
 assert.throws(()=>ops.normalizeWork({items:[],receivedDate:'2026-02-30'},row));assert.throws(()=>ops.normalizeWork({items:[],evidenceFileIds:['foreign']},row));assert.throws(()=>ops.normalizeWork({items:[{collyCount:-1}]},row));assert.throws(()=>ops.normalizeWork({items:[],containerNumber:'unknown'},row));
});
test('work, quota and wage evidence remain referenced, including cancelled historical work',()=>{
 const data={works:[{evidenceFileIds:['receipt'],status:'CANCELLED'}],quotaRequests:[{evidenceFileIds:['instruction']}],paymentRequests:[{evidenceFileIds:['transfer']}]};for(const id of ['receipt','instruction','transfer'])assert(ops.references(data,id));assert(!ops.references(data,'unrelated'));
});
function workFixture(){
 const row={id:'j',number:'PGR-1',version:1,data:{},files:['DELIVERY_RECEIPT','POD','SUPPORTING','PAYMENT_PROOF','FINAL','PACKING_LIST','INTERNAL_PACKING_RECAP','MANIFEST'].map(category=>({id:category,category,filename:category+'.txt',originalName:category+'.txt'})),bills:[{id:'bill',billNumber:'BL1',containers:[{number:'CONT1',size:'20',seal:'S'}],registerData:{},files:[],allocations:[]}]},writes=[],logs=[];
 const tx={shippingJourney:{findUnique:async()=>row,update:async({data})=>{writes.push(data);if(data.data)row.data=structuredClone(data.data);row.version+=data.version?.increment||0;return row;}},activityLog:{create:async({data})=>{logs.push(data);return data;}}};
 const work={containerNumber:'CONT1',driverName:'Driver',vehicleNumber:'PA1234',origin:'Port',destination:'Warehouse',rateType:'RB',receivedDate:'2026-01-02',receiptReference:'REC1',items:[{owner:'Owner',collyCount:2,collyType:'BOX',goodsType:'Goods'}],evidenceFileIds:['DELIVERY_RECEIPT']};
 return {row,tx,writes,logs,work};
}
test('work save accepts POD, preserves grandfathered evidence on edit and transitions without accepting new B/L or PL evidence',async()=>{
 const f=workFixture();const saved=await ops.saveWork(f.tx,{id:'staff'},'j',null,{version:1,work:{...f.work,evidenceFileIds:['POD']}});assert.deepEqual(saved.evidenceFileIds,['POD']);
 // Old linked generic evidence remains usable, but cannot be added to another work.
 f.row.data.driverOperations.works[0].evidenceFileIds=['SUPPORTING','MANIFEST'];f.row.data.driverOperations.works[0].identityPolicy=null;
 const edited=await ops.saveWork(f.tx,{id:'staff'},'j',saved.id,{version:2,work:{...f.work,evidenceFileIds:undefined}});assert.deepEqual(edited.evidenceFileIds,['SUPPORTING','MANIFEST']);
 f.row.data.driverOperations.budgets=[{containerKey:'CONT1',number:'CONT1',size:'20',rb:2,rk:1}];
 assert.equal((await ops.transition(f.tx,{id:'staff'},'j',saved.id,{version:3,status:'SUBMITTED'})).status,'SUBMITTED');
 assert.equal((await ops.transition(f.tx,{id:'checker'},'j',saved.id,{version:4,status:'VERIFIED',proofChecked:true})).status,'VERIFIED');
 for(const category of ['FINAL','PACKING_LIST','INTERNAL_PACKING_RECAP','SUPPORTING','MANIFEST','PAYMENT_PROOF']){
  const g=workFixture();await assert.rejects(ops.saveWork(g.tx,{id:'staff'},'j',null,{version:1,work:{...g.work,evidenceFileIds:[category]}}));assert.equal(g.writes.length,0);
 }
});
test('list derives evidence readiness and bill links without persisting workflow changes, including aliased legacy proofs',async()=>{
 const f=workFixture(),base=ops.normalizeWork(f.work,f.row);
 f.row.bills[0].files=[{id:'canonical',filename:'legacy.txt',originalName:'Legacy proof',category:'SUPPORTING'}];
 f.row.bills[0].document={id:'hidden-legacy',filename:'legacy.txt',originalName:'Legacy proof'};
 const rows=[
  {...base,id:'missing',evidenceFileIds:[]},
  {...base,id:'deleted',evidenceFileIds:['gone']},
  {...base,id:'incomplete',destination:null},
  {...base,id:'ready'},
  {...base,id:'rejected',status:'REJECTED'},
  {...base,id:'submitted',status:'SUBMITTED'},
  {...base,id:'verified',status:'VERIFIED'},
  {...base,id:'payroll',payrollId:'recap'},
  {...base,id:'cancelled',status:'CANCELLED'},
  {...base,id:'legacy',evidenceFileIds:['hidden-legacy']},
  {...base,id:'mixed',evidenceFileIds:['DELIVERY_RECEIPT','gone']}
 ];
 f.row.data.driverOperations={works:rows};const before=structuredClone(f.row);
 const result=await ops.list(f.tx,'j'),statuses=Object.fromEntries(result.works.map(w=>[w.id,w.evidenceStatus]));
 assert.deepEqual(statuses,{missing:'MISSING',deleted:'MISSING',incomplete:'UPLOADED',ready:'READY',rejected:'READY',submitted:'IN_BON',verified:'IN_BON',payroll:'IN_BON',cancelled:'UPLOADED',legacy:'READY',mixed:'UPLOADED'});
 assert.deepEqual(result.works.find(w=>w.id==='ready').billIds,['bill']);assert.deepEqual(f.row,before);assert.equal(f.writes.length,0);
 const legacy=result.files.find(file=>file.evidenceIds?.includes('hidden-legacy'));assert(legacy);assert.equal(legacy.filename,undefined);assert(legacy.evidenceIds.includes('canonical'));
 const edited=await ops.saveWork(f.tx,{id:'staff'},'j','legacy',{version:1,work:{...f.work,evidenceFileIds:['hidden-legacy']}});assert.deepEqual(edited.evidenceFileIds,['hidden-legacy']);
 assert.equal(f.row.data.driverOperations.works.find(w=>w.id==='legacy').evidenceStatus,undefined);
});
test('readiness tolerates incomplete legacy fields and cannot be spoofed by persisted or submitted derived values',async()=>{
 const f=workFixture(),base=ops.normalizeWork(f.work,f.row);
 f.row.data.driverOperations={works:[{...base,id:'legacy-incomplete',items:undefined,evidenceStatus:'READY'}]};
 const result=await ops.list(f.tx,'j');assert.equal(result.works[0].evidenceStatus,'UPLOADED');
 const saved=await ops.saveWork(f.tx,{id:'staff'},'j',null,{version:1,work:{...f.work,evidenceStatus:'IN_BON',billIds:['foreign']}});assert.equal(saved.evidenceStatus,undefined);assert.equal(saved.billIds,undefined);assert.equal(saved.status,'DRAFT');
});
test('actual work writes reject stale, archived and trashed parents and cannot skip explicit workflow',async()=>{
 for(const action of ['save','submit'])for(const closed of ['stale','archivedAt','deletedAt']){
  const f=workFixture(),work={...ops.normalizeWork(f.work,f.row),id:'work'};f.row.data.driverOperations={works:[work]};if(closed!=='stale')f.row[closed]=new Date();
  await assert.rejects(action==='save'?ops.saveWork(f.tx,{id:'staff'},'j','work',{version:closed==='stale'?2:1,work:f.work}):ops.transition(f.tx,{id:'staff'},'j','work',{version:closed==='stale'?2:1,status:'SUBMITTED'}),e=>e.status===409);assert.equal(f.writes.length,0);assert.equal(f.logs.length,0);
 }
 const f=workFixture(),work={...ops.normalizeWork(f.work,f.row),id:'work'};f.row.data.driverOperations={works:[work]};
 await assert.rejects(ops.transition(f.tx,{id:'staff'},'j','work',{version:1,status:'VERIFIED',proofChecked:true}),e=>e.status===409);assert.equal(f.writes.length,0);
 assert.throws(()=>ops.ready({...work,evidenceFileIds:undefined}),e=>e.status===422);
});
test('quota review retains linked legacy evidence while new quota and payment requests reject wrong document owners',async()=>{
 const f=workFixture(),budget={containerKey:'CONT1',number:'CONT1',size:'20',rb:2,rk:1};
 f.row.data.driverOperations={budgets:[budget],works:[],quotaRequests:[{id:'request',status:'SUBMITTED',containerKey:'CONT1',before:structuredClone(budget),rb:3,rk:1,evidenceFileIds:['MANIFEST']}]};
 const context=await ops.quotaContext(f.tx,'j',{requestId:'request'});assert.equal(context.view.tables[0].rows[0].category,'MANIFEST');assert.equal(f.writes.length,0);
 for(const category of ['FINAL','PACKING_LIST','INTERNAL_PACKING_RECAP','MANIFEST'])await assert.rejects(ops.quotaRequest(f.tx,{id:'staff'},'j',{version:1,containerNumber:'CONT1',confirmed:true,rb:3,rk:1,evidenceFileIds:[category],reason:'More trips'}));
 f.row.data.driverOperations.recaps=[{id:'recap',chargeId:'charge',driverName:'Driver'}];f.tx.jobCharge={findUnique:async()=>({id:'charge',status:'APPROVED'})};
 for(const category of ['DELIVERY_RECEIPT','SUPPORTING','FINAL','PACKING_LIST'])await assert.rejects(ops.paymentRequest(f.tx,{id:'staff'},'j','recap',{version:1,evidenceFileIds:[category]}),e=>/Pilih bukti/.test(e.message));
 assert.equal(f.writes.length,0);
});
test('submission and verification reject stale selected B/L ownership even when another active B/L retains the container',async()=>{
 for(const status of ['SUBMITTED','VERIFIED'])for(const change of ['detached','trashed','container-removed']){
  const f=workFixture(),work={...ops.normalizeWork({...f.work,billId:'bill'},f.row),id:'work',status:status==='VERIFIED'?'SUBMITTED':'DRAFT'};
  f.row.bills.push({...structuredClone(f.row.bills[0]),id:'other',billNumber:'BL2'});
  if(change==='detached')f.row.bills.shift();
  if(change==='trashed')f.row.bills[0].registerData.trash={deletedAt:'2026-01-03'};
  if(change==='container-removed')f.row.bills[0].containers=[];
  f.row.data.driverOperations={works:[work],budgets:[{containerKey:'CONT1',number:'CONT1',size:'20',rb:2,rk:1}]};
  await assert.rejects(ops.transition(f.tx,{id:'staff'},'j','work',{version:1,status,proofChecked:true}),e=>e.status===409&&/B\/L/.test(e.message));
  assert.equal(f.writes.length,0);assert.equal(f.logs.length,0);assert.equal(work.status,status==='VERIFIED'?'SUBMITTED':'DRAFT');
 }
});
test('readiness rechecks current container identity and selected B/L ownership without changing historical in-bon state',async()=>{
 for(const change of ['detached','trashed','container-removed','size-changed','container-gone']){
  const f=workFixture(),base=ops.normalizeWork({...f.work,billId:'bill'},f.row);
  f.row.data.driverOperations={works:[{...base,id:'draft'},{...base,id:'rejected',status:'REJECTED'},{...base,id:'submitted',status:'SUBMITTED'},{...base,id:'verified',status:'VERIFIED'}]};
  if(change==='detached')f.row.bills[0].id='other';
  if(change==='trashed'){f.row.bills.push({...structuredClone(f.row.bills[0]),id:'other'});f.row.bills[0].registerData.trash={deletedAt:'2026-01-03'};}
  if(change==='container-removed'){f.row.bills.push({...structuredClone(f.row.bills[0]),id:'other'});f.row.bills[0].containers=[];}
  if(change==='size-changed')f.row.bills[0].containers[0].size='40';
  if(change==='container-gone')f.row.bills[0].containers=[];
  const before=structuredClone(f.row),result=await ops.list(f.tx,'j');
  assert.deepEqual(result.works.map(w=>w.evidenceStatus),['UPLOADED','UPLOADED','IN_BON','IN_BON'],change);assert.deepEqual(f.row,before);assert.equal(f.writes.length,0);
 }
});
test('current selected B/L and unscoped legacy work remain ready and can submit with shared receipt attachments',async()=>{
 const f=workFixture(),base=ops.normalizeWork(f.work,f.row);
 f.row.data.driverOperations={works:[{...base,id:'selected',billId:'bill'},{...base,id:'unscoped',receiptReference:'REC2'}],budgets:[{containerKey:'CONT1',number:'CONT1',size:'20',rb:2,rk:1}]};
 assert.deepEqual((await ops.list(f.tx,'j')).works.map(w=>w.evidenceStatus),['READY','READY']);
 await ops.transition(f.tx,{id:'staff'},'j','selected',{version:1,status:'SUBMITTED'});
 await ops.transition(f.tx,{id:'staff'},'j','unscoped',{version:2,status:'SUBMITTED'});
 assert.equal(f.writes.length,2);
});
function wagePaymentFixture(){
 const f=workFixture(),approvals=[],payments=[];
 const charge={id:'charge',jobId:'job',status:'APPROVED',kind:'COST',costSource:'INTERNAL',actualAmount:'100.00',payments:[],description:'Driver wages'};
 f.row.data.driverOperations={recaps:[{id:'recap',number:'UPAH1',chargeId:'charge',driverName:'Driver'}]};
 f.tx.jobOrder={findUnique:async()=>({id:'job',status:'OPEN',jobNumber:'JOB1'})};
 f.tx.jobCharge={findUnique:async()=>charge,findFirst:async()=>charge};
 f.tx.jobPayment={findUnique:async()=>null,create:async({data})=>{const payment={...data,id:'payment'};payments.push(payment);return payment;}};
 f.tx.directorApproval={findFirst:async()=>null,create:async({data})=>{const approval={...data,id:'approval',status:'SUBMITTED'};approvals.push(approval);return approval;},findUnique:async({where})=>approvals.find(a=>a.id===where.id),update:async({where,data})=>Object.assign(approvals.find(a=>a.id===where.id),data)};
 return {...f,approvals,payments};
}
const paymentBody={version:1,evidenceFileIds:['PAYMENT_PROOF'],paidAt:'2026-01-02',amount:'100.00',reference:'TRANSFER1',method:'BANK_TRANSFER',notes:'Transfer proof checked'};
test('new wage payment requests persist an explicit PAYMENT_PROOF evidence policy',async()=>{
 const f=wagePaymentFixture(),approval=await ops.paymentRequest(f.tx,{id:'staff'},'j','recap',paymentBody);
 const requests=await ops.paymentRequests(f.tx,'j');assert.equal(requests.length,1);assert.equal(requests[0].approvalId,approval.id);assert.equal(requests[0].evidencePolicy,'PAYMENT_PROOF');assert.deepEqual(requests[0].evidenceFileIds,['PAYMENT_PROOF']);assert.equal(f.payments.length,0);
});
test('new wage payments revalidate PAYMENT_PROOF ownership at execution before financial or journey writes',async()=>{
 for(const category of ['DELIVERY_RECEIPT','POD','SUPPORTING','FINAL','PACKING_LIST','MANIFEST','missing']){
  const f=wagePaymentFixture(),approval=await ops.paymentRequest(f.tx,{id:'staff'},'j','recap',paymentBody);approval.status='APPROVED';
  const proof=f.row.files.find(file=>file.id==='PAYMENT_PROOF');if(category==='missing')f.row.files=f.row.files.filter(file=>file!==proof);else proof.category=category;
  const before=structuredClone(f.row);f.writes.length=0;f.logs.length=0;
  await assert.rejects(ops.recordWagePayment(f.tx,{id:'staff'},'j','recap',{version:2,approvalId:approval.id}),e=>e.status===422&&/Pilih bukti/.test(e.message));
  assert.deepEqual(f.row,before);assert.equal(f.payments.length,0);assert.equal(f.writes.length,0);assert.equal(f.logs.length,0);assert.equal(approval.executedAt,undefined);
 }
});
test('new wage payment executes with current PAYMENT_PROOF and remains single-use after reload',async()=>{
 const f=wagePaymentFixture(),approval=await ops.paymentRequest(f.tx,{id:'staff'},'j','recap',paymentBody);approval.status='APPROVED';
 const payment=await ops.recordWagePayment(f.tx,{id:'staff'},'j','recap',{version:2,approvalId:approval.id});assert.equal(payment.id,'payment');assert.equal(f.payments.length,1);
 const request=(await ops.paymentRequests(f.tx,'j'))[0];assert.equal(request.paymentId,payment.id);assert.equal(request.evidencePolicy,'PAYMENT_PROOF');assert(approval.executedAt);assert.equal(approval.resultId,payment.id);
 await assert.rejects(ops.recordWagePayment(f.tx,{id:'staff'},'j','recap',{version:3,approvalId:approval.id}),e=>e.status===409);assert.equal(f.payments.length,1);
});
function persistedLegacyPayment(f,evidenceFileIds){
 f.approvals.push({id:'legacy-approval',action:'PAYMENT_AUTHORIZE',jobId:'job',status:'APPROVED',payload:{direction:'INTERNAL_EXPENSE',invoiceId:null,chargeId:'charge',amount:'100.00',reference:'LEGACY1',method:'BANK_TRANSFER',paidTo:'Driver',isAdvance:false,notes:'Historical proof'}});
 f.row.data.driverOperations.paymentRequests=[{approvalId:'legacy-approval',recapId:'recap',paidAt:'2026-01-02',evidenceFileIds,createdById:'staff'}];
}
test('persisted legacy wage payment requests retain any available linked proof without adopting the new policy',async()=>{
 for(const category of ['DELIVERY_RECEIPT','POD','SUPPORTING','PAYMENT_PROOF','FINAL','PACKING_LIST','INTERNAL_PACKING_RECAP','MANIFEST']){
  const f=wagePaymentFixture();persistedLegacyPayment(f,[category]);
  const payment=await ops.recordWagePayment(f.tx,{id:'staff'},'j','recap',{version:1,approvalId:'legacy-approval'});
  assert.equal(payment.id,'payment');assert.equal(f.payments.length,1);const request=(await ops.paymentRequests(f.tx,'j'))[0];assert.equal(request.evidencePolicy,undefined);assert.deepEqual(request.evidenceFileIds,[category]);assert.equal(request.paymentId,payment.id);
 }
});
test('legacy payment compatibility cannot grandfather missing, foreign or trashed B/L proofs',async()=>{
 for(const source of ['missing','foreign','trashed']){
  const f=wagePaymentFixture();persistedLegacyPayment(f,['legacy-proof']);
  if(source==='foreign')f.row.files.push({id:'other-proof',category:'MANIFEST',filename:'other.txt'});
  if(source==='trashed'){f.row.bills[0].files=[{id:'legacy-proof',category:'MANIFEST',filename:'legacy.txt'}];f.row.bills[0].registerData.trash={deletedAt:'2026-01-03'};}
  await assert.rejects(ops.recordWagePayment(f.tx,{id:'staff'},'j','recap',{version:1,approvalId:'legacy-approval'}),e=>e.status===422&&/Pilih bukti/.test(e.message));assert.equal(f.payments.length,0);assert.equal(f.writes.length,0);assert.equal(f.logs.length,0);
 }
});
test('new wage payment execution requires a nonempty persisted proof selection',async()=>{
 for(const selection of [[],undefined]){
  const f=wagePaymentFixture(),approval=await ops.paymentRequest(f.tx,{id:'staff'},'j','recap',paymentBody);approval.status='APPROVED';f.row.data.driverOperations.paymentRequests[0].evidenceFileIds=selection;f.writes.length=0;f.logs.length=0;
  await assert.rejects(ops.recordWagePayment(f.tx,{id:'staff'},'j','recap',{version:2,approvalId:approval.id}),e=>e.status===422);assert.equal(f.payments.length,0);assert.equal(f.writes.length,0);assert.equal(f.logs.length,0);
 }
});
test('separate container schemes enforce RB and RK independently, without conversion',()=>{
 const data={works:Array.from({length:6},(_,i)=>({id:String(i),containerKey:'C40',status:'VERIFIED',rateType:'RB'}))};assert.throws(()=>ops.checkCapacity(data,{containerKey:'C40',number:'C40',rb:6,rk:0},null,'RB'));assert.throws(()=>ops.checkCapacity(data,{containerKey:'C40',number:'C40',rb:6,rk:0},null,'RK'));assert.deepEqual(ops.usage(data,'OTHER'),{rb:0,rk:0});
});

const test=require('node:test'),assert=require('node:assert/strict');
const ops=require('../src/services/driverOperations');
const {fixture}=require('./billDriverOperations.test');
const user={id:'staff',role:'ADMIN'};
const item={owner:'Owner',collyCount:2,collyType:'BOX',goodsType:'Rice',packageWeightKg:25};
function multi(f){return {...f.work,deliveries:[{id:'one',billId:'a',containerNumber:'C1',recipient:'First',destination:'Store A',items:[item],receivedDate:'2026-01-02',evidenceFileIds:['own']},{id:'two',billId:'b',containerNumber:'C2',recipient:'Second',destination:'Store B',items:[item],receivedDate:'2026-02-03',evidenceFileIds:['foreign']}]};}
test('one parent normalizes multiple B/L deliveries and derives completion only from all actual child dates',async()=>{
 const f=fixture(),saved=await ops.saveWork(f.tx,user,'j','work-a',{version:1,work:multi(f)});
 assert.equal(saved.deliveries.length,2);assert.equal(saved.billId,'a');assert.equal(saved.size,'20');assert.equal(saved.receivedDate,'2026-02-03');assert.deepEqual(saved.evidenceFileIds,['own','foreign']);assert.equal(saved.deliveries[0].items[0].packageWeightKg,25);
 const partial=multi(f);partial.deliveries[1].receivedDate=null;
 const draft=await ops.saveWork(f.tx,user,'j','work-a',{version:2,work:partial});assert.equal(draft.receivedDate,null);assert.throws(()=>ops.ready(draft));
});
test('multi-delivery submission uses one primary quota and needs no manual origin or receipt number',async()=>{
 const f=fixture(),work=multi(f);delete work.receiptReference;delete work.origin;
 await ops.saveWork(f.tx,user,'j','work-a',{version:1,work});
 const submitted=await ops.transition(f.tx,user,'j','work-a',{version:2,status:'SUBMITTED'});assert.equal(submitted.status,'SUBMITTED');
 assert.deepEqual(ops.usage(ops.state(f.parent),'C1'),{rb:1,rk:0});assert.deepEqual(ops.usage(ops.state(f.parent),'C2'),{rb:0,rk:0});
});
test('multi-delivery rejects foreign proof, duplicate child IDs, future receipt and foreign container before writes',async()=>{
 for(const change of ['proof','duplicate','future','container']){const f=fixture(),work=multi(f);if(change==='proof')work.deliveries[0].evidenceFileIds=['foreign'];if(change==='duplicate')work.deliveries[1].id='one';if(change==='future')work.deliveries[0].receivedDate='2999-01-01';if(change==='container')work.deliveries[0].containerNumber='C2';await assert.rejects(ops.saveWork(f.tx,user,'j','work-a',{version:1,work}),change);assert.equal(f.writes.length,0);}
});
test('route and goods masters are active server snapshots preserved on unchanged reassignment',async()=>{
 const f=fixture();let routeReads=0,goodsReads=0;
 f.tx.route={findUnique:async()=>{routeReads++;return {id:'r',name:'Port route',originCity:'Port',originState:'Papua',destCity:'Depot',destState:'Papua',isActive:true};}};
 f.tx.goodsType={findUnique:async()=>{goodsReads++;return {id:'g',name:'Cement',isActive:true};}};
 const work=multi(f);work.routeId='r';work.origin='SPOOF';work.deliveries[0].items[0]={...item,goodsTypeId:'g',goodsType:'SPOOF'};
 const saved=await ops.saveWork(f.tx,user,'j','work-a',{version:1,work});assert.equal(saved.routeId,'r');assert.equal(saved.origin,'Port, Papua');assert.equal(saved.destination,'Depot, Papua');assert.equal(saved.deliveries[0].items[0].goodsType,'Cement');
 f.tx.route.findUnique=async()=>{throw Error('unchanged route must retain snapshot');};f.tx.goodsType.findUnique=async()=>{throw Error('unchanged goods must retain snapshot');};
 const again=await ops.saveWork(f.tx,user,'j','work-a',{version:2,work:saved});assert.equal(again.origin,saved.origin);assert.equal(again.deliveries[0].items[0].goodsType,'Cement');assert.equal(routeReads,1);assert.equal(goodsReads,1);
 for(const kind of ['route','goodsType']){const g=fixture(),input=multi(g);g.tx[kind]={findUnique:async()=>({id:'inactive',isActive:false})};if(kind==='route')input.routeId='inactive';else input.deliveries[0].items[0]={...item,goodsTypeId:'inactive'};await assert.rejects(ops.saveWork(g.tx,user,'j','work-a',{version:1,work:input}));assert.equal(g.writes.length,0);}
});
test('linked bill views share parent identity but project only their own deliveries and block aggregate mutation',async()=>{
 const scoped=require('../src/services/billDriverOperations'),legacy=require('../src/services/driverBons');const f=fixture();await ops.saveWork(f.tx,user,'j','work-a',{version:1,work:multi(f)});
 for(const id of ['a','b']){const result=await scoped.list(f.tx,id),work=result.works.find(w=>w.id==='work-a');assert(work,id);assert.equal(work.billId,'a');assert.equal(work.sharedWork,true);assert.equal(work.readOnly,true);assert.deepEqual(work.deliveries.map(d=>d.billId),[id]);assert.deepEqual(work.evidenceFileIds,[id==='a'?'own':'foreign']);assert(!JSON.stringify(work).includes(JSON.stringify(id==='a'?'foreign':'own')));assert.equal(work.dispatches,undefined);
 const read=await legacy.operations(f.tx,id);assert.equal(read.works.find(w=>w.id==='work-a').sharedWork,true);
 const writes=f.writes.length;await assert.rejects(scoped.transition(f.tx,user,id,'work-a',{version:2,status:'SUBMITTED'}),e=>e.status===409);await assert.rejects(scoped.saveWork(f.tx,user,id,'work-a',{version:2,work:multi(f)}),e=>e.status===409);assert.equal(f.writes.length,writes);}
});
test('aggregate list supplies bill container selection and evidence ownership endpoints',async()=>{
 const f=fixture();f.tx.jobCharge={findMany:async()=>[]};const result=await ops.list(f.tx,'j');assert.deepEqual(result.bills.map(b=>b.id),['a','b']);assert.equal(result.bills[1].billNumber,'BL-B');assert.equal(result.bills[1].containers[0].number,'C2');const proof=result.files.find(x=>x.evidenceId==='foreign');assert.deepEqual(proof.billIds,['b']);assert.equal(proof.endpoint,'/bl-register/b/files/foreign');
});
test('child evidence and immutable dispatch child snapshots remain dependency references',()=>{
 const state={works:[{id:'w',deliveries:[{evidenceFileIds:['child']}],dispatches:[{deliveries:[{evidenceFileIds:['historic']}]}]}],quotaRequests:[]};assert.equal(ops.references(state,'child'),true);assert.equal(ops.references(state,'historic'),true);assert.equal(ops.references(state,'absent'),false);
});
test('submission revalidates every stored child identity and evidence before reserving primary quota',async()=>{
 for(const change of ['proof','container','date']){const f=fixture();await ops.saveWork(f.tx,user,'j','work-a',{version:1,work:multi(f)});if(change==='proof')f.b.files=[];if(change==='container')f.b.containers[0].size='40';if(change==='date')f.parent.data.driverOperations.works.find(w=>w.id==='work-a').deliveries[1].receivedDate='2999-01-01';const writes=f.writes.length;await assert.rejects(ops.transition(f.tx,user,'j','work-a',{version:2,status:'SUBMITTED'}));assert.equal(f.writes.length,writes);}
});
test('shared dispatch snapshots every planned child and reuses identical revision across linked B/Ls',async()=>{
 const dispatch=require('../src/services/driverDispatch'),f=fixture();f.tx.company={findUnique:async({where})=>({id:where.id,name:'SCMU',isInternal:true,isActive:true})};const work=multi(f);work.deliveries.forEach(d=>{d.receivedDate=null;d.evidenceFileIds=[];});await ops.saveWork(f.tx,user,'j','work-a',{version:1,work});
 const body={version:2,documentType:'DELIVERY_NOTE',taskDate:'2027-01-01',confirmed:true},saved=await dispatch.issueBill(f.tx,user,'a','work-a',body);assert.equal(saved.deliveries.length,2);assert.deepEqual(saved.billIds,['a','b']);const bytes=dispatch.pdf(saved);
 const repeated=await dispatch.issueBill(f.tx,user,'b','work-a',{...body,version:3});assert.equal(repeated.id,saved.id);assert.equal(f.parent.version,3);assert.equal(f.parent.data.driverOperations.works.find(w=>w.id==='work-a').billId,'a');assert.deepEqual(dispatch.pdf(await dispatch.getBill(f.tx,'b','work-a',saved.id)),bytes);
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs'),pdf=await getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;let text='';for(let n=1;n<=pdf.numPages;n++)text+=(await(await pdf.getPage(n)).getTextContent()).items.map(i=>i.str).join(' ');await pdf.cleanup();for(const value of ['First','Second','Store A','Store B','BL-A','BL-B','C1','C2'])assert(text.includes(value),value);
});
test('monthly report counts one completed parent on last child date and distinct physical containers with primary size',async()=>{
 const trips=require('../src/services/driverTrips'),f=fixture();const work=ops.normalizeWork(multi(f),f.parent,f.work);work.status='VERIFIED';work.receivedDate='2026-01-02';f.parent.data.driverOperations.works=[work];f.tx.shippingJourney.findMany=async()=>[f.parent];const feb=await trips.list(f.tx,{month:'2026-02'});assert.equal(feb.total,1);assert.equal(feb.data[0].receivedDate,'2026-02-03');assert.equal(feb.physicalContainerCount,2);assert.equal(feb.summary[0].rit20,1);assert.equal(feb.data[0].size,'20');assert.equal((await trips.list(f.tx,{month:'2026-01'})).total,0);
});
test('primary anchor and child containers cannot change after reservation and legacy hidden values survive edits',async()=>{
 const f=fixture();await ops.saveWork(f.tx,user,'j','work-a',{version:1,work:multi(f)});await ops.transition(f.tx,user,'j','work-a',{version:2,status:'SUBMITTED'});const writes=f.writes.length;await assert.rejects(ops.assertBillChange(f.tx,f.b,[{number:'C2',size:'40'}]),e=>e.status===409);assert.equal(f.writes.length,writes);
 const g=fixture();g.work.instructions='Legacy instruction';const input={...g.work};delete input.origin;delete input.receiptReference;delete input.instructions;const saved=await ops.saveWork(g.tx,user,'j','work-a',{version:1,work:input});assert.equal(saved.origin,'Port');assert.equal(saved.receiptReference,'REC1');assert.equal(saved.instructions,'Legacy instruction');
});
test('sibling can publish revised shared dispatch without changing primary and cannot read foreign proof IDs',async()=>{
 const dispatch=require('../src/services/driverDispatch'),f=fixture();f.tx.company={findUnique:async({where})=>({id:where.id,name:'SCMU',isInternal:true,isActive:true})};await ops.saveWork(f.tx,user,'j','work-a',{version:1,work:multi(f)});const body={version:2,taskDate:'2026-02-01',documentType:'DELIVERY_NOTE',confirmed:true};const saved=await dispatch.issueBill(f.tx,user,'b','work-a',body);assert.equal(saved.billId,'a');assert.equal(f.parent.data.driverOperations.works.find(w=>w.id==='work-a').billId,'a');const history=await dispatch.listBill(f.tx,'b','work-a');assert(!JSON.stringify(history).includes('"own"'));assert.deepEqual(history.data[0].evidenceFileIds,['foreign']);
});
test('multi-delivery wage estimation creates one RIT line from primary size and last receipt',async()=>{
 const f=fixture(),work=multi(f);Object.assign(work,{driverId:'d',driverEmploymentType:'INTERNAL'});const saved=ops.normalizeWork(work,f.parent,f.work);saved.status='VERIFIED';f.parent.data.driverOperations.works=[saved];f.tx.jptTariff={findMany:async()=>[{id:'tariff',version:1,code:'R',rateType:'RB',unit:'RIT',unitPrice:'100',size:'20',enabled:true,effectiveFrom:new Date('2025-01-01')}]};const estimate=await ops.wageEstimate(f.tx,'j',{version:1,periodFrom:'2026-02-01',periodTo:'2026-02-28',workIds:['work-a']});assert.equal(estimate.lines.length,1);assert.equal(estimate.lines[0].quantity,1);assert.equal(estimate.amount,'100.00');assert.equal(estimate.lines[0].receivedDate,'2026-02-03');
});
test('aggregate shared filename exposes each B/L proof alias for child selection',async()=>{
 const f=fixture();f.parent.data.driverOperations.recaps=[];f.b.files[0].filename=f.a.files[0].filename;const result=await ops.list(f.tx,'j');for(const [bill,id]of [['a','own'],['b','foreign']])assert(result.files.some(file=>file.evidenceId===id&&file.billIds.includes(bill)&&file.endpoint===`/bl-register/${bill}/files/${id}`));
});
test('payload with only child cargo saves without requiring redundant parent items or parent proof',async()=>{
 const f=fixture(),work=multi(f);delete work.items;delete work.evidenceFileIds;await ops.saveWork(f.tx,user,'j','work-a',{version:1,work});assert.equal(f.parent.data.driverOperations.works.find(w=>w.id==='work-a').items.length,2);
});
test('child evidence edits do not revalidate removed redundant parent evidence and large child unions remain valid',async()=>{
 const f=fixture();await ops.saveWork(f.tx,user,'j','work-a',{version:1,work:multi(f)});f.a.files=[];const work=multi(f);work.deliveries[0].evidenceFileIds=[];delete work.evidenceFileIds;const saved=await ops.saveWork(f.tx,user,'j','work-a',{version:2,work});assert.equal(saved.receivedDate,null);
 const g=fixture(),input=multi(g);input.deliveries[0].evidenceFileIds=Array.from({length:30},(_,i)=>'a'+i);input.deliveries[1].evidenceFileIds=Array.from({length:30},(_,i)=>'b'+i);g.a.files=input.deliveries[0].evidenceFileIds.map(id=>({id,filename:id,category:'POD'}));g.b.files=input.deliveries[1].evidenceFileIds.map(id=>({id,filename:id,category:'POD'}));delete input.evidenceFileIds;await ops.saveWork(g.tx,user,'j','work-a',{version:1,work:input});await ops.transition(g.tx,user,'j','work-a',{version:2,status:'SUBMITTED'});assert.equal(g.parent.data.driverOperations.works.find(w=>w.id==='work-a').evidenceFileIds.length,60);
});
test('receipt readiness rejects future legacy receipt and active primary identity conflicts',async()=>{
 const f=fixture();f.work.receivedDate='2999-01-01';await assert.rejects(ops.transition(f.tx,user,'j','work-a',{version:1,status:'SUBMITTED'}));assert.equal(f.writes.length,0);
 const g=fixture(),input=multi(g);g.b.containers.push({number:'C1',size:'40'});await assert.rejects(ops.saveWork(g.tx,user,'j','work-a',{version:1,work:input}));assert.equal(g.writes.length,0);
});
test('unchanged goods snapshots survive item reorder and parent master fields retain optional weight',async()=>{
 const f=fixture();f.tx.goodsType={findUnique:async({where})=>({id:where.id,name:where.id==='g'?'Cement':'Rice',isActive:true})};const input=multi(f);input.deliveries[0].items=[{...item,goodsTypeId:'g'},{...item,goodsTypeId:'h'}];const saved=await ops.saveWork(f.tx,user,'j','work-a',{version:1,work:input});f.tx.goodsType.findUnique=async()=>{throw Error('Do not refresh historical cargo');};saved.deliveries[0].items.reverse();const again=await ops.saveWork(f.tx,user,'j','work-a',{version:2,work:saved});assert.deepEqual(again.deliveries[0].items.map(i=>i.goodsType),['Rice','Cement']);
});
module.exports={multi,item,user};

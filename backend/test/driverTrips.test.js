const test=require('node:test'),assert=require('node:assert/strict');
const service=(()=>{try{return require('../src/services/driverTrips');}catch(e){if(e.code==='MODULE_NOT_FOUND')return {};throw e;}})();
function fixture(){
 const w={id:'w1',billId:'a',number:'BON1',containerNumber:'C1',containerKey:'C1',driverId:'d1',driverName:'Same Name',driverEmploymentType:'INTERNAL',vehicleNumber:'PA1',size:'20',rateType:'RB',receivedDate:'2026-10-02',status:'VERIFIED'};
 const a={id:'a',registerData:{},containers:[{number:'C1',size:'20'}]};
 const j={id:'j1',number:'J1',bills:[a],data:{driverOperations:{works:[w,{...w,id:'w2',rateType:'RK',payrollId:'p1'},{...w,id:'draft',status:'DRAFT'},{...w,id:'cancel',status:'CANCELLED'},{...w,id:'last-month',receivedDate:'2026-09-30'}]}}};
 const j2={id:'j2',number:'J2',archivedAt:new Date(),bills:[{...a,id:'b'}],data:{driverOperations:{works:[{...w,id:'w3',billId:'b',size:'40'},{...w,id:'different-driver',billId:'b',driverId:'d2',driverEmploymentType:'VENDOR',size:'40'},{...w,id:'old1',billId:'b',driverId:null},{...w,id:'old2',billId:'b',driverId:null},{...w,id:'odd-size',billId:'b',size:'21'}]}}};
 const trashed={...structuredClone(j),id:'trash',deletedAt:new Date()},trashedBill={...structuredClone(j),id:'bill-trash'};trashedBill.bills[0].registerData.trash={deletedAt:'2026-10-01'};
 const rows=[j,j2,trashed,trashedBill],tx={shippingJourney:{findMany:async()=>rows}};return {tx,rows};
}
test('monthly ritase aggregates across journeys by ID, includes archive history, not drafts/trash and keeps sizes and legacy identities separate',async()=>{
 assert.equal(typeof service.list,'function');const f=fixture(),result=await service.list(f.tx,{month:'2026-10'});
 assert.equal(result.period,'2026-10');assert.equal(result.total,7);assert.equal(result.data.length,7);
 const internal=result.summary.find(s=>s.driverId==='d1');assert.deepEqual([internal.rit20,internal.rit40,internal.ritOther,internal.rb,internal.rk,internal.total,internal.payrollLinked,internal.payrollPending],[2,1,1,3,1,4,1,3]);
 assert.equal(result.summary.filter(s=>s.driverId==='d2').length,1);assert.equal(result.summary.filter(s=>!s.driverId).length,2);assert(result.warnings.some(w=>w.code==='UNMAPPED_DRIVER'));assert(result.warnings.some(w=>w.code==='NON_STANDARD_SIZE'));
 assert.equal(result.countingUnit,'VERIFIED_WORK');assert.equal(result.physicalContainerCount,2);
 const paged=await service.list(f.tx,{month:'2026-10',driverId:'d1',limit:'1',page:'2'});assert.equal(paged.total,4);assert.equal(paged.data.length,1);assert.equal(paged.summary[0].total,4);
 const vendor=await service.list(f.tx,{month:'2026-10',ownership:'VENDOR',size:'40'});assert.equal(vendor.total,1);assert.equal(vendor.data[0].driverId,'d2');
 const unknown=await service.list(f.tx,{month:'2026-10',ownership:'UNKNOWN'});assert.equal(unknown.total,2);
});
test('monthly report rejects invalid dates, unsupported statuses and size reinterpretations',async()=>{
 assert.equal(typeof service.list,'function');for(const query of [{month:'2026-13'},{month:'2026-1'},{month:'2026-10',status:'DRAFT'},{month:'2026-10',size:'21'},{month:'2026-10',ownership:'OWN'}])await assert.rejects(service.list(fixture().tx,query),e=>e.status===422);
});
test('vehicle ID filter is exact and never matches another plate alias',async()=>{
 const f=fixture();f.rows[0].data.driverOperations.works[0].vehicleId='v1';
 const result=await service.list(f.tx,{month:'2026-10',vehicleId:'v1'});assert.equal(result.total,1);assert.equal(result.data[0].workId,'w1');
 assert.equal((await service.list(f.tx,{month:'2026-10',vehicleId:'missing'})).total,0);
});
test('payroll linking is not payment and charge balances remain read-only recap-scoped values',async()=>{
 const f=fixture(),j=f.rows[0],base=j.data.driverOperations.works[0];f.rows.splice(1);
 const statuses=['PROPOSED','APPROVED','PART_PAID','PAID','REJECTED','MISSING','VOID'];
 j.data.driverOperations.works=[base,...statuses.map((status,i)=>({...base,id:'pay-'+i,payrollId:'p-'+i})),{...base,id:'same-recap',payrollId:'p-3'}];
 j.data.driverOperations.recaps=statuses.map((status,i)=>({id:'p-'+i,chargeId:'c-'+i,amount:'100.00',...(status==='VOID'?{voidedAt:'2026-10-03'}:{})}));
 const charges=statuses.flatMap((status,i)=>status==='MISSING'?[]:[{id:'c-'+i,status:['PART_PAID','PAID'].includes(status)?'APPROVED':status,actualAmount:'100.00',payments:status==='PAID'?[{amount:'60.00'},{amount:'40.00'}]:status==='PART_PAID'?[{amount:'35.00'}]:[]}]);
 let reads=0;f.tx.jobCharge={findMany:async({where,include})=>{reads++;assert(include.payments);return charges.filter(c=>where.id.in.includes(c.id));}};
 const before=JSON.stringify(f.rows),result=await service.list(f.tx,{month:'2026-10'});assert.equal(reads,1);assert.equal(JSON.stringify(f.rows),before);
 const unlinked=result.data.find(r=>r.workId==='w1');assert.equal(unlinked.payrollStatus,'NOT_LINKED');assert.equal(unlinked.paidAmount,null);assert.equal(unlinked.outstanding,null);
 statuses.forEach((status,i)=>{const row=result.data.find(r=>r.workId==='pay-'+i);assert.equal(row.payrollStatus,status);assert.equal(row.payrollAmountScope,'RECAP');if(status==='MISSING'){assert.equal(row.paidAmount,null);assert.equal(row.outstanding,null);}else{assert.equal(row.paidAmount,status==='PAID'?'100.00':status==='PART_PAID'?'35.00':'0.00');assert.equal(row.outstanding,status==='PAID'?'0.00':status==='PART_PAID'?'65.00':'100.00');}});
 assert.equal(result.data.find(r=>r.workId==='same-recap').paidAmount,'100.00');assert.equal(result.total,9);assert.equal(result.summary[0].payrollLinked,8);
 const paid=await service.list(f.tx,{month:'2026-10',payrollStatus:'PAID'});assert.equal(paid.total,2);assert(paid.data.every(row=>row.payrollStatus==='PAID'));assert.equal(paid.summary[0].total,2);
 const unpaid=await service.list(f.tx,{month:'2026-10',payrollStatus:'UNPAID'});assert.equal(unpaid.total,2);assert.deepEqual(unpaid.data.map(r=>r.payrollStatus),['APPROVED','PART_PAID']);
 for(const status of ['MISSING','NOT_LINKED','PROPOSED','REJECTED','VOID'])assert.equal((await service.list(f.tx,{month:'2026-10',payrollStatus:status})).total,1);
 await assert.rejects(service.list(f.tx,{month:'2026-10',payrollStatus:'BOGUS'}),e=>e.status===422);
});
test('monthly report retains TONASE and RBS separately without inflating RB/RK counts or merging manual identities',async()=>{
 const f=fixture(),base=f.rows[0].data.driverOperations.works[0];f.rows.splice(1);f.rows[0].data.driverOperations.works=['RB','RK','TONASE','RBS'].map(rateType=>({...base,id:rateType,rateType}));f.rows[0].data.driverOperations.works.push(...['manual-one','manual-two'].map(id=>({...base,id,rateType:'TONASE',driverId:null,driverEmploymentType:'INTERNAL'})));const result=await service.list(f.tx,{month:'2026-10'}),group=result.summary.find(s=>s.driverId==='d1');assert.deepEqual([group.rb,group.rk,group.tonase,group.rbs,group.total],[1,1,1,1,4]);assert.equal(result.summary.filter(s=>!s.driverId).length,2);assert(result.summary.filter(s=>!s.driverId).every(s=>s.employmentType==='UNKNOWN'));assert.deepEqual(result.data.filter(d=>d.driverId).map(d=>d.rateType).sort(),['RB','RBS','RK','TONASE']);
});
module.exports={fixture};

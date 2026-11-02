const test=require('node:test'),assert=require('node:assert/strict'),rates=require('../src/services/driverTariffs'),master=require('../src/services/jptTariffs');
const bill={containers:[{number:'A',size:'20'},{number:'B',size:'20'},{number:'C',size:'40'},{number:'U',size:null}]};
const bon={ratePlan:'plan',bonDate:'2026-11-02',origin:'Pelabuhan Merauke',destination:'Gudang A',vehicleNumber:'PA 1234',containerNumbers:['A'],rbCount:2,rkCount:2,tripCount:4};
const rate=(id,type,price,patch={})=>({id,version:1,code:id,description:id,category:'DRIVER_BON',rateType:type,unit:'RIT',unitPrice:price,enabled:true,confirmationRequired:false,size:'20',effectiveFrom:new Date('2026-11-01'),effectiveTo:new Date('2026-11-30'),...patch});
function fixture(){const rows=[rate('rb','RB','100000.25'),rate('rk','RK','50000.10')],scheme={id:'plan',name:'20 campuran',code:'MIX',version:1,enabled:true,size:'20',rb:2,rk:2};return {rows,scheme,tx:{jptTariff:{findMany:async()=>rows},driverRateScheme:{findUnique:async()=>scheme}}};}
test('actual RB/RK and local route, exact decimal amount, end-date inclusive, never sea-route defaults',async()=>{
 const {tx,rows}=fixture();rows[0].routeOrigin='PELABUHAN MERAUKE';rows[0].routeDestination='Gudang A';const result=await rates.estimate(tx,bon,bill);
 assert.equal(result.amount,'300000.70');assert.equal(result.lines[0].quantity,2);assert.equal(result.scheme.rb,2);
 assert.equal((await rates.estimate(tx,{...bon,bonDate:'2026-11-30'},bill)).amount,result.amount);
 await assert.rejects(rates.estimate(tx,{...bon,bonDate:'2026-12-01'},bill),e=>e.status===409);await assert.rejects(rates.estimate(tx,{...bon,origin:'Surabaya'},bill),e=>e.status===409);
});
test('specific vehicle/route overrides generic price, ambiguous equal scopes and unconfirmed rates never silently win',async()=>{
 const {tx,rows}=fixture();rows.push(rate('specific','RB','200000',{routeOrigin:bon.origin,vehicleNumber:bon.vehicleNumber}));assert.equal((await rates.estimate(tx,bon,bill)).lines[0].tariffId,'specific');
 rows.push({...rows[2],id:'duplicate'});await assert.rejects(rates.estimate(tx,bon,bill),e=>e.status===409);rows.pop();rows[2].confirmationRequired=true;assert.equal((await rates.estimate(tx,bon,bill)).lines[0].tariffId,'rb');
});
test('plan quantities are suggestions; actual total is not multiplied by containers, packages charge containers once',async()=>{
 const {tx,rows}=fixture();const result=await rates.estimate(tx,{...bon,containerNumbers:['A','B'],rbCount:3,rkCount:1},bill);assert.equal(result.lines[0].quantity,3);assert.equal(result.amount,'350000.85');
 rows[0].unit='CONTAINER';assert.equal((await rates.estimate(tx,{...bon,containerNumbers:['A','B'],rbCount:6,rkCount:0},bill)).amount,'200000.50');await assert.rejects(rates.estimate(tx,bon,bill));
});
test('foreign, mixed-size, unknown-size, duplicate containers, invalid dates, empty or fractional trips reject',async()=>{
 const {tx}=fixture();for(const patch of [{containerNumbers:['OTHER']},{containerNumbers:['A','C']},{containerNumbers:['U']},{containerNumbers:['A','A']},{bonDate:'2026-02-30'},{rbCount:0,rkCount:0},{rbCount:0.5},{containerNumbers:undefined}])await assert.rejects(rates.estimate(tx,{...bon,...patch},bill));
});
test('snapshot survives master changes; refresh requires matching preview and completed vouchers cannot reprice or change plan',async()=>{
 const {tx,rows}=fixture(),snapshot=await rates.estimate(tx,bon,bill),body={tariffConfirmed:true,tariffFingerprint:snapshot.fingerprint},first=await rates.apply(tx,{...bon},bill,null,body);assert.equal(first.amount,'300000.70');const before={...first,rateSnapshot:{...first.rateSnapshot,input:Object.fromEntries(Object.entries(first.rateSnapshot.input).reverse())},status:'COMPLETED'};
 rows[0].unitPrice='999999';rows[0].enabled=false;const saved=await rates.apply(tx,{...bon,amount:'1'},bill,before,{});assert.equal(saved.amount,'300000.70');assert.equal(saved.rateSnapshot,before.rateSnapshot);
 await assert.rejects(rates.apply(tx,{...bon},bill,before,{refreshTariff:true}));await assert.rejects(rates.apply(tx,{...bon,rbCount:3},bill,before,{}));await assert.rejects(rates.apply(tx,{...bon,ratePlan:null},bill,before,{}));
 rows[0].enabled=true;await assert.rejects(rates.apply(tx,{...bon},bill,null,body),e=>e.status===409);await assert.rejects(rates.apply(tx,{...bon},bill,{...first,status:'DRAFT'},{...body,refreshTariff:true}),e=>e.status===409);
});
test('director-only master rejects overlap, stale edit, nonpositive amount and preserves legacy tariffs',async()=>{
 const row={...rate('new','RB','100'),currency:'IDR',vatIncluded:false,vatRate:null,carrierName:null,notes:null};let writes=0;const tx={jptTariff:{findMany:async()=>[rate('existing','RB','100')],findUnique:async()=>row,create:async({data})=>{writes++;return {id:'saved',...data};}},activityLog:{create:async()=>({})}},director={id:'d',role:'SUPER_ADMIN'};
 await assert.rejects(master.save(tx,{role:'ADMIN'},null,row),e=>e.status===403);await assert.rejects(master.save(tx,director,null,row),e=>e.status===409);await assert.rejects(master.save(tx,director,'new',{...row,version:99}),e=>e.status===409);
 await assert.rejects(master.save(tx,director,null,{...row,unitPrice:'0'}));await master.save(tx,director,null,{...row,enabled:false});assert.equal(writes,1);
});
test('schemes are dynamic with optimistic versioning, positive total and director authority',async()=>{
 const body={code:'CUSTOM-20',name:'Skema 20',size:'20',rb:2,rk:1,enabled:true},tx={driverRateScheme:{create:async({data})=>({id:'custom',...data}),findUnique:async()=>({...body,version:2})},activityLog:{create:async()=>({})}};
 assert.equal((await rates.saveScheme(tx,{role:'SUPER_ADMIN'},null,body)).rb,2);await assert.rejects(rates.saveScheme(tx,{role:'ADMIN'},null,body),e=>e.status===403);await assert.rejects(rates.saveScheme(tx,{role:'SUPER_ADMIN'},'custom',{...body,version:1}),e=>e.status===409);await assert.rejects(rates.saveScheme(tx,{role:'SUPER_ADMIN'},null,{...body,rb:0,rk:0}));
});

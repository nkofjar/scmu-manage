const test=require('node:test'); const assert=require('node:assert/strict');
const tariffs=require('../src/services/jptTariffs');
test('unsafe selections reject unknown, disabled, unconfirmed, expired, wrong carrier and zero size matches',()=>{
 const bill={carrierName:'Tanto',containers:[{number:'A',size:'21'},{number:'B'}]};
 for(const [rows,ids,pattern] of [ [[tariff],['missing'],/Unknown/], [[{...tariff,enabled:false}],['door20'],/disabled/], [[{...tariff,confirmationRequired:true}],['door20'],/confirmation/], [[{...tariff,effectiveTo:'2020-01-01'}],['door20'],/effective/], [[{...tariff,carrierName:'SPIL'}],['door20'],/carrier/], [[tariff],['door20'],/matching/], [[tariff],['door20','door20'],/distinct/], [[tariff],[],/Select/] ]) assert.throws(()=>tariffs.estimate(bill,rows,ids),pattern);
});
test('tariff master permits administrator writes and validates rates before persisting',async()=>{
 const rows=[];const tx={jptTariff:{create:async({data})=>{rows.push(data);return {id:'new',...data}}},activityLog:{create:async x=>x}};
 const {id,...payload}=tariff;
 await assert.rejects(tariffs.save(tx,{id:'a',role:'OPERATOR'},null,payload),e=>e.status===403);
 for(const patch of [{unitPrice:'-1'},{unitPrice:'NaN'},{vatRate:'2'},{enabled:'yes'},{effectiveFrom:'2027-01-01',effectiveTo:'2020-01-01'},{size:'22'}]) await assert.rejects(tariffs.save(tx,{id:'d',role:'SUPER_ADMIN'},null,{...payload,...patch}));
 assert.equal(rows.length,0);
 const saved=await tariffs.save(tx,{id:'d',role:'SUPER_ADMIN'},null,payload); assert.equal(saved.unitPrice.toFixed(2),'3750000.00');assert.equal(saved.vatRate,'1.1');
});
test('partial tariff edit preserves a persisted Decimal rate without requiring the client to resend it',async()=>{
 let current={...tariff,version:1,unitPrice:require('../src/services/jpt').money(tariff.unitPrice)};
 const tx={jptTariff:{findUnique:async()=>current,updateMany:async({data})=>{current={...current,...data,version:2};return {count:1};}},activityLog:{create:async()=>({})}};
 const result=await tariffs.save(tx,{id:'d',role:'SUPER_ADMIN'},'rate',{enabled:false,version:1});assert.equal(result.unitPrice.toFixed(2),'3750000.00');assert.equal(result.enabled,false);
});
const tariff={id:'door20',code:'DOOR20',description:'Dooring 20',category:'DOORING',size:'20',carrierName:null,unit:'CONTAINER',unitPrice:'3750000',currency:'IDR',vatIncluded:true,vatRate:'1.1',enabled:true,confirmationRequired:false,effectiveFrom:null,effectiveTo:null};
test('explicit estimates match container size, charge BL once, keep included VAT and never infer costs or PPh',()=>{
 const result=tariffs.estimate({carrierName:'SPIL',containers:[{number:'A',size:'20'},{number:'B',size:'20'},{number:'C',size:'21'}]},[tariff,{...tariff,id:'do',size:null,carrierName:'SPIL',unit:'BL',unitPrice:'200000'}],['door20','do']);
 assert.deepEqual(result.lines.map(x=>[x.quantity,x.amount]),[[2,'7500000.00'],[1,'200000.00']]);
 assert.equal(result.total,'7700000.00');assert.equal(result.lines[0].vatIncluded,true);assert.equal(result.lines[0].vatRate,'1.1');assert.ok(result.warnings.some(x=>/PPh/.test(x)));
});

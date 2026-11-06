const test=require('node:test'),assert=require('node:assert/strict');
const {withCatalogApp}=require('./helpers/transportCatalogFixture');
const tariffs=require('../src/services/jptTariffs');
const base={code:'X',description:'Service',category:'OTHER',unit:'BL',unitPrice:'1',currency:'IDR',vatIncluded:false,enabled:true,confirmationRequired:false};
test('lost compare-and-swap cannot publish master or tariff audit',()=>withCatalogApp(async({prisma,rows,request})=>{
 rows.route.push({id:'r',version:1,isActive:true,name:'R',originCity:'A',originState:'A',destCity:'B',destState:'B'});
 rows.jptTariff.push({...base,id:'t',version:1});
 prisma.route.updateMany=async()=>({count:0});prisma.jptTariff.updateMany=async()=>({count:0});
 for(const url of ['/routes/r','/jpt-tariffs/t'])assert.equal((await request(url,{version:1},'PUT')).status,409);
 assert.equal(rows.activityLog.length,0);assert.equal(rows.route[0].version,1);assert.equal(rows.jptTariff[0].version,1);
}));
test('inactive master scopes cannot be selected or enabled, but existing inactive tariff can be retired',()=>withCatalogApp(async({rows,request})=>{
 rows.route.push({id:'r',isActive:false});rows.operatingCostType.push({id:'c',isActive:false});
 for(const patch of [{routeId:'r'},{operatingCostTypeId:'c'}])assert.equal((await request('/jpt-tariffs',{...base,...patch})).status,422);
 rows.jptTariff.push({...base,id:'t',version:1,routeId:'r',operatingCostTypeId:'c'});
 assert.equal((await request('/jpt-tariffs/t',{version:1,enabled:false},'PUT')).status,200);
 assert.equal((await request('/jpt-tariffs/t',{version:2,enabled:true},'PUT')).status,422);
}));
test('driver tariffs reject new master scopes that driver matching cannot enforce',async()=>{
 const tx={jptTariff:{create:async()=>({id:'x'}),findMany:async()=>[]},route:{findUnique:async()=>({isActive:true})},operatingCostType:{findUnique:async()=>({isActive:true})},activityLog:{create:async()=>({})}};
 const driver={...base,category:'DRIVER_BON',unit:'RIT',rateType:'RB',effectiveFrom:'2026-11-01'};
 for(const scope of [{routeId:'r'},{ownershipType:'VENDOR'},{operatingCostTypeId:'c'}])await assert.rejects(tariffs.save(tx,{role:'ADMIN'},null,{...driver,...scope}),e=>e.status===422);
});

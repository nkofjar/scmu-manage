const test = require('node:test'), assert = require('node:assert/strict');
const { withCatalogApp } = require('./helpers/transportCatalogFixture');
const service = require('../src/services/jptTariffs');
const base = { code:'SERVICE', description:'Biaya layanan', category:'OTHER', unit:'TON', unitPrice:'12.50', currency:'IDR', vatIncluded:false, enabled:true, confirmationRequired:false };
test('tariff HTTP admin edits optional master scopes and all supported units with CAS, no delete or mass assignment', () => withCatalogApp(async ({request,rows}) => {
 rows.route.push({id:'route',name:'Jalan',isActive:true,version:1}); rows.operatingCostType.push({id:'fuel',code:'FUEL',name:'BBM',defaultUnit:'TON',isActive:true,version:1});
 const body={...base,routeId:'route',operatingCostTypeId:'fuel',ownershipType:'OWN',effectiveFrom:'2026-11-01',effectiveTo:'2026-11-30'};
 assert.equal((await request('/jpt-tariffs',body,'POST','OPERATOR')).status,403);
 assert.equal((await request('/jpt-tariffs',{...body,job:{deleteMany:{}}})).status,422);
 for(const patch of [{routeId:'foreign'},{operatingCostTypeId:'foreign'},{ownershipType:'INVENTED'},{effectiveFrom:'2026-02-30'}]) assert.equal((await request('/jpt-tariffs',{...body,...patch})).status,422);
 const saved=await request('/jpt-tariffs',body); assert.equal(saved.status,201); assert.equal(saved.data.routeId,'route');
 assert.equal((await request('/jpt-tariffs',undefined,'GET','OPERATOR')).status,200);
 const snapshot=service.estimate({routeId:'route',ownershipType:'OWN',weightKg:2000},[{...saved.data,unit:'BL',effectiveFrom:null,effectiveTo:null}], [saved.data.id]);
 for(const unit of ['BL','CONTAINER','RIT','TON','DAY']) {
   const current=rows.jptTariff[0]; const response=await request(`/jpt-tariffs/${current.id}`,{version:current.version,unit},'PUT'); assert.equal(response.status,200);
 }
 const current=rows.jptTariff[0]; const oldVersion=current.version;
 assert.equal((await request(`/jpt-tariffs/${current.id}`,{version:oldVersion,unitPrice:'99',enabled:false},'PUT')).status,200);
 assert.equal((await request(`/jpt-tariffs/${current.id}`,{version:oldVersion,unitPrice:'100'},'PUT')).status,409);
 assert.equal((await request(`/jpt-tariffs/${current.id}`,{enabled:true},'PUT')).status,422);
 assert.equal(snapshot.lines[0].unitPrice,'12.50'); assert.equal(rows.jptTariff.length,1);
 assert.equal((await request(`/jpt-tariffs/${current.id}`,undefined,'DELETE')).status,404);
}));
test('BL estimates reject unsupported automatic quantities and mismatched optional scopes',()=>{
 const tariff={...base,id:'t',unit:'BL',routeId:'a',ownershipType:'OWN'};
 for(const bill of [{},{routeId:'b',ownershipType:'OWN'},{routeId:'a',ownershipType:'VENDOR'}]) assert.throws(()=>service.estimate(bill,[tariff],['t']));
 assert.throws(()=>service.estimate({},[{...base,id:'t'}],['t']));
});

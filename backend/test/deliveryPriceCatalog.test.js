const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../src/services/deliveryPriceCatalog');
const importer = require('../../scripts/import-delivery-price-catalog.cjs');
const route = {id:'wasur-existing',name:'  wasur ',destCity:'Wasur',originCity:'Known origin',originState:'Known region',destState:'Known destination region',distanceKm:12,estimatedDays:1,isActive:false,version:3};

test('planner reuses exact destination names, preserves geographic facts, imports safely and is idempotent', () => {
  const existing = {routes:[route],tariffs:[]};
  const plan = catalog.plan(existing);
  assert.deepEqual(plan.counts,{routesCreate:14,routesUpdate:1,routesUnchanged:0,tariffsCreate:23,tariffsUpdate:0,tariffsUnchanged:0});
  const wasur = plan.routes.find(r=>r.after.id===route.id);
  assert.deepEqual(wasur.after,{...route,isActive:true,version:4});
  assert.equal(plan.tariffs.find(t=>t.after.description==='WASUR').after.routeId,route.id);
  const created = plan.routes.filter(r=>r.action==='create');
  assert.ok(created.every(r=>r.after.originCity==='' && r.after.originState==='' && r.after.destState==='' && r.after.distanceKm===null && r.after.estimatedDays===null));
  const again = catalog.plan({routes:plan.routes.map(r=>r.after),tariffs:plan.tariffs.map(r=>r.after)});
  assert.deepEqual(again.counts,{routesCreate:0,routesUpdate:0,routesUnchanged:15,tariffsCreate:0,tariffsUpdate:0,tariffsUnchanged:23});
});

test('planner updates an unambiguous existing service tariff, never touches payroll, and fails ambiguous or dated matches', () => {
  const first = catalog.plan({routes:[],tariffs:[]});
  const current = first.tariffs.find(t=>t.after.description==='WASUR' && t.after.unit==='RIT').after;
  const legacy = {...current,id:'legacy-service',code:'OLD-WASUR',unitPrice:'900000',notes:'Office note',version:7};
  const payroll = {...current,id:'payroll',code:'PAYROLL',category:'DRIVER_BON',rateType:'RB'};
  const existing = {routes:first.routes.map(r=>r.after),tariffs:[legacy,payroll]};
  const plan = catalog.plan(existing), updated=plan.tariffs.find(t=>t.action==='update');
  assert.equal(updated.after.id,'legacy-service'); assert.equal(updated.after.code,'OLD-WASUR');
  assert.equal(updated.after.unitPrice,'1000000'); assert.equal(updated.after.version,8);
  assert.match(updated.after.notes,/Office note/); assert.ok(!plan.tariffs.some(t=>t.after.id==='payroll'));
  assert.throws(()=>catalog.plan({...existing,tariffs:[legacy,{...legacy,id:'duplicate',code:'DUP'}]}),/ambiguous/i);
  assert.throws(()=>catalog.plan({...existing,tariffs:[{...legacy,effectiveFrom:'2025-01-01'}]}),/dated|effective/i);
  assert.throws(()=>catalog.plan({...existing,routes:[route,{...route,id:'duplicate-route'}]}),/ambiguous/i);
  assert.throws(()=>catalog.plan({...existing,tariffs:[{...current,category:'DRIVER_BON'}]}),/collision|scope/i);
  assert.throws(()=>catalog.plan({...existing,tariffs:[{...legacy,vatIncluded:true,vatRate:'1.1'}]}),/tax/i);
  assert.throws(()=>catalog.plan({...existing,tariffs:[{...legacy,notes:'x'.repeat(3000)}]}),/notes/i);
});

test('importer requires explicit target and apply confirmation; no implicit environment or live DB fallback', () => {
  assert.throws(()=>importer.parseArgs([]),/database-url/);
  assert.throws(()=>importer.parseArgs(['--database-url','postgresql://postgres@127.0.0.1:55432/scmu_demo','--apply']),/confirm|backup/i);
  const dry = importer.parseArgs(['--database-url','postgresql://postgres@127.0.0.1:55432/scmu_demo']);
  assert.equal(dry.apply,false); assert.equal(dry.target,'127.0.0.1:55432/scmu_demo/public');
  assert.throws(()=>importer.parseArgs(['--database-url','postgresql://postgres@127.0.0.1:5432/live','--apply','--confirm-target','127.0.0.1:5432/live/public','--backup','C:/backup.json']),/non-demo/i);
  assert.throws(()=>importer.parseArgs(['--database-url','postgresql://postgres@127.0.0.1:55432/scmu_demo','--wat']),/unknown/i);
});



test('explicit Prisma client creation never opens an environment file', async () => {
  const fs=require('node:fs'), original=fs.readFileSync;
  let client;
  try {
    fs.readFileSync=function(filename,...args) {
      assert.ok(!/(^|[\\/])\.env(?:\.|$)/i.test(String(filename)), 'Do not read environment files: '+filename);
      return original.call(this,filename,...args);
    };
    client=importer.createClient('postgresql://scmu_demo@127.0.0.1:55432/scmu_demo');
    assert.ok(client.route && client.jptTariff);
  } finally { fs.readFileSync=original; if(client) await client.$disconnect(); }
});

test('verified HARGA BARU source yields exact service prices, never payroll or guessed rows', () => {
  const expected = [
    ['TRUCKING SCMU DALAM KOTA',225000,35000], ['TRUCKING LUAR DALAM KOTA',185000,30000],
    ['BURUH / RET',200000,30000], ['WASUR',1000000,100000], ['SOTA',1500000,150000],
    ['BUPUL',2000000], ['BVD, TANAH MERAH',5500000], ['MUTING ALFASERA',2500000],
    ['KUPRIK (BATAS LAMPU MERAH)',250000], ['SIDOMULYO',300000], ['SEMANGGA 1',300000],
    ['SEMANGGA 2, JAYA + 40',450000], ['SEMANGGA 3, MURAMSARI',700000],
    ['TAMIR SP 1,2,3,4,5',700000], ['TAMIR SP 6,7,8,9, KECO',800000],
    ['SALOR',1200000], ['KURIK CANDRA',1500000], ['KURIK 4, RAWASARI',1700000],
  ];
  assert.equal(catalog.SOURCE_ROWS.length,18);
  const prices = catalog.tariffs();
  assert.equal(prices.length,23);
  assert.equal(new Set(prices.map(r=>r.code)).size,23);
  for (const [name,rb,ton] of expected) {
    for (const [suffix,price,unit] of [['RB',rb,'RIT'],['TON',ton,'TON']]) {
      const row = prices.find(r=>r.description===name && r.code.endsWith('-'+suffix));
      if (price===undefined) { assert.equal(row,undefined); continue; }
      assert.equal(row.unitPrice,String(price)); assert.equal(row.unit,unit);
      assert.equal(row.category,name==='BURUH / RET'?'LABOR':'TRUCKING');
      assert.equal(row.rateType,null); assert.equal(row.effectiveFrom,null); assert.equal(row.effectiveTo,null);
      assert.equal(row.enabled,true); assert.equal(row.confirmationRequired,false);
      assert.match(row.notes,/HARGA BARU/); assert.match(row.notes,/photo/); assert.match(row.notes,/effective date/i);
    }
  }
  assert.equal(catalog.destinations().length,15);
  assert.ok(prices.every(r=>r.category!=='DRIVER_BON' && r.ownershipType===null && r.size===null));
  for(const unknown of ['MUTING ULILIN','ASIKI','MINDIPTANA','WAROPKO','KUMBE']) assert.ok(!prices.some(r=>r.description===unknown));
});

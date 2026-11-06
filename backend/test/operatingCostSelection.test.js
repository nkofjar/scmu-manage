const test = require('node:test');
const assert = require('node:assert/strict');
const transport = require('../src/services/transport');

test('explicit operating cost selection snapshots authoritative active master fields', async () => {
  const master = {id:'type-1',code:'FORKLIFT',name:'Forklift',defaultUnit:'JAM',isActive:true};
  const tx = {operatingCostType:{findUnique:async ({where}) => {
    assert.equal(where.id, 'type-1');
    return master;
  }}};
  const snapshot = await transport.operatingCostTypeSnapshot(tx, {
    operatingCostTypeId:'type-1', operatingCostType:{name:'Client forgery'}, costCategory:'DRIVER_ALLOWANCE',
  });
  assert.deepEqual(snapshot, {id:'type-1',code:'FORKLIFT',name:'Forklift',defaultUnit:'JAM'});
  master.name = 'Renamed'; master.isActive = false;
  assert.equal(snapshot.name, 'Forklift');
});

test('absent selection stays optional without reading a master', async () => {
  for (const operatingCostTypeId of [undefined,null,'']) {
    assert.equal(await transport.operatingCostTypeSnapshot({}, {operatingCostTypeId}),null);
  }
});

test('new selections reject missing, inactive and malformed masters', async () => {
  for (const master of [null,{id:'inactive',isActive:false}]) {
    await assert.rejects(transport.operatingCostTypeSnapshot({operatingCostType:{findUnique:async()=>master}}, {operatingCostTypeId:'inactive'}),e=>e.status===422);
  }
  for (const operatingCostTypeId of [false,0,{},[], ' ', 'a'.repeat(101)]) {
    await assert.rejects(transport.operatingCostTypeSnapshot({}, {operatingCostTypeId}),e=>e.status===422);
  }
});

test('shared voyage expense validates and snapshots the selected operating master before writes', async t => {
  const journeys=require('../src/services/journeys'),director=require('../src/services/director');
  const row={id:'journey',number:'J1',version:3,sharedJobId:'shared',data:{},bills:[],files:[]},writes=[];
  const master={id:'type-1',code:'FORKLIFT',name:'Forklift',defaultUnit:'DAY',isActive:true};
  const tx={shippingJourney:{findUnique:async()=>row,update:async()=>{}},operatingCostType:{findUnique:async()=>master},jobCharge:{create:async({data})=>{writes.push(data);return {id:'charge',...data};}},activityLog:{create:async()=>{}}};
  t.mock.method(director,'submit',async()=>({id:'approval'}));
  const body={version:3,description:'Shared forklift',quantity:'2',unit:'DAY',unitPrice:'100',costSource:'INTERNAL',costCategory:'OTHER',operatingCostTypeId:master.id};
  const saved=await journeys.createCost(tx,{id:'staff',role:'ADMIN'},row.id,body);
  assert.deepEqual(saved.charge.tariffSnapshot.operatingCostType,{id:'type-1',code:'FORKLIFT',name:'Forklift',defaultUnit:'DAY'});
  master.isActive=false;
  await assert.rejects(journeys.createCost(tx,{id:'staff',role:'ADMIN'},row.id,body),e=>e.status===422);
  assert.equal(writes.length,1);
});

test('B/L expense saves selected master in the immutable charge snapshot, not financial category', async t => {
  const workspace = require('../src/services/blWorkspace');
  const register = require('../src/services/blRegister');
  const sea = require('../src/services/seaBills');
  const director = require('../src/services/director');
  const bill = {id:'bill',jobId:'job',version:3,files:[]};
  const master = {id:'type-1',code:'FORKLIFT',name:'Forklift',defaultUnit:'JAM',isActive:true};
  const writes = [];
  const tx = {
    operatingCostType:{findUnique:async()=>master},
    jobCharge:{create:async ({data})=>{writes.push(data);return {id:'cost',...data};},findMany:async()=>writes},
    seaBill:{update:async()=>{}},activityLog:{create:async()=>{}},
  };
  t.mock.method(register,'get',async()=>bill);
  t.mock.method(sea,'getBill',async()=>bill);
  t.mock.method(director,'submit',async()=>({id:'approval'}));
  const saved = await workspace.createCost(tx,{id:'staff'},bill.id,{
    version:3,description:'Agreed forklift work',quantity:'2',unit:'SHIFT',unitPrice:'150',
    operatingCostTypeId:master.id,operatingCostType:{name:'Forged'},
    costSource:'INTERNAL',costCategory:'DRIVER_ALLOWANCE',
  });
  assert.deepEqual(saved.charge.tariffSnapshot.operatingCostType,{id:'type-1',code:'FORKLIFT',name:'Forklift',defaultUnit:'JAM'});
  assert.equal(saved.charge.costCategory,'DRIVER_ALLOWANCE');
  assert.equal(saved.charge.tariffSnapshot.line.unit,'SHIFT');
  assert.equal(saved.charge.description,'Agreed forklift work');
  assert.equal(saved.charge.estimatedAmount,'300.00');
  assert.equal(writes[0].operatingCostTypeId,undefined,'selection belongs in JSON, not an unsupported charge column');
  master.name='Renamed';master.defaultUnit='JOB';master.isActive=false;
  const loaded=await workspace.get(tx,bill.id);
  assert.equal(loaded.costs[0].tariffSnapshot.operatingCostType.name,'Forklift');
  assert.equal(loaded.costs[0].tariffSnapshot.operatingCostType.defaultUnit,'JAM');
  assert.equal(writes.length,1,'reading a master or charge must never generate expenses');
  await assert.rejects(workspace.createCost(tx,{id:'staff'},bill.id,{
    version:3,description:'Cannot reuse inactive master',quantity:'1',unitPrice:'100',
    costSource:'INTERNAL',operatingCostTypeId:master.id,
  }),e=>e.status===422);
  assert.equal(writes.length,1,'new inactive selection is rejected before a charge write');
  await assert.rejects(workspace.createCost(tx,{id:'staff'},bill.id,{
    version:3,description:'Invalid financial category',quantity:'1',unitPrice:'100',
    costSource:'INTERNAL',costCategory:'FORKLIFT',
  }),e=>e.status===422);
  assert.equal(writes.length,1,'operating master codes never replace financial enum values');
});

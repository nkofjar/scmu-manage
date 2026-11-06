const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const importer=require('../../scripts/import-delivery-price-catalog.cjs');

// Opt-in only; creates and removes its OWN schema, never writes public/live catalog rows.
const url=process.env.DELIVERY_PRICE_CATALOG_TEST_URL;
test('real isolated PostgreSQL schema: backup, atomic apply, readback, idempotency and rollback', {skip:!url}, async()=>{
  const options=importer.parseArgs(['--database-url',url]);
  assert.equal(options.demo,true,'Integration is restricted to local port55432/scmu_demo');
  const schema='delivery_catalog_test_'+randomUUID().replaceAll('-','');
  const base=importer.createClient(url);
  const scoped=new URL(url); scoped.searchParams.set('schema',schema);
  const client=importer.createClient(scoped.toString());
  const scratch=process.env.TMPDIR;
  assert.ok(scratch,'Use the configured Hermes scratch directory, never system temp');
  const directory=fs.mkdtempSync(path.join(scratch,'delivery-catalog-'));
  const backup=path.join(directory,'before.json');
  let publicBefore;
  try {
    publicBefore={routes:await base.route.count(),tariffs:await base.jptTariff.count()};
    await base.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await base.$executeRawUnsafe(`CREATE TABLE "${schema}"."routes" (LIKE public.routes INCLUDING ALL)`);
    await base.$executeRawUnsafe(`CREATE TABLE "${schema}"."jpt_tariffs" (LIKE public.jpt_tariffs INCLUDING ALL)`);
    await base.$executeRawUnsafe(`ALTER TABLE "${schema}"."jpt_tariffs" ADD FOREIGN KEY ("routeId") REFERENCES "${schema}"."routes"(id)`);
    const opts=importer.parseArgs(['--database-url',scoped.toString()]);
    const dry=await importer.run(client,opts);
    assert.equal(dry.mode,'dry-run'); assert.equal(await client.route.count(),0); assert.equal(await client.jptTariff.count(),0);
    const applied=await importer.run(client,{...opts,apply:true,backup});
    assert.equal(applied.mode,'applied'); assert.equal(await client.route.count(),15); assert.equal(await client.jptTariff.count(),23);
    const saved=JSON.parse(fs.readFileSync(backup,'utf8'));
    assert.equal(saved.before.routes.length,0); assert.equal(saved.before.tariffs.length,0);
    assert.equal(JSON.stringify(saved).includes('postgresql://'),false);
    assert.match(applied.backup.sha256,/^[a-f0-9]{64}$/);
    assert.equal((await client.jptTariff.findMany({where:{category:'DRIVER_BON'}})).length,0);
    const wasur=await client.jptTariff.findFirst({where:{description:'WASUR',unit:'RIT'}});
    await client.jptTariff.update({where:{id:wasur.id},data:{code:'LEGACY-WASUR',unitPrice:'900000',notes:'Retain office note',version:5}});
    const {id,createdAt,updatedAt,...wage}=wasur;
    const payroll=await client.jptTariff.create({data:{...wage,code:'PAYROLL-DO-NOT-TOUCH',category:'DRIVER_BON',rateType:'RB',unitPrice:'123456'}});
    const update=await importer.run(client,{...opts,apply:true,backup:path.join(directory,'update.json')});
    assert.equal(update.counts.tariffsUpdate,1); assert.equal(update.counts.tariffsCreate,0);
    const readback=await client.jptTariff.findUnique({where:{id:wasur.id}});
    assert.equal(readback.code,'LEGACY-WASUR'); assert.equal(String(readback.unitPrice),'1000000'); assert.equal(readback.version,6);
    assert.match(readback.notes,/Retain office note/);
    assert.deepEqual(await client.jptTariff.findUnique({where:{id:payroll.id}}),payroll);
    const repeat=await importer.run(client,{...opts,apply:true,backup:path.join(directory,'repeat.json')});
    assert.deepEqual(repeat.counts,{routesCreate:0,routesUpdate:0,routesUnchanged:15,tariffsCreate:0,tariffsUpdate:0,tariffsUnchanged:23});
    await assert.rejects(importer.run(client,{...opts,apply:true,backup}),/EEXIST/);
    // Force a storage failure after route writes: all changes must roll back together.
    await client.jptTariff.deleteMany(); await client.route.deleteMany();
    await base.$executeRawUnsafe(`ALTER TABLE "${schema}"."jpt_tariffs" ADD CONSTRAINT fail_catalog CHECK ("unitPrice" < 1)`);
    await assert.rejects(importer.run(client,{...opts,apply:true,backup:path.join(directory,'rollback.json')}));
    assert.equal(await client.route.count(),0); assert.equal(await client.jptTariff.count(),0);
    assert.deepEqual({routes:await base.route.count(),tariffs:await base.jptTariff.count()},publicBefore);
  } finally {
    await client.$disconnect();
    await base.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    const remaining=await base.$queryRawUnsafe('SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1',schema);
    assert.equal(remaining.length,0,'Owned integration schema cleanup must be read back');
    await base.$disconnect();
    fs.rmSync(directory,{recursive:true,force:true});
  }
});

#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const catalog = require('../backend/src/services/deliveryPriceCatalog');

const HELP = `Delivery service price importer (HARGA BARU; never DRIVER_BON).
Default: read-only dry run. No .env loading or DATABASE_URL fallback.
  node scripts/import-delivery-price-catalog.cjs --database-url <postgresql URL>
Apply requires all: --apply --confirm-target <host:port/database/schema> --backup <new JSON path>
Non-demo targets additionally require: --allow-non-demo
Only 127.0.0.1/localhost/[::1]:55432/scmu_demo is considered the isolated demo.
The backup is an exclusive, fsynced JSON snapshot of routes and jpt_tariffs plus the exact plan.
It contains no connection URL/password. It is NOT a full pg_dump; take a full database backup
before non-demo use. On failure the transaction rolls back; retain the backup for review.
Unknown geography remains empty; grouped labels stay grouped; no historic records are changed.
Dates/tax conflicts, duplicate matches and incompatible scopes stop the entire import.`;
function parseArgs(argv) {
  const options={apply:false,allowNonDemo:false};
  const strings={'--database-url':'url','--confirm-target':'confirmTarget','--backup':'backup'};
  const flags={'--apply':'apply','--allow-non-demo':'allowNonDemo','--help':'help'};
  const seen=new Set();
  for(let i=0;i<argv.length;i++) {
    const arg=argv[i];
    if(seen.has(arg)) throw new Error('Duplicate option: '+arg);
    seen.add(arg);
    if(flags[arg]) options[flags[arg]]=true;
    else if(strings[arg]) {
      if(!argv[i+1] || argv[i+1].startsWith('--')) throw new Error('Missing value: '+arg);
      options[strings[arg]]=argv[++i];
    } else throw new Error('Unknown option: '+arg);
  }
  if(options.help) return options;
  if(!options.url) throw new Error('Explicit --database-url is required; no environment fallback.');
  let url;
  try { url=new URL(options.url); } catch { throw new Error('Invalid PostgreSQL URL'); }
  if(!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw new Error('Invalid PostgreSQL URL');
  const database=decodeURIComponent(url.pathname.slice(1)), schema=url.searchParams.get('schema')||'public';
  if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema) || database.includes('/')) throw new Error('Invalid database/schema');
  options.target=`${url.hostname}:${url.port||'5432'}/${database}/${schema}`;
  options.demo=['localhost','127.0.0.1','[::1]'].includes(url.hostname) && url.port==='55432' && database==='scmu_demo';
  if(options.apply) {
    if(options.confirmTarget!==options.target || !options.backup) throw new Error('Apply requires exact --confirm-target '+options.target+' and --backup <new path>');
    if(!options.demo && !options.allowNonDemo) throw new Error('Refusing non-demo apply without --allow-non-demo and a separately secured full database backup.');
  }
  return options;
}

function createClient(url) {
  // Generated Prisma 5 code normally reads .env both on require and construction.
  // Compile a private module with a local runtime wrapper, NOT a global monkey patch,
  // to disable only env loading while keeping the installed generated schema/engine.
  const filename=require.resolve('../backend/node_modules/.prisma/client/index.js');
  const generated=new Module(filename,module);
  generated.filename=filename;
  generated.paths=Module._nodeModulePaths(path.dirname(filename));
  const originalRequire=generated.require.bind(generated);
  generated.require=id=>{
    const loaded=originalRequire(id);
    if(id!=='@prisma/client/runtime/library.js') return loaded;
    return {...loaded,warnEnvConflicts:()=>{},getPrismaClient:config=>loaded.getPrismaClient({...config,relativeEnvPaths:{},injectableEdgeEnv:undefined})};
  };
  generated._compile(fs.readFileSync(filename,'utf8'),filename);
  return new generated.exports.PrismaClient({datasources:{db:{url}},log:[]});
}
async function snapshot(tx) {
  return {routes:await tx.route.findMany({orderBy:{id:'asc'}}),tariffs:await tx.jptTariff.findMany({orderBy:{id:'asc'}})};
}
function writeBackup(filename, data) {
  const content=JSON.stringify(data,null,2)+'\n';
  const fd=fs.openSync(filename,'wx',0o600);
  try { fs.writeFileSync(fd,content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return {path:path.resolve(filename),sha256:createHash('sha256').update(content).digest('hex')};
}
async function persist(tx, plan) {
  for(const [name,changes] of [['route',plan.routes],['jptTariff',plan.tariffs]]) {
    for(const row of changes) {
      if(row.action==='unchanged') continue;
      const {id,version,createdAt,updatedAt,...fields}=row.after;
      if(row.action==='create') await tx[name].create({data:{...fields,...(id?{id}:{}),version}});
      else {
        const changed=await tx[name].updateMany({where:{id,version:row.before.version},data:{...fields,version}});
        if(changed.count!==1) throw new Error('Concurrent master change; transaction rolled back.');
      }
    }
  }
}
async function run(client, options) {
  let backup;
  const plan=await client.$transaction(async tx=>{
    if(options.apply) {
      // Lock only the two owned catalog tables; no payroll or transaction tables.
      await tx.$executeRawUnsafe('LOCK TABLE "routes", "jpt_tariffs" IN SHARE ROW EXCLUSIVE MODE');
    }
    const before=await snapshot(tx), result=catalog.plan(before);
    if(options.apply) {
      backup=writeBackup(options.backup,{format:'delivery-price-catalog-backup-v1',target:options.target,createdAt:new Date().toISOString(),before,plan:result});
      await persist(tx,result);
      const verification=catalog.plan(await snapshot(tx));
      if(Object.entries(verification.counts).some(([key,value])=>!key.endsWith('Unchanged') && value!==0)) throw new Error('Readback verification failed; transaction rolled back.');
    }
    return result;
  },{isolationLevel:options.apply?'Serializable':'RepeatableRead',timeout:60000,maxWait:10000});
  if(options.apply) {
    const verification=catalog.plan(await snapshot(client));
    if(Object.entries(verification.counts).some(([key,value])=>!key.endsWith('Unchanged') && value!==0)) throw new Error('Post-commit readback mismatch; review backup before retrying.');
  }
  return {mode:options.apply?'applied':'dry-run',target:options.target,backup:backup||null,...plan};
}
async function main(argv) {
  const options=parseArgs(argv);
  if(options.help) { console.log(HELP); return; }
  const client=createClient(options.url);
  try { console.log(JSON.stringify(await run(client,options),null,2)); }
  finally { await client.$disconnect(); }
}
if(require.main===module) main(process.argv.slice(2)).catch(error=>{
  // Prisma errors may echo connection details: never print their full diagnostic.
  console.error(error.name?.startsWith('Prisma') ? 'Database operation failed ('+(error.code||error.name)+'); no connection details logged. Review target/connectivity and retained backup.' : error.message);
  process.exitCode=1;
});
module.exports={HELP,parseArgs,createClient,snapshot,writeBackup,persist,run,main};

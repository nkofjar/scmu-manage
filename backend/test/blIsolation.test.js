const test = require('node:test');
const assert = require('node:assert/strict');
const sea = require('../src/services/seaBills');
const register = require('../src/services/blRegister');
const documents = require('../src/services/shipmentDocuments');
const workspace = require('../src/services/blWorkspace');

function fixture() {
  const bill = {
    ...sea.metadata({billNumber:'BL-A',containers:[{number:'AAAA0000001',seal:'A'}]}),
    id:'a',jobId:'job',journeyId:'voyage',version:1,contentVersion:1,
    shipment:{mode:'SEA',status:'PENDING'},allocations:[],history:[],
    registerData:{voyagePacking:{filename:'recap.xlsx',number:'RPL-KAPAL-1'}},
    files:[{id:'recap',billId:'a',category:'INTERNAL_PACKING_RECAP',filename:'recap.xlsx'}],
  };
  const tx = {
    seaBill:{findUnique:async()=>bill,findFirst:async()=>bill},
    jobOrder:{findUnique:async()=>({id:'job',status:'IN_PROGRESS'})},
    activityLog:{findMany:async()=>[{metadata:{fileId:'recap',snapshot:{kind:'VOYAGE_PACKING',records:[{billId:'a'},{billId:'b'}]}}}]},
  };
  return {bill,tx};
}
test('file API distinguishes voyage references and originals shared by multiple B/Ls',async()=>{
  const {bill,tx}=fixture();
  bill.files.push({id:'partner',billId:'a',category:'PACKING_LIST',filename:'partner.xlsx'});
  tx.seaBillFile={findMany:async()=>[
    {filename:'recap.xlsx',billId:'a',bill:{id:'a',billNumber:'BL-A'}},
    {filename:'recap.xlsx',billId:'b',bill:{id:'b',billNumber:'BL-B'}},
    {filename:'partner.xlsx',billId:'a',bill:{id:'a',billNumber:'BL-A'}},
    {filename:'partner.xlsx',billId:'b',bill:{id:'b',billNumber:'BL-B'}},
  ]};
  const loaded=await documents.get(tx,'a');
  const files=documents.linkedFiles(loaded).map(documents.publicFile);
  const recap=files.find(f=>f.id==='recap'),partner=files.find(f=>f.id==='partner');
  assert.deepEqual(recap.scope,{type:'VOYAGE',billIds:['a','b'],billNumbers:['BL-A','BL-B'],journeyId:'voyage'});
  assert.equal(recap.readOnly,true);
  assert.deepEqual(partner.scope,{type:'SHARED',billIds:['a','b'],billNumbers:['BL-A','BL-B'],journeyId:'voyage'});
  assert.match(partner.mappingWarning,/B\/L/);
  const detail=await register.get(tx,'a');
  assert.deepEqual(detail.files.find(f=>f.id==='partner').scope,partner.scope);
});

test('packing recap category alone is not voyage scope for single or selected multi-bill recaps',async()=>{
  const {bill,tx}=fixture();
  bill.registerData={internalRecap:{filename:'recap.xlsx',valid:true}};
  tx.seaBillFile={findMany:async()=>[]};
  let loaded=await documents.get(tx,'a');
  let recap=documents.linkedFiles(loaded).find(file=>file.id==='recap');
  assert.equal(recap.scope.type,'BL');
  assert.equal(recap.readOnly,false);
  tx.seaBillFile.findMany=async()=>[{filename:'recap.xlsx',bill:{id:'b',billNumber:'BL-B'}}];
  loaded=await documents.get(tx,'a');
  recap=documents.linkedFiles(loaded).find(file=>file.id==='recap');
  assert.equal(recap.scope.type,'SHARED');
  assert.deepEqual(recap.scope.billIds,['a','b']);
  assert.equal(register.availability(loaded).internalPackingList,false);
  assert.equal(documents.availability(loaded).packingList,false);
});

test('historical voyage snapshots identify old aggregate files without misclassifying packing recaps',async()=>{
  const {bill,tx}=fixture();
  bill.files.push({id:'old-voyage',category:'INTERNAL_PACKING_RECAP',filename:'old.xlsx'});
  bill.files.push({id:'selected-recap',category:'INTERNAL_PACKING_RECAP',filename:'selected.xlsx'});
  bill.registerData.internalRecap={filename:'selected.xlsx',valid:true};
  tx.activityLog.findMany=async()=>[
    {metadata:{seaBillId:'a',fileId:'old-voyage',snapshot:{kind:'VOYAGE_PACKING'}}},
    {metadata:{seaBillId:'b',fileId:'selected-recap',snapshot:{kind:'VOYAGE_PACKING'}}},
  ];
  const loaded=await documents.get(tx,'a');
  assert.equal(loaded.files.find(file=>file.id==='old-voyage').scope.type,'VOYAGE');
  assert.equal(loaded.files.find(file=>file.id==='old-voyage').readOnly,true);
  assert.equal(loaded.files.find(file=>file.id==='selected-recap').scope.type,'BL');
});

test('shared source needs explicit bill mapping before confirmation or internal output',()=>{
  const {bill}=fixture();
  bill.files=[{id:'partner',filename:'partner.xlsx',category:'PACKING_LIST',scope:{type:'SHARED',billIds:['a','b']}}];
  const operational=workspace.defaultOperational();
  operational.packing={status:'CONFIRMED',sourceFileIds:['partner'],groups:[{sourceFileId:'partner',containerNumber:'AAAA0000001',recipientName:'Own recipient',items:[{description:'Own goods',packages:5}]}]};
  assert.throws(()=>workspace.normalizeOperational(operational,bill),error=>error.status===409);
  bill.registerData.operational=operational;
  assert.throws(()=>require('../src/services/internalPacking').sourceSnapshot(bill,'PARTNER_PL'),error=>error.status===409);
  operational.packing.scopeConfirmed=true;
  const normalized=workspace.normalizeOperational(operational,bill);
  assert.equal(normalized.packing.scopeConfirmed,true);
  bill.registerData.operational=normalized;
  assert.equal(require('../src/services/internalPacking').sourceSnapshot(bill,'PARTNER_PL').groups.length,1);
  normalized.packing.groups[0].containerNumber='BBBB0000002';
  assert.throws(()=>workspace.normalizeOperational(normalized,bill),error=>error.status===409);
  assert.throws(()=>require('../src/services/internalPacking').sourceSnapshot(bill,'PARTNER_PL'),error=>error.status===409);
});

test('modern driver view includes explicit own and uniquely owned container work only',async()=>{
  const {bill,tx}=fixture();
  const other={...bill,id:'b',billNumber:'BL-B',containers:[{number:'BBBB0000002'},{number:'SHARED00001'}],registerData:{}};
  bill.containers.push({number:'SHARED00001'});
  const parent={id:'voyage',bills:[bill,other],data:{driverOperations:{works:[
    {id:'explicit',billId:'a',containerNumber:'SHARED00001',amount:'10',evidenceFileIds:['own','foreign']},
    {id:'unique',containerNumber:'AAAA0000001'},
    {id:'ambiguous',containerNumber:'SHARED00001',amount:'999'},
    {id:'sibling',billId:'b',containerNumber:'BBBB0000002',amount:'888'}
  ],recaps:[{amount:'9999'}]}},files:[]};
  bill.files=[{id:'own',filename:'own.pdf',category:'POD'}];
  tx.shippingJourney={findUnique:async()=>parent};
  const data=await require('../src/services/driverBons').operations(tx,'a');
  assert.deepEqual(data.works.map(w=>w.id),['explicit','unique']);assert.equal(data.mappingRequired,true);
  assert.deepEqual(data.works[0].evidenceFileIds,['own']);assert.equal(data.works[0].amount,undefined);
  assert.equal(data.recaps,undefined);assert(!JSON.stringify(data).includes('999'));
});

test('bill workspace excludes sibling and unattributed job costs',async()=>{
  const {tx}=fixture();
  const {Prisma}=require('@prisma/client');
  const costs=[{id:'own',tariffSnapshot:{billId:'a'}},{id:'sibling',tariffSnapshot:{billId:'b'}},{id:'job',tariffSnapshot:null}].map(c=>({...c,estimatedAmount:new Prisma.Decimal(100)}));
  tx.jobCharge={findMany:async({where})=>costs.filter(c=>!where.tariffSnapshot||c.tariffSnapshot?.billId===where.tariffSnapshot.equals)};
  assert.deepEqual((await workspace.get(tx,'a')).costs.map(c=>c.id),['own']);
});

test('bill activity route excludes sibling and unattributed job events',async()=>{
  const prisma=require('../src/prisma'),express=require('express');
  const previous={find:prisma.seaBill.findUnique,count:prisma.activityLog.count,list:prisma.activityLog.findMany};
  const events=[{id:'own',metadata:{seaBillId:'a',fileId:'recap',snapshot:{records:[{billId:'a'},{billId:'b',amount:'SIBLING_SECRET'}]},before:{voyageRows:['SIBLING_SECRET']}}},{id:'sibling',metadata:{seaBillId:'b'}},{id:'job',metadata:{}}];
  const select=where=>events.filter(e=>!where.metadata||e.metadata.seaBillId===where.metadata.equals);
  const bill=fixture().bill;bill.files=[];
  prisma.seaBill.findUnique=async()=>bill;
  prisma.activityLog.count=async({where})=>select(where).length;
  prisma.activityLog.findMany=async({where})=>select(where);
  const app=express();app.use((req,res,next)=>{req.user={id:'admin',role:'ADMIN'};next();});app.use('/bl',require('../src/routes/blRegister'));
  app.use((err,req,res,next)=>res.status(err.status||500).json({message:err.message}));
  const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/bl/a/activity`);
    assert.equal(response.status,200);const result=await response.json();
    assert.deepEqual(result.data.map(e=>e.id),['own']);assert.equal(result.total,1);
    assert(!JSON.stringify(result).includes('SIBLING_SECRET'));assert.equal(result.data[0].metadata.fileId,'recap');
  } finally {prisma.seaBill.findUnique=previous.find;prisma.activityLog.count=previous.count;prisma.activityLog.findMany=previous.list;await new Promise(resolve=>server.close(resolve));}
});

test('operations packing listing keeps voyage references without marking the bill internally ready',async()=>{
  const prisma=require('../src/prisma'),express=require('express');
  const previous={count:prisma.seaBill.count,list:prisma.seaBill.findMany};
  const {bill}=fixture();
  prisma.seaBill.count=async()=>1;
  prisma.seaBill.findMany=async()=>[bill];
  const app=express();app.use((req,res,next)=>{req.user={id:'admin',role:'ADMIN'};next();});app.use('/operations',require('../src/routes/operations'));
  app.use((err,req,res,next)=>res.status(err.status||500).json({message:err.message}));
  const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/operations/packing-lists`);
    assert.equal(response.status,200);const result=await response.json();
    assert.equal(result.data[0].internalReady,false);
    assert.equal(result.data[0].action,'CREATE_INTERNAL');
    assert.deepEqual(result.data[0].files.map(file=>file.id),['recap']);
    assert.equal(result.data[0].files[0].filename,undefined);
  } finally {prisma.seaBill.count=previous.count;prisma.seaBill.findMany=previous.list;await new Promise(resolve=>server.close(resolve));}
});

test('voyage recap is reference only, never bill packing availability, output or deletion',async()=>{
  const {bill,tx}=fixture();
  assert.equal(register.availability(bill).internalPackingList,false);
  assert.equal(register.availability(bill).packingList,false);
  assert.equal(documents.availability(bill).internalPackingList,false);
  assert.equal(documents.availability(bill).packingList,false);
  await assert.rejects(documents.packingSnapshot(tx,'a','recap'),error=>error.status===409);
  await assert.rejects(documents.remove(tx,{id:'admin',role:'ADMIN'},'a','recap',{version:1,reason:'Remove'}),error=>error.status===409);
});

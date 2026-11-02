const test = require('node:test');
const assert = require('node:assert/strict');
const sea = require('../src/services/seaBills');

function store() {
  const bill = { ...sea.metadata({billNumber:'000123'}), id:'bill', jobId:'job', documentId:'document', version:1, contentVersion:3,
    shipment:{mode:'SEA',status:'PENDING'}, allocations:[], files:[], history:[], registerData:{},
    internalStatus:'SEA_MATCHED', reviewedContentVersion:3, releaseStatus:'SEA_RELEASE_CONFIRMED', releaseProofId:'release' };
  const writes = { documents:[], audit:[], revisions:[] };
  const tx = {
    jobOrder:{findUnique:async()=>({id:'job',status:'IN_PROGRESS'})},
    seaBill:{findFirst:async({where})=>where.id===bill.id && where.jobId===bill.jobId ? bill : null, findUnique:async({where})=>where.id===bill.id ? bill : null, update:async({data})=>{
      for (const [key,value] of Object.entries(data)) bill[key] = value?.increment !== undefined ? bill[key]+value.increment : value;
      return bill;
    }},
    seaBillFile:{create:async({data})=>{const row={id:`file-${bill.files.length+1}`,createdAt:new Date(),...data};bill.files.unshift(row);return row;}},
    jobDocument:{update:async value=>{writes.documents.push(value);return value;}},
    seaBillRevision:{create:async value=>{writes.revisions.push(value);return value;}},
    activityLog:{create:async value=>{writes.audit.push(value);return value;}}
  };
  return {bill,tx,writes};
}
const upload = {filename:'test.pdf',originalname:'Packing list.pdf',mimetype:'application/pdf',size:20};
test('optional packing and supporting uploads retain every version without changing matched BL, release or finance',async()=>{
  const {bill,tx,writes}=store();
  for (const category of ['PACKING_LIST','SUPPORTING','PACKING_LIST']) {
    await sea.attach(tx,{id:'admin'},'job','bill',{version:bill.version,category,note:'Original supplied later'},upload);
  }
  assert.equal(bill.files.length,3);
  assert.equal(bill.version,4);
  assert.equal(bill.contentVersion,3);
  assert.equal(bill.internalStatus,'SEA_MATCHED');
  assert.equal(bill.releaseStatus,'SEA_RELEASE_CONFIRMED');
  assert.equal(bill.releaseProofId,'release');
  assert.equal(writes.documents.length,0);
  assert.equal(writes.revisions.length,3);
  assert.equal(writes.audit.length,3);
  assert.deepEqual(bill.files.map(row=>row.category),['PACKING_LIST','SUPPORTING','PACKING_LIST']);
});

test('payment proof uploads retain metadata and history without invalidating the matched BL or carrier release',async()=>{
  const {bill,tx,writes}=store();
  await sea.attach(tx,{id:'admin'},'job','bill',{
    version:1,category:'PAYMENT_PROOF',externalNumber:'PAY-001',documentDate:'2026-10-01',note:'Customer payment receipt'
  },upload);
  assert.equal(bill.version,2);assert.equal(bill.contentVersion,3);
  assert.equal(bill.internalStatus,'SEA_MATCHED');assert.equal(bill.reviewedContentVersion,3);
  assert.equal(bill.releaseStatus,'SEA_RELEASE_CONFIRMED');assert.equal(bill.releaseProofId,'release');
  assert.equal(bill.files.length,1);assert.equal(bill.files[0].category,'PAYMENT_PROOF');
  assert.equal(bill.files[0].externalNumber,'PAY-001');
  assert.equal(bill.files[0].documentDate.toISOString(),'2026-10-01T00:00:00.000Z');
  assert.equal(bill.files[0].note,'Customer payment receipt');
  assert.equal(writes.documents.length,0);assert.equal(writes.revisions.length,1);assert.equal(writes.audit.length,1);
});

test('legacy attach rejects archived register records before writing files',async()=>{
  for (const category of ['FINAL','PACKING_LIST']) {
    const {bill,tx,writes}=store();bill.registerData={archivedAt:'2026-10-25T00:00:00.000Z'};
    await assert.rejects(sea.attach(tx,{id:'admin'},'job','bill',{version:1,category},upload),error=>error.status===409 && /archiv/i.test(error.message));
    assert.equal(bill.files.length,0);assert.equal(writes.revisions.length,0);
  }
});
const express=require('express');
const fs=require('node:fs/promises');
const path=require('node:path');
const prisma=require('../src/prisma');
const jobFiles=require('../src/services/jobFiles');
async function httpFixture(work) {
  const state=store();
  state.bill.document={id:'legacy',filename:'legacy.pdf',originalName:'Original BL.pdf',mimeType:'application/pdf',size:8};
  state.bill.allocations=[{packingListId:'packing',packingList:{document:{id:'packing-original',filename:'packing.pdf',originalName:'PL original.pdf',mimeType:'application/pdf',size:8}}}];
  const saved=[];
  for(const [model,methods] of Object.entries(state.tx)) for(const [method,fn] of Object.entries(methods)) {
    saved.push([prisma[model],method,prisma[model][method]]);prisma[model][method]=fn;
  }
  const tx=prisma.$transaction;prisma.$transaction=async fn=>fn(prisma);
  let server;
  try {
    const routePath=path.resolve(__dirname,'../src/routes/registerDocuments.js');
    assert.equal(require('node:fs').existsSync(routePath),true,'integrated documents router must exist');
    const app=express();app.use(express.json());
    app.use((req,res,next)=>{if(req.headers['x-role'])req.user={id:'admin',role:req.headers['x-role']};next();});
    app.use('/api/bl-register',require(routePath));
    app.use((error,req,res,next)=>res.status(error.status||500).json({message:error.message}));
    server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
    await work({...state,root:`http://127.0.0.1:${server.address().port}`});
  } finally {
    for(const [model,method,original] of saved)model[method]=original;
    prisma.$transaction=tx;
    if(server)await new Promise(resolve=>server.close(resolve));
  }
}
test('integrated document list authenticates staff and includes legacy BL plus linked packing original without filesystem names',async()=>{
  await httpFixture(async({root})=>{
    for(const [role,status] of [[null,401],['CUSTOMER',403],['MARKETING',403],['ADMIN',200],['SUPER_ADMIN',200]]) {
      const response=await fetch(`${root}/api/bl-register/bill/files`,{headers:role?{'x-role':role}:{}});
      assert.equal(response.status,status);
      const body=await response.json();
      if(status===200) {
        assert.equal(body.version,1);assert.equal(body.data.length,2);
        assert.equal(body.availability.billOfLading,true);assert.equal(body.availability.packingList,true);
        assert.deepEqual(body.data.map(row=>row.id),['legacy','packing-original']);
        assert.equal(body.data[0].filename,undefined);assert.equal(body.data[0].originalName,'Original BL.pdf');
      }
    }
  });
});
function multipart(category='PACKING_LIST',version='1',bytes='%PDF-1.4\nsynthetic test') {
  const data=new FormData();data.set('version',version);data.set('category',category);data.set('note','Received later');
  data.set('file',new Blob([bytes],{type:'application/pdf'}),'Original.pdf');return data;
}
test('register uploads use secure multipart storage, keep attachment history and return an updated version on the same record',async()=>{
  await httpFixture(async({bill,root})=>{
    const names=[];
    try {
      for(const category of ['PACKING_LIST','SUPPORTING','DRIVER_BON','FINAL']) {
        const response=await fetch(`${root}/api/bl-register/bill/files`,{method:'POST',headers:{'x-role':'ADMIN'},body:multipart(category,String(bill.version))});
        assert.equal(response.status,201);const body=await response.json();
        names.push(bill.files[0].filename);assert.equal(body.version,bill.version);
        assert.equal(body.data[0].category,category);assert.equal(body.data[0].filename,undefined);
        assert.match(await fs.readFile(jobFiles.filePath(bill.files[0].filename),'utf8'),/^%PDF-/);
      }
      assert.equal(bill.files.length,4);assert.equal(bill.version,5);
      assert.equal(bill.registerNumber,undefined);
      const response=await fetch(`${root}/api/bl-register/bill/files`,{headers:{'x-role':'ADMIN'}});
      assert.equal((await response.json()).data.length,6);
    } finally {for(const name of names)await jobFiles.removeFile(name);}
  });
});
test('register supporting evidence uploads are returned on reload without changing BL review or release',async()=>{
  await httpFixture(async({bill,writes,root})=>{
    try {
      for(const category of ['PAYMENT_PROOF','RELEASE','SUPPORTING','RECEIVING_REPORT','DELIVERY_ORDER','INVOICE','MANIFEST','WAYBILL','TAX_INVOICE','PPH23_CERTIFICATE']) {
        const data=multipart(category,String(bill.version));
        data.set('externalNumber',`${category}-001`);data.set('documentDate','2026-10-01');
        const response=await fetch(`${root}/api/bl-register/bill/files`,{method:'POST',headers:{'x-role':'ADMIN'},body:data});
        const body=await response.json();
        assert.equal(response.status,201,`${category}: ${JSON.stringify(body)}`);
        assert.equal(body.version,bill.version);assert.equal(body.data[0].category,category);
        const reload=await fetch(`${root}/api/bl-register/bill/files`,{headers:{'x-role':'ADMIN'}});
        assert.equal(reload.status,200);const saved=await reload.json();
        const attached=saved.data.find(row=>row.id===body.data[0].id);
        assert.equal(saved.version,bill.version);assert.equal(attached.category,category);
        assert.equal(attached.externalNumber,`${category}-001`);
        assert.equal(attached.documentDate,'2026-10-01T00:00:00.000Z');
        assert.equal(attached.filename,undefined);
        assert.match(await fs.readFile(jobFiles.filePath(bill.files[0].filename),'utf8'),/^%PDF-/);
      }
      assert.equal(bill.contentVersion,3);assert.equal(bill.internalStatus,'SEA_MATCHED');
      assert.equal(bill.reviewedContentVersion,3);assert.equal(bill.releaseStatus,'SEA_RELEASE_CONFIRMED');
      assert.equal(bill.releaseProofId,'release');assert.equal(writes.documents.length,0);
      assert.equal(writes.revisions.length,bill.files.length);assert.equal(writes.audit.length,bill.files.length);
    } finally {for(const file of bill.files)await jobFiles.removeFile(file.filename);}
  });
});
test('staff download checks ownership for attachment, legacy BL and packing original and streams actual bytes',async()=>{
  await httpFixture(async({bill,root})=>{
    const name=`test-${require('node:crypto').randomUUID()}.pdf`;
    bill.files=[{id:'owned',filename:name,originalName:'Owned original.pdf',category:'SUPPORTING'}];
    bill.document.filename=name;bill.allocations[0].packingList.document.filename=name;
    await fs.writeFile(jobFiles.filePath(name),'%PDF-synthetic download');
    try {
      for(const [id,role,status] of [['owned',null,401],['owned','CUSTOMER',403],['foreign','ADMIN',404],['owned','ADMIN',200]]) {
        const response=await fetch(`${root}/api/bl-register/bill/files/${id}`,{headers:role?{'x-role':role}:{}});
        assert.equal(response.status,status);
        if(status===200) {assert.equal(await response.text(),'%PDF-synthetic download');assert.match(response.headers.get('content-disposition'),/Owned original.pdf/);}
      }
      bill.files=[];
      for(const id of ['legacy','packing-original']) {
        // Different physical originals avoid deduplication in the file list.
        bill.document.filename=id==='legacy'?name:'other.pdf';
        const response=await fetch(`${root}/api/bl-register/bill/files/${id}`,{headers:{'x-role':'ADMIN'}});
        assert.equal(response.status,200);assert.equal(await response.text(),'%PDF-synthetic download');
      }
    } finally {await jobFiles.removeFile(name);}
  });
});
test('failed multipart attempts leave no new files and reject stale versions, archive, wrong type, category and foreign roles',async()=>{
  await httpFixture(async({bill,root})=>{
    const directory=path.dirname(jobFiles.filePath('probe.pdf'));
    const before=(await fs.readdir(directory)).sort();
    for(const [role,category,version,bytes,status] of [
      [null,'PACKING_LIST','1','%PDF-test',401],['MARKETING','PACKING_LIST','1','%PDF-test',403],
      ['ADMIN','UNSUPPORTED','1','%PDF-test',422],['ADMIN','PACKING_LIST','2','%PDF-test',409],
      ['ADMIN','PACKING_LIST','1','not PDF',415],['ADMIN','PACKING_LIST','','%PDF-test',422]
    ]) {
      const response=await fetch(`${root}/api/bl-register/bill/files`,{method:'POST',headers:role?{'x-role':role}:{},body:multipart(category,version,bytes)});
      assert.equal(response.status,status);assert.equal(typeof (await response.json()).message,'string');
      assert.deepEqual((await fs.readdir(directory)).sort(),before);assert.equal(bill.files.length,0);
    }
    bill.registerData={archivedAt:'2026-10-25T00:00:00.000Z'};
    const response=await fetch(`${root}/api/bl-register/bill/files`,{method:'POST',headers:{'x-role':'ADMIN'},body:multipart()});
    assert.equal(response.status,409);assert.deepEqual((await fs.readdir(directory)).sort(),before);
  });
});
test('another register cannot download an owned file or accept uploads under a nonexistent record ID',async()=>{
  await httpFixture(async({bill,root})=>{
    bill.files=[{id:'owned',filename:'not-read.pdf',category:'SUPPORTING'}];
    for(const endpoint of ['/other/files/owned','/other/files']) {
      const response=await fetch(`${root}/api/bl-register${endpoint}`,{headers:{'x-role':'ADMIN'}});
      assert.equal(response.status,404);assert.match((await response.json()).message,/not found|tidak ditemukan/i);
    }
    const response=await fetch(`${root}/api/bl-register/other/files`,{method:'POST',headers:{'x-role':'ADMIN'},body:multipart()});
    assert.equal(response.status,404);assert.equal(bill.files.length,1);
  });
});
test('legacy attachment categories still retain history and preserve their existing BL invalidation boundary',async()=>{
  for(const category of ['DRAFT','FINAL','RELEASE','DELIVERY_ORDER']) {
    const {bill,tx,writes}=store();bill.files=[{id:'prior',category:'FINAL',contentVersion:3}];
    await sea.attach(tx,{id:'admin'},'job','bill',{category,version:1,externalNumber:'DO-01',documentDate:'2026-10-01'},upload);
    assert.equal(bill.files.length,2);assert.equal(bill.version,2);
    if(['DRAFT','FINAL'].includes(category)) {
      assert.equal(bill.contentVersion,4);assert.equal(bill.releaseStatus,'SEA_RELEASE_PENDING');assert.equal(writes.documents.length,1);
    } else {
      assert.equal(bill.contentVersion,3);assert.equal(bill.releaseStatus,'SEA_RELEASE_CONFIRMED');assert.equal(writes.documents.length,0);
    }
  }
});
module.exports={store,upload};

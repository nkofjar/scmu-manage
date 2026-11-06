const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),jwt=require('jsonwebtoken');
const {setup,user}=require('./driverDispatch.test');
const {fixture}=require('./driverTrips.test');
const prisma=require('../src/prisma');
test('authenticated dispatch HTTP publishes once, downloads saved bytes and rejects foreign scope',async()=>{
 const f=setup(),original={};for(const key of ['user','seaBill','shippingJourney','company','activityLog','$transaction'])original[key]=prisma[key];
 const app=express();app.use(express.json());process.env.JWT_SECRET='fixture-dispatch-secret';
 try{
  Object.assign(prisma,f.tx);prisma.user={findUnique:async()=>({...user,isActive:true})};prisma.$transaction=async fn=>fn(f.tx);
  app.use('/api/bl-register',require('../src/routes/blRegister'));app.use('/api/driver-trips',require('../src/routes/driverTrips'));app.use(require('../src/middleware/errorHandler').errorHandler);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{
   const base=`http://127.0.0.1:${server.address().port}/api`,headers={'Content-Type':'application/json',Authorization:'Bearer '+jwt.sign({id:user.id},process.env.JWT_SECRET)};
   const url=base+'/bl-register/a/driver-operations/works/work-a',body=JSON.stringify({version:1,documentType:'TRANSPORT_ORDER',confirmed:true});
   assert.equal((await fetch(url+'/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body})).status,401);
   const response=await fetch(url+'/dispatch',{method:'POST',headers,body});assert.equal(response.status,201);const published=await response.json();assert(published.id);assert.equal(f.parent.version,2);
   const retry=await fetch(url+'/dispatch',{method:'POST',headers,body});assert.equal(retry.status,201);assert.equal((await retry.json()).id,published.id);assert.equal(f.parent.version,2);
   const listed=await(await fetch(url+'/dispatches',{headers})).json();assert.equal(listed.data.length,1);
   f.parent.archivedAt=new Date();f.work.driverName='Changed';
   const pdf=await fetch(url+`/dispatches/${published.id}/pdf`,{headers});assert.equal(pdf.status,200);assert(pdf.headers.get('content-type').includes('application/pdf'));const bytes=Buffer.from(await pdf.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'),published.pdfSha256);
   assert.equal((await fetch(base+`/bl-register/b/driver-operations/works/work-a/dispatches/${published.id}/pdf`,{headers})).status,404);
   const reports=fixture();prisma.shippingJourney.findMany=reports.tx.shippingJourney.findMany;const writes=f.writes.length;
   const report=await fetch(base+'/driver-trips?month=2026-10',{headers});assert.equal(report.status,200);assert.equal((await report.json()).total,7);assert.equal(f.writes.length,writes);
  }finally{await new Promise(r=>server.close(r));}
 }finally{Object.assign(prisma,original);}
});

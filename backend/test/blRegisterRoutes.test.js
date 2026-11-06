const test=require('node:test');const assert=require('node:assert/strict');const express=require('express');
test('existing job route cannot edit snapshotted tariff charges',async()=>{
 const prisma=require('../src/prisma');const jobFind=prisma.jobOrder.findUnique,chargeFind=prisma.jobCharge.findFirst,transaction=prisma.$transaction;
 prisma.jobOrder.findUnique=async()=>({id:'job',status:'BOOKED'});prisma.jobCharge.findFirst=async()=>({id:'charge',status:'PROPOSED',kind:'REVENUE',tariffSnapshot:{line:{amount:'100'}}});prisma.$transaction=async work=>work(prisma);
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:'staff',role:'ADMIN'};next()});app.use('/jobs',require('../src/routes/jobs'));app.use((err,req,res,next)=>res.status(err.status||500).json({message:err.message}));
 const server=app.listen(0);await new Promise(r=>server.once('listening',r));
 try {const response=await fetch(`http://127.0.0.1:${server.address().port}/jobs/job/charges/charge`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({description:'Changed',estimatedAmount:'1'})});assert.equal(response.status,409);assert.match((await response.json()).message,/snapshot/);}
 finally{prisma.jobOrder.findUnique=jobFind;prisma.jobCharge.findFirst=chargeFind;prisma.$transaction=transaction;await new Promise(r=>server.close(r));}
});
test('staff routers enforce auth, deny non-admin tariff edits and reject invalid register input as JSON',async()=>{
 const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.headers['x-test-role'])req.user={id:'staff',role:req.headers['x-test-role']};next()});
 app.use('/api/bl-register',require('../src/routes/blRegister'));app.use('/api/jpt-tariffs',require('../src/routes/jptTariffs'));
 app.use((error,req,res,next)=>res.status(error.status||500).json({message:error.message}));
 const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));const root=`http://127.0.0.1:${server.address().port}`;
 try {
 for(const [url,method,role,body,status] of [['/api/bl-register','GET',null,null,401],['/api/bl-register/id','DELETE',null,{},401],['/api/bl-register/id','DELETE','CUSTOMER',{},403],['/api/bl-register/id/restore','POST','CUSTOMER',{},403],['/api/bl-register/id/driver-bons','POST',null,{},401],['/api/bl-register/id/driver-bons','POST','CUSTOMER',{},403],['/api/jpt-tariffs','GET','CUSTOMER',null,403],['/api/jpt-tariffs/id','PUT','OPERATOR',{unitPrice:'1'},403],['/api/bl-register','POST','ADMIN',{containers:'invalid'},422]]) {
 const response=await fetch(root+url,{method,headers:{'Content-Type':'application/json',...(role?{'x-test-role':role}:{})},body:body?JSON.stringify(body):undefined});assert.equal(response.status,status);assert.equal(typeof (await response.json()).message,'string');
 }
 }finally {await new Promise(resolve=>server.close(resolve));}
});

const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),jwt=require('jsonwebtoken');
const prisma=require('../src/prisma'),{fixture}=require('./helpers/journeyBillRecapFixture');
test('authenticated read-only recap HTTP serves the same computation as parseable PDF and workbook, allowing archives but excluding trash',async()=>{
 const f=fixture(),original={};for(const k of ['user','shippingJourney','jobCharge','$transaction'])original[k]=prisma[k];let writes=0;
 const forbidden=async()=>{writes++;throw Error('Unexpected write');};
 const tx={shippingJourney:{findUnique:async({where})=>where.id==='j'?f.row:null,create:forbidden,update:forbidden},jobCharge:{findMany:async({where})=>f.charges.filter(c=>where.jobId.in.includes(c.jobId)),create:forbidden}};
 const app=express();process.env.JWT_SECRET='recap-fixture-secret';
 try{
  Object.assign(prisma,tx);prisma.user={findUnique:async()=>({id:'staff',role:'ADMIN',isActive:true})};prisma.$transaction=async fn=>fn(tx);
  let router;try{router=require('../src/routes/journeyBillRecap');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}assert(router,'separate journey bill recap router exists');
  app.use('/api/journeys',router);app.use(require('../src/middleware/errorHandler').errorHandler);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{
   const base=`http://127.0.0.1:${server.address().port}/api/journeys/`,headers={Authorization:'Bearer '+jwt.sign({userId:'staff'},process.env.JWT_SECRET)};
   assert.equal((await fetch(base+'j/bill-recap')).status,401);
   const preview=await fetch(base+'j/bill-recap',{headers});assert.equal(preview.status,200);const recap=await preview.json();assert.equal(recap.financials[0].difference,'75.05');
   const pdf=await fetch(base+'j/bill-recap.pdf',{headers});assert.equal(pdf.status,200);assert(pdf.headers.get('content-type').includes('application/pdf'));assert(pdf.headers.get('content-disposition').includes('.pdf'));
   const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs'),doc=await getDocument({data:new Uint8Array(await pdf.arrayBuffer()),useSystemFonts:true}).promise;let text='';for(let n=1;n<=doc.numPages;n++)text+=(await(await doc.getPage(n)).getTextContent()).items.map(i=>i.str).join(' ');assert(text.includes('75.05'));assert(text.includes('Sender a'));await doc.cleanup();
   const xlsx=await fetch(base+'j/bill-recap.xlsx',{headers});assert.equal(xlsx.status,200);const book=new(require('exceljs').Workbook)();await book.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));assert.equal(book.getWorksheet('Keuangan').getRow(2).getCell(4).value,recap.financials[0].difference);
   f.row.archivedAt=new Date();assert.equal((await fetch(base+'j/bill-recap',{headers})).status,200);f.row.deletedAt=new Date();for(const suffix of ['','.pdf','.xlsx'])assert.equal((await fetch(base+'j/bill-recap'+suffix,{headers})).status,404);
   assert.equal((await fetch(base+'missing/bill-recap',{headers})).status,404);assert.equal(writes,0);
  }finally{await new Promise(r=>server.close(r));}
 }finally{Object.assign(prisma,original);}
});

const test=require('node:test'),assert=require('node:assert/strict');
let service={};try{service=require('../src/services/journeyBillRecap');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
const {fixture}=require('./helpers/journeyBillRecapFixture');
test('authoritative recap counts physical containers and unique approved actual transactions, not proposals or book nominal',()=>{
 assert.equal(typeof service.compute,'function');const {row,charges}=fixture(),before=JSON.stringify({row,charges});
 const recap=service.compute(row,[...charges,charges[0]]);
 assert.equal(recap.bills.length,3);assert.equal(recap.bills[0].shipperName,'Sender a');assert.equal(recap.bills[0].cargo,'Rice a');assert.equal(recap.bills[0].recordedAmount,'999999.00');
 assert.deepEqual(recap.totals.containers,{twenty:1,forty:1,other:0,total:2});
 assert.deepEqual(recap.charges.find(c=>c.id==='r').billIds,['a','b']);assert.equal(recap.charges.length,5);
 assert.equal(recap.financials[0].income,'100.10');assert.equal(recap.financials[0].cost,'25.05');assert.equal(recap.financials[0].difference,'75.05');assert.equal(recap.financials[0].profit,null);assert.equal(recap.financials[0].status,'PROVISIONAL');assert(recap.financials[0].missingIncomeJobIds.includes('other'));
 assert.equal(JSON.stringify({row,charges}),before);
});
test('archived records remain readable; trash, absent actual values, explicit zero and currency separation remain honest',()=>{
 const {row,charges}=fixture();row.archivedAt=new Date();row.bills[2].job.currency='USD';charges.push({id:'zero',jobId:'other',kind:'REVENUE',status:'APPROVED',actualAmount:'0',estimatedAmount:'555'});
 const result=service.compute(row,charges);assert.equal(result.journey.archived,true);assert.equal(result.financials.find(f=>f.currency==='USD').income,'0.00');assert.equal(result.financials.find(f=>f.currency==='USD').cost,null);assert.equal(result.financials.find(f=>f.currency==='USD').difference,null);
 charges[0].actualAmount=null;assert.equal(service.compute(row,charges).financials.find(f=>f.currency==='IDR').income,null);
 row.deletedAt=new Date();assert.throws(()=>service.compute(row,charges),e=>e.status===404);
});
test('unknown currency transactions remain visible but never aggregate into a monetary total',()=>{
 const {row,charges}=fixture();row.bills.forEach(b=>b.job.currency=null);row.sharedJob.currency=null;
 const result=service.compute(row,charges);assert.equal(result.financials[0].income,null);assert.equal(result.financials[0].cost,null);assert.equal(result.financials[0].difference,null);assert.equal(result.charges.find(c=>c.id==='r').actualAmount,'100.10');
});
test('shared physical containers with contradictory sizes stay unknown, even across repeated B/L references',()=>{
 const {row,charges}=fixture();row.bills[1].registerData.containers[0].size='40';row.bills.push({...row.bills[0],id:'alias'});
 const recap=service.compute(row,charges);assert.deepEqual(recap.totals.containers,{twenty:0,forty:1,other:1,total:2});
 assert.equal(recap.charges.filter(c=>c.id==='r').length,1);assert.equal(recap.financials[0].income,'100.10');
});
test('real PDF and Excel exports preserve server recap identities, totals, charges and provisional unknowns',async()=>{
 assert.equal(typeof service.pdf,'function');assert.equal(typeof service.workbook,'function');
 const {row,charges}=fixture(),recap=service.compute(row,charges),bytes=await service.pdf(recap);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs'),pdf=await getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;
 let text='';for(let n=1;n<=pdf.numPages;n++)text+=(await(await pdf.getPage(n)).getTextContent()).items.map(i=>i.str).join(' ');await pdf.cleanup();
 for(const expected of ['Rekapan B/L','Sender a','Receiver a','Rice a','75.05','PROVISIONAL','ABCU 123-4567','999999.00','proposed'])assert(text.includes(expected),expected);
 const book=new(require('exceljs').Workbook)();await book.xlsx.load(await service.workbook(recap));assert.equal(book.getWorksheet('B-L').getRow(2).getCell(2).value,'A');assert.equal(book.getWorksheet('B-L').getRow(2).getCell(3).value,'Sender a');
 assert.equal(book.getWorksheet('Keuangan').getRow(2).getCell(4).value,'75.05');assert.equal(book.getWorksheet('Keuangan').getRow(2).getCell(5).value,'PROVISIONAL');assert.equal(book.getWorksheet('Transaksi').rowCount,6);assert(book.getWorksheet('Ringkasan').getSheetValues().flat().includes(2));
});


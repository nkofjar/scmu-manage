const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./billDriverOperations.test');
const dispatch=require('../src/services/driverDispatch');
const user={id:'staff',name:'Staff',role:'ADMIN'};
async function parse(bytes){const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const pdf=await getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;const pages=[];for(let n=1;n<=pdf.numPages;n++){const p=await pdf.getPage(n),content=await p.getTextContent();pages.push({width:p.view[2],height:p.view[3],text:content.items.map(i=>i.str).join(' '),items:content.items});}await pdf.cleanup();return pages;}
function setup(){const f=fixture();f.tx.company={findUnique:async({where})=>({id:where.id,name:'PT SARANA CIPTA MANDIRI UTAMA',address:'Alamat perusahaan sebenarnya',isInternal:true,isActive:true})};Object.assign(f.parent,{vesselName:'KM Actual',voyageNumber:'V-07'});Object.assign(f.work,{recordingPolicy:'POST_DELIVERY',status:'VERIFIED',receivedDate:'2026-01-03',taskDate:'2026-01-02',deliveries:[{id:'first',billId:'a',containerNumber:'C1',containerKey:'C1',size:'20',recipient:'Penerima Satu',destination:'Gudang Satu',receivedDate:'2026-01-02',receiptReference:'REC-001',evidenceFileIds:['own'],items:[{owner:'Owner Satu',collyCount:2,collyType:'SAK',goodsType:'Beras Satu',packageWeightKg:25},{owner:'Owner Dua',collyCount:3,collyType:'DRUM',goodsType:'Minyak Dua'}]},{id:'second',billId:'a',containerNumber:'C1',containerKey:'C1',size:'20',recipient:'Penerima Dua',destination:'Gudang Dua',receivedDate:'2026-01-03',receiptReference:'REC-002',evidenceFileIds:['own'],items:[{owner:'Owner Tiga',collyCount:4,collyType:'BOX',goodsType:'Barang Tiga'}]}]});return f;}
test('new BONRATE is a landscape six-column nota with actual snapshot header and all child items',async()=>{
 const f=setup(),saved=await dispatch.issueBill(f.tx,user,'a','work-a',{version:1,documentType:'BONRATE',confirmed:true}),pages=await parse(dispatch.pdf(saved));
 assert.equal(pages.length,1);assert(pages[0].width>pages[0].height,'BONRATE must be landscape');const text=pages.map(p=>p.text).join(' ');
 for(const s of ['JASA PENGURUSAN TRANSPORTASI (JPT)','PT SARANA CIPTA MANDIRI UTAMA','Alamat perusahaan sebenarnya','SURAT JALAN MOBIL','BONRATE RB','No. Auto','PA123','EX KM','KM Actual','V-07','Nomor',saved.number,'Dari','Port','Ke','Gudang Satu','Gudang Dua','No.','Merk & Nomor','Banyaknya','Colly','Jenis Colly','Jenis Barang','Tanda Terima','Owner Satu','Owner Dua','Owner Tiga','Penerima Satu','Penerima Dua','2026-01-02','2026-01-03','REC-001','REC-002','25 kg/kemasan','Jumlah','9','Pengemudi','Driver','Gudang / Penerima','Catatan','Dengan diterimanya Surat Jalan Mobil ini, Sopir harus','bertanggung jawab atas muatan yang diangkutnya.'])assert(text.includes(s),s);
 for(const s of ['Beras Satu','Minyak Dua','Barang Tiga'])assert.equal(text.split(s).length-1,1,s+' printed once');
 for(const s of ['PT SBN','PT. SBN','MERAUKE','Merauke','undefined','null'])assert(!text.includes(s),s+' must not be invented');
 const stored=dispatch.pdf(saved);f.tx.company.findUnique=async()=>{throw Error('No current masters on reprint');};f.work.driverName='Changed';const repeated=await dispatch.issueBill(f.tx,user,'a','work-a',{version:2,documentType:'BONRATE',confirmed:true});assert.deepEqual(dispatch.pdf(repeated),stored);assert.equal(f.writes.length,1);
});
test('long BONRATE cargo paginates with repeated masthead and table, complete text and no clipping or empty trailing pages',async()=>{
 const {renderBonratePdf}=require('../src/services/bonratePdf'),f=setup();const snapshot={...f.work,documentType:'BONRATE',number:'SJ-PAGINATION',createdAt:'2026-01-03T00:00:00.000Z',company:{name:'Actual Company'},items:[]};
 snapshot.deliveries=Array.from({length:24},(_,n)=>({...f.work.deliveries[0],recipient:`Recipient ${n}`,destination:`Destination ${n}`,items:[{owner:`OWNER-${n}`,collyCount:n+1,collyType:'SAK',goodsType:n===3?'LONGSTART '+('Long goods description '.repeat(220))+'LONGEND':`GOODS-${n}`}]}));
 const pages=await parse(await renderBonratePdf(snapshot));assert(pages.length>1,'must actually exercise multiple pages');assert(pages.length<20,'must not produce runaway blank pages');const text=pages.map(p=>p.text).join(' ');
 for(let n=0;n<24;n++)assert(text.includes(`OWNER-${n}`),`missing child ${n}`);for(const s of ['LONGSTART','LONGEND','GOODS-23','Jumlah 300 Colly','Pengemudi'])assert(text.includes(s),s);
 assert(pages[pages.length-1].text.includes('GOODS-23'),'final cargo row stays with closing signatures, not a header-only trailing sheet');
 for(const [index,page]of pages.entries()){
  assert(page.width>page.height);for(const s of ['JASA PENGURUSAN TRANSPORTASI (JPT)','SURAT JALAN MOBIL','Merk & Nomor','Tanda Terima'])assert(page.text.includes(s),`header missing page ${index+1}: ${s}`);
  assert(page.items.length>30,'no empty trailing page');
  for(const item of page.items.filter(i=>i.str.trim())){assert(item.transform[4]>=30,'text outside left margin');assert(item.transform[4]+item.width<=page.width-28,`text outside right margin: ${item.str}`);assert(item.transform[5]>=28,`text below page: ${item.str}`);assert(item.transform[5]+item.height<=page.height-25,`text above page: ${item.str}`);}
 }
});
test('incomplete colly is never reported as a numeric complete total and long unbroken values stay inside cells',async()=>{
 const {renderBonratePdf}=require('../src/services/bonratePdf'),f=setup(),snapshot={...f.work,documentType:'BONRATE',number:'SJ-EDGE',createdAt:'2026-01-03T00:00:00.000Z',company:{name:'Company Actual'},instructions:'INSTRUCTIONSTART '+('long instruction '.repeat(120))+' INSTRUCTIONEND'};
 snapshot.deliveries[0].items[0].collyCount=null;snapshot.deliveries[0].items[0].owner='MARKSTART'+('A'.repeat(260))+'MARKEND';
 const pages=await parse(await renderBonratePdf(snapshot)),text=pages.map(p=>p.text).join(' ');assert(text.includes('Belum lengkap'));assert(!text.includes('Jumlah 7 Colly'));for(const s of ['MARKSTART','MARKEND','INSTRUCTIONSTART','INSTRUCTIONEND'])assert(text.replace(/\s/g,'').includes(s),s);
 for(const page of pages)for(const item of page.items.filter(i=>i.str.trim())){assert(item.transform[4]>=30);assert(item.transform[4]+item.width<=page.width-28);assert(item.transform[5]>=28);}
});
test('long company signature labels reserve handwriting space below their complete wrapped text',async()=>{
 const {renderBonratePdf}=require('../src/services/bonratePdf'),f=setup(),name=('Nama Perusahaan Resmi '.repeat(10)).trim(),snapshot={...f.work,number:'SJ-LONG-COMPANY',createdAt:'2026-01-03T00:00:00.000Z',company:{name},deliveries:[f.work.deliveries[0]]};
 const pages=await parse(await renderBonratePdf(snapshot));
 // Below the table, every wrapped company label must remain above its signature line.
 const last=pages[pages.length-1],driver=last.items.find(i=>i.str==='Driver');assert(driver,'driver below the shared signature baseline');
 const labelLines=last.items.filter(i=>i.transform[4]>last.width*0.64&&i.transform[5]<200&&/Nama|Perusahaan|Resmi/.test(i.str));assert(labelLines.length>4,'exercise tall signature label');
 assert(labelLines.every(i=>i.transform[5]>driver.transform[5]+35),'company label must be above the blank signing area');
});
module.exports={parse,setup};

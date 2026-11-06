const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const ExcelJS=require('exceljs');
const {fail,text,integer,audit,STAFF}=require('./jpt');
const files=require('./jobFiles');
const importer=require('./packingImport');
const register=require('./blRegister');
const NOTICE='Berdasarkan Packing List mitra';
const HEADER_KEYS=['partnerName','vesselName','voyageNumber','billNumber','departureDate','arrivalDate','storageDate','demurrageDate'];
const optional=(v,label,max=250)=>text(typeof v==='string'?v.trim():v,label,max,true);
function normalize(input){
 fail(input&&typeof input==='object'&&!Array.isArray(input),'Isi ringkasan PL yang valid.');
 fail(input.header&&typeof input.header==='object'&&!Array.isArray(input.header),'Isi kepala ringkasan yang valid.');
 const header=Object.fromEntries(HEADER_KEYS.map(key=>[key,optional(input.header[key],key,200)]));
 fail(Array.isArray(input.rows)&&input.rows.length>0&&input.rows.length<=200,'Isi 1 sampai 200 baris ringkasan.');
 const rows=input.rows.map((row,index)=>{
  fail(row&&typeof row==='object'&&!Array.isArray(row),'Isi baris ringkasan yang valid.');
  fail(Array.isArray(row.recipients)&&row.recipients.length<=500,'Isi maksimal 500 penerima per baris.');
  const recipients=[],seen=new Set();for(const value of row.recipients){if(typeof value==='string'&&!value.trim())continue;const name=optional(value,'Penerima / mark',250);if(name&&!seen.has(name.toLocaleLowerCase())){seen.add(name.toLocaleLowerCase());recipients.push(name);}}
  const quantities=row.quantities??[];fail(Array.isArray(quantities)&&quantities.length<=20,'Isi maksimal 20 satuan per baris.');
  const counts=quantities.map(q=>{fail(q&&typeof q==='object'&&!Array.isArray(q),'Isi jumlah dan satuan yang valid.');return {unit:text(q.unit,'Satuan',30).toUpperCase(),quantity:q.quantity==null||typeof q.quantity==='string'&&!q.quantity.trim()?null:integer(q.quantity,'Jumlah',0,1000000)};});
  fail(new Set(counts.map(q=>q.unit)).size===counts.length,'Gabungkan jumlah dengan satuan yang sama pada satu baris.');
  const containerNumber=optional(row.containerNumber,'Kontainer',50)?.toUpperCase()||null,sealNumber=optional(row.sealNumber,'Segel',100);
  fail(containerNumber||recipients.length,'Isi kontainer atau minimal satu penerima pada setiap baris.');
  return {id:'row-'+(index+1),containerNumber,sealNumber,recipients,quantities:counts,notes:optional(row.notes,'Catatan ringkasan',1000)};
 });
 fail(rows.reduce((n,r)=>n+r.recipients.length,0)<=2000,'Ringkasan melebihi 2000 nama penerima.');
 const result={header,rows};fail(JSON.stringify(result).length<=512*1024,'Ringkasan terlalu besar.');return result;
}
function summarizeParsed(parsed){
 const map=new Map();
 for(const g of parsed.groups){const key=JSON.stringify([g.containerNumber||null,g.sealNumber||null]);let row=map.get(key);if(!row){row={id:'row-'+(map.size+1),containerNumber:g.containerNumber||null,sealNumber:g.sealNumber||null,recipients:[],quantities:[],notes:null};map.set(key,row);}
  if(g.recipientName&&!row.recipients.some(n=>n.toLocaleLowerCase()===g.recipientName.trim().toLocaleLowerCase()))row.recipients.push(g.recipientName.trim());
  const items=g.dataLevel==='SUMMARY'?[{packages:g.summaryPackages,packageUnit:g.packageUnit}]:g.items.length?g.items:[{packages:null,packageUnit:'KOLI'}];
  for(const item of items){const unit=(item.packageUnit||'KOLI').toUpperCase();let count=row.quantities.find(q=>q.unit===unit);if(!count){count={unit,quantity:0};row.quantities.push(count);}count.quantity=count.quantity==null||item.packages==null?null:count.quantity+item.packages;}
 }
 return [...map.values()];
}
async function owned(tx,id,fileId){
 const bill=await register.get(tx,id),file=bill.files.find(f=>f.id===fileId&&f.filename&&f.category==='PACKING_LIST');fail(file,'Pilih file Packing List mitra pada pengiriman ini.',404);
 let buffer;try{buffer=await fs.readFile(files.filePath(file.filename));}catch(e){if(e.code==='ENOENT')fail(false,'File sumber tidak ditemukan di penyimpanan.',404);throw e;}
 fail(buffer.length<=5*1024*1024,'File sumber melebihi batas pembacaan ringkasan.');
 return {bill,file,buffer,sourceHash:createHash('sha256').update(buffer).digest('hex')};
}
function totals(rows){const result={};for(const row of rows)for(const q of row.quantities)result[q.unit]=result[q.unit]===null||q.quantity==null?null:(result[q.unit]||0)+q.quantity;return Object.entries(result).map(([unit,quantity])=>({unit,quantity}));}
function presented(bill,file,data,sourceHash,extra={}){return {version:bill.version,fileId:file.id,sourceName:file.originalName,mimeType:file.mimeType,sourceHash,notice:NOTICE,...data,totals:totals(data.rows),...extra,scope:file.scope,totalsScope:'SOURCE',mappingWarning:file.mappingWarning||null};}
async function preview(tx,id,fileId){
 const {bill,file,buffer,sourceHash}=await owned(tx,id,fileId),saved=bill.registerData?.partnerPackingSummaries?.[fileId];
 if(saved?.sourceHash===sourceHash)return presented(bill,file,saved.summary,sourceHash,{mode:saved.mode,sourceHeading:saved.sourceHeading,saved:true,reviewedAt:saved.reviewedAt,reviewedByName:saved.reviewedByName,warnings:saved.warnings||[]});
 let parsed,warning;
 if(/\.xlsx$/i.test(file.originalName)||file.mimeType===importer.MIME){try{parsed=await importer.readOriginal(buffer,{summaryOnly:true});}catch(error){if(error.status>=400&&error.status<500)warning='File tersimpan, tetapi ringkasan otomatis belum dapat dibaca. Lengkapi ringkasan singkat dari file asli.';else throw error;}}
 const rows=parsed?.groups?.length?summarizeParsed(parsed):[];
 const header=Object.fromEntries(HEADER_KEYS.map(k=>[k,parsed?.sourceHeader?.[k]||null]));
 if(!header.vesselName||!header.voyageNumber){const match=parsed?.headings?.[0]?.match(/\b(KM[.\s]+.+?)\s+V(?:OY)?[.\s]*([A-Z0-9]+(?:\/\d{2,4})?)(?=\s|\/|$)/i);if(match){header.vesselName||=match[1];header.voyageNumber||=match[2];}}
 return presented(bill,file,{header,rows},sourceHash,{mode:rows.length?'AUTOMATIC':'MANUAL',sourceHeading:parsed?.headings?.join(' | ')||null,saved:false,needsReview:true,warnings:[...(parsed?.warnings||[]),...(!rows.length?[warning||'Format ini belum mendukung ringkasan otomatis. Lihat file asli dan lengkapi ringkasan singkat.']:[]),...(saved?['File sumber berubah. Periksa kembali ringkasan sebelum dicetak.']:[])]});
}
async function save(tx,user,id,fileId,body){
 fail(STAFF.includes(user?.role),'Hanya staf internal yang dapat menyiapkan ringkasan PL.',403);
 const {bill,file,sourceHash}=await owned(tx,id,fileId);await require('./seaBills').getBill(tx,bill.jobId,id,integer(body.version,'Versi'));
 fail(body.sourceHash===sourceHash,'File sumber berubah. Buka ulang pratinjau ringkasan.',409);fail(body.confirmed===true,'Periksa ringkasan terhadap file asli sebelum mencetak.');
 const summary=normalize(body.summary),before=bill.registerData?.partnerPackingSummaries?.[fileId];
 if(before?.sourceHash===sourceHash&&isDeepStrictEqual(before.summary,summary))return presented(bill,file,before.summary,sourceHash,{saved:true,mode:before.mode,sourceHeading:before.sourceHeading,reviewedAt:before.reviewedAt,reviewedByName:before.reviewedByName,warnings:before.warnings||[]});
 const derived=before?.sourceHash===sourceHash?before:await preview(tx,id,fileId),version=bill.version+1;
 const saved={sourceHash,summary,mode:derived.mode,sourceHeading:derived.sourceHeading||null,warnings:(derived.warnings||[]).slice(0,30),reviewedAt:new Date().toISOString(),reviewedById:user.id,reviewedByName:user.name||user.id};
 await tx.seaBill.update({where:{id},data:{registerData:{...bill.registerData,partnerPackingSummaries:{...bill.registerData?.partnerPackingSummaries,[fileId]:saved}},version:{increment:1}}});
 await audit(tx,user,'PARTNER_PACKING_SUMMARY_SAVED','JobOrder',bill.jobId,{seaBillId:id,fileId,sourceName:file.originalName,before:before?.summary||null,summary,sourceHash});
 return presented({...bill,version},file,summary,sourceHash,{saved:true,mode:saved.mode,sourceHeading:saved.sourceHeading,warnings:saved.warnings,reviewedAt:saved.reviewedAt,reviewedByName:saved.reviewedByName});
}
async function readSaved(tx,id,fileId){const {bill,file,sourceHash}=await owned(tx,id,fileId),saved=bill.registerData?.partnerPackingSummaries?.[fileId];fail(saved&&saved.sourceHash===sourceHash,'Periksa dan simpan ringkasan terbaru dahulu.',409);return presented(bill,file,saved.summary,sourceHash,{saved:true,reviewedAt:saved.reviewedAt,reviewedByName:saved.reviewedByName});}
function chunks(names){const result=[];let current=[],lines=0;for(const name of names){const n=Math.ceil(name.length/42);if(current.length&&lines+n>18){result.push(current);current=[];lines=0;}current.push(name);lines+=n;}if(current.length||!result.length)result.push(current);return result;}
const quantityText=quantities=>quantities.map(q=>`${q.quantity??'—'} ${q.unit}`).join('; ');
function wrappedLines(value,width){return String(value??'').split(/\r?\n/).flatMap(line=>line.length?Array.from({length:Math.ceil(line.length/width)},(_,i)=>line.slice(i*width,(i+1)*width)):['']);}
function lineParts(lines){return Array.from({length:Math.ceil(lines.length/18)},(_,i)=>lines.slice(i*18,(i+1)*18).join('\n'));}
async function workbook(data){
 const book=new ExcelJS.Workbook();book.creator='PT SCMU';const s=book.addWorksheet('Ringkasan PL Mitra',{pageSetup:{paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:.3,right:.3,top:.4,bottom:.4,header:.15,footer:.15}}});
 s.columns=[{width:6},{width:25},{width:47},{width:23},{width:30}];
 const band=(value,height=28)=>{const r=s.addRow([value]);s.mergeCells(r.number,1,r.number,5);r.height=Math.max(height,wrappedLines(value,110).length*14+10);r.font={bold:true};return r;};
 band('PT SCMU — RINGKASAN PACKING LIST MITRA');band('Sumber: '+data.sourceName);band(NOTICE,32);
 const h=data.header;band(`Mitra: ${h.partnerName||'—'} | Kapal: ${h.vesselName||'—'} | Voyage: ${h.voyageNumber||'—'} | B/L sumber: ${h.billNumber||'—'}`,45);
 band(`Berangkat: ${h.departureDate||'—'} | Tiba: ${h.arrivalDate||'—'} | Storage: ${h.storageDate||'—'} | Demurrage: ${h.demurrageDate||'—'}`,40);
 s.addRow(['No.','Kontainer / Segel','Penerima / Mark','Jumlah dan satuan','Catatan']).font={bold:true};s.pageSetup.printTitlesRow='1:6';
 if(data.scope?.type==='SHARED'){band('SUMBER BERSAMA — '+data.scope.billNumbers.filter(Boolean).join(', '));band('Total sumber, bukan total B/L. '+data.mappingWarning,45);s.pageSetup.printTitlesRow='1:8';}
 data.rows.forEach((row,index)=>{const recipients=chunks(row.recipients),notes=lineParts(wrappedLines(row.notes,27)),counts=lineParts(row.quantities.flatMap(q=>wrappedLines(quantityText([q]),20)));for(let part=0;part<Math.max(recipients.length,notes.length,counts.length);part++){const names=recipients[part]||[],note=notes[part]||'',count=counts[part]||(part?'Lanjutan':'—');const r=s.addRow([part?`${index+1} (lanjutan)`:index+1,[row.containerNumber||'—',row.sealNumber||'—'].join('\n'),names.join('\n')||(part?'Lanjutan':'—'),count,note]);r.height=Math.max(38,Math.min(280,Math.max(names.reduce((n,name)=>n+Math.ceil(name.length/42),0),note.split('\n').length,count.split('\n').length)*14+10));}});
 band('Total per satuan: '+(quantityText(data.totals)||'Belum dicatat'),36);band(`Diperiksa: ${data.reviewedByName||'—'} | ${data.reviewedAt||'—'}`,30);
 s.eachRow(row=>row.eachCell(cell=>{cell.alignment={vertical:'top',wrapText:true};cell.border={bottom:{style:'hair',color:{argb:'FFCBD5E1'}}};}));s.headerFooter.oddFooter='&LPT SCMU&C&P / &N';s.pageSetup.printArea=`A1:E${s.rowCount}`;
 return book;
}
module.exports={NOTICE,HEADER_KEYS,normalize,summarizeParsed,totals,chunks,preview,save,readSaved,workbook};

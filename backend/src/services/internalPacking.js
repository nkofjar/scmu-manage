const {createHash,randomUUID}=require('node:crypto');
const {Prisma}=require('@prisma/client');
const ExcelJS=require('exceljs');
const {fail,text,choice,integer,audit}=require('./jpt');
const {calendarDate}=require('./registerFields');
const workspace=require('./blWorkspace');
const CATEGORY='INTERNAL_PACKING_LIST';
const REPORT_CATEGORY='RECEIVING_REPORT';
const json=value=>JSON.parse(JSON.stringify(value));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const blankReport=()=>({status:'DRAFT',inspector:'',notes:'',sourceFileIds:[],groups:[]});
function normalizeReport(input,bill){
 fail(input&&typeof input==='object'&&!Array.isArray(input),'Isi rincian berita acara.');
 const status=choice(input.status||'DRAFT',['DRAFT','CONFIRMED'],'Status berita acara');
 fail(Array.isArray(input.sourceFileIds)&&input.sourceFileIds.length<=100&&input.sourceFileIds.every(id=>typeof id==='string'),'Pilih sumber berita acara yang valid.');
 const ids=[...new Set(input.sourceFileIds)];
 fail(ids.every(id=>bill.files.some(f=>f.id===id&&f.filename&&f.category===REPORT_CATEGORY&&f.externalNumber&&f.documentDate)),'Sumber harus berupa Berita Acara pada B/L ini, lengkap dengan nomor dan tanggal.');
 fail(Array.isArray(input.groups)&&input.groups.length<=200,'Isi maksimal 200 kelompok penerima.');
 const groups=input.groups.map((g,index)=>{
  fail(g&&typeof g==='object'&&!Array.isArray(g)&&Array.isArray(g.items)&&g.items.every(i=>i&&typeof i==='object'&&!Array.isArray(i)),'Isi kelompok penerima dan rincian barang yang valid.');
  if(status==='CONFIRMED'){
   fail(g.sourceFileId&&ids.includes(g.sourceFileId),'Pilih berkas sumber setiap penerima.');
   fail(g.dataLevel==='SUMMARY'||Array.isArray(g.items)&&g.items.length,'Berita acara harus memuat rincian barang, bukan hanya total kontainer.');
   fail(g.items.every(i=>i.packages!==''&&i.packages!=null),'Isi koli aktual setiap barang. Nol harus dinyatakan secara eksplisit.');
  }
  const result=workspace.packingGroup(g.dataLevel==='SUMMARY'?{...g,items:[]}:g,index,bill,ids,status==='CONFIRMED');
  result.items=result.items.map((item,i)=>{
   const raw=g.items[i];const optional=(value,label)=>value==null||value===''?null:integer(value,label,0,1000000);
   const expectedPackages=optional(raw.expectedPackages,'Koli menurut dokumen');
   const damagedPackages=optional(raw.damagedPackages,'Koli rusak');
   fail(damagedPackages==null||damagedPackages<=item.packages,'Koli rusak tidak boleh melebihi koli aktual.');
   return {...item,packages:status==='DRAFT'&&(raw.packages===''||raw.packages==null)?null:item.packages,expectedPackages,damagedPackages};
  });return result;
 });
 const inspector=text(input.inspector,'Petugas pemeriksa',200,status!=='CONFIRMED');
 if(status==='CONFIRMED')fail(ids.length&&groups.length,'Unggah berita acara dan isi rincian barang sebelum konfirmasi.');
 return {status,inspector,notes:text(input.notes,'Catatan berita acara',2000,true),sourceFileIds:ids,groups,...(input.comparisonBasis?{comparisonBasis:require('./packingSources').basis(input.comparisonBasis)}:{}),...(input.sourceIdentity?{sourceIdentity:require('./packingSources').sourceIdentity(input.sourceIdentity)}:{}),...(input.sourceHeading?{sourceHeading:text(input.sourceHeading,'Judul sumber',2000,true)}:{})};
}
function sourceSnapshot(bill,type,options={}){
 const sourceType=choice(type,['PARTNER_PL','RECEIVING_REPORT','MANUAL'],'Sumber PL internal');
 let packing=sourceType==='MANUAL'?require('./manualPacking').normalize(bill.registerData?.manualPacking||{status:'DRAFT',sourceFileIds:[],groups:[]},bill):sourceType==='PARTNER_PL'?workspace.operationalOf(bill).packing:normalizeReport(bill.registerData?.receivingReport||blankReport(),bill);
 fail((options.draft||packing.status==='CONFIRMED')&&packing.groups.length,'Periksa rincian sumber dan simpan dengan status dikonfirmasi sebelum membuat PL internal.',409);
 const category=sourceType==='MANUAL'?'SUPPORTING':sourceType==='PARTNER_PL'?'PACKING_LIST':REPORT_CATEGORY;
 const ids=packing.sourceFileIds;
 if(sourceType==='PARTNER_PL'&&bill.files.some(f=>ids.includes(f.id)&&f.scope?.type==='SHARED'))fail(packing.scopeConfirmed===true,'Konfirmasikan hanya bagian sumber bersama milik B/L ini sebelum membuat PL internal.',409);
 fail((sourceType==='MANUAL'||ids.length)&&ids.every(id=>bill.files.some(f=>f.id===id&&f.filename&&f.category===category)),'Pilih sumber sesuai jenisnya. PL internal tidak boleh dipakai sebagai sumber dirinya sendiri.');
 const groups=packing.groups.map((g,index)=>{
  fail((sourceType==='MANUAL'&&!g.sourceFileId||g.sourceFileId&&ids.includes(g.sourceFileId))&&(g.dataLevel==='SUMMARY'||g.items.length),'Setiap penerima harus mempunyai sumber dan rincian barang.');
  const normalized=workspace.packingGroup({...g,id:g.id||`source-group-${index}`,items:g.dataLevel==='SUMMARY'?[]:g.items.map((item,n)=>({...item,id:item.id||`source-item-${index}-${n}`}))},index,bill,ids,!options.draft);
  return {...normalized,items:normalized.items.map((item,i)=>({...item,expectedPackages:sourceType!=='RECEIVING_REPORT'?item.packages:g.items[i].expectedPackages??null,damagedPackages:sourceType!=='RECEIVING_REPORT'?null:g.items[i].damagedPackages??null}))};
 });
 fail(new Set(groups.map(g=>g.id)).size===groups.length&&groups.every(g=>new Set(g.items.map(i=>i.id)).size===g.items.length),'ID kelompok atau barang duplikat. Periksa sumber terlebih dahulu.');
 const sources=ids.map(id=>{const f=bill.files.find(f=>f.id===id);return {id:f.id,filename:f.filename,name:f.originalName,category:f.category,number:f.externalNumber||null,date:f.documentDate?new Date(f.documentDate).toISOString():null};});
 return {sourceType,sources,groups,inspector:sourceType==='RECEIVING_REPORT'?packing.inspector:null,notes:sourceType==='RECEIVING_REPORT'||sourceType==='MANUAL'?packing.notes:null,...(packing.comparisonBasis?{comparisonBasis:packing.comparisonBasis}:{}),...(packing.sourceIdentity?{sourceIdentity:packing.sourceIdentity}:{}),...(sourceType==='MANUAL'?{manual:{basis:packing.basis,recordedAt:bill.registerData.manualPacking.recordedAt,recordedById:bill.registerData.manualPacking.recordedById,recordedByName:bill.registerData.manualPacking.recordedByName}}:{})};
}
function fingerprint(bill,source){return hash({billId:bill.id,source});}
function ready(bill){
 const meta=bill.registerData?.internalPackingList;
 if(!meta)return Boolean(bill.files?.some(f=>f.filename&&f.category===CATEGORY));
 if(!bill.files?.some(f=>f.filename===meta.filename&&f.category===CATEGORY))return false;
 if(meta.sourceType==='UPLOADED')return true;
 try{return meta.fingerprint===fingerprint(bill,sourceSnapshot(bill,meta.sourceType));}catch{return false;}
}
function currentSource(bill){const meta=bill.registerData?.internalPackingList;return meta&&meta.sourceType!=='UPLOADED'&&ready(bill)?sourceSnapshot(bill,meta.sourceType):null;}
async function invalidateHeaders(tx,user,bill){
 const file=bill.files?.find(f=>f.category==='PACKING_HEADER');if(!file)return;
 const shared=await tx.seaBillFile.findMany({where:{category:'PACKING_HEADER',filename:file.filename,billId:{not:bill.id}},select:{billId:true}});
 for(const id of [...new Set(shared.map(f=>f.billId))].sort()){
  const other=await require('./blRegister').get(tx,id);if(other.files.find(f=>f.category==='PACKING_HEADER')?.filename!==file.filename)continue;
  const operational=workspace.operationalOf(other);if(operational.packing.headerStatus==='DRAFT')continue;
  operational.packing.headerStatus='DRAFT';await tx.seaBill.update({where:{id},data:{registerData:json({...other.registerData,operational}),version:{increment:1}}});
  await audit(tx,user,'PACKING_HEADER_SOURCE_CHANGED','JobOrder',other.jobId,{seaBillId:id,sourceBillId:bill.id});
 }
}
async function saveReport(tx,user,id,body){
 const bill=await require('./blRegister').get(tx,id);await require('./seaBills').getBill(tx,bill.jobId,id,integer(body.version,'Version'));
 fail(!bill.archivedAt&&!bill.registerData?.archivedAt,'B/L diarsipkan: hanya baca.',409);
 const report=normalizeReport(body.report,bill);const operational=workspace.operationalOf(bill);
 if(!require('node:util').isDeepStrictEqual(report,bill.registerData?.receivingReport)){operational.packing.headerStatus='DRAFT';await invalidateHeaders(tx,user,bill);}
 await tx.seaBill.update({where:{id},data:{registerData:json({...bill.registerData,workflowVersion:2,receivingReport:report,operational}),version:{increment:1}}});
 await audit(tx,user,'RECEIVING_REPORT_SAVED','JobOrder',bill.jobId,{seaBillId:id,report});
 return require('./blRegister').present(await require('./blRegister').get(tx,id));
}
function snapshot(bill,type,documentNumber,options={}){
 const source=sourceSnapshot(bill,type,options);const items=source.groups.flatMap(g=>g.items);
 const detailed=source.groups.every(g=>g.dataLevel!=='SUMMARY');
 const volumeCbm=items.length&&detailed&&items.every(i=>i.volumeCbm!=null)?items.reduce((n,i)=>n.plus(i.volumeCbm),new Prisma.Decimal(0)).toFixed(4):null;
 const warnings=[];if(volumeCbm==null)warnings.push('CBM belum lengkap. Kolom kosong tidak dianggap nol.');
 if(source.groups.some(g=>g.dataLevel==='SUMMARY'))warnings.push('Sebagian sumber hanya memuat ringkasan. Lembar pemeriksaan tidak dianggap sebagai rincian barang lengkap.');
 const discrepancies=items.filter(i=>source.sourceType==='RECEIVING_REPORT'&&(i.expectedPackages!=null&&i.expectedPackages!==i.packages||i.damagedPackages>0));
 if(discrepancies.length)warnings.push('Terdapat selisih atau kerusakan menurut berita acara. Jumlah dokumen asal tetap disimpan terpisah dari jumlah aktual.');
 const totalsByUnit={};for(const g of source.groups){const entries=g.dataLevel==='SUMMARY'?[{packages:g.summaryPackages,packageUnit:g.packageUnit}]:g.items;for(const i of entries){const unit=i.packageUnit||'KOLI';totalsByUnit[unit]=i.packages==null||totalsByUnit[unit]===null?null:(totalsByUnit[unit]||0)+i.packages;}}
 return {schema:2,documentNumber:text(documentNumber??`PL-SCMU-${new Date().getUTCFullYear()}-${randomUUID().slice(0,8).toUpperCase()}`,'Nomor PL internal',100),billId:bill.id,version:bill.version,billNumber:source.sourceIdentity?.billNumber||bill.billNumber,vesselName:source.sourceIdentity?.vesselName||bill.vesselName,voyageNumber:source.sourceIdentity?.voyageNumber||bill.voyageNumber,shipperName:bill.shipperName,consigneeName:bill.consigneeName,portOfLoading:bill.portOfLoading,portOfDischarge:bill.portOfDischarge,generatedAt:new Date().toISOString(),fingerprint:fingerprint(bill,source),...source,totals:{packages:Object.keys(totalsByUnit).length===1?Object.values(totalsByUnit)[0]:null,byUnit:totalsByUnit,volumeCbm,items:items.length,recipients:source.groups.length},warnings};
}
async function read(tx,id,body){
 const bill=await require('./blRegister').get(tx,id);await require('./seaBills').getBill(tx,bill.jobId,id,integer(body.version,'Version'));fail(!bill.archivedAt&&!bill.registerData?.archivedAt,'B/L diarsipkan: hanya baca.',409);
 let data;
 if(body.sourceType==='BL_DRAFT')data={schema:2,draft:true,documentNumber:'DRAF-'+bill.billNumber,billId:id,version:bill.version,billNumber:bill.billNumber,vesselName:bill.vesselName,voyageNumber:bill.voyageNumber,portOfLoading:bill.portOfLoading,portOfDischarge:bill.portOfDischarge,generatedAt:new Date().toISOString(),sourceType:'BL_DRAFT',sources:[],groups:[],totals:{packages:null,byUnit:{},volumeCbm:null},warnings:['Draf identitas kontainer dari B/L. Rincian barang belum tersedia dan belum menjadi PL internal terkonfirmasi.']};
 else {
  const draft=body.draft===true;
  data=snapshot(bill,body.sourceType,body.documentNumber,{draft});
  if(draft){data.draft=true;data.draftReason='DRAF SUMBER PACKING LIST';data.documentNumber='DRAF-'+data.documentNumber;data.warnings=[data.draftReason,...data.warnings.filter(w=>!w.startsWith('Kontainer ')&&!w.startsWith('Segel '))];}
 }
 data.identityBasis='SOURCE';
 data.containers=data.groups.length?[...new Map(data.groups.map(g=>[JSON.stringify([g.containerNumber,g.sealNumber||null]),{number:g.containerNumber,seal:g.sealNumber||null}])).values()]:bill.containers.map(c=>({number:c.number,seal:c.seal||null}));
 data.departureDate=bill.registerData?.register?.departureDate||null;data.arrivalDate=bill.registerData?.register?.arrivalDate||null;
 data.storageUntil=workspace.operationalOf(bill).deadlines.storageUntil;data.demurrageFrom=workspace.operationalOf(bill).deadlines.demurrageFrom;
 if(body.outputMode!==undefined)data.outputMode=choice(body.outputMode,['SUMMARY','CHECKLIST','BOTH'],'Bentuk cetak');
 if(data.sourceType!=='BL_DRAFT')try{data.inspection=require('./packingFieldChecks').currentInspection(bill,body.sourceType);}catch{/* Incomplete source remains printable as a draft. */}

 return {bill,data};
}
async function workbook(data){
 if(data.outputMode)return require('./packingFieldOutput').workbook(data);
 const book=new ExcelJS.Workbook();book.creator='PT SCMU';book.created=new Date(data.generatedAt);
 const sheet=book.addWorksheet('Packing List SCMU',{pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:.25,right:.25,top:.4,bottom:.4,header:.15,footer:.15}}});
 sheet.columns=[6,25,16,16,44,12,12,12,12,13,13,13,13].map(width=>({width}));
 const band=(text,color='FFE8F0FA')=>{const r=sheet.addRow([text]);sheet.mergeCells(r.number,1,r.number,13);r.height=Math.max(26,Math.ceil(String(text).length/140)*15);r.getCell(1).font={bold:true};r.getCell(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:color}};return r;};
 band('PT SCMU — PACKING LIST INTERNAL');band(`${data.documentNumber} | B/L ${data.billNumber||'Belum tersedia'}`);band(`${data.vesselName||'—'} / ${data.voyageNumber||'—'} | ${data.portOfLoading||'—'} → ${data.portOfDischarge||'—'}`);
 band('Dasar: '+(data.sourceType==='MANUAL'?'Input manual':data.sourceType==='PARTNER_PL'?'Packing List mitra':'Berita Acara (rincian aktual)')+' | '+data.sources.map(s=>(s.number||s.name)+(s.date?' / '+s.date.slice(0,10):'')).join('; '));
 if(data.manual)band(`Dasar pencatatan: ${data.manual.basis} | Dicatat oleh: ${data.manual.recordedByName||data.manual.recordedById||'—'} | ${data.manual.recordedAt||'—'}`);
 if(data.inspector)band('Petugas pemeriksa: '+data.inspector);
 sheet.pageSetup.printTitlesRow=`1:${sheet.rowCount}`;
 let index=0;for(const group of data.groups){band(`Kontainer ${group.containerNumber} / Segel ${group.sealNumber||'—'} | Penerima / mark: ${group.recipientName}`);band(`Alamat: ${group.recipientAddress||'—'} | Telepon: ${group.recipientPhone||'—'}`,'FFF5F8FC');
  sheet.addRow(['No.','Tanggal sumber','Toko','Mark','Nama barang','Koli dokumen',data.sourceType==='RECEIVING_REPORT'?'Koli aktual':'Koli PL','Rusak','Selisih','P (cm)','L (cm)','T (cm)','CBM']).font={bold:true};
  for(const item of group.items){const actual=data.sourceType==='RECEIVING_REPORT';const r=sheet.addRow([++index,item.itemDateText||item.itemDate?.slice(0,10)||null,item.shop,item.marks,item.description,item.expectedPackages,item.packages,item.damagedPackages,actual&&item.expectedPackages!=null?item.packages-item.expectedPackages:null,item.lengthCm==null?null:Number(item.lengthCm),item.widthCm==null?null:Number(item.widthCm),item.heightCm==null?null:Number(item.heightCm),item.volumeCbm==null?null:Number(item.volumeCbm)]);r.height=Math.max(32,Math.min(409,Math.ceil((item.description||'').length/35)*15));}
  const its=group.items;band(`Subtotal koli: ${its.reduce((n,i)=>n+i.packages,0)} | CBM: ${its.every(i=>i.volumeCbm!=null)?its.reduce((n,i)=>n.plus(i.volumeCbm),new Prisma.Decimal(0)).toFixed(4):'Belum lengkap'}${group.notes?' | Catatan: '+group.notes:''}`);
 }
 band(`TOTAL KOLI: ${data.totals.packages} | CBM: ${data.totals.volumeCbm??'Belum lengkap'}`);for(const warning of data.warnings)band(warning,'FFFFF4DB');if(data.notes)band('Catatan berita acara: '+data.notes);
 sheet.eachRow(r=>r.eachCell(c=>{c.alignment={wrapText:true,vertical:'top'};c.border={bottom:{style:'hair',color:{argb:'FFCBD5E1'}}};}));sheet.pageSetup.printArea=`A1:M${sheet.rowCount}`;
 const detail=book.addWorksheet('Rincian dan sumber');detail.columns=['Kontainer','Penerima','Barang','Koli dokumen','Koli PL / aktual','Rusak','CBM','ID sumber','Nama sumber','Nomor sumber','Tanggal sumber','Sheet','Baris'].map((header,i)=>({header,width:[1,2,8].includes(i)?40:23}));
 for(const g of data.groups)for(const i of g.items){const s=data.sources.find(s=>s.id===g.sourceFileId);detail.addRow([g.containerNumber,g.recipientName,i.description,i.expectedPackages,i.packages,i.damagedPackages,i.volumeCbm==null?null:Number(i.volumeCbm),s?.id,s?.name,s?.number,s?.date?.slice(0,10),i.sourceSheet,i.sourceRow]);}detail.getRow(1).font={bold:true};detail.views=[{state:'frozen',ySplit:1}];return book;
}
async function save(tx,user,id,body,file,expected){
 fail(body.confirmed===true,'Periksa dan konfirmasi PL internal.');const {bill,data}=await read(tx,id,body);
 fail(!data.draft,'Draf B/L hanya untuk cetak pemeriksaan, bukan PL internal terkonfirmasi.');
 fail(data.fingerprint===expected.fingerprint,'Sumber berubah. Buat pratinjau ulang.',409);fail(!data.warnings.length||body.acceptWarnings===true,'Periksa dan terima catatan pemeriksaan.');
 const row=await tx.seaBillFile.create({data:{billId:id,category:CATEGORY,contentVersion:bill.contentVersion,...file,uploadedById:user.id,note:`${data.documentNumber}; dasar ${data.sourceType==='MANUAL'?'Input manual':data.sourceType==='PARTNER_PL'?'PL mitra':'Berita Acara'}: ${data.manual?.basis||data.sources.map(s=>s.number||s.name).join('; ')}`.slice(0,2000)}});
 const operational=workspace.operationalOf(bill);operational.packing.headerStatus='DRAFT';await invalidateHeaders(tx,user,bill);
 await tx.seaBill.update({where:{id},data:{registerData:json({...bill.registerData,operational,internalPackingList:{filename:row.filename,number:data.documentNumber,sourceType:data.sourceType,sourceFileIds:data.sources.map(s=>s.id),fingerprint:data.fingerprint,generatedAt:data.generatedAt,generatedById:user.id}}),version:{increment:1}}});
 await audit(tx,user,'INTERNAL_PACKING_LIST_CREATED','JobOrder',bill.jobId,{seaBillId:id,fileId:row.id,snapshot:expected});return row;
}
module.exports={CATEGORY,REPORT_CATEGORY,blankReport,normalizeReport,sourceSnapshot,fingerprint,ready,currentSource,saveReport,invalidateHeaders,snapshot,read,workbook,save};

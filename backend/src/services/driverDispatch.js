const {randomUUID,createHash}=require('node:crypto');
const {fail,integer,choice,audit}=require('./jpt');
const scoped=require('./billDriverOperations'),operations=require('./driverOperations');
const deliveries=require('./driverDeliveries');
function sourceKey(work,type,date,container){const fields=['id','billId','containerNumber','size','driverId','driverName','vehicleId','vehicleNumber','origin','destination','routeId','routeSnapshot','rateType','instructions','items','deliveries','compliance','receivedDate','receiptReference','evidenceFileIds'];return createHash('sha256').update(JSON.stringify({documentType:type,taskDate:date,seal:container.seal||null,work:Object.fromEntries(fields.map(k=>[k,work[k]??null]))})).digest('hex');}
function requestKey(body){integer(body.version,'Versi');return createHash('sha256').update(JSON.stringify({version:body.version,documentType:body.documentType,taskDate:body.taskDate||null})).digest('hex');}
function taskDate(value){fail(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Isi tanggal tugas yang valid.');return value;}
function scopedSnapshot(snapshot,ctx){const result=structuredClone(snapshot);if(!ctx.aggregate){const allowed=new Set((ctx.bill.files||[]).map(f=>f.id));result.evidenceFileIds=(result.evidenceFileIds||[]).filter(id=>allowed.has(id));for(const d of result.deliveries||[])d.evidenceFileIds=d.billId===ctx.bill.id?(d.evidenceFileIds||[]).filter(id=>allowed.has(id)):[];}return result;}
async function issueBill(tx,user,billId,workId,body,journeyContext=null){
 fail(require('./jpt').STAFF.includes(user?.role),'Hanya staf internal dapat menerbitkan surat tugas.',403);
 const documentType=choice(body.documentType,['TRANSPORT_ORDER','DELIVERY_NOTE','BONRATE'],'Jenis dokumen'),token=requestKey(body);
 const ctx=journeyContext||await scoped.context(tx,billId),work=journeyContext?operations.state(ctx.parent).works.find(w=>w.id===workId):scoped.selectedWork(ctx,workId);
 fail(work,'Bonrate tidak ditemukan.',404);
 const postDelivery=work.recordingPolicy==='POST_DELIVERY';
 if(!postDelivery)fail(body.confirmed===true,'Konfirmasikan penerbitan dokumen.');
 fail(postDelivery?documentType==='BONRATE':documentType!=='BONRATE','Jenis dokumen tidak sesuai kebijakan pencatatan pekerjaan.',409);
 if(postDelivery){
  const issued=(work.dispatches||[]).find(d=>d.documentType==='BONRATE');if(issued)return scopedSnapshot(issued,ctx);
  fail(['DRAFT','SUBMITTED','VERIFIED','REJECTED'].includes(work.status),'Pekerjaan dibatalkan tidak dapat diterbitkan.',409);
  fail(!work.payrollId,'Pekerjaan sudah dikunci dalam rekap upah.',409);
  operations.ready(work);
 }
 const repeated=(work.dispatches||[]).find(d=>d.requestKey===token);if(repeated)return scopedSnapshot(repeated,ctx);
 const primary=ctx.parent.bills.find(b=>b.id===work.billId)||ctx.bill;
 const container=scoped.assertContainerIdentity(primary,ctx.parent,work.containerNumber||work.containerKey);
 const date=postDelivery?work.receivedDate:taskDate(body.taskDate||work.taskDate),sourceSignature=sourceKey(work,documentType,date,container);
 const identical=(work.dispatches||[]).find(d=>d.sourceSignature===sourceSignature);if(identical)return scopedSnapshot(identical,ctx);
 if(ctx.aggregate)require('./journeys').mutable(ctx.parent,integer(body.version,'Versi'));else await scoped.writable(tx,user,billId,body.version);
 deliveries.assertMutableSources(ctx.parent,work);
 fail(work.status!=='CANCELLED','Pekerjaan dibatalkan tidak dapat diterbitkan.',409);
 scoped.currentWorkContainer(primary,work);
 fail(work.driverName&&work.vehicleNumber&&(work.destination||deliveries.hasChildren(work))&&work.containerNumber&&work.size,'Lengkapi kontainer, sopir, plat dan rute sebelum menerbitkan surat tugas.');
 if(deliveries.hasChildren(work))deliveries.validate(ctx.parent,work);
 const company=await require('./access').internalCompany(tx);
 const id=randomUUID(),createdAt=new Date().toISOString();
 const snapshot={id,requestKey:token,documentType,number:`${documentType==='TRANSPORT_ORDER'?'ST':'SJ'}-${date.slice(0,4)}-${id.slice(0,8).toUpperCase()}`,taskDate:date,createdAt,createdById:user.id,journeyId:ctx.parent.id,journeyNumber:ctx.parent.number,billId,billNumber:ctx.bill.billNumber||null,workId,workNumber:work.number||null,driverId:work.driverId||null,driverName:work.driverName,driverEmploymentType:work.driverEmploymentType||null,driverCompanyId:work.driverCompanyId||null,driverCompanyName:work.driverCompanyName||null,vehicleId:work.vehicleId||null,vehicleNumber:work.vehicleNumber,vehicleOwnershipType:work.vehicleOwnershipType||null,vehicleCompanyId:work.vehicleCompanyId||null,vehicleCompanyName:work.vehicleCompanyName||null,vesselName:ctx.parent.vesselName||ctx.bill.vesselName||null,voyageNumber:ctx.parent.voyageNumber||ctx.bill.voyageNumber||null,containerNumber:work.containerNumber,size:String(work.size),seal:container.seal||null,origin:work.origin,destination:work.destination,rateType:work.rateType,instructions:work.instructions||null,items:structuredClone(work.items||[]),company:{id:company.id,name:company.name,address:company.address||null,phone:company.phone||null,email:company.email||null}};
 snapshot.recordingPolicy=work.recordingPolicy||null;
 snapshot.issuer={id:user.id,name:user.name||null,role:user.role};snapshot.source={journeyId:ctx.parent.id,journeyVersion:ctx.parent.version,billId,billVersion:ctx.bill.version,workId};snapshot.compliance=structuredClone(work.compliance||{});snapshot.evidenceFileIds=structuredClone(work.evidenceFileIds||[]);snapshot.receiptReference=work.receiptReference||null;snapshot.receivedDate=work.receivedDate||null;
 snapshot.sourceSignature=sourceSignature;snapshot.billId=work.billId||billId;snapshot.billNumber=ctx.parent.bills.find(b=>b.id===snapshot.billId)?.billNumber||null;snapshot.billIds=deliveries.billIds(work).length?deliveries.billIds(work):[billId];snapshot.routeId=work.routeId||null;snapshot.routeSnapshot=structuredClone(work.routeSnapshot||null);
 snapshot.deliveries=(work.deliveries||[]).map(d=>({...structuredClone(d),billNumber:ctx.parent.bills.find(b=>b.id===d.billId)?.billNumber||null}));
 const bytes=await renderPdf(snapshot);snapshot.pdfBase64=bytes.toString('base64');snapshot.pdfSha256=createHash('sha256').update(bytes).digest('hex');snapshot.pdfSize=bytes.length;
 const ops=operations.state(ctx.parent),saved=ops.works.find(w=>w.id===workId);fail((saved.dispatches||[]).length<100,'Maksimal 100 revisi surat tugas per pekerjaan.',409);saved.billId=saved.billId||billId;saved.dispatches=[...(saved.dispatches||[]),snapshot];if(postDelivery)saved.bonrateIssued=true;
 await tx.shippingJourney.update({where:{id:ctx.parent.id},data:{data:{...ctx.parent.data,driverOperations:ops},version:{increment:1}}});
 await audit(tx,user,'DRIVER_DISPATCH_ISSUED','ShippingJourney',ctx.parent.id,{seaBillId:billId,workId,dispatchId:id,number:snapshot.number});return scopedSnapshot(snapshot,ctx);
}
async function listBill(tx,billId,workId){const ctx=await scoped.context(tx,billId),work=operations.state(ctx.parent).works.find(w=>w.id===workId);const history=(work?.dispatches||[]).filter(d=>d.workId===workId&&(d.billId===billId||d.billIds?.includes(billId)));fail(work&&(ctx.owns(work)||history.length),'Bonrate tidak ditemukan pada B/L ini.',404);return {data:history.map(d=>scopedSnapshot(d,ctx))};}
async function getBill(tx,billId,workId,dispatchId){const result=await listBill(tx,billId,workId),snapshot=result.data.find(d=>d.id===dispatchId&&(d.billId===billId||d.billIds?.includes(billId))&&d.workId===workId);fail(snapshot,'Surat tugas tidak ditemukan pada pekerjaan B/L ini.',404);return snapshot;}
function pdf(snapshot){fail(snapshot.pdfBase64,'Berkas PDF tersimpan tidak tersedia.',409);const bytes=Buffer.from(snapshot.pdfBase64,'base64');fail(createHash('sha256').update(bytes).digest('hex')===snapshot.pdfSha256,'Integritas PDF tersimpan tidak sesuai.',409);return bytes;}
async function renderPdf(snapshot){
 if(snapshot.documentType==='BONRATE')return require('./bonratePdf').renderBonratePdf(snapshot);
 const PDFDocument=require('pdfkit'),doc=new PDFDocument({size:'A4',margin:48,info:{Title:snapshot.number,Author:snapshot.company.name,CreationDate:new Date(snapshot.createdAt),ModDate:new Date(snapshot.createdAt)}});
 const chunks=[],done=new Promise((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 doc.fontSize(16).text(snapshot.company.name);doc.fontSize(10);for(const field of ['address','phone','email'])if(snapshot.company[field])doc.text(snapshot.company[field]);
 const bonrate=snapshot.documentType==='BONRATE';doc.moveDown().fontSize(15).text(bonrate?'SURAT JALAN MOBIL':snapshot.documentType==='TRANSPORT_ORDER'?'SURAT TUGAS ANGKUTAN':'SURAT JALAN');if(bonrate)doc.fontSize(13).text(`BONRATE ${snapshot.rateType}`);doc.fontSize(10).text(snapshot.number).moveDown();
 const rows=[[bonrate?'Tanggal selesai':'Tanggal tugas',bonrate?snapshot.receivedDate:snapshot.taskDate],['Bonrate',snapshot.workNumber],['B/L',snapshot.billNumber],['Pengiriman',snapshot.journeyNumber],['Kapal',snapshot.vesselName],['Voyage',snapshot.voyageNumber],['Sopir',snapshot.driverName],['Perusahaan sopir',snapshot.driverCompanyName],['Kendaraan',snapshot.vehicleNumber],['Perusahaan kendaraan',snapshot.vehicleCompanyName],['Kontainer',snapshot.containerNumber],['Ukuran (ft)',snapshot.size],['Segel',snapshot.seal],['Asal',snapshot.origin],['Tujuan',snapshot.destination],['Jenis angkutan',snapshot.rateType],['Instruksi',snapshot.instructions]];
 for(const [label,value]of rows)if(value!=null&&value!=='')doc.text(`${label}: ${value}`,{lineGap:3});
 if(snapshot.items?.length&&!snapshot.deliveries?.length){doc.moveDown().fontSize(12).text('Rincian barang');doc.fontSize(10);snapshot.items.forEach((item,index)=>doc.text([`${index+1}.`,item.owner,item.collyCount,item.collyType,item.goodsType].filter(v=>v!=null&&v!=='').join(' '),{lineGap:3}));}
 for(const [index,child]of (snapshot.deliveries||[]).entries()){
  doc.moveDown().fontSize(12).text(`Pengantaran ${index+1}`);doc.fontSize(10);
  for(const [label,value]of [['B/L',child.billNumber],['Kontainer',child.containerNumber],['Penerima',child.recipient],['Tujuan',child.destination],['Tanggal diterima',child.receivedDate],['Nomor bukti serah terima',child.receiptReference],['Referensi lampiran bukti',(child.evidenceFileIds||[]).join(', ')]])if(value)doc.text(`${label}: ${value}`,{lineGap:3});
  for(const item of child.items||[])doc.text([item.owner,item.collyCount,item.collyType,item.goodsType,item.packageWeightKg==null?null:`${item.packageWeightKg} kg/kemasan`].filter(v=>v!=null&&v!=='').join(' '),{lineGap:3});
 }
 if(doc.y>doc.page.height-doc.page.margins.bottom-115)doc.addPage();
 const top=doc.y+24,width=(doc.page.width-doc.page.margins.left-doc.page.margins.right)/3;
 for(const [index,label]of ['SCMU','Sopir','Penerima'].entries()){const left=doc.page.margins.left+index*width;doc.fontSize(10).text(label,left,top,{width,align:'center'});doc.moveTo(left+15,top+65).lineTo(left+width-15,top+65).stroke();}
 doc.end();return done;
}
async function issueJourney(tx,user,journeyId,workId,body){
 const parent=await require('./journeys').get(tx,journeyId),work=operations.state(parent).works.find(w=>w.id===workId);fail(work,'Bonrate tidak ditemukan.',404);
 const bill=parent.bills.find(b=>b.id===work.billId);fail(bill,'B/L utama pekerjaan tidak ditemukan.',409);
 return issueBill(tx,user,bill.id,workId,body,{parent,bill,aggregate:true});
}
async function listJourney(tx,journeyId,workId){const parent=await require('./journeys').get(tx,journeyId),work=operations.state(parent).works.find(w=>w.id===workId);fail(work,'Bonrate tidak ditemukan.',404);return {data:structuredClone((work.dispatches||[]).filter(d=>d.workId===workId&&d.journeyId===journeyId))};}
async function getJourney(tx,journeyId,workId,dispatchId){const result=await listJourney(tx,journeyId,workId),snapshot=result.data.find(d=>d.id===dispatchId);fail(snapshot,'Dokumen tidak ditemukan pada pekerjaan ini.',404);return snapshot;}
module.exports={issueBill,listBill,getBill,issueJourney,listJourney,getJourney,pdf};

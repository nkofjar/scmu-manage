const {fail}=require('./jpt');
const register=require('./blRegister'),journeys=require('./journeys'),operations=require('./driverOperations');
const {key}=require('./driverTariffs'),{isTrashed}=require('./registerLifecycle');
async function context(tx,id){
 const bill=await register.get(tx,id);fail(bill.journeyId,'B/L belum terhubung ke pengiriman kapal.',409);
 const parent=await journeys.get(tx,bill.journeyId);
 fail(parent.bills.some(b=>b.id===id&&!isTrashed(b)),'B/L tidak tersedia pada pengiriman ini.',404);
 const active=parent.bills.filter(b=>!isTrashed(b)),containers=register.normalize({},bill).containers;
 const owns=work=>require('./driverDeliveries').billIds(work).includes(id)?true:work.billId?false:!!work.containerKey&&active.filter(b=>register.normalize({},b).containers.some(c=>key(c.number)===key(work.containerNumber||work.containerKey))).map(b=>b.id).join()===id;
 return {bill,parent,containers,owns};
}
function receiptFiles(bill){return (bill.files||[]).filter(f=>f.filename&&['DELIVERY_RECEIPT','POD'].includes(f.category));}
function assertContainerIdentity(bill,parent,containerNumber){
 const selected=register.normalize({},bill).containers.find(c=>key(c.number)===key(containerNumber));
 fail(selected,'Pilih kontainer pada B/L ini.');
 const matches=parent.bills.filter(b=>!isTrashed(b)).flatMap(b=>register.normalize({},b).containers).filter(c=>key(c.number)===key(selected.number));
 fail(matches.every(c=>String(c.size||'')===String(selected.size||'')&&key(c.seal)===key(selected.seal)),'Ukuran atau segel kontainer berbeda antar B/L. Perbaiki identitas sumber terlebih dahulu.',409);
 return selected;
}
// The aggregate helper is private; check the persisted identity against this B/L,
// never normalize it first (normalization would overwrite a stale stored size).
function currentWorkContainer(bill,work){
 const current=register.normalize({},bill).containers.find(c=>key(c.number)===work.containerKey);
 fail(current&&String(current.size)===String(work.size),'Identitas atau ukuran kontainer pada B/L berubah. Periksa pekerjaan.',409);
 fail(!work.billId||work.billId===bill.id,'B/L yang dipilih tidak lagi memuat kontainer pekerjaan ini.',409);
 return current;
}
function projectWork(bill,parent,work){
 const allowed=new Set(receiptFiles(bill).map(f=>f.id));
 const delivery=require('./driverDeliveries');
 if(delivery.hasChildren(work)){
  const children=work.deliveries.filter(d=>d.billId===bill.id).map(d=>({...structuredClone(d),evidenceFileIds:(d.evidenceFileIds||[]).filter(id=>allowed.has(id))}));
  const sharedWork=delivery.billIds(work).some(id=>id!==bill.id);
  const safe=['recordingPolicy','id','number','status','driverId','driverName','vehicleId','vehicleNumber','rateType','taskDate','createdAt','updatedAt','verifiedAt','receivedDate'];
  const result={...Object.fromEntries(safe.filter(k=>work[k]!==undefined).map(k=>[k,work[k]])),bonrateIssued:operations.bonrateIssued(work),billId:work.billId,sharedWork,readOnly:sharedWork,deliveries:children,evidenceFileIds:[...new Set(children.flatMap(d=>d.evidenceFileIds))],items:children.flatMap(d=>d.items),containerNumber:children[0]?.containerNumber||null,destination:children.map(d=>d.destination).filter(Boolean).join('; ')};
  result.evidenceStatus=['SUBMITTED','VERIFIED'].includes(work.status)||work.payrollId?'IN_BON':result.evidenceFileIds.length?'UPLOADED':'MISSING';
  if(!sharedWork){result.containerNumber=work.containerNumber;result.routeId=work.routeId||null;result.routeSnapshot=structuredClone(work.routeSnapshot||null);result.origin=work.origin||null;result.size=work.size;result.containerKey=work.containerKey;if(['DRAFT','REJECTED'].includes(work.status)&&!work.payrollId)try{delivery.validate(parent,work);operations.ready(work);result.evidenceStatus='READY';}catch(error){if(![409,422].includes(error.status))throw error;}}
  return result;
 }
 const fields=['recordingPolicy','driverId','vehicleId','driverEmploymentType','vehicleOwnershipType','driverCompanyId','vehicleCompanyId','driverCompanyName','vehicleCompanyName','taskDate','instructions','dispatches','id','number','status','containerNumber','containerKey','size','driverName','vehicleNumber','origin','destination','rateType','receivedDate','receiptReference','items','notes','reason','createdAt','updatedAt','verifiedAt','payrollId'];
 const result={...Object.fromEntries(fields.filter(k=>work[k]!==undefined).map(k=>[k,work[k]])),bonrateIssued:operations.bonrateIssued(work),billId:bill.id,evidenceFileIds:(work.evidenceFileIds||[]).filter(fileId=>allowed.has(fileId))};
 result.evidenceStatus=['SUBMITTED','VERIFIED'].includes(work.status)||work.payrollId?'IN_BON':result.evidenceFileIds.length?'UPLOADED':'MISSING';
 if(['DRAFT','REJECTED'].includes(work.status)&&result.evidenceFileIds.length){try{assertEvidence(bill,work.evidenceFileIds);assertContainerIdentity(bill,parent,work.containerNumber||work.containerKey);currentWorkContainer(bill,work);operations.ready(work);operations.normalizeWork(work,{...parent,files:[],bills:[bill]},work);result.evidenceStatus='READY';}catch(error){if(![409,422].includes(error.status))throw error;}}
 return result;
}
async function list(tx,id){
 const {bill,parent,containers,owns}=await context(tx,id),ops=operations.state(parent);
 const files=receiptFiles(bill).map(f=>({id:f.id,evidenceId:f.id,category:f.category,originalName:f.originalName,mimeType:f.mimeType,size:f.size,source:'BILL',endpoint:`/bl-register/${id}/files/${f.id}`}));
 const works=ops.works.filter(owns).map(work=>projectWork(bill,parent,work));
 return {journeyId:parent.id,version:parent.version,billVersion:bill.version,readOnly:!!(parent.archivedAt||parent.deletedAt||bill.archivedAt||bill.registerData?.archivedAt||isTrashed(bill)),works,containers:containers.map(c=>({number:c.number,size:c.size,seal:c.seal,billIds:[id]})),files,mappingRequired:ops.works.some(w=>!w.billId&&!owns(w)&&containers.some(c=>key(c.number)===key(w.containerNumber||w.containerKey)))};
}
async function writable(tx,user,id,version){
 fail(require('./jpt').STAFF.includes(user?.role),'Hanya staf internal yang dapat mencatat bonrate.',403);
 const ctx=await context(tx,id);journeys.mutable(ctx.parent,require('./jpt').integer(version,'Versi'));
 fail(!ctx.bill.archivedAt&&!ctx.bill.registerData?.archivedAt&&!isTrashed(ctx.bill),'B/L di arsip/Sampah hanya dapat dibaca.',409);return ctx;
}
function selectedWork(ctx,workId){const work=operations.state(ctx.parent).works.find(w=>w.id===workId);fail(work&&ctx.owns(work),'Bonrate tidak ditemukan pada B/L ini.',404);return work;}
function assertEvidence(bill,ids){fail(Array.isArray(ids)&&ids.every(id=>(bill.files||[]).some(f=>f.id===id&&f.filename&&['DELIVERY_RECEIPT','POD'].includes(f.category))),'Pilih bukti serah terima pada B/L ini.');}
async function saveWork(tx,user,id,workId,body){
 const ctx=await writable(tx,user,id,body.version),before=workId?selectedWork(ctx,workId):null,input=body.work;
 fail(!before||!require('./driverDeliveries').billIds(before).some(b=>b!==id),'Pekerjaan bersama harus diubah melalui pengiriman.',409);
 fail(input&&typeof input==='object','Isi pekerjaan angkut.');fail(!input.billId||input.billId===id,'Pekerjaan harus tetap pada B/L ini.');
 fail(!input.deliveries?.some(d=>d.billId!==id),'Pengantaran lintas B/L harus dicatat melalui pengiriman.',409);
 assertContainerIdentity(ctx.bill,ctx.parent,input.containerNumber);
 if(!input.deliveries&&!before?.deliveries)assertEvidence(ctx.bill,input.evidenceFileIds??before?.evidenceFileIds??[]);
 const saved=await operations.saveWork(tx,user,ctx.parent.id,workId,{version:body.version,work:{...input,billId:id}});
 return projectWork(ctx.bill,ctx.parent,saved);
}
async function transition(tx,user,id,workId,body){
 const ctx=await writable(tx,user,id,body.version),work=selectedWork(ctx,workId);
 fail(!require('./driverDeliveries').billIds(work).some(b=>b!==id),'Pekerjaan bersama harus diubah melalui pengiriman.',409);
 assertContainerIdentity(ctx.bill,ctx.parent,work.containerNumber||work.containerKey);
 if(['SUBMITTED','VERIFIED'].includes(body.status)){if(!require('./driverDeliveries').hasChildren(work))assertEvidence(ctx.bill,work.evidenceFileIds||[]);currentWorkContainer(ctx.bill,work);}
 const saved=await operations.transition(tx,user,ctx.parent.id,workId,body);
 return projectWork(ctx.bill,ctx.parent,saved);
}
async function attachEvidence(tx,user,id,body,file){
 const {bill,parent}=await writable(tx,user,id,body.version);
 const {text,audit}=require('./jpt');await require('./jobFiles').validateAttachment(file);
 const saved=await tx.seaBillFile.create({data:{billId:id,category:'DELIVERY_RECEIPT',filename:file.filename,originalName:text(file.originalname,'Nama file',255),mimeType:file.mimetype,size:file.size,contentVersion:bill.contentVersion||1,note:text(body.note,'Catatan',2000,true),uploadedById:user.id}});
 await tx.seaBill.update({where:{id},data:{version:{increment:1}}});
 await tx.shippingJourney.update({where:{id:parent.id},data:{version:{increment:1}}});
 await audit(tx,user,'DRIVER_BILL_EVIDENCE_ATTACHED','JobOrder',bill.jobId,{seaBillId:id,fileId:saved.id});
 return {id:saved.id,version:parent.version+1};
}
module.exports={list,saveWork,transition,attachEvidence,context,writable,selectedWork,assertContainerIdentity,currentWorkContainer,projectWork};

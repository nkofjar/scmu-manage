const {STAFF,fail,integer,text,audit}=require('./jpt');
const sea=require('./seaBills');
const journeys=()=>require('./journeys');

async function context(tx,user,id,fileId,body){
 fail(STAFF.includes(user?.role),'Hanya Admin dan Super Admin yang dapat mengubah dokumen.',403);
 const row=await journeys().get(tx,id);
 integer(body.version,'Versi');journeys().mutable(row,body.version);
 const file=row.files.find(f=>f.id===fileId);
 fail(file,'File tidak ditemukan pada pengiriman ini.',404);
 fail(!file.readOnly,'Dokumen hanya dapat dibaca.',409);
 return {row,file};
}
// Match exact identities (including keyed provenance), never substrings in notes.
function uses(value,identities){
 if(typeof value==='string')return identities.has(value);
 if(Array.isArray(value))return value.some(v=>uses(v,identities));
 return Boolean(value&&typeof value==='object'&&Object.entries(value).some(([k,v])=>identities.has(k)||uses(v,identities)));
}
function historicalUse(snapshot,identities){
 if(!snapshot)return false;
 // Revision attachment inventories prove availability, not operational use.
 const {files,...content}=snapshot;
 return uses(content,identities);
}
async function assertUnused(tx,row,files,bills){
 const identities=new Set(files.flatMap(f=>[f.id,f.filename]).filter(Boolean));
 fail(!uses(row.data,identities)&&!bills.some(b=>uses(b.registerData,identities)||identities.has(b.releaseProofId)),
  'Dokumen masih dipakai sebagai bukti pekerjaan/bonrate, release, sumber Packing List, berita acara, atau checklist. Lepaskan pemakaian terlebih dahulu.',409);
 const revisions=await tx.seaBillRevision.findMany({where:{billId:{in:bills.map(b=>b.id)}},select:{snapshot:true}});
 fail(!revisions.some(r=>historicalUse(r.snapshot,identities)),'Dokumen dipakai dalam riwayat tersimpan dan tidak dapat dilepas atau dihapus.',409);
 const logs=await tx.activityLog.findMany({where:{OR:[{entity:'ShippingJourney',entityId:row.id},{entity:'JobOrder',entityId:{in:bills.map(b=>b.jobId)}}]},select:{action:true,metadata:true}});
 const relationActions=new Set(['SEA_FILE_UPLOADED','SEA_JOURNEY_FILE_UNLINKED','JOURNEY_FILE_LINKED','JOURNEY_FILE_LINKS_UPDATED','JOURNEY_FILE_REMOVED','JOURNEY_SUPPORTING_FILE_UPLOADED','JOURNEY_PACKING_FILE_UPLOADED','DRIVER_EVIDENCE_UPLOADED']);
 fail(!logs.some(log=>!relationActions.has(log.action)&&uses(log.metadata,identities)),
  'Dokumen dipakai dalam riwayat tersimpan dan tidak dapat dilepas atau dihapus.',409);
}
async function setLinks(tx,user,id,fileId,body){
 const {row,file}=await context(tx,user,id,fileId,body),version=row.version;
 fail(file.category==='SUPPORTING','Hanya dokumen pendukung milik pengiriman yang dapat diubah tautannya.');
 fail(Array.isArray(body.billIds)&&body.billIds.length<=100&&body.billIds.every(b=>typeof b==='string'&&b.length>0&&b.length<=100),'Pilih maksimal 100 B/L yang valid.');
 const ids=[...new Set(body.billIds)],selected=new Set(ids),add=[],remove=[];
 for(const bid of ids)fail(row.bills.some(b=>b.id===bid),'B/L bukan bagian dari pengiriman ini.');
 for(const bill of row.bills){
  const aliases=journeys().billDocumentFiles(bill).filter(f=>f.filename===file.filename);
  if(selected.has(bill.id)){
   fail(!require('./registerLifecycle').isTrashed(bill),'B/L di Sampah hanya dapat dibaca.',409);
   await sea.getBill(tx,bill.jobId,bill.id,bill.version);
   if(!aliases.length)add.push(bill);
  }else if(aliases.length){
   fail(aliases.every(f=>!f.readOnly&&!(bill.files||[]).find(raw=>raw.id===f.id)?.readOnly),'Lampiran B/L hanya dapat dibaca.',409);
   fail(aliases.every(f=>f.category==='SUPPORTING'&&f.externalNumber===file.id&&(bill.files||[]).some(raw=>raw.id===f.id)),
    'Tautan B/L memiliki lampiran mandiri atau asal tautan tidak terbukti. Kelola lampiran pada B/L terkait; tidak dapat dilepas dari pengiriman.',409);
   fail(!require('./registerLifecycle').isTrashed(bill),'B/L di Sampah hanya dapat dibaca.',409);
   await sea.getBill(tx,bill.jobId,bill.id,bill.version);
   remove.push({bill,aliases});
  }
 }
 // Validate every target and dependency before the first mutation.
 for(const {aliases}of remove)await assertUnused(tx,row,[file,...aliases],row.bills);
 for(const {bill,aliases}of remove){
  for(const alias of aliases)await tx.seaBillFile.delete({where:{id:alias.id}});
  await tx.seaBill.update({where:{id:bill.id},data:{version:{increment:1}}});
  await sea.history(tx,user,bill.id,'SEA_JOURNEY_FILE_UNLINKED','Tautan dokumen pengiriman dilepas.',{journeyId:id,fileId,removedFileIds:aliases.map(f=>f.id)});
 }
 for(const bill of add)await sea.attach(tx,user,bill.jobId,bill.id,{version:bill.version,category:file.category,externalNumber:file.id,documentDate:file.createdAt,note:'Sumber bersama pengiriman '+row.number},{filename:file.filename,originalname:file.originalName,mimetype:file.mimeType,size:file.size});
 await tx.shippingJourney.update({where:{id},data:{version:{increment:1}}});
 await audit(tx,user,'JOURNEY_FILE_LINKS_UPDATED','ShippingJourney',id,{fileId,billIds:ids,addedBillIds:add.map(b=>b.id),removedBillIds:remove.map(r=>r.bill.id)});
 return {linked:true,version:version+1,billIds:ids};
}
const DELETABLE_CATEGORIES=new Set(['SUPPORTING','MANIFEST','WAYBILL','RELEASE','POWER_OF_ATTORNEY',
 // Preserve the existing specialized packing, driver and financial upload clients.
 'PACKING_LIST','RECEIVING_REPORT','PAYMENT_PROOF','DELIVERY_ORDER','INVOICE','TAX_INVOICE','PPH23_CERTIFICATE','DELIVERY_RECEIPT']);
async function remove(tx,user,id,fileId,body){
 const {row,file}=await context(tx,user,id,fileId,body),version=row.version;
 const reason=text(body.reason,'Alasan penghapusan',2000);
 fail(DELETABLE_CATEGORIES.has(file.category),'Kategori dokumen ini tidak dapat dihapus melalui pengiriman.');
 require('./jobFiles').filePath(file.filename);
 const linked=row.bills.some(b=>journeys().billDocumentFiles(b).some(f=>f.filename===file.filename));
 fail(!linked,'File masih ditautkan ke B/L. Lepaskan tautan ke B/L terlebih dahulu sebelum menghapus dokumen.',409);
 // Include references outside this journey as well as archived/trash and legacy sources.
 const references=await tx.seaBillFile.count({where:{filename:file.filename}})+await tx.jobDocument.count({where:{filename:file.filename}});
 fail(!references,'File masih ditautkan ke B/L atau sumber mandiri. Lepaskan tautan pada pemilik terkait terlebih dahulu.',409);
 await assertUnused(tx,row,[file],row.bills);
 await tx.journeyFile.delete({where:{id:file.id}});
 await tx.shippingJourney.update({where:{id},data:{version:{increment:1}}});
 await tx.documentFilePurge.upsert({where:{filename:file.filename},create:{filename:file.filename},update:{requestedAt:new Date()}});
 await audit(tx,user,'JOURNEY_FILE_REMOVED','ShippingJourney',id,{fileId,category:file.category,originalName:file.originalName,reason});
 return {filename:file.filename,version:version+1};
}
module.exports={setLinks,remove};

const {randomUUID}=require('node:crypto');
const {fail,text,integer}=require('./jpt');
const {key}=require('./driverTariffs');
const {isTrashed}=require('./registerLifecycle');
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jayapura',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const activeBills=row=>(row.bills||[]).filter(b=>!isTrashed(b));
const billContainers=bill=>require('./blRegister').normalize({},bill).containers;
const hasChildren=work=>Array.isArray(work.deliveries)&&work.deliveries.length>0;
function assertMutableSources(row,work){for(const id of billIds(work)){const bill=(row.bills||[]).find(b=>b.id===id);fail(bill&&!isTrashed(bill)&&!bill.archivedAt&&!bill.registerData?.archivedAt,'B/L di arsip/Sampah hanya dapat dibaca.',409);}}
function billIds(work){return [...new Set([work.billId,...(work.deliveries||[]).map(d=>d.billId)].filter(Boolean))];}
function evidenceIds(work){return [...new Set([...(work.evidenceFileIds||[]),...(work.deliveries||[]).flatMap(d=>d.evidenceFileIds||[])])];}
function actualDate(value){if(value==null||value==='')return null;fail(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Isi tanggal diterima yang valid.');fail(value<=today(),'Tanggal diterima tidak boleh di masa depan.');return value;}
function items(input){fail(Array.isArray(input)&&input.length<=200,'Maksimal 200 rincian barang dalam satu pengantaran.');return input.map(i=>{
 fail(i&&typeof i==='object','Isi rincian barang.');const weight=i.packageWeightKg==null||i.packageWeightKg===''?null:Number(i.packageWeightKg);
 fail(weight===null||((typeof i.packageWeightKg==='number'||typeof i.packageWeightKg==='string')&&Number.isFinite(weight)&&weight>0&&weight<=1000000),'Berat kemasan harus positif dan valid.');
 return {owner:text(i.owner,'Merek / pemilik',250,true),collyCount:i.collyCount===''||i.collyCount==null?null:integer(i.collyCount,'Banyak colly',1,1000000),collyType:text(i.collyType,'Jenis colly',100,true),goodsType:text(i.goodsType,'Jenis barang',500,true),goodsTypeId:text(i.goodsTypeId,'Jenis barang master',100,true),packageWeightKg:weight};
 });}
const completeItems=rows=>Array.isArray(rows)&&rows.length>0&&rows.every(i=>i?.owner&&i.collyCount&&i.collyType&&i.goodsType);
const complete=child=>!!(child.billId&&child.containerNumber&&child.recipient&&child.destination&&child.receivedDate&&completeItems(child.items));
function completionDate(deliveries){return deliveries.length&&deliveries.every(complete)?deliveries.map(d=>d.receivedDate).sort().at(-1):null;}
function container(row,billId,number){const bill=activeBills(row).find(b=>b.id===billId);fail(bill,'Pilih B/L aktif pada pengiriman ini.');assertMutableSources(row,{billId});const selected=billContainers(bill).find(c=>key(c.number)===key(number));fail(selected,'Pilih kontainer pada B/L pengantaran.');const matches=activeBills(row).flatMap(billContainers).filter(c=>key(c.number)===key(selected.number));fail(matches.every(c=>String(c.size||'')===String(selected.size||'')&&key(c.seal)===key(selected.seal)),'Ukuran atau segel kontainer berbeda antar B/L. Perbaiki identitas sumber terlebih dahulu.',409);return {bill,selected};}
function proofIds(row,billId,ids,previous=[]){fail(Array.isArray(ids)&&ids.length<=50&&new Set(ids).size===ids.length,'Pilih bukti pengantaran yang valid.');const bill=activeBills(row).find(b=>b.id===billId);fail(ids.every(id=>[...(bill?.files||[]),...(row.files||[])].some(f=>f.id===id&&f.filename&&(['DELIVERY_RECEIPT','POD'].includes(f.category)||previous.includes(id)))),'Pilih bukti serah terima pada B/L pengantaran ini.');return [...ids];}
function normalize(input,row,before){fail(Array.isArray(input)&&input.length>0&&input.length<=100,'Pilih 1 sampai 100 pengantaran.');const seen=new Set();return input.map(d=>{
 fail(d&&typeof d==='object','Isi pengantaran.');const id=d.id?text(d.id,'ID pengantaran',100):randomUUID();fail(!seen.has(id),'ID pengantaran duplikat.');seen.add(id);
 const old=(before?.deliveries||[]).find(x=>x.id===id),billId=text(d.billId,'B/L pengantaran',100),{selected}=container(row,billId,d.containerNumber);
 return {id,billId,containerNumber:selected.number,containerKey:key(selected.number),size:selected.size||null,seal:selected.seal||null,recipient:text(d.recipient,'Penerima',250,true),routeId:d.routeId||null,routeSnapshot:structuredClone(d.routeSnapshot||null),destination:text(d.destination,'Tujuan pengantaran',300,true),items:items(d.items||[]),receivedDate:actualDate(d.receivedDate),receiptReference:text(d.receiptReference===undefined?old?.receiptReference:d.receiptReference,'Nomor bukti serah terima pengantaran',150,true),evidenceFileIds:proofIds(row,billId,d.evidenceFileIds??[],before?.recordingPolicy==='POST_DELIVERY'?[]:old?.billId===billId?old.evidenceFileIds||[]:[])};
 });}
function validate(row,work){for(const d of work.deliveries||[]){const {selected}=container(row,d.billId,d.containerNumber);fail(String(selected.size||'')===String(d.size||'')&&key(selected.seal)===key(d.seal),'Identitas kontainer pengantaran berubah.',409);actualDate(d.receivedDate);proofIds(row,d.billId,d.evidenceFileIds,work.recordingPolicy==='POST_DELIVERY'?[]:d.evidenceFileIds);}}
function ready(work){if(work.recordingPolicy==='POST_DELIVERY')fail(hasChildren(work)&&work.deliveries.every(d=>key(d.containerNumber)===work.containerKey),'Semua pengantaran bonrate harus menggunakan kontainer fisik yang sama.');fail(hasChildren(work)&&work.deliveries.every(complete),'Lengkapi penerima, tujuan, rincian barang dan tanggal aktual setiap pengantaran.');for(const d of work.deliveries)actualDate(d.receivedDate);fail(work.receivedDate===completionDate(work.deliveries),'Tanggal selesai harus mengikuti pengantaran terakhir.',409);}
async function resolveCatalogs(tx,input,before){
 const work=structuredClone(input),routeId=input.routeId===undefined?before?.routeId:input.routeId;
 if(routeId){if(routeId===before?.routeId&&before.routeSnapshot){work.routeSnapshot=structuredClone(before.routeSnapshot);work.origin=before.origin;work.destination=before.destination;}else{const route=await tx.route.findUnique({where:{id:text(routeId,'Rute',100)}});fail(route?.isActive,'Pilih rute aktif.');work.routeSnapshot={id:route.id,name:route.name,originCity:route.originCity,originState:route.originState,destCity:route.destCity,destState:route.destState};work.origin=[route.originCity,route.originState].filter(Boolean).join(', ');work.destination=[route.destCity,route.destState].filter(Boolean).join(', ');}work.routeId=routeId;}else{work.routeId=null;work.routeSnapshot=null;}
 async function resolveItems(rows,oldRows){return Promise.all((rows||[]).map(async(i,index)=>{if(!i.goodsTypeId)return i;const old=oldRows?.find(row=>row.goodsTypeId===i.goodsTypeId);if(old)return {...i,goodsType:old.goodsType};const goods=await tx.goodsType.findUnique({where:{id:text(i.goodsTypeId,'Jenis barang master',100)}});fail(goods?.isActive,'Pilih jenis barang aktif.');return {...i,goodsType:goods.name};}));}
 work.items=await resolveItems(work.items,before?.items);
 if(work.deliveries)for(const d of work.deliveries){const old=before?.deliveries?.find(x=>x.id===d.id),childRouteId=d.routeId===undefined?old?.routeId:d.routeId;
  if(childRouteId){d.routeId=text(childRouteId,'Rute pengantaran',100);if(d.routeId===old?.routeId&&old.routeSnapshot){d.routeSnapshot=structuredClone(old.routeSnapshot);d.destination=old.destination;}else{const route=await tx.route.findUnique({where:{id:d.routeId}});fail(route?.isActive,'Pilih rute aktif.');d.routeSnapshot={id:route.id,name:route.name,originCity:route.originCity,originState:route.originState,destCity:route.destCity,destState:route.destState};d.destination=[route.destCity,route.destState].filter(Boolean).join(', ');}}
  else{d.routeId=null;d.routeSnapshot=null;}
  d.items=await resolveItems(d.items,old?.items);}
 return work;
}
module.exports={assertMutableSources,resolveCatalogs,activeBills,billContainers,hasChildren,billIds,evidenceIds,actualDate,items,completeItems,complete,completionDate,container,proofIds,normalize,validate,ready};

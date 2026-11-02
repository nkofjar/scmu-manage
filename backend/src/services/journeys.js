const {randomUUID}=require('node:crypto');
const {fail,text,integer,audit,customer,decimal,money}=require('./jpt');
const {notTrashed,isTrashed}=require('./registerLifecycle');
const {vesselKey,voyageKey}=require('./vessels');
const {calendarDate}=require('./registerFields');
const keyText=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const keyOf=r=>r.vesselName&&r.voyageNumber&&r.period&&r.destination?[vesselKey(r.vesselName),voyageKey(r.voyageNumber),r.period,keyText(r.destination)].join('|'):null;
const childInclude=()=>({...require('./blRegister').include,history:false});
const include=()=>({files:true,bills:{include:childInclude(),orderBy:[{createdAt:'asc'},{id:'asc'}]}});
async function get(tx,id){const row=await tx.shippingJourney.findUnique({where:{id:text(id,'Pengiriman',100)},include:include()});fail(row,'Pengiriman tidak ditemukan.',404);return row;}
function mutable(row,version){fail(!row.deletedAt&&!row.archivedAt,'Pengiriman di arsip/Sampah hanya dapat dibaca.',409);if(version!==undefined)fail(integer(version,'Versi')===row.version,'Data pengiriman berubah. Muat ulang sebelum menyimpan.',409);}
function normalize(body,before={}){
 const value={};for(const k of ['vesselName','voyageNumber','destination','notes'])value[k]=body[k]===undefined?before[k]||null:text(body[k],k,k==='notes'?2000:200,true);
 value.period=body.period===undefined?before.period||null:text(body.period,'Periode',7,true);fail(!value.period||/^[12]\d{3}(?:-(?:0[1-9]|1[0-2]))?$/.test(value.period),'Periode harus berupa tahun atau tahun-bulan.');
 for(const k of ['departureDate','arrivalDate'])value[k]=body[k]===undefined?before[k]||null:calendarDate(body[k],k);
 fail(!value.departureDate||!value.arrivalDate||new Date(value.departureDate)<=new Date(value.arrivalDate),'Tanggal tiba harus sesudah tanggal berangkat.');
 for(const k of ['vesselId','voyageId'])value[k]=body[k]===undefined?before[k]||null:text(body[k],k,100,true);
 return value;
}
function compatible(j,b){return (!j.vesselName||!b.vesselName||vesselKey(j.vesselName)===vesselKey(b.vesselName))&&(!j.voyageNumber||!b.voyageNumber||voyageKey(j.voyageNumber)===voyageKey(b.voyageNumber))&&(!j.destination||!b.portOfDischarge||keyText(j.destination)===keyText(b.portOfDischarge))&&(!j.voyageId||!b.voyageId||j.voyageId===b.voyageId);}
async function save(tx,user,id,body){
 const before=id?await get(tx,id):null;if(before)mutable(before,body.version);
 const fields=normalize(body,before||{});fail(!fields.voyageId||fields.vesselId,'Pilih kapal untuk voyage tersebut.');if(fields.vesselId)await require('./vessels').links(tx,{...fields,portOfDischarge:fields.destination},before||{});
 if(fields.voyageId){const v=await tx.voyage.findUnique({where:{id:fields.voyageId}});fail(!fields.period||fields.period===v.period,'Periode harus sesuai dengan master voyage.');fields.period=v.period;}
 if(before)fail(before.bills.filter(b=>!isTrashed(b)).every(b=>compatible(fields,b)),'Kapal, voyage, atau tujuan berbeda dengan B/L yang terhubung. Periksa B/L sebelum mengubah identitas perjalanan.',409);
 const activeKey=keyOf(fields);if(activeKey){const other=await tx.shippingJourney.findFirst({where:{activeKey,...(id?{id:{not:id}}:{})}});fail(!other,'Pengiriman kapal/voyage/periode/tujuan ini sudah ada. Buka pengiriman tersebut untuk menambahkan B/L.',409);}
 const data={...fields,activeKey,data:{...(before?.data||{}),periodConfirmed:Boolean(fields.period)}};
 const row=before?await tx.shippingJourney.update({where:{id},data:{...data,version:{increment:1}}}):await tx.shippingJourney.create({data:{...data,number:'PGR-'+randomUUID().slice(0,12).toUpperCase(),createdById:user.id}});
 await audit(tx,user,before?'JOURNEY_UPDATED':'JOURNEY_CREATED','ShippingJourney',row.id,{fields});return present(await get(tx,row.id));
}
async function forBill(tx,user,body){
 if(!tx.shippingJourney)return null;
 if(body.journeyId){const row=await get(tx,body.journeyId);mutable(row);fail(compatible(row,body),'Kapal, voyage, atau tujuan B/L berbeda dengan pengiriman yang dipilih.',409);
  const fields=normalize({vesselName:row.vesselName||body.vesselName,voyageNumber:row.voyageNumber||body.voyageNumber,destination:row.destination||body.portOfDischarge,period:row.period||String(new Date(body.issueDate||body.onBoardDate||Date.now()).getUTCFullYear())},row);
  const key=keyOf(fields);if(key){const other=await tx.shippingJourney.findFirst({where:{activeKey:key,id:{not:row.id}}});fail(!other,'Perjalanan ini sudah memiliki pengiriman. Buka pengiriman tersebut.',409);}
  if(['vesselName','voyageNumber','destination','period'].some(k=>!row[k]&&fields[k]))return tx.shippingJourney.update({where:{id:row.id},data:{...fields,activeKey:key,version:{increment:1}}});return row;}
 const fields=normalize({vesselId:body.vesselId,voyageId:body.voyageId,vesselName:body.vesselName,voyageNumber:body.voyageNumber,destination:body.portOfDischarge,period:body.issueDate?.slice?.(0,4)||body.onBoardDate?.slice?.(0,4)||String(new Date().getUTCFullYear())});
 if(fields.voyageId){const voyage=await tx.voyage.findUnique({where:{id:fields.voyageId}});if(voyage)fields.period=voyage.period;}
 const key=keyOf(fields);let row=key?await tx.shippingJourney.findUnique({where:{activeKey:key}}):null;
 if(row){mutable(row);return row;}
 row=await tx.shippingJourney.create({data:{...fields,activeKey:key,number:'PGR-'+randomUUID().slice(0,12).toUpperCase(),createdById:user.id,data:{periodConfirmed:Boolean(fields.voyageId),autoCreated:true}}});
 await audit(tx,user,'JOURNEY_CREATED','ShippingJourney',row.id,{fromBill:true});return row;
}
const visibleBills=row=>(row.bills||[]).filter(b=>!isTrashed(b)||row.deletedAt&&row.data?.trash?.billIds?.includes(b.id));
function summary(row){
 const bills=visibleBills(row),containers=new Map(),origins=new Set(),files=new Set((row.files||[]).map(f=>f.filename));
 for(const b of bills){if(b.portOfLoading)origins.add(b.portOfLoading);for(const c of require('./blRegister').normalize({},b).containers){const key=keyText(c.number);if(key&&!containers.has(key))containers.set(key,{...c,billIds:[b.id]});else if(key)containers.get(key).billIds.push(b.id);}for(const f of b.files||[])if(f.filename)files.add(f.filename);}
 return {billCount:bills.filter(b=>b.billNumber).length,detailCount:bills.length,draftCount:bills.filter(b=>!b.billNumber).length,containerCount:containers.size,documentCount:files.size,origins:[...origins],containers:[...containers.values()],missingBL:bills.filter(b=>!require('./blRegister').availability(b).billOfLading).length};
}
function present(row,detail=true){
 const {bills,files,...data}=row;const counts=summary(row);
 return {...data,...counts,packing:require('./journeyOverview').facts(row),label:row.vesselName?[row.vesselName,row.voyageNumber?'Voyage '+row.voyageNumber:null].filter(Boolean).join(' — '):row.number,deleted:Boolean(row.deletedAt),archived:Boolean(row.archivedAt),...(detail?{commonFiles:(files||[]).map(f=>({...require('./shipmentDocuments').publicFile(f),endpoint:`/journeys/${row.id}/files/${f.id}`})),bills:visibleBills(row).map(b=>{const p=require('./blRegister').present(b);return {...p,packingStatus:require('./journeyOverview').packingBill(b),files:(b.files||[]).map(require('./shipmentDocuments').publicFile),journeyId:row.id};})}:{})};
}
async function list(tx,query={}){
 const state=query.archived||'active';fail(['active','archived','all','trash'].includes(state),'Status daftar tidak valid.');const where=state==='trash'?{deletedAt:{not:null}}:{deletedAt:null,...(state==='active'?{archivedAt:null}:state==='archived'?{archivedAt:{not:null}}:{})};
 const and=[];for(const [q,k]of [['vessel','vesselName'],['vesselExact','vesselName'],['voyage','voyageNumber'],['voyageExact','voyageNumber'],['destination','destination'],['period','period']])if(query[q])and.push({[k]:{[q.endsWith('Exact')?'equals':'contains']:text(query[q],q,200),mode:'insensitive'}});
 for(const k of ['vesselId','voyageId'])if(query[k])and.push({[k]:text(query[k],k,100)});
 if(query.search){const search=text(query.search,'Pencarian',200);and.push({OR:['number','vesselName','voyageNumber','period','destination'].map(k=>({[k]:{contains:search,mode:'insensitive'}})).concat([{bills:{some:{AND:[notTrashed],billNumber:{contains:search,mode:'insensitive'}}}}])});}if(and.length)where.AND=and;
 const {pageMeta,pageOptions}=require('./pagination');pageOptions(query);if(query.task)require('./jpt').choice(query.task,require('./journeyOverview').TASKS,'Pekerjaan');
 let facts=await tx.shippingJourney.findMany({where,include:include(),orderBy:[{createdAt:'desc'},{id:'desc'}]});if(query.task)facts=facts.filter(r=>require('./journeyOverview').matches(r,query.task));
 const total=facts.length,meta=pageMeta(total,query),rows=facts.slice((meta.page-1)*meta.limit,meta.page*meta.limit),counts=facts.map(r=>serviceCounts(r));
 return {...meta,data:rows.map(r=>present(r,false)),summary:{totalJourneys:total,totalBills:counts.reduce((n,r)=>n+r.billCount,0),totalContainers:counts.reduce((n,r)=>n+r.containerCount,0)}};
}
const serviceCounts=row=>summary(row);
function billDocumentFiles(bill){
 const rows=require('./shipmentDocuments').linkedFiles(bill);
 // linkedFiles hides filename aliases for presentation; operations still store their raw IDs.
 for(const f of [bill.document&&{...bill.document,category:'FINAL'},...(bill.allocations||[]).map(a=>a.packingList?.document&&{...a.packingList.document,category:'PACKING_LIST'})])if(f?.filename&&!rows.some(r=>r.id===f.id))rows.push(f);
 return rows.filter(f=>f.filename);
}
async function documents(tx,id,privateNames=false){const row=await get(tx,id),map=new Map();
 const add=(f,b)=>{let item=map.get(f.filename);if(!item){item={...require('./shipmentDocuments').publicFile(f),filename:f.filename,source:b?'BILL':'JOURNEY',ref:b?b.id+':'+f.id:f.id,evidenceIds:[],evidenceAliases:[],billIds:[],billNumbers:[],endpoint:b?`/bl-register/${b.id}/files/${f.id}`:`/journeys/${id}/files/${f.id}`};map.set(f.filename,item);}if(!item.evidenceIds.includes(f.id))item.evidenceIds.push(f.id);if(!item.evidenceAliases.some(alias=>alias.id===f.id&&alias.category===f.category))item.evidenceAliases.push({id:f.id,category:f.category});if(b&&!item.billIds.includes(b.id)){item.billIds.push(b.id);item.billNumbers.push(b.billNumber||'Draf');}};
 for(const f of row.files)if(f.filename)add(f);
 for(const b of visibleBills(row))for(const f of billDocumentFiles(b))add(f,b);
 return {version:row.version,data:[...map.values()].map(f=>{const {filename,...publicData}=f;return {...publicData,id:f.ref,...(privateNames?{filename}:{})};})};
}
async function linkFile(tx,user,id,fileId,body){const row=await get(tx,id);mutable(row,body.version);const f=row.files.find(f=>f.id===fileId);fail(f&&['PACKING_LIST','RECEIVING_REPORT','SUPPORTING'].includes(f.category),'Pilih sumber PL, berita acara, atau dokumen pendukung.');fail(Array.isArray(body.billIds)&&body.billIds.length>0&&body.billIds.length<=100,'Pilih rincian B/L yang dicakup.');for(const bid of new Set(body.billIds)){const b=row.bills.find(b=>b.id===bid&&!isTrashed(b));fail(b,'B/L bukan bagian dari pengiriman ini.');if(b.files.some(file=>file.filename===f.filename&&file.category===f.category))continue;await require('./seaBills').attach(tx,user,b.jobId,b.id,{version:b.version,category:f.category,externalNumber:f.id,documentDate:f.createdAt,note:'Sumber bersama pengiriman '+row.number},{filename:f.filename,originalname:f.originalName,mimetype:f.mimeType,size:f.size});}await tx.shippingJourney.update({where:{id},data:{version:{increment:1}}});await audit(tx,user,'JOURNEY_FILE_LINKED','ShippingJourney',id,{fileId,billIds:body.billIds});return {linked:true};}
const SUPPORTING_DOCUMENT_CATEGORIES=['SUPPORTING','RECEIVING_REPORT','PAYMENT_PROOF','DELIVERY_ORDER','INVOICE','MANIFEST','WAYBILL','TAX_INVOICE','PPH23_CERTIFICATE','RELEASE'];
const DRIVER_EVIDENCE_CATEGORIES=['DELIVERY_RECEIPT','PAYMENT_PROOF'];
const PACKING_DOCUMENT_CATEGORIES=['PACKING_LIST'];
// Display historical/unknown supporting categories, but whitelist all new uploads.
function isSupportingDocumentCategory(category){return !['DRAFT','FINAL','LEGACY','BILL_OF_LADING','PACKING_LIST','INTERNAL_PACKING_LIST','INTERNAL_PACKING_RECAP','PACKING_HEADER','DELIVERY_RECEIPT','POD','DRIVER_BON'].includes(category);}
async function attachWithPolicy(tx,user,id,body,file,policy){
 const row=await get(tx,id);mutable(row,body.version);const category=text(body.category||'SUPPORTING','Kategori',80);
 fail(policy.includes(category),policy===SUPPORTING_DOCUMENT_CATEGORIES?'Kategori ini dikelola pada tab masing-masing.':policy===PACKING_DOCUMENT_CATEGORIES?'Pilih dokumen sumber Packing List.':'Pilih bukti untuk pekerjaan Bonrate Sopir.');
 await require('./jobFiles').validateAttachment(file);
 const f=await tx.journeyFile.create({data:{journeyId:id,category,filename:file.filename,originalName:text(file.originalname,'Nama file',255),mimeType:file.mimetype,size:file.size,note:text(body.note,'Catatan',2000,true),uploadedById:user.id}});
 await tx.shippingJourney.update({where:{id},data:{version:{increment:1}}});await audit(tx,user,policy===SUPPORTING_DOCUMENT_CATEGORIES?'JOURNEY_SUPPORTING_FILE_UPLOADED':policy===PACKING_DOCUMENT_CATEGORIES?'JOURNEY_PACKING_FILE_UPLOADED':'DRIVER_EVIDENCE_UPLOADED','ShippingJourney',id,{fileId:f.id,category});return {id:f.id};
}
async function attach(tx,user,id,body,file){return attachWithPolicy(tx,user,id,body,file,SUPPORTING_DOCUMENT_CATEGORIES);}
async function attachDriverEvidence(tx,user,id,body,file){return attachWithPolicy(tx,user,id,body,file,DRIVER_EVIDENCE_CATEGORIES);}
async function attachPacking(tx,user,id,body,file){return attachWithPolicy(tx,user,id,body,file,PACKING_DOCUMENT_CATEGORIES);}
async function costJob(tx,user,row){if(row.sharedJobId)return row.sharedJobId;const owner=await customer(tx);const job=await tx.jobOrder.create({data:{jobNumber:'JOB-'+randomUUID().slice(0,12).toUpperCase(),jobType:'RECEIVER',title:'Biaya bersama '+row.number,customerId:owner.id,originCity:'Berbagai pelabuhan',destCity:row.destination||'Unconfirmed',cargoDescription:'Biaya bersama perjalanan kapal',packages:0,currency:'IDR',createdById:user.id}});await tx.shippingJourney.update({where:{id:row.id},data:{sharedJobId:job.id}});return job.id;}
async function costs(tx,id){const row=await get(tx,id),bills=row.bills.filter(b=>!isTrashed(b)),jobs=[...new Set([...bills.map(b=>b.jobId),row.sharedJobId].filter(Boolean))];const rows=await tx.jobCharge.findMany({where:{jobId:{in:jobs}},include:{vendor:{select:{name:true}}},orderBy:{createdAt:'desc'}});return {data:rows.map(c=>({...c,scope:c.jobId===row.sharedJobId?'Bersama':bills.find(b=>b.jobId===c.jobId)?.billNumber||'B/L',estimatedAmount:c.estimatedAmount.toFixed(2),actualAmount:c.actualAmount?.toFixed(2)||null})),approvedCost:rows.filter(c=>c.kind==='COST'&&c.status==='APPROVED').reduce((n,c)=>n.plus(c.actualAmount||0),money(0)).toFixed(2)};}
async function createCost(tx,user,id,body,context={}){const row=await get(tx,id);mutable(row,body.version);
 if(body.billId){fail(row.bills.some(b=>b.id===body.billId&&!isTrashed(b)),'Pilih B/L pada pengiriman ini.');const b=row.bills.find(b=>b.id===body.billId);const result=await require('./blWorkspace').createCost(tx,user,b.id,{...body,version:b.version});await tx.shippingJourney.update({where:{id},data:{version:{increment:1}}});return result;}
 const quantity=decimal(String(body.quantity),'Jumlah',4,true),unitPrice=decimal(String(body.unitPrice),'Harga',2,true),amount=quantity.mul(unitPrice).toDecimalPlaces(2);fail(amount.lte('999999999999'),'Jumlah biaya terlalu besar.');const jobId=await costJob(tx,user,row);const fields=await require('./transport').costFields(tx,jobId,body);
 const snapshot={journeyId:id,type:'JOURNEY_COST',...(context.driverPayrollSnapshot?{driverPayrollSnapshot:context.driverPayrollSnapshot}:{}),...(context.driverRateSnapshot?{driverRateSnapshot:context.driverRateSnapshot}:{}),line:{description:text(body.description,'Uraian',300),quantity:quantity.toFixed(4),unit:text(body.unit||'JOB','Satuan',30),unitPrice:unitPrice.toFixed(2),amount:amount.toFixed(2)}};
 const charge=await tx.jobCharge.create({data:{jobId,...fields,kind:'COST',status:'PROPOSED',description:snapshot.line.description,estimatedAmount:amount,tariffSnapshot:snapshot,...(context.bonId?{tariffKey:'BONRATE:'+context.bonId}:{}),createdById:user.id,notes:text(body.notes,'Catatan',2000,true)}});
 const approval=await require('./director').submit(tx,user,'CHARGE_APPROVE',charge.id,{actualAmount:amount.toFixed(2)},'Biaya bersama pengiriman '+row.number);await tx.shippingJourney.update({where:{id},data:{version:{increment:1}}});await audit(tx,user,'JOURNEY_COST_PROPOSED','ShippingJourney',id,{chargeId:charge.id,shared:true});return {charge,approval};}
function virtualBill(row){return {id:row.id,version:row.version,billNumber:row.number,portOfDischarge:row.destination,containers:summary(row).containers,files:[...row.files,...row.bills.filter(b=>!isTrashed(b)).flatMap(b=>b.files)],registerData:row.data,archivedAt:row.archivedAt,deleted:Boolean(row.deletedAt)};}
async function saveBon(){fail(false,'Gunakan alur pekerjaan angkut dan bukti serah terima pada Bonrate Sopir pengiriman.',409);}
async function bonCost(){fail(false,'Biaya sopir diajukan dari rekap upah pekerjaan terverifikasi.',409);}
module.exports={include,get,mutable,normalize,keyOf,compatible,save,forBill,summary,present,list,documents,billDocumentFiles,attach,attachDriverEvidence,attachPacking,isSupportingDocumentCategory,linkFile,costs,createCost,virtualBill,saveBon,bonCost};

const {randomUUID}=require('node:crypto');
const {fail,text,choice,integer,decimal,audit,STAFF}=require('./jpt');
const register=require('./blRegister');
const STATUSES=['DRAFT','ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED'];
const transitions={DRAFT:['DRAFT','ASSIGNED','CANCELLED'],ASSIGNED:['ASSIGNED','IN_PROGRESS','CANCELLED'],IN_PROGRESS:['IN_PROGRESS','COMPLETED','CANCELLED'],COMPLETED:['COMPLETED'],CANCELLED:[]};
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jayapura',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function day(value,label,optional=false){
 if(optional&&(value==null||value===''))return null;
 fail(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value,`Isi ${label} yang valid.`);return value;
}
function rows(bill){return Array.isArray(bill.registerData?.driverBons)?bill.registerData.driverBons:[];}
function normalize(input,bill,before){
 fail(input&&typeof input==='object'&&!Array.isArray(input),'Isi bonrate sopir yang valid.');
 const status=choice(input.status||'DRAFT',STATUSES,'Status bonrate');
 fail(before?transitions[before.status]?.includes(status):['DRAFT','ASSIGNED'].includes(status),'Perubahan status bonrate tidak diizinkan. Bon yang dibatalkan hanya dapat dibaca.',409);
 const bonDate=day(input.bonDate,'tanggal bon');
 const containerNumbers=input.containerNumbers??[];fail(Array.isArray(containerNumbers)&&containerNumbers.length<=100&&new Set(containerNumbers).size===containerNumbers.length&&containerNumbers.every(n=>bill.containers.some(c=>c.number===n)),'Pilih kontainer yang tercatat pada B/L ini.');
 const evidenceFileIds=input.evidenceFileIds??[];fail(Array.isArray(evidenceFileIds)&&evidenceFileIds.length<=50&&new Set(evidenceFileIds).size===evidenceFileIds.length&&evidenceFileIds.every(id=>bill.files.some(f=>f.id===id&&f.filename)),'Pilih lampiran yang tersedia pada B/L ini.');
 const amount=input.amount==null||input.amount===''?null:decimal(input.amount,'Nominal bon',2).toFixed(2);
 const paymentStatus=choice(input.paymentStatus||'NOT_RECORDED',['NOT_RECORDED','UNPAID','PAID'],'Status pembayaran catatan');
 fail(paymentStatus==='NOT_RECORDED'||amount!==null,'Isi nominal sebelum mencatat status pembayaran.');
 const paymentDate=day(input.paymentDate,'tanggal pembayaran',paymentStatus!=='PAID');
 fail(paymentStatus==='PAID'||!paymentDate,'Tanggal pembayaran hanya diisi untuk catatan sudah dibayar.');
 fail(!paymentDate||paymentDate>=bonDate&&paymentDate<=today(),'Tanggal pembayaran harus setelah atau sama dengan tanggal bon dan tidak di masa depan.');
 const completedDate=day(input.completedDate,'tanggal selesai',status!=='COMPLETED');
 fail(status==='COMPLETED'||!completedDate,'Tanggal selesai hanya diisi saat penugasan selesai.');
 fail(!completedDate||completedDate>=bonDate&&completedDate<=today(),'Tanggal selesai harus setelah atau sama dengan tanggal bon dan tidak di masa depan.');
 const ratePlan=input.ratePlan?text(input.ratePlan,'Skema tarif',100):null;
 return {number:input.number?text(input.number,'Nomor bon',100).toUpperCase():before?.number||`BON-SCMU-${today().slice(0,4)}-${randomUUID().slice(0,8).toUpperCase()}`,bonDate,status,ratePlan,...(ratePlan?{rbCount:integer(input.rbCount,'RB',0,10000),rkCount:integer(input.rkCount,'RK',0,10000)}:{}),
  driverName:text(input.driverName,'Nama sopir',200),vehicleNumber:text(input.vehicleNumber,'Nomor kendaraan',80).toUpperCase(),origin:text(input.origin,'Lokasi pengambilan',300),destination:text(input.destination,'Tujuan pengantaran',300),
  cargoSummary:text(input.cargoSummary,'Muatan',1000,true),tripCount:integer(input.tripCount,'Jumlah rit',1,10000),containerNumbers,evidenceFileIds,
  instructions:text(input.instructions,'Instruksi lapangan',2000,true),notes:text(input.notes,'Catatan bon',2000,true),amount,currency:'IDR',paymentStatus,paymentDate,completedDate,
  cancellationReason:status==='CANCELLED'?text(input.cancellationReason,'Alasan pembatalan',1000):null};
}
async function list(tx,id){const bill=await register.get(tx,id);return {version:bill.version,data:rows(bill)};}
async function save(tx,user,id,bonId,body){
 fail(STAFF.includes(user?.role),'Hanya staf internal yang dapat mencatat bonrate.',403);
 const bill=await register.get(tx,id);await require('./seaBills').getBill(tx,bill.jobId,id,integer(body.version,'Versi'));
 fail(!bill.journeyId,"Catatan bon per B/L hanya dibaca. Buka Bonrate Sopir pada pengiriman induk.",409);
 const current=rows(bill),before=bonId?current.find(row=>row.id===bonId):null;fail(!bonId||before,'Bonrate tidak ditemukan pada B/L ini.',404);fail(before||current.length<500,'Maksimal 500 bonrate per B/L.');
 const data=await require('./driverTariffs').apply(tx,normalize(body.bon,bill,before),bill,before,body);fail(!current.some(row=>row.id!==bonId&&row.number===data.number),'Nomor bon sudah digunakan pada B/L ini.',409);
 if(before&&(bill.registerData?.driverCostProposals||[]).some(p=>p.bonId===bonId))fail(data.amount===before.amount,'Nominal bon sudah diajukan sebagai biaya. Gunakan alur penyesuaian biaya untuk perubahan nominal.',409);
 if(before?.status==='COMPLETED')for(const key of ['number','bonDate','status','driverName','vehicleNumber','origin','destination','cargoSummary','tripCount','containerNumbers','instructions','completedDate'])fail(JSON.stringify(data[key])===JSON.stringify(before[key]),'Penugasan sudah selesai. Hanya catatan, lampiran, dan pembayaran yang dapat diperbarui.',409);
 const now=new Date().toISOString();const saved={...data,id:before?.id||randomUUID(),createdAt:before?.createdAt||now,createdById:before?.createdById||user.id,createdByName:before?.createdByName||user.name||user.id,updatedAt:now,updatedById:user.id,updatedByName:user.name||user.id,...(before?.evidenceNotice?{evidenceNotice:before.evidenceNotice}:{})};
 const next=before?current.map(row=>row.id===bonId?saved:row):[saved,...current];
 await tx.seaBill.update({where:{id},data:{registerData:JSON.parse(JSON.stringify({...bill.registerData,driverBons:next})),version:{increment:1}}});
 await audit(tx,user,before?'DRIVER_BON_UPDATED':'DRIVER_BON_CREATED','JobOrder',bill.jobId,{seaBillId:id,bonId:saved.id,before,after:saved});
 return {version:bill.version+1,bon:saved};
}
async function proposeCost(tx,user,id,bonId,body){
 fail(STAFF.includes(user?.role),'Hanya staf internal yang dapat mengajukan biaya bonrate.',403);
 const bill=await register.get(tx,id);await require('./seaBills').getBill(tx,bill.jobId,id,integer(body.version,'Versi'));
 fail(!bill.journeyId,"Ajukan upah dari pekerjaan terverifikasi pada pengiriman induk.",409);
 const bon=rows(bill).find(b=>b.id===bonId);fail(bon,'Bonrate tidak ditemukan pada pengiriman ini.',404);
 fail(bon.status==='COMPLETED'&&bon.amount&&decimal(bon.amount).gt(0),'Selesaikan bon dan isi nominal sebelum mengajukan biaya.');
 fail(body.confirmed===true,'Periksa nominal dan konfirmasi pengajuan biaya.');
 fail(!(bill.registerData?.driverCostProposals||[]).some(p=>p.bonId===bonId)&&!await tx.jobCharge.findUnique({where:{tariffKey:'BONRATE:'+bonId}}),'Biaya untuk bon ini sudah diajukan. Periksa Biaya & Riwayat.',409);
 const result=await require('./blWorkspace').createCost(tx,user,id,{version:bill.version,description:`Bonrate ${bon.number} - ${bon.driverName}`.slice(0,300),quantity:'1',unit:'BON',unitPrice:bon.amount,costSource:'INTERNAL',costCategory:'DRIVER_ALLOWANCE',evidenceFileId:bon.evidenceFileIds?.[0]||null,notes:body.notes||`Referensi bon ${bon.number}. Catatan pembayaran bon: ${bon.paymentStatus}.`},{driverBonId:bonId,driverRateSnapshot:bon.rateSnapshot});
 const current=await register.get(tx,id);const proposal={bonId,chargeId:result.charge.id,approvalId:result.approval.id,amount:bon.amount,proposedById:user.id,proposedAt:new Date().toISOString()};
 await tx.seaBill.update({where:{id},data:{registerData:{...current.registerData,driverCostProposals:[...(current.registerData?.driverCostProposals||[]),proposal]}}});
 await audit(tx,user,'DRIVER_BON_COST_PROPOSED','JobOrder',bill.jobId,{seaBillId:id,...proposal});return result;
}
// Read-only bill projection; wages, payroll and parent payment totals stay at journey scope.
async function operations(tx,id){
 const bill=await register.get(tx,id),result={journeyId:bill.journeyId||null,works:[],mappingRequired:false,readOnly:true};
 if(!bill.journeyId)return result;
 const parent=await require('./journeys').get(tx,bill.journeyId);
 const active=parent.bills.filter(b=>!require('./registerLifecycle').isTrashed(b));
 const key=require('./driverTariffs').key,ownNumbers=new Set(register.normalize({},bill).containers.map(c=>key(c.number)));
 const allowedEvidence=new Set((bill.files||[]).filter(f=>f.filename).map(f=>f.id));
 for(const work of parent.data?.driverOperations?.works||[]){
  if(require('./driverDeliveries').hasChildren(work)){if(require('./driverDeliveries').billIds(work).includes(id))result.works.push(require('./billDriverOperations').projectWork(bill,parent,work));continue;}
  const containerKey=key(work.containerNumber||work.containerKey);
  const owners=active.filter(b=>register.normalize({},b).containers.some(c=>key(c.number)===containerKey));
  const owns=work.billId?work.billId===id:owners.length===1&&owners[0].id===id;
  if(!work.billId&&ownNumbers.has(containerKey)&&owners.length>1)result.mappingRequired=true;
  if(!owns)continue;
  const fields=['id','number','status','containerNumber','containerKey','size','driverName','vehicleNumber','origin','destination','rateType','receivedDate','receiptReference','items','notes','createdAt','updatedAt','verifiedAt'];
  result.works.push({...Object.fromEntries(fields.filter(k=>work[k]!==undefined).map(k=>[k,work[k]])),billId:id,evidenceFileIds:(work.evidenceFileIds||[]).filter(fileId=>allowedEvidence.has(fileId))});
 }
 return result;
}
module.exports={rows,normalize,list,save,proposeCost,operations,STATUSES,transitions};

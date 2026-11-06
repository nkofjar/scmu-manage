const {fail,choice,money}=require('./jpt'),{isTrashed}=require('./registerLifecycle');
const {key}=require('./driverTariffs'),{arrayPage,pageOptions}=require('./pagination');
const deliveries=require('./driverDeliveries');
function period(query,now=new Date()){
 const month=query.month??new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jayapura',year:'numeric',month:'2-digit'}).format(now);
 fail(typeof month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month)&&month.slice(0,4)!=='0000','Isi bulan YYYY-MM yang valid.');
 return month;
}
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
async function list(tx,query={}){
 const month=period(query);pageOptions(query);choice(query.status||'VERIFIED',['VERIFIED'],'Status');
 if(query.payrollStatus)choice(query.payrollStatus,['NOT_LINKED','MISSING','VOID','PROPOSED','APPROVED','REJECTED','PART_PAID','PAID','UNPAID'],'Status upah');
 if(query.ownership)choice(query.ownership,['INTERNAL','VENDOR','UNKNOWN'],'Kepemilikan');if(query.size)choice(query.size,['20','40'],'Ukuran');
 const journeys=await tx.shippingJourney.findMany({where:{deletedAt:null},select:{id:true,number:true,deletedAt:true,archivedAt:true,data:true,bills:{select:{id:true,registerData:true,containers:true}}},orderBy:{id:'asc'}}),rows=[],seen=new Set();
 for(const journey of journeys){if(journey.deletedAt)continue;const bills=journey.bills.filter(b=>!isTrashed(b));
  for(const work of journey.data?.driverOperations?.works||[]){
   const receivedDate=deliveries.hasChildren(work)?deliveries.completionDate(work.deliveries):work.receivedDate;
   if(work.status!=='VERIFIED'||!validDate(receivedDate)||receivedDate.slice(0,7)!==month)continue;
   const owners=work.billId?bills.filter(b=>b.id===work.billId):bills.filter(b=>(b.containers||[]).some(c=>key(c.number)===key(work.containerNumber||work.containerKey)));if(!owners.length)continue;
   const id=JSON.stringify([journey.id,work.id]);if(seen.has(id))continue;seen.add(id);
   const employmentType=work.driverId&&['INTERNAL','VENDOR'].includes(work.driverEmploymentType)?work.driverEmploymentType:'UNKNOWN';
   if(query.driverId&&work.driverId!==query.driverId||query.vehicleId&&work.vehicleId!==query.vehicleId||query.ownership&&employmentType!==query.ownership||query.size&&String(work.size)!==query.size)continue;
   rows.push({id,journeyId:journey.id,journeyNumber:journey.number,billId:work.billId||null,billIds:deliveries.billIds(work),workId:work.id,number:work.number||null,driverId:work.driverId||null,driverName:work.driverName||null,employmentType,vehicleId:work.vehicleId||null,vehicleNumber:work.vehicleNumber||null,containerNumber:work.containerNumber||null,containerNumbers:[...new Set([work.containerNumber,...(work.deliveries||[]).map(d=>d.containerNumber)].filter(Boolean).map(key))],size:work.size==null?null:String(work.size),rateType:work.rateType||null,receivedDate,status:work.status,payrollId:work.payrollId||null,payrollJourneyId:journey.id,payrollUrl:`/shipments/${encodeURIComponent(journey.id)}?tab=driver-bons`});
  }
 }
 await payrollBalances(tx,journeys,rows);
 if(query.payrollStatus)for(let index=rows.length-1;index>=0;index--){const row=rows[index],matches=query.payrollStatus==='UNPAID'?['APPROVED','PART_PAID'].includes(row.payrollStatus)&&money(row.outstanding).gt(0):row.payrollStatus===query.payrollStatus;if(!matches)rows.splice(index,1);}
 rows.sort((a,b)=>a.receivedDate.localeCompare(b.receivedDate)||a.id.localeCompare(b.id));
 const groups=new Map();for(const row of rows){const id=row.driverId?'driver:'+row.driverId:'unmapped:'+row.id;let group=groups.get(id);if(!group){group={key:id,driverId:row.driverId,driverName:row.driverName,employmentType:row.employmentType,rit20:0,rit40:0,ritOther:0,rb:0,rk:0,tonase:0,rbs:0,total:0,payrollLinked:0,payrollPending:0};groups.set(id,group);}if(group.employmentType!==row.employmentType)group.employmentType='UNKNOWN';group.total++;group[row.size==='20'?'rit20':row.size==='40'?'rit40':'ritOther']++;if(row.rateType==='RB')group.rb++;if(row.rateType==='RK')group.rk++;if(row.rateType==='TONASE')group.tonase++;if(row.rateType==='RBS')group.rbs++;group[row.payrollId?'payrollLinked':'payrollPending']++;}
 const warnings=[];if(rows.some(r=>!r.driverId))warnings.push({code:'UNMAPPED_DRIVER',message:'Nama lama belum dipetakan; setiap pekerjaan tetap terpisah, bukan digabung berdasarkan nama.'});if(rows.some(r=>!['20','40'].includes(r.size)))warnings.push({code:'NON_STANDARD_SIZE',message:'Ukuran 21 atau tidak diketahui dicatat terpisah, bukan dihitung sebagai 20ft.'});
 return {period:month,countingUnit:'VERIFIED_WORK',sizeClassification:'PRIMARY_CONTAINER',physicalContainerCount:new Set(rows.flatMap(r=>r.containerNumbers.map(n=>JSON.stringify([r.journeyId,n])))).size,summary:[...groups.values()],warnings,...arrayPage(rows,query)};
}
async function payrollBalances(tx,journeys,rows){
 const recaps=new Map();for(const journey of journeys)for(const recap of journey.data?.driverOperations?.recaps||[])recaps.set(JSON.stringify([journey.id,recap.id]),recap);
 const ids=[...new Set(rows.map(row=>recaps.get(JSON.stringify([row.journeyId,row.payrollId]))?.chargeId).filter(Boolean))];
 const charges=new Map((ids.length?await tx.jobCharge.findMany({where:{id:{in:ids}},include:{payments:true}}):[]).map(charge=>[charge.id,charge]));
 for(const row of rows){
  const recap=recaps.get(JSON.stringify([row.journeyId,row.payrollId])),charge=charges.get(recap?.chargeId);
  Object.assign(row,{payrollStatus:row.payrollId?'MISSING':'NOT_LINKED',paidAmount:null,outstanding:null,payrollAmountScope:row.payrollId?'RECAP':null});
  if(!row.payrollId)continue;
  if(recap?.voidedAt)row.payrollStatus='VOID';
  if(!charge)continue;
  const paid=(charge.payments||[]).reduce((sum,payment)=>sum.plus(payment.amount),money(0)),amount=money(charge.actualAmount??recap.amount);
  Object.assign(row,{chargeId:charge.id,paidAmount:paid.toFixed(2),outstanding:amount.minus(paid).toFixed(2)});
  if(!recap.voidedAt)row.payrollStatus=charge.status==='APPROVED'?(paid.gte(amount)?'PAID':paid.gt(0)?'PART_PAID':'APPROVED'):charge.status;
 }
}
module.exports={list,period};

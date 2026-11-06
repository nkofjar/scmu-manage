const { fail, text, choice, date, number, customer, audit } = require('./jpt');
const sea = require('./seaBills');
const include = {...sea.seaInclude, document:true, allocations:{...sea.seaInclude.allocations,include:{packingList:{select:{...sea.CARGO_SELECT,document:{select:{filename:true}}}}}}, job:{select:{jobNumber:true,status:true,currency:true}}};
const json = value => JSON.parse(JSON.stringify(value));
function present(bill) {
 const data=normalize({},bill);
 return {...sea.present(bill),job:undefined,jobStatus:bill.job?.status,jobNumber:bill.job?.jobNumber,registerNumber:bill.registerNumber,...data,deleted:require('./registerLifecycle').isTrashed(bill),registerAmount:bill.registerAmount==null?null:new (require('@prisma/client').Prisma.Decimal)(bill.registerAmount).toFixed(2),amountMeaning:'UNCONFIRMED',archivedAt:bill.archivedAt||bill.registerData?.archivedAt||null,archivedById:bill.archivedById||bill.registerData?.archivedById||null,archived:Boolean(bill.archivedAt||bill.registerData?.archivedAt),documentAvailability:availability(bill),workflow:require('./shipmentWorkflow').status(bill),documentSummary:{internalStatus:bill.internalStatus,releaseStatus:bill.releaseStatus,receiptStatus:sea.receipt(bill)},dateWarning:data.register.dateMeaning==='UNCONFIRMED'?'Date meaning is unconfirmed; do not assume vessel, container, or document arrival.':null};
}
function availability(bill) {
 const external=Boolean(bill.files?.some(row=>row.filename&&row.category==='PACKING_LIST')||bill.allocations?.some(row=>row.packingList?.document?.filename));const internal=require('./internalPacking').ready(bill);
 return {billOfLading:!bill.registerData?.documentState?.blMissing&&Boolean(bill.document?.filename || bill.files?.some(row=>row.filename&&['DRAFT','FINAL','LEGACY'].includes(row.category))),packingList:external||internal,externalPackingList:external,internalPackingList:internal,fieldInspection:require('./packingFieldChecks').status(bill),packingHeader:Boolean(bill.files?.some(row=>row.filename&&row.category==='PACKING_HEADER')),internalPackingRecap:require('./packingRecap').ready(bill),supporting:Boolean(bill.files?.some(row=>row.filename&&row.category==='SUPPORTING'))};
}
async function get(tx,id) {
 const bill=await tx.seaBill.findUnique({where:{id},include});fail(bill,'BL register record not found',404);return require('./documentScope').annotate(tx,bill);
}
async function registerNumber(tx,value,before) {
 const result=before ? text(value,'Register number',100) : require('./registerFields').optionalText(value,'Register number',100)||`REG-${require('crypto').randomUUID().toUpperCase()}`;
 const found=await tx.seaBill.findFirst({where:{registerNumber:result}});
 fail(!found || found.id===before?.id,'This register number is already used',409);
 return result;
}
async function create(tx,user,body) {
 const billNumber=text(body.billNumber,'BL number',100,true);
 const registerAmount=require('./registerFields').registerAmount(body.registerAmount);
 const identity=await registerNumber(tx,body.registerNumber);
 const links=await require('./vessels').links(tx,body);
 const journey=await require('./journeys').forBill(tx,user,{...body,...links});
 const ops=normalize(body);const fields=sea.metadata({...body,billNumber,containers:ops.containers.map(({number,seal})=>({number,seal}))});
 await sea.registerIdentity(tx,billNumber);
 const owner=await customer(tx);
 const job=await tx.jobOrder.create({data:{jobNumber:number('JOB'),jobType:'RECEIVER',title:billNumber?`BL ${billNumber}`:'Draf pengiriman',customerId:owner.id,originCity:fields.portOfLoading||'Unconfirmed',destCity:fields.portOfDischarge||'Unconfirmed',cargoDescription:ops.register.cargoDescription||'Unconfirmed',packages:0,currency:'IDR',recipientName:owner.name,createdById:user.id}});
 // This is a pending record of an existing sea document, NOT vendor procurement,
 // an approved booking, or evidence of receipt/release. No carrier or freight is awarded.
 const shipment=await tx.shipment.create({data:{jobId:job.id,shipmentNumber:number('SHP'),mode:'SEA',transportSource:'EXTERNAL',status:'PENDING',shipperCompanyId:owner.id,originCity:job.originCity,destCity:job.destCity,originState:'Unconfirmed',destState:'Unconfirmed',loadingDate:new Date(),notes:'Preliminary BL register reference only; not an approved transport booking. Operational date meaning remains in the register.',createdById:user.id}});
 const bill=await sea.createBill(tx,user,job.id,{...fields,shipmentId:shipment.id});
 await tx.seaBill.update({where:{id:bill.id},data:{registerNumber:identity,registerIdentity:billNumber?.toUpperCase()||null,registerData:json({...ops,workflowVersion:2}),registerAmount,...links,...(journey?{journeyId:journey.id}:{})}});
 if(journey)await tx.shippingJourney.update({where:{id:journey.id},data:{version:{increment:1}}});
 await audit(tx,user,'BL_REGISTER_CREATED','JobOrder',job.id,{seaBillId:bill.id,register:ops,registerAmount:registerAmount?.toFixed(2)||null,registerNumber:identity});
 return present(await get(tx,bill.id));
}
const STATUSES = sea.STATUSES;

function normalize(body, before = {}) {
  fail(body.register === undefined || body.register && typeof body.register==='object' && !Array.isArray(body.register), 'Register details must be an object');
  const previous=before.registerData || {};
  const input={...(previous.register||{}),...(body.register||{})};
  const register={...require('./registerFields').normalizeFields(input),dateMeaning:choice(input.dateMeaning||'UNCONFIRMED',['UNCONFIRMED','VESSEL','CONTAINER','DOCUMENT'],'Date meaning')};
  fail(register.dateMeaning==='UNCONFIRMED' || !register.departureDate || !register.arrivalDate || register.arrivalDate>=register.departureDate, 'Arrival must follow departure');
  const documents=before.containers || [];
  const saved=previous.containers || [];
  const ordered=[...saved.filter(row=>documents.some(item=>item.number===row.number)).map(row=>documents.find(item=>item.number===row.number)),...documents.filter(row=>!saved.some(item=>item.number===row.number))];
  const source=body.containers ?? ordered;
  fail(Array.isArray(source)&&source.length<=100&&source.every(row=>row&&typeof row==='object'&&!Array.isArray(row)), 'Enter up to 100 valid containers');
  const merged=source.map(row=>{
    const number=String(row.number||'').trim().toUpperCase();
    const document=documents.find(item=>item.number===number) || {};
    const old=saved.find(item=>item.number===number) || {};
    // Legacy extras are fallback only; document number/seal remain authoritative.
    return {...sea.historicalOperational({...document,...old}),number,seal:document.seal,...(body.containers===undefined?{}:row)};
  });
  const identities=sea.metadata({containers:merged}).containers;
  const containers=identities.map(data=>sea.operational(data,true));
  return {...previous,register,containers};
}
async function update(tx,user,id,body) {
 const before=await get(tx,id);
 fail(!before.archivedAt && !before.registerData?.archivedAt,'Archived register records are read-only',409);
 const amount=body.registerAmount===undefined?{}:{registerAmount:require('./registerFields').registerAmount(body.registerAmount)};
 const registerIdentity=body.registerNumber===undefined?{}:{registerNumber:await registerNumber(tx,body.registerNumber,before)};
 await sea.getBill(tx,before.jobId,id,body.version);
 const links=await require('./vessels').links(tx,body,before);
 if(before.journeyId){const parent=await tx.shippingJourney.findUnique({where:{id:before.journeyId}});require('./journeys').mutable(parent);fail(require('./journeys').compatible(parent,{...before,...body,...links}),'B/L identity differs from its vessel journey. Check the parent shipment.',409);}
 const ops=normalize(body,before);
 if(body.containers!==undefined)await require('./driverOperations').assertBillChange(tx,before,ops.containers);
 const recapHash=before.registerData?.internalRecap?.valid?require('./packingRecap').fingerprint(before):null;
 const activeBons=(before.registerData?.driverBons||[]).filter(row=>!['COMPLETED','CANCELLED'].includes(row.status));
 for(const bon of activeBons)fail((bon.containerNumbers||[]).every(n=>ops.containers.some(c=>c.number===n)),`Kontainer masih terhubung ke bonrate ${bon.number}. Perbarui bonrate terlebih dahulu sebelum menghapus atau mengganti nomornya.`,409);
 const identity=ops.containers.map(({number,seal})=>({number,seal}));
 const sorted=rows=>JSON.stringify(rows.map(({number,seal})=>({number,seal:seal||null})).sort((a,b)=>a.number.localeCompare(b.number)));
 const identityKeys=['billNumber','documentKind','issueDate','onBoardDate','notifyPartyName','carrierName','vesselName','voyageNumber','portOfLoading','portOfDischarge','shipperName','consigneeName','packages','grossWeightKg','volumeCbm','reviewIssues','allocations'];
 const material=identityKeys.some(key=>body[key]!==undefined && JSON.stringify(body[key])!==JSON.stringify(before[key])) || sorted(identity)!==sorted(before.containers||[]);
 const headerBook=book=>[book?.departureDate,book?.arrivalDate,book?.cargoDescription];
 if(ops.operational?.packing && (material || JSON.stringify(ops.containers)!==JSON.stringify(before.registerData?.containers) || JSON.stringify(headerBook(ops.register))!==JSON.stringify(headerBook(before.registerData?.register)))) ops.operational={...ops.operational,packing:{...ops.operational.packing,headerStatus:'DRAFT'}};
 if(body.billNumber!==undefined) await sea.registerIdentity(tx,text(body.billNumber,'BL number',100,true),before);
 if(material) await sea.updateBill(tx,user,before.jobId,id,{...body,containers:identity});
 await tx.seaBill.update({where:{id},data:{registerData:json(ops),...amount,...registerIdentity,...links,...(!material?{version:{increment:1},...(body.notes!==undefined?{notes:text(body.notes,'Notes',3000,true)}:{})}:{})}});
 await audit(tx,user,'BL_REGISTER_UPDATED','JobOrder',before.jobId,{seaBillId:id,before:before.registerData,after:ops,...amount,...registerIdentity});
 const saved=await get(tx,id);
 if(recapHash&&recapHash!==require('./packingRecap').fingerprint(saved))await require('./packingRecap').invalidateShared(tx,user,before);
 return present(saved);
}
async function list(tx,query={}) {
 const {pageMeta,pageOptions}=require('./pagination');pageOptions(query);
 const {where,orderBy,archiveWhere}=await require('./registerQuery').registerQuery(tx,query);
 const total=await tx.seaBill.count({where});const meta=pageMeta(total,query);
 const totalRegisters=await tx.seaBill.count({where:archiveWhere});
 const facts=await tx.seaBill.findMany({where,select:{id:true,contentVersion:true,registerNumber:true,billNumber:true,vesselName:true,voyageNumber:true,vesselId:true,voyageId:true,shipperName:true,consigneeName:true,portOfDischarge:true,vessel:{select:{name:true}},voyage:{select:{period:true}},portOfLoading:true,createdAt:true,containers:true,packages:true,volumeCbm:true,registerData:true,internalStatus:true,releaseStatus:true,document:{select:{filename:true}},files:{select:{id:true,category:true,filename:true,originalName:true,externalNumber:true,documentDate:true}},allocations:{select:{packingList:{select:{document:{select:{filename:true}}}}}},job:{select:{status:true}}}});
 const month=query.month||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jayapura',year:'numeric',month:'2-digit'}).format(new Date());
 const summary={totalRegisters,filteredRegisters:total,periodRegisters:0,missingBL:0,missingPackingList:0,incompleteRegisters:0,activeBills:0,pendingPort:0,dooring:0,pendingEmpty:0,incompleteDocuments:0,freeTimeAlerts:0,deadlineAlerts:0,fieldInspectionPending:0};
 const vessels=new Map();const voyages=new Map();const vesselVoyages=new Map();
 for(const bill of facts){
  const flags=availability(bill);const date=bill.registerData?.register?.arrivalDate||bill.createdAt;
  if(date&&new Date(date).toISOString().slice(0,7)===month)summary.periodRegisters++;
  if(!flags.billOfLading)summary.missingBL++;
  if(!flags.internalPackingList)summary.missingPackingList++;
  if(!bill.vesselName||!bill.voyageNumber||!bill.portOfLoading||!flags.billOfLading)summary.incompleteRegisters++;
  for(const [map,key]of [[vessels,'vesselName'],[voyages,'voyageNumber']]){const name=bill[key]||'';map.set(name,(map.get(name)||0)+1);}
  const vesselVoyageKey=JSON.stringify([bill.vesselId||bill.vesselName||'',bill.voyageId||bill.voyageNumber||'']);
  const groupRow=vesselVoyages.get(vesselVoyageKey)||{vesselId:bill.vesselId||null,voyageId:bill.voyageId||null,vesselName:bill.vessel?.name||bill.vesselName||'',voyageNumber:bill.voyageNumber||'',period:bill.voyage?.period||null,count:0};groupRow.count++;vesselVoyages.set(vesselVoyageKey,groupRow);
  if(['CLOSED','CANCELLED'].includes(bill.job?.status))continue;
  summary.activeBills++;
  const containers=normalize({},bill).containers;
  summary.pendingPort+=containers.filter(row=>['REGISTERED','READY'].includes(row.status)).length;
  summary.dooring+=containers.filter(row=>row.status==='DOORING').length;
  summary.pendingEmpty+=containers.filter(row=>['GATE_OUT','DOORING','STRIPPED'].includes(row.status)&&!row.emptyReturnedAt).length;
  summary.freeTimeAlerts+=containers.filter(row=>row.freeTimeUntil&&!row.emptyReturnedAt&&new Date(row.freeTimeUntil)<=new Date(Date.now()+3*86400000)).length;
  const workspace=require('./blWorkspace').operationalOf(bill);const limit=Date.now()+3*86400000;
  summary.deadlineAlerts+=['storageUntil','demurrageFrom','emptyReturnDue'].filter(key=>workspace.deadlines[key]&&new Date(workspace.deadlines[key]).getTime()<=limit).length;
  if(flags.internalPackingList&&flags.fieldInspection!=='CONFIRMED')summary.fieldInspectionPending++;
  if(!flags.billOfLading)summary.incompleteDocuments++;
 }
 const group=(map,key)=>[...map.entries()].map(([name,count])=>({[key]:name,count})).sort((a,b)=>b.count-a.count||a[key].localeCompare(b[key]));
 summary.byVessel=group(vessels,'vesselName');summary.byVoyage=group(voyages,'voyageNumber');summary.byVesselVoyage=[...vesselVoyages.values()].sort((a,b)=>b.count-a.count||a.vesselName.localeCompare(b.vesselName)||a.voyageNumber.localeCompare(b.voyageNumber));summary.periodMonth=month;
 summary.recentRegisters=[...facts].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)||b.id.localeCompare(a.id)).slice(0,5).map(({id,registerNumber,billNumber,vesselName,voyageNumber,createdAt})=>({id,registerNumber,billNumber,vesselName,voyageNumber,createdAt}));
 const data=await tx.seaBill.findMany({where,include,orderBy,skip:(meta.page-1)*meta.limit,take:meta.limit});
 return {...meta,totalPages:meta.pages,data:data.map(present),summary};
}
async function collectAll(tx,query={}) {
 const {where,orderBy}=await require('./registerQuery').registerQuery(tx,query);
 return (await tx.seaBill.findMany({where,include,orderBy})).map(present);
}
async function archive(tx,user,id,body) {
 fail(require('./jpt').STAFF.includes(user?.role),'Only internal staff can archive registers',403);
 const bill=await get(tx,id);fail(typeof body.archived==='boolean','Archive choice must be true or false');
 if(bill.journeyId){const parent=await tx.shippingJourney.findUnique({where:{id:bill.journeyId}});fail(!parent.deletedAt&&!parent.archivedAt,'Pengiriman induk di arsip/Sampah hanya dapat dibaca.',409);}
 fail(!require('./registerLifecycle').isTrashed(bill),'Pengiriman berada di Sampah. Gunakan Pulihkan dari Sampah.',409);
 fail(require('./jpt').integer(body.version,'Version')===bill.version,'BL changed; reload before saving',409);
 const data={...bill.registerData};
 delete data.archivedAt;delete data.archivedById;
 await tx.seaBill.update({where:{id},data:{registerData:json(data),archivedAt:body.archived?new Date():null,archivedById:body.archived?user.id:null,version:{increment:1}}});
 await audit(tx,user,body.archived?'BL_REGISTER_ARCHIVED':'BL_REGISTER_RESTORED','JobOrder',bill.jobId,{seaBillId:id,archived:body.archived});
 return present(await get(tx,id));
}
async function estimate(tx,id,body) {
 const bill=await get(tx,id);
 fail(!require('./registerLifecycle').isTrashed(bill),'Pengiriman berada di Sampah. Gunakan Pulihkan dari Sampah.',409);
 fail(!bill.archivedAt&&!bill.registerData?.archivedAt,'Archived register records are read-only',409);
 if(body.version!==undefined) fail(require('./jpt').integer(body.version,'Version')===bill.version,'BL changed; reload before estimating',409);
 fail(Array.isArray(body.tariffIds)&&body.tariffIds.every(id=>typeof id==='string')&&body.tariffIds.length<=100,'Select valid tariffs');
 const tariffs=await tx.jptTariff.findMany({where:{id:{in:body.tariffIds}}});
 return require('./jptTariffs').estimate(present(bill),tariffs,body.tariffIds);
}
async function charges(tx,user,id,body) {
 const bill=await get(tx,id);await sea.getBill(tx,bill.jobId,id,body.version);
 fail(bill.job.currency==='IDR','Tariffs require an IDR job',409);
 const calculation=await estimate(tx,id,body);const result=[];const approvals=[];
 for(const line of calculation.lines) {
  const tariffKey=`${id}:${line.tariffId}`;
  fail(!await tx.jobCharge.findFirst({where:{tariffKey}}),'This tariff is already proposed for this BL; use the existing charge',409);
 }
 for(const line of calculation.lines) {
  const snapshot=json({billId:id,billNumber:bill.billNumber,registerNumber:bill.registerNumber,line,currency:'IDR',containerNumbers:present(bill).containers.map(row=>({number:row.number,size:row.size})),notice:require('./jptTariffs').NOTICE});
  const charge=await tx.jobCharge.create({data:{jobId:bill.jobId,shipmentId:bill.shipmentId,kind:'REVENUE',status:'PROPOSED',description:`${line.description} — ${bill.billNumber||bill.id}: ${line.quantity} ${line.unit} × ${line.unitPrice}`.slice(0,300),estimatedAmount:require('./jpt').decimal(line.amount),tariffKey:`${id}:${line.tariffId}`,tariffSnapshot:snapshot,createdById:user.id,notes:require('./jptTariffs').NOTICE}});
  await audit(tx,user,'CHARGE_PROPOSED','JobOrder',bill.jobId,{chargeId:charge.id,seaBillId:id,tariffSnapshot:snapshot});
  approvals.push(await require('./director').submit(tx,user,'CHARGE_APPROVE',charge.id,{actualAmount:line.amount},'Explicit BL tariff selection; immutable price snapshot.'));
  result.push(charge);
 }
 await tx.seaBill.update({where:{id},data:{version:{increment:1}}});
 return {jobId:bill.jobId,jobNumber:bill.job.jobNumber,jobUrl:`/jobs/${bill.jobId}`,charges:result,approvals,version:bill.version+1,...calculation};
}
module.exports={normalize,STATUSES,create,get,present,include,update,list,collectAll,archive,availability,estimate,charges};

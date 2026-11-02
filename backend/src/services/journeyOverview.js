const {isTrashed}=require('./registerLifecycle');
const {fail,choice}=require('./jpt');
const TASKS=['missing-documents','pending-bons','missing-packing','pending-recaps'];
function packingBill(bill){
 const sources=require('./packingSources'),type=sources.preferredType(bill),source=sources.sourceOf(bill,type);
 const files=require('./shipmentDocuments').linkedFiles(bill);
 let detailReady=false;try{detailReady=require('./internalPacking').sourceSnapshot(bill,type).groups.length>0;}catch{/* An incomplete source remains a draft. */}
 const flags=require('./blRegister').availability(bill);
 const fileDates=files.filter(f=>['PACKING_LIST','INTERNAL_PACKING_LIST','INTERNAL_PACKING_RECAP','RECEIVING_REPORT'].includes(f.category)).map(f=>f.createdAt).filter(Boolean);
 return {sourceType:type,sourceStatus:source.status||'DRAFT',detailReady,partnerReady:files.some(f=>f.category==='PACKING_LIST'),partnerRequired:bill.registerData?.register?.documentPolicy==='BL_AND_PACKING',internalReady:flags.internalPackingList,recapReady:require('./packingRecap').ready(bill),blRecapReady:require('./voyagePacking').available(bill),billFileReady:flags.billOfLading,reviewed:bill.internalStatus==='SEA_MATCHED',updatedAt:fileDates.length?new Date(Math.max(...fileDates.map(d=>new Date(d).getTime()))).toISOString():null};
}
function facts(row){
 const bills=(row.bills||[]).filter(b=>!isTrashed(b)&&!b.archivedAt&&!b.registerData?.archivedAt),details=bills.map(packingBill),works=row.data?.driverOperations?.works||[];
 const count=fn=>details.filter(fn).length;
 return {billCount:bills.length,partnerReady:count(d=>d.partnerReady),partnerRequired:count(d=>d.partnerRequired),internalReady:count(d=>d.internalReady),recapReady:count(d=>d.recapReady),blRecapReady:count(d=>d.blRecapReady),detailReady:count(d=>d.detailReady),missingDocuments:count(d=>!d.billFileReady||d.partnerRequired&&!d.partnerReady),missingPacking:count(d=>d.partnerRequired&&!d.partnerReady||!d.internalReady),pendingRecaps:count(d=>d.detailReady&&!d.recapReady),pendingBons:works.filter(w=>w.status==='SUBMITTED').length,packingUpdatedAt:details.map(d=>d.updatedAt).filter(Boolean).sort().at(-1)||null};
}
function matches(row,task){if(!task)return true;choice(task,TASKS,'Pekerjaan');const f=facts(row);return Boolean(f[{'missing-documents':'missingDocuments','pending-bons':'pendingBons','missing-packing':'missingPacking','pending-recaps':'pendingRecaps'}[task]]);}
async function dashboard(tx){
 const journeys=await require('./journeys').list(tx,{limit:5,page:1,archived:'active'});
 const rows=await tx.shippingJourney.findMany({where:{archivedAt:null,deletedAt:null},include:require('./journeys').include()});
 const taskFacts=rows.map(facts),pendingApprovals=await tx.directorApproval.count({where:{status:'SUBMITTED'}});
 return {...journeys,tasks:{missingDocuments:taskFacts.reduce((n,f)=>n+f.missingDocuments,0),pendingBons:taskFacts.reduce((n,f)=>n+f.pendingBons,0),missingPacking:taskFacts.reduce((n,f)=>n+f.missingPacking,0),pendingRecaps:taskFacts.reduce((n,f)=>n+f.pendingRecaps,0),pendingApprovals}};
}
module.exports={packingBill,facts,matches,dashboard,TASKS};

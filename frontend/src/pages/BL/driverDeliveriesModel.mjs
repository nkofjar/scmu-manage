export const blankGoods=()=>({goodsTypeId:null,label:'',packaging:'',quantity:'',packageWeightKg:''});
export const blankDelivery=(billId='',containerNumber='')=>({billId,containerNumber,recipient:'',destination:'',items:[blankGoods()],receivedDate:'',evidenceFileIds:[]});
export function editDeliveries(work){
 if(Array.isArray(work.deliveries)&&work.deliveries.length)return structuredClone(work.deliveries).map(d=>({...d,items:(d.items||[]).map(i=>({...i,label:i.label??i.goodsType??'',packaging:i.packaging??i.collyType??'',quantity:i.quantity??i.collyCount??'',packageWeightKg:i.packageWeightKg??''}))}));
 return [{...blankDelivery(work.billId||'',work.containerNumber||''),recipient:work.items?.[0]?.owner||'',destination:work.destination||'',receivedDate:work.receivedDate||'',evidenceFileIds:[...(work.evidenceFileIds||[])],items:work.items?.length?work.items.map(item=>({...item,goodsTypeId:item.goodsTypeId||null,label:item.label??item.goodsType??'',packaging:item.packaging??item.collyType??'',quantity:item.quantity??item.collyCount??'',packageWeightKg:item.packageWeightKg??''})):[blankGoods()]}];
}
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function deliveryProgress(work){
 const deliveries=Array.isArray(work.deliveries)&&work.deliveries.length?work.deliveries:editDeliveries(work);
 const complete=deliveries.filter(d=>d.billId&&d.containerNumber&&d.recipient?.trim()&&d.destination?.trim()&&validDate(d.receivedDate)&&d.evidenceFileIds?.length&&d.items?.length&&d.items.every(i=>(i.label||i.goodsType)?.trim()&&(i.packaging||i.collyType)?.trim()&&Number(i.quantity??i.collyCount)>0));
 return {complete:complete.length,total:deliveries.length,receivedDate:complete.length===deliveries.length?complete.map(d=>d.receivedDate).sort().at(-1)||'':''};
}
export const workEvidenceIds=work=>[...new Set([...(work.evidenceFileIds||[]),...(work.deliveries||[]).flatMap(d=>d.evidenceFileIds||[])])];
export function scopedDeliveryFiles(files,billId,{selectedBillId}={}){
 return files.filter(file=>['POD','DELIVERY_RECEIPT'].includes(file.category)||!file.category).filter(file=>{
  const ids=file.billIds||(file.billId?[file.billId]:selectedBillId&&file.source!=='JOURNEY'?[selectedBillId]:[]);
  return Boolean(billId)&&ids.includes(billId);
 });
}
export const evidenceKey=file=>file.evidenceId||file.evidenceIds?.[0]||file.id;
export function appendDeliveryEvidence(form,index,id){return {...form,deliveries:(form.deliveries||editDeliveries(form)).map((d,i)=>i===index?{...d,evidenceFileIds:[...new Set([...(d.evidenceFileIds||[]),id])]}:d)};}
export const blankDriverWork=(billId='',containerNumber='')=>({billId,containerNumber,driverName:'',vehicleNumber:'',driverId:null,vehicleId:null,taskDate:'',routeId:null,rateType:'RB',receivedDate:'',items:[],evidenceFileIds:[],deliveries:[blankDelivery(billId,containerNumber)],notes:''});

export function driverWorkPayload(form){return {...form,items:[],evidenceFileIds:[],deliveries:(form.deliveries||[]).map(d=>({...d,items:(d.items||[]).map(i=>({owner:i.owner||d.recipient||'',goodsType:i.label??i.goodsType??'',...(i.goodsTypeId?{goodsTypeId:i.goodsTypeId}:{}),collyType:i.packaging??i.collyType??'',collyCount:i.quantity??i.collyCount??'',packageWeightKg:i.packageWeightKg===''||i.packageWeightKg==null?null:i.packageWeightKg}))}))};}

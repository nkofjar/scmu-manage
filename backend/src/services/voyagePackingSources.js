const {fail,integer,text}=require('./jpt');
const workspace=require('./blWorkspace');
const {canonical}=require('./packingImport');
const optional=(v,label,max=500)=>text(typeof v==='string'?v.trim():v,label,max,true);
function summary(entries){
 const units=[...new Set(entries.map(e=>e.unit))];
 return {quantity:entries.length&&units.length===1&&units[0]&&entries.every(e=>e.quantity!=null)?entries.reduce((n,e)=>n+e.quantity,0):null,unit:entries.length&&units.length===1?units[0]:null};
}
function groupCount(g){return summary(g.dataLevel==='SUMMARY'?[{quantity:g.summaryPackages,unit:g.packageUnit}]:g.items.map(i=>({quantity:i.packages,unit:i.packageUnit||null})));}
function review(bill,containers){
 fail(new Set(containers.map(c=>canonical(c.number))).size===containers.length,'Nomor kontainer duplikat / pemetaan ambigu dalam satu B/L.',409);
 const packing=workspace.operationalOf(bill).packing,warnings=[],mapped=new Map(),files=(bill.files||[]).filter(f=>f.category==='PACKING_LIST'&&f.filename),ids=packing.sourceFileIds||[];
 const warn=message=>warnings.push(`B/L ${bill.billNumber}: ${message}`);
 if(files.length&&packing.status==='CONFIRMED'&&!packing.groups.length)warn('PL mitra dikonfirmasi tetapi rincian belum lengkap / belum dipetakan.');
 if((files.length||packing.groups.length)&&packing.status!=='CONFIRMED')warn('PL mitra belum dikonfirmasi; gunakan B/L / manual sampai sumber diperiksa.');
 const invalid=new Map(),seen=new Set();
 for(const [index,raw] of packing.groups.entries()){
  const key=canonical(raw.containerNumber),container=containers.find(c=>canonical(c.number)===key);
  if(!container){warn('Kelompok PL mitra belum dipetakan ke kontainer B/L ini.');continue;}
  let normalized;
  try{
   fail(!raw.id||!seen.has(raw.id),'ID kelompok PL mitra duplikat.',409);if(raw.id)seen.add(raw.id);
   fail(new Set((raw.items||[]).map(i=>i.id).filter(Boolean)).size===(raw.items||[]).filter(i=>i.id).length,'ID barang PL mitra duplikat.',409);
   fail(packing.status==='CONFIRMED','PL mitra belum dikonfirmasi.',409);
   const file=files.find(f=>f.id===raw.sourceFileId);
   fail(file&&ids.includes(file.id),'Berkas sumber PL mitra tidak lengkap.',409);
   fail(file.scope?.type!=='SHARED'||packing.scopeConfirmed===true,'Pemetaan sumber bersama belum dikonfirmasi.',409);
   fail(raw.dataLevel==='SUMMARY'||raw.items?.length,'Rincian PL mitra belum lengkap.',409);
   normalized=workspace.packingGroup({...raw,id:raw.id||`group-${index}`,items:(raw.items||[]).map((i,n)=>({...i,id:i.id||`item-${index}-${n}`}))},index,bill,ids,true);
  }catch(error){if(!error.status||error.status<400||error.status>=500)throw error;const message=`B/L ${bill.billNumber}, kontainer ${container.number}: ${error.message}`;warnings.push(message);invalid.set(key,[...(invalid.get(key)||[]),message]);continue;}
  if(raw.dataLevel==='SUMMARY'&&!raw.packageUnit)normalized.packageUnit=null;
  mapped.set(key,[...(mapped.get(key)||[]),normalized]);
 }
 return {packing,files,mapped,invalid,warnings};
}
function row(bill,container,containers,edit,reviewed){
 const key=canonical(container.number),groups=reviewed.mapped.get(key)||[],issues=[...(reviewed.invalid.get(key)||[])],ready=groups.length>0&&!issues.length;
 fail(edit.sourceType==null||['AUTO','PARTNER_PL','BL_MANUAL'].includes(edit.sourceType),'Pilih sumber kontainer yang valid.');
 const sourceType=!edit.sourceType||edit.sourceType==='AUTO'?(ready?'PARTNER_PL':'BL_MANUAL'):edit.sourceType;
 fail(sourceType!=='PARTNER_PL'||ready,'Sumber PL mitra belum dikonfirmasi atau pemetaan kontainer tidak lengkap.',409);
 if(sourceType==='BL_MANUAL'&&ready)issues.push('PL mitra tersedia; B/L / manual dipilih secara eksplisit, bukan tambahan ke total PL.');
 let description,quantity,unit,recipients,sources;
 if(sourceType==='PARTNER_PL'){
  recipients=groups.map(g=>({name:g.recipientName,address:g.recipientAddress,phone:g.recipientPhone,notes:g.notes,...(g.instructions!==undefined?{instructions:g.instructions}:{}),...groupCount(g)}));
  ({quantity,unit}=summary(recipients));
  description=[...new Set(groups.flatMap(g=>g.dataLevel==='SUMMARY'?[g.goodsSummary]:g.items.map(i=>i.description)).filter(Boolean))].join('; ')||null;
  sources=[...new Set(groups.map(g=>g.sourceFileId))].map(id=>{const file=reviewed.files.find(f=>f.id===id);return {id:file.id,billId:bill.id,containerNumber:container.number,filename:file.filename,name:file.originalName,category:file.category,number:file.externalNumber||null,date:file.documentDate?new Date(file.documentDate).toISOString():null,scope:file.scope||null,sourceIdentity:reviewed.packing.sourceIdentity||null,groups:groups.filter(g=>g.sourceFileId===id)};});
  const identity=reviewed.packing.sourceIdentity||{};
  for(const [field,label] of [['vesselName','kapal'],['voyageNumber','voyage'],['billNumber','nomor B/L']])if(identity[field]&&bill[field]&&canonical(identity[field])!==canonical(bill[field]))issues.push(`Konflik ${label} B/L dan PL mitra: ${bill[field]} / ${identity[field]}. Identitas sumber dipertahankan; periksa sebelum operasi.`);
  const seals=[...new Set(groups.map(g=>g.sealNumber).filter(Boolean))];
  if(seals.length>1||seals.some(s=>container.seal&&canonical(s)!==canonical(container.seal)))issues.push('Konflik segel B/L dan PL mitra: '+[container.seal,...seals].filter(Boolean).join(' / ')+'. Segel sumber dipertahankan; periksa sebelum operasi.');
  if(groups.some(g=>g.size&&container.size&&g.size!==container.size))issues.push('Konflik ukuran kontainer B/L dan PL mitra.');
 }else{
  const supplied=Object.hasOwn(edit,'quantity'),blank=edit.quantity==null||typeof edit.quantity==='string'&&!edit.quantity.trim();
  fail(blank||typeof edit.quantity==='number'||typeof edit.quantity==='string'&&/^\d+$/.test(edit.quantity.trim()),'Isi jumlah kemasan berupa bilangan bulat.');
  const declaredUnit=optional(bill.packageUnit||bill.registerData?.register?.packageUnit,'Satuan B/L',30)?.toUpperCase()||null;
  quantity=supplied?(blank?null:integer(edit.quantity,'Jumlah kemasan',0,1000000)):containers.length===1&&declaredUnit&&Number.isInteger(bill.packages)?bill.packages:null;
  unit=optional(edit.unit,'Satuan',30)?.toUpperCase()||(!supplied?declaredUnit:null);
  fail(quantity==null||unit,'Isi satuan untuk jumlah barang.');
  description=optional(edit.description,'Uraian cetak')||container.goodsDescription||bill.registerData?.register?.cargoDescription||null;
  recipients=[{name:bill.consigneeName||null,address:null,phone:null,notes:null,quantity,unit}];
  sources=[{billId:bill.id,billNumber:bill.billNumber,containerNumber:container.number,category:'BILL_OF_LADING',contentVersion:bill.contentVersion||null,description:container.goodsDescription||bill.registerData?.register?.cargoDescription||null,declaredPackages:bill.packages??null,declaredUnit,seal:container.seal||null}];
 }
 return {sourceType,sourceStatus:sourceType==='PARTNER_PL'?'CONFIRMED':ready?'MANUAL_SELECTED':reviewed.packing.groups.length||reviewed.files.length?'PARTNER_INCOMPLETE':'BL_MANUAL',sourceWarnings:issues,description,quantity,unit,recipients,sources};
}
module.exports={review,row};

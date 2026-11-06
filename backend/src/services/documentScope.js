// A physical source may be attached to several bills. Attachment ownership does
// not imply that all cargo in the original belongs to the selected bill.
const MAPPING_WARNING = 'Sumber dipakai beberapa B/L. Pilih hanya bagian milik B/L ini; seluruh PL bukan alokasi otomatis.';
function metadata(bill, file, references = [], voyageFileIds = new Set()) {
  const bills = new Map([[bill.id, {id:bill.id,billNumber:bill.billNumber}]]);
  for (const ref of references) if (ref.filename === file.filename && ref.bill?.id) bills.set(ref.bill.id, ref.bill);
  const owners = [...bills.values()].sort((a,b)=>a.id.localeCompare(b.id));
  // Both voyage output and selected-B/L packing recaps share this category.
  // Only a positive voyage reference identifies an aggregate, not its category.
  const voyage = file.category === 'INTERNAL_PACKING_RECAP' && Boolean(voyageFileIds.has(file.id) || file.filename && bill.registerData?.voyagePacking?.filename === file.filename);
  const scope = {type:voyage?'VOYAGE':owners.length>1?'SHARED':'BL',billIds:owners.map(b=>b.id),billNumbers:owners.map(b=>b.billNumber||null),journeyId:bill.journeyId||null};
  return {...file,scope,readOnly:voyage,mappingWarning:scope.type==='SHARED'&&file.category==='PACKING_LIST'?MAPPING_WARNING:null};
}
async function annotate(tx,bill) {
  const filenames = [...new Set([...(bill.files||[]).map(f=>f.filename),bill.document?.filename,...(bill.allocations||[]).map(a=>a.packingList?.document?.filename)].filter(Boolean))];
  if (!filenames.length) return bill;
  const references = tx.seaBillFile?.findMany ? await tx.seaBillFile.findMany({where:{filename:{in:filenames}},select:{filename:true,bill:{select:{id:true,billNumber:true}}}}) : [];
  // Include legacy packing originals linked through explicit cargo allocations.
  if (tx.seaBillCargo?.findMany) {
    const links = await tx.seaBillCargo.findMany({where:{packingList:{document:{filename:{in:filenames}}}},select:{bill:{select:{id:true,billNumber:true}},packingList:{select:{document:{select:{filename:true}}}}}});
    references.push(...links.map(row=>({filename:row.packingList?.document?.filename,bill:row.bill})));
  }
  const recapIds = (bill.files||[]).filter(f=>f.category==='INTERNAL_PACKING_RECAP').map(f=>f.id);
  const voyageFileIds = new Set();
  // The current pointer is replaced on regeneration; audit provenance preserves
  // the identity of historical voyage attachments without guessing from names.
  if (recapIds.length && tx.activityLog?.findMany) {
    const logs = await tx.activityLog.findMany({where:{entity:'JobOrder',entityId:bill.jobId,action:'VOYAGE_PACKING_CREATED',AND:[{metadata:{path:['seaBillId'],equals:bill.id}},{OR:recapIds.map(id=>({metadata:{path:['fileId'],equals:id}}))}]},select:{metadata:true}});
    for (const log of logs) if (log.metadata?.seaBillId===bill.id && log.metadata?.snapshot?.kind==='VOYAGE_PACKING' && recapIds.includes(log.metadata.fileId)) voyageFileIds.add(log.metadata.fileId);
  }
  return {...bill,files:(bill.files||[]).map(f=>metadata(bill,f,references,voyageFileIds)),document:bill.document?metadata(bill,bill.document,references):bill.document,allocations:(bill.allocations||[]).map(a=>({...a,packingList:a.packingList?{...a.packingList,document:a.packingList.document?metadata(bill,{...a.packingList.document,category:'PACKING_LIST'},references):a.packingList.document}:a.packingList}))};
}
module.exports = {metadata,annotate,MAPPING_WARNING};

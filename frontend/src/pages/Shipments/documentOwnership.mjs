const owners={BL:['DRAFT','FINAL','LEGACY','BILL_OF_LADING'],PACKING:['PACKING_LIST','INTERNAL_PACKING_LIST','PACKING_HEADER','INTERNAL_PACKING_RECAP'],DRIVER:['DELIVERY_RECEIPT','POD','DRIVER_BON']};
export const documentOwner=category=>Object.keys(owners).find(owner=>owners[owner].includes(category))||'SUPPORTING';
export const documentOptions=owner=>owner==='BL'?[['DRAFT','B/L draft'],['FINAL','B/L final']]:owner==='PACKING'?[['PACKING_LIST','Packing List mitra']]:[['SUPPORTING','Dokumen pendukung'],['RECEIVING_REPORT','Berita Acara'],['PAYMENT_PROOF','Bukti pembayaran sopir'],['DELIVERY_ORDER','Delivery Order (DO)'],['INVOICE','Invoice'],['MANIFEST','Manifest'],['WAYBILL','Surat jalan'],['TAX_INVOICE','Faktur pajak'],['PPH23_CERTIFICATE','Bukti potong PPh 23'],['RELEASE','Bukti pelepasan pelayaran']];
export const isReceiptReference=(file,owner)=>owner==='SUPPORTING'&&['DELIVERY_RECEIPT','POD'].includes(file.category);
export const documentVisible=(file,owner)=>documentOwner(file.category)===owner||isReceiptReference(file,owner);
export const evidenceIds=file=>file.evidenceIds||[file.evidenceId||file.id];
export function availableEvidence(files,type,linked=[]){
 const categories=type==='edit'?['DELIVERY_RECEIPT','POD']:type==='payment'?['PAYMENT_PROOF']:['SUPPORTING','DELIVERY_RECEIPT','POD','PAYMENT_PROOF'];
 return files.flatMap(file=>{
  const aliases=file.evidenceAliases||[{id:file.evidenceId||evidenceIds(file)[0],category:file.category}];
  const alias=aliases.find(alias=>categories.includes(alias.category));
  const evidenceId=evidenceIds(file).find(id=>linked.includes(id))||alias?.id;
  return evidenceId?[{...file,evidenceId}]:[];
 });
}
export const evidenceStatusLabel=status=>({MISSING:'Belum ada bukti',UPLOADED:'Bukti sudah diunggah',READY:'Siap dibuat bonrate',IN_BON:'Sudah masuk bonrate'})[status]||'Belum ada bukti';

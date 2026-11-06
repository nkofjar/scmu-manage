const {Prisma}=require('@prisma/client');
const {fail,text}=require('./jpt');
const {isTrashed}=require('./registerLifecycle');
const key=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const amount=value=>value==null?null:new Prisma.Decimal(value).toFixed(2);
function containerTotals(containers){
 const unique=new Map();for(const c of containers){const id=key(c.number);if(!id)continue;const old=unique.get(id);if(old&&old.size!==c.size)unique.set(id,{...c,size:null});else if(!old)unique.set(id,c);}
 const rows=[...unique.values()];return {twenty:rows.filter(c=>c.size==='20').length,forty:rows.filter(c=>c.size==='40').length,other:rows.filter(c=>!['20','40'].includes(c.size)).length,total:rows.length};
}
function compute(row,input){
 fail(row&&!row.deletedAt,'Pengiriman tidak ditemukan atau berada di Sampah.',404);
 const source=(row.bills||[]).filter(b=>!isTrashed(b)),jobs=new Map();
 for(const b of source)if(b.jobId)jobs.set(b.jobId,b.job?.currency||null);
 if(row.sharedJobId)jobs.set(row.sharedJobId,row.sharedJob?.currency||null);
 const bills=source.map(b=>{const normalized=require('./blRegister').normalize({},b);return {id:b.id,jobId:b.jobId,billNumber:b.billNumber||null,shipperName:b.shipperName||null,consigneeName:b.consigneeName||null,containers:normalized.containers.map(c=>({number:c.number,size:c.size})),counts:containerTotals(normalized.containers),cargo:normalized.register.cargoDescription||null,recordedAmount:amount(b.registerAmount),currency:jobs.get(b.jobId)};});
 const unique=new Map();for(const c of input)if(jobs.has(c.jobId)&&!unique.has(c.id))unique.set(c.id,c);
 const charges=[...unique.values()].map(c=>({id:c.id,jobId:c.jobId,billIds:bills.filter(b=>b.jobId===c.jobId).map(b=>b.id),shared:c.jobId===row.sharedJobId,description:c.description,kind:c.kind,status:c.status,costSource:c.costSource||null,costCategory:c.costCategory||null,vendor:c.vendor?.name||null,currency:jobs.get(c.jobId),actualAmount:amount(c.actualAmount),estimatedAmount:amount(c.estimatedAmount),counted:c.status==='APPROVED'&&c.actualAmount!=null}));
 const currencies=[...new Set(jobs.values())];
 const financials=currencies.map(currency=>{
  const group=charges.filter(c=>c.currency===currency),scope=[...jobs].filter(([,v])=>v===currency).map(([id])=>id);
  const actual=kind=>group.filter(c=>currency&&c.counted&&c.kind===kind),total=kind=>actual(kind).length?actual(kind).reduce((sum,c)=>sum.plus(c.actualAmount),new Prisma.Decimal(0)):null;
  const income=total('REVENUE'),cost=total('COST');
  return {currency,income:income?.toFixed(2)??null,cost:cost?.toFixed(2)??null,difference:income&&cost?income.minus(cost).toFixed(2):null,profit:null,status:'PROVISIONAL',missingIncomeJobIds:scope.filter(id=>!actual('REVENUE').some(c=>c.jobId===id)),missingCostJobIds:scope.filter(id=>!actual('COST').some(c=>c.jobId===id)),pendingCount:group.filter(c=>c.status!=='REJECTED'&&!c.counted).length};
 });
 return {journey:{id:row.id,number:row.number,vesselName:row.vesselName||null,voyageNumber:row.voyageNumber||null,period:row.period||null,destination:row.destination||null,archived:Boolean(row.archivedAt)},bills,charges,financials,totals:{bills:bills.length,jobs:jobs.size,containers:containerTotals(bills.flatMap(b=>b.containers))},notes:['Nominal buku B/L bukan pendapatan atau biaya aktual.','Hanya transaksi APPROVED dengan nominal aktual dihitung. Usulan dan penolakan tidak dihitung.','Selisih tercatat bersifat sementara, bukan laba final. Nilai yang belum dicatat tetap tidak diketahui.','Kontainer fisik dan transaksi bersama dihitung satu kali; rincian B/L tidak boleh dijumlah ulang.']};
}
async function get(tx,id){
 const row=await tx.shippingJourney.findUnique({where:{id:text(id,'Pengiriman',100)},include:{sharedJob:{select:{currency:true}},bills:{include:{job:{select:{currency:true}}},orderBy:[{createdAt:'asc'},{id:'asc'}]}}});
 fail(row&&!row.deletedAt,'Pengiriman tidak ditemukan atau berada di Sampah.',404);
 const ids=[...new Set([row.sharedJobId,...row.bills.filter(b=>!isTrashed(b)).map(b=>b.jobId)].filter(Boolean))];
 const charges=ids.length?await tx.jobCharge.findMany({where:{jobId:{in:ids}},include:{vendor:{select:{name:true}}},orderBy:[{createdAt:'asc'},{id:'asc'}]}):[];
 return compute(row,charges);
}
function exportTables(recap){
 return [
  {name:'Ringkasan',headers:['Rincian','Nilai'],rows:[['Pengiriman',recap.journey.number],['Kapal',recap.journey.vesselName],['Voyage',recap.journey.voyageNumber],['Periode',recap.journey.period],['Tujuan',recap.journey.destination],['B/L',recap.totals.bills],['Kontainer fisik',recap.totals.containers.total],['20 ft',recap.totals.containers.twenty],['40 ft',recap.totals.containers.forty],['Lain / tidak diketahui',recap.totals.containers.other],...recap.notes.map(n=>['Catatan',n])]},
  {name:'B-L',headers:['ID','B/L','Shipper','Consignee','20 ft','40 ft','Lain','Kontainer','Muatan','Nominal buku (bukan aktual)','Mata uang'],rows:recap.bills.map(b=>[b.id,b.billNumber,b.shipperName,b.consigneeName,b.counts.twenty,b.counts.forty,b.counts.other,b.containers.map(c=>c.number).join(', '),b.cargo,b.recordedAmount,b.currency])},
  {name:'Keuangan',headers:['Mata uang','Pendapatan aktual','Biaya aktual','Selisih tercatat sementara','Status','Job pendapatan belum tercatat','Job biaya belum tercatat','Usulan / nominal belum lengkap'],rows:recap.financials.map(f=>[f.currency||'Tidak diketahui',f.income,f.cost,f.difference,f.status,f.missingIncomeJobIds.join(', '),f.missingCostJobIds.join(', '),f.pendingCount])},
  {name:'Transaksi',headers:['ID','Job','B/L','Lingkup','Uraian','Jenis','Status','Sumber biaya','Kategori','Vendor','Mata uang','Aktual','Estimasi (bukan aktual)','Dihitung'],rows:recap.charges.map(c=>[c.id,c.jobId,c.billIds.map(id=>recap.bills.find(b=>b.id===id)?.billNumber||id).join(', '),c.shared?'Bersama':'Job B/L',c.description,c.kind,c.status,c.costSource,c.costCategory,c.vendor,c.currency,c.actualAmount,c.estimatedAmount,c.counted?'Ya':'Tidak'])}
 ];
}
async function workbook(recap){
 const book=new(require('exceljs').Workbook)();book.creator='SCMU';
 for(const table of exportTables(recap)){const sheet=book.addWorksheet(table.name);sheet.addRow(table.headers);for(const row of table.rows)sheet.addRow(row.map(v=>v??null));sheet.getRow(1).font={bold:true};sheet.columns.forEach((c,i)=>{c.width=i===0?24:32;c.alignment={vertical:'top',wrapText:true};});sheet.views=[{state:'frozen',ySplit:1}];}
 return Buffer.from(await book.xlsx.writeBuffer());
}
function pdf(recap){
 return new Promise((resolve,reject)=>{
  const doc=new(require('pdfkit'))({size:'A4',margin:40,info:{Title:'Rekapan B/L '+recap.journey.number}}),chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
  doc.fontSize(18).text('Rekapan B/L');doc.moveDown();
  for(const table of exportTables(recap)){
   doc.font('Helvetica-Bold').fontSize(13).text(table.name);doc.moveDown(.3);doc.font('Helvetica').fontSize(9);
   for(const row of table.rows){
    const lines=row.map((v,i)=>v==null||v===''?null:table.headers[i]+': '+v).filter(Boolean);
    for(const line of lines)doc.text(line,{lineGap:2});doc.moveDown(.6);
   }
   doc.moveDown();
  }
  doc.end();
 });
}
module.exports={compute,get,pdf,workbook};

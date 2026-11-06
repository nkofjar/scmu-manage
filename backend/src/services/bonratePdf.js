const PDFDocument=require('pdfkit');

const NOTE='Catatan: Dengan diterimanya Surat Jalan Mobil ini, Sopir harus bertanggung jawab atas muatan yang diangkutnya.';
const HEADINGS=['No.','Merk & Nomor','Banyaknya\nColly','Jenis Colly','Jenis Barang','Tanda Terima'];
const MARGIN=34,FONT=9,LINE=12,PAD=6;
const value=v=>v==null?'':String(v);

// Explicit line layout keeps PDFKit from silently overflowing into a portrait page.
function wrap(doc,text,width){
 const lines=[];
 for(const paragraph of value(text).split(/\r?\n/)){
  let line='';
  for(const word of paragraph.split(/\s+/).filter(Boolean)){
   if(doc.widthOfString(line?`${line} ${word}`:word)<=width){line=line?`${line} ${word}`:word;continue;}
   if(line){lines.push(line);line='';}
   for(const char of word){if(line&&doc.widthOfString(line+char)>width){lines.push(line);line='';}line+=char;}
  }
  lines.push(line);
 }
 return lines;
}
function writeLines(doc,lines,x,y,width,{bold=false,align='left',size=FONT,leading=LINE}={}){
 doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size);
 lines.forEach((line,n)=>doc.text(line,x,y+n*leading,{width,lineBreak:false,align}));
}
function textBlock(doc,text,x,y,width,options={}){
 doc.font(options.bold?'Helvetica-Bold':'Helvetica').fontSize(options.size||FONT);
 const lines=wrap(doc,text,width);writeLines(doc,lines,x,y,width,options);return lines.length*(options.leading||LINE);
}
function cargoRows(snapshot){
 const children=snapshot.deliveries?.length?snapshot.deliveries:[{items:snapshot.items||[],recipient:snapshot.recipient,destination:snapshot.destination,receivedDate:snapshot.receivedDate,receiptReference:snapshot.receiptReference,billNumber:snapshot.billNumber,containerNumber:snapshot.containerNumber}];
 return children.flatMap(child=>(child.items?.length?child.items:[{}]).map(item=>({item,receipt:[child.recipient&&`Penerima: ${child.recipient}`,child.destination&&`Tujuan: ${child.destination}`,child.receivedDate&&`Tanggal: ${child.receivedDate}`,child.receiptReference&&`Bukti: ${child.receiptReference}`].filter(Boolean).join('\n'),mark:[item.owner,child.containerNumber||snapshot.containerNumber,child.billNumber&&`B/L: ${child.billNumber}`].filter(Boolean).join('\n')})));
}
function collyTotal(rows){
 // A missing/invalid quantity is not zero. Never claim a complete numeric total for it.
 const quantities=rows.map(r=>r.item.collyCount);
 if(quantities.some(q=>q==null||value(q).trim()===''||!Number.isFinite(Number(q))||Number(q)<0))return 'Belum lengkap';
 return value(quantities.reduce((sum,q)=>sum+Number(q),0));
}
async function renderBonratePdf(snapshot){
 const company=snapshot.company||{},doc=new PDFDocument({size:'A4',layout:'landscape',margin:MARGIN,info:{Title:snapshot.number,Author:company.name||'',CreationDate:new Date(snapshot.createdAt),ModDate:new Date(snapshot.createdAt)}});
 const chunks=[],done=new Promise((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 const width=doc.page.width-2*MARGIN,columns=[30,164,84,86,170,width-534];
 const rows=cargoRows(snapshot),bottom=doc.page.height-MARGIN;let y,tableTop;
 function nextPage(){doc.addPage();header();}
 function ensureSpace(height){if(y+height>bottom)nextPage();}
 function header(){
  let top=MARGIN;
  top+=textBlock(doc,'JASA PENGURUSAN TRANSPORTASI (JPT)',MARGIN,top,width,{bold:true,size:11,align:'center',leading:15});
  top+=textBlock(doc,company.name,MARGIN,top,width,{bold:true,size:16,align:'center',leading:20});
  if(company.address)top+=textBlock(doc,company.address,MARGIN,top,width,{align:'center',size:9});
  top+=5;textBlock(doc,'SURAT JALAN MOBIL',MARGIN,top,width,{bold:true,size:15,align:'center',leading:19});
  const titleWidth=doc.widthOfString('SURAT JALAN MOBIL');doc.moveTo((doc.page.width-titleWidth)/2,top+17).lineTo((doc.page.width+titleWidth)/2,top+17).stroke();top+=24;
  top+=textBlock(doc,`BONRATE ${value(snapshot.rateType)}`,MARGIN,top,width,{bold:true,align:'center'});top+=7;
  const destinations=[...new Set((snapshot.deliveries||[]).map(d=>d.destination).filter(Boolean))];
  const destination=destinations.length>1?`${destinations[0]} (+${destinations.length-1} tujuan; rincian pada tabel)`:destinations[0]||snapshot.destination;
  const left=[`No. Auto: ${value(snapshot.vehicleNumber)}`,`EX KM: ${[snapshot.vesselName,snapshot.voyageNumber].filter(Boolean).join(' / ')}`,`Dari: ${value(snapshot.origin)}`];
  const right=[`Nomor: ${value(snapshot.number)}`,`Ke: ${value(destination)}`,`Tanggal selesai: ${value(snapshot.receivedDate||snapshot.taskDate)}`];
  let a=top,b=top;for(const text of left)a+=textBlock(doc,text,MARGIN,a,width/2-12)+3;for(const text of right)b+=textBlock(doc,text,MARGIN+width/2+6,b,width/2-6)+3;
  y=Math.max(a,b)+5;
  let x=MARGIN;const height=36;
  HEADINGS.forEach((text,index)=>{doc.rect(x,y,columns[index],height).stroke();textBlock(doc,text,x+PAD,y+8,columns[index]-2*PAD,{bold:true,align:'center'});x+=columns[index];});y+=height;tableTop=y;
 }
 function row(cells,height){let x=MARGIN;cells.forEach((lines,index)=>{doc.rect(x,y,columns[index],height).stroke();writeLines(doc,lines,x+PAD,y+PAD,columns[index]-2*PAD,{align:index===0||index===2?'center':'left'});x+=columns[index];});y+=height;}
 // Measure the closing section before cargo so the final ordinary row stays with it.
 doc.font('Helvetica-Bold').fontSize(FONT);const noteLines=wrap(doc,NOTE,width);
 doc.font('Helvetica').fontSize(FONT);const driverLines=wrap(doc,snapshot.driverName,width/3-20);
 doc.font('Helvetica-Bold').fontSize(FONT);const companyLines=wrap(doc,company.name||'Perusahaan',width/3-20);
 const signatureBaseline=Math.max(53,companyLines.length*LINE+36);
 const signHeight=signatureBaseline+5+Math.max(LINE,driverLines.length*LINE)+8;
 const closingHeight=9+16+8+noteLines.length*LINE+12+signHeight;
 header();
 rows.forEach((r,index)=>{
  const cells=[value(index+1),r.mark,value(r.item.collyCount),value(r.item.collyType),[r.item.goodsType,r.item.packageWeightKg==null?null:`${r.item.packageWeightKg} kg/kemasan`].filter(Boolean).join('\n'),r.receipt].map((text,n)=>{doc.font('Helvetica').fontSize(FONT);return wrap(doc,text,columns[n]-2*PAD);});
  const lineCount=Math.max(...cells.map(c=>c.length)),height=Math.max(36,lineCount*LINE+2*PAD);
  const reserve=index===rows.length-1&&height+closingHeight<=bottom-tableTop?closingHeight:0;
  if(height<=bottom-tableTop)ensureSpace(height+reserve);
  let offset=0;
  while(offset<lineCount){
   if(bottom-y<36)nextPage();
   const count=Math.min(lineCount-offset,Math.floor((bottom-y-2*PAD)/LINE));
   row(cells.map(lines=>lines.slice(offset,offset+count)),Math.max(36,count*LINE+2*PAD));offset+=count;
   if(offset<lineCount)nextPage();
  }
 });
 // Keep the total, responsibility note and signatures together when possible.
 ensureSpace(closingHeight);
 y+=9;y+=textBlock(doc,`Jumlah  ${collyTotal(rows)}  Colly`,MARGIN,y,width,{bold:true,size:11,align:'center',leading:16});
 y+=8;writeLines(doc,noteLines,MARGIN,y,width,{bold:true});y+=noteLines.length*LINE+12;
 if(snapshot.instructions){
  doc.font('Helvetica').fontSize(FONT);const lines=wrap(doc,`Instruksi: ${snapshot.instructions}`,width);
  for(const line of lines){ensureSpace(LINE);writeLines(doc,[line],MARGIN,y,width);y+=LINE;}y+=8;
 }
 ensureSpace(signHeight);
 const signatureWidth=width/3;
 ['Pengemudi','Gudang / Penerima',company.name||'Perusahaan'].forEach((label,index)=>{
  const x=MARGIN+index*signatureWidth;textBlock(doc,label,x+10,y,signatureWidth-20,{bold:true,align:'center'});
  doc.moveTo(x+25,y+signatureBaseline).lineTo(x+signatureWidth-25,y+signatureBaseline).stroke();
  if(index===0)textBlock(doc,snapshot.driverName,x+10,y+signatureBaseline+5,signatureWidth-20,{align:'center'});
 });
 doc.end();return done;
}
module.exports={renderBonratePdf};

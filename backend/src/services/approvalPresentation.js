const {text,choice}=require('./jpt');
function reference(row){const fields=row.snapshot?.view?.overview||row.snapshot?.overview||[],get=labels=>fields.find(f=>labels.includes(f.label))?.value;
 const payroll=row.snapshot?.raw?.tariffSnapshot?.driverPayrollSnapshot,raw=row.snapshot?.raw;
 return {reference:String(get(['Internal reference','Rekap upah','Nomor bon','Quotation #','RFQ #','Invoice #','BL number','Pengiriman','Job order','Original filename'])||raw?.request?.containerNumber||row.entityId),journey:String(get(['Pengiriman'])||''),container:String(get(['Kontainer'])||''),driver:String(get(['Nama sopir'])||payroll?.driverName||''),amount:row.payload?.actualAmount||row.payload?.amount||get(['Proposed actual amount','Amount'])||null};
}
function filter(query){const where={...(query.status?{status:choice(query.status,['SUBMITTED','APPROVED','RETURNED','REJECTED','WITHDRAWN'])}:{}),...(query.jobId?{jobId:text(query.jobId,'Job',100)}:{}),...(query.action?{action:text(query.action,'Jenis pengajuan',100)}:{})};
 return where;
}
async function queryWhere(tx,query){const where=filter(query);if(!query.search)return where;const term=text(query.search,'Pencarian',200).toLocaleLowerCase('id-ID');
 const rows=await tx.directorApproval.findMany({where,select:{id:true,action:true,entityId:true,snapshot:true,payload:true,requestNote:true,requestedById:true}}),users=await tx.user.findMany({where:{id:{in:[...new Set(rows.map(r=>r.requestedById))]}},select:{id:true,name:true}}),names=new Map(users.map(u=>[u.id,u.name]));
 return {...where,id:{in:rows.filter(row=>[...Object.values(reference(row)),row.action,row.requestNote,names.get(row.requestedById),...(row.snapshot?.view?.overview||[]).map(f=>f.value)].filter(Boolean).join(' ').toLocaleLowerCase('id-ID').includes(term)).map(r=>r.id)}};
}
module.exports={reference,filter,queryWhere};

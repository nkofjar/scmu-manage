function fixture(){
 const bill=(id,jobId,number,size)=>({id,jobId,billNumber:id.toUpperCase(),shipperName:'Sender '+id,consigneeName:'Receiver '+id,registerAmount:'999999',registerData:{register:{cargoDescription:'Rice '+id},containers:[{number,size}]},containers:[{number}],job:{currency:'IDR'}});
 const row={id:'j',number:'JOURNEY-1',vesselName:'Ship',voyageNumber:'V1',period:'2026-10',sharedJobId:'shared',sharedJob:{currency:'IDR'},bills:[bill('a','job','ABCU 123-4567','20'),bill('b','job','ABCU1234567','20'),bill('c','other','XYZU7777777','40'),{...bill('trash','trashJob','TRASH','40'),registerData:{trash:{deletedAt:'2026-10-01'}}}]};
 const charge=(id,jobId,kind,status,actualAmount)=>({id,jobId,kind,status,actualAmount,estimatedAmount:'1000000',description:id,costCategory:'OTHER',costSource:'INTERNAL'});
 const charges=[charge('r','job','REVENUE','APPROVED','100.10'),charge('c','job','COST','APPROVED','20.05'),charge('shared','shared','COST','APPROVED','5.00'),charge('proposed','other','COST','PROPOSED','999'),charge('reject','job','COST','REJECTED','999'),charge('unrelated','trashJob','REVENUE','APPROVED','999')];
 return {row,charges};
}
module.exports={fixture};

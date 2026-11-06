const nameKey=value=>String(value||'').trim().replace(/\s+/g,' ').toUpperCase();

export function packingRecipientName(row,recipient,headerRecipient){
 const header=nameKey(headerRecipient);
 return (row.recipients||[]).length===1&&header&&nameKey(recipient.name)===header?'':recipient.name||'';
}

export const canonicalContainer=value=>String(value??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export function searchJourneyBills(bills,query=''){
 const key=canonicalContainer(query);
 return bills.filter(b=>!b.deleted).map(b=>({...b,matchedContainers:(b.containers||[]).filter(c=>key&&canonicalContainer(c.number).includes(key)).map(c=>c.number)})).filter(b=>!key||b.matchedContainers.length);
}
export function containerMatchParts(value,query){
 const text=String(value??''),key=canonicalContainer(query),start=key?canonicalContainer(text).indexOf(key):-1;
 if(start<0)return [{text,match:false}];
 const positions=[...text].map((c,i)=>/[A-Z0-9]/i.test(c)?i:null).filter(i=>i!==null),a=positions[start],b=positions[start+key.length-1]+1;
 return [{text:text.slice(0,a),match:false},{text:text.slice(a,b),match:true},{text:text.slice(b),match:false}].filter(p=>p.text);
}

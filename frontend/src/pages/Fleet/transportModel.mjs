export const vehicleTypes=['TRUCK','TRAILER','CONTAINER','TANKER','REFRIGERATED','FLATBED','MINI_TRUCK','TEMPO'];
export function masterPayload(kind,form){
 const fields=kind==='fleet'?['registrationNo','type','capacity','make','model','year','ownershipType','companyId','stnkExpiry','kirExpiry']:['name','phone','licenseNo','licenseClass','licenseExpiry','employmentType','companyId'];
 const body=Object.fromEntries(fields.map(key=>[key,form[key]??'']));
 for(const key of ['stnkExpiry','kirExpiry','licenseExpiry','companyId','ownershipType','employmentType','year'])if(key in body)body[key]=body[key]===''?null:body[key];
 if(kind==='fleet'){body.capacity=form.capacity===''?null:Number(form.capacity);if(body.year!==null)body.year=Number(body.year);}
 if(form.version!==undefined)body.version=form.version;
 return body;
}
export function expiryState(value,today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jayapura',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())){
 if(!value)return 'unknown';const days=(Date.parse(value.slice(0,10))-Date.parse(today))/86400000;
 return days<0?'expired':days<=30?'expiring':'valid';
}
export async function loadCompanies(get){
 const rows=[];let page=1;
 while(true){const {data}=await get('/companies',{params:{page,limit:100}});const batch=data.data||[];rows.push(...batch);
 if(rows.length>=(data.total??rows.length))return rows;
 if(!batch.length)throw Error('Company pagination incomplete');page++;
 }
}

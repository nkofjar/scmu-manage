const {key}=require('./driverTariffs');
const {fail,text}=require('./jpt');
const clean=value=>String(value||'').trim().replace(/\s+/g,' ');
async function options(tx){
 const [drivers,vehicles,journeys,bills]=await Promise.all([tx.driver.findMany({where:{isActive:true},include:{company:true},orderBy:{name:'asc'}}),tx.vehicle.findMany({where:{isActive:true},include:{company:true},orderBy:{registrationNo:'asc'}}),tx.shippingJourney.findMany({select:{data:true},orderBy:{createdAt:'asc'}}),tx.seaBill.findMany({select:{registerData:true},orderBy:{createdAt:'asc'}})]);
 const company=row=>({companyId:row.companyId||null,companyName:row.company?.name||null});
 const names=drivers.map(d=>({id:d.id,key:d.id,name:d.name,...company(d),employmentType:d.employmentType||null,licenseClass:d.licenseClass||null,licenseExpiry:d.licenseExpiry||null}));
 const plates=vehicles.map(v=>({id:v.id,key:v.id,name:v.registrationNo,...company(v),ownershipType:v.ownershipType||null,stnkExpiry:v.stnkExpiry||null,kirExpiry:v.kirExpiry||null}));
 const old=[...journeys.flatMap(j=>[...(j.data?.driverOperations?.works||[]),...(j.data?.driverBons||[])]),...bills.flatMap(b=>b.registerData?.driverBons||[])];
 // Legacy suggestions remain explicitly unmapped even if a master shares a name.
 const legacyNames=new Set(),legacyPlates=new Set();for(const w of old){if(!w.driverId&&clean(w.driverName))legacyNames.add(clean(w.driverName));if(!w.vehicleId&&clean(w.vehicleNumber))legacyPlates.add(clean(w.vehicleNumber).toUpperCase());}
 for(const name of legacyNames)names.push({id:null,key:'legacy:'+name,name,unresolved:true,employmentType:null,companyId:null});
 for(const name of legacyPlates)plates.push({id:null,key:'legacy:'+name,name,unresolved:true,ownershipType:null,companyId:null});
 return {drivers:names.sort((a,b)=>a.name.localeCompare(b.name,'id')),vehicles:plates.sort((a,b)=>a.name.localeCompare(b.name,'id'))};
}
async function resolve(tx,input,before){
 const work={...input,compliance:{driver:null,vehicle:null}};
 for(const kind of ['driver','vehicle']){
  const idField=kind+'Id',nameField=kind==='driver'?'driverName':'vehicleNumber',typeField=kind==='driver'?'driverEmploymentType':'vehicleOwnershipType';
  const id=input[idField]===undefined?before?.[idField]||null:input[idField]?text(input[idField],idField,100):null;
  if(before&&id&&id===before[idField]){
   work.compliance[kind]=structuredClone(before.compliance?.[kind]||null);
   for(const field of [idField,nameField,typeField,kind+'CompanyId',kind+'CompanyName'])work[field]=before[field]??null;
  }else if(id){
   const row=await tx[kind].findUnique({where:{id},include:{company:true}});
   fail(row?.isActive&&row.companyId&&row.company?.isActive,'Pilih '+kind+' aktif dengan perusahaan aktif.');
   const classification=row[kind==='driver'?'employmentType':'ownershipType'];
   fail([kind==='driver'?'INTERNAL':'OWN','VENDOR'].includes(classification),'Lengkapi klasifikasi '+kind+' pada master sebelum penugasan.');
   fail(classification==='VENDOR'?row.company.isInternal===false:row.company.isInternal===true,'Perusahaan '+kind+' tidak sesuai klasifikasi master.');
   if(classification!=='VENDOR')await require('./access').internalCompany(tx,row.companyId);
   fail(!input[kind+'CompanyId']||input[kind+'CompanyId']===row.companyId,'Perusahaan '+kind+' tidak sesuai master.');
   work.compliance={...(work.compliance||{}),[kind]:kind==='driver'?{licenseClass:row.licenseClass||null,licenseExpiry:row.licenseExpiry||null}:{stnkExpiry:row.stnkExpiry||null,kirExpiry:row.kirExpiry||null}};
   Object.assign(work,{[idField]:id,[nameField]:kind==='driver'?row.name:row.registrationNo,[typeField]:row[kind==='driver'?'employmentType':'ownershipType']||null,[kind+'CompanyId']:row.companyId,[kind+'CompanyName']:row.company.name});
  }else Object.assign(work,{[idField]:null,[nameField]:clean(input[nameField])||null,[typeField]:null,[kind+'CompanyId']:null,[kind+'CompanyName']:null});
 }
 return {...work,driverKey:key(work.driverName),vehicleKey:key(work.vehicleNumber)};
}
module.exports={clean,options,resolve};

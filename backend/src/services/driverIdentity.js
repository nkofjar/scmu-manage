const {key}=require('./driverTariffs');
const {fail,text}=require('./jpt');
const clean=value=>String(value||'').trim().replace(/\s+/g,' ');
async function options(tx){
 const [drivers,vehicles,journeys,bills]=await Promise.all([tx.driver.findMany({where:{isActive:true},select:{id:true,name:true},orderBy:{name:'asc'}}),tx.vehicle.findMany({where:{isActive:true},select:{id:true,registrationNo:true},orderBy:{registrationNo:'asc'}}),tx.shippingJourney.findMany({select:{data:true},orderBy:{createdAt:'asc'}}),tx.seaBill.findMany({select:{registerData:true},orderBy:{createdAt:'asc'}})]);
 const names=new Map(),plates=new Map(),add=(map,value,id)=>{const name=clean(value),k=key(name);if(k&&!map.has(k))map.set(k,{key:k,name,...(id?{id}:{})});};
 for(const d of drivers)add(names,d.name,d.id);for(const v of vehicles)add(plates,v.registrationNo.toUpperCase(),v.id);
 const old=[...journeys.flatMap(j=>[...(j.data?.driverOperations?.works||[]),...(j.data?.driverBons||[])]),...bills.flatMap(b=>b.registerData?.driverBons||[])];
 for(const w of old){add(names,w.driverName);add(plates,clean(w.vehicleNumber).toUpperCase());}
 return {drivers:[...names.values()].sort((a,b)=>a.name.localeCompare(b.name,'id')),vehicles:[...plates.values()].sort((a,b)=>a.name.localeCompare(b.name,'id'))};
}
async function resolve(tx,work){const saved=await options(tx),driver=saved.drivers.find(d=>d.key===key(work.driverName)),vehicle=saved.vehicles.find(v=>v.key===key(work.vehicleNumber));return {...work,driverName:driver?.name||clean(work.driverName)||null,driverKey:driver?.key||key(work.driverName),vehicleNumber:vehicle?.name||clean(work.vehicleNumber).toUpperCase()||null,vehicleKey:vehicle?.key||key(work.vehicleNumber)};}
module.exports={clean,options,resolve};

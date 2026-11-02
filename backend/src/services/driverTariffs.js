const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {fail,text,choice,integer,money,audit}=require('./jpt');
const key=v=>String(v||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function day(value){
 fail(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Isi tanggal tarif yang valid.');return value;
}
const onDate=(row,date)=>row.enabled&&!row.confirmationRequired&&(!row.effectiveFrom||new Date(row.effectiveFrom).toISOString().slice(0,10)<=date)&&(!row.effectiveTo||new Date(row.effectiveTo).toISOString().slice(0,10)>=date);
function score(row,input){
 if(row.size&&row.size!==input.size)return -1;
 for(const [column,value]of [['routeOrigin',input.origin],['routeDestination',input.destination],['vehicleNumber',input.vehicleNumber]])if(row[column]&&key(row[column])!==key(value))return -1;
 return (row.size?1:0)+(row.routeOrigin?2:0)+(row.routeDestination?2:0)+(row.vehicleNumber?4:0);
}
async function rates(tx,input){
 const date=day(input.date),rows=await tx.jptTariff.findMany({where:{category:'DRIVER_BON',enabled:true,confirmationRequired:false,rateType:{in:['RB','RK']},OR:[{size:null},{size:input.size}]}}),result={};
 for(const type of ['RB','RK']){
  const matches=rows.filter(r=>r.rateType===type&&['RIT','CONTAINER'].includes(r.unit)&&onDate(r,date)).map(r=>({row:r,score:score(r,input)})).filter(r=>r.score>=0).sort((a,b)=>b.score-a.score);
  if(matches.length){fail(matches.length===1||matches[0].score!==matches[1].score,'Ada beberapa tarif '+type+' aktif dengan cakupan sama. Direktur perlu memeriksa periode tarif.',409);result[type]=matches[0].row;}
 }return result;
}
async function saveScheme(tx,user,id,body){
 fail(user.role==='SUPER_ADMIN','Hanya direktur yang dapat mengubah skema angkutan.',403);
 const before=id?await tx.driverRateScheme.findUnique({where:{id}}):null;fail(!id||before,'Skema tidak ditemukan.',404);
 if(before)fail(integer(body.version,'Versi')===before.version,'Skema berubah. Muat ulang.',409);
 const fields={code:text(body.code,'Kode',80).toUpperCase(),name:text(body.name,'Nama skema',200),size:choice(body.size,['20','21','40'],'Ukuran'),rb:integer(body.rb,'RB',0,1000),rk:integer(body.rk,'RK',0,1000),enabled:body.enabled};
 fail(typeof fields.enabled==='boolean'&&fields.rb+fields.rk>0,'Isi jumlah RB/RK dan status skema.');
 const row=before?await tx.driverRateScheme.update({where:{id},data:{...fields,version:{increment:1}}}):await tx.driverRateScheme.create({data:fields});
 await audit(tx,user,'DRIVER_SCHEME_SAVED','DriverRateScheme',row.id,{before,after:row});return row;
}
function inputOf(bon,bill){
 fail(bon&&typeof bon==='object'&&Array.isArray(bon.containerNumbers)&&bon.containerNumbers.length<=100&&new Set(bon.containerNumbers).size===bon.containerNumbers.length,'Isi bon dan pilihan kontainer yang valid.');
 const selected=bill.containers.filter(c=>bon.containerNumbers.includes(c.number)).map(c=>({...c,size:bill.registerData?.containers?.find(r=>r.number===c.number)?.size||c.size}));
 fail(selected.length&&selected.length===bon.containerNumbers.length,'Pilih kontainer untuk perhitungan tarif.');
 const sizes=[...new Set(selected.map(c=>String(c.size||'')))];fail(sizes.length===1&&['20','21','40'].includes(sizes[0]),'Satu bon bertarif harus memilih kontainer dengan ukuran yang sama dan diketahui.');
 const rb=integer(bon.rbCount,'Realisasi RB',0,10000),rk=integer(bon.rkCount,'Realisasi RK',0,10000);fail(rb+rk>0,'Isi realisasi RB atau RK.');
 return {schemeId:bon.ratePlan==='CUSTOM'?null:text(bon.ratePlan,'Skema',100),size:sizes[0],containerNumbers:[...bon.containerNumbers].sort(),containerCount:selected.length,rbCount:rb,rkCount:rk,date:day(bon.bonDate),origin:text(bon.origin,'Asal',300),destination:text(bon.destination,'Tujuan',300),vehicleNumber:text(bon.vehicleNumber,'Kendaraan',80).toUpperCase()};
}
async function estimate(tx,bon,bill){
 const input=inputOf(bon,bill);let scheme=null;
 if(input.schemeId){scheme=await tx.driverRateScheme.findUnique({where:{id:input.schemeId}});fail(scheme?.enabled&&scheme.size===input.size,'Skema nonaktif atau ukuran tidak sesuai.',409);}
 const found=await rates(tx,input),lines=[];
 for(const [type,count]of [['RB',input.rbCount],['RK',input.rkCount]]){
  if(!count)continue;const rate=found[type];fail(rate,'Tarif '+type+' aktif belum tersedia untuk tanggal, ukuran, dan rute ini.',409);
  const quantity=rate.unit==='CONTAINER'?input.containerCount:count,unitPrice=money(rate.unitPrice);fail(unitPrice.gt(0),'Tarif sopir harus lebih dari nol.');
  lines.push({rateType:type,tariffId:rate.id,version:rate.version,code:rate.code,description:rate.description,unit:rate.unit,quantity,unitPrice:unitPrice.toFixed(2),amount:unitPrice.mul(quantity).toFixed(2),effectiveFrom:rate.effectiveFrom?new Date(rate.effectiveFrom).toISOString().slice(0,10):null,effectiveTo:rate.effectiveTo?new Date(rate.effectiveTo).toISOString().slice(0,10):null,routeOrigin:rate.routeOrigin||null,routeDestination:rate.routeDestination||null,vehicleNumber:rate.vehicleNumber||null});
 }
 fail(!(lines.length>1&&lines.some(l=>l.unit==='CONTAINER')),'Tarif paket per kontainer tidak dapat digabung RB dan RK. Gunakan tarif per rit untuk skema campuran.');
 const amount=lines.reduce((sum,l)=>sum.plus(l.amount),money(0));fail(amount.lte('999999999999'),'Total bon terlalu besar.');
    const result={input,plan:bon.ratePlan,planLabel:scheme?.name||'Realisasi manual RB/RK',scheme:scheme?{id:scheme.id,code:scheme.code,version:scheme.version,size:scheme.size,rb:scheme.rb,rk:scheme.rk}:null,rbCount:input.rbCount,rkCount:input.rkCount,amount:amount.toFixed(2),currency:'IDR',lines};return {...result,fingerprint:fingerprint(result)};
}
async function apply(tx,data,bill,before,body){
 if(!data.ratePlan){fail(!before?.rateSnapshot,'Bon bertarif tidak dapat diubah menjadi nominal manual.',409);return data;}
 const input=inputOf(data,bill),same=before?.rateSnapshot&&isDeepStrictEqual(input,before.rateSnapshot.input)&&data.ratePlan===before.ratePlan;
 if(before?.status==='COMPLETED'){fail(same,'Perhitungan bon selesai tidak dapat diubah.',409);fail(!body.refreshTariff,'Tarif bon selesai sudah dikunci.',409);}
 if(same&&!body.refreshTariff){data.rateSnapshot=before.rateSnapshot;data.amount=before.rateSnapshot.amount;}
 else{const snapshot=await estimate(tx,data,bill);fail(body.tariffConfirmed===true&&body.tariffFingerprint===snapshot.fingerprint,'Periksa pratinjau tarif terbaru sebelum menyimpan bon.',409);data.rateSnapshot=snapshot;data.amount=snapshot.amount;}
 data.tripCount=input.rbCount+input.rkCount;return data;
}
module.exports={rates,estimate,apply,inputOf,saveScheme,key,onDate,score};

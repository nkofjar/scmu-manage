const { fail, money, sum, text, choice, decimal, date, audit, integer } = require('./jpt');
async function save(tx, user, id, body) {
  fail(user.role === 'SUPER_ADMIN', 'Only the director can change tariffs', 403);
  const current = id ? await tx.jptTariff.findUnique({where:{id}}) : {};
  fail(current, 'Tariff not found', 404);
  if(id&&current.version)fail(integer(body.version,'Versi')===current.version,'Tarif berubah. Muat ulang sebelum menyimpan.',409);
  const data = {...current,...body};
  for (const key of ['vatIncluded','enabled','confirmationRequired']) fail(typeof data[key] === 'boolean', `${key} must be true or false`);
  const calendar=value=>require('./registerFields').calendarDate(value instanceof Date?value.toISOString():value);
  const effectiveFrom = date(calendar(data.effectiveFrom),true), effectiveTo = date(calendar(data.effectiveTo),true);
  fail(!effectiveFrom || !effectiveTo || effectiveFrom<=effectiveTo, 'Effective end must follow start');
  const fields = {code:text(data.code,'Code',100).toUpperCase(),description:text(data.description,'Description',240),category:text(data.category,'Category',100),size:data.size == null || data.size === '' ? null : choice(data.size,['20','21','40'],'Size'),rateType:data.rateType == null || data.rateType === '' ? null : choice(data.rateType,['RB','RK'],'Rate type'),routeOrigin:text(data.routeOrigin,'Origin route',200,true),routeDestination:text(data.routeDestination,'Destination route',200,true),carrierName:text(data.carrierName,'Carrier',200,true),unit:choice(data.unit,['CONTAINER','BL','RIT'],'Unit'),unitPrice:decimal(body.unitPrice === undefined && current.unitPrice != null ? String(current.unitPrice) : body.unitPrice),currency:choice(data.currency,['IDR'],'Currency'),vatIncluded:data.vatIncluded,vatRate:data.vatRate == null || data.vatRate === '' ? null : choice(String(data.vatRate),['1.1'],'VAT rate'),enabled:data.enabled,confirmationRequired:data.confirmationRequired,effectiveFrom,effectiveTo,notes:text(data.notes,'Notes',3000,true)};
  fail(!fields.confirmationRequired || !fields.enabled, 'Unconfirmed tariffs must remain disabled');
  fields.vehicleNumber=text(data.vehicleNumber,'Kendaraan',80,true)?.toUpperCase()||null;
  if(fields.category==='DRIVER_BON'){
    fail(fields.rateType&&['RIT','CONTAINER'].includes(fields.unit)&&fields.unitPrice.gt(0)&&effectiveFrom,'Isi tipe RB/RK, satuan rit/kontainer, harga positif, dan tanggal mulai.');
    fail(!fields.vatIncluded&&!fields.vatRate&&!fields.carrierName,'Tarif sopir tidak memakai pajak atau pelayaran. Gunakan harga hak sopir.');
    if(fields.enabled){
      const key=require('./driverTariffs').key,others=await tx.jptTariff.findMany({where:{category:'DRIVER_BON',enabled:true,confirmationRequired:false,rateType:fields.rateType,...(id?{id:{not:id}}:{})}});
      fail(!others.some(r=>(r.size||null)===fields.size&&key(r.routeOrigin)===key(fields.routeOrigin)&&key(r.routeDestination)===key(fields.routeDestination)&&key(r.vehicleNumber)===key(fields.vehicleNumber)&&(!r.effectiveTo||!effectiveFrom||new Date(r.effectiveTo)>=effectiveFrom)&&(!effectiveTo||!r.effectiveFrom||effectiveTo>=new Date(r.effectiveFrom))),'Periode tarif aktif dengan cakupan sama bertumpang tindih. Akhiri periode lama atau simpan sebagai draf.',409);
    }
  }else fail(!fields.rateType&&fields.unit!=='RIT'&&!fields.vehicleNumber&&!fields.routeOrigin&&!fields.routeDestination,'RB/RK dan rute sopir hanya untuk kategori DRIVER_BON.');
  const result = id ? await tx.jptTariff.update({where:{id},data:{...fields,version:{increment:1}}}) : await tx.jptTariff.create({data:fields});
  await audit(tx,user,id?'JPT_TARIFF_UPDATED':'JPT_TARIFF_CREATED','JptTariff',result.id,{before:current,after:fields});
  return result;
}
const NOTICE = 'Select package inclusions explicitly to avoid double charges. Included VAT is not added again. PPh23 2% is a reference only; neither tax nor its base is applied automatically.';
function estimate(bill, tariffs, tariffIds) {
  fail(Array.isArray(tariffIds) && tariffIds.length > 0 && tariffIds.length <= 100 && tariffIds.every(id=>typeof id==='string'), 'Select between 1 and 100 tariffs');
  fail(new Set(tariffIds).size === tariffIds.length, 'Select distinct tariffs');
  const now = new Date();
  const lines = tariffIds.map(id => {
    const tariff = tariffs.find(row => row.id === id);
    fail(tariff, 'Unknown tariff selected');
    fail(tariff.category!=='DRIVER_BON'&&['BL','CONTAINER'].includes(tariff.unit),'Tarif sopir digunakan melalui Bonrate, bukan tagihan B/L.');
    fail(tariff.enabled, 'Selected tariff is disabled');
    fail(!tariff.confirmationRequired, 'Selected tariff requires confirmation');
    fail((!tariff.effectiveFrom || new Date(tariff.effectiveFrom)<=now) && (!tariff.effectiveTo || new Date(tariff.effectiveTo)>=now), 'Selected tariff is outside its effective dates');
    fail(!tariff.carrierName || tariff.carrierName.trim().toLowerCase() === (bill.carrierName||'').trim().toLowerCase(), 'Selected tariff does not match the BL carrier');
    const containers=bill.containers||[];const manual=bill.register?.[`quantity${tariff.size}`]??bill.registerData?.register?.[`quantity${tariff.size}`];
    const quantity = tariff.unit === 'BL' ? 1 : containers.some(row=>row.size) ? containers.filter(row => !tariff.size || row.size === tariff.size).length : tariff.size ? Number(manual||0) : ['20','21','40'].reduce((sum,size)=>sum+Number((bill.register?.[`quantity${size}`]??bill.registerData?.register?.[`quantity${size}`])||0),0);
    fail(quantity > 0, 'No matching containers for selected tariff; unknown size and size 21 never borrow size 20');
    const unitPrice = money(tariff.unitPrice).toFixed(2);
    return { tariffId:id, description:tariff.description, unit:tariff.unit, quantity, unitPrice, amount:money(unitPrice).mul(quantity).toFixed(2), vatIncluded:tariff.vatIncluded, vatRate:tariff.vatRate == null ? null : String(tariff.vatRate) };
  });
  return { lines, total:sum(lines,row=>row.amount).toFixed(2), currency:'IDR', warnings:['Calculation uses explicit container details when available; otherwise it uses the recorded 20/21/40 book quantities.',NOTICE] };
}
module.exports = { estimate, save, NOTICE };

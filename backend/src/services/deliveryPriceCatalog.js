// Verified transcription supplied by the user: HARGA BARU only, not driver payroll.
// Grouped destination labels remain grouped: the photo does not establish separate routes.
const SOURCE_ROWS = Object.freeze([
  ['TRUCKING-SCMU-DALAM-KOTA','TRUCKING SCMU DALAM KOTA',225000,35000,false],
  ['TRUCKING-LUAR-DALAM-KOTA','TRUCKING LUAR DALAM KOTA',185000,30000,false],
  ['BURUH-RET','BURUH / RET',200000,30000,false],
  ['WASUR','WASUR',1000000,100000,true],
  ['SOTA','SOTA',1500000,150000,true],
  ['BUPUL','BUPUL',2000000,null,true],
  ['BVD-TANAH-MERAH','BVD, TANAH MERAH',5500000,null,true],
  ['MUTING-ALFASERA','MUTING ALFASERA',2500000,null,true],
  ['KUPRIK','KUPRIK (BATAS LAMPU MERAH)',250000,null,true],
  ['SIDOMULYO','SIDOMULYO',300000,null,true],
  ['SEMANGGA-1','SEMANGGA 1',300000,null,true],
  ['SEMANGGA-2-JAYA-40','SEMANGGA 2, JAYA + 40',450000,null,true],
  ['SEMANGGA-3-MURAMSARI','SEMANGGA 3, MURAMSARI',700000,null,true],
  ['TAMIR-SP-1-5','TAMIR SP 1,2,3,4,5',700000,null,true],
  ['TAMIR-SP-6-9-KECO','TAMIR SP 6,7,8,9, KECO',800000,null,true],
  ['SALOR','SALOR',1200000,null,true],
  ['KURIK-CANDRA','KURIK CANDRA',1500000,null,true],
  ['KURIK-4-RAWASARI','KURIK 4, RAWASARI',1700000,null,true],
].map(Object.freeze));
const SOURCE_NOTE = 'Source: user-verified photo transcription, HARGA BARU. No effective date was supplied; no historic transactions are repriced. Service price, not driver wage. RB column means per rit (RIT), not DRIVER_BON rateType. Tax treatment was not supplied; no automatic VAT or PPh is inferred.';
const OMITTED = Object.freeze(['MUTING ULILIN','ASIKI','MINDIPTANA','WAROPKO','KUMBE / lower KURIK (unreadable rows)']);
const key = value => String(value || '').trim().replace(/\s+/g,' ').toUpperCase();
function destinations() {
  return SOURCE_ROWS.filter(row=>row[4]).map(([slug,name])=>({
    id:'delivery-photo-'+slug.toLowerCase(), name, destCity:name,
    // Required String columns: empty means unknown, never an invented origin/province.
    originCity:'', originState:'', destState:'', distanceKm:null, estimatedDays:null, isActive:true,
  }));
}
function tariffs() {
  return SOURCE_ROWS.flatMap(([slug,description,rb,ton])=>[['RB',rb,'RIT'],['TON',ton,'TON']]
    .filter(([,price])=>price!=null).map(([suffix,price,unit])=>({
      code:`DELIVERY-PHOTO-${slug}-${suffix}`, description,
      category:slug==='BURUH-RET'?'LABOR':'TRUCKING', unit, unitPrice:String(price), currency:'IDR',
      rateType:null, size:null, routeOrigin:null, routeDestination:null, vehicleNumber:null,
      ownershipType:null, carrierName:null, operatingCostTypeId:null,
      enabled:true, confirmationRequired:false, effectiveFrom:null, effectiveTo:null,
      vatIncluded:false, vatRate:null, notes:SOURCE_NOTE+` Source column: ${suffix}.`,
    })));
}
function change(before, after) {
  const same = Object.keys(after).every(field => field==='unitPrice'
    ? Number(before?.[field])===Number(after[field])
    : (before?.[field] ?? null)===(after[field] ?? null));
  return before ? {action:same?'unchanged':'update',before,after:{...before,...after,version:same?before.version:before.version+1}}
    : {action:'create',before:null,after:{...after,version:1}};
}
function plan({routes,tariffs:existing}) {
  const routeChanges = destinations().map(destination => {
    const matches = routes.filter(row=>row.id===destination.id || key(row.name)===key(destination.name));
    if(matches.length>1) throw new Error('Ambiguous route: '+destination.name);
    const before=matches[0];
    if(before && key(before.name)!==key(destination.name)) throw new Error('Route ID collision: '+destination.id);
    return before ? change(before,{isActive:true}) : change(null,destination);
  });
  const tariffChanges = tariffs().map(tariff => {
    const route = routeChanges.find(row=>key(row.after.name)===key(tariff.description));
    const after={...tariff,routeId:route?.after.id || null};
    const exact = existing.filter(row=>row.code===after.code);
    const semantic = existing.filter(row=>row.category===after.category && row.unit===after.unit &&
      key(row.description)===key(after.description) && !row.size && !row.ownershipType && !row.operatingCostTypeId &&
      !row.carrierName && !row.rateType && !row.vehicleNumber && !row.routeOrigin && !row.routeDestination &&
      (!row.routeId || row.routeId===after.routeId));
    const matches=[...new Map([...exact,...semantic].map(row=>[row.id,row])).values()];
    if(matches.length>1) throw new Error('Ambiguous tariff: '+after.code);
    const before=matches[0];
    if(before) {
      if(!semantic.includes(before)) throw new Error('Tariff code collision or incompatible scope: '+after.code);
      if(before.effectiveFrom || before.effectiveTo) throw new Error('Dated tariff requires manual effective-date review: '+before.code);
      if(before.vatIncluded || before.vatRate) throw new Error('Existing tax treatment requires manual review: '+before.code);
      // Keep existing identity/code and office notes; appending source notes is idempotent.
      after.code=before.code;
      after.notes=before.notes?.includes(SOURCE_NOTE) ? before.notes : [before.notes,after.notes].filter(Boolean).join('\n');
      if(after.notes.length>3000) throw new Error('Notes exceed tariff limit: '+after.code);
    }
    return change(before,after);
  });
  const counts={};
  for(const [label,changes] of [['routes',routeChanges],['tariffs',tariffChanges]]) {
    for(const action of ['create','update','unchanged']) counts[label+action[0].toUpperCase()+action.slice(1)]=changes.filter(r=>r.action===action).length;
  }
  return {source:'user-verified photo HARGA BARU; no effective date',counts,routes:routeChanges,tariffs:tariffChanges,omitted:OMITTED};
}
module.exports = { SOURCE_ROWS, SOURCE_NOTE, OMITTED, destinations, tariffs, key, plan };

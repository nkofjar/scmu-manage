import test from 'node:test';
import assert from 'node:assert/strict';
import {masterPayload,expiryState,loadCompanies} from './transportModel.mjs';
test('unknown optional dates stay null and explicit zero capacity stays zero',()=>{
 const body=masterPayload('fleet',{registrationNo:'PA 1',type:'TRUCK',capacity:'0',year:'',stnkExpiry:'',kirExpiry:'',ownershipType:'',companyId:''});
 assert.equal(body.capacity,0);assert.equal(body.year,null);assert.equal(body.stnkExpiry,null);assert.equal(body.kirExpiry,null);assert.equal(body.ownershipType,null);
 assert.equal(masterPayload('drivers',{name:'A',licenseExpiry:''}).licenseExpiry,null);
 assert.equal(expiryState(null,'2026-11-05'),'unknown');assert.equal(expiryState('2026-11-04','2026-11-05'),'expired');assert.equal(expiryState('2026-12-05','2026-11-05'),'expiring');assert.equal(expiryState('2026-12-06','2026-11-05'),'valid');
});
test('expiry follows the Jayapura calendar at UTC day boundaries',()=>{
 const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-11-05T16:00:00Z']));}};
 try{assert.equal(expiryState('2026-11-05'),'expired');}finally{globalThis.Date=RealDate;}
});
test('company chooser follows all pages rather than silently truncating',async()=>{
 const pages=[];const result=await loadCompanies(async(_url,{params})=>{pages.push(params.page);return {data:{data:[{id:String(params.page)}],page:params.page,total:3,limit:1,totalPages:3}};});
 assert.deepEqual(pages,[1,2,3]);assert.deepEqual(result.map(r=>r.id),['1','2','3']);
});

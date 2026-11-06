import test from 'node:test';
import assert from 'node:assert/strict';
let model={};try{model=await import('./journeyBillSearch.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
test('partial canonical container search covers all bills including later pages and shared containers',()=>{
 assert.equal(typeof model.searchJourneyBills,'function');
 const bills=Array.from({length:25},(_,i)=>({id:'b'+i,containers:[{number:i>20?'ABCU 123-4567':'OTHER'+i}]}));
 const found=model.searchJourneyBills(bills,'cU-123');
 assert.deepEqual(found.map(r=>r.id),['b21','b22','b23','b24']);
 assert.deepEqual(found[0].matchedContainers,['ABCU 123-4567']);
 assert.deepEqual(model.containerMatchParts('ABCU 123-4567','cu123'),[{text:'AB',match:false},{text:'CU 123',match:true},{text:'-4567',match:false}]);
 assert.equal(model.searchJourneyBills(bills,' -- ').length,25);
 assert.equal(model.searchJourneyBills(bills,'nomatch').length,0);
 assert.equal(bills[21].matchedContainers,undefined);
});

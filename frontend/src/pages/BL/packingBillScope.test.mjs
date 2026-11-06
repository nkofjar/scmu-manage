import test from 'node:test';
import assert from 'node:assert/strict';
import {packingImportBill} from './packingBillScope.mjs';

test('B/L creator never sends a shared, unknown-scope or voyage original to the whole-file importer',()=>{
 const own={id:'own',scope:{type:'BL',billIds:['a']}}, shared={id:'shared',scope:{type:'SHARED',billIds:['a','b']}}, unknown={id:'legacy'},voyage={id:'recap',scope:{type:'VOYAGE'}},other={id:'other',scope:{type:'BL',billIds:['b']}};
 const bill={id:'a',files:[own,shared,unknown,voyage,other]};
 assert.deepEqual(packingImportBill(bill).files,[own]);
 assert.equal(bill.files.length,5,'Do not mutate the loaded bill');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {billDocumentRows,isVoyageReference,isSharedDocument,journeyPackingOutputEndpoint,packingMappedForBill} from './billScope.mjs';
test('vessel recap printing stays on aggregate API instead of bill output',()=>{
 assert.equal(journeyPackingOutputEndpoint({category:'INTERNAL_PACKING_RECAP',scope:{type:'VOYAGE'},billIds:['a','b'],ref:'a:f',endpoint:'/bl-register/a/files/f'}),'/operations/voyage-packing/a/f');
 assert.equal(journeyPackingOutputEndpoint({category:'INTERNAL_PACKING_LIST',endpoint:'/bl-register/a/files/local'}),'/bl-register/a/files/local/packing-output');
});
import * as scopeHelpers from './billScope.mjs';
test('only supported saved packing formats expose journey print actions',()=>{
 assert.equal(typeof scopeHelpers.canPrintJourneyPacking,'function');
 const printable=scopeHelpers.canPrintJourneyPacking;
 assert.equal(printable({source:'BILL',category:'INTERNAL_PACKING_LIST'}),true);
 assert.equal(printable({source:'BILL',category:'INTERNAL_PACKING_RECAP',scope:{type:'VOYAGE'}}),true);
 for(const type of ['BL','SHARED']){
  const recap={source:'BILL',category:'INTERNAL_PACKING_RECAP',scope:{type},endpoint:'/bl-register/a/files/recap'};
  assert.equal(printable(recap),false);
  assert.throws(()=>journeyPackingOutputEndpoint(recap),/pratinjau|unduh/i);
 }
 assert.equal(printable({source:'JOURNEY',category:'INTERNAL_PACKING_LIST'}),false);
 assert.equal(printable(null),false);
});
test('partial file responses preserve known scope without restoring removed attachments',()=>{
 const known=[{id:'voyage',category:'INTERNAL_PACKING_RECAP',scope:{type:'VOYAGE'},readOnly:true},{id:'shared',category:'PACKING_LIST',scope:{type:'SHARED',billIds:['a','b']}}];
 assert.equal(typeof scopeHelpers.normalizeBillFiles,'function');
 const normalize=scopeHelpers.normalizeBillFiles;
 for(const response of [[{id:'voyage'},{id:'shared'}],{files:[{id:'voyage'},{id:'shared'}]},{data:[{id:'voyage'},{id:'shared'}]}]){
  const files=normalize(response,known);
  assert.equal(isVoyageReference(files[0]),true);assert.equal(files[0].readOnly,true);
  assert.equal(isSharedDocument(files[1]),true);assert.equal(files[1].category,'PACKING_LIST');
  assert.deepEqual(billDocumentRows(files).map(f=>f.id),['shared']);
 }
 assert.deepEqual(normalize({files:[]},known),[]);
 assert.deepEqual(normalize([],known),[]);
 assert.deepEqual(normalize({version:2},known),known);
 assert.deepEqual(normalize(null,known),known);
 assert.deepEqual(normalize([{id:'shared',scope:{type:'BL'}}],known)[0].scope,{type:'BL'});
 assert.equal(known[1].scope.type,'SHARED');
});
test('source summaries are not proof of B/L mapping',()=>{
 const bill={registerData:{partnerPackingSummaries:{shared:{summary:{rows:[]}}},operational:{packing:{scopeConfirmed:false,groups:[{sourceFileId:'shared'}]}}}};
 assert.equal(packingMappedForBill(bill,{id:'shared',category:'PACKING_LIST',scope:{type:'SHARED'}}),false);
 bill.registerData.operational.packing.scopeConfirmed=true;
 assert.equal(packingMappedForBill(bill,{id:'shared',category:'PACKING_LIST',scope:{type:'SHARED'}}),true);
});
test('legacy and explicit voyage recap references cannot enter B/L packing selection',()=>{
 const own={id:'own',category:'INTERNAL_PACKING_LIST'},legacy={id:'legacy',category:'INTERNAL_PACKING_RECAP',note:'Rekap Packing List kapal; RPL-1'},explicit={id:'new',scope:{type:'VOYAGE'}};
 assert(isVoyageReference(legacy));assert(isVoyageReference(explicit));assert(!isVoyageReference(own));
 assert.deepEqual(billDocumentRows([own,legacy,explicit]),[own]);
});
test('shared original files remain available, without altering source metadata',()=>{
 const file={id:'shared',category:'PACKING_LIST',scope:{type:'SHARED',billIds:['a','b']}};
 const before=structuredClone(file);assert(isSharedDocument(file));assert.deepEqual(billDocumentRows([file]),[file]);assert.deepEqual(file,before);
 assert(!isSharedDocument({id:'single',scope:{type:'BL',billIds:['a']}}));
});

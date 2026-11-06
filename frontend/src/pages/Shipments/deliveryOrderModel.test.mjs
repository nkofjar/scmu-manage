import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryOrders} from './deliveryOrderModel.mjs';

test('DO rows belong to this B/L, newest first; unrelated and voyage files stay excluded',()=>{
 const bill={id:'a',files:[
  {id:'old',category:'DELIVERY_ORDER',createdAt:'2026-01-01',scope:{type:'BL',billIds:['a']}},
  {id:'other',category:'DELIVERY_ORDER',scope:{type:'BL',billIds:['b']}},
  {id:'recap',category:'INTERNAL_PACKING_RECAP'},
  {id:'voyage',category:'DELIVERY_ORDER',scope:{type:'VOYAGE'}},
  {id:'new',category:'DELIVERY_ORDER',createdAt:'2026-02-01'},
 ]};
 assert.deepEqual(deliveryOrders(bill).map(f=>f.id),['new','old']);
 assert.deepEqual(deliveryOrders(bill,{data:[]}),[],'authoritative empty response clears old files');
 assert.deepEqual(deliveryOrders(bill,{data:[{id:'other',category:'DELIVERY_ORDER'}]}),[],'partial response retains known scope');
});

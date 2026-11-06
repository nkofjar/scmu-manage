import test from 'node:test';
import assert from 'node:assert/strict';
import { detailModule, localPage, pageLabel, positivePage } from './navigation.mjs';

test('return navigation accepts only internal SCMU pages, including filtered sources', () => {
  for (const url of ['/','/bl-register?search=Merauke','/bl-register/id?tab=documents','/users','/settings']) assert.equal(localPage(url), true);
  for (const url of ['https://example.com','//example.com','/\\example.com','/login','/unknown','/jobs','/jobs\r\nLocation: test',null]) assert.equal(localPage(url), false);
  assert.equal(pageLabel('/bl-register?search=Merauke'), 'Pengiriman');
  assert.equal(detailModule('/bl-register/id'), 'bl-register');
  assert.equal(detailModule('/jobs'), null);
  assert.equal(pageLabel('/bl-register/trash'),'Sampah pengiriman');assert.equal(detailModule('/bl-register/trash'),null);
});
test('delivery masters are valid return destinations with distinct page labels', () => {
  for (const [path,label] of [['/delivery-routes','Rute pengantaran'],['/goods-types','Muatan']]) {
    assert.equal(localPage(path+'?page=2'),true);
    assert.equal(pageLabel(path),label);
  }
});
test('malformed pagination falls back to the first page', () => {
  for (const value of [null,'0','-3','1.5','NaN','Infinity','9007199254740992']) assert.equal(positivePage(value),1);
  assert.equal(positivePage('2'),2);
});

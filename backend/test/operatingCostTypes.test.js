const test = require('node:test');
const assert = require('node:assert/strict');
const { withCatalogApp } = require('./helpers/transportCatalogFixture');
test('operating cost master HTTP supports allowlisted admin writes, staff reads and versioned deactivation', () => withCatalogApp(async ({ request, rows }) => {
  const url = '/operating-cost-types', body = { code: 'fuel', name: 'Bahan bakar', defaultUnit: 'RIT' };
  assert.equal((await request(url, body, 'POST', 'OPERATOR')).status, 403);
  assert.equal((await request(url, { ...body, costCategory: 'FUEL' })).status, 422);
  for (const defaultUnit of ['JOB', 'KG', '', null]) assert.equal((await request(url, { ...body, defaultUnit })).status, 422);
  const saved = await request(url, body); assert.equal(saved.status, 201); assert.equal(saved.data.code, 'FUEL');
  const read = await request(`${url}?limit=200`, undefined, 'GET', 'OPERATOR');
  assert.equal(read.status, 200); assert.equal(read.data.data[0].id, saved.data.id);
  assert.equal((await request(url, body)).status, 409);
  const changed = await request(`${url}/${saved.data.id}`, { version: 1, isActive: false }, 'PUT');
  assert.equal(changed.status, 200); assert.equal(changed.data.version, 2);
  assert.equal((await request(`${url}/${saved.data.id}`, { version: 1, name: 'Stale' }, 'PUT')).status, 409);
  assert.equal((await request(`${url}?limit=200`)).data.data.length, 0);
  assert.equal((await request(`${url}?limit=200&active=all`)).data.data.length, 1);
  assert.equal(rows.operatingCostType.length, 1);
}));

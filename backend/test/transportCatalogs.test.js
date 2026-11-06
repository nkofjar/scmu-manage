const test = require('node:test');
const assert = require('node:assert/strict');
const { withCatalogApp } = require('./helpers/transportCatalogFixture');
const route = () => ({ name: 'Pelabuhan ke gudang', originCity: 'Jayapura', originState: 'Papua', destCity: 'Sentani', destState: 'Papua', distanceKm: 35, estimatedDays: 1 });
const goods = () => ({ name: 'Beras', description: 'Karung', isHazardous: false, isPerishable: false });
test('catalog HTTP allowlists reject injected relations and preserve authenticated legacy array reads', () => withCatalogApp(async ({ request, rows }) => {
  for (const [url, body, kind] of [['/routes', route(), 'route'], ['/goods', goods(), 'goodsType']]) {
    assert.equal((await request(url, undefined, 'GET', null)).status, 401);
    assert.equal((await request(url, undefined, 'GET', 'CUSTOMER')).status, 403);
    assert.equal((await request(url, { ...body, shipments: { deleteMany: {} } })).status, 422);
    assert.equal(rows[kind].length, 0);
    assert.equal((await request(url, body, 'POST', 'OPERATOR')).status, 403);
    const saved = await request(url, body); assert.equal(saved.status, 201); assert.equal(saved.data.version, 1);
    const legacy = await request(url, undefined, 'GET', 'ADMIN'); assert.equal(Array.isArray(legacy.data), true); assert.equal(legacy.data.length, 1);
    const paged = await request(`${url}?limit=200`); assert.equal(paged.data.total, 1); assert.equal(paged.data.data[0].id, saved.data.id);
  }
}));
test('catalog updates use compare-and-swap version and deactivate without duplicating history', () => withCatalogApp(async ({ request, rows }) => {
  for (const [url, body, kind] of [['/routes', route(), 'route'], ['/goods', goods(), 'goodsType']]) {
    const created = await request(url, body); const id = created.data.id;
    const changed = await request(`${url}/${id}`, { name: 'Revised', version: 1 }, 'PUT');
    assert.equal(changed.status, 200); assert.equal(changed.data.id, id); assert.equal(changed.data.version, 2);
    assert.equal(rows[kind].length, 1); assert.equal(rows[kind][0].name, 'Revised');
    assert.equal((await request(`${url}/${id}`, { name: 'Stale', version: 1 }, 'PUT')).status, 409);
    assert.equal((await request(`${url}/${id}`, { name: 'Missing version' }, 'PUT')).status, 422);
    assert.equal((await request(`${url}/${id}`, { version: 2, isActive: 'false' }, 'PUT')).status, 422);
    const inactive = await request(`${url}/${id}`, { version: 2, isActive: false }, 'PUT');
    assert.equal(inactive.status, 200); assert.equal(inactive.data.isActive, false);
    assert.equal((await request(`${url}?limit=200`)).data.total, 0);
    assert.equal((await request(`${url}?limit=200&active=all`)).data.data[0].id, id);
    assert.equal((await request(`${url}/${id}`, undefined, 'DELETE')).status, 404);
  }
}));
module.exports = { route, goods };

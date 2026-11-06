const express = require('express');
const { randomUUID } = require('node:crypto');
const prisma = require('../../src/prisma');
async function withCatalogApp(run) {
  const originals = [], rows = { route: [], goodsType: [], operatingCostType: [], jptTariff: [], activityLog: [] };
  const replace = (obj, key, value) => { const original = obj[key]; originals.push(() => { obj[key] = original; }); obj[key] = value; };
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => key === 'OR' ? value.some(w => matches(row, w)) : value && typeof value === 'object' ? 'not' in value ? row[key] !== value.not : String(row[key] || '').toLowerCase().includes(String(value.contains).toLowerCase()) : row[key] === value);
  for (const kind of Object.keys(rows)) {
    if (!prisma[kind]) replace(prisma, kind, {});
    const model = prisma[kind];
    replace(model, 'findUnique', async ({ where }) => rows[kind].find(r => matches(r, where)) || null);
    replace(model, 'findFirst', async ({ where }) => rows[kind].find(r => matches(r, where)) || null);
    replace(model, 'findMany', async ({ where, skip = 0, take } = {}) => rows[kind].filter(r => matches(r, where)).slice(skip, take ? skip + take : undefined).map(r => ({ ...r })));
    replace(model, 'count', async ({ where }) => rows[kind].filter(r => matches(r, where)).length);
    replace(model, 'create', async ({ data }) => { const row = { id: randomUUID(), version: 1, isActive: true, createdAt: new Date(), ...data }; rows[kind].push(row); return { ...row }; });
    const update = ({ where, data }) => { const selected = rows[kind].filter(r => matches(r, where)); for (const row of selected) for (const [key, value] of Object.entries(data)) row[key] = value?.increment ? row[key] + value.increment : value; return selected; };
    replace(model, 'updateMany', async args => ({ count: update(args).length }));
    replace(model, 'update', async args => ({ ...update(args)[0] }));
  }
  replace(prisma, '$transaction', async work => work(prisma));
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { if (req.headers['x-role']) req.user = { id: 'staff', role: req.headers['x-role'] }; next(); });
  app.use('/routes', require('../../src/routes/routes'));
  app.use('/goods', require('../../src/routes/goods'));
  // Optional during the first red/green slice; the next slice explicitly requires its route.
  const fs = require('node:fs');
  if (fs.existsSync(require('node:path').join(__dirname, '../../src/routes/operatingCostTypes.js'))) app.use('/operating-cost-types', require('../../src/routes/operatingCostTypes'));
  app.use('/jpt-tariffs', require('../../src/routes/jptTariffs'));
  app.use((error, req, res, next) => res.status(error.code === 'P2002' ? 409 : error.status || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const request = async (url, body, method = body ? 'POST' : 'GET', role = 'ADMIN') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { 'Content-Type': 'application/json', ...(role ? { 'x-role': role } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text() };
  };
  try { await run({ rows, request, prisma }); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); originals.reverse().forEach(f => f()); }
}
module.exports = { withCatalogApp };

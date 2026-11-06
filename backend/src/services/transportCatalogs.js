const { fail, text, choice, audit } = require('./jpt');
const { listPage } = require('./pagination');
const UNITS = ['BL', 'CONTAINER', 'RIT', 'TON', 'DAY'];
const DEFINITIONS = {
  costs: { model: 'operatingCostType', fields: ['code', 'name', 'defaultUnit', 'isActive'], search: ['code', 'name'] },
  routes: { model: 'route', fields: ['name', 'originCity', 'originState', 'destCity', 'destState', 'distanceKm', 'estimatedDays', 'isActive'], search: ['name', 'originCity', 'destCity'] },
  goods: { model: 'goodsType', fields: ['name', 'description', 'isHazardous', 'isPerishable', 'isActive'], search: ['name', 'description'] },
};
function definition(kind) { const result = DEFINITIONS[kind]; fail(result, 'Unknown catalog', 404); return result; }
function allowed(body, fields) {
  fail(body && typeof body === 'object' && !Array.isArray(body), 'Object body required');
  fail(Object.keys(body).every(key => fields.includes(key)), 'Unsupported master field');
}
function boolean(value, name, fallback) { if (value === undefined) return fallback; fail(typeof value === 'boolean', `${name} must be true or false`); return value; }
function fieldsFor(kind, body, current = {}) {
  const data = { ...current, ...body };
  const fields = { name: text(data.name, 'Nama', 200), isActive: boolean(data.isActive, 'isActive', true) };
  if (kind === 'routes') {
    for (const key of ['originCity', 'originState', 'destCity', 'destState']) fields[key] = text(data[key], key, 200);
    for (const key of ['distanceKm', 'estimatedDays']) {
      const value = data[key];
      fields[key] = value == null || value === '' ? null : Number(value);
      fail(fields[key] === null || ((typeof value === 'string' || typeof value === 'number') && String(value).trim() !== '' && Number.isFinite(fields[key]) && fields[key] >= 0 && fields[key] <= 100000 && (key !== 'estimatedDays' || Number.isInteger(fields[key]))), `${key} is invalid`);
    }
  } else if (kind === 'costs') {
    fields.code = text(data.code, 'Code', 100).toUpperCase();
    fail(/^[A-Z0-9][A-Z0-9_-]*$/.test(fields.code), 'Code is invalid');
    fields.defaultUnit = choice(data.defaultUnit, UNITS, 'Default unit');
  } else {
    fields.description = text(data.description, 'Keterangan', 3000, true);
    for (const key of ['isHazardous', 'isPerishable']) fields[key] = boolean(data[key], key, false);
  }
  return fields;
}
async function list(tx, kind, query = {}) {
  const config = definition(kind);
  const active = query.active ?? 'true'; choice(active, ['true', 'false', 'all'], 'Active filter');
  const search = query.search === undefined ? null : text(query.search, 'Search', 200, true);
  const where = { ...(active === 'all' ? {} : { isActive: active === 'true' }), ...(search ? { OR: config.search.map(key => ({ [key]: { contains: search, mode: 'insensitive' } })) } : {}) };
  const options = { where, orderBy: [{ name: 'asc' }, { id: 'asc' }] };
  return query.limit !== undefined || query.page !== undefined ? listPage(tx[config.model], options, query) : tx[config.model].findMany(options);
}
async function save(tx, user, kind, id, body) {
  fail(['ADMIN', 'SUPER_ADMIN'].includes(user.role), 'Administrator required', 403);
  const config = definition(kind); allowed(body, [...config.fields, ...(id ? ['version'] : [])]);
  const model = tx[config.model];
  const current = id ? await model.findUnique({ where: { id } }) : null;
  if (id) fail(current, 'Master not found', 404);
  const fields = fieldsFor(kind, body, current || {});
  if (kind === 'costs') {
    const duplicate = await model.findFirst({ where: { code: fields.code, ...(id ? { id: { not: id } } : {}) } });
    fail(!duplicate, 'Code already exists', 409);
  }
  let result;
  if (id) {
    fail(typeof body.version === 'number' && Number.isSafeInteger(body.version) && body.version > 0, 'Version is required');
    fail(body.version === current.version, 'Master berubah. Muat ulang sebelum menyimpan.', 409);
    const changed = await model.updateMany({ where: { id, version: body.version }, data: { ...fields, version: { increment: 1 } } });
    fail(changed.count === 1, 'Master berubah. Muat ulang sebelum menyimpan.', 409);
    result = await model.findUnique({ where: { id } });
  } else result = await model.create({ data: fields });
  await audit(tx, user, id ? 'TRANSPORT_CATALOG_UPDATED' : 'TRANSPORT_CATALOG_CREATED', config.model, result.id, { before: current, after: fields });
  return result;
}
module.exports = { list, save, allowed, boolean, DEFINITIONS };

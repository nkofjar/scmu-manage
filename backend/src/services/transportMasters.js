const { fail, text } = require('./jpt');
const companyInclude = { company: { select: { id: true, name: true, isInternal: true, isActive: true } } };
const vehicleTypes = ['TRUCK', 'TRAILER', 'CONTAINER', 'TANKER', 'REFRIGERATED', 'FLATBED', 'MINI_TRUCK', 'TEMPO'];
function id(value, field = 'ID') {
  fail(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value), `${field} is invalid`);
  return value;
}
function calendarDate(value, field) {
  if (value === '' || value === null) return null;
  fail(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), `${field} must be YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00.000Z`);
  fail(Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value, `${field} must be a valid calendar date`);
  return date;
}
function normalize(kind, body, creating = false) {
  const data = {}, vehicle = kind === 'vehicle';
  const required = vehicle ? { registrationNo: 20 } : { name: 100, phone: 20, licenseNo: 100 };
  for (const [field, max] of Object.entries(required)) if (creating || body[field] !== undefined) data[field] = text(body[field], field, max);
  const optional = vehicle ? ['make', 'model', 'bodyType'] : ['licenseClass', 'address', 'city', 'state', 'emergencyContact'];
  for (const field of optional) if (body[field] !== undefined) data[field] = text(body[field], field, 500, true);
  const dates = vehicle ? ['stnkExpiry', 'kirExpiry'] : ['licenseExpiry'];
  for (const field of dates) if (body[field] !== undefined) data[field] = calendarDate(body[field], field);
  if (vehicle && (creating || body.type !== undefined)) { fail(vehicleTypes.includes(body.type), 'Vehicle type is invalid'); data.type = body.type; }
  if (vehicle && (creating || body.capacity !== undefined)) {
    fail(['string', 'number'].includes(typeof body.capacity) && String(body.capacity).trim() !== '', 'Capacity is required');
    data.capacity = Number(body.capacity); fail(Number.isFinite(data.capacity) && data.capacity >= 0 && data.capacity <= 1000000, 'Capacity must be a non-negative number');
  }
  if (vehicle && body.year !== undefined) {
    data.year = body.year === '' || body.year === null ? null : Number(body.year);
    fail(data.year === null || (['string', 'number'].includes(typeof body.year) && Number.isInteger(data.year) && data.year >= 1 && data.year <= 9999), 'Year is invalid');
  }
  const field = vehicle ? 'ownershipType' : 'employmentType';
  if (creating || body[field] !== undefined) {
    data[field] = body[field] === '' || body[field] == null ? null : body[field];
    fail(data[field] === null || [vehicle ? 'OWN' : 'INTERNAL', 'VENDOR'].includes(data[field]), `${field} is invalid`);
  }
  if (creating || body.companyId !== undefined) data.companyId = body.companyId === '' || body.companyId == null ? null : id(body.companyId, 'Company ID');
  if (body.isActive !== undefined) { fail(typeof body.isActive === 'boolean', 'isActive must be boolean'); data.isActive = body.isActive; }
  return data;
}
async function validateCompany(tx, kind, data) {
  const classification = data[kind === 'vehicle' ? 'ownershipType' : 'employmentType'];
  fail(!classification || data.companyId, 'Select a company for the explicit classification');
  if (!data.companyId) return;
  const company = await tx.company.findUnique({ where: { id: data.companyId } });
  fail(company?.isActive, 'Select an active company');
  if (classification) {
    fail(classification === 'VENDOR' ? company.isInternal === false : company.isInternal === true, 'Company does not match ownership/employment type');
    if (classification !== 'VENDOR') await require('./access').internalCompany(tx, data.companyId);
  }
}
async function create(tx, kind, body) {
  const data = normalize(kind, body, true); await validateCompany(tx, kind, data);
  return tx[kind].create({ data, include: companyInclude });
}
function compliance(value, now = new Date()) {
  if (!value) return { status: 'unknown', daysRemaining: null };
  const expiry = new Date(value);
  const localDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jayapura', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const today = Date.parse(`${localDay}T00:00:00.000Z`);
  if (!Number.isFinite(expiry.getTime())) return { status: 'unknown', daysRemaining: null };
  const daysRemaining = Math.floor((Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate()) - today) / 86400000);
  return { status: daysRemaining < 0 ? 'expired' : daysRemaining <= 30 ? 'expiring' : 'valid', daysRemaining };
}
function present(kind, row) {
  const checks = kind === 'vehicle' ? { stnk: compliance(row.stnkExpiry), kir: compliance(row.kirExpiry) } : { sim: compliance(row.licenseExpiry) };
  return { ...row, compliance: checks, complianceWarningDays: 30 };
}
async function get(tx, kind, recordId, detail = false) {
  const include = detail ? { ...companyInclude, trips: { take: 10, orderBy: { createdAt: 'desc' }, ...(kind === 'vehicle' ? { include: { driver: { select: { name: true } } } } : {}) } } : companyInclude;
  const row = await tx[kind].findUnique({ where: { id: id(recordId) }, include });
  fail(row, `${kind === 'vehicle' ? 'Vehicle' : 'Driver'} not found`, 404); return row;
}
function version(value) {
  fail((typeof value === 'number' || typeof value === 'string') && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0, 'A valid version is required');
  return Number(value);
}
async function advance(tx, kind, row, value, data = {}) {
  const expected = version(value); fail(row.version === expected, 'Record changed; reload before saving', 409);
  const result = await tx[kind].updateMany({ where: { id: row.id, version: expected }, data: { ...data, version: { increment: 1 } } });
  fail(result.count === 1, 'Record changed; reload before saving', 409);
}
async function update(tx, kind, recordId, body, deactivate = false) {
  const row = await get(tx, kind, recordId), data = deactivate ? { isActive: false } : normalize(kind, body);
  if (!deactivate) {
    const classificationField = kind === 'vehicle' ? 'ownershipType' : 'employmentType';
    if (data.companyId !== undefined || data[classificationField] !== undefined || data.isActive === true) await validateCompany(tx, kind, { ...row, ...data });
  }
  await advance(tx, kind, row, body.version, data); return present(kind, await get(tx, kind, recordId));
}
async function list(tx, kind, query) {
  const { listPage } = require('./pagination'), where = {};
  fail(query.active === undefined || ['all', 'true', 'false'].includes(query.active), 'Active filter is invalid');
  if (query.active !== 'all') where.isActive = query.active !== 'false';
  if (query.companyId !== undefined) where.companyId = id(query.companyId, 'Company ID');
  const classification = kind === 'vehicle' ? 'ownershipType' : 'employmentType';
  if (query[classification] !== undefined) {
    fail([kind === 'vehicle' ? 'OWN' : 'INTERNAL', 'VENDOR', 'unknown'].includes(query[classification]), `${classification} is invalid`);
    where[classification] = query[classification] === 'unknown' ? null : query[classification];
  }
  if (kind === 'vehicle' && query.type !== undefined) { fail(vehicleTypes.includes(query.type), 'Vehicle type is invalid'); where.type = query.type; }
  if (query.search !== undefined) {
    const search = text(query.search, 'Search', 200, true);
    if (search) where.OR = (kind === 'vehicle' ? ['registrationNo'] : ['name', 'phone', 'licenseNo']).map(field => ({ [field]: { contains: search, mode: 'insensitive' } }));
  }
  const result = await listPage(tx[kind], { where, include: { ...companyInclude, _count: { select: { trips: true } } }, orderBy: [{ [kind === 'vehicle' ? 'registrationNo' : 'name']: 'asc' }, { id: 'asc' }] }, query);
  return { ...result, data: result.data.map(row => present(kind, row)) };
}
module.exports = { create, calendarDate, companyInclude, normalize, validateCompany, id, get, update, list, present, compliance, version, advance };

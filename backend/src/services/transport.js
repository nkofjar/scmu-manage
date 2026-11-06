const { fail, choice, vendor } = require('./jpt');
const { INTERNAL_COMPANY_ID } = require('./access');
const COST_CATEGORIES = ['FUEL', 'TOLL', 'PARKING', 'DRIVER_ALLOWANCE', 'LOADING_UNLOADING', 'FREIGHT', 'OTHER'];

async function transportFields(tx, body) {
  const mode = choice(body.mode || 'ROAD', ['ROAD', 'SEA', 'AIR', 'RAIL'], 'Transport mode');
  const vehicle = body.vehicleId ? await tx.vehicle.findUnique({ where: { id: body.vehicleId } }) : null;
  const driver = body.driverId ? await tx.driver.findUnique({ where: { id: body.driverId } }) : null;
  fail(!body.vehicleId || vehicle?.isActive, 'Select an active vehicle');
  fail(!body.driverId || driver?.isActive, 'Select an active driver');
  let carrierId = body.carrierId || null;
  if (body.quoteId) {
    const quote = await tx.quote.findUnique({ where: { id: body.quoteId } });
    fail(quote?.status === 'ACCEPTED', 'Select an accepted vendor quote');
    fail(!carrierId || carrierId === quote.transporterId, 'Quote and vendor must match');
    carrierId = quote.transporterId;
  }
  const externalResource = [vehicle, driver].find(record => record && record.companyId !== INTERNAL_COMPANY_ID);
  const transportSource = choice(body.transportSource || (carrierId || externalResource || mode !== 'ROAD' ? 'EXTERNAL' : 'INTERNAL'), ['INTERNAL', 'EXTERNAL'], 'Transport source');
  if (transportSource === 'INTERNAL') {
    fail(mode === 'ROAD', 'SCMU fleet supports road transport only');
    fail(!carrierId && !body.quoteId, 'Internal transport cannot use a vendor');
    fail(vehicle && driver, 'Select an SCMU vehicle and driver');
    fail([vehicle, driver].every(record => record.companyId === INTERNAL_COMPANY_ID), 'Vehicle and driver must belong to SCMU');
  } else {
    carrierId ||= externalResource?.companyId;
    fail(carrierId, 'Select a vendor for external transport');
    await vendor(tx, carrierId);
    fail([vehicle, driver].every(record => !record || record.companyId === carrierId), 'Vehicle or driver must belong to the selected vendor');
    fail(mode === 'ROAD' || (!vehicle && !driver), 'Road vehicles and drivers cannot be assigned to sea, air or rail transport');
  }
  return { mode, transportSource, carrierId: carrierId || null, quoteId: body.quoteId || null, vehicleId: vehicle?.id || null, driverId: driver?.id || null };
}

async function operatingCostTypeSnapshot(tx, body) {
  const id = body.operatingCostTypeId;
  if (id === undefined || id === null || id === '') return null;
  fail(typeof id === 'string' && id.length <= 100 && id.trim() === id && id.length > 0, 'Select a valid operating cost type');
  const row = await tx.operatingCostType.findUnique({ where: { id } });
  fail(row?.isActive, 'Select an active operating cost type');
  return { id: row.id, code: row.code, name: row.name, defaultUnit: row.defaultUnit };
}

async function costFields(tx, jobId, body, current = {}) {
  const costSource = choice(body.costSource || current.costSource || 'VENDOR', ['INTERNAL', 'VENDOR'], 'Cost source');
  const costCategory = choice(body.costCategory || current.costCategory || 'OTHER', COST_CATEGORIES, 'Cost category');
  const shipmentId = (body.shipmentId !== undefined ? body.shipmentId : current.shipmentId) || null;
  const requestedVendor = body.vendorId !== undefined ? body.vendorId : current.vendorId;
  let vendorId = null;
  if (costSource === 'INTERNAL') fail(!requestedVendor, 'Internal costs cannot have a vendor');
  else vendorId = await vendor(tx, requestedVendor);
  if (shipmentId) {
    const shipment = await tx.shipment.findFirst({ where: { id: shipmentId, jobId } });
    fail(shipment && shipment.status !== 'CANCELLED', 'Select a transport leg from this job');
    fail(shipment.transportSource === (costSource === 'INTERNAL' ? 'INTERNAL' : 'EXTERNAL'), 'Cost source must match the transport leg');
    if (vendorId) fail(shipment.carrierId === vendorId, 'Cost vendor must match the transport leg');
  }
  return { costSource, costCategory, shipmentId, vendorId };
}
async function transportChange(tx, current, body) {
  const assignment = await transportFields(tx, { ...current, ...body });
  if (current.jobId) {
    const charges = await tx.jobCharge.findMany({ where: { shipmentId: current.id, kind: 'COST', status: { not: 'REJECTED' } } });
    fail(charges.every(charge => charge.costSource === (assignment.transportSource === 'INTERNAL' ? 'INTERNAL' : 'VENDOR') && (!charge.vendorId || charge.vendorId === assignment.carrierId)), 'Update linked costs before changing the transport source or vendor', 409);
  }
  const { decimal, text, date } = require('./jpt');
  return { ...assignment, ...(body.freightAmount !== undefined && { freightAmount: body.freightAmount === '' || body.freightAmount === null ? null : decimal(body.freightAmount).toNumber() }), ...(body.expectedDelivery !== undefined && { expectedDelivery: date(body.expectedDelivery, true) }), ...(body.notes !== undefined && { notes: text(body.notes, 'Notes', 2000, true) }), ...(body.status === 'CANCELLED' && { status: 'CANCELLED' }) };
}
module.exports = { transportFields, costFields, operatingCostTypeSnapshot, transportChange, COST_CATEGORIES };

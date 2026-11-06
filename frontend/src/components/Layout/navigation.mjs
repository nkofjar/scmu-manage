const modules = {
  shipments:'Pengiriman', 'delivery-routes':'Rute pengantaran', 'goods-types':'Muatan',
  vessels:'Kapal', 'fleet-drivers':'Kendaraan & Sopir', 'driver-trips':'Ritase & Upah',
  'bl-register': 'Pengiriman', 'packing-lists':'Packing List', tariffs:'Tarif & Biaya', 'billing-tax':'Tagihan & Pajak', approvals:'Persetujuan Direktur', partners:'Mitra/JPT', users: 'User Management', settings: 'Settings',
};
export function pageLabel(url) {
  const [module, id] = url.split('?')[0].split('/').filter(Boolean);
  if (!module) return 'Dashboard';
  if (module === 'bl-register' && id === 'trash') return 'Sampah pengiriman';
  if (id && id !== 'new') return modules[module];
  return modules[module] || 'Dashboard';
}
export function detailModule(pathname) {
  if (/^\/bl-register\/trash\/?$/.test(pathname)) return null;
  const module=/^\/(bl-register|vessels|shipments)\/[^/]+(?:\/voyages\/[^/]+)?\/?$/.exec(pathname)?.[1];return module==='shipments'?'bl-register':module||null;
}
export function localPage(url) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || /[\\\r\n]/.test(url)) return false;
  const path = url.split('?')[0].split('#')[0];
  return path === '/' || Object.keys(modules).some(module => path === `/${module}` || path.startsWith(`/${module}/`));
}
export function positivePage(value) {
  const page = Number(value); return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

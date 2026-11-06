import {billDocumentRows,normalizeBillFiles} from '../BL/billScope.mjs';

export function deliveryOrders(bill,response){
 return billDocumentRows(normalizeBillFiles(response,bill.files||[]))
  .filter(f=>f.category==='DELIVERY_ORDER'&&(!f.scope?.billIds?.length||f.scope.billIds.includes(bill.id)))
  .sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))||String(b.id).localeCompare(String(a.id)));
}

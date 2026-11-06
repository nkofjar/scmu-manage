// The existing importer preselects every group. Shared/unknown originals must
// instead be transcribed and explicitly reviewed within this B/L.
export const packingImportBill = bill => ({...bill,files:(bill.files||[]).filter(file => file.scope?.type === 'BL' && file.scope.billIds?.length === 1 && file.scope.billIds[0] === bill.id)});

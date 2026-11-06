// A voyage recap is a reference, never a B/L-local Packing List.
export const isVoyageReference = file => file?.scope?.type === 'VOYAGE' || (file?.category === 'INTERNAL_PACKING_RECAP' && /^Rekap Packing List kapal;/.test(file.note || ''));
export const isSharedDocument = file => file?.scope?.type === 'SHARED' || (file?.scope?.billIds?.length || 0) > 1;
export const billDocumentRows = (files = []) => files.filter(file => !isVoyageReference(file));
export function normalizeBillFiles(response, knownFiles = []) {
  const received = Array.isArray(response) ? response : Array.isArray(response?.data) ? response.data : Array.isArray(response?.files) ? response.files : null;
  if (received === null) return knownFiles;
  const known = new Map(knownFiles.map(file => [file.id, file]));
  return received.map(file => ({...known.get(file.id), ...Object.fromEntries(Object.entries(file).filter(([, value]) => value !== undefined))}));
}
export function packingMappedForBill(bill, file) {
  const packing = bill.registerData?.operational?.packing;
  return Boolean(packing?.groups?.some(group => group.sourceFileId === file.id) && (!isSharedDocument(file) || packing.scopeConfirmed === true));
}
export const canPrintJourneyPacking = file => file?.source === 'BILL' && (file.category === 'INTERNAL_PACKING_LIST' || (file.category === 'INTERNAL_PACKING_RECAP' && isVoyageReference(file)));
export function journeyPackingOutputEndpoint(file) {
  if (file?.category === 'INTERNAL_PACKING_RECAP' && !isVoyageReference(file)) throw new Error('Gunakan pratinjau atau unduh asli untuk rekap ini.');
  if (isVoyageReference(file)) {
    const match = file.endpoint?.match(/^\/bl-register\/([^/]+)\/files\/([^/]+)$/);
    if (!match) throw new Error('Rekap kapal tidak memiliki referensi sumber yang valid.');
    return `/operations/voyage-packing/${match[1]}/${match[2]}`;
  }
  return file.endpoint + '/packing-output';
}

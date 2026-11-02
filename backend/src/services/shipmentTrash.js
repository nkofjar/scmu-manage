const { fail, text, integer, STAFF } = require('./jpt');
const { isTrashed } = require('./registerLifecycle');
const register = () => require('./blRegister');
const sea = () => require('./seaBills');
const RESTORE_CONFLICT = 'Nomor B/L sudah digunakan pengiriman lain. Ubah nomor atau hapus pengiriman tersebut sebelum memulihkan.';

async function dependencies(tx, bill) {
  const job = await tx.jobOrder.findUnique({ where: { id: bill.jobId }, select: {
    status: true, _count: { select: { seaBills: true } },
    invoices: { select: { id: true, invoiceNumber: true, status: true } },
    charges: { select: { id: true, description: true, status: true } },
    payments: { select: { id: true, reference: true } },
    approvals: { where: { status: { in: ['SUBMITTED', 'APPROVED'] } }, select: { id: true, action: true, status: true } },
  } });
  fail(job, 'Pengiriman tidak memiliki job yang valid.', 409);
  const bons = Array.isArray(bill.registerData?.driverBons) ? bill.registerData.driverBons : [];
  const processedBons = bons.filter(bon => !['DRAFT', 'CANCELLED'].includes(bon.status) || bon.paymentStatus === 'PAID' || bon.paymentDate);
  const activeInvoices = job.invoices.filter(invoice => invoice.status !== 'CANCELLED');
  const activeCharges = job.charges.filter(charge => charge.status !== 'REJECTED');
  const blockers = [];
  if(bill.journeyId){const parent=await tx.shippingJourney.findUnique({where:{id:bill.journeyId}}),ops=parent&&require('./driverOperations').state(parent);if(ops?.works.some(w=>['SUBMITTED','VERIFIED'].includes(w.status)&&(w.billId===bill.id||(bill.containers||[]).some(c=>require('./driverTariffs').key(c.number)===w.containerKey))))blockers.push({code:'DRIVER_WORK',message:'B/L memuat kontainer untuk pekerjaan angkut yang diproses. Gunakan Arsipkan.'});}

  if (activeInvoices.length) blockers.push({ code: 'INVOICE', count: activeInvoices.length, message: 'Masih ada invoice aktif. Selesaikan pembatalan invoice atau gunakan Arsipkan.' });
  if (activeCharges.length) blockers.push({ code: 'CHARGE', count: activeCharges.length, message: 'Masih ada biaya atau pendapatan yang diajukan/disetujui. Selesaikan keterkaitannya atau gunakan Arsipkan.' });
  if (job.payments.length) blockers.push({ code: 'PAYMENT', count: job.payments.length, message: 'Pembayaran sudah tercatat. Gunakan Arsipkan agar riwayat pembayaran tetap terhubung.' });
  if (processedBons.length) blockers.push({ code: 'DRIVER_BON', count: processedBons.length, message: 'Bonrate sudah ditugaskan, diproses, selesai, atau dibayar. Periksa bonrate tersebut atau gunakan Arsipkan.' });
  if (job.approvals.length) blockers.push({ code: 'APPROVAL', count: job.approvals.length, message: 'Masih ada pengajuan direktur yang diajukan/disetujui. Periksa pengajuan tersebut sebelum menghapus.' });
  if (bill.registerData?.register?.billingStatus === 'PAID') blockers.push({ code: 'BOOK_PAID', count: 1, message: 'Catatan tagihan pengiriman berstatus sudah dibayar. Periksa catatan tersebut atau gunakan Arsipkan.' });
  if (['CLOSED', 'CANCELLED'].includes(job.status) || bill.releaseStatus === 'SEA_RELEASE_CONFIRMED') blockers.push({ code: 'PROCESSED', count: 1, message: 'Job sudah ditutup/dibatalkan atau release barang sudah dikonfirmasi. Gunakan Arsipkan.' });
  if (job._count.seaBills > 1) blockers.push({ code: 'SHARED_JOB', count: job._count.seaBills, message: 'Job ini digunakan beberapa B/L. Gunakan Arsipkan agar pengiriman lain tetap dapat diproses.' });
  return {
    summary: { documents: require('./shipmentDocuments').linkedFiles(bill).length, containers: (bill.containers || []).length, packingLists: bill.allocations?.length || 0, driverBons: bons.length, invoices: job.invoices.length, charges: job.charges.length, payments: job.payments.length, approvals: job.approvals.length },
    blockers, canDelete: !blockers.length,
  };
}

async function context(tx, user, id) {
  fail(STAFF.includes(user?.role), 'Hanya Admin dan Super Admin yang dapat menghapus pengiriman.', 403);
  const bill = await register().get(tx, id);
  const related = await dependencies(tx, bill);
  if (isTrashed(bill)) { related.canDelete = false; related.blockers.unshift({ code: 'TRASHED', count: 1, message: 'Pengiriman sudah berada di Sampah.' }); }
  const conflict = isTrashed(bill) && bill.billNumber ? await tx.seaBill.findFirst({ where: require('./registerLifecycle').currentNumberWhere(bill.billNumber, bill.id), select: { id: true, billNumber: true } }) : null;
  return { id, billNumber: bill.billNumber, version: bill.version, deleted: isTrashed(bill), canRestore: isTrashed(bill) && !conflict, restoreConflict: conflict ? { ...conflict, message: RESTORE_CONFLICT } : null, ...related };
}

async function remove(tx, user, id, body, options = {}) {
  fail(STAFF.includes(user?.role), 'Hanya Admin dan Super Admin yang dapat menghapus pengiriman.', 403);
  const bill = await register().get(tx, id);
  if (bill.journeyId && !options.fromJourney) {
    const parent = await tx.shippingJourney.findUnique({ where: { id: bill.journeyId } });
    require('./journeys').mutable(parent);
  }
  fail(!isTrashed(bill), 'Pengiriman sudah berada di Sampah.', 409);
  fail(integer(body.version, 'Versi') === bill.version, 'Data pengiriman berubah. Muat ulang sebelum menghapus.', 409);
  const reason = text(body.reason, 'Alasan penghapusan', 2000);
  fail(body.confirmed === true, 'Periksa data terkait dan konfirmasi pemindahan ke Sampah.');
  const related = await dependencies(tx, bill);
  fail(related.canDelete, related.blockers.map(blocker => blocker.message).join(' '), 409);
  const now = new Date().toISOString();
  const trash = { deletedAt: now, deletedById: user.id, deletedByName: user.name || user.id, reason,
    previousArchive: { archivedAt: bill.archivedAt ? new Date(bill.archivedAt).toISOString() : null, archivedById: bill.archivedById || null }, summary: related.summary };
  // Keep the printed B/L number and documents; release only its unique claim.
  // archivedAt also protects existing document and operational write paths.
  await tx.seaBill.update({ where: { id }, data: { registerIdentity: null, registerData: { ...bill.registerData, trash }, archivedAt: new Date(now), archivedById: user.id, version: { increment: 1 } } });
  await sea().history(tx, user, id, 'SHIPMENT_TRASHED', reason, { trash });
  return register().present(await register().get(tx, id));
}

async function restore(tx, user, id, body, options = {}) {
  fail(STAFF.includes(user?.role), 'Hanya Admin dan Super Admin yang dapat memulihkan pengiriman.', 403);
  const bill = await register().get(tx, id);
  if(bill.journeyId&&!options.fromJourney){const parent=await tx.shippingJourney.findUnique({where:{id:bill.journeyId}});require('./journeys').mutable(parent);}
  fail(isTrashed(bill), 'Pengiriman tidak berada di Sampah.', 409);
  fail(integer(body.version, 'Versi') === bill.version, 'Data pengiriman berubah. Muat ulang sebelum memulihkan.', 409);
  fail(body.confirmed === true, 'Konfirmasi pemulihan pengiriman.');
  const { trash, ...registerData } = bill.registerData;
  const previous = trash.previousArchive || {};
  const identity = await sea().registerIdentity(tx, bill.billNumber, undefined, RESTORE_CONFLICT);
  await tx.seaBill.update({ where: { id }, data: { registerIdentity: identity, registerData, archivedAt: previous.archivedAt ? new Date(previous.archivedAt) : null, archivedById: previous.archivedById || null, version: { increment: 1 } } });
  await sea().history(tx, user, id, 'SHIPMENT_RESTORED', 'Dipulihkan dari Sampah.', { previousDeletion: trash });
  return register().present(await register().get(tx, id));
}
module.exports = { context, remove, restore, dependencies };

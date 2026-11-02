const router = require('express').Router();
const prisma = require('../prisma');
const { authenticate, authorize } = require('../middleware/auth');
const { STAFF, OPERATORS, fail, route, transaction, mutableJob } = require('../services/jpt');
const sea = require('../services/seaBills');
const documents = require('../services/shipmentDocuments');
const { get: getRecord, linkedFiles, publicFile } = documents;
const files = require('../services/jobFiles');
const { uploadLimiter } = require('../middleware/rateLimiter');

router.use(authenticate, authorize(...STAFF));
router.get('/:id/files', route(async (req, res) => {
  const bill = await getRecord(prisma, req.params.id);
  res.json({ data: linkedFiles(bill).map(publicFile), version: bill.version, availability: documents.availability(bill) });
}));
router.post('/:id/files', authorize(...OPERATORS), uploadLimiter, route(async (req, res) => {
  const before = await getRecord(prisma, req.params.id);
  fail(!before.archivedAt && !before.registerData?.archivedAt, 'Archived register records are read-only', 409);
  await mutableJob(prisma, before.jobId);
  try {
    await new Promise((resolve, reject) => files.uploadAny(req, res, error => error ? reject(error) : resolve()));
    await files.validateAttachment(req.file);
    fail(['DRAFT','FINAL','RELEASE','PACKING_LIST','INTERNAL_PACKING_LIST','PACKING_HEADER','RECEIVING_REPORT','INVOICE','DELIVERY_ORDER','MANIFEST','WAYBILL','POD','TAX_INVOICE','PPH23_CERTIFICATE','DRIVER_BON','PAYMENT_PROOF','SUPPORTING'].includes(req.body.category), 'Register attachment category is invalid');
    const result = await transaction(async tx => {
      await sea.attach(tx, req.user, before.jobId, before.id, req.body, req.file);
      return getRecord(tx, before.id);
    });
    res.status(201).json({ data: linkedFiles(result).map(publicFile), version: result.version, availability: documents.availability(result) });
  } catch (error) {
    if (req.file) await files.removeFile(req.file.filename);
    throw error;
  }
}));
router.delete('/:id/files/:fileId', authorize(...OPERATORS), route(async (req, res) => {
  const result = await transaction(tx => documents.remove(tx, req.user, req.params.id, req.params.fileId, req.body));
  const cleanup = await require('../services/documentFilePurge').purge(result.filename);
  const bill = await getRecord(prisma, req.params.id);
  const { filename, ...effects } = result;
  res.json({ ...effects, ...cleanup, data: linkedFiles(bill).map(publicFile), version: bill.version, availability: documents.availability(bill) });
}));
router.post('/:id/files/delete', authorize(...OPERATORS), route(async (req, res) => {
  const result = await transaction(tx => documents.removeMany(tx, req.user, req.params.id, req.body));
  const cleanup = await Promise.all(result.results.map(row => require('../services/documentFilePurge').purge(row.filename)));
  const bill = await getRecord(prisma, req.params.id);
  res.json({ removedCount: result.removedCount, requiresPackingReview: result.results.some(row => row.requiresPackingReview), sharedFileRetained: cleanup.some(row => row.sharedFileRetained), cleanupPending: cleanup.some(row => row.cleanupPending), data: linkedFiles(bill).map(publicFile), version: bill.version, availability: documents.availability(bill) });
}));
router.post('/:id/files/download', route(async (req, res) => {
  const selected = documents.selectedFiles(await getRecord(prisma, req.params.id), req.body.fileIds);
  const fs = require('node:fs/promises');
  // Check every private file before starting the response, so missing files produce a useful error.
  await Promise.all(selected.map(file => fs.access(files.filePath(file.filename))));
  const archive = require('archiver')('zip', { zlib: { level: 6 } });
  archive.on('warning', error => res.destroy(error)); archive.on('error', error => res.destroy(error));
  res.on('close', () => archive.abort()); res.type('application/zip').attachment('dokumen-pengiriman.zip'); archive.pipe(res);
  selected.forEach((file, index) => archive.file(files.filePath(file.filename), { name: `${index + 1}-${(file.originalName || 'dokumen').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}` }));
  await archive.finalize();
}));
router.get('/:id/files/:fileId/packing-output', route(async (req, res) => res.json(await documents.packingSnapshot(prisma, req.params.id, req.params.fileId))));
router.get('/:id/files/:fileId', route(async (req, res) => {
  const bill = await getRecord(prisma, req.params.id);
  const file = linkedFiles(bill).find(row => row.id === req.params.fileId);
  fail(file, 'Document file not found', 404);
  await new Promise((resolve, reject) => {
    res.download(files.filePath(file.filename), file.originalName, error => error ? reject(error) : resolve());
  });
}));
module.exports = router;

const express = require('express');
const prisma = require('../prisma');
const { authenticate, authorize } = require('../middleware/auth');
const { route, transaction } = require('../services/jpt');
const masters = require('../services/transportMasters');
module.exports = function masterRouter(kind) {
  const router = express.Router();
  router.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN'));
  router.get('/', route(async (req, res) => res.json(await masters.list(prisma, kind, req.query))));
  router.get('/:id', route(async (req, res) => res.json(masters.present(kind, await masters.get(prisma, kind, req.params.id, true)))));
  router.post('/', route(async (req, res) => res.status(201).json(masters.present(kind, await transaction(tx => masters.create(tx, kind, req.body))))));
  router.put('/:id', route(async (req, res) => res.json(await transaction(tx => masters.update(tx, kind, req.params.id, req.body)))));
  router.delete('/:id', route(async (req, res) => res.json(await transaction(tx => masters.update(tx, kind, req.params.id, req.body, true)))));
  const documents = require('../services/masterDocuments'), files = require('../services/jobFiles');
  const { upload } = require('../services/masterDocumentFiles');
  const { uploadLimiter } = require('../middleware/rateLimiter');
  router.get('/:id/documents', route(async (req, res) => res.json(await documents.list(prisma, kind, req.params.id))));
  router.post('/:id/documents', uploadLimiter, route(async (req, res) => {
    const row = await masters.get(prisma, kind, req.params.id);
    if (!row.isActive) throw Object.assign(new Error('Inactive master records are read-only for uploads'), { status: 409 });
    try {
      await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
      await files.validateFile(req.file);
      const result = await transaction(tx => documents.attach(tx, kind, req.params.id, req.body, req.file));
      res.status(201).json(result);
    } catch (error) {
      if (req.file) await files.removeFile(req.file.filename);
      if (error.code?.startsWith('LIMIT_')) error.status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 422;
      throw error;
    }
  }));
  router.get('/:id/documents/:fileId/download', route(async (req, res) => {
    const document = await documents.download(prisma, kind, req.params.id, req.params.fileId);
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    await new Promise((resolve, reject) => res.download(files.filePath(document.filename), document.originalName, error => error ? reject(error) : resolve()));
  }));
  return router;
};

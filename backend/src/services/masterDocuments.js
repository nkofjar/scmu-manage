const { fail } = require('./jpt');
const masters = require('./transportMasters');
function publicDocument(row) {
  const { id, category, originalName, mimeType, size, createdAt } = row;
  return { id, category, originalName, mimeType, size, createdAt };
}
async function list(tx, kind, recordId) {
  const row = await masters.get(tx, kind, recordId);
  const documents = await tx.masterDocument.findMany({ where: { [`${kind}Id`]: row.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  return { data: documents.map(publicDocument), version: row.version };
}
async function attach(tx, kind, recordId, body, file) {
  const row = await masters.get(tx, kind, recordId);
  fail(row.isActive, 'Inactive master records are read-only for uploads', 409);
  fail((kind === 'vehicle' ? ['STNK', 'KIR'] : ['SIM']).includes(body.category), 'Document category is invalid');
  await masters.advance(tx, kind, row, body.version);
  const document = await tx.masterDocument.create({ data: { [`${kind}Id`]: row.id, category: body.category,
    filename: file.filename, originalName: file.originalname, mimeType: file.mimetype, size: file.size } });
  return { ...publicDocument(document), version: row.version + 1 };
}
async function download(tx, kind, recordId, documentId) {
  const row = await masters.get(tx, kind, recordId);
  const document = await tx.masterDocument.findFirst({ where: { id: masters.id(documentId, 'Document ID'), [`${kind}Id`]: row.id } });
  fail(document, 'Document not found on this master record', 404); return document;
}
module.exports = { list, attach, download };

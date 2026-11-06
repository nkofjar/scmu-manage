const multer = require('multer');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const files = require('./jobFiles');
const types = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({ destination: path.dirname(files.filePath('probe')), filename: (req, file, done) => done(null, randomUUID() + types[file.mimetype]) }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2, parts: 4, fieldSize: 128, fieldNameSize: 40 },
  fileFilter: (req, file, done) => types[file.mimetype] ? done(null, true) : done(Object.assign(new Error('Only PDF, JPEG, PNG and WebP files are allowed'), { status: 415 })),
}).single('file');
module.exports = { upload };

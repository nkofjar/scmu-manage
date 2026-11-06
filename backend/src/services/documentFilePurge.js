const fs = require('node:fs/promises');
const prisma = require('../prisma');
const { transaction } = require('./jpt');
const { filePath } = require('./jobFiles');

async function purge(filename) {
  try {
    return await transaction(async tx => {
      const task = await tx.documentFilePurge.findUnique({ where: { filename } });
      const references = await tx.seaBillFile.count({ where: { filename } }) + await tx.jobDocument.count({ where: { filename } }) + (tx.bLImportSession ? await tx.bLImportSession.count({where:{filename}}) : 0) + (tx.journeyFile ? await tx.journeyFile.count({where:{filename}}) : 0) + (tx.masterDocument ? await tx.masterDocument.count({where:{filename}}) : 0);
      if (!task) return { cleanupPending: false, sharedFileRetained: references > 0 };
      if (!references) {
        try { await fs.unlink(filePath(filename)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      await tx.documentFilePurge.delete({ where: { filename } });
      return { cleanupPending: false, sharedFileRetained: references > 0 };
    });
  } catch (error) {
    await prisma.documentFilePurge.updateMany({ where: { filename }, data: { attempts: { increment: 1 }, lastError: String(error.code || 'CLEANUP_FAILED').slice(0, 100) } }).catch(() => {});
    return { cleanupPending: true };
  }
}
function startWorker() {
  let running = false;
  const drain = async () => {
    if (running) return; running = true;
    try {
      await transaction(async tx=>{const expired=await tx.bLImportSession.findMany({where:{expiresAt:{lt:new Date()}},take:25});for(const session of expired){await tx.bLImportSession.delete({where:{id:session.id}});await tx.documentFilePurge.upsert({where:{filename:session.filename},create:{filename:session.filename},update:{}});}});
      const rows = await prisma.documentFilePurge.findMany({ orderBy: { requestedAt: 'asc' }, take: 25 }); for (const row of rows) await purge(row.filename);
    }
    catch (error) { console.error('Document cleanup unavailable:', error.code || 'DATABASE_ERROR'); }
    finally { running = false; }
  };
  void drain(); const timer = setInterval(drain, 60000); timer.unref(); return timer;
}
module.exports = { purge, startWorker };

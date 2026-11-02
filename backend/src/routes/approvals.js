const express = require('express'); const prisma = require('../prisma');
const { listPage } = require('../services/pagination');
const { authenticate, authorize } = require('../middleware/auth');
const { route, text, choice, fail, transaction, audit, STAFF } = require('../services/jpt');
const { submit, review } = require('../services/director');
const router = express.Router(); router.use(authenticate, authorize(...STAFF));
async function present(approval, knownUsers) {
  const users = knownUsers || await prisma.user.findMany({ where: { id: { in: [approval.requestedById, approval.reviewedById].filter(Boolean) } }, select: { id: true, name: true } });
  return { ...approval, ...require('../services/approvalPresentation').reference(approval), snapshot: approval.snapshot.view, requestedBy: users.find(user => user.id === approval.requestedById), reviewedBy: users.find(user => user.id === approval.reviewedById) };
}
router.get('/', route(async (req, res) => {
  const where=await require('../services/approvalPresentation').queryWhere(prisma,req.query);
  const result = await listPage(prisma.directorApproval, { where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }, req.query); const rows = result.data;
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap(row => [row.requestedById, row.reviewedById].filter(Boolean)))] } }, select: { id: true, name: true } });
  const kinds=await prisma.directorApproval.findMany({distinct:['action'],select:{action:true}});
  res.json({ ...result, actions:kinds.map(r=>r.action).sort(), data: await Promise.all(rows.map(row => present(row, users))) });
}));
router.post('/', route(async (req, res) => { const row = await transaction(tx => submit(tx, req.user, text(req.body.action, 'Approval action', 100), req.body.entityId, req.body.payload || {}, req.body.note)); res.status(201).json(await present(row)); }));
router.post('/:id/review', authorize('SUPER_ADMIN'), route(async (req, res) => { const decision = choice(req.body.decision, ['APPROVED','RETURNED','REJECTED'], 'Decision'); const row = await transaction(tx => review(tx, req.user, req.params.id, decision, req.body.note)); res.json(await present(row)); }));
router.post('/:id/withdraw', route(async (req, res) => {
  const row = await transaction(async tx => {
    const current = await tx.directorApproval.findUnique({ where: { id: req.params.id } }); fail(current, 'Approval not found', 404);
    fail(req.user.id === current.requestedById || req.user.role === 'SUPER_ADMIN', 'Only the requester or director can withdraw this request', 403);
    fail(current.status === 'SUBMITTED' || (current.status === 'APPROVED' && current.action === 'PAYMENT_AUTHORIZE' && !current.executedAt), 'This approval can no longer be withdrawn', 409);
    const note = text(req.body.note, 'Withdrawal note', 2000); const updated = await tx.directorApproval.update({ where: { id: current.id }, data: { status: 'WITHDRAWN', withdrawnById: req.user.id, withdrawnAt: new Date() } });
    await audit(tx, req.user, 'DIRECTOR_APPROVAL_WITHDRAWN', current.jobId ? 'JobOrder' : 'DirectorApproval', current.jobId || current.id, { approvalId: current.id, note }); return updated;
  }); res.json(await present(row));
}));
module.exports = router;

const router = require('express').Router();
const prisma = require('../prisma');
const {authenticate,authorize} = require('../middleware/auth');
const {STAFF,route,transaction,text} = require('../services/jpt');
const register = require('../services/blRegister');
router.use(authenticate,authorize(...STAFF));
router.get('/export.xlsx',require('../services/registerExport').exportHandler);
router.use(require('./registerDocuments'));
router.use(require('./packingImport'));
router.use(require('./partnerPackingSummary'));
router.use(require('./internalPacking'));
router.use(require('./driverDispatch'));
router.get('/',route(async(req,res)=>res.json(await transaction(tx=>register.list(tx,req.query)))));
router.get('/:id/activity',route(async(req,res)=>{
 const bill=await register.get(prisma,req.params.id);
 const page=await require('../services/pagination').listPage(prisma.activityLog,{where:{entity:'JobOrder',entityId:bill.jobId,metadata:{path:['seaBillId'],equals:bill.id}},include:{user:{select:{name:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}]},req.query);
 // Audit snapshots may contain a voyage's other bills. Keep immutable originals
 // in the audit store; this bill endpoint exposes only safe scalar references.
 const keys=['seaBillId','version','fileId','chargeId','bonId','originalName','category','reason','registerNumber','resetReview','resetRelease'];
 res.json({...page,data:page.data.map(row=>({...row,metadata:Object.fromEntries(keys.filter(key=>row.metadata?.[key]!==undefined&&['string','number','boolean'].includes(typeof row.metadata[key])).map(key=>[key,row.metadata[key]]))}))});
}));
router.get('/:id/workspace',route(async(req,res)=>res.json(await transaction(tx=>require('../services/blWorkspace').get(tx,req.params.id)))));
router.put('/:id/workspace',route(async(req,res)=>res.json(await transaction(tx=>require('../services/blWorkspace').update(tx,req.user,req.params.id,req.body)))));
router.post('/:id/operational-costs',route(async(req,res)=>res.status(201).json(await transaction(tx=>require('../services/blWorkspace').createCost(tx,req.user,req.params.id,req.body)))));
router.get('/:id/driver-operations',route(async(req,res)=>res.json(await transaction(tx=>require('../services/billDriverOperations').list(tx,req.params.id)))));
router.post('/:id/driver-operations/works',route(async(req,res)=>res.status(201).json(await transaction(tx=>require('../services/billDriverOperations').saveWork(tx,req.user,req.params.id,null,req.body)))));
router.put('/:id/driver-operations/works/:workId',route(async(req,res)=>res.json(await transaction(tx=>require('../services/billDriverOperations').saveWork(tx,req.user,req.params.id,req.params.workId,req.body)))));
router.post('/:id/driver-operations/works/:workId/status',route(async(req,res)=>res.json(await transaction(tx=>require('../services/billDriverOperations').transition(tx,req.user,req.params.id,req.params.workId,req.body)))));
router.post('/:id/driver-operations/evidence',require('../middleware/rateLimiter').uploadLimiter,route(async(req,res)=>{const files=require('../services/jobFiles');let saved=false;try{await new Promise((resolve,reject)=>files.uploadAny(req,res,error=>error?reject(error):resolve()));const result=await transaction(tx=>require('../services/billDriverOperations').attachEvidence(tx,req.user,req.params.id,req.body,req.file));saved=true;res.status(201).json(result);}finally{if(!saved&&req.file)await files.removeFile(req.file.filename);}}));
router.get('/:id/driver-bons',route(async(req,res)=>res.json(await require('../services/driverBons').list(prisma,req.params.id))));
router.post('/:id/driver-bons/estimate',route(async(req,res)=>res.json(await transaction(async tx=>{const bill=await register.get(tx,req.params.id);await require('../services/seaBills').getBill(tx,bill.jobId,bill.id,req.body.version);return require('../services/driverTariffs').estimate(tx,req.body.bon,bill);}))));
router.post('/:id/driver-bons',route(async(req,res)=>res.status(201).json(await transaction(tx=>require('../services/driverBons').save(tx,req.user,req.params.id,null,req.body)))));
router.put('/:id/driver-bons/:bonId',route(async(req,res)=>res.json(await transaction(tx=>require('../services/driverBons').save(tx,req.user,req.params.id,req.params.bonId,req.body)))));
router.post('/:id/driver-bons/:bonId/cost',route(async(req,res)=>res.status(201).json(await transaction(tx=>require('../services/driverBons').proposeCost(tx,req.user,req.params.id,req.params.bonId,req.body)))));
router.get('/:id',route(async(req,res)=>res.json(register.present(await register.get(prisma,req.params.id)))));
router.post('/',route(async(req,res)=>{
 text(req.body.billNumber,'BL number',100,true);register.normalize(req.body);
 res.status(201).json(await transaction(tx=>require('../services/blImports').save(tx,req.user,null,req.body)));
}));
router.put('/:id',route(async(req,res)=>res.json(await transaction(tx=>require('../services/blImports').save(tx,req.user,req.params.id,req.body)))));
router.post('/:id/archive',route(async(req,res)=>res.json(await transaction(tx=>register.archive(tx,req.user,req.params.id,req.body)))));
router.get('/:id/deletion-context',route(async(req,res)=>res.json(await transaction(tx=>require('../services/shipmentTrash').context(tx,req.user,req.params.id)))));
router.delete('/:id',route(async(req,res)=>res.json(await transaction(tx=>require('../services/shipmentTrash').remove(tx,req.user,req.params.id,req.body)))));
router.post('/:id/restore',route(async(req,res)=>res.json(await transaction(tx=>require('../services/shipmentTrash').restore(tx,req.user,req.params.id,req.body)))));
router.post('/:id/estimate',route(async(req,res)=>res.json(await transaction(tx=>register.estimate(tx,req.params.id,req.body)))));
router.post('/:id/charges',route(async(req,res)=>res.status(201).json(await transaction(tx=>register.charges(tx,req.user,req.params.id,req.body)))));
module.exports=router;

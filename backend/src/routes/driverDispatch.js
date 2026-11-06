const router=require('express').Router();
const {authenticate,authorize}=require('../middleware/auth');
const {STAFF,route,transaction}=require('../services/jpt');
const service=require('../services/driverDispatch');
router.use(authenticate,authorize(...STAFF));
router.post('/:id/driver-operations/works/:workId/dispatch',route(async(req,res)=>res.status(201).json(await transaction(tx=>service.issueBill(tx,req.user,req.params.id,req.params.workId,req.body)))));
router.get('/:id/driver-operations/works/:workId/dispatches',route(async(req,res)=>res.json(await transaction(tx=>service.listBill(tx,req.params.id,req.params.workId)))));
router.get('/:id/driver-operations/works/:workId/dispatches/:dispatchId/pdf',route(async(req,res)=>{
 const snapshot=await transaction(tx=>service.getBill(tx,req.params.id,req.params.workId,req.params.dispatchId));
 res.type('application/pdf').attachment(snapshot.number+'.pdf').set('Cache-Control','private, no-store').send(service.pdf(snapshot));
}));
module.exports=router;

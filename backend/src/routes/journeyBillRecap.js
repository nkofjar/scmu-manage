const router=require('express').Router();
const {authenticate,authorize}=require('../middleware/auth');
const {STAFF,route,transaction}=require('../services/jpt');
const service=require('../services/journeyBillRecap');
router.use(authenticate,authorize(...STAFF));
router.get('/:id/bill-recap',route(async(req,res)=>res.json(await transaction(tx=>service.get(tx,req.params.id)))));
for(const [extension,type,render] of [['pdf','application/pdf','pdf'],['xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','workbook']]){
 router.get('/:id/bill-recap.'+extension,route(async(req,res)=>{
  const recap=await transaction(tx=>service.get(tx,req.params.id)),bytes=await service[render](recap);
  res.type(type).attachment('rekapan-bl.'+extension).send(bytes);
 }));
}
module.exports=router;

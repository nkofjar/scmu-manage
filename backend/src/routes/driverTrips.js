const router=require('express').Router();
const {authenticate,authorize}=require('../middleware/auth');
const {STAFF,route,transaction}=require('../services/jpt');
router.use(authenticate,authorize(...STAFF));
router.get('/',route(async(req,res)=>res.json(await transaction(tx=>require('../services/driverTrips').list(tx,req.query)))));
module.exports=router;

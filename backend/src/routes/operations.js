const router = require('express').Router();
const { Prisma } = require('@prisma/client');
const prisma = require('../prisma');
const { authorize } = require('../middleware/auth');
const { STAFF, route, choice } = require('../services/jpt');
const { pageOptions, pageMeta } = require('../services/pagination');

router.use(authorize(...STAFF));
router.use(require('./registerPackingHeader'));
router.use(require('./packingRecap'));
router.use(require('./voyagePacking'));

router.get('/packing-lists', route(async (req,res) => {
  const { page, limit } = pageOptions(req.query);
  const category = req.query.category ? choice(req.query.category,['PACKING_LIST','INTERNAL_PACKING_LIST','PACKING_HEADER','INTERNAL_PACKING_RECAP'],'Packing category') : undefined;
  const search = String(req.query.search || '').trim();
  const where = {
    archivedAt:null,
    ...(category && {files:{some:{category}}}),
    ...(search && { OR:[{billNumber:{contains:search,mode:'insensitive'}},{vesselName:{contains:search,mode:'insensitive'}},{voyageNumber:{contains:search,mode:'insensitive'}},{carrierName:{contains:search,mode:'insensitive'}}] }),
  };
  const total = await prisma.seaBill.count({where}); const meta=pageMeta(total,{page,limit});
  const rows = await prisma.seaBill.findMany({where,select:{id:true,version:true,billNumber:true,vesselName:true,voyageNumber:true,vesselId:true,voyageId:true,contentVersion:true,containers:true,shipperName:true,consigneeName:true,portOfLoading:true,portOfDischarge:true,carrierName:true,registerData:true,files:{where:{category:{in:['PACKING_LIST','INTERNAL_PACKING_LIST','PACKING_HEADER','INTERNAL_PACKING_RECAP','RECEIVING_REPORT']}},select:{id:true,category:true,filename:true,originalName:true,externalNumber:true,documentDate:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'desc'}]}},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(meta.page-1)*meta.limit,take:meta.limit});
  const data=rows.map(row=>{const book=row.registerData?.register||{};const has=value=>row.files.some(file=>file.category===value);const policy=book.documentPolicy||'BL_ONLY';const partnerReady=has('PACKING_LIST');const internalReady=require('../services/internalPacking').ready(row);const headerReady=has('PACKING_HEADER')&&row.registerData?.operational?.packing?.headerStatus!=='DRAFT';const action=policy==='BL_AND_PACKING'&&!partnerReady?'UPLOAD_PARTNER':policy==='BL_ONLY'&&!internalReady?'CREATE_INTERNAL':book.includeInPackingHeader!==false&&!headerReady?'CREATE_HEADER':'COMPLETE';return {id:row.id,version:row.version,billId:row.id,billNumber:row.billNumber,vesselName:row.vesselName,voyageNumber:row.voyageNumber,carrierName:row.carrierName,partnerName:book.partyName||null,policy,includeInPackingHeader:book.includeInPackingHeader!==false,partnerReady,internalReady,headerReady,action,files:row.files};});
  for(let i=0;i<data.length;i++){data[i].recapReady=require('../services/packingRecap').ready(rows[i]);data[i].action=data[i].internalReady?'COMPLETE':'CREATE_INTERNAL';data[i].fieldInspection=require('../services/packingFieldChecks').status(rows[i]);data[i].files=data[i].files.map(({filename,...file})=>file);}
  res.json({...meta,data});
}));

router.get('/billing', route(async(req,res)=>res.json(await require('../services/jpt').transaction(tx=>require('../services/billingOverview').list(tx,req.query)))));

module.exports=router;

const { fail, text, decimal, integer, date, choice, money, number, mutableJob, vendor, quotationTotals, jobInclude, financials, checkJobClosure, closeJob, syncJob, audit } = require('./jpt');
const { packingInclude, requireDraft, packingJob, touchHeader, validateSources, requireSummaryReview } = require('./packing');
const { headerInclude, requireHeaderDraft, presentHeader } = require('./packingHeader');
const { costFields, transportChange } = require('./transport');
const { prepareLeg, createLeg } = require('./jobTransport');
const { preparePayment } = require('./payments');
const { internalCompany } = require('./access');
const json = value => JSON.parse(JSON.stringify(value));
const fields = entries => entries.filter(([, value]) => value !== undefined && value !== null).map(([label, value]) => ({ label, value: String(value) }));
const table = (title, columns, rows) => ({ title, columns: columns.map(([key, label]) => ({ key, label })), rows: json(rows) });
const basics = job => fields([['Job order', job.jobNumber], ['Job type', job.jobType], ['Route', `${job.originCity} → ${job.destCity}`], ['Currency', job.currency]]);

async function loadAction(tx, action, entityId, body = {}) {
  if (action === 'DRIVER_QUOTA_CHANGE') return require('./driverOperations').quotaContext(tx, entityId, body);
  let raw; let payload = {}; let jobId = null; let overview = []; let tables = []; let targetUrl = ''; let scopeSuffix = '';
  if (['PACKING_FINALIZE', 'PACKING_EXCEPTION'].includes(action)) {
    raw = await tx.packingList.findUnique({ where: { id: entityId }, include: packingInclude }); requireDraft(raw, body.version);
    await packingJob(tx, raw.jobId, raw.direction); jobId = raw.jobId;
    if (action === 'PACKING_EXCEPTION') { fail(raw.direction === 'INBOUND' && raw.receiptStatus === 'DISCREPANCY' && raw.discrepancyNotes && raw.document.filename, 'Record the original document and receipt discrepancy first', 409); requireSummaryReview(raw); }
    else {
      fail(raw.direction === 'OUTBOUND', 'Use routine receipt verification for incoming documents');
      fail(raw.items.length && raw.grossWeightKg.gt(0) && raw.recipientAddress, 'Complete item rows, gross weight and recipient address before finalizing', 409);
      await validateSources(tx, raw.jobId, raw.sources.map(link => link.sourceId));
    }
    payload = { version: raw.version }; overview = fields([['Internal reference', raw.recordNumber], ['Original packing list number', raw.externalNumber], ['Sender', raw.senderName], ['Recipient', raw.recipientName], ['Route', `${raw.originCity} → ${raw.destCity}`], ['Packages', raw.packages], ['Gross weight (kg)', raw.grossWeightKg], ['Volume (CBM)', raw.volumeCbm], ['Receipt status', raw.receiptStatus], ['Actual packages', raw.actualPackages], ['Discrepancy notes', raw.discrepancyNotes]]);
    if (raw.items.length) tables.push(table('Packing list', [['description','Cargo description'],['quantity','Quantity'],['packages','Packages'],['grossWeightKg','Gross weight (kg)']], raw.items));
  } else if (action === 'PACKING_HEADER_FINALIZE') {
    raw = await tx.packingHeader.findUnique({ where: { id: entityId }, include: headerInclude }); requireHeaderDraft(raw, body.version);
    const job = await mutableJob(tx, raw.jobId); fail(job.jobType === 'RECEIVER', 'Packing headers are only for receiving jobs', 409); jobId = raw.jobId;
    fail(raw.packingLists.length && raw.packingLists.every(row => row.status === 'FINAL' && row.document.filename && row.receiptStatus !== 'PENDING'), 'Complete and finalize receipt for every selected packing list', 409);
    fail(await tx.packingList.count({ where: { jobId, direction: 'INBOUND' } }) === raw.packingLists.length, 'Include every original packing list in this receiving job before finalizing', 409);
    payload = { version: raw.version }; const summary = presentHeader(raw).summary;
    overview = [...basics(job), ...fields([['Internal reference', raw.headerNumber], ['Original documents', summary.documentCount], ['Packages', summary.packages], ['Gross weight (kg)', summary.grossWeightKg ?? 'Not stated'], ['Volume (CBM)', summary.volumeCbm ?? 'Not stated'], ['Documents missing gross weight', summary.missingDocuments.grossWeightKg], ['Documents missing volume', summary.missingDocuments.volumeCbm], ['Receipt discrepancy', summary.discrepancyDocuments], ['Notes', raw.notes]])];
    tables.push(table('Original documents', [['externalNumber','Original packing list number'],['senderName','Sender'],['packages','Declared packages'],['grossWeightKg','Gross weight (kg)'],['volumeCbm','Volume (CBM)'],['actualPackages','Actual packages'],['receiptStatus','Receipt status'],['discrepancyNotes','Discrepancy notes']], raw.packingLists));
  } else if (action === 'SEA_BILL_EXCEPTION') {
    const sea = require('./seaBills');
    const entity = await tx.seaBill.findUnique({ where: { id: entityId }, select: { jobId: true } }); fail(entity, 'Sea transport document not found', 404);
    raw = await sea.verification(tx, entity.jobId, entityId, body); fail(raw.issues.length, 'Routine BL checks can be completed by Admin without director approval', 409);
    jobId = entity.jobId; payload = { version: raw.bill.version, checks: raw.checks, note: text(body.note, 'BL exception explanation', 2000) };
    overview = fields([['BL number',raw.bill.billNumber],['Original filename',raw.bill.files.find(file=>file.category==='FINAL'&&file.contentVersion===raw.bill.contentVersion)?.originalName],['Carrier / issuing agent',raw.bill.carrierName],['Vessel name',raw.bill.vesselName],['Voyage number',raw.bill.voyageNumber],['Port of loading',raw.bill.portOfLoading],['Port of discharge',raw.bill.portOfDischarge],['Shipper on document',raw.bill.shipperName],['Consignee on document',raw.bill.consigneeName],['Review issues',raw.bill.reviewIssues],['Exception explanation',payload.note]]);
    tables.push(table('BL review findings', [['finding','Finding']], raw.issues.map(finding=>({finding}))));
    tables.push(table('BL cargo links', [['reference','Packing list'],['packages','Packages'],['grossWeightKg','Gross weight (kg)'],['volumeCbm','Volume (CBM)'],['scope','Cargo scope / marks']], raw.bill.allocations.map(row=>({...row,reference:row.packingList.externalNumber || row.packingList.recordNumber}))));
    if(raw.bill.approvedSnapshot) {
      const labels={billNumber:'BL number',documentKind:'Sea document type',issueDate:'Issue date',carrierName:'Carrier / issuing agent',vesselName:'Vessel name',voyageNumber:'Voyage number',portOfLoading:'Port of loading',portOfDischarge:'Port of discharge',shipperName:'Shipper on document',consigneeName:'Consignee on document',packages:'Packages',grossWeightKg:'Gross weight (kg)',volumeCbm:'Volume (CBM)'};
      tables.push(table('BL material changes', [['field','Field'],['previous','Previously verified value'],['proposed','Submitted value']], Object.entries(labels).map(([key,label])=>({field:label,previous:raw.bill.approvedSnapshot[key]??'—',proposed:key==='issueDate'?raw.bill.issueDate?.toISOString():String(raw.bill[key]??'—')}))));
      tables.push(table('Previously verified cargo', [['reference','Packing list'],['packages','Packages'],['grossWeightKg','Gross weight (kg)'],['volumeCbm','Volume (CBM)'],['scope','Cargo scope / marks']], (raw.bill.approvedSnapshot.allocations||[]).map(row=>({...row,reference:row.declaredSnapshot?.externalNumber||'—'}))));
    }
    tables.push(table('BL attachments', [['category','Attachment category'],['originalName','Original filename'],['contentVersion','File version']], raw.bill.files));
    targetUrl = `/jobs/${jobId}?tab=sea`;
  } else if (action === 'SALES_QUOTATION_APPROVE') {
    raw = await tx.salesQuotation.findUnique({ where: { id: entityId }, include: { items: { orderBy: { id: 'asc' } }, customer: true } });
    fail(raw, 'Customer quotation not found', 404); fail(raw.status === 'DRAFT', 'Only draft quotations can be submitted', 409); fail(raw.validUntil > new Date(), 'This quotation has expired', 409);
    const totals = quotationTotals(raw); fail(raw.items.length && money(totals.revenue).gt(0), 'Add a positive sales price before sending this quotation');
    overview = fields([['Quotation #', raw.quotationNumber], ['Title', raw.title], ['Route', `${raw.originCity} → ${raw.destCity}`], ['Currency', raw.currency], ['Sales total', totals.revenue], ['Estimated total cost', totals.estimatedCost], ['Estimated gross profit', totals.estimatedProfit], ['Terms', raw.terms], ['Valid Until', raw.validUntil.toISOString()]]);
    tables.push(table('Commercial quotations', [['description','Description'],['quantity','Quantity'],['sellRate','Sell rate'],['buyRate','Estimated buy rate']], raw.items)); targetUrl = `/sales-quotations/${raw.id}`;
  } else if (action === 'DOCUMENT_VERIFY') {
    raw = await tx.jobDocument.findUnique({ where: { id: entityId }, include: { packingList: true } }); fail(raw && !raw.packingList && raw.type === 'PACKING_LIST' && raw.status === 'UPLOADED' && raw.filename, 'Upload the packing document before submitting', 409);
    const job = await mutableJob(tx, raw.jobId); jobId = job.id; overview = [...basics(job), ...fields([['Document title', raw.title], ['Original filename', raw.originalName]])];
  } else if (action === 'CHARGE_APPROVE') {
    raw = await tx.jobCharge.findUnique({ where: { id: entityId }, include: { vendor: true } }); fail(raw, 'Charge not found', 404); const job = await mutableJob(tx, raw.jobId); jobId = job.id;
    fail(raw.status === 'PROPOSED', 'This charge was already reviewed', 409);
    if (raw.kind === 'COST') { await costFields(tx, jobId, raw); if (raw.costSource === 'VENDOR') { fail(raw.vendorId, 'Assign a vendor before approving a cost'); await vendor(tx, raw.vendorId); } }
    payload = { actualAmount: decimal(body.actualAmount ?? raw.estimatedAmount.toString()).toFixed(2) };
    if(raw.tariffSnapshot) {
      fail(money(payload.actualAmount).eq(raw.tariffSnapshot.line.amount), 'Tariff snapshot amount cannot be overridden; propose an explicit adjustment separately',409);
      if(raw.tariffSnapshot.journeyId){const journey=await tx.shippingJourney.findUnique({where:{id:raw.tariffSnapshot.journeyId}});fail(journey&&!journey.deletedAt&&!journey.archivedAt,'Pengiriman induk tidak aktif.',409);raw={...raw,journeyContext:{id:journey.id,number:journey.number,vesselName:journey.vesselName,voyageNumber:journey.voyageNumber,period:journey.period}};targetUrl=`/shipments/${journey.id}`;}
      if(raw.tariffSnapshot.billId) {
        const bill=await tx.seaBill.findUnique({where:{id:raw.tariffSnapshot.billId},select:{id:true,billNumber:true,carrierName:true,containers:true,registerData:true}});
        fail(bill,'Linked BL no longer exists',409);
        // Carrier and container/register eligibility belong to the approval
        // context. Do not fingerprint the bill version (proposal batches bump it)
        // or re-read mutable tariff prices: the charge's price snapshot is final.
        raw={...raw,blRegisterContext:{id:bill.id,billNumber:bill.billNumber,carrierName:bill.carrierName,containers:bill.containers,registerData:bill.registerData}};
        targetUrl = `/bl-register/${bill.id}`;
      }
    }
    overview = [...basics(job), ...fields([['Pengiriman',raw.journeyContext?.number],['Kapal',raw.journeyContext?.vesselName],['Voyage',raw.journeyContext?.voyageNumber],['Periode',raw.journeyContext?.period],['Charge type', raw.kind], ['Description', raw.description], ['Cost source', raw.costSource], ['Cost category', raw.costCategory], ['Vendor', raw.vendor?.name], ['Estimated amount', raw.estimatedAmount], ['Proposed actual amount', payload.actualAmount], ['Notes', raw.notes]])];
    if(raw.tariffSnapshot?.driverPayrollSnapshot){const s=raw.tariffSnapshot.driverPayrollSnapshot;overview.push(...fields([['Nama sopir',s.driverName],['Periode upah',s.periodFrom+' — '+s.periodTo]]));tables.push(table('Pekerjaan dan snapshot upah',[['number','Nomor bon'],['containerNumber','Kontainer'],['rateType','RB/RK'],['proofReference','Nomor bukti serah terima'],['quantity','Jumlah rit'],['unitPrice','Tarif per rit'],['amount','Jumlah']],s.lines));targetUrl=`/shipments/${s.journeyId}?tab=driver-bons`;}
    if(raw.tariffSnapshot?.driverRateSnapshot){const s=raw.tariffSnapshot.driverRateSnapshot;overview.push(...fields([['Skema tarif',s.planLabel],['Realisasi RB',s.rbCount],['Realisasi RK',s.rkCount],['Tanggal tarif',s.input.date],['Rute bon',s.input.origin+' → '+s.input.destination]]));tables.push(table('Snapshot tarif sopir',[['code','Kode tarif'],['rateType','RB/RK'],['quantity','Jumlah'],['unit','Satuan'],['unitPrice','Harga satuan'],['amount','Total']],s.lines));}
  } else if (action === 'VENDOR_AWARD') {
    const quote = await tx.quote.findUnique({ where: { id: entityId }, include: { transporter: true } }); fail(quote, 'Quote not found', 404);
    const rfq = await tx.rFQ.findUnique({ where: { id: quote.rfqId }, include: { quotes: { include: { transporter: { select: { name: true } } }, orderBy: { id: 'asc' } } } });
    fail(['OPEN','QUOTED'].includes(rfq.status) && quote.status === 'PENDING', 'RFQ cannot be awarded at this stage', 409); await vendor(tx, quote.transporterId);
    fail((!quote.validUntil || quote.validUntil > new Date()) && (!rfq.expiresAt || rfq.expiresAt > new Date()), 'This vendor quote has expired', 409);
    raw = { quote, rfq }; overview = fields([['RFQ #', rfq.rfqNumber], ['Title', rfq.title], ['Vendor', quote.transporter.name], ['Amount', quote.amount], ['Currency', quote.currency], ['Route', `${rfq.originCity} → ${rfq.destCity}`], ['Notes', quote.notes]]);
    tables.push(table('Vendor comparison', [['vendorName','Vendor'],['amount','Amount'],['currency','Currency'],['notes','Notes']], rfq.quotes.map(row => ({ ...row, vendorName: row.transporter.name })))); targetUrl = `/rfq/${rfq.id}`;
  } else if (action === 'TRANSPORT_BOOK') {
    const prepared = await prepareLeg(tx, entityId, body); fail(prepared.data.transportSource === 'EXTERNAL', 'SCMU fleet assignments do not require vendor approval');
    jobId = prepared.job.id; const carrier = await tx.company.findUnique({ where: { id: prepared.data.carrierId } }); raw = { ...prepared, carrier }; payload = json(prepared.data);
    overview = [...basics(prepared.job), ...fields([['Vendor', carrier.name], ['Transport mode', payload.mode], ['Origin City', payload.originCity], ['Destination City', payload.destCity], ['Loading Date', payload.loadingDate], ['Expected Delivery', payload.expectedDelivery], ['Vessel / flight', payload.vesselFlight], ['Booking number', payload.bookingNumber]])]; scopeSuffix = JSON.stringify(payload);
  } else if (action === 'TRANSPORT_CHANGE') {
    const shipment = await tx.shipment.findUnique({ where: { id: entityId } }); fail(shipment, 'Shipment not found', 404); jobId = shipment.jobId;
    if (jobId) await mutableJob(tx, jobId); fail(!['COMPLETED','CANCELLED'].includes(shipment.status), 'Completed or cancelled shipments are locked', 409);
    const data = await transportChange(tx, shipment, body); const carrier = data.carrierId ? await tx.company.findUnique({ where: { id: data.carrierId } }) : null;
    raw = { shipment, carrier, data }; payload = json(data);
    overview = fields([['Shipment', shipment.shipmentNumber], ['Route', `${shipment.originCity} → ${shipment.destCity}`], ['Transport source', data.transportSource], ['Vendor', carrier?.name], ['Transport mode', data.mode], ['Freight', data.freightAmount ?? shipment.freightAmount], ['Currency', shipment.currency], ['Status', data.status || shipment.status], ['Notes', data.notes]]); targetUrl = `/shipments/${shipment.id}`;
  } else if (action === 'PAYMENT_AUTHORIZE') {
    const prepared = await preparePayment(tx, entityId, body); fail(prepared.data.direction !== 'RECEIVABLE', 'Incoming receipts do not require payment authorization');
    raw = prepared; jobId = entityId; payload = { ...prepared.data, notes: text(body.notes, 'Notes', 2000, true) };
    overview = [...basics(prepared.job), ...fields([['Direction', payload.direction], ['Description', prepared.charge.description], ['Vendor', prepared.charge.vendor?.name], ['Payment recipient', payload.paidTo], ['Amount', payload.amount], ['Payment reference', payload.reference], ['Payment method', payload.method], ['Advance payment', payload.isAdvance ? 'Yes' : 'No'], ['Notes', payload.notes]])]; scopeSuffix = `${payload.direction}:${payload.reference}`;
  } else if (action === 'JOB_CLOSE') {
    raw = await tx.jobOrder.findUnique({ where: { id: entityId }, include: jobInclude }); fail(raw, 'Job order not found', 404); checkJobClosure(raw); jobId = entityId;
    fail(!await tx.directorApproval.count({ where: { jobId, action: { not: 'JOB_CLOSE' }, OR: [{ status: 'SUBMITTED' }, { action: 'PAYMENT_AUTHORIZE', status: 'APPROVED', executedAt: null }] } }), 'Complete outstanding director approvals before closing', 409);
    const totals = financials(raw); overview = [...basics(raw), ...fields([['Approved revenue', totals.revenue], ['Approved cost', totals.approvedCost], ['Billed gross profit', totals.grossProfit], ['Receivable', totals.receivable], ['Vendor payable', totals.payable], ['Internal costs outstanding', totals.internalOutstanding]])];
  } else if (action === 'CLAIM_DECISION') {
    raw = await tx.jobOperation.findUnique({ where: { id: entityId } }); fail(raw?.kind === 'CLAIM', 'Claim not found', 404); const job = await mutableJob(tx, raw.jobId); jobId = job.id;
    fail(!['SETTLED','REJECTED'].includes(raw.status), 'This claim is already closed', 409); payload = { status: choice(body.status, ['APPROVED','SETTLED','REJECTED']), notes: text(body.notes, 'Claim decision explanation', 2000) };
    overview = [...basics(job), ...fields([['Reference', raw.reference], ['Declared amount', raw.amount], ['Status', raw.status], ['Decision', payload.status], ['Notes', payload.notes]])];
  } else if (['INVOICE_ISSUE','LEGACY_INVOICE_SETTLE'].includes(action)) {
    raw = await tx.invoice.findUnique({ where: { id: entityId }, include: { items: { orderBy: { id: 'asc' } }, payments: true } }); fail(raw, 'Invoice not found', 404); jobId = raw.jobId;
    if (jobId) await mutableJob(tx, jobId);
    if (action === 'INVOICE_ISSUE') fail(['PENDING','SUBMITTED','UNDER_REVIEW','DISPUTED'].includes(raw.status) && !raw.payments.length, 'Only draft invoices can be approved', 409);
    else { fail(!jobId && raw.status === 'APPROVED', 'Record job payments from the job order', 409); payload = { paidDate: date(body.paidDate || new Date()).toISOString() }; }
    overview = fields([['Invoice #', raw.invoiceNumber], ['Freight', raw.freightAmount], ['Tax', raw.gstAmount], ['Total', raw.totalAmount], ['Currency', raw.currency], ['Due Date', raw.dueDate?.toISOString()], ['Notes', raw.notes]]); targetUrl = jobId ? `/jobs/${jobId}` : '/invoices';
    tables.push(table('Invoice items', [['description','Description'],['amount','Amount']], raw.items));
  } else fail(false, 'Unsupported director approval action');
  return { raw, payload, jobId, scopeSuffix, view: { overview, tables, targetUrl: targetUrl || `/jobs/${jobId}` } };
}

async function applyAction(tx, user, approval, context) {
  const { raw, payload, jobId } = context; let result;
  switch (approval.action) {
    case 'DRIVER_QUOTA_CHANGE': result = await require('./driverOperations').approveQuota(tx, user, approval); break;
    case 'PACKING_FINALIZE': case 'PACKING_EXCEPTION':
      await tx.jobDocument.update({ where: { id: raw.documentId }, data: { status: 'VERIFIED', verifiedById: user.id } });
      result = await tx.packingList.update({ where: { id: raw.id }, data: { status: 'FINAL', finalizedById: user.id, finalizedAt: new Date(), version: { increment: 1 } } });
      await touchHeader(tx, jobId, raw.direction); await syncJob(tx, jobId); break;
    case 'PACKING_HEADER_FINALIZE':
      result = await tx.packingHeader.update({ where: { id: raw.id }, data: { status: 'FINAL', finalizedById: user.id, finalizedAt: new Date(), version: { increment: 1 } } }); await syncJob(tx, jobId); break;
    case 'SALES_QUOTATION_APPROVE': result = await tx.salesQuotation.update({ where: { id: raw.id }, data: { status: 'APPROVED' } }); break;
    case 'CHARGE_APPROVE': result = await tx.jobCharge.update({ where: { id: raw.id }, data: { status: 'APPROVED', actualAmount: decimal(payload.actualAmount), approvedById: user.id, approvedAt: new Date() } }); break;
    case 'DOCUMENT_VERIFY': result = await tx.jobDocument.update({ where: { id: raw.id }, data: { status: 'VERIFIED', verifiedById: user.id } }); break;
    case 'SEA_BILL_EXCEPTION': result = await require('./seaBills').markMatched(tx, user, raw, payload.note, 'SEA_BILL_EXCEPTION_APPROVED'); break;
    case 'VENDOR_AWARD':
      await tx.rFQ.update({ where: { id: raw.rfq.id }, data: { status: 'AWARDED', awardedQuoteId: raw.quote.id } });
      result = await tx.quote.update({ where: { id: raw.quote.id }, data: { status: 'ACCEPTED' } });
      await tx.quote.updateMany({ where: { rfqId: raw.rfq.id, id: { not: raw.quote.id } }, data: { status: 'REJECTED' } }); break;
    case 'TRANSPORT_BOOK': result = await createLeg(tx, user, raw); break;
    case 'TRANSPORT_CHANGE': result = await tx.shipment.update({ where: { id: raw.shipment.id }, data: raw.data }); if(jobId) await require('./seaBills').transportChanged(tx,user,raw.shipment,result); await syncJob(tx, jobId); break;
    case 'PAYMENT_AUTHORIZE': return null;
    case 'JOB_CLOSE': result = await closeJob(tx, raw); break;
    case 'CLAIM_DECISION': result = await tx.jobOperation.update({ where: { id: raw.id }, data: payload }); break;
    case 'INVOICE_ISSUE': result = await tx.invoice.update({ where: { id: raw.id }, data: { status: 'APPROVED' } }); break;
    case 'LEGACY_INVOICE_SETTLE': result = await tx.invoice.update({ where: { id: raw.id }, data: { status: 'PAID', paidDate: date(payload.paidDate) } }); break;
    default: fail(false, 'Unsupported director approval action');
  }
  await audit(tx, user, approval.action, jobId ? 'JobOrder' : 'DirectorApproval', jobId || approval.id, { approvalId: approval.id, entityId: approval.entityId, resultId: result?.id }); return result;
}
module.exports = { loadAction, applyAction };

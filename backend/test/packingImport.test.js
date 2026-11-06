const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const importer = require('../src/services/packingImport');
const header = require('../src/services/registerPackingHeader');
const workspace = require('../src/services/blWorkspace');

async function sample(options = {}) {
  const book = new ExcelJS.Workbook(); const s = book.addWorksheet('PL');
  s.addRow([null, 'KM CONTOH V. 03/26 ETD 10 OKTOBER 2026']);
  s.addRow([null, '1 SPNU 294.226-5 / SEAL 57100563']);
  s.addRow(['MERK:', 'Penerima A / alamat dan instruksi']);
  s.addRow(['TGL', 'TOKO', 'COLY', 'NAMA BARANG', 'UKURAN', null, null, 'M3/TN']);
  // Header repeats because of vertically merged cells in real workbooks.
  s.addRow(['TGL', 'TOKO', 'COLY', 'NAMA BARANG', 'P', 'L', 'T', 'M3/TN']);
  s.addRow(['07/09', null, 300, 'Barang A', 10, 20, 30, 0.1]);
  s.addRow(['SUB TOTAL:', null, options.wrongSubtotal ? 999 : 300, null, null, null, null, 0.1]);
  s.addRow([null, '1 SPNU 294.226-5 / SEAL 57100563']);
  s.addRow(['MERK: Penerima B']);
  s.addRow([new Date('2026-10-08T00:00:00Z'), null, 205, 'Barang B', null, 0, null, options.formula ? { formula: 'E10*F10*G10/1000000' } : 0]);
  s.addRow(['SUB TOTAL:', null, 205]); s.addRow([null, null, 505]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
test('partner reader excludes subtotals, deduplicates page container headers and retains source coordinates', async () => {
  const result = await importer.parseWorkbook(await sample());
  assert.deepEqual(result.totals, { containers: 1, groups: 2, items: 2, packages: 505 });
  assert.deepEqual(result.containers, [{ number: 'SPNU2942265', seal: '57100563' }]);
  const item = result.groups[0].items[0];
  assert.equal(item.itemDate, null); assert.equal(item.itemDateText, '07/09');
  assert.equal(item.lengthCm, '10'); assert.equal(item.sourceVolume, '0.1'); assert.equal(item.volumeCbm, null);
  assert.equal(item.sourceSheet, 'PL'); assert.equal(item.sourceRow, 6);
  assert.equal(result.groups[1].items[0].itemDate, '2026-10-08');
  assert.equal(result.groups[1].items[0].lengthCm, null); assert.equal(result.groups[1].items[0].widthCm, '0');
});
test('cached formulas are not evaluated and printed subtotal conflicts are visible', async () => {
  const result = await importer.parseWorkbook(await sample({ formula: true, wrongSubtotal: true }));
  assert.equal(result.groups[1].items[0].sourceVolume, null);
  assert(result.warnings.some(w => w.includes('no cached value')));
  assert(result.warnings.some(w => w.includes('printed subtotal differs')));
});
test('fractional package counts are flagged rather than rounded into whole packages', async () => {
  const book = new ExcelJS.Workbook(); await book.xlsx.load(await sample());
  book.worksheets[0].getCell('C6').value = 300.00001;
  const result = await importer.parseWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  assert(result.warnings.some(w=>w.includes('non-integer COLY')));
  assert.equal(result.totals.packages,205);
});
test('rejects arbitrary ZIPs, unknown layouts, macros and expansion bombs before parsing', async () => {
  await assert.rejects(importer.parseWorkbook(Buffer.from('not a workbook')), /Invalid XLSX/);
  const book = new ExcelJS.Workbook(); book.addWorksheet('Other').addRow(['Unrelated data']);
  await assert.rejects(importer.parseWorkbook(Buffer.from(await book.xlsx.writeBuffer())), /No supported/);
  const bomb = await sample(); const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bomb.writeUInt32LE(40 * 1024 * 1024, central + 24);
  assert.throws(() => importer.validateArchive(bomb), /exceeds limits/);
  const macroBook = new ExcelJS.Workbook(); macroBook.addWorksheet('vbaProject');
  // Simulate a macro entry name without constructing or executing any macro.
  const macro = await sample(); const name = macro.indexOf(Buffer.from('xl/workbook.xml'), macro.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])));
  macro.write('vbaProject.bin!', name);
  assert.throws(() => importer.validateArchive(macro), /Macros/);
});
test('import source identity remains independent of BL containers', async () => {
 const parsed=await importer.parseWorkbook(await sample());assert.equal(parsed.groups[0].containerNumber,'SPNU2942265');assert.equal(parsed.groups[0].sealNumber,'57100563');assert.equal(parsed.groups[0].registered,undefined);assert.equal(importer.matching,undefined);
});

test('valid unknown templates remain available for manual transcription, but invalid files are rejected', async () => {
  const book = new ExcelJS.Workbook(); book.addWorksheet('Other').addRow(['Partner custom template']);
  const result = await importer.readOriginal(Buffer.from(await book.xlsx.writeBuffer()));
  assert.equal(result.parser,'MANUAL_ONLY'); assert.equal(result.groups.length,0); assert(result.warnings.length);
  await assert.rejects(importer.readOriginal(Buffer.from('invalid')), /Invalid XLSX/);
});
test('shared partner import rejects foreign containers and requires reviewed group mapping',async()=>{
 const fs=require('node:fs/promises'),path=require('node:path'),jobFiles=require('../src/services/jobFiles');
 const filename='isolation-'+require('node:crypto').randomUUID()+'.xlsx',target=path.join(process.env.TMPDIR,filename),original=jobFiles.filePath;
 await fs.writeFile(target,await sample());jobFiles.filePath=()=>target;
 const record={id:'a',jobId:'j',version:1,contentVersion:1,billNumber:'BL-A',containers:[{number:'OTHER000001'}],files:[{id:'source',filename,category:'PACKING_LIST',mimeType:importer.MIME}],allocations:[],registerData:{},shipment:{mode:'SEA',status:'PENDING'}};
 let writes=0;const tx={seaBill:{findUnique:async()=>record,findFirst:async()=>record,update:async()=>{writes++;}},seaBillFile:{findMany:async()=>[{filename,bill:{id:'b',billNumber:'BL-B'}}]},jobOrder:{findUnique:async()=>({status:'IN_PROGRESS'})},activityLog:{create:async()=>{}}};
 try{
  const preview=await importer.preview(tx,'a','source');assert.equal(preview.scope.type,'SHARED');assert.equal(preview.totalsScope,'SOURCE');
  const body={fileId:'source',version:1,confirmed:true,scopeConfirmed:true,hash:preview.hash,groupIds:[preview.groups[0].id],volumeUnit:'UNCONFIRMED'};
  await assert.rejects(importer.apply(tx,{id:'admin'},'a',body),error=>error.status===409);assert.equal(writes,0);
  record.containers=[{number:'SPNU2942265'}];
  await assert.rejects(importer.apply(tx,{id:'admin'},'a',{...body,scopeConfirmed:false}),error=>error.status===409);assert.equal(writes,0);
  const result=await importer.apply(tx,{id:'admin'},'a',body);assert.equal(result.operational.packing.scopeConfirmed,true);assert.equal(result.operational.packing.groups.length,1);
 }finally{jobFiles.filePath=original;await fs.unlink(target);}
});
test('normalization preserves unknown dimensions, zero values and partial-date provenance', async () => {
  const parsed = await importer.parseWorkbook(await sample());
  const bill = { containers: parsed.containers, files: [{ id: 'source', category: 'PACKING_LIST' }] };
  const value = workspace.defaultOperational(); value.packing.sourceFileIds = ['source'];
  value.packing.groups = parsed.groups.map(g => ({ ...g, sourceFileId: 'source' }));
  const output = workspace.normalizeOperational(value, bill);
  assert.equal(output.packing.groups[0].sourceMark, parsed.groups[0].sourceMark);
  assert.equal(output.packing.groups[0].items[0].itemDateText, '07/09');
  assert.equal(output.packing.groups[1].items[0].lengthCm, null);
  assert.equal(output.packing.groups[1].items[0].widthCm, '0.000');
  assert.equal(output.packing.groups[1].items[0].packages,205);assert.equal(output.reconciliation,undefined);
});
const bill = (id, container, extras = {}) => ({ id, version: 3, billNumber: `BL-${id}`, vesselName: 'KM CONTOH', voyageNumber: '03/26', containers: [{ number: container, seal: '123', size: '40', goodsDescription: 'Muatan contoh' }], registerData: { register: { includeInPackingHeader: true } }, ...extras });
test('Packing Header groups several B/Ls in one voyage but rejects ambiguous duplicates and other voyages', () => {
  const a = bill('a', 'SPNU2942265'); const b = bill('b', 'SPNU2832083');
  const result = header.snapshot([a, b], 'KPL-TEST');
  assert.equal(result.counts.bills, 2); assert.equal(result.counts.containers, 2); assert.equal(result.counts.size40, 2);
  assert.equal(result.records[0].containers[0].packages, null);
  assert.throws(() => header.snapshot([a, { ...b, voyageNumber: '04/26' }], 'X'), /same vessel and voyage/);
  assert.throws(() => header.snapshot([a, bill('c', 'SPNU2942265')], 'X'), /multiple selected/);
  assert.throws(() => header.snapshot([{ ...a, archivedAt: new Date() }], 'X'), /read-only/);
});
test('generated workbook has per-B/L deadline blocks, full print area and literal source text', async () => {
  const data = header.snapshot([bill('a', 'SPNU2942265', { shipperName: '=DANGEROUS()', consigneeName: 'SCMU' })], 'KPL-TEST');
  const book = await header.workbook(data); const buffer = await book.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook(); await loaded.xlsx.load(buffer);
  const s = loaded.worksheets[0];
  assert.equal(s.pageSetup.printArea.replaceAll('$',''), `A1:F${s.rowCount}`);
  assert.equal(s.getCell('A6').value, 'PENGIRIM: =DANGEROUS()');
  assert.equal(s.getCell('A6').type, ExcelJS.ValueType.String);
  assert.equal(loaded.worksheets[1].name, 'Rincian PL');
});

const ExcelJS = require('exceljs');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { Prisma } = require('@prisma/client');
const { fail, audit } = require('./jpt');
const files = require('./jobFiles');
const workspace = require('./blWorkspace');
const register = require('./blRegister');
const sea = require('./seaBills');

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const canonical = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// Inspect ZIP directory before ExcelJS decompresses it. No macro-enabled or encrypted workbooks.
function validateArchive(buffer) {
  fail(buffer.length >= 22 && buffer.length <= 5 * 1024 * 1024 && buffer.readUInt32LE(0) === 0x04034b50, 'Select an XLSX workbook, maximum 5 MB', 415);
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  fail(end >= 0, 'Invalid XLSX archive', 415);
  const count = buffer.readUInt16LE(end + 10); let offset = buffer.readUInt32LE(end + 16); let expanded = 0;
  fail(count > 0 && count <= 2048 && buffer.readUInt16LE(end + 4) === 0, 'Workbook archive is too complex', 415);
  const names = new Set();
  for (let i = 0; i < count; i++) {
    fail(offset + 46 <= end && buffer.readUInt32LE(offset) === 0x02014b50, 'Invalid XLSX directory', 415);
    const length = buffer.readUInt16LE(offset + 28);
    const size = buffer.readUInt32LE(offset + 24); expanded += size;
    fail(!(buffer.readUInt16LE(offset + 8) & 1) && size < 0xffffffff && expanded <= 32 * 1024 * 1024, 'Encrypted or expanded workbook exceeds limits', 415);
    fail(offset + 46 + length <= end, 'Invalid XLSX entry', 415);
    const name = buffer.subarray(offset + 46, offset + 46 + length).toString();
    fail(!/vbaProject|externalLinks\//i.test(name), 'Macros and external workbook links are not supported', 415);
    names.add(name);
    offset += 46 + length + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  fail(names.has('[Content_Types].xml') && names.has('xl/workbook.xml'), 'File is not an XLSX workbook', 415);
}

function valueOf(cell, warnings, location) {
  const value = cell.value;
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (value.formula || value.sharedFormula) {
      if (value.result == null) warnings.add(`${location}: formula has no cached value`);
      return typeof value.result === 'number' || typeof value.result === 'string' ? value.result : null;
    }
    if (value.richText) return value.richText.map(part => part.text).join('');
    if (value.hyperlink) return String(value.text || '');
    return null;
  }
  return value;
}
function numeric(value, scale = 4) {
  if (value == null || String(value).trim() === '') return null;
  const input = typeof value === 'string' ? value.trim().replace(',', '.') : value;
  try { const n = new Prisma.Decimal(input); return n.isFinite() && n.gte(0) && n.lte(1000000) ? (scale == null ? n : n.toDecimalPlaces(scale)).toString() : null; } catch { return null; }
}
const total = (items, key) => items.reduce((n, item) => n.plus(item[key] || 0), new Prisma.Decimal(0)).toString();

async function parseWorkbook(buffer,{summaryOnly=false}={}) {
  fail(Buffer.isBuffer(buffer) && buffer.length >= 22, 'Invalid XLSX file', 415);
  validateArchive(buffer);
  const book = new ExcelJS.Workbook();
  try { await book.xlsx.load(buffer); } catch { fail(false, 'Workbook cannot be read; use an unencrypted XLSX file', 415); }
  fail(book.worksheets.length <= 60, 'Import up to 60 worksheets at a time');
  const warnings = new Set(); const groups = []; const containers = new Map(); const headings = []; const sourceHeader={};
  const headerLabels={partnerName:/^(?:MITRA|NAMA PERUSAHAAN)(?=\s*:|\s*$)\s*:?\s*/i,vesselName:/^(?:KAPAL|NAMA KAPAL)(?=\s*:|\s*$)\s*:?\s*/i,voyageNumber:/^(?:VOY(?:AGE)?|NO\.? PELAYARAN)(?=\s*:|\s*$)\s*:?\s*/i,billNumber:/^(?:NO\.?\s*B\/?L|NOMOR\s+B\/?L)(?=\s*:|\s*$)\s*:?\s*/i,departureDate:/^(?:BERANGKAT|TGL\.? BERANGKAT|ETD)(?=\s*:|\s*$)\s*:?\s*/i,arrivalDate:/^(?:TIBA|TGL\.? TIBA|ETA)(?=\s*:|\s*$)\s*:?\s*/i,storageDate:/^(?:TGL\.? STORAGE|STORAGE)(?=\s*:|\s*$)\s*:?\s*/i,demurrageDate:/^(?:TGL\.? DEM[OU]R+AGE|DEM[OU]R+AGE)(?=\s*:|\s*$)\s*:?\s*/i};
  let visited = 0;
  for (const sheet of book.worksheets) {
    fail(sheet.rowCount <= 10000 && sheet.columnCount <= 100, 'Worksheet exceeds import limits');
    let currentContainer = null; let group = null; let columns = null;
    for (let r = 1; r <= sheet.rowCount; r++) {
      const location = `${sheet.name}!${r}`; const row = sheet.getRow(r);
      visited += row.cellCount; fail(visited <= 200000, 'Workbook exceeds cell import limit');
      const values = Array.from({ length: Math.min(sheet.columnCount, 100) }, (_, i) => {const cell=row.getCell(i+1);return summaryOnly&&cell.isMerged&&cell.master.address!==cell.address?null:valueOf(cell,warnings,location);});
      const labels = values.map(v => String(v ?? '').trim()); const line = labels.join(' ').replace(/\s+/g, ' ').trim();
      if (!line) continue;
      if(!currentContainer&&!group)for(const [key,regex]of Object.entries(headerLabels))for(let c=0;c<labels.length;c++)if(regex.test(labels[c])){
        const tail=labels[c].replace(regex,'').trim();let value=tail;
        if(!value)for(let next=c+1;next<Math.min(c+4,labels.length);next++){if(!labels[next]||labels[next]===':')continue;if(Object.values(headerLabels).some(r=>r.test(labels[next])))break;value=labels[next].replace(/^:\s*/,'');break;}
        if(value&&value.length<=200&&!Object.values(headerLabels).some(r=>r.test(value))){if(sourceHeader[key]&&sourceHeader[key]!==value)warnings.add(`Source header ${key} differs; review the original document`);else sourceHeader[key]=value;}
      }
      if (/\bKM[.\s]/i.test(line) && /\bV(?:OY)?[.\s/\d]/i.test(line) && headings.length < 20 && !headings.includes(line)) headings.push(line.slice(0, 1000));
      const container = line.match(/\b([A-Z]{4})\s*([\d.\s-]{7,18})\s*\/\s*SEAL\s*[:.]?\s*([A-Z0-9-]+)/i);
      if (container) {
        const number = canonical(container[1] + container[2]);
        if (/^[A-Z]{4}\d{7}$/.test(number)) {
          if (currentContainer?.number !== number) group = null;
          currentContainer = { number, seal: container[3].toUpperCase() };
          const old = containers.get(number);
          if (old && old.seal !== currentContainer.seal) warnings.add(`${location}: conflicting seals for ${number}`);
          containers.set(number, currentContainer);
          continue;
        }
      }
      const mark = line.match(/^MERK\s*:\s*(.*)/i);
      if (mark) {
        if (!currentContainer) { warnings.add(`${location}: recipient has no container header`); group = null; continue; }
        group = { id: `group-${groups.length + 1}`, containerNumber: currentContainer.number, sealNumber: currentContainer.seal,
          recipientName: mark[1].slice(0, 250), recipientAddress: null, recipientPhone: null,
          sourceMark: mark[1].slice(0, 1500), sourceSheet: sheet.name, sourceRow: r, items: [], notes: null };
        groups.push(group); continue;
      }
      if (labels.some(v => /^COL[LYI]/i.test(v)) && labels.some(v => /NAMA\s*BARANG/i.test(v))) {
        const find = regex => labels.findIndex(v => regex.test(v));
        const dimensions = find(/^UKURAN/i);
        columns = { packages: find(/^COL[LYI]/i), description: find(/NAMA\s*BARANG/i), itemDate: find(/^TGL$/i), shop: find(/^TOKO$/i), dimensions: dimensions >= 0 ? dimensions : columns?.dimensions ?? -1, volume: find(/M3|M³|CBM/i) };
        // Merged UKURAN header repeats across E:G. Dimension subheader is on the next row.
        continue;
      }
      if (!columns || !group) continue;
      if (/SUB\s*TOTAL|^TOTAL\b/i.test(line)) {
        if (/SUB\s*TOTAL/i.test(line) && numeric(values[columns.packages]) != null && !new Prisma.Decimal(total(group.items, 'packages')).eq(numeric(values[columns.packages]))) warnings.add(`${location}: printed subtotal differs from item rows`);
        continue;
      }
      const description = labels[columns.description]; const count = numeric(values[columns.packages], null);
      if (!description || count == null) { if(summaryOnly&&description)group.items.push({description:description.slice(0,500),packages:null});continue; }
      if (!Number.isInteger(Number(count))) { warnings.add(`${location}: non-integer COLY; row needs manual transcription`);if(summaryOnly)group.items.push({description:description.slice(0,500),packages:null});continue; }
      const rawDate = columns.itemDate >= 0 ? labels[columns.itemDate] : '';
      const fullDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
      if (rawDate && !fullDate) warnings.add('Partial dates are kept as source text; year is not inferred');
      const d = columns.dimensions;
      const rawVolume = columns.volume >= 0 ? numeric(values[columns.volume]) : null;
      group.items.push({ id: `${group.id}-row-${r}`, sourceSheet: sheet.name, sourceRow: r,
        description: description.slice(0, 500), packages: Number(count), quantity: count,
        itemDate: fullDate, itemDateText: rawDate || null, shop: columns.shop >= 0 ? labels[columns.shop].slice(0, 200) || null : null,
        lengthCm: d >= 0 ? numeric(values[d], 3) : null, widthCm: d >= 0 ? numeric(values[d + 1], 3) : null, heightCm: d >= 0 ? numeric(values[d + 2], 3) : null,
        volumeCbm: null, sourceVolume: rawVolume, marks: null });
    }
  }
  const populated = groups.filter(group => group.items.length||summaryOnly&&group.recipientName);
  if (!populated.length) throw Object.assign(new Error('No supported Packing List item rows found. Keep the original document and transcribe it manually.'), { status: 422, code: 'PACKING_LAYOUT_UNSUPPORTED' });
  fail(populated.length <= 200 && populated.every(g => g.items.length <= 500), 'Packing List exceeds group or item limits');
  warnings.add('M3/TN values are not treated as CBM until the admin confirms the unit');
  return { parser: 'BILBA_COLUMNS_V1', hash: createHash('sha256').update(buffer).digest('hex'), headings,sourceHeader,
    containers: [...containers.values()], groups: populated, warnings: [...warnings],
    totals: { containers: new Set(populated.map(g => g.containerNumber)).size, groups: populated.length, items: populated.reduce((n, g) => n + g.items.length, 0), packages: Number(total(populated.flatMap(g => g.items), 'packages')) } };
}

async function readOriginal(buffer,options) {
  try { return await parseWorkbook(buffer,options); }
  catch (error) {
    // Only a successfully validated/read XLSX with an unknown layout may be retained.
    if (error.code !== 'PACKING_LAYOUT_UNSUPPORTED') throw error;
    return { parser: 'MANUAL_ONLY', hash: createHash('sha256').update(buffer).digest('hex'), headings: [], containers: [], groups: [],
      warnings: ['Format belum dikenali. File asli tersimpan; lanjutkan transkripsi manual pada tab Packing List.'],
      totals: { containers: 0, groups: 0, items: 0, packages: 0 } };
  }
}

async function ownedPreview(tx, id, fileId) {
  const bill = await register.get(tx, id);
  const file = bill.files.find(row => row.id === fileId && row.category === 'PACKING_LIST' && row.mimeType === MIME);
  fail(file, 'Select an attached partner XLSX Packing List', 404);
  const parsed = await readOriginal(await fs.readFile(files.filePath(file.filename)));
  return { bill, file, parsed };
}
async function preview(tx, id, fileId) {
  const { bill, file, parsed } = await ownedPreview(tx, id, fileId);
  return { ...parsed, fileId: file.id, filename: file.originalName, version: bill.version, billNumber: bill.billNumber, scope:file.scope,totalsScope:'SOURCE',mappingWarning:file.mappingWarning||null,
    groups: parsed.groups,
    alreadyImported: (bill.registerData?.packingImports || []).some(row => row.hash === parsed.hash) };
}
async function apply(tx, user, id, body) {
  const { bill, file, parsed } = await ownedPreview(tx, id, body.fileId);
  await sea.getBill(tx, bill.jobId, id, body.version);
  fail(body.confirmed === true, 'Review and confirm the import first');
  fail(body.hash === parsed.hash, 'Source workbook changed; preview it again', 409);
  fail(!(bill.registerData?.packingImports || []).some(row => row.hash === parsed.hash), 'This workbook has already been imported into this B/L', 409);
  fail(Array.isArray(body.groupIds) && body.groupIds.length && new Set(body.groupIds).size === body.groupIds.length, 'Select recipient groups to import');
  const selected = parsed.groups.filter(g => body.groupIds.includes(g.id));
  fail(selected.length === body.groupIds.length, 'Invalid import group selection');
  if(file.scope?.type==='SHARED'){
    fail(body.scopeConfirmed===true,'Konfirmasikan kelompok penerima terpilih hanya milik B/L ini.',409);
    const own=new Set(require('./blRegister').normalize({},bill).containers.map(c=>canonical(c.number)));
    fail(selected.every(g=>g.containerNumber&&own.has(canonical(g.containerNumber))),'Kelompok sumber bersama memuat kontainer di luar B/L ini. Pilih bagian yang benar.',409);
  }
  fail(['UNCONFIRMED', 'CBM'].includes(body.volumeUnit), 'Confirm the volume column unit');
  const previous = workspace.operationalOf(bill);
  await require('./packingRecap').invalidateShared(tx,user,bill);
  const imported = selected.map(g => ({ ...g, id: randomUUID(), containerNumber: g.containerNumber, sourceFileId: file.id,
    notes: g.notes||null, items: g.items.map(item => ({ ...item, id: randomUUID(), volumeCbm: body.volumeUnit === 'CBM' ? item.sourceVolume : null })) }));
  const operational = workspace.normalizeOperational({ ...previous, packing: { ...previous.packing, status: 'DRAFT', headerStatus: 'DRAFT',scopeConfirmed:body.scopeConfirmed===true,sourceHeading:parsed.headings.join(' | ').slice(0,2000)||previous.packing.sourceHeading,
    sourceFileIds: [...new Set([...previous.packing.sourceFileIds, file.id])], groups: [...previous.packing.groups, ...imported] } }, bill);
  const imports = [...(bill.registerData?.packingImports || []), { hash: parsed.hash, sourceFileId: file.id, parser: parsed.parser, groupIds: body.groupIds, volumeUnit: body.volumeUnit, importedAt: new Date().toISOString(), importedById: user.id }];
  await tx.seaBill.update({ where: { id }, data: { registerData: { ...bill.registerData, workflowVersion:2, operational, packingImports: imports }, version: { increment: 1 } } });
  await audit(tx, user, 'PACKING_EXCEL_IMPORTED', 'JobOrder', bill.jobId, { seaBillId: id, sourceFileId: file.id, hash: parsed.hash, groupIds: body.groupIds, volumeUnit: body.volumeUnit });
  return { version: bill.version + 1, operational };
}
module.exports = { MIME, canonical, validateArchive, parseWorkbook, readOriginal, preview, apply };

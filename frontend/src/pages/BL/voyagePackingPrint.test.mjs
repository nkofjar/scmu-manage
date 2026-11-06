import test from 'node:test';import assert from 'node:assert/strict';import {printableVoyagePacking,voyagePages,voyageConfig} from './voyagePackingPrint.mjs';
const sample=()=>({number:'RPL',title:'PACKING LIST SCMU',vesselName:'TANTO UJI',voyageNumber:'165',containerCount:3,selection:[{id:'b',version:1}],records:[{billId:'b',billNumber:'BL-1',version:1,sender:'CETAK',recipient:'GUDANG',order:0,rows:[{key:'b:C1',number:'C1',seal:'S1',quantity:500,unit:'SAK',description:'BERAS',order:0}]}],groups:[{key:'g',sender:'<script>bad()</script>',recipient:'GUDANG',billNumbers:['BL-1','BL-2'],rows:[{key:'C1',number:'C1',seal:'S1',quantity:500,unit:'SAK',description:'BERAS'},{key:'C2',number:'C2',seal:'S2',quantity:null,unit:null,description:'SEMEN'},{key:'C3',number:'C3',seal:'S3',quantity:0,unit:'DUS',description:'PAKET'}]}],notice:'Rekap dari B/L'});
test('print carries source and seal conflict warnings without replacing source identities',()=>{
 const data=sample();data.warnings=['Konflik segel S1 / S2 <periksa>'];
 assert.match(printableVoyagePacking(data),/Konflik segel S1 \/ S2 &lt;periksa&gt;/);
});
test('recipient header replaces repeated row names without dropping details or changing source data',()=>{
 const data=sample(),group=data.groups[0];group.recipient='TOKO UTAMA';
 group.rows[0].recipients=[{name:'  toko  utama ',quantity:0,unit:'DUS',address:'Gudang A',phone:'081',notes:'Tunggu bayar',instructions:'Pintu belakang'}];
 group.rows[1].recipients=[{name:'TOKO LAIN',quantity:2,unit:'SAK'}];
 group.rows[2].recipients=[{name:'TOKO UTAMA',quantity:1,unit:'DUS'},{name:'TOKO KEDUA',quantity:3,unit:'DUS'}];
 const before=structuredClone(data),html=printableVoyagePacking(data);
 assert.doesNotMatch(html,/toko  utama/);assert.equal((html.match(/TOKO UTAMA/g)||[]).length,2,'header plus explicit multi-recipient allocation');
 for(const value of ['TOKO LAIN','TOKO KEDUA','Gudang A','081','Tunggu bayar','Pintu belakang','0 DUS'])assert(html.includes(value));
 assert.deepEqual(data,before);
});
test('partner recipients and handling instructions appear in the main print with escaped provenance',()=>{
 const data=sample();data.groups[0].rows[0].sourceType='PARTNER_PL';data.groups[0].rows[0].recipients=[{name:'TOKO <A>',quantity:4,unit:'DUS',notes:'Tahan & tunggu bayar',address:'Alamat',phone:'Kontak'}];data.records[0].rows[0].sourceType='PARTNER_PL';
 data.groups[0].rows[0].recipients[0].instructions='Bongkar <pintu belakang>';
 const html=printableVoyagePacking(data);assert.match(html,/Bongkar &lt;pintu belakang&gt;/);assert.match(html,/TOKO &lt;A&gt;/);assert.match(html,/Tahan &amp; tunggu bayar/);assert.match(html,/4 DUS/);assert.equal(voyageConfig(data).rows[0].sourceType,'PARTNER_PL');assert.equal(voyageConfig(data).rows[0].recipients,undefined);
});
test('voyage output leaves absent optional data blank but retains explicit zero and container counts',()=>{const data=sample();data.groups[0].rows[1].recipients=[{name:'TOKO EMPTY',quantity:null,unit:null}];const html=printableVoyagePacking(data);assert.match(html,/A4 portrait/);assert.match(html,/table-header-group/);assert.match(html,/500 SAK/);assert.match(html,/JUMLAH KONT\.: 3/);assert.doesNotMatch(html,/belum dicatat|belum diisi|belum diketahui|—/i);assert.match(html,/TOKO EMPTY/);assert.match(html,/0 DUS/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.equal((html.match(/class="no">1</g)||[]).length,1);assert.equal((html.match(/class="no">3</g)||[]).length,1);});
test('long groups continue with stable row numbers and selection-free editable config cannot change source seals',()=>{const data=sample();data.groups[0].rows=Array.from({length:30},(_,i)=>({number:'C'+i,seal:'S'+i}));const pages=voyagePages(data);assert.equal(pages.length,2);assert.equal(pages[1].offset,24);assert.match(printableVoyagePacking(data),/class="no">30</);const config=voyageConfig(sample());assert.equal(config.rows[0].seal,undefined);assert.equal(config.rows[0].number,undefined);assert.equal(config.rows[0].quantity,500);});

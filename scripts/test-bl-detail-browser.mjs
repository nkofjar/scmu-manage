import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {checkPage} from './browser-check.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const {createServer}=require('vite');
process.chdir(path.join(root,'frontend'));
// Browser fixtures exercise the real components without credentials or live database writes.
const entry=`import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {LanguageProvider} from '/src/i18n/LanguageContext.jsx';
import BLWorkspace from '/src/pages/BL/BLWorkspace.jsx';
import api from '/src/api/client.js';
import '/src/index.css';
import '/src/styles/workspace.css';
const own={id:'own',filename:'partner.xlsx',originalName:'PARTNER.xlsx',category:'PACKING_LIST',scope:{type:'BL',billIds:['browser']}};
const out={id:'out',filename:'head.xlsx',originalName:'HEAD-LATEST.xlsx',category:'INTERNAL_PACKING_LIST',scope:{type:'BL',billIds:['browser']},createdAt:'2026-02-01'};
const bill={id:'browser',billNumber:'BL-BROWSER',version:1,journeyId:'j',vesselName:'MV FIXTURE',voyageNumber:'01',portOfLoading:'Origin',portOfDischarge:'Destination',containers:[{id:'c',number:'CONT-A',seal:'SEAL-A',size:'40'}],register:{dateMeaning:'UNCONFIRMED'},files:[own,out,{...out,id:'old',originalName:'HEAD-OLD.xlsx',createdAt:'2026-01-01'},{id:'support',originalName:'SUPPORTING.pdf',category:'SUPPORTING'}],registerData:{operational:{packing:{status:'CONFIRMED',sourceFileIds:['own'],groups:[]}}},workflow:{documents:'COMPLETE',sourcePrepared:true,field:'NOT_STARTED'},documentAvailability:{billOfLading:true}};
bill.files.push({id:'invoice',filename:'invoice.pdf',originalName:'INVOICE-ONLY.pdf',category:'INVOICE'},{id:'pod',filename:'pod.pdf',originalName:'POD-ONLY.pdf',category:'POD'},{id:'bl',filename:'bl.pdf',originalName:'BL-ORIGINAL.pdf',category:'FINAL'});
api.get=async url=>({data:url.endsWith('/driver-operations')?{version:1,containers:bill.containers,files:[{id:'pod',originalName:'POD-ONLY.pdf',category:'POD',endpoint:'/bl-register/browser/files/pod'}],works:[]}:url.endsWith('/files')?{files:bill.files}:url.endsWith('/workspace')?{operational:{deadlines:{}},costs:[]}:bill});
api.post=api.put=async()=>{throw Error('No mutation is permitted by this read-only browser fixture');};
const params=new URLSearchParams(location.search),route=params.get('route')||'summary';
if(route==='packing-archived'){bill.archived=true;bill.files.push({id:'report',filename:'report.pdf',originalName:'ARCHIVED-REPORT.pdf',category:'RECEIVING_REPORT'});}
if(route==='standalone'){bill.journeyId=null;bill.archived=true;}
createRoot(document.getElementById('root')).render(<LanguageProvider initialLanguage={params.get('language')||'id'}><MemoryRouter initialEntries={['/bl-register/browser?tab='+(route==='packing-archived'?'packing':route)]}><main style={{padding:24,minWidth:0}}><BLWorkspace bill={bill}/></main></MemoryRouter></LanguageProvider>);
const wait=async fn=>{for(let i=0;i<160;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out waiting for browser UI');};
const click=label=>{const element=[...document.querySelectorAll('button,summary')].find(e=>e.textContent.trim()===label);if(!element)throw Error('Missing action '+label);element.click();};
const checks=[];
const check=(condition,message)=>{if(!condition)throw Error(message);checks.push(message);};
(async()=>{try{
 await wait(()=>document.querySelector('[data-bl-tabs]'));
 check(document.querySelectorAll('[data-bl-tabs] [role=tab]').length===4,'four primary B/L tabs');
 check(![...document.querySelectorAll('[data-bl-tabs] [role=tab]')].some(e=>e.textContent.trim()==='Dokumen'),'no Documents tab');
 if(route==='standalone'){
  click('Berkas lama B/L tanpa pengiriman');
  await wait(()=>document.querySelector('[data-bill-file-references]')?.textContent.includes('BL-ORIGINAL.pdf'));
  check(!document.querySelector('input[type=file]'),'standalone archived original-file access is retrieval-only');
 }else if(route==='packing-archived'){
  click('Opsi lain: manual, Berita Acara & pemeriksaan lapangan');
  await wait(()=>document.querySelector('[data-bill-file-references]')?.textContent.includes('ARCHIVED-REPORT.pdf'));
  check(!!document.querySelector('button[aria-label="Lihat ARCHIVED-REPORT.pdf"]'),'archived report view is available without creator permission');
 }else if(route==='packing'){
  await wait(()=>document.body.textContent.includes('HEAD-LATEST.xlsx'));
  check(document.querySelectorAll('[data-packing-primary]').length===2,'two main packing groups');
  check(!document.querySelector('input[type=file]'),'upload form closed initially');
  check(!document.body.textContent.includes('HEAD-OLD.xlsx'),'old revisions hidden initially');
  click('Riwayat revisi');await wait(()=>document.body.textContent.includes('HEAD-OLD.xlsx'));
  check(true,'revision history opens on demand');
  click('Unggah PL mitra');await wait(()=>document.querySelector('input[type=file]'));
  check(true,'partner upload opens on demand');
 }else if(route==='driver-bons'){
  await wait(()=>document.body.textContent.includes('POD-ONLY.pdf'));
  check(!document.body.textContent.includes('INVOICE-ONLY.pdf'),'Bonrate does not duplicate financial documents');
  check(!document.body.textContent.includes('BL-ORIGINAL.pdf'),'Bonrate does not duplicate original B/L');
 }else if(route==='documents'||route==='costs'){
  await wait(()=>document.body.textContent.includes('Dokumen transaksi & pajak'));
  if(route==='costs')click('Dokumen transaksi & pajak');
  await wait(()=>document.querySelector('[data-document-area=FINANCE]')?.textContent.includes('INVOICE-ONLY.pdf'));
  check(!document.body.textContent.includes('POD-ONLY.pdf'),'Costs does not duplicate Bonrate evidence');
  check(!document.body.textContent.includes('BL-ORIGINAL.pdf'),'Costs does not duplicate original B/L');
  check(!document.querySelector('[data-document-area=FINANCE]').textContent.includes('SUPPORTING.pdf'),'Finance file manager excludes generic shipping files; cost evidence chooser may reference existing files');
 }else{
  await wait(()=>document.querySelector('[data-bl-summary]'));
  check(!document.body.textContent.includes('Tagihan register'),'no duplicated billing on summary');
  check(!document.querySelector('[data-register-documents]'),'no file managers on summary');
  check(!document.body.textContent.includes('Dokumen pendukung pengiriman'),'no supporting documents section on summary');
  check(!document.body.textContent.includes('Unggah B/L'),'no B/L upload on detail summary');
  click('Batas waktu pelabuhan');await wait(()=>document.querySelector('input[type=date]'));
  check(true,'port deadline editor remains accessible');
 }
 check(document.documentElement.scrollWidth<=innerWidth+1,'no page-level horizontal overflow');
 document.documentElement.dataset.scmuCheck=btoa(JSON.stringify({ok:true,checks}));
}catch(error){document.documentElement.dataset.scmuCheck=btoa(JSON.stringify({ok:false,checks,error:error.message}));}})();`;
const fixtureId=path.join(root,'frontend','__bl-check.jsx');
const server=await createServer({root:path.join(root,'frontend'),plugins:[{name:'bl-detail-browser-fixture',resolveId(id){if(id==='/__bl-check.jsx')return fixtureId;},load(id){if(id===fixtureId)return entry;},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(!req.url.startsWith('/__bl-check.html'))return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__bl-check.jsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:5196,strictPort:true,hmr:false}});
const output=path.join(process.env.TMPDIR||path.join(root,'.demo'),'bl-detail-simple-browser');
await mkdir(output,{recursive:true});await server.listen();
try{
 for(const width of [1440,390])for(const route of ['summary','packing','costs','documents','driver-bons','standalone','packing-archived']){
  const result=await checkPage({chrome:process.env.SCMU_TEST_BROWSER||'/snap/bin/chromium',output,width,height:1000,url:'http://127.0.0.1:5196/__bl-check.html?route='+route,screenshot:path.join(output,route+'-'+width+'.png')});
  assert(result.ok,route+' '+width+': '+result.error);console.log('PASS '+route+' '+width+': '+result.checks.join('; '));
 }
}finally{await server.close();}

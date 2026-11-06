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
// Real component and CSS with isolated transport; no live database access.
const entry=`import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {LanguageProvider} from '/src/i18n/LanguageContext.jsx';
import Manager from '/src/pages/Shipments/BillDeliveryOrder.jsx';
import api from '/src/api/client.js';
import '/src/index.css';
import '/src/styles/workspace.css';
const english=new URLSearchParams(location.search).get('language')==='en';
const bill={id:'a',billNumber:'BL-DO-FIXTURE',version:1,files:[],containers:[]};
let files=[],version=1,posts=0;
api.get=async url=>{if(url!=='/bl-register/a/files')throw Error('Unexpected read '+url);return {data:{data:files,version}};};
api.post=async(url,body)=>{
 if(url!=='/bl-register/a/files'||body.get('externalNumber')!==null||body.get('documentDate')!==null||body.get('category')!=='DELIVERY_ORDER'||body.get('version')!==String(version))throw Error('Unexpected upload payload');
 const file=body.get('file');posts++;version++;
 files=[{id:'do'+posts,category:'DELIVERY_ORDER',originalName:file.name,createdAt:new Date().toISOString(),externalNumber:null,documentDate:null},...files];
 return {data:{data:files,version}};
};
createRoot(document.getElementById('root')).render(<LanguageProvider initialLanguage={english?'en':'id'}><MemoryRouter><main style={{padding:24,minWidth:0}}><Manager bill={bill} onClose={()=>{}} onSaved={()=>{}}/></main></MemoryRouter></LanguageProvider>);
const checks=[],check=(condition,message)=>{if(!condition)throw Error(message);checks.push(message);};
const wait=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('UI timeout');};
const button=label=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===label);
const choose=name=>{const transfer=new DataTransfer();transfer.items.add(new File(['%PDF-fixture'],name,{type:'application/pdf'}));const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));};
(async()=>{try{
 const upload=english?'Upload DO':'Unggah DO',replace=english?'Replace DO':'Ganti DO';
 await wait(()=>document.querySelector('fieldset:not(:disabled)'));
 check(document.body.textContent.includes(bill.billNumber),'selected B/L identity remains visible');
 check(document.querySelectorAll('input').length===1&&document.querySelector('input[type=file]'),'file-only upload without number or date fields');
 check(!document.body.textContent.includes('tidak berarti dokumen telah diverifikasi'),'no generic disclaimer');
 check(button(upload)?.disabled,'upload requires a file');
 choose('DO-first.pdf');await wait(()=>!button(upload)?.disabled);button(upload).click();
 await wait(()=>button(replace)&&!document.querySelector('fieldset').disabled);
 check(posts===1&&document.body.textContent.includes('DO-first.pdf'),'file-only upload succeeds');
 check(button(english?'View DO':'Lihat DO')&&button(english?'Download DO':'Unduh DO'),'current document remains accessible');
 choose('DO-revised.pdf');await wait(()=>!button(replace)?.disabled);button(replace).click();
 await wait(()=>posts===2&&document.querySelector('details')?.textContent.includes('DO-first.pdf')&&document.body.textContent.includes('DO-revised.pdf')&&!document.querySelector('fieldset').disabled);
 const history=document.querySelector('details');check(history&&history.textContent.includes('DO-first.pdf'),'replacement keeps previous document in folded history');history.open=true;
 check(document.body.textContent.includes('DO-revised.pdf'),'replacement becomes current');
 check(!document.querySelector('[data-bill-delivery-order]').textContent.includes('—'),'missing metadata has no placeholders');
 check(document.documentElement.scrollWidth<=innerWidth+1,'no page-level horizontal overflow');
 document.documentElement.dataset.scmuCheck=btoa(JSON.stringify({ok:true,checks}));
}catch(error){document.documentElement.dataset.scmuCheck=btoa(JSON.stringify({ok:false,checks,error:error.message}));}})();`;
const fixtureId=path.join(root,'frontend','__do-check.jsx');
const server=await createServer({root:path.join(root,'frontend'),plugins:[{name:'do-browser-fixture',resolveId(id){if(id==='/__do-check.jsx')return fixtureId;},load(id){if(id===fixtureId)return entry;},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(!req.url.startsWith('/__do-check.html'))return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__do-check.jsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0,hmr:false}});
const output=path.join(process.env.TMPDIR||path.join(root,'.demo'),'do-upload-browser');
await mkdir(output,{recursive:true});
try{
 await server.listen();
 for(const [width,language] of [[1440,'id'],[390,'id'],[1440,'en']]){
  const result=await checkPage({chrome:process.env.SCMU_TEST_BROWSER||'/snap/bin/chromium',output,width,height:1000,url:'http://127.0.0.1:'+server.httpServer.address().port+'/__do-check.html?language='+language,screenshot:path.join(output,language+'-'+width+'.png')});
  assert(result.ok,language+' '+width+': '+result.error);console.log('PASS '+language+' '+width+': '+result.checks.join('; '));
 }
}finally{await server.close();}

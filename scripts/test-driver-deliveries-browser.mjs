import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {checkPage} from './browser-check.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(new URL('../frontend/package.json',import.meta.url)),{createServer}=require('vite');
process.chdir(path.join(root,'frontend'));
const entry=`import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {LanguageProvider} from '/src/i18n/LanguageContext.jsx';
import {AuthProvider} from '/src/context/AuthContext.jsx';
import BillManager from '/src/pages/BL/BillDriverOperations.jsx';
import AggregateManager from '/src/pages/Shipments/DriverOperations.jsx';
import api from '/src/api/client.js';
import '/src/index.css';import '/src/styles/workspace.css';
localStorage.setItem('scmu_language','id');localStorage.setItem('scmu_user',JSON.stringify({role:'ADMIN'}));
const bill={id:'a',journeyId:'j',billNumber:'BL-A'},bills=[bill,{id:'b',billNumber:'BL-B'}],containers=[{number:'CONT-1',size:'20',billIds:['a','b']}];
const files=[{id:'pa',evidenceId:'pa',category:'POD',source:'BILL',billIds:['a'],originalName:'Own receipt.pdf',endpoint:'/own'},{id:'pb',evidenceId:'pb',category:'POD',source:'BILL',billIds:['b'],originalName:'Foreign receipt.pdf',endpoint:'/foreign'},{id:'common',evidenceId:'common',category:'POD',source:'JOURNEY',billIds:[],originalName:'Common journey.pdf',endpoint:'/common'}];
const state={version:1,bills,containers,works:[],sharedWork:[],files,budgets:[],quotaRequests:[],recaps:[],legacy:[],legacyReviewed:true};
let writes=[],failRead=false;const dispatches=[{id:'old',number:'HISTORICAL-PDF',documentType:'TRANSPORT_ORDER',taskDate:'2026-10-01'}];
api.get=async(url,config)=>{
 if(config?.responseType==='blob')return {data:new Blob(['%PDF-1.4'],{type:'application/pdf'})};
 if(url==='/routes?limit=200')return {data:{data:[{id:'route',name:'Port → Depots'}]}};
 if(url==='/goods?limit=200')return {data:{data:[{id:'rice',name:'Rice master'}]}};
 if(url==='/journeys/driver-options')return {data:{drivers:[{id:'d',name:'Driver'}],vehicles:[{id:'v',registrationNo:'PA 123'}]}};
 if(url.endsWith('/dispatches'))return {data:{data:dispatches}};
 if(url.endsWith('/payments'))return {data:[]};if(url==='/jpt-tariffs/schemes')return {data:{data:[]}};
 if(url.endsWith('/driver-operations')){if(failRead){failRead=false;throw Error('Committed upload refresh failed');}return {data:structuredClone(state)};}
 throw Error('Unexpected GET '+url);
};
api.post=async(url,body)=>{writes.push({url,body});state.version++;
 if(url.endsWith('/evidence')){const f={id:'uploaded',evidenceId:'uploaded',category:'POD',source:'BILL',billIds:[body.get('billId')||'a'],originalName:'Fifth receipt.pdf',endpoint:'/uploaded'};files.push(f);failRead=true;return {data:f};}
 if(url.endsWith('/works')){const work={...structuredClone(body.work),id:'w',number:'BON-FIVE',status:'DRAFT'};state.works=[work];failRead=true;return {data:work};}
 throw Error('Unexpected POST '+url);
};api.put=async(url,body)=>{writes.push({url,body});state.version++;state.works=[{...body.work,id:'w',number:'BON-FIVE',status:'DRAFT'}];return {data:state.works[0]};};api.delete=async()=>{throw Error('Forbidden deletion');};
function Fixture(){const [aggregate,setAggregate]=useState(false);return <LanguageProvider initialLanguage="id"><MemoryRouter><AuthProvider><main className="p-4 md:p-6"><button onClick={()=>setAggregate(!aggregate)}>Switch scope</button>{aggregate?<AggregateManager journey={{id:'j',bills:[]}}/>:<BillManager bill={bill}/>}</main></AuthProvider></MemoryRouter></LanguageProvider>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('UI wait timed out');};
const button=(name,scope=document)=>[...scope.querySelectorAll('button')].find(n=>n.textContent.trim()===name),click=(name,scope=document)=>{const b=button(name,scope);if(!b||b.disabled)throw Error('Unavailable button '+name);b.click();};
const field=(name,scope=document)=>scope.querySelector('[aria-label="'+name+'"]');
const set=(name,value,scope=document)=>{const el=field(name,scope);if(!el)throw Error('Missing field '+name);const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));};
const checks=[],check=(ok,msg)=>{if(!ok)throw Error(msg);checks.push(msg);};const contained=()=>{const d=document.querySelector('[role=dialog]');check(document.documentElement.scrollWidth<=innerWidth+1,'page contained '+innerWidth);if(d){const r=d.getBoundingClientRect();check(r.left>=-1&&r.right<=innerWidth+1,'dialog contained '+innerWidth);}};
(async()=>{try{
 await wait(()=>button('Tambah bonrate')&&!button('Tambah bonrate').disabled);click('Tambah bonrate');await wait(()=>field('Penerima'));
 check(!field('Instruksi')&&!field('Lokasi pengambilan')&&!field('Nomor bukti serah terima'),'retired fields absent in selected editor');
 check(field('Tanggal diterima').value==='','planned child has no invented receipt');
 await wait(()=>field('Rute').options.length===2);set('Rute','route');set('Pilih sopir master','d');set('Pilih kendaraan master','v');set('Tanggal tugas','2026-10-31');
 for(let i=1;i<5;i++){click('Tambah serah terima');await wait(()=>document.querySelectorAll('[data-driver-delivery]').length===i+1);}
 const children=[...document.querySelectorAll('[data-driver-delivery]')];
 for(let i=0;i<5;i++){set('Kontainer serah terima','CONT-1',children[i]);set('Penerima','Recipient '+(i+1),children[i]);set('Tujuan pengantaran','Depot '+(i+1),children[i]);set('Master jenis barang (opsional)','rice',children[i]);set('Kemasan','Sack',children[i]);set('Jumlah','5',children[i]);}
 check(children.every(c=>c.textContent.includes('Own receipt.pdf')&&!c.textContent.includes('Foreign receipt.pdf')),'child proof chooser excludes sibling BL');
 check(children.every(c=>!c.textContent.includes('Common journey.pdf')),'unsupported journey-common evidence excluded');contained();
 const dt=new DataTransfer();dt.items.add(new File(['%PDF-1.4'],'Fifth receipt.pdf',{type:'application/pdf'}));const upload=children[4].querySelector('input[type=file]');upload.files=dt.files;upload.dispatchEvent(new Event('change',{bubbles:true}));
 await wait(()=>document.querySelector('[role=dialog]').textContent.includes('Committed upload refresh failed'));
 const modal=document.querySelector('[role=dialog]');click('Muat ulang',modal);await wait(()=>field('Fifth receipt.pdf',modal));
 check([...modal.querySelectorAll('[data-driver-delivery]')].every((c,i)=>field('Fifth receipt.pdf',c).checked===(i===4)),'upload auto-associates fifth child only and survives failed refresh');check(writes.length===1,'refresh recovery never reuploads');
 contained();click('Simpan',modal);await wait(()=>!document.querySelector('[role=dialog]'));
 await wait(()=>document.querySelector('[role=alert]')?.textContent.includes('Committed upload refresh failed'));check(button('Tambah bonrate').disabled,'committed work save locks writes after failed read');click('Muat ulang');await wait(()=>!button('Tambah bonrate').disabled&&document.body.textContent.includes('BON-FIVE'));check(writes.filter(w=>w.url.endsWith('/works')).length===1,'committed work recovery never resends write');
 const saved=writes.find(w=>w.url.endsWith('/works')).body.work;
 check(saved.deliveries.length===5&&saved.routeId==='route'&&saved.deliveries[4].recipient==='Recipient 5','one parent saves five planned delivery children and route');
 check(saved.billId==='a'&&saved.containerNumber==='CONT-1'&&saved.driverId==='d'&&saved.vehicleId==='v','parent retains primary BL, quota container and master identities');
 check(saved.deliveries.every((d,i)=>d.items[0].goodsType==='Rice master'&&d.items[0].goodsTypeId==='rice'&&d.items[0].collyCount==='5'&&d.items[0].collyType==='Sack'&&d.items[0].owner==='Recipient '+(i+1)&&!('label' in d.items[0])),'payload uses backend canonical goods contract without editor aliases');
 check(state.works.length===1&&document.querySelector('[data-bill-driver-operations]').textContent.includes('0/5 selesai'),'five planned children remain one incomplete rit');
 click('Surat tugas / jalan');await wait(()=>document.querySelector('[data-driver-dispatch]'));
 check(document.querySelector('[data-driver-dispatch]').textContent.includes('Recipient 5'),'dispatch previews planned fifth child before receipt');check(document.querySelector('[data-driver-dispatch]').textContent.includes('HISTORICAL-PDF'),'historical PDF remains readable');contained();click('Tutup');
 click('Switch scope');await wait(()=>document.querySelector('[data-driver-operations]'));click('Ubah');await wait(()=>field('B/L serah terima'));
 check(!field('Instruksi')&&!field('Lokasi pengambilan')&&!field('Nomor bukti serah terima'),'retired fields absent in aggregate editor');
 check(field('B/L serah terima').options.length===3,'aggregate bills from GET used when journey prop omits bills');
 const aggregateChildren=[...document.querySelectorAll('[data-driver-delivery]')];set('B/L serah terima','b',aggregateChildren[4]);await wait(()=>field('Foreign receipt.pdf',aggregateChildren[4]));
 check(!field('Own receipt.pdf',aggregateChildren[4]),'switching child BL clears and rescope proofs');set('Kontainer serah terima','CONT-1',aggregateChildren[4]);contained();click('Simpan',document.querySelector('[role=dialog]'));await wait(()=>!document.querySelector('[role=dialog]'));
 check(state.works.length===1&&state.works[0].deliveries[4].billId==='b'&&state.works[0].deliveries[4].evidenceFileIds.length===0,'aggregate edits original shared work without cloning and clears foreign association');
 state.works[0].sharedWork=true;click('Switch scope');await wait(()=>document.querySelector('[data-shared-driver-work]'));
 check(!button('Ubah',document.querySelector('[data-shared-driver-work]'))&&document.querySelector('[data-shared-driver-work] a'),'selected BL shared work read-only with aggregate editing link');contained();
 document.documentElement.dataset.scmuCheck=btoa(JSON.stringify({ok:true,checks}));
}catch(e){document.documentElement.dataset.scmuCheck=btoa(JSON.stringify({ok:false,checks,error:e.message}));}})();`;
const fixtureId=path.join(root,'frontend','__driver-deliveries-check.jsx');
const server=await createServer({root:path.join(root,'frontend'),plugins:[{name:'driver-deliveries-fixture',resolveId(id){if(id==='/__driver-deliveries-check.jsx')return fixtureId;},load(id){if(id===fixtureId)return entry;},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(!req.url.startsWith('/__driver-deliveries-check.html'))return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__driver-deliveries-check.jsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0,hmr:false}});
const output=path.join(process.env.TMPDIR||path.join(root,'.demo'),'driver-deliveries-browser');await mkdir(output,{recursive:true});await new Promise(resolve=>server.httpServer.listen(0,'127.0.0.1',resolve));
if(process.env.SCMU_FIXTURE_SERVE){console.log('FIXTURE http://127.0.0.1:'+server.httpServer.address().port+'/__driver-deliveries-check.html');await new Promise(()=>{});}
try{for(const width of [1440,390]){const result=await checkPage({chrome:process.env.SCMU_TEST_BROWSER||'/snap/bin/chromium',output,width,height:1000,url:'http://127.0.0.1:'+server.httpServer.address().port+'/__driver-deliveries-check.html',screenshot:path.join(output,width+'.png')});assert(result.ok,width+': '+result.error+'; passed '+result.checks.join('; '));console.log('PASS '+width+': '+result.checks.join('; '));}}finally{await server.close();}

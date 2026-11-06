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
 if(url==='/routes?limit=200')return {data:{data:[{id:'route',name:'Port → Depots',destCity:'Abepura',destState:'Papua',isActive:true},{id:'inactive',name:'Inactive',isActive:false}]}};
 if(url==='/goods?limit=200')return {data:{data:[{id:'rice',name:'Rice master'}]}};
 if(url==='/journeys/driver-options')return {data:{drivers:[{id:'d',name:'Driver'}],vehicles:[{id:'v',registrationNo:'PA 123'}]}};
 if(url.endsWith('/dispatches'))return {data:{data:dispatches}};
 if(url.endsWith('/payments'))return {data:[]};if(url==='/jpt-tariffs/schemes')return {data:{data:[]}};
 if(url.endsWith('/driver-operations')){if(failRead){failRead=false;throw Error('Committed upload refresh failed');}return {data:structuredClone(state)};}
 throw Error('Unexpected GET '+url);
};
api.post=async(url,body)=>{writes.push({url,body});state.version++;
 if(url.endsWith('/evidence')){const f={id:'uploaded',evidenceId:'uploaded',category:'POD',source:'BILL',billIds:[body.get('billId')||'a'],originalName:'Fifth receipt.pdf',endpoint:'/uploaded'};files.push(f);failRead=true;return {data:f};}
 if(url.endsWith('/dispatch')){if('confirmed' in body)throw Error('BONRATE must not need confirmation');const doc={id:'bonrate',number:'BON-TEN',documentType:'BONRATE',rateType:state.works[0].rateType,receivedDate:'2026-01-01'};dispatches.push(doc);state.works[0].bonrateIssued=true;failRead=true;return {data:doc};}
 if(url.endsWith('/works')){const work={...structuredClone(body.work),id:'w',number:'BON-TEN',status:'DRAFT'};state.works=[work];failRead=true;return {data:work};}
 throw Error('Unexpected POST '+url);
};api.put=async(url,body)=>{writes.push({url,body});state.version++;state.works=[{...body.work,id:'w',number:'BON-TEN',status:'DRAFT'}];return {data:state.works[0]};};api.delete=async()=>{throw Error('Forbidden deletion');};
function Fixture(){const [aggregate,setAggregate]=useState(false);return <LanguageProvider initialLanguage="id"><MemoryRouter><AuthProvider><main className="p-4 md:p-6"><button onClick={()=>setAggregate(!aggregate)}>Switch scope</button>{aggregate?<AggregateManager journey={{id:'j',bills:[]}}/>:<BillManager bill={bill}/>}</main></AuthProvider></MemoryRouter></LanguageProvider>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('UI wait timed out');};
const button=(name,scope=document)=>[...scope.querySelectorAll('button')].find(n=>n.textContent.trim()===name),click=(name,scope=document)=>{const b=button(name,scope);if(!b||b.disabled)throw Error('Unavailable button '+name);b.click();};
const field=(name,scope=document)=>scope.querySelector('[aria-label="'+name+'"]');
const set=(name,value,scope=document)=>{const el=field(name,scope);if(!el)throw Error('Missing field '+name);const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));};
const checks=[],check=(ok,msg)=>{if(!ok)throw Error(msg);checks.push(msg);};const contained=()=>{const d=document.querySelector('[role=dialog]');check(document.documentElement.scrollWidth<=innerWidth+1,'page contained '+innerWidth);if(d){const r=d.getBoundingClientRect();check(r.left>=-1&&r.right<=innerWidth+1,'dialog contained '+innerWidth);}};
(async()=>{try{
 await wait(()=>button('Catat Bonrate')&&!button('Catat Bonrate').disabled);check(!document.querySelector('[data-driver-evidence-section]')&&!document.querySelector('input[type=file]'),'standalone bill evidence panel absent');click('Catat Bonrate');await wait(()=>field('Penerima'));
 const context=document.querySelector('[data-bonrate-context]'),identities=document.querySelector('[data-driver-identities]');
 const box=el=>el.getBoundingClientRect();
 check(context&&identities,'context and identity sections are separate');check([...field('Pilih sopir master').options].filter(o=>o.value).every(o=>o.textContent==='Driver')&&[...field('Pilih kendaraan master').options].filter(o=>o.value).every(o=>o.textContent==='PA 123'),'master options show name and plate only');
 if(innerWidth>=640){check(Math.abs(box(field('Kontainer')).top-box(field('Jenis angkutan')).top)<2,'container and transport aligned');check(Math.abs(box(field('Nama sopir')).top-box(field('Nomor plat')).top)<2,'manual identities aligned without empty grid cells');}
 const footer=document.querySelector('.modal-footer');check(footer.querySelectorAll('button')[0].textContent.trim()==='Tutup','close and save grouped in action order');
 check([...identities.querySelectorAll('small')].filter(n=>n.textContent.includes('Identitas manual')).length===1,'manual guidance is not duplicated');
 contained();
 const body=document.querySelector('.modal-body'),last=field('Catatan');body.scrollTop=body.scrollHeight;await new Promise(r=>requestAnimationFrame(r));
 check(last&&box(last).bottom<=box(footer).top+1&&box(last).top>=box(body).top,'last field scrolls fully above footer');body.scrollTop=0;
 if(location.search.includes('layout')){document.documentElement.dataset.scmuCheck=btoa(JSON.stringify({ok:true,checks}));return;}
 check(!field('Instruksi')&&!field('Lokasi pengambilan')&&!field('Nomor bukti serah terima'),'retired fields absent in selected editor');
 check(field('Tanggal diterima').value==='','planned child has no invented receipt');
 check(!field('Rute')&&!field('Kontainer serah terima'),'route and child container selectors removed');set('Nama sopir','Manual Driver');set('Nomor plat','PA 123 MANUAL');set('Jenis angkutan','TONASE');check(!button('Tambah barang')&&!button('Hapus barang'),'no add-goods button and sole goods row protected');check([...field('Rute pengantaran').options].every(o=>o.value!=='inactive'),'inactive destinations excluded');check(!field('Tanggal tugas'),'new flow is not scheduling');check(button('Simpan').disabled,'incomplete delivery cannot save');
 for(let i=1;i<10;i++){click('Tambah serah terima');await wait(()=>document.querySelectorAll('[data-driver-delivery]').length===i+1);}
 const children=[...document.querySelectorAll('[data-driver-delivery]')];
 for(let i=0;i<10;i++){set('Penerima','Recipient '+(i+1),children[i]);set('Tujuan pengantaran','Depot '+(i+1),children[i]);set('Master jenis barang (opsional)','rice',children[i]);set('Jenis colly','Sack',children[i]);set('Banyak colly','5',children[i]);set('Merek / pemilik','Owner '+(i+1),children[i]);set('Tanggal diterima','2026-01-01',children[i]);set('Nomor bukti serah terima (opsional)','SHARED-BST',children[i]);}
 set('Rute pengantaran','route',children[0]);await wait(()=>field('Tujuan pengantaran',children[0]).value==='Abepura, Papua');check(field('Tujuan pengantaran',children[0]).readOnly,'mapped destination snapshot read-only');
 check(children.every(c=>c.textContent.includes('Own receipt.pdf')&&!c.textContent.includes('Foreign receipt.pdf')),'child proof chooser excludes sibling BL');
 check(children.every(c=>!c.textContent.includes('Common journey.pdf')),'unsupported journey-common evidence excluded');contained();
 const dt=new DataTransfer();dt.items.add(new File(['%PDF-1.4'],'Fifth receipt.pdf',{type:'application/pdf'}));const upload=children[4].querySelector('input[type=file]');upload.files=dt.files;upload.dispatchEvent(new Event('change',{bubbles:true}));
 await wait(()=>document.querySelector('[role=dialog]').textContent.includes('Committed upload refresh failed'));
 const modal=document.querySelector('[role=dialog]');click('Muat ulang',modal);await wait(()=>field('Fifth receipt.pdf',modal));
 check([...modal.querySelectorAll('[data-driver-delivery]')].every((c,i)=>field('Fifth receipt.pdf',c).checked===(i===4)),'upload auto-associates fifth child only and survives failed refresh');check(writes.length===1,'refresh recovery never reuploads');
 check(!button('Simpan').disabled,'completed handovers save without evidence');check(!field('Berat per kemasan (kg, opsional)'),'weight input removed');field('Own receipt.pdf',children[0]).click();await wait(()=>!button('Simpan').disabled);contained();click('Simpan',modal);await wait(()=>!document.querySelector('[role=dialog]'));
 await wait(()=>document.querySelector('[role=alert]')?.textContent.includes('Committed upload refresh failed'));check(button('Catat Bonrate').disabled,'committed work save locks writes after failed read');click('Muat ulang');await wait(()=>!button('Catat Bonrate').disabled&&document.body.textContent.includes('BON-TEN'));check(writes.filter(w=>w.url.endsWith('/works')).length===1,'committed work recovery never resends write');
 const saved=writes.find(w=>w.url.endsWith('/works')).body.work;
 check(saved.deliveries.length===10&&saved.recordingPolicy==='POST_DELIVERY'&&saved.receivedDate==='2026-01-01'&&saved.routeId===null&&saved.deliveries.every(d=>d.containerNumber==='CONT-1')&&saved.deliveries[4].recipient==='Recipient 5','one parent saves ten completed owner deliveries with inherited container and no route');
 check(saved.billId==='a'&&saved.containerNumber==='CONT-1'&&saved.driverId===null&&saved.vehicleId===null&&saved.driverName==='Manual Driver'&&saved.vehicleNumber==='PA 123 MANUAL'&&saved.rateType==='TONASE'&&saved.deliveries[0].routeId==='route'&&saved.deliveries[0].destination==='Abepura, Papua','parent retains manual identities, TONASE and child master destination');
 check(saved.deliveries.every((d,i)=>d.items[0].goodsType==='Rice master'&&d.items[0].goodsTypeId==='rice'&&d.items[0].collyCount==='5'&&d.items[0].collyType==='Sack'&&d.items[0].owner==='Owner '+(i+1)&&!('label' in d.items[0])),'payload uses backend canonical goods contract without editor aliases');
 check(state.works.length===1&&document.querySelector('[data-bill-driver-operations]').textContent.includes('10/10 selesai'),'ten completed children remain one rit');
 check([...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Cetak / riwayat bonrate').length===1,'ten owners one print action');click('Cetak / riwayat bonrate');await wait(()=>document.querySelector('[data-driver-dispatch]'));
 check(document.querySelector('[data-driver-dispatch]').textContent.includes('Recipient 5'),'bonrate previews completed child');check(!document.querySelector('[data-driver-dispatch] input[type=checkbox]')&&!button('Cetak Bonrate').disabled,'completed draft prints directly without confirmation');check(document.querySelector('[data-driver-dispatch]').textContent.includes('HISTORICAL-PDF'),'historical PDF remains readable');contained();click('Tutup');
 state.works[0].deliveries[0].items[0].packageWeightKg='17.50';click('Switch scope');await wait(()=>document.querySelector('[data-driver-operations]'));check(!document.querySelector('input[type=file]'),'standalone aggregate upload absent');click('Ubah');await wait(()=>field('B/L serah terima'));
 check(!field('Instruksi')&&!field('Lokasi pengambilan')&&!field('Nomor bukti serah terima'),'retired fields absent in aggregate editor');
 check(field('B/L serah terima').options.length===3,'aggregate bills from GET used when journey prop omits bills');check(field('Common journey.pdf',document.querySelector('[data-driver-delivery]')),'aggregate receipt chooser retains journey uploads for reuse');contained();
 const aggregateChildren=[...document.querySelectorAll('[data-driver-delivery]')];check(field('Nama sopir').value==='Manual Driver'&&field('Nomor plat').value==='PA 123 MANUAL','manual identities survive reload in aggregate');set('Jenis angkutan','RBS');set('B/L serah terima','b',aggregateChildren[4]);await wait(()=>field('Foreign receipt.pdf',aggregateChildren[4]));
 check(!field('Own receipt.pdf',aggregateChildren[4]),'switching child BL clears and rescope proofs');check(!button('Simpan').disabled,'rescope does not require optional evidence');field('Foreign receipt.pdf',aggregateChildren[4]).click();await wait(()=>!button('Simpan').disabled);contained();click('Simpan',document.querySelector('[role=dialog]'));await wait(()=>!document.querySelector('[role=dialog]'));
 check(!field('Berat per kemasan (kg, opsional)')&&state.works[0].deliveries[0].items[0].packageWeightKg==='17.50','hidden historical weight survives editor save and reload');check(state.works.length===1&&state.works[0].deliveries[4].billId==='b'&&state.works[0].deliveries[4].evidenceFileIds[0]==='pb'&&state.works[0].driverId===null&&state.works[0].vehicleId===null&&state.works[0].rateType==='RBS'&&state.works[0].deliveries[0].routeId==='route','aggregate edits original shared work without cloning and replaces foreign association');
 check(!button('Ajukan')&&!button('Verifikasi')&&!button('Tolak'),'direct work has no approval actions');click('Cetak / riwayat bonrate');await wait(()=>document.querySelector('[data-driver-dispatch]'));check(!document.querySelector('[data-driver-dispatch] input[type=checkbox]')&&!button('Cetak Bonrate').disabled,'aggregate completed draft prints directly');click('Cetak Bonrate');await wait(()=>document.querySelector('[data-document-preview] a[download="BON-TEN.pdf"]'));check(document.querySelector('[data-document-preview] iframe')&&!button('Cetak Bonrate'),'one click opens saved PDF for print/download and prevents reissue');check(writes.filter(w=>w.url.endsWith('/dispatch')).length===1,'one immutable publication without approval or confirmation');click('Muat ulang',document.querySelector('[role=dialog]'));await wait(()=>!document.querySelector('[role=dialog] [role=alert]'));check(writes.filter(w=>w.url.endsWith('/dispatch')).length===1,'recovery reads without republishing');contained();click('Tutup');click('Switch scope');await wait(()=>document.querySelector('[data-bill-driver-operations]'));click('Cetak / riwayat bonrate');await wait(()=>document.querySelector('[data-driver-dispatch]'));check(!button('Cetak Bonrate'),'issued PDF reopens only as history');const historyRows=[...document.querySelectorAll('[data-driver-dispatch] tr')];const savedRow=historyRows.find(r=>r.textContent.includes('BON-TEN'));click('Lihat',savedRow);await wait(()=>document.querySelector('[data-document-preview] a[download="BON-TEN.pdf"]'));check(writes.filter(w=>w.url.endsWith('/dispatch')).length===1,'selected bill reprint never publishes again');click('Tutup');
 state.works[0].sharedWork=true;click('Switch scope');await wait(()=>document.querySelector('[data-driver-operations]'));click('Switch scope');await wait(()=>document.querySelector('[data-shared-driver-work]'));
 check(!button('Ubah',document.querySelector('[data-shared-driver-work]'))&&document.querySelector('[data-shared-driver-work] a'),'selected BL shared work read-only with aggregate editing link');contained();
 document.documentElement.dataset.scmuCheck=btoa(JSON.stringify({ok:true,checks}));
}catch(e){document.documentElement.dataset.scmuCheck=btoa(JSON.stringify({ok:false,checks,error:e.message}));}})();`;
const fixtureId=path.join(root,'frontend','__driver-deliveries-check.jsx').replaceAll('\\','/');
const server=await createServer({root:path.join(root,'frontend'),plugins:[{name:'driver-deliveries-fixture',resolveId(id){if(id==='/__driver-deliveries-check.jsx')return fixtureId;},load(id){if(id===fixtureId)return entry;},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(!req.url.startsWith('/__driver-deliveries-check.html'))return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__driver-deliveries-check.jsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0,hmr:false}});
const output=path.join(process.env.TMPDIR||path.join(root,'.demo'),'driver-deliveries-browser');await mkdir(output,{recursive:true});await new Promise(resolve=>server.httpServer.listen(0,'127.0.0.1',resolve));
if(process.env.SCMU_FIXTURE_SERVE){console.log('FIXTURE http://127.0.0.1:'+server.httpServer.address().port+'/__driver-deliveries-check.html');await new Promise(()=>{});}
try{for(const width of [1440,390]){const layout=await checkPage({chrome:process.env.SCMU_TEST_BROWSER||'/snap/bin/chromium',output,width,height:1000,url:'http://127.0.0.1:'+server.httpServer.address().port+'/__driver-deliveries-check.html?layout',screenshot:path.join(output,width+'-layout.png')});assert(layout.ok,width+': '+layout.error);console.log('LAYOUT '+width+': '+layout.checks.join('; '));const result=await checkPage({chrome:process.env.SCMU_TEST_BROWSER||'/snap/bin/chromium',output,width,height:1000,url:'http://127.0.0.1:'+server.httpServer.address().port+'/__driver-deliveries-check.html',screenshot:path.join(output,width+'.png')});assert(result.ok,width+': '+result.error+'; passed '+result.checks.join('; '));console.log('PASS '+width+': '+result.checks.join('; '));}}finally{await server.close();}

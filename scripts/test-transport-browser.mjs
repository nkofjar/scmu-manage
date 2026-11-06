import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {checkPage} from './browser-check.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(new URL('../frontend/package.json',import.meta.url)),{createServer}=require('vite');
process.chdir(path.join(root,'frontend'));
// All API transport is replaced; fixture writes never reach a live server.
const entry=`import React from 'react';
import {createRoot} from 'react-dom/client';
import App from '/src/App.jsx';
import api from '/src/api/client.js';
import '/src/index.css';
import '/src/styles/workspace.css';
const english=new URLSearchParams(location.search).get('language')==='en';
localStorage.setItem('scmu_language',english?'en':'id');localStorage.setItem('scmu_user',JSON.stringify({id:'fixture',name:'Fixture Admin',role:'ADMIN'}));
history.replaceState(null,'','/fleet-drivers');
const vehicle={id:'v1',registrationNo:'PA 123',type:'TRUCK',capacity:10,ownershipType:'OWN',companyId:'c',company:{name:'SCMU'},stnkExpiry:'2020-01-01',kirExpiry:null,isActive:true,version:1};
const driver={id:'d1',name:'Same Name',phone:'08123',licenseNo:'SIM-1',employmentType:'INTERNAL',companyId:'c',company:{name:'SCMU'},licenseExpiry:null,isActive:true,version:1};
const bill={id:'b',journeyId:'j',billNumber:'BL-FIXTURE',version:1,containers:[{id:'c1',number:'CONT-1',size:'20'}],files:[],registerData:{},workflow:{}};
const work={id:'w',billId:'b',number:'BON-FIXTURE',driverId:'d1',driverName:'Same Name',vehicleId:'v1',vehicleNumber:'PA 123',containerNumber:'CONT-1',size:'20',origin:'Port',destination:'Depot',taskDate:'2026-11-10',receivedDate:'',instructions:'Keep dry',rateType:'RB',status:'DRAFT',items:[],evidenceFileIds:[]};
const operations={version:1,works:[work],files:[],containers:bill.containers};let docs=[],dispatches=[],writes=[],failDispatchRead=false;
const options={drivers:[{...driver,companyName:'SCMU'},{...driver,id:'d2',companyName:'Vendor',employmentType:'VENDOR'}],vehicles:[{...vehicle,name:vehicle.registrationNo,companyName:'SCMU'}]};
const trip={id:'trip',journeyId:'j',journeyNumber:'J-FIXTURE',billId:'b',workId:'w',number:'BON-VERIFIED',driverId:'d1',driverName:'Same Name',employmentType:'INTERNAL',vehicleId:'v1',vehicleNumber:'PA 123',containerNumber:'CONT-1',size:'20',rateType:'RB',receivedDate:'2026-11-01',status:'VERIFIED',payrollId:'p1',payrollStatus:'APPROVED'};
api.get=async(url,config)=>{
 if(config?.responseType==='blob')return {data:new Blob(['%PDF-1.4\\nfixture PDF'],{type:'application/pdf'})};
 if(url.startsWith('/fleet?'))return {data:{data:[vehicle],page:1,limit:10,total:1}};
 if(url.startsWith('/drivers?'))return {data:{data:[driver],page:1,limit:10,total:1}};
 if(url==='/companies')return {data:{data:[{id:'c',name:'SCMU',isInternal:true,isActive:true},{id:'vendor',name:'Vendor',isInternal:false,isActive:true}],total:2}};
 if(url.endsWith('/documents'))return {data:{data:structuredClone(docs),version:vehicle.version}};
 if(url==='/journeys/driver-options')return {data:options};
 if(url.startsWith('/driver-trips?'))return {data:{period:'2026-11',page:1,limit:10,total:1,summary:[{key:'driver:d1',driverId:'d1',driverName:'Same Name',employmentType:'INTERNAL',rit20:1,rit40:0,ritOther:0,rb:1,rk:0,total:1,payrollLinked:1,payrollPending:0}],data:[trip]}};
 if(url==='/bl-register/b')return {data:bill};
 if(url==='/bl-register/b/driver-operations')return {data:operations};
 if(url.endsWith('/dispatches')){if(failDispatchRead){failDispatchRead=false;throw Error('Fixture read failed');}return {data:{data:structuredClone(dispatches)}};}
 return {data:{data:[],total:0}};
};
api.post=async(url,body)=>{
 if(url==='/fleet/v1/documents'){if(body.get('version')!==String(vehicle.version))throw Error('Missing version');writes.push(url);docs.push({id:'doc',originalName:'stnk.pdf',category:body.get('category')});vehicle.version++;return {data:{...docs.at(-1),version:vehicle.version}};}
 if(url.endsWith('/dispatch')){writes.push(url);const snapshot={...work,id:'dispatch',number:'ST-FIXTURE',documentType:body.documentType};dispatches.push(snapshot);failDispatchRead=true;operations.version++;return {data:snapshot};}
 throw Error('Unexpected fixture write: '+url);
};api.put=api.delete=async()=>{throw Error('Unexpected fixture mutation');};
createRoot(document.getElementById('root')).render(<App/>);
const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('UI wait timed out');};
const button=label=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===label),click=label=>{const b=button(label);if(!b||b.disabled)throw Error('Missing/enabled button: '+label);b.click();};
const checks=[],check=(ok,message)=>{if(!ok)throw Error(message);checks.push(message);};
const label=(id,en)=>english?en:id;
const field=name=>document.querySelector('[aria-label="'+name+'"]');
const overflow=()=>check(document.documentElement.scrollWidth<=innerWidth+1,'page contained at '+innerWidth);
(async()=>{try{
 await wait(()=>document.querySelector('[data-transport-masters] tbody')?.textContent.includes('PA 123'));
 check(document.querySelector('a[href="/driver-trips"]')&&document.querySelector('a[href="/fleet-drivers"]'),'App routes and sidebar expose one master and one trips entry');overflow();
 click(label('Tambah kendaraan','Add vehicle'));await wait(()=>document.querySelector('[role=dialog]'));
 check(field(label('Berlaku STNK','STNK expiry')).value===''&&field(label('Berlaku KIR','KIR expiry')).value==='','optional STNK KIR remain blank');overflow();click(label('Tutup','Close'));
 click(label('Dokumen','Documents'));await wait(()=>field(label('Pilih berkas','Choose file'))&&!field(label('Pilih berkas','Choose file')).disabled);
 const dt=new DataTransfer();dt.items.add(new File(['%PDF-1.4'],'stnk.pdf',{type:'application/pdf'}));field(label('Pilih berkas','Choose file')).files=dt.files;field(label('Pilih berkas','Choose file')).dispatchEvent(new Event('change',{bubbles:true}));
 await wait(()=>!button(label('Unggah','Upload')).disabled);click(label('Unggah','Upload'));await wait(()=>document.querySelector('[role=dialog] tbody')?.textContent.includes('stnk.pdf'));
 check(writes.length===1&&button(label('Unggah','Upload')).disabled,'versioned append-only document upload clears completed selection');overflow();click(label('Tutup','Close'));
 click(label('Sopir','Drivers'));await wait(()=>document.querySelector('[data-transport-masters] tbody')?.textContent.includes('Same Name'));click(label('Tambah sopir','Add driver'));await wait(()=>field(label('Berlaku SIM','Driving licence expiry')));check(field(label('Berlaku SIM','Driving licence expiry')).value==='','optional SIM expiry blank');click(label('Tutup','Close'));
 document.querySelector('a[href="/driver-trips"]').click();await wait(()=>document.querySelector('[data-driver-trips] tbody')?.textContent.includes('Same Name'));overflow();
 check(document.querySelector('[data-driver-trips]').textContent.includes('BON-VERIFIED'),'cross-journey verified rows and separate identity summary');
 check([...document.querySelectorAll('[data-driver-trips] tr')].some(r=>r.textContent.includes('BON-VERIFIED')&&r.textContent.includes(label('Disetujui, belum dibayar','Approved, unpaid'))),'linked payroll displays actual unpaid status');
 document.querySelector('a[href="/bl-register/b?tab=driver-bons"]').click();await wait(()=>button(label('Cetak / riwayat bonrate','Print / bonrate history')));overflow();
 check(document.querySelectorAll('[data-bill-driver-operations]').length===1,'one Bonrate manager for selected B/L');
 click(label('Ubah','Edit'));await wait(()=>field(label('Pilih sopir master','Select master driver')));check(!field('Nama sopir')&&!field('Nomor kendaraan'),'master assignment has no duplicate identity inputs');check(field(label('Pilih sopir master','Select master driver')).options.length===3,'same name masters retained as separate IDs');overflow();click(label('Tutup','Close'));
 const before=writes.length;click(label('Cetak / riwayat bonrate','Print / bonrate history'));await wait(()=>document.querySelector('[data-driver-dispatch]'));
 check(writes.length===before&&button(label('Terbitkan PDF','Issue PDF')).disabled,'preview never publishes and requires explicit confirmation');check(document.querySelector('[data-driver-dispatch]').textContent.includes('Keep dry'),'pre-receipt preview keeps assignment instructions');overflow();
 document.querySelector('[data-driver-dispatch] input[type=checkbox]').click();await wait(()=>!button(label('Terbitkan PDF','Issue PDF')).disabled);click(label('Terbitkan PDF','Issue PDF'));await wait(()=>document.querySelector('[data-driver-dispatch] tbody')?.textContent.includes('ST-FIXTURE'));
 check(!button(label('Terbitkan PDF','Issue PDF'))&&writes.length===before+1,'committed publish locks after history read failure');[...document.querySelectorAll('[data-driver-dispatch] button')].find(b=>b.textContent.trim()===label('Muat ulang','Reload')).click();await wait(()=>!document.querySelector('[data-driver-dispatch] [role=alert]'));check(writes.length===before+1,'retry only reads, never republishes');
 const view=[...document.querySelectorAll('[data-driver-dispatch] button')].find(b=>b.textContent.trim()===label('Lihat','View'));view.click();await wait(()=>document.querySelector('[data-document-preview] a[download="ST-FIXTURE.pdf"]'));check(writes.length===before+1,'reprint/download uses immutable saved PDF endpoint');overflow();
 document.documentElement.dataset.scmuCheck=btoa(JSON.stringify({ok:true,checks}));
}catch(e){document.documentElement.dataset.scmuCheck=btoa(JSON.stringify({ok:false,checks,error:e.message}));}})();`;
const fixtureId=path.join(root,'frontend','__transport-check.jsx').replaceAll('\\','/');
const server=await createServer({root:path.join(root,'frontend'),plugins:[{name:'transport-fixture',resolveId(id){if(id==='/__transport-check.jsx')return fixtureId;},load(id){if(id===fixtureId)return entry;},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(!req.url.startsWith('/__transport-check.html'))return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__transport-check.jsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0,hmr:false}});
const output=path.join(process.env.TMPDIR||path.join(root,'.demo'),'transport-browser');await mkdir(output,{recursive:true});await new Promise(resolve=>server.httpServer.listen(0,'127.0.0.1',resolve));
try{for(const [width,language]of [[1440,'id'],[390,'id'],[1440,'en'],[390,'en']]){const result=await checkPage({chrome:process.env.SCMU_TEST_BROWSER||'/snap/bin/chromium',output,width,height:1000,url:'http://127.0.0.1:'+server.httpServer.address().port+'/__transport-check.html?language='+language,screenshot:path.join(output,language+'-'+width+'.png')});assert(result.ok,language+' '+width+': '+result.error+'; passed '+result.checks.join('; '));console.log('PASS '+language+' '+width+': '+result.checks.join('; '));}}finally{await server.close();}

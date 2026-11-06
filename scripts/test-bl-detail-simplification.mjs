import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
process.env.NODE_ENV='production';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{MemoryRouter}=require('react-router-dom'),{createServer}=require('vite');
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.window={localStorage};
const server=await createServer({root:fileURLToPath(new URL('../frontend',import.meta.url)),server:{middlewareMode:true,hmr:false},appType:'custom'});
try {
 const {LanguageProvider}=await server.ssrLoadModule('/src/i18n/LanguageContext.jsx');
 const {default:Workspace}=await server.ssrLoadModule('/src/pages/BL/BLWorkspace.jsx');
 const bill={id:'a',version:1,billNumber:'BL-A',journeyId:'j',containers:[{number:'CONT-A',size:'20',seal:'SEAL-A'}],register:{},files:[]};
 const render=(tab='summary',currentBill=bill)=>renderToStaticMarkup(React.createElement(LanguageProvider,{initialLanguage:'id'},React.createElement(MemoryRouter,{initialEntries:[`/bl-register/a?tab=${tab}`]},React.createElement(Workspace,{bill:currentBill}))));
 const html=render();
 assert.equal((html.match(/role="tab"/g)||[]).length,4,'B/L has four primary job tabs, not a separate Documents tab');
 for(const tab of ['summary','checks','matching']) {
  const page=render(tab);
  assert(page.includes('data-bl-summary'),'legacy '+tab+' links keep summary accessible');
  assert(!page.includes('data-register-documents'),'Summary has no file managers');
  assert(!page.includes('Dokumen pendukung pengiriman'),'Summary has no generic supporting section');
  assert(page.includes('Batas waktu pelabuhan'),'port deadlines retain a named secondary control');

  const deadline=page.split('<summary>Batas waktu pelabuhan</summary>')[0].split('<details').at(-1);
  assert.equal(deadline.includes(' open=""'),['checks','matching'].includes(tab),'Legacy checks/matching open port deadlines');
 }
 for(const tab of ['documents','summary&supporting=1']) {
  const page=render(tab);
  assert(!page.includes('data-bl-summary'),'Legacy document destinations open Costs instead of rebuilding a summary document section');
  assert(page.includes('data-document-area="FINANCE"'),'Legacy links retain finance document access');
  assert(!page.includes('Unggah B/L'),'No B/L upload duplicated in legacy destinations');
 }
 console.log('PASS four B/L tabs, no summary document managers, legacy finance destinations and retained deadlines');
 const {default:Summary}=await server.ssrLoadModule('/src/pages/BL/BLSummary.jsx');
 const summaryBill={...bill,shipperName:'SENDER-A',consigneeName:'RECIPIENT-A',notifyPartyName:'NOTIFY-A',portOfLoading:'ORIGIN-A',portOfDischarge:'DESTINATION-A',grossWeightKg:0,register:{partyName:'VENDOR-A',cargoDescription:'CARGO-A',reference2:'INVOICE-A'},notes:'NOTE-A'};
 const summary=renderToStaticMarkup(React.createElement(LanguageProvider,{initialLanguage:'id'},React.createElement(MemoryRouter,null,React.createElement(Summary,{bill:summaryBill}))));
 for(const heading of ['Tagihan register','Dokumen pengiriman','Tindakan berikutnya','Bonrate Sopir','Kelengkapan berkas','Transkripsi Packing List'])assert(!summary.includes(heading),'Summary no longer duplicates '+heading);
 for(const value of ['BL-A','SENDER-A','RECIPIENT-A','NOTIFY-A','VENDOR-A','ORIGIN-A','DESTINATION-A','CONT-A','SEAL-A','CARGO-A','NOTE-A'])assert(summary.includes(value),'Summary retains '+value);
 assert(summary.includes('<dd>0</dd>'),'Known zero weight stays visible');
 assert.equal((summary.match(/<details/g)||[]).length,1,'Additional metadata is folded into one secondary section');
 assert(!summary.includes('INVOICE-A'),'Billing metadata belongs only in Costs');
 const costs=render('costs');assert(costs.includes('Tagihan register'),'Billing remains available in Costs');
 console.log('PASS concise identity/route/parties, containers, folded metadata and Costs-only billing');
 const {default:Progress}=await server.ssrLoadModule('/src/pages/BL/ShipmentProgress.jsx');
 const progress=renderToStaticMarkup(React.createElement(LanguageProvider,{initialLanguage:'id'},React.createElement(Progress,{bill:{workflow:{documents:'COMPLETE',sourcePrepared:true,field:'IN_PROGRESS'}}})));
 assert(progress.startsWith('<p '),'Global shipment progress is one compact status line, not three cards');
 assert(progress.includes('role="status"'),'Progress remains accessible as a status');
 for(const value of ['Dokumen utama','Lengkap sesuai kebutuhan','Rincian Packing List','Sudah diperiksa admin','Pekerjaan lapangan','Berjalan'])assert(progress.includes(value),'Compact progress retains '+value);
 assert(!progress.includes('class="card'),'No duplicate progress cards');
 assert.equal(renderToStaticMarkup(React.createElement(LanguageProvider,{initialLanguage:'id'},React.createElement(Progress,{bill:{}}))),'','Missing workflow remains absent');
 console.log('PASS one-line accessible shipment progress retaining all workflow states');
 assert(!/<input[^>]*type="file"/.test(html),'No upload form on summary');
 assert(!html.includes('Unggah B/L'),'No B/L upload in detail summary');
 for(const state of [{archived:true},{deleted:true,trash:{reason:'Read only'}}]) {
  const page=render('summary&supporting=1&edit=1',{...bill,...state,workflow:{documents:'COMPLETE',field:'COMPLETED'}});
  assert(!page.includes('Unggah B/L'),'Archived/deleted details do not restore B/L upload');
  assert(page.includes('data-document-area="FINANCE"'),'Read-only finance documents remain accessible');
  assert(!page.includes('role="dialog"'),'Archived/deleted edit links cannot open editor');
  if(state.deleted)assert(!page.includes('data-shipment-progress'),'Deleted B/L hides operational progress');
 }
 console.log('PASS removed B/L upload and archived/deleted read-only restrictions');
 const standalone=render('summary',{...bill,journeyId:null,archived:true});
 assert(standalone.includes('Berkas lama B/L tanpa pengiriman'),'Standalone archived bills retain secondary read-only file access');
 assert(!standalone.includes('data-register-documents'),'Standalone fallback is not a restored generic summary manager');
} finally {await server.close();delete globalThis.window;delete globalThis.localStorage;}

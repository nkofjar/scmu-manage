import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
process.env.NODE_ENV='production';
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{MemoryRouter}=require('react-router-dom'),{createServer}=require('vite');
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};globalThis.window={localStorage};
const server=await createServer({root:fileURLToPath(new URL('../frontend',import.meta.url)),server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
 const {LanguageProvider}=await server.ssrLoadModule('/src/i18n/LanguageContext.jsx');
 const render=(Component,props,language='id')=>renderToStaticMarkup(React.createElement(LanguageProvider,{initialLanguage:language},React.createElement(MemoryRouter,{initialEntries:['/bl-register/a?tab=packing']},React.createElement(Component,props))));
 const bill={id:'a',billNumber:'BL-A',journeyId:'journey',containers:[],registerData:{voyagePacking:{number:'RPL-KAPAL'}},documentAvailability:{internalPackingList:false},workflow:{documents:'COMPLETE',sourcePrepared:false,field:'NOT_STARTED'},files:[
  {id:'own',category:'PACKING_LIST',originalName:'PL-OWN.xlsx'},
  {id:'recap',category:'INTERNAL_PACKING_RECAP',originalName:'RPL-KAPAL.xlsx',note:'Rekap Packing List kapal; RPL-KAPAL'},
  {id:'shared',category:'PACKING_LIST',originalName:'PL-SHARED.xlsx',scope:{type:'SHARED',billIds:['a','b'],billNumbers:['BL-A','BL-B']}}
 ]};
 const {default:Workspace}=await server.ssrLoadModule('/src/pages/BL/BLWorkspace.jsx');
 const workspace=render(Workspace,{bill});
 assert(workspace.includes('Menampilkan data khusus B/L'),'Detail must declare B/L scope');
 assert(workspace.includes('Lihat pengiriman kapal'),'Journey remains an explicit parent link');
 const {default:Documents}=await server.ssrLoadModule('/src/pages/BL/RegisterDocuments.jsx');
 const docs=render(Documents,{bill,owner:'PACKING'});
 assert(docs.includes('PL-OWN.xlsx'),'Own original PL remains visible');
 assert(docs.includes('Dokumen bersama'),'Shared source is labelled');
 assert(docs.includes('Referensi rekap kapal'),'Voyage recap gets its own read-only reference section');
 const table=docs.split('data-voyage-references')[0];
 assert(!table.includes('RPL-KAPAL.xlsx'),'Voyage recap is not selectable as bill packing');
 assert(docs.includes('Rincian PL untuk B/L ini belum dipetakan'),'Shared original does not imply mapped contents');
 assert(!docs.includes('PDF tersedia untuk PL internal dan rekap kapal'),'Bill toolbar must not advertise voyage PDF');
 const {default:Progress}=await server.ssrLoadModule('/src/pages/BL/ShipmentProgress.jsx');
 assert(!render(Progress,{bill}).includes('Tersedia sebagai rekap'),'Voyage recap cannot complete bill packing');
 const english=render(Workspace,{bill},'en');
 assert(english.includes('Showing data for B/L only'),'Scope context is translated');
 const {BillDriverWorkTable}=await server.ssrLoadModule('/src/pages/BL/BillDriverOperations.jsx');
 const workTable=render(BillDriverWorkTable,{works:[{id:'own',number:'BON-A',containerNumber:'CONT-A',driverName:'SOPIR-A',status:'VERIFIED',rateType:'RB',items:[{owner:'PEMILIK-A',goodsType:'BERAS',collyCount:2,collyType:'KARUNG'}]}]});
 for(const text of ['BON-A','CONT-A','SOPIR-A','PEMILIK-A'])assert(workTable.includes(text),'B/L work missing '+text);
 assert(!workTable.includes('Pembayaran')&&!workTable.includes('Total upah'),'B/L view must not imply aggregate payroll ownership');
 const englishWorkTable=render(BillDriverWorkTable,{works:[]},'en');
 for(const [indonesian,english] of [['Tanggal diterima','Received date'],['Jenis angkutan','Transport type'],['Rincian barang','Goods details']]){
  assert(englishWorkTable.includes(english),'English driver work heading missing '+english);
  assert(!englishWorkTable.includes(indonesian),'English driver work heading remains Indonesian: '+indonesian);
  assert(workTable.includes(indonesian),'Indonesian driver work heading missing '+indonesian);
 }
 console.log('PASS B/L context, own/shared files, read-only voyage reference, scoped progress, driver work and English');
}finally{await server.close();delete globalThis.window;delete globalThis.localStorage;}

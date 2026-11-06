import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{MemoryRouter}=require('react-router-dom'),{createServer}=require('vite');
globalThis.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const server=await createServer({root:fileURLToPath(new URL('../frontend',import.meta.url)),server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
 const {LanguageProvider}=await server.ssrLoadModule('/src/i18n/LanguageContext.jsx');
 const {AuthProvider}=await server.ssrLoadModule('/src/context/AuthContext.jsx');
 const {JourneyBillActions}=await server.ssrLoadModule('/src/pages/Shipments/JourneyDetail.jsx');
 const render=(language,extra={})=>renderToStaticMarkup(React.createElement(LanguageProvider,{initialLanguage:language},React.createElement(MemoryRouter,null,React.createElement(AuthProvider,null,React.createElement(JourneyBillActions,{journey:{documentCount:2,data:{voyagePacking:{number:'RPL-CURRENT'}}},onRecap(){},...extra})))));
 const html=render('id');
 assert(html.indexOf('Unggah B/L')<html.indexOf('Buat Packing List Pengiriman'));assert(html.indexOf('Buat Packing List Pengiriman')<html.indexOf('Isi B/L manual'));
 assert(!html.includes('Rekapan B/L'),'recap belongs in each B/L row, not global actions');
 assert(!html.includes('RPL-CURRENT'));assert(!html.includes('recapFiles=1'));assert(!html.includes('legacyFiles=1'));assert(!html.includes('type="file"'));
 assert(render('en').includes('Create Shipment Packing List'));
 assert.match(render('id',{recapReason:'Lengkapi nomor B/L terlebih dahulu.'}),/disabled[^>]*title="Lengkapi nomor B\/L terlebih dahulu\."/);
 console.log('PASS shipment recap action beside upload with no saved-results section or archive links');
}finally{await server.close();delete globalThis.localStorage;}

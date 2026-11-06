import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const React=require('react'),{create,act}=require('react-test-renderer'),{MemoryRouter}=require('react-router-dom'),{createServer}=require('vite');
globalThis.document={body:{style:{}},documentElement:{},getElementById:()=>null,addEventListener(){},removeEventListener(){}};
globalThis.localStorage={getItem:()=>null,setItem(){}};globalThis.window={localStorage,location:{href:'http://localhost'},addEventListener(){},removeEventListener(){}};
const server=await createServer({root:fileURLToPath(new URL('../frontend/',import.meta.url)),server:{middlewareMode:true,hmr:false},appType:'custom'});
let mounted;const text=node=>typeof node==='string'?node:(node?.children||[]).map(text).join('');
try{
 const {LanguageProvider}=await server.ssrLoadModule('/src/i18n/LanguageContext.jsx');
 const {default:Trips}=await server.ssrLoadModule('/src/pages/Operations/DriverTrips.jsx');
 const {default:api}=await server.ssrLoadModule('/src/api/client.js');const calls=[];
 api.post=api.put=api.delete=()=>{throw Error('Read-only report must not write');};
 api.get=async url=>{calls.push(url);if(url==='/journeys/driver-options')return {data:{drivers:[{id:'d1',name:'Same Name'},{id:'d2',name:'Same Name'}],vehicles:[{id:'v1',name:'PA 123'}]}};return {data:{period:'2026-11',page:1,limit:10,total:2,summary:[{key:'d1',driverId:'d1',driverName:'Same Name',employmentType:'INTERNAL',rit20:1,rit40:0,rb:1,rk:0,total:1,payrollPending:1,payrollLinked:0},{key:'unmapped',driverId:null,driverName:'Same Name',employmentType:'UNKNOWN',rit20:0,rit40:1,rb:0,rk:1,total:1,payrollPending:0,payrollLinked:1}],data:[{id:'a',billId:'b',journeyId:'j',workId:'w',number:'BON-A',driverName:'Same Name',size:'20',rateType:'RB',receivedDate:'2026-11-01',status:'VERIFIED',payrollId:null},{id:'b',journeyId:'j2',workId:'w2',number:'BON-B',driverName:'Same Name',size:'40',rateType:'RK',receivedDate:'2026-11-02',status:'VERIFIED',payrollId:'p1',payrollStatus:'APPROVED'}]}};};
 await act(async()=>{mounted=create(React.createElement(LanguageProvider,{initialLanguage:'id'},React.createElement(MemoryRouter,null,React.createElement(Trips))));});
 assert(text(mounted.toJSON()).includes('BON-A'));assert(text(mounted.toJSON()).includes('Belum dipetakan'));assert(mounted.root.findAllByType('tr').some(r=>text(r).includes('BON-B')&&text(r).includes('Disetujui, belum dibayar')),'linked payroll row shows actual unpaid status, not selector text');
 const anchors=mounted.root.findAllByType('a');assert(anchors.some(a=>a.props.href==='/bl-register/b?tab=driver-bons'));assert(anchors.some(a=>a.props.href==='/shipments/j?tab=costs&operations=1'));
 const input=label=>mounted.root.findAll(n=>['input','select'].includes(n.type)&&n.props['aria-label']===label)[0];
 for(const [label,value]of [['Bulan','2026-10'],['Sopir','d2'],['Kepemilikan','VENDOR'],['Ukuran','40'],['Kendaraan','v1'],['Status upah','UNPAID']])await act(async()=>input(label).props.onChange({target:{value}}));
 const query=new URLSearchParams(calls.filter(c=>c.startsWith('/driver-trips?')).at(-1).split('?')[1]);for(const [key,value]of [['month','2026-10'],['driverId','d2'],['ownership','VENDOR'],['size','40'],['vehicleId','v1'],['payrollStatus','UNPAID'],['status','VERIFIED']])assert.equal(query.get(key),value);
 assert(!mounted.root.findAllByType('button').some(b=>/Tambah|Bayar|Buat rekap/.test(text(b))));
 const navigation=await server.ssrLoadModule('/src/components/Layout/navigation.mjs');
 for(const [path,label]of [['/fleet-drivers','Kendaraan & Sopir'],['/driver-trips','Ritase & Upah']]){assert.equal(navigation.localPage(path),true);assert.equal(navigation.pageLabel(path),label);}
 console.log('PASS read-only cross-journey verified report, server filters, separate identity summary, Bonrate and existing payroll links, navigation destinations');
}finally{if(mounted)await act(async()=>mounted.unmount());await server.close();}

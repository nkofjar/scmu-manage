import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const React=require('react'),{create,act}=require('react-test-renderer'),{MemoryRouter}=require('react-router-dom'),{createServer}=require('vite');
const ReactDOM=require('react-dom'),portal=ReactDOM.createPortal;ReactDOM.createPortal=c=>c;
globalThis.document={body:{style:{}},documentElement:{},getElementById:()=>null,addEventListener:()=>{},removeEventListener:()=>{}};
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};globalThis.window={localStorage,location:{href:'http://localhost'},addEventListener:()=>{},removeEventListener:()=>{}};
const server=await createServer({root:fileURLToPath(new URL('../frontend',import.meta.url)),server:{middlewareMode:true,hmr:false},appType:'custom'});let mounted;
try{
 const {LanguageProvider}=await server.ssrLoadModule('/src/i18n/LanguageContext.jsx');
 const {default:Manager,DeliveryOrderCell}=await server.ssrLoadModule('/src/pages/Shipments/BillDeliveryOrder.jsx');
 const {default:api}=await server.ssrLoadModule('/src/api/client.js');
 const bill={id:'a',billNumber:'BL-A',version:1,files:[],containers:[]};
 const mount=async(node,language='id')=>{if(mounted)await act(async()=>mounted.unmount());await act(async()=>{mounted=create(React.createElement(LanguageProvider,{initialLanguage:language},React.createElement(MemoryRouter,null,node)));});};
 const text=n=>typeof n==='string'?n:n?.children?.map(text).join('')||'';
 const button=label=>mounted.root.findAllByType('button').find(n=>text(n)===label);
 const click=async label=>{const b=button(label);assert(b,'Missing '+label);assert(!b.props.disabled,'Disabled '+label);await act(async()=>b.props.onClick());};
 const change=async(label,value)=>act(async()=>mounted.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
 let managed;await mount(React.createElement(DeliveryOrderCell,{bill,onManage:b=>managed=b}));await click('Unggah DO');assert.equal(managed.id,'a');
 let files=[],version=7,failRead=false,posts=[],refresh=0;
 api.get=async()=>{if(failRead)throw Error('read failed');return {data:{data:files,version}};};
 api.post=async(url,body)=>{posts.push({url,body});files=[{id:'do1',category:'DELIVERY_ORDER',originalName:'DO.pdf',createdAt:'2026-01-01',externalNumber:'DO-1',documentDate:'2026-01-01'}];version++;failRead=true;return {data:{data:files,version}};};
 await mount(React.createElement(Manager,{bill,onClose(){},onSaved:async()=>refresh++}));
 assert(button('Unggah DO').props.disabled,'file required');
 assert.equal(mounted.root.findAllByProps({'aria-label':'Nomor DO'}).length,0);
 assert.equal(mounted.root.findAllByProps({'aria-label':'Tanggal DO'}).length,0);
 assert(!text(mounted.toJSON()).includes('tidak berarti dokumen telah diverifikasi'),'no generic disclaimer');
 const file=new File(['%PDF-test'],'DO.pdf',{type:'application/pdf'});
 await act(async()=>mounted.root.findByProps({'aria-label':'File DO'}).props.onChange({target:{files:[file]}}));
 await click('Unggah DO');assert.equal(posts.length,1);assert.equal(posts[0].url,'/bl-register/a/files');assert.equal(posts[0].body.get('version'),'7');assert.equal(posts[0].body.get('category'),'DELIVERY_ORDER');assert.equal(posts[0].body.get('externalNumber'),null);assert.equal(posts[0].body.get('documentDate'),null);
 assert(button('Unggah DO')?.props.disabled||!button('Unggah DO'),'committed upload cannot be submitted again');
 failRead=false;await click('Muat ulang data');assert.equal(posts.length,1);assert(refresh>0);assert(JSON.stringify(mounted.toJSON()).includes('DO.pdf'));assert(text(mounted.toJSON()).includes('DO-1'),'existing metadata remains visible');
 // Append replacement while keeping history and do not treat upload as release verification.
 api.post=async(url,body)=>{posts.push({url,body});files=[{...files[0],id:'do2',originalName:'DO-revised.pdf',createdAt:'2026-02-01'},...files];version++;return {data:{data:files,version}};};
 await act(async()=>mounted.root.findByProps({'aria-label':'File DO'}).props.onChange({target:{files:[file]}}));
 await click('Ganti DO');
 assert.equal(posts.length,2);assert(JSON.stringify(mounted.toJSON()).includes('DO-revised.pdf'));assert(JSON.stringify(mounted.toJSON()).includes('DO.pdf'),'replacement keeps history');
 // Delete needs explicit selection and reason. Mutation commit followed by read failure is not retried.
 await click('Hapus DO');assert(button('Konfirmasi hapus DO').props.disabled);await change('Alasan penghapusan DO','Salah dokumen');
 api.post=async(url,body)=>{posts.push({url,body});files=files.filter(f=>f.id!==body.fileIds[0]);version++;failRead=true;return {data:{data:files,version}};};
 await click('Konfirmasi hapus DO');assert.equal(posts.length,3);assert.equal(posts[2].url,'/bl-register/a/files/delete');assert.deepEqual(posts[2].body.fileIds,['do2']);
 failRead=false;await click('Muat ulang data');assert.equal(posts.length,3);assert(!JSON.stringify(mounted.toJSON()).includes('DO-revised.pdf'));
 // Conflicts block resubmission until a read reload and a new selection.
 await act(async()=>mounted.root.findByProps({'aria-label':'File DO'}).props.onChange({target:{files:[file]}}));
 api.post=async()=>{throw {response:{status:409,data:{message:'stale version'}}};};await click('Ganti DO');assert(button('Ganti DO').props.disabled);await click('Muat ulang data');assert(button('Ganti DO').props.disabled);
 // A failed initial read can recover without reopening the manager.
 files=[];failRead=true;
 await mount(React.createElement(Manager,{bill,onClose(){},onSaved(){}}));
 failRead=false;await click('Muat ulang data');
 await act(async()=>mounted.root.findByProps({'aria-label':'File DO'}).props.onChange({target:{files:[file]}}));
 assert(!mounted.root.findByType('fieldset').props.disabled,'successful read recovery unlocks upload');
 // Read-only supports viewing but cannot upload/delete.
 files=[{id:'do1',category:'DELIVERY_ORDER',originalName:'DO.pdf'}];
 await mount(React.createElement(Manager,{bill,readonly:true,onClose(){},onSaved(){}}));assert(!mounted.root.findAllByType('input').some(n=>n.props.type==='file'));assert(!button('Hapus DO'));assert(button('Lihat DO'));
 await mount(React.createElement(DeliveryOrderCell,{bill,onManage(){}}),'en');assert(button('Upload DO'),'English DO action');
 console.log('PASS Delivery Order upload, replacement history, selected-B/L deletion, conflicts, read-only, English and refresh-only recovery');
}finally{if(mounted)await act(async()=>mounted.unmount());await server.close();ReactDOM.createPortal=portal;delete globalThis.window;delete globalThis.document;delete globalThis.localStorage;}

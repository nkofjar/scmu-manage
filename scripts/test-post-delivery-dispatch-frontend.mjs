import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const React=require('react'),{create,act}=require('react-test-renderer'),{MemoryRouter}=require('react-router-dom'),{createServer}=require('vite'),ReactDOM=require('react-dom');const portal=ReactDOM.createPortal;ReactDOM.createPortal=c=>c;
globalThis.document={body:{style:{}},documentElement:{},getElementById:()=>null,addEventListener(){},removeEventListener(){}};globalThis.localStorage={getItem:()=>null,setItem(){}};globalThis.window={localStorage,location:{href:'http://localhost'},addEventListener(){},removeEventListener(){}};
const server=await createServer({root:fileURLToPath(new URL('../frontend/',import.meta.url)),server:{middlewareMode:true,hmr:false},appType:'custom'});let mounted;
const text=n=>typeof n==='string'?n:(n?.children||[]).map(text).join('');
try{
 const {LanguageProvider}=await server.ssrLoadModule('/src/i18n/LanguageContext.jsx'),{default:Dispatch}=await server.ssrLoadModule('/src/pages/BL/DriverDispatch.jsx'),{default:api}=await server.ssrLoadModule('/src/api/client.js');
 for(const scope of ['bill','journey'])for(const status of ['DRAFT','SUBMITTED','REJECTED','VERIFIED']){
  const base=scope==='bill'?'/bl-register/b/driver-operations/works/w':'/journeys/j/driver-operations/works/w',calls=[],saved=[];let fail=false;
  api.get=async url=>{calls.push(['get',url]);if(url.endsWith('/pdf'))return {data:new Blob(['pdf'],{type:'application/pdf'})};if(fail){fail=false;throw Error('Read failed');}assert.equal(url,base+'/dispatches');return {data:{data:structuredClone(saved)}};};
  api.post=async(url,body)=>{calls.push(['post',url,body]);const doc={id:'doc',number:'BON-1',documentType:'BONRATE',receivedDate:'2026-01-01'};saved.push(doc);fail=true;return {data:doc};};
  const work={id:'w',recordingPolicy:'POST_DELIVERY',status,driverName:'Driver',vehicleNumber:'PA 123',containerNumber:'C1',number:'BON-1',rateType:scope==='bill'?'RB':'RK',receivedDate:'2026-01-01',deliveries:Array.from({length:10},(_,i)=>({billId:'b',containerNumber:'C1',recipient:'Recipient '+i,destination:'Depot',items:[{owner:'Owner '+i,goodsType:'Rice',collyType:'Sack',collyCount:1}],receivedDate:'2026-01-01',evidenceFileIds:[]}))};
  const props={...(scope==='bill'?{billId:'b'}:{journeyId:'j'}),version:4,work,onClose(){},onChanged:async()=>{throw Error('Parent refresh failed');}};
  const render=(extra={})=>React.createElement(LanguageProvider,{initialLanguage:'id'},React.createElement(MemoryRouter,null,React.createElement(Dispatch,{...props,...extra})));
  await act(async()=>{mounted=create(render());});
  const button=label=>mounted.root.findAllByType('button').find(n=>text(n).trim()===label);
  assert(text(mounted.toJSON()).includes('SURAT JALAN MOBIL / BONRATE '+work.rateType));
  assert(text(mounted.toJSON()).includes('2026-01-01'));assert(!text(mounted.toJSON()).includes('Terverifikasi diperlukan'),'printing requires no approval');
  const select=mounted.root.findAllByType('select').find(n=>n.props['aria-label']==='Jenis dokumen');assert.deepEqual(select.findAllByType('option').map(n=>n.props.value),['BONRATE']);
  assert.equal(mounted.root.findAllByType('input').filter(n=>n.props.type==='checkbox').length,0,'direct BONRATE has no confirmation checkbox');
  for(const extra of [{readonly:true},{work:{...work,status:'CANCELLED'}},{work:{...work,bonrateIssued:true}},{work:{...work,driverName:' '}},{work:{...work,vehicleNumber:''}},{work:{...work,deliveries:work.deliveries.map((d,i)=>i===9?{...d,receivedDate:''}:d)}},{work:{...work,deliveries:work.deliveries.map((d,i)=>i===9?{...d,containerNumber:'FOREIGN'}:d)}}]){
   await act(async()=>mounted.update(render(extra)));const issue=button('Cetak Bonrate');assert(!issue||issue.props.disabled,'readonly/cancelled/issued/incomplete identities or handovers cannot print');if(issue)await act(async()=>issue.props.onClick());assert.equal(calls.filter(c=>c[0]==='post').length,0,'handler also guards invalid publication');
  }
  await act(async()=>mounted.update(render()));
  assert.equal(button('Cetak Bonrate').props.disabled,false,'actual complete '+status+' work prints without taskDate');await act(async()=>button('Cetak Bonrate').props.onClick());
  assert.deepEqual(calls.find(c=>c[0]==='post').slice(1),[base+'/dispatch',{version:4,documentType:'BONRATE'}]);assert.equal(button('Cetak Bonrate'),undefined);
  assert(calls.some(c=>c[1]===base+'/dispatches/doc/pdf'),'issue automatically opens the real saved PDF');assert(mounted.root.findAllByType('iframe').length,'saved PDF preview visible');assert(mounted.root.findAllByType('a').some(n=>n.props.download==='BON-1.pdf'),'saved PDF downloadable');
  await act(async()=>button('Muat ulang').props.onClick());await act(async()=>button('Lihat').props.onClick());assert(calls.some(c=>c[1]===base+'/dispatches/doc/pdf'));assert.equal(calls.filter(c=>c[0]==='post').length,1);
  await act(async()=>mounted.unmount());await act(async()=>{mounted=create(render({work:{...work,status:'VERIFIED',bonrateIssued:true}}));});assert.equal(button('Cetak Bonrate'),undefined,'reopened saved output cannot publish again');assert(button('Lihat'),'history remains readable');
  await act(async()=>mounted.unmount());mounted=null;
 }
 console.log('PASS POST_DELIVERY scoped and aggregate BONRATE only, direct completed-status guard, no task date, ten recipients one immutable publication, history/reprint and refresh recovery');
}finally{if(mounted)await act(async()=>mounted.unmount());await server.close();ReactDOM.createPortal=portal;}

import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const React=require('react'),{create,act}=require('react-test-renderer'),{MemoryRouter}=require('react-router-dom'),{createServer}=require('vite');
const ReactDOM=require('react-dom'),portal=ReactDOM.createPortal;ReactDOM.createPortal=c=>c;
globalThis.document={body:{style:{}},documentElement:{},getElementById:()=>null,addEventListener(){},removeEventListener(){}};
globalThis.localStorage={getItem:()=>null,setItem(){}};
globalThis.window={localStorage,location:{href:'http://localhost'},addEventListener(){},removeEventListener(){}};
const server=await createServer({root:fileURLToPath(new URL('../frontend/',import.meta.url)),server:{middlewareMode:true,hmr:false},appType:'custom'});
let mounted;
const text=n=>typeof n==='string'?n:(Array.isArray(n)?n:n?.children||[]).map(text).join('');
try {
 const {LanguageProvider}=await server.ssrLoadModule('/src/i18n/LanguageContext.jsx');
 const {OperationalCosts}=await server.ssrLoadModule('/src/pages/BL/BLWorkspacePanels.jsx');
 const {default:JourneyCosts}=await server.ssrLoadModule('/src/pages/Shipments/JourneyCosts.jsx');
 const {default:api}=await server.ssrLoadModule('/src/api/client.js');
 for(const [kind,Component,props] of [
  ['bill',OperationalCosts,{bill:{id:'bill',version:4,files:[]}}],
  ['journey',JourneyCosts,{journey:{id:'journey',version:7,bills:[{id:'bill',billNumber:'BL-1'}]}}],
 ]) {
  let resolveTypes;const pendingTypes=new Promise(resolve=>{resolveTypes=resolve;});const writes=[];
  const history={id:'old-cost',description:'Saved historical expense',estimatedAmount:'100',status:'PROPOSED',tariffSnapshot:{operatingCostType:{id:'retired',code:'OLD',name:'Historical master name',defaultUnit:'HARI'}}};
  api.get=async url=>{
   if(url==='/operating-cost-types?limit=200')return pendingTypes;
   if(url.startsWith('/companies'))return {data:{data:[]}};
   return {data:{data:[history],costs:[history],approvedCost:'0'}};
  };
  api.post=async (url,body)=>{writes.push({url,body});return {data:{}};};
  await act(async()=>{mounted=create(React.createElement(LanguageProvider,{initialLanguage:'id'},React.createElement(MemoryRouter,null,React.createElement(Component,{...props,onChanged:async()=>{}}))));});
  const button=label=>mounted.root.findAllByType('button').find(n=>text(n).trim()===label);
  if(kind==='journey')await act(async()=>button('Tambah biaya').props.onClick());
  const field=label=>mounted.root.findAllByType('label').find(n=>text(n).startsWith(label))?.findAll(n=>n.type==='input'||n.type==='select')[0];
  const select=()=>mounted.root.findAllByType('select').find(n=>n.props['aria-label']==='Jenis biaya operasional');
  assert(select(),`${kind}: reachable expense editor has optional master selector`);
  await act(async()=>field('Uraian biaya').props.onChange({target:{value:'User entered description'}}));
  await act(async()=>field('Satuan').props.onChange({target:{value:'SHIFT'}}));
  await act(async()=>resolveTypes({data:{data:[{id:'forklift',code:'FORKLIFT',name:'Forklift',defaultUnit:'JAM',isActive:true},{id:'inactive',code:'OLD',name:'Disabled',defaultUnit:'JOB',isActive:false}]}}));
  assert.equal(field('Uraian biaya').props.value,'User entered description','async master load preserves entered description');
  assert.equal(field('Satuan').props.value,'SHIFT','async master load preserves entered unit');
  assert.equal(select().props.value,'','no automatic selection');
  assert(!select().findAllByType('option').some(n=>n.props.value==='inactive'),'inactive masters cannot be selected');
  assert(text(mounted.toJSON()).includes('Historical master name'),'history uses stored snapshot, even absent from active master list');
  assert.equal(writes.length,0,'loading and opening never creates costs');
  await act(async()=>select().props.onChange({target:{value:'forklift'}}));
  assert.equal(field('Uraian biaya').props.value,'User entered description','deliberate selection preserves entered description');
  assert.equal(field('Satuan').props.value,'SHIFT','deliberate selection preserves entered unit');
  await act(async()=>field('Uraian biaya').props.onChange({target:{value:''}}));
  await act(async()=>field('Satuan').props.onChange({target:{value:''}}));
  await act(async()=>select().props.onChange({target:{value:'forklift'}}));
  assert.equal(field('Uraian biaya').props.value,'Forklift');assert.equal(field('Satuan').props.value,'JAM');
  await act(async()=>select().props.onChange({target:{value:''}}));
  assert.equal(field('Uraian biaya').props.value,'Forklift','clearing identity does not erase editable values');
  assert.equal(field('Satuan').props.value,'JAM');
  await act(async()=>select().props.onChange({target:{value:'forklift'}}));
  await act(async()=>field('Harga satuan').props.onChange({target:{value:'250'}}));
  await act(async()=>field('Kategori').props.onChange({target:{value:'DRIVER_ALLOWANCE'}}));
  if(kind==='journey')await act(async()=>mounted.root.findByType('form').props.onSubmit({preventDefault(){}}));
  else await act(async()=>button('Ajukan biaya').props.onClick());
  assert.equal(writes.length,1);assert.equal(writes[0].body.operatingCostTypeId,'forklift');
  assert.equal(writes[0].body.costCategory,'DRIVER_ALLOWANCE','financial enum remains separate');
  assert.equal(writes[0].body.description,'Forklift');assert.equal(writes[0].body.unit,'JAM');
  assert.equal(writes[0].body.version,kind==='bill'?4:7);
  assert.equal(writes[0].url,kind==='bill'?'/bl-register/bill/operational-costs':'/journeys/journey/operational-costs');
  await act(async()=>mounted.unmount());mounted=null;
  console.log(`PASS ${kind} expense master selection, optional identity, late-load preservation, historical display, explicit submission`);
 }
} finally {if(mounted)await act(async()=>mounted.unmount());await server.close();ReactDOM.createPortal=portal;}

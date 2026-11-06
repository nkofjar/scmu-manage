import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const React=require('react'),{create,act}=require('react-test-renderer'),{createServer}=require('vite');
const server=await createServer({root:fileURLToPath(new URL('../frontend/',import.meta.url)),server:{middlewareMode:true,hmr:false},appType:'custom'});
globalThis.localStorage={getItem:()=>null,setItem(){}};globalThis.document={documentElement:{}};globalThis.window={location:{href:'http://localhost'},addEventListener(){},removeEventListener(){}};let mounted;
const text=n=>typeof n==='string'?n:(Array.isArray(n)?n:n?.children||[]).map(text).join('');
try{
 const {LanguageProvider}=await server.ssrLoadModule('/src/i18n/LanguageContext.jsx');const {default:Fields}=await server.ssrLoadModule('/src/pages/BL/DriverAssignmentFields.jsx');
 const {default:api}=await server.ssrLoadModule('/src/api/client.js');api.get=async()=>({data:{data:[]}});
 const options={drivers:[{id:'d1',name:'Same',companyName:'SCMU',employmentType:'INTERNAL',licenseExpiry:'2020-01-01'},{id:'d2',name:'Same',companyName:'Vendor',employmentType:'VENDOR'}],vehicles:[{id:'v1',name:'PA 123',kirExpiry:'2020-01-01'}]};let form={driverName:'Legacy',driverId:null},changes=[];
 const render=()=>React.createElement(LanguageProvider,{initialLanguage:'id'},React.createElement(Fields,{form,options,onChange:(key,value)=>{changes.push([key,value]);form={...form,[key]:value};}}));
 await act(async()=>{mounted=create(render());});assert.equal(mounted.root.findAllByType('input').filter(n=>n.props.type==='text').length,0,'one master selector instead of duplicate name input');
 const driver=()=>mounted.root.findAllByType('select')[0];assert(driver().findAllByType('option').some(n=>text(n).includes('d1')&&text(n).includes('SCMU')),'same-name drivers distinguish identity');
 await act(async()=>driver().props.onChange({target:{value:'d1'}}));await act(async()=>mounted.update(render()));assert.deepEqual(changes.slice(0,2),[['driverId','d1'],['driverName','Same']]);
 assert(text(mounted.toJSON()).includes('2020-01-01'));assert(text(mounted.toJSON()).includes('Kedaluwarsa'),'expiry is visible and never invented');
 await act(async()=>driver().props.onChange({target:{value:''}}));assert.equal(form.driverId,null);assert.equal(form.driverName,'Same','unmapping preserves snapshot without auto matching by name');
 form={driverId:'d2',driverName:'Same',compliance:{driver:{licenseExpiry:'2020-01-01'}}};await act(async()=>mounted.update(render()));assert(!text(mounted.toJSON()).includes('2020-01-01'),'new master with unknown expiry cannot inherit previous snapshot date');
 console.log('PASS identity-only assignment, legacy snapshot preservation, expiry warnings and unknown expiry after remapping');
}finally{if(mounted)await act(async()=>mounted.unmount());await server.close();}

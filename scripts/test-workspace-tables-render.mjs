import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));process.env.NODE_ENV='production';
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{MemoryRouter}=require('react-router-dom'),{createServer}=require('vite');
const server=await createServer({root:fileURLToPath(new URL('../frontend',import.meta.url)),server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
 const {LanguageProvider}=await server.ssrLoadModule('/src/i18n/LanguageContext.jsx');
 const {DataTable}=await server.ssrLoadModule('/src/components/jpt/Workspace.jsx');
 const render=props=>renderToStaticMarkup(React.createElement(LanguageProvider,{initialLanguage:'id'},React.createElement(MemoryRouter,null,React.createElement(DataTable,props))));
 const rows=Array.from({length:5},(_,index)=>({id:'r'+index,name:'Data '+index}));
 const html=render({rows,columns:[{key:'name',label:'Nama'},{key:'action',label:'Jenis aksi',render:()=> 'DATA_AKSI'},{key:'actions',label:'Tindakan',render:()=>React.createElement('button',null,'UBAH_DATA')}],columnGroups:[{label:'Identitas',keys:['name','action','actions']}],pagination:{server:true,total:25,page:3,limit:10,onPageChange:()=>{},onLimitChange:()=>{}}});
 assert.deepEqual([...html.matchAll(/data-column="__rowNumber"[^>]*>(\d+)</g)].map(m=>Number(m[1])),[21,22,23,24,25]);
 assert(html.includes('data-table-toolbar'));assert(!html.includes('data-column="actions"'));assert(html.includes('DATA_AKSI'),'Action data column must not be mistaken for action buttons');
 assert(html.includes('colSpan="2"'),'Selection and numbering must align grouped headers');
 const existing=render({rows:rows.map((row,index)=>({...row,rowNumber:index+1})),columns:[{key:'rowNumber',label:'No.'},{key:'name',label:'Nama'}]});
 assert.equal((existing.match(/>No\.<\/th>/g)||[]).length,1,'Do not duplicate existing numbering');
 const all=render({rows,columns:[{key:'name',label:'Nama'}],pagination:false});
 assert.deepEqual([...all.matchAll(/data-column="__rowNumber"[^>]*>(\d+)</g)].map(m=>Number(m[1])),[1,2,3,4,5]);
 const empty=render({rows:[],columns:[{key:'name',label:'Nama'},{key:'actions',label:'Tindakan',render:()=>null}]});assert(empty.includes('colSpan="3"'));
 const inline=render({rows,actionPlacement:'row',columns:[{key:'name',label:'Nama'},{key:'actions',label:'Tindakan',items:[{key:'view',label:'Detail',href:row=>'/record/'+row.id}]}]});
 assert(!inline.includes('data-table-toolbar'));assert(!inline.includes('data-column="__selection"'));
 assert.equal((inline.match(/data-column="actions"/g)||[]).length,5);assert(inline.includes('href="/record/r0"')&&inline.includes('href="/record/r4"'));
 const conditional=render({rows,actionPlacement:'row',columns:[{key:'name',label:'Nama'},{key:'actions',label:'Tindakan',items:[{key:'verify',label:'VERIFY_ONLY_R0',hidden:r=>r.id!=='r0',onClick:()=>{}}]}]});
 assert.equal((conditional.match(/VERIFY_ONLY_R0/g)||[]).length,1,'Only eligible rows show status-specific actions');
 console.log('PASS server-page ordinals, existing No. deduplication, non-paginated numbering, grouped header alignment, empty rows and action/data separation');
}finally{await server.close();}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import DocumentBatch from './DocumentBatch';
import VoyagePacking from './VoyagePacking';
import ShipmentTrashDialog from './ShipmentTrashDialog';
import { useAuth } from '../../context/AuthContext';
import { PageHeader, Button, Modal } from '../../components/common';
import { DataTable, Notice, usePagedResource } from '../../components/jpt/Workspace';
import { usePageQuery } from '../../components/Layout/PageNavigation';
import { useBL } from '../../i18n/bl.mjs';
import { formatDate } from '../../utils/format.mjs';
import { isRegisterArchived, isRegisterDeleted, registerDocumentAvailability } from './registerModel.mjs';

export const registerFilters = ['search','month','vessel','voyage','vesselId','voyageId','vesselExact','voyageExact','voyageMissing','port','company','dateFrom','dateTo','documents','archived','sort','direction'];
export const registerStats = [['totalRegisters','Total B/L'],['periodRegisters','B/L periode ini'],['missingBL','File B/L belum tersedia'],['missingPackingList','PL perlu tindakan'],['incompleteRegisters','B/L perlu dilengkapi']];

export function RegisterStats({summary={},loading=false,compact=false}) {
 const {t}=useBL();
 if(compact)return <><div className="grid sm:grid-cols-3 gap-3">
  {[['totalRegisters','Total B/L'],['missingBL','File B/L belum tersedia'],['incompleteRegisters','Perlu dilengkapi']].map(([key,label])=><div key={key} className="card px-4 py-3 flex items-center justify-between gap-4"><div><p className="text-xs text-zinc-400">{t(label)}</p><p className="text-2xl tabular-nums mt-1">{loading?'…':summary[key]??'—'}</p></div>{key==='totalRegisters'&&<p className="text-xs text-zinc-500 text-right">{t('Periode ini')}:<br/><span className="text-zinc-300 tabular-nums">{summary.periodRegisters??'—'}</span></p>}{key==='incompleteRegisters'&&<p className="text-xs text-zinc-500 text-right">{t('PL perlu tindakan')}:<br/><span className="text-zinc-300 tabular-nums">{summary.missingPackingList??'—'}</span></p>}</div>)}
 </div><div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-500" aria-label={t('Perhatian operasional')}>{[['deadlineAlerts','Tenggat storage/demurrage'],['fieldInspectionPending','PL belum diperiksa lapangan']].map(([key,label])=><span key={key}>{t(label)}: <strong className={summary[key]>0?'text-amber-300':'text-zinc-400'}>{loading?'—':summary[key]??'—'}</strong></span>)}</div></>;
 return <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">{registerStats.map(([key,label])=><div key={key} className="card p-4"><p className="text-xs text-zinc-400">{t(label)}</p><p className="text-2xl tabular-nums mt-2">{loading?'…':summary[key]??'—'}</p></div>)}</div>;
}

export default function BLRegister({trash=false}) { return <UnifiedRegister key={trash?'trash':'active'} trash={trash}/>; }

function UnifiedRegister({trash=false}) {
 const {t,locale}=useBL();const {user}=useAuth();const [params,setQuery]=usePageQuery();const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [advancedOpen,setAdvancedOpen]=useState(false);const [exportOpen,setExportOpen]=useState(false);const [draft,setDraft]=useState({});const [archiving,setArchiving]=useState(null);const [voyagePacking,setVoyagePacking]=useState(false);
 const [trashAction,setTrashAction]=useState(null);const [success,setSuccess]=useState('');
 const filters={...Object.fromEntries(registerFilters.map(key=>[key,params.get(key)||({documents:'ALL',archived:'active',sort:'createdAt',direction:'desc'}[key]||'')])),...(trash?{archived:'trash'}:{})};
 const resource=usePagedResource('/bl-register',filters);const filter=(key,value)=>setQuery({[key]:value,page:null});
 const advancedKeys=['vessel','voyage','port','company','dateFrom','dateTo',...(!trash?['archived']:[])];
 const openAdvanced=()=>{setDraft(Object.fromEntries(advancedKeys.map(key=>[key,filters[key]])));setAdvancedOpen(true);};
 const applyAdvanced=()=>{setQuery({...draft,page:null});setAdvancedOpen(false);};
 const clearAll=()=>setQuery(Object.fromEntries([...registerFilters.map(key=>[key,null]),['page',null]]));
 const exportFile=async scope=>{setBusy(true);setError('');try{const query=new URLSearchParams({scope,...(scope==='filtered'?filters:{archived:filters.archived})});const response=await api.get(`/bl-register/export.xlsx?${query}`,{responseType:'blob'});const href=URL.createObjectURL(response.data);const anchor=document.createElement('a');anchor.href=href;anchor.download=`register-${scope}.xlsx`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(href),1000);}catch(error){let message=error.response?.data?.message||error.message;if(error.response?.data instanceof Blob){try{message=JSON.parse(await error.response.data.text()).message||message;}catch{/* Keep the transport error if the server did not return JSON. */}}setError(t('Ekspor gagal.')+' '+message);}finally{setBusy(false);}};
 const archive=async row=>{setBusy(true);setError('');try{await api.post(`/bl-register/${row.id}/archive`,{version:row.version,archived:!isRegisterArchived(row)});await api.get(`/bl-register/${row.id}`);resource.reload();setArchiving(null);}catch(error){setError(error.response?.data?.message||error.message);}finally{setBusy(false);}};
 const summaryColumns=[
  {key:'billNumber',label:'B/L & Mitra',primary:true,width:'23%',render:row=><><Link className="text-brand-400 font-semibold break-words" to={`/bl-register/${row.id}`}>{row.billNumber||t('B/L belum tersedia')}</Link><p className="table-subtext">{row.register?.partyName||'—'}</p>{isRegisterArchived(row)&&<span className="table-pill">{t('Diarsipkan')}</span>}</>},
  {key:'vesselName',label:'Kapal & Voyage',width:'19%',render:row=><><span>{row.vesselName||'—'}</span><p className="table-subtext">{t('Voyage')}: {row.voyageNumber||'—'}</p></>},
  {key:'route',label:'Rute',width:'16%',render:row=><><span>{row.portOfLoading||'—'}</span><p className="table-subtext">→ {row.portOfDischarge||'—'}</p></>},
  {key:'containers',label:'Kontainer',width:'12%',render:row=><ContainerCount row={row} t={t}/>},
  {key:'dates',label:'Keluar / Masuk',width:'15%',render:row=><><p>{row.register?.departureDate?formatDate(row.register.departureDate,locale):'—'}</p><p className="table-subtext">{row.register?.arrivalDate?formatDate(row.register.arrivalDate,locale):'—'}</p></>},
  {key:'documents',label:'Dokumen',width:'15%',render:row=>{const flags=registerDocumentAvailability(row);return <Link className="flex flex-wrap gap-1" aria-label={`${t('Dokumen')} ${row.billNumber}`} to={`/bl-register/${row.id}?tab=summary`}>{[['B/L',flags.billOfLading],['PL',flags.packingList]].map(([label,ready])=><span key={label} className={`table-pill ${ready?'table-pill-ready':'table-pill-pending'}`}>{label}: {t(ready?'Ada':'Belum ada')}</span>)}</Link>;}},
  {key:'actions',label:'Tindakan',width:160,items:[
   {key:'view',label:'Detail',href:row=>`/bl-register/${row.id}`},
   ...(!trash?[{key:'edit',label:'Ubah',href:row=>`/bl-register/${row.id}?tab=identity`,disabled:row=>isRegisterArchived(row)||busy}]:[]),
   ...(['SUPER_ADMIN','ADMIN'].includes(user?.role)?(trash?[{key:'restore',label:'Pulihkan',disabled:()=>busy,onClick:row=>setTrashAction({row,restore:true})}]:[{key:'archive',label:row=>row&&isRegisterArchived(row)?'Pulihkan':'Arsipkan',variant:'ghost',disabled:()=>busy,onClick:row=>{setError('');setArchiving(row);}},{key:'delete',label:'Hapus',variant:'danger',disabled:()=>busy,onClick:row=>setTrashAction({row,restore:false})}]):[]),
  ]},
 ];
 const sortValue=`${filters.sort}:${filters.direction}`;const sortOptions=[['createdAt:desc','Terbaru'],['createdAt:asc','Terlama'],['billNumber:asc','Nomor B/L A–Z'],['vesselName:asc','Kapal A–Z'],['registerAmount:desc','Nominal terbesar']];
 const documentOptions=[['ALL','Semua dokumen'],['BL_MISSING','B/L belum tersedia'],['PACKING_MISSING','Packing List belum tersedia'],['COMPLETE','Dokumen lengkap']];
 const chipDefs=[['search','Pencarian'],['month','Bulan'],['documents','Dokumen'],['vessel','Kapal'],['voyage','Voyage'],['port','Pelabuhan asal'],['company','Perusahaan'],['dateFrom','Dari'],['dateTo','Sampai'],['archived','Arsip']];
 const activeChips=chipDefs.filter(([key])=>(!trash||key!=='archived')&&filters[key]&&!(key==='documents'&&filters[key]==='ALL')&&!(key==='archived'&&filters[key]==='active')).map(([key,label])=>({key,label,value:key==='documents'?documentOptions.find(([value])=>value===filters[key])?.[1]||filters[key]:filters[key]}));
 const advancedCount=advancedKeys.filter(key=>filters[key]&&!(key==='archived'&&filters[key]==='active')).length;
 return <div className="space-y-5" data-bl-register>
  <PageHeader className="flex-col gap-4 xl:flex-row" title={t(trash?'Sampah pengiriman':'Pengiriman')} subtitle={t(trash?'Pengiriman yang dihapus tetap menyimpan dokumen dan riwayat, serta dapat dipulihkan.':'Kelola dokumen, kontainer, dan operasional setiap pengiriman.')} action={<div className="flex flex-wrap gap-2">{trash?<Link className="btn btn-secondary px-4 py-2 rounded-lg text-sm" to="/bl-register">{t('Kembali ke Pengiriman')}</Link>:<><Link className="btn btn-secondary px-4 py-2 rounded-lg text-sm" to="/bl-register/trash">{t('Sampah')}</Link><DocumentBatch onSaved={()=>resource.reload()}/></>}</div>}/>
  {voyagePacking&&<VoyagePacking filters={filters} onClose={()=>setVoyagePacking(false)} onSaved={()=>resource.reload()}/>}
  {trash?<p className="card p-4 text-sm">{resource.pagination?.total??resource.data?.total??0} {t('pengiriman di Sampah')}</p>:<RegisterStats summary={resource.data?.summary} loading={resource.loading} compact/>}
  {success&&<p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-500">{t(success)} {!trash&&<Link className="underline" to="/bl-register/trash">{t('Buka Sampah')}</Link>}</p>}
  <div className="card p-3 space-y-3">
   <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1fr)_10rem_13rem_auto] items-end">
    <label className="min-w-0 sm:col-span-2 xl:col-span-1"><span className="block text-xs text-zinc-500 mb-1">{t('Pencarian')}</span><input className="input-field" aria-label={t('Cari B/L, kapal, vendor, invoice')} type="search" placeholder={t('Cari B/L, kapal, vendor, invoice')} value={filters.search} onChange={event=>filter('search',event.target.value)}/></label>
    <label><span className="block text-xs text-zinc-500 mb-1">{t('Bulan')}</span><input className="input-field" aria-label={t('Bulan')} type="month" value={filters.month} onChange={event=>filter('month',event.target.value)}/></label>
    <label><span className="block text-xs text-zinc-500 mb-1">{t('Kelengkapan dokumen')}</span><select className="input-field" aria-label={t('Kelengkapan dokumen')} value={filters.documents} onChange={event=>filter('documents',event.target.value)}>{documentOptions.map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></label>
    <Button variant="secondary" className="whitespace-nowrap" onClick={openAdvanced}>{t('Filter lainnya')}{advancedCount>0&&<span className="rounded-full bg-brand-500 px-2 py-0.5 text-xs text-white">{advancedCount}</span>}</Button>

   </div>
   {activeChips.length>0&&<div className="flex flex-wrap items-center gap-2" aria-label={t('Filter aktif')}>{activeChips.map(chip=><button key={chip.key} type="button" className="rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs text-brand-200 hover:bg-brand-500/20" onClick={()=>filter(chip.key,chip.key==='archived'?'active':chip.key==='documents'?'ALL':'')}>{t(chip.label)}: {t(chip.value)} ×</button>)}<button type="button" className="px-2 py-1 text-xs text-zinc-400 hover:text-white" onClick={clearAll}>{t('Hapus semua')}</button></div>}
  </div>
  <details className="text-xs text-zinc-400"><summary className="cursor-pointer select-none hover:text-zinc-200">{t('Tentang data register dan ekspor')}</summary><p className="mt-2 max-w-4xl leading-5">{t('Excel memuat seluruh hasil, bukan hanya halaman ini. Kebutuhan Packing List mengikuti aturan mitra. Jumlah manual terpisah dari kontainer dan kolom 21 masih perlu dikonfirmasi.')}</p></details>
  <Notice message={error||resource.error}/>
  <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-zinc-500">{t('Klik nomor B/L untuk melihat seluruh informasi pengiriman.')}</p><div className="flex flex-wrap items-center gap-2"><span className="text-xs text-zinc-500">{t('Urutan')}</span>
    <label><span className="sr-only">{t('Urutan')}</span><select className="input-field" aria-label={t('Urutan')} value={sortValue} onChange={event=>{const [sort,direction]=event.target.value.split(':');setQuery({sort,direction,page:null});}}>{sortOptions.map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></label>
    {!trash&&<><Button variant="secondary" onClick={()=>setVoyagePacking(true)}>{t('Buat Packing List Pengiriman')}</Button>
    <Button variant="secondary" disabled={busy} onClick={()=>setExportOpen(true)}>{t('Ekspor')}</Button></>}
  </div></div>
  <div data-register-table data-register-view="summary"><DataTable columns={trash?[summaryColumns[0],summaryColumns[1],{key:'deletedAt',label:'Tanggal dihapus',render:row=>formatDate(row.trash?.deletedAt,locale)},{key:'deletedBy',label:'Dihapus oleh',render:row=>row.trash?.deletedByName||'—'},{key:'deleteReason',label:'Alasan penghapusan',render:row=><span className="break-words">{row.trash?.reason||'—'}</span>},summaryColumns.at(-1)]:summaryColumns} rows={resource.rows} pagination={resource.pagination} actionPlacement="row" mobileCards empty={trash?'Sampah pengiriman kosong.':'Belum ada pengiriman sesuai filter.'} emptyAction={activeChips.length>0?<Button variant="secondary" onClick={clearAll}>{t('Hapus filter')}</Button>:undefined}/></div>
  {trashAction&&<ShipmentTrashDialog key={trashAction.row.id} {...trashAction} onClose={()=>setTrashAction(null)} onDone={row=>{setSuccess(isRegisterDeleted(row)?'Pengiriman dipindahkan ke Sampah.':isRegisterArchived(row)?'Pengiriman dipulihkan ke arsip.':'Pengiriman dipulihkan ke daftar aktif.');resource.reload();}} onArchive={row=>{setTrashAction(null);setArchiving(row);}}/>}
  <Modal open={exportOpen} onClose={()=>!busy&&setExportOpen(false)} title={t('Ekspor pengiriman')} width="max-w-lg"><p className="text-sm text-zinc-400 mb-4">{t('Ekspor selalu memuat seluruh kolom data, sesuai cakupan yang dipilih.')}</p><div className="grid gap-3"><Button variant="secondary" disabled={busy||resource.loading} onClick={()=>{setExportOpen(false);exportFile('filtered');}}>{t('Ekspor hasil filter')}</Button><Button variant="secondary" disabled={busy} onClick={()=>{setExportOpen(false);exportFile('all');}}>{t('Ekspor seluruh register')}</Button></div></Modal>
  <Modal open={!!archiving} onClose={()=>!busy&&setArchiving(null)} title={t(archiving&&isRegisterArchived(archiving)?'Pulihkan pengiriman':'Arsipkan pengiriman')} width="max-w-lg" footer={<div className="flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={()=>setArchiving(null)}>{t('Batal')}</Button><Button disabled={busy} onClick={()=>archive(archiving)}>{t(busy?'Saving...':archiving&&isRegisterArchived(archiving)?'Pulihkan':'Arsipkan')}</Button></div>}><p className="font-semibold break-words mb-3">{archiving?.billNumber}</p><p className="text-sm text-zinc-400">{t(archiving&&isRegisterArchived(archiving)?'Pengiriman akan kembali ke daftar aktif.':'Pengiriman dipindahkan ke arsip. Data, transaksi, dan dokumen tetap tersimpan.')}</p><Notice message={error}/></Modal>
  <Modal open={advancedOpen} onClose={()=>setAdvancedOpen(false)} title={t('Filter lainnya')} width="max-w-3xl" footer={<div className="flex flex-wrap justify-between gap-3"><Button variant="ghost" onClick={()=>setDraft({vessel:'',voyage:'',port:'',company:'',dateFrom:'',dateTo:'',archived:'active'})}>{t('Reset')}</Button><div className="flex gap-2"><Button variant="secondary" onClick={()=>setAdvancedOpen(false)}>{t('Batal')}</Button><Button onClick={applyAdvanced}>{t('Terapkan filter')}</Button></div></div>}><div className="grid sm:grid-cols-2 gap-4">{[['vessel','Kapal','text'],['voyage','Voyage','text'],['port','Pelabuhan asal','text'],['company','Perusahaan','text'],['dateFrom','Tanggal dibuat dari','date'],['dateTo','Tanggal dibuat sampai','date']].map(([key,label,type])=><label className="space-y-1" key={key}><span className="text-sm text-zinc-300">{t(label)}</span><input className="input-field" aria-label={t(label)} type={type} value={draft[key]||''} onChange={event=>setDraft(value=>({...value,[key]:event.target.value}))}/></label>)}{!trash&&<label className="space-y-1 sm:col-span-2"><span className="text-sm text-zinc-300">{t('Arsip')}</span><select className="input-field" aria-label={t('Arsip')} value={draft.archived||'active'} onChange={event=>setDraft(value=>({...value,archived:event.target.value}))}><option value="active">{t('Aktif')}</option><option value="archived">{t('Diarsipkan')}</option><option value="all">{t('Aktif dan arsip')}</option></select></label>}</div></Modal>

 </div>;
}

function ContainerCount({row,t}) {
 const containers=row.containers||[];
 if(containers.length){const sizes={};for(const item of containers)sizes[item.size||'—']=(sizes[item.size||'—']||0)+1;return <><span className="font-medium">{containers.length} {t('kontainer')}</span><p className="table-subtext">{Object.entries(sizes).map(([size,count])=>size==='—'?`${count} ${t('ukuran belum diisi')}`:`${count} × ${size}′`).join(' · ')}</p></>;}
 const quantities=['20','21','40'].filter(size=>row.register?.[`quantity${size}`]!=null);
 return quantities.length?<><span className="text-xs">{quantities.map(size=>`${size}′: ${row.register[`quantity${size}`]}`).join(' · ')}</span><p className="table-subtext">{t('Jumlah tercatat')}</p></>:<span className="text-zinc-500">—</span>;
}

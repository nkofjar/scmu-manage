import { Link } from 'react-router-dom';
import { useState } from 'react';
import PackingHeaderCreator from '../BL/PackingHeaderCreator';
import PackingRecapCreator from '../BL/PackingRecapCreator';
import { PageHeader, Button } from '../../components/common';
import { DataTable, DetailModal, Notice, usePagedResource } from '../../components/jpt/Workspace';
import { usePageQuery } from '../../components/Layout/PageNavigation';
import { useLanguage } from '../../i18n/LanguageContext';

export default function PackingOverview(){
 const {t}=useLanguage();const [params,setQuery]=usePageQuery();const search=params.get('search')||'';const category=params.get('category')||'';const resource=usePagedResource('/operations/packing-lists',{search,category},'packing-overview');const [selected,setSelected]=useState([]);const [exporting,setExporting]=useState(false);
 return <div className="space-y-5"><PageHeader title={t('Packing List')} subtitle={t('Daftar Packing List mitra, Packing List internal SCMU, dan Kepala Packing List yang terhubung langsung ke B/L.')} action={<Button variant="secondary" onClick={()=>setExporting(true)}>{t('Ekspor gabungan')}</Button>}/>
  <div className="card p-3 grid sm:grid-cols-[1fr_16rem] gap-3"><input className="input-field" type="search" aria-label={t('Cari Packing List atau B/L')} placeholder={t('Cari Packing List atau B/L')} value={search} onChange={event=>setQuery({search:event.target.value,page:null})}/><select className="input-field" aria-label={t('Jenis Packing List')} value={category} onChange={event=>setQuery({category:event.target.value,page:null})}><option value="">{t('Semua jenis')}</option><option value="PACKING_LIST">{t('Packing List mitra')}</option><option value="INTERNAL_PACKING_LIST">{t('Packing List internal')}</option><option value="PACKING_HEADER">{t('Kepala Packing List')}</option><option value="INTERNAL_PACKING_RECAP">{t('Rekap PL internal')}</option></select></div>
  <p className="text-sm text-zinc-400">{t('Buka Kelola Packing List pada pengiriman untuk menyiapkan sumber, ringkasan, dan lembar pemeriksaan dalam satu alur.')}</p>
  <Notice message={resource.error}/><DataTable mobileCards actionPlacement="row" rows={resource.rows} pagination={resource.pagination} empty={t('Belum ada B/L untuk dikelola.')} columns={[
   {key:'billNumber',label:t('B/L & Mitra'),primary:true,width:'27%',render:row=><><Link className="font-semibold text-brand-400" to={`/bl-register/${row.billId}`}>{row.billNumber||t('B/L belum tersedia')}</Link><p className="table-subtext">{row.partnerName||row.carrierName||'—'}</p></>},
   {key:'vessel',label:t('Kapal & Voyage'),width:'23%',render:row=><>{row.vesselName||'—'}<p className="table-subtext">{row.voyageNumber||'—'}</p></>},
   {key:'partnerReady',label:t('Kelengkapan PL'),width:'22%',render:row=><div className="space-y-1"><p className="text-xs">{t('Mitra')}: <span className={`table-pill ${row.partnerReady?'table-pill-ready':''}`}>{t(row.partnerReady?'Ada':row.policy==='BL_AND_PACKING'?'Belum ada':'Tidak diwajibkan')}</span></p><p className="text-xs">SCMU: <span className={`table-pill ${row.internalReady?'table-pill-ready':''}`}>{t(row.internalReady?'Ada':row.policy==='BL_ONLY'?'Perlu dibuat':'Opsional')}</span></p></div>},
   {key:'fieldInspection',label:t('Pemeriksaan lapangan'),width:'14%',render:row=><span className={`table-pill ${row.fieldInspection==='CONFIRMED'?'table-pill-ready':''}`}>{t(({CONFIRMED:'Sudah diperiksa',DRAFT:'Draf pemeriksaan',STALE:'Perlu diperiksa ulang'})[row.fieldInspection]||'Belum diperiksa')}</span>},
   {key:'action',label:t('Perlu dikerjakan'),width:'14%',render:row=>t({UPLOAD_PARTNER:'Unggah PL mitra',CREATE_INTERNAL:'Buat PL SCMU',CREATE_HEADER:'Periksa rekap',COMPLETE:'Dokumen lengkap'}[row.action]||'Kelola Packing List')},
   {key:'actions',label:t('Tindakan'),width:152,items:[{key:'manage',label:'Kelola PL',href:row=>`/bl-register/${row.billId}?tab=packing`}]},
  ]}/>
  {exporting&&<DetailModal title="Ekspor gabungan beberapa B/L (opsional)" onClose={()=>setExporting(false)} actions={<><PackingHeaderCreator selection={selected} onCreated={()=>{setSelected([]);resource.reload();}}/><PackingRecapCreator selection={selected} onCreated={()=>{setSelected([]);resource.reload();}}/></>}><p className="text-sm text-zinc-400 mb-4">{t('Pilih B/L pada kapal dan voyage yang sama untuk ekspor gabungan.')} {selected.length} {t('dipilih')}</p><DataTable rows={resource.rows} pagination={resource.pagination} empty={t('Belum ada B/L untuk dikelola.')} columns={[
    {key:'select',label:t('Pilih'),width:56,render:row=><input type="checkbox" aria-label={`${t('Pilih')} ${row.billNumber}`} checked={selected.some(item=>item.id===row.id)} disabled={!selected.some(item=>item.id===row.id)&&selected.length>=40} onChange={e=>setSelected(old=>e.target.checked?[...old,{id:row.id,version:row.version}]:old.filter(item=>item.id!==row.id))}/>},
    {key:'billNumber',label:t('Nomor B/L')},{key:'vesselName',label:t('Kapal')},{key:'voyageNumber',label:t('Voyage')},
  ]}/></DetailModal>}
  </div>;
}

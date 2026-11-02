import {Link} from 'react-router-dom';
import {PageHeader} from '../../components/common';
import {DataTable,Notice,usePagedResource} from '../../components/jpt/Workspace';
import {usePageQuery} from '../../components/Layout/PageNavigation';
import {useBL} from '../../i18n/bl.mjs';
export default function JourneyPackingOverview(){
 const {t}=useBL(),[params,setQuery]=usePageQuery(),search=params.get('search')||'',task=params.get('task')||'',resource=usePagedResource('/journeys',{search,task,archived:'active'});
 const count=(r,k)=>`${r.packing?.[k]||0} / ${r.packing?.billCount||0} B/L`;
 return <div className="space-y-5" data-journey-packing><PageHeader title={t('Packing List')} subtitle={t('Ketersediaan sumber, Packing List internal, dan rekap barang setiap pengiriman.')}/><div className="card p-3 flex flex-wrap gap-3"><input aria-label={t('Cari kapal, voyage, atau B/L')} className="input-field flex-1" placeholder={t('Cari kapal, voyage, atau B/L')} value={search} onChange={e=>setQuery({search:e.target.value,page:null})}/><select aria-label={t('Kesiapan Packing List')} className="input-field sm:max-w-64" value={task} onChange={e=>setQuery({task:e.target.value,page:null})}><option value="">{t('Semua pengiriman')}</option><option value="missing-packing">{t('Packing List perlu dilengkapi')}</option><option value="pending-recaps">{t('Siap dibuat rekap barang')}</option></select></div><Notice message={resource.error}/><DataTable mobileCards actionPlacement="row" rows={resource.rows} pagination={resource.pagination} columns={[
 {key:'label',label:'Kapal & Voyage',primary:true,render:r=><><Link className="font-semibold text-brand-500" to={'/shipments/'+r.id+'?tab=packing'}>{r.label}</Link><small className="block text-zinc-500">{r.period||'—'} · {r.destination||'—'}</small></>},
 {key:'partner',label:'PL mitra tersedia',render:r=>count(r,'partnerReady')},{key:'internal',label:'PL internal tersedia',render:r=>count(r,'internalReady')},{key:'recap',label:'Rekap barang tersedia',render:r=><>{count(r,'recapReady')}<small className="block text-zinc-500">{r.packing?.detailReady||0} {t('B/L dengan rincian siap direkap')}</small></>},{key:'updated',label:'Pembaruan berkas PL',render:r=>r.packing?.packingUpdatedAt?.slice(0,10)||'—'},
 {key:'actions',label:'Tindakan',items:[{key:'manage',label:'Kelola Packing List',href:r=>'/shipments/'+r.id+'?tab=packing'},{key:'docs',label:'Dokumen',href:r=>'/shipments/'+r.id+'?tab=documents'}]}
 ]}/><p className="text-xs text-zinc-500">{t('Ketersediaan file berbeda dari pemeriksaan isi. PL mitra mengikuti kebutuhan dokumen masing-masing B/L.')}</p></div>;
}

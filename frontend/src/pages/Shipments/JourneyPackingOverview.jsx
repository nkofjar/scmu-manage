import {Link} from 'react-router-dom';
import {PageHeader} from '../../components/common';
import {useState} from 'react';
import ShipmentPackingDialog from './ShipmentPackingDialog';
import {DataTable,Notice,usePagedResource} from '../../components/jpt/Workspace';
import {usePageQuery} from '../../components/Layout/PageNavigation';
import {useBL} from '../../i18n/bl.mjs';
export default function JourneyPackingOverview(){
 const {t}=useBL(),[params,setQuery]=usePageQuery(),search=params.get('search')||'',resource=usePagedResource('/journeys',{search,archived:'active'});
 const [opened,setOpened]=useState(null);
 const status=r=>t(({DRAFT:'Belum disimpan',SAVED:'Tersimpan',CHANGED:'Ada perubahan data',NEEDS_REVIEW:'Perlu diperiksa ulang'})[r.packing?.outputStatus]||'Belum disimpan');
 return <div className="space-y-5" data-journey-packing><PageHeader title={t('Packing List')}/><div className="card p-3"><input aria-label={t('Cari kapal, voyage, atau B/L')} className="input-field w-full" placeholder={t('Cari kapal, voyage, atau B/L')} value={search} onChange={e=>setQuery({search:e.target.value,page:null,task:null})}/></div><Notice message={resource.error}/><DataTable mobileCards actionPlacement="row" rows={resource.rows} pagination={resource.pagination} columns={[
 {key:'label',label:'Kapal & Voyage',primary:true,render:r=><><Link className="font-semibold text-brand-500" to={'/shipments/'+r.id+'?tab=summary'}>{r.label}</Link><small className="block text-zinc-500">{r.period||'—'} · {r.destination||'—'}</small></>},
 {key:'billCount',label:'B/L',render:r=>r.packing?.billCount??r.billCount??0},
 {key:'containerCount',label:'Kontainer'},
 {key:'outputStatus',label:t('Status Packing List'),render:status},
 {key:'savedAt',label:t('Terakhir disimpan'),render:r=>r.packing?.savedAt?.slice(0,10)||''},
 {key:'actions',label:'Tindakan',items:[{key:'packing',label:t('Buka Packing List'),onClick:r=>setOpened(r.id)}]}
 ]}/>{opened&&<ShipmentPackingDialog journeyId={opened} onClose={()=>setOpened(null)} onSaved={()=>resource.reload()}/>}</div>;
}

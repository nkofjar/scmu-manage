import {useEffect,useState} from 'react';
import {Link,useParams,useSearchParams} from 'react-router-dom';
import api from '../../api/client';
import {Button} from '../../components/common';
import {DataTable,DetailModal,Notice,usePagedResource,useResource} from '../../components/jpt/Workspace';
import {useBL} from '../../i18n/bl.mjs';
import {useDetailNavigation} from '../../components/Layout/PageNavigation';
import JourneyDocuments from './JourneyDocuments';
import JourneyCosts from './JourneyCosts';
import {JourneyEditor} from './Journeys';
import RegisterForm from '../BL/RegisterForm';
import DriverOperations from './DriverOperations';
import DocumentBatch from '../BL/DocumentBatch';



import {documentOwner} from './documentOwnership.mjs';
import DeleteBillFiles from './DeleteBillFiles';
import BillDeliveryOrder,{DeliveryOrderCell} from './BillDeliveryOrder';
import ShipmentFileAccess,{OriginalBillFiles} from './ShipmentFileAccess';

import {partnerPackingFiles} from './JourneyPackingSources';
import ShipmentPackingDialog from './ShipmentPackingDialog';
import JourneyBillRecap from './JourneyBillRecap';
import {searchJourneyBills,containerMatchParts} from './journeyBillSearch.mjs';
export {partnerPackingFiles};

export function JourneyBillActions({journey,onSaved,onRecap,onManual,onBillRecap,recapReason}){
 const {t}=useBL(),readonly=journey.deleted||journey.archived;
 return <div className="flex flex-wrap gap-2" data-journey-bill-actions>
  {!readonly&&<DocumentBatch journey={journey} blOnly buttonLabel="Unggah B/L" onSaved={onSaved}/>}
  <Button disabled={!!recapReason||readonly} title={recapReason?t(recapReason):undefined} onClick={onRecap}>{t('Buat Packing List Pengiriman')}</Button>
  <Button variant="secondary" disabled={journey.deleted} onClick={onBillRecap}>{t('Rekapan B/L')}</Button>
  <Button variant="secondary" disabled={readonly} onClick={onManual}>{t('Isi B/L manual')}</Button>
 </div>;
}
export function JourneyBillTable({bills,onDelete,onDeliveryOrder,onViewFiles,readonly=false}){const {t}=useBL(),[query,setQuery]=useState('');const found=searchJourneyBills(bills,query);return <><label className="block text-sm space-y-1"><span>{t('Cari nomor kontainer')}</span><input className="input-field" aria-label="Cari nomor kontainer" value={query} placeholder="ABCU123 / 1234567" onChange={event=>setQuery(event.target.value)}/></label><p className="text-sm text-zinc-400">{found.length} {t('B/L cocok')} / {bills.filter(b=>!b.deleted).length} {t('B/L')}</p><DataTable resetKey={query} mobileCards actionPlacement="row" rows={found} columns={[{key:'billNumber',label:'Nomor B/L',primary:true,render:b=><Link className="font-semibold text-brand-500" to={'/bl-register/'+b.id}>{b.billNumber||t('Draf / B/L menyusul')}</Link>},{key:'carrierName',label:'Pelayaran'},{key:'portOfLoading',label:'Pelabuhan asal'},{key:'containers',label:'Kontainer',render:b=><div className="space-y-1 font-mono text-xs">{(b.containers||[]).map((c,i)=><div key={i}>{containerMatchParts(c.number,query).map((p,n)=>p.match?<mark key={n} className="bg-amber-200 text-zinc-950 rounded px-0.5">{p.text}</mark>:<span key={n}>{p.text}</span>)}</div>)}</div>},{key:'partnerPackingCount',label:t('Total PL mitra'),render:b=><Link className="text-brand-500 underline" to={'/bl-register/'+b.id+'?tab=packing'}>{partnerPackingFiles(b).length}</Link>},{key:'deliveryOrder',label:'DO / Delivery Order',render:b=><DeliveryOrderCell bill={b} readonly={readonly} onManage={onDeliveryOrder}/>},{key:'actions',label:'Tindakan',items:[{key:'view-bl-files',label:t('Lihat file B/L'),disabled:()=>!onViewFiles,onClick:onViewFiles},{key:'delete-bl-file',label:t('Hapus file B/L'),disabled:b=>readonly||b.archived||b.deleted||!onDelete||!(b.files||[]).some(f=>documentOwner(f.category)==='BL'),onClick:onDelete}]}]} empty={query?'Tidak ada B/L dengan kontainer ini.':'Belum ada B/L pada pengiriman ini.'}/></>;}

export default function JourneyDetail(){
 const {id}=useParams(),{t}=useBL(),[params,setParams]=useSearchParams(),resource=useResource('/journeys/'+id),[editing,setEditing]=useState(false),[manual,setManual]=useState(false),[recap,setRecap]=useState(false),[billRecap,setBillRecap]=useState(false),[deleteBill,setDeleteBill]=useState(null),[deliveryBill,setDeliveryBill]=useState(null),[fileBill,setFileBill]=useState(null);
 const tabs=[['summary','Ringkasan & B/L'],['documents','Dokumen pengiriman'],['costs','Biaya'],['history','Riwayat']];const tab=params.get('shippingFiles')==='1'?'documents':tabs.some(([k])=>k===params.get('tab'))?params.get('tab'):'summary';
 useEffect(()=>{if(params.get('shippingFiles')==='1')setParams(previous=>{const next=new URLSearchParams(previous);next.delete('shippingFiles');next.set('tab','documents');return next;},{replace:true});},[params,setParams]);const history=usePagedResource(tab==='history'?`/journeys/${id}/activity`:null,{},'journeyHistory');const j=resource.data;
 useDetailNavigation(j?.label||'Pengiriman',null);
 const reload=async()=>{const data=(await api.get('/journeys/'+id)).data;resource.update(data);return data;};
 if(!j)return <div><Notice message={resource.error}/><p>{t('Memuat pengiriman…')}</p></div>;
 const readonly=j.deleted||j.archived,activeBills=j.bills.filter(b=>!b.archived&&!b.deleted),printBills=activeBills.filter(b=>b.billNumber);
 const recapReason=readonly?'Pengiriman hanya baca.':!printBills.length?'Lengkapi nomor B/L terlebih dahulu.':!j.vesselName||!j.voyageNumber?'Lengkapi kapal dan voyage terlebih dahulu.':printBills.length>40?'Pilih maksimal 40 B/L melalui dialog rekap.':'';

 return <div className="bl-detail-page" data-journey-detail><header className="bl-page-header"><Link className="bl-back" to={j.deleted?'/bl-register/trash':'/bl-register'}>← {t('Kembali')}</Link><div className="bl-header-title"><h1>{j.label}</h1><p>{j.period||t('Periode belum diisi')} · {j.destination||t('Tujuan belum diisi')} · {j.number}</p></div><div className="bl-header-actions"><span className="table-pill">{t(j.deleted?'Di Sampah':j.archived?'Diarsipkan':'Aktif')}</span><Button disabled={readonly} onClick={()=>setEditing(true)}>{t('Ubah data')}</Button></div></header>
 <div className="bl-workspace-body space-y-5"><Notice message={resource.error}/>{j.deleted&&<p className="card p-3 text-sm">{t('Pengiriman berada di Sampah dan hanya dapat dibaca.')} <Link className="text-brand-500 underline" to="/bl-register/trash">{t('Buka Sampah')}</Link></p>}
 <div className="grid grid-cols-3 gap-3">{[['billCount','Jumlah B/L'],['containerCount','Kontainer tercatat'],['documentCount','Total file pengiriman & B/L']].map(([k,l])=><div className="card p-3" key={k}><p className="text-xs text-zinc-500">{t(l)}</p><strong className="text-xl">{j[k]}</strong></div>)}</div>
 <nav className="bl-primary-tabs" role="tablist">{tabs.map(([key,label])=><button role="tab" aria-selected={tab===key} key={key} onClick={()=>setParams({tab:key})}>{t(label)}</button>)}</nav>
 {tab==='summary'&&<section className="space-y-4">
  <div className="card p-4 text-sm space-y-2"><p>{t('Pelabuhan asal')}: {j.origins.join(', ')||'—'} → {j.destination||'—'}</p><p>{t('Tanggal berangkat')}: {j.departureDate?.slice(0,10)||'—'} · {t('Tanggal tiba')}: {j.arrivalDate?.slice(0,10)||'—'}</p><p>{j.notes}</p>{!j.data.periodConfirmed&&<p className="text-amber-500">{t('Periode data lama perlu diperiksa. Tahun dokumen tidak otomatis dianggap tanggal perjalanan.')}</p>}</div>
  <div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">{t('B/L dalam pengiriman')}</h2><JourneyBillActions journey={j} onSaved={reload} onRecap={()=>setRecap(true)} onBillRecap={()=>setBillRecap(true)} onManual={()=>setManual(true)} recapReason={recapReason}/></div>
  {recapReason&&<p className="text-sm text-amber-600">{t(recapReason)}</p>}
  <JourneyBillTable bills={j.bills} readonly={readonly} onDelete={setDeleteBill} onDeliveryOrder={setDeliveryBill} onViewFiles={setFileBill}/>
 </section>}


 {tab==='documents'&&<ShipmentFileAccess key={j.id} journey={j} onChanged={reload}/>}
 {tab==='costs'&&<JourneyCosts journey={j} onChanged={reload}/>}
 {tab==='history'&&<><Notice message={history.error}/><DataTable rows={history.rows} pagination={history.pagination} columns={[{key:'createdAt',label:'Tanggal',render:r=>r.createdAt?.slice(0,19).replace('T',' ')},{key:'action',label:'Tindakan',primary:true,render:r=>t(r.action)},{key:'user',label:'Pengguna',render:r=>r.user?.name},{key:'metadata',label:'Rincian',render:r=><details><summary>{t('Rincian')}</summary><code className="text-xs break-all">{JSON.stringify(r.metadata)}</code></details>} ]}/></>}
 </div>
 {fileBill&&<OriginalBillFiles key={fileBill.id} bill={fileBill} onClose={()=>setFileBill(null)}/> }
 {deleteBill&&<DeleteBillFiles key={deleteBill.id} bill={deleteBill} onClose={()=>setDeleteBill(null)} onSaved={reload}/>}
 {deliveryBill&&<BillDeliveryOrder key={deliveryBill.id} bill={j.bills.find(b=>b.id===deliveryBill.id)||deliveryBill} readonly={readonly} onClose={()=>setDeliveryBill(null)} onSaved={reload}/>}
 {params.get('legacyFiles')==='1'&&<DetailModal title="Lampiran tersimpan" onClose={()=>setParams(previous=>{const next=new URLSearchParams(previous);next.delete('legacyFiles');return next;})}><JourneyDocuments journey={j} owner={params.get('owner')==='packing'?'PACKING':'SUPPORTING'} onChanged={reload}/></DetailModal>}
 {params.get('recapFiles')==='1'&&<DetailModal title="Hasil dan riwayat rekap pengiriman" onClose={()=>setParams({tab:'summary'})}><JourneyDocuments journey={j} owner="PACKING" recapsOnly onChanged={reload}/></DetailModal>}
 {params.get('operations')==='1'&&<DetailModal title={t('Operasional gabungan pengiriman')} onClose={()=>setParams({tab:'costs'})}><p className="text-sm text-amber-600 mb-4">{t('Lingkup seluruh pengiriman: jatah kontainer bersama, rekap upah, dan pembayaran lintas B/L.')}</p><DriverOperations journey={j} onChanged={reload}/></DetailModal>}
 {editing&&<JourneyEditor initial={j} onClose={()=>setEditing(false)} onSaved={reload}/>}
 {manual&&<DetailModal title="Isi B/L manual" onClose={()=>setManual(false)} actions={<Button type="submit" form="journey-bill-form">{t('Simpan rincian B/L')}</Button>}><RegisterForm initial={{journeyId:id,vesselId:j.vesselId,voyageId:j.voyageId,vesselName:j.vesselName,voyageNumber:j.voyageNumber,portOfDischarge:j.destination,register:{dateMeaning:'UNCONFIRMED'}}} formId="journey-bill-form" hideActions onSaved={async()=>{await reload();setManual(false);}}/></DetailModal>}
 {billRecap&&<JourneyBillRecap key={id} journeyId={id} onClose={()=>setBillRecap(false)}/>}
 {recap&&<ShipmentPackingDialog journeyId={id} onClose={()=>setRecap(false)} onSaved={reload}/>}


 </div>;
}

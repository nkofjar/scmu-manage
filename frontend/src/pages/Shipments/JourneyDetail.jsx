import {useState} from 'react';
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
import VoyagePacking from '../BL/VoyagePacking';
import PackingRecapCreator from '../BL/PackingRecapCreator';
import {OperationalWorkspace} from '../BL/BLWorkspacePanels';
import {documentOwner} from './documentOwnership.mjs';

export function JourneyBillTable({bills}){const {t}=useBL();return <DataTable mobileCards rows={bills} columns={[{key:'billNumber',label:'Nomor B/L',primary:true,render:b=><Link className="font-semibold text-brand-500" to={'/bl-register/'+b.id}>{b.billNumber||t('Draf / B/L menyusul')}</Link>},{key:'carrierName',label:'Pelayaran'},{key:'portOfLoading',label:'Pelabuhan asal'},{key:'containers',label:'Kontainer',render:b=>b.containers.length},{key:'docs',label:'File B/L',render:b=><Link className="text-brand-500" to={'/bl-register/'+b.id+'?tab=summary'}>{(b.files||[]).filter(file=>documentOwner(file.category)==='BL').length} {t('File B/L')}</Link>}]} empty="Belum ada B/L pada pengiriman ini."/>;}

export default function JourneyDetail(){
 const {id}=useParams(),{t}=useBL(),[params,setParams]=useSearchParams(),resource=useResource('/journeys/'+id),[editing,setEditing]=useState(false),[manual,setManual]=useState(false),[recap,setRecap]=useState(false),[detailRecap,setDetailRecap]=useState(false),[packingBill,setPackingBill]=useState(null);
 const tabs=[['summary','Ringkasan & B/L'],['documents','Dokumen'],['packing','Packing List & Rekap'],['driver-bons','Bonrate Sopir'],['costs','Biaya'],['history','Riwayat']];const tab=tabs.some(([k])=>k===params.get('tab'))?params.get('tab'):'summary';const history=usePagedResource(tab==='history'?`/journeys/${id}/activity`:null,{},'journeyHistory');const j=resource.data;
 useDetailNavigation(j?.label||'Pengiriman',null);
 const reload=async()=>{const data=(await api.get('/journeys/'+id)).data;resource.update(data);return data;};
 if(!j)return <div><Notice message={resource.error}/><p>{t('Memuat pengiriman…')}</p></div>;
 const readonly=j.deleted||j.archived,activeBills=j.bills.filter(b=>!b.archived),printBills=activeBills.filter(b=>b.billNumber),detailBills=activeBills.filter(b=>b.packingStatus?.detailReady);
 const recapReason=readonly?'Pengiriman hanya baca.':!printBills.length?'Lengkapi nomor B/L terlebih dahulu.':!j.vesselName||!j.voyageNumber?'Lengkapi kapal dan voyage terlebih dahulu.':printBills.length>40?'Pilih maksimal 40 B/L melalui dialog rekap.':'';
 const detailReason=readonly?'Pengiriman hanya baca.':!detailBills.length?'Belum ada rincian barang terkonfirmasi. Kelola Packing List dan simpan rincian terlebih dahulu.':detailBills.length>40?'Pilih maksimal 40 B/L melalui dialog rekap.':'';
 return <div className="bl-detail-page" data-journey-detail><header className="bl-page-header"><Link className="bl-back" to={j.deleted?'/bl-register/trash':'/bl-register'}>← {t('Kembali')}</Link><div className="bl-header-title"><h1>{j.label}</h1><p>{j.period||t('Periode belum diisi')} · {j.destination||t('Tujuan belum diisi')} · {j.number}</p></div><div className="bl-header-actions"><span className="table-pill">{t(j.deleted?'Di Sampah':j.archived?'Diarsipkan':'Aktif')}</span><Button disabled={readonly} onClick={()=>setEditing(true)}>{t('Ubah data')}</Button></div></header>
 <div className="bl-workspace-body space-y-5"><Notice message={resource.error}/>{j.deleted&&<p className="card p-3 text-sm">{t('Pengiriman berada di Sampah dan hanya dapat dibaca.')} <Link className="text-brand-500 underline" to="/bl-register/trash">{t('Buka Sampah')}</Link></p>}
 <div className="grid grid-cols-3 gap-3">{[['billCount','Jumlah B/L'],['containerCount','Kontainer tercatat'],['documentCount','File tersimpan']].map(([k,l])=><div className="card p-3" key={k}><p className="text-xs text-zinc-500">{t(l)}</p><strong className="text-xl">{j[k]}</strong></div>)}</div>
 <nav className="bl-primary-tabs" role="tablist">{tabs.map(([key,label])=><button role="tab" aria-selected={tab===key} key={key} onClick={()=>setParams({tab:key})}>{t(label)}</button>)}</nav>
 {tab==='summary'&&<section className="space-y-4"><div className="card p-4 text-sm space-y-2"><p>{t('Pelabuhan asal')}: {j.origins.join(', ')||'—'} → {j.destination||'—'}</p><p>{t('Tanggal berangkat')}: {j.departureDate?.slice(0,10)||'—'} · {t('Tanggal tiba')}: {j.arrivalDate?.slice(0,10)||'—'}</p><p>{j.notes}</p>{!j.data.periodConfirmed&&<p className="text-amber-500">{t('Periode data lama perlu diperiksa. Tahun dokumen tidak otomatis dianggap tanggal perjalanan.')}</p>}</div><div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">{t('B/L dalam pengiriman')}</h2><div className="flex flex-wrap gap-2">{!readonly&&<DocumentBatch journey={j} blOnly buttonLabel="Unggah B/L" onSaved={reload}/>}<Button variant="secondary" disabled={readonly} onClick={()=>setManual(true)}>{t('Isi B/L manual')}</Button></div></div><JourneyBillTable bills={j.bills}/></section>}
 {tab==='documents'&&<JourneyDocuments journey={j} onChanged={reload}/>}
 {tab==='packing'&&<section className="space-y-4"><JourneyDocuments key="packing-files" owner="PACKING" journey={j} onChanged={reload}/><h2 className="text-lg font-semibold">{t('Packing List & Rekap pengiriman')}</h2><p className="text-sm text-zinc-500">{t('Pilih sumber yang dicakup, periksa rincian, lalu cetak rekap untuk pengiriman ini. Dokumen asli tetap disimpan.')}</p><div className="grid sm:grid-cols-2 gap-3"><div className="card p-4 space-y-2"><Button disabled={!!recapReason} onClick={()=>setRecap(true)}>{t('Rekap dari B/L')}</Button><p className="text-sm text-zinc-500">{t(recapReason||'Ringkasan B/L, kontainer, dan penerima dari dokumen pelayaran.')}</p></div><div className="card p-4 space-y-2"><Button variant="secondary" disabled={!!detailReason} onClick={()=>setDetailRecap(true)}>{t('Rekap barang dari Packing List')}</Button><p className="text-sm text-zinc-500">{t(detailReason||'Rincian barang dan penerima dari Packing List, berita acara, atau input manual.')}</p></div></div>{!j.bills.length&&<p className="text-sm">{t('Tambahkan B/L melalui tab Ringkasan & B/L terlebih dahulu.')} <button className="text-brand-500 underline" onClick={()=>setParams({tab:'summary'})}>{t('Buka Ringkasan & B/L')}</button></p>}<DataTable mobileCards actionPlacement="row" rows={j.bills} columns={[{key:'billNumber',label:'Nomor B/L',primary:true,render:b=>b.billNumber||t('Draf / B/L menyusul')},{key:'source',label:'Sumber',render:b=>t(({PARTNER_PL:'Packing List mitra',RECEIVING_REPORT:'Berita Acara',MANUAL:'Input manual'})[b.workflow?.sourceType]||b.workflow?.sourceType)||'—'},{key:'actions',label:'Tindakan',items:[{key:'packing',label:'Kelola Packing List',onClick:b=>setPackingBill(b)}]}]}/></section>}
 {tab==='driver-bons'&&<DriverOperations journey={j} onChanged={reload}/>}
 {tab==='costs'&&<JourneyCosts journey={j} onChanged={reload}/>}
 {tab==='history'&&<><Notice message={history.error}/><DataTable rows={history.rows} pagination={history.pagination} columns={[{key:'createdAt',label:'Tanggal',render:r=>r.createdAt?.slice(0,19).replace('T',' ')},{key:'action',label:'Tindakan',primary:true,render:r=>t(r.action)},{key:'user',label:'Pengguna',render:r=>r.user?.name},{key:'metadata',label:'Rincian',render:r=><details><summary>{t('Rincian')}</summary><code className="text-xs break-all">{JSON.stringify(r.metadata)}</code></details>} ]}/></>}
 </div>
 {editing&&<JourneyEditor initial={j} onClose={()=>setEditing(false)} onSaved={reload}/>}
 {manual&&<DetailModal title="Isi B/L manual" onClose={()=>setManual(false)} actions={<Button type="submit" form="journey-bill-form">{t('Simpan rincian B/L')}</Button>}><RegisterForm initial={{journeyId:id,vesselId:j.vesselId,voyageId:j.voyageId,vesselName:j.vesselName,voyageNumber:j.voyageNumber,portOfDischarge:j.destination,register:{dateMeaning:'UNCONFIRMED'}}} formId="journey-bill-form" hideActions onSaved={async()=>{await reload();setManual(false);}}/></DetailModal>}
 {recap&&<VoyagePacking initialIds={printBills.map(b=>b.id)} onClose={()=>setRecap(false)} onSaved={reload}/>}
 {detailRecap&&<DetailModal title="Rekap rincian Packing List" onClose={()=>setDetailRecap(false)}><PackingRecapCreator selection={detailBills.map(b=>({id:b.id,version:b.version}))} onCreated={reload}/></DetailModal>}
 {packingBill&&<DetailModal title="Kelola Packing List" onClose={()=>setPackingBill(null)}><p className="font-semibold mb-4">{packingBill.billNumber||t('Draf / B/L menyusul')}</p><OperationalWorkspace bill={packingBill} section="packing" onChanged={async()=>{const data=await reload();setPackingBill(data.bills.find(b=>b.id===packingBill.id));}}/></DetailModal>}
 </div>;
}

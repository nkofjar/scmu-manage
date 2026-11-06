import {useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import api from '../../api/client';
import {Button} from '../../components/common';
import {DataTable,DetailModal,Notice,useResource} from '../../components/jpt/Workspace';
import DocumentPreview from '../../components/jpt/DocumentPreview';
import {useBL} from '../../i18n/bl.mjs';
import {documentOwner} from './documentOwnership.mjs';

const blCategories=['DRAFT','FINAL','LEGACY','BILL_OF_LADING'];
const separateCategories=['RECEIVING_REPORT','DELIVERY_ORDER','INVOICE','TAX_INVOICE','PPH23_CERTIFICATE','PAYMENT_PROOF'];
const deletable=row=>row.source==='JOURNEY'&&['SUPPORTING','MANIFEST','WAYBILL','RELEASE','POWER_OF_ATTORNEY'].includes(row.category)&&!row.readOnly;
const categoryLabels={DRAFT:'B/L draft',FINAL:'B/L final',LEGACY:'B/L lama',BILL_OF_LADING:'B/L',SUPPORTING:'Dokumen pendukung',MANIFEST:'Manifest',WAYBILL:'Surat jalan',RELEASE:'Bukti pelepasan pelayaran',POWER_OF_ATTORNEY:'Surat kuasa'};

function FileList({rows,endpoint,bill,onLink,onDelete,linkDisabled,table=false}){
 const {t}=useBL(),[preview,setPreview]=useState(null),[error,setError]=useState('');
 const download=async row=>{setError('');try{const response=await api.get(endpoint(row),{responseType:'blob'}),url=URL.createObjectURL(response.data),a=document.createElement('a');a.href=url;a.download=row.originalName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e.response?.data?.message||e.message);}};
 return <div className="space-y-3"><Notice message={error}/>{table?<DataTable rows={rows} actionPlacement="row" empty="Belum ada dokumen pengiriman." columns={[
  {key:'category',label:'Jenis dokumen',render:row=>t(categoryLabels[row.category]||row.category||'')},
  {key:'originalName',label:'Nama file',primary:true,render:row=><div><p className="font-medium break-all">{row.originalName}</p>{row.note&&<p className="text-xs text-zinc-500 break-words">{row.note}</p>}</div>},
  {key:'billNumbers',label:'B/L terkait',render:row=>{const ids=row.billIds||row.scope?.billIds||[],numbers=row.billNumbers||row.scope?.billNumbers||[];return <div>{ids.length?ids.map((id,i)=><Link key={id} className="block text-brand-500" to={'/bl-register/'+id}>{numbers[i]||id}</Link>):t('Dokumen bersama')}{ids.length>0&&row.scope?.type==='SHARED'&&<p className="text-xs text-zinc-500">{t('Dokumen bersama')}</p>}</div>;}},
  {key:'createdAt',label:'Tanggal unggah',render:row=>row.createdAt?.slice(0,10)||''},
  {key:'actions',label:'Tindakan',items:[{key:'view',label:'Lihat',onClick:setPreview},{key:'download',label:'Unduh asli',onClick:download},{key:'link',label:t('Ubah tautan B/L'),hidden:row=>!onLink||row.source!=='JOURNEY'||row.category!=='SUPPORTING',disabled:row=>linkDisabled||row.readOnly,onClick:onLink},{key:'delete',label:t('Hapus dokumen'),variant:'danger',hidden:row=>!onDelete||!deletable(row),disabled:row=>linkDisabled||row.readOnly,onClick:onDelete}]},
 ]}/>:<>{!rows.length&&<p className="text-sm">{t(bill?'Belum ada file B/L.':'Belum ada dokumen pengiriman.')}</p>}{rows.map(row=>{
  const ids=row.billIds||row.scope?.billIds||[],numbers=row.billNumbers||row.scope?.billNumbers||[];
  return <article key={row.id} className="card p-3 space-y-2" data-shipment-file-row><p className="font-medium break-all">{row.originalName}</p><p className="text-xs text-zinc-500">{t(categoryLabels[row.category]||row.category)} · {row.createdAt?.slice(0,10)||'—'}</p><div className="text-sm">{ids.length?ids.map((id,i)=><Link key={id} className="block text-brand-500" to={'/bl-register/'+id}>{numbers[i]||id}</Link>):bill?bill.billNumber||t('Draf / B/L menyusul'):t('Dokumen bersama')}</div>{row.scope?.type==='SHARED'&&<p className="text-xs text-zinc-500">{t('Dokumen bersama')}</p>}{row.note&&<p className="text-sm break-words">{row.note}</p>}<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={()=>setPreview(row)}>{t('Lihat')}</Button><Button variant="secondary" onClick={()=>download(row)}>{t('Unduh asli')}</Button>{onLink&&row.source==='JOURNEY'&&row.category==='SUPPORTING'&&<Button variant="secondary" disabled={linkDisabled||row.readOnly} onClick={()=>onLink(row)}>{t('Tautkan ke B/L')}</Button>}</div></article>;
 })}</>}{preview&&<DetailModal title="Document preview" onClose={()=>setPreview(null)}><DocumentPreview endpoint={endpoint(preview)} name={preview.originalName} mimeType={preview.mimeType}/></DetailModal>}</div>;
}

export default function ShipmentFileAccess({journey,onChanged}){
 const {t}=useBL(),path=`/journeys/${journey.id}/files`,resource=useResource(path),input=useRef(null),inFlight=useRef(false);
 const [uploadOpen,setUploadOpen]=useState(false),[file,setFile]=useState(null),[category,setCategory]=useState('SUPPORTING'),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[committed,setCommitted]=useState(false),[conflict,setConflict]=useState(false),[recovered,setRecovered]=useState(false),[linking,setLinking]=useState(null),[billIds,setBillIds]=useState([]),[deleting,setDeleting]=useState(null),[reason,setReason]=useState('');
 const readonly=journey.archived||journey.deleted,loadError=recovered?'':resource.error,blocked=busy||committed||conflict||resource.loading||!!loadError||!Number.isInteger(resource.data?.version);
 const rows=(resource.data?.data||[]).filter(row=>documentOwner(row.category)==='SUPPORTING'&&!separateCategories.includes(row.category));
 const clear=()=>{setFile(null);setLinking(null);setBillIds([]);setDeleting(null);setReason('');if(input.current)input.current.value='';};
 const refresh=async(closeUpload=false)=>{const response=await api.get(path);resource.update(response.data);setRecovered(true);await onChanged?.();setCommitted(false);setConflict(false);setError('');if(closeUpload)setUploadOpen(false);};
 const reload=async()=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);clear();try{await refresh(committed&&uploadOpen);}catch(e){setError(e.response?.data?.message||e.message);}finally{inFlight.current=false;setBusy(false);}};
 const mutate=async kind=>{
  if(readonly||blocked||inFlight.current||kind==='upload'&&(!file||file.size>5*1024*1024||!['SUPPORTING','MANIFEST','WAYBILL','RELEASE'].includes(category))||kind==='link'&&(!linking||linking.source!=='JOURNEY'||linking.category!=='SUPPORTING'||linking.readOnly)||kind==='delete'&&(!deleting||!deletable(deleting)||!reason.trim()))return;
  inFlight.current=true;setBusy(true);setError('');let saved=false;
  try{
   if(kind==='upload'){const body=new FormData();body.append('file',file);body.append('version',String(resource.data.version));body.append('category',category);body.append('note',note);await api.post(path,body);}
   else if(kind==='link')await api.put(`${path}/${linking.ref}/link`,{version:resource.data.version,billIds});
   else await api.delete(`${path}/${deleting.ref}`,{data:{version:resource.data.version,reason}});
   saved=true;setCommitted(true);clear();await refresh(kind==='upload');
  }catch(e){if(!saved)setConflict(e.response?.status===409);setError(saved?t('Perubahan sudah tersimpan. Muat ulang data tanpa mengirim ulang.'):e.response?.data?.message||e.message);}
  finally{inFlight.current=false;setBusy(false);}
 };
 return <section className="space-y-4" data-shipping-files>
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{t('Dokumen pengiriman')}</h2>{!readonly&&<Button disabled={blocked} onClick={()=>{clear();setCategory('SUPPORTING');setNote('');setError('');setUploadOpen(true);}}>{t('Unggah dokumen')}</Button>}</div>
  {!uploadOpen&&!linking&&!deleting&&<><Notice message={error||loadError}/>{(error||loadError||committed||conflict)&&<Button variant="secondary" disabled={busy} onClick={reload}>{t('Muat ulang data')}</Button>}</>}
  {uploadOpen&&!readonly&&<DetailModal title="Unggah dokumen pengiriman" width="max-w-2xl" onClose={()=>{if(!busy){clear();setUploadOpen(false);}}} actions={<Button type="submit" form="shipment-document-upload" disabled={blocked||!file||file.size>5*1024*1024}>{t('Unggah dokumen pengiriman')}</Button>}>
   <Notice message={error||loadError}/>{(error||loadError||committed||conflict)&&<Button variant="secondary" disabled={busy} onClick={reload}>{t('Muat ulang data')}</Button>}
   <form id="shipment-document-upload" onSubmit={event=>{event.preventDefault();mutate('upload');}}><fieldset disabled={blocked} className="space-y-3">
   <label className="block text-sm">{t('Kategori dokumen pengiriman')}<select aria-label="Kategori dokumen pengiriman" className="input-field" value={category} onChange={e=>setCategory(e.target.value)}>{['SUPPORTING','MANIFEST','WAYBILL','RELEASE'].map(key=><option key={key} value={key}>{t(categoryLabels[key])}</option>)}</select></label>
   <label className="block text-sm">{t('Catatan dokumen pengiriman')}<input aria-label="Catatan dokumen pengiriman" className="input-field" maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label>
   <label className="block text-sm">{t('File dokumen pengiriman')}<input ref={input} aria-label="File dokumen pengiriman" type="file" className="input-field" onChange={e=>{const next=e.target.files?.[0]||null;setFile(next);setError(next?.size>5*1024*1024?t('Maksimal 5 MB per file.'):'');}}/></label>
  </fieldset></form></DetailModal>}
  {resource.loading?<p>{t('Memuat ruang kerja…')}</p>:<FileList table rows={rows} endpoint={row=>row.endpoint} onLink={readonly?undefined:row=>{clear();setError('');setLinking(row);setBillIds(row.billIds||[]);}} onDelete={readonly?undefined:row=>{clear();setError('');setDeleting(row);}} linkDisabled={blocked}/>}
  {linking&&<DetailModal title={t('Ubah tautan B/L')} width="max-w-2xl" onClose={()=>{if(!busy){setLinking(null);setBillIds([]);}}} actions={<Button type="submit" form="shipment-document-link" disabled={blocked||billIds.length===(linking.billIds||[]).length&&billIds.every(id=>linking.billIds?.includes(id))}>{t('Simpan perubahan')}</Button>}>
   <Notice message={error||loadError}/>{(error||loadError||committed||conflict)&&<Button variant="secondary" disabled={busy} onClick={reload}>{t('Muat ulang data')}</Button>}
   <form id="shipment-document-link" className="space-y-3" onSubmit={event=>{event.preventDefault();mutate('link');}}><p className="font-medium break-all">{linking.originalName}</p><Button type="button" variant="secondary" disabled={blocked||!billIds.length} onClick={()=>setBillIds([])}>{t('Lepas semua tautan')}</Button><fieldset disabled={blocked}>{journey.bills.filter(b=>!b.archived&&!b.deleted||linking.billIds?.includes(b.id)).map(b=><label key={b.id} className="flex gap-2 text-sm py-2"><input aria-label={'Tautkan '+(b.billNumber||b.id)} type="checkbox" disabled={b.archived||b.deleted} checked={billIds.includes(b.id)} onChange={e=>setBillIds(ids=>e.target.checked?[...ids,b.id]:ids.filter(id=>id!==b.id))}/>{b.billNumber||t('Draf / B/L menyusul')}</label>)}</fieldset></form></DetailModal>}
  {deleting&&<DetailModal title={t('Hapus dokumen')} width="max-w-2xl" onClose={()=>{if(!busy){setDeleting(null);setReason('');}}} actions={<Button variant="danger" type="submit" form="shipment-document-delete" disabled={blocked||!reason.trim()}>{t('Konfirmasi hapus dokumen')}</Button>}>
   <Notice message={error||loadError}/>{(error||loadError||committed||conflict)&&<Button variant="secondary" disabled={busy} onClick={reload}>{t('Muat ulang data')}</Button>}
   <form id="shipment-document-delete" className="space-y-3" onSubmit={event=>{event.preventDefault();mutate('delete');}}><p className="font-medium break-all">{deleting.originalName}</p>
    {!!deleting.billIds?.length&&<div className="text-sm"><p>{t('Lepas tautan B/L terlebih dahulu sebelum menghapus dokumen.')}</p>{deleting.billIds.map((id,i)=><Link key={id} className="block text-brand-500" to={'/bl-register/'+id}>{deleting.billNumbers?.[i]||id}</Link>)}</div>}
    <label className="block text-sm">{t('Alasan penghapusan')}<textarea aria-label="Alasan penghapusan" required maxLength={2000} className="input-field" disabled={blocked} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   </form></DetailModal>}
 </section>;
}

export function OriginalBillFiles({bill,onClose}){
 const {t}=useBL(),path=`/bl-register/${bill.id}/files`,resource=useResource(path);
 const rows=(resource.data?.data||[]).filter(row=>blCategories.includes(row.category));
 return <DetailModal title={t('File B/L asli')} onClose={onClose}><section className="space-y-4" data-original-bill-files><p className="font-semibold">{bill.billNumber||t('Draf / B/L menyusul')}</p><Notice message={resource.error}/>{resource.error&&<Button variant="secondary" onClick={resource.reload}>{t('Muat ulang data')}</Button>}{resource.loading?<p>{t('Memuat ruang kerja…')}</p>:<FileList rows={rows} bill={bill} endpoint={row=>`${path}/${row.id}`}/>}</section></DetailModal>;
}

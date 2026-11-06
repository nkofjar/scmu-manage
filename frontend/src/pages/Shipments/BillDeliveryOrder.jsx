import {useRef,useState} from 'react';
import api from '../../api/client';
import {Button} from '../../components/common';
import {DetailModal,Notice,useResource} from '../../components/jpt/Workspace';
import DocumentPreview from '../../components/jpt/DocumentPreview';
import {useBL} from '../../i18n/bl.mjs';
import {isRegisterArchived} from '../BL/registerModel.mjs';
import {deliveryOrders} from './deliveryOrderModel.mjs';

export function DeliveryOrderCell({bill,readonly=false,onManage}){
 const {t}=useBL(),current=deliveryOrders(bill)[0],locked=readonly||isRegisterArchived(bill);
 return <div className="space-y-1 min-w-36" data-delivery-order-cell><p className="text-xs">{t(current?'DO sudah diunggah':'Belum diunggah')}</p>{current&&<p className="text-xs break-all">{current.originalName}</p>}<Button size="sm" variant="secondary" disabled={!onManage||!current&&locked} onClick={()=>onManage(bill)}>{t(current?'Lihat DO':'Unggah DO')}</Button></div>;
}

export default function BillDeliveryOrder({bill,readonly=false,onClose,onSaved}){
 const {t}=useBL(),resource=useResource(`/bl-register/${bill.id}/files`),input=useRef(null),inFlight=useRef(false);
 const [file,setFile]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[committed,setCommitted]=useState(false),[conflict,setConflict]=useState(false),[preview,setPreview]=useState(null),[deleting,setDeleting]=useState(null),[reason,setReason]=useState(''),[recoveredRead,setRecoveredRead]=useState(false);
 const loadError=recoveredRead?'':resource.error;
 const rows=deliveryOrders(bill,resource.data),current=rows[0],locked=readonly||isRegisterArchived(bill),blocked=busy||committed||conflict||resource.loading||!!loadError||!Number.isInteger(resource.data?.version);
 const clear=()=>{setFile(null);setDeleting(null);setReason('');if(input.current)input.current.value='';};
 const refresh=async()=>{
  try{const response=await api.get(`/bl-register/${bill.id}/files`);resource.update(response.data);await onSaved?.();clear();setCommitted(false);setConflict(false);setRecoveredRead(true);setError('');}
  catch(e){setError(t(committed?'Perubahan sudah tersimpan. Muat ulang data tanpa mengirim ulang.':'Gagal memuat ulang data.')+' '+(e.response?.data?.message||e.message));}
 };
 const reload=async()=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);try{await refresh();}finally{inFlight.current=false;setBusy(false);}};
 const mutate=async(kind)=>{
  if(locked||blocked||inFlight.current||kind==='upload'&&(!file||file.size>5*1024*1024)||kind==='delete'&&(!deleting||!reason.trim()||!rows.some(r=>r.id===deleting.id)))return;
  inFlight.current=true;setBusy(true);setError('');let saved=false;
  try{
   let response;
   if(kind==='upload'){const body=new FormData();body.append('file',file);body.append('version',String(resource.data.version));body.append('category','DELIVERY_ORDER');response=await api.post(`/bl-register/${bill.id}/files`,body);}
   else response=await api.post(`/bl-register/${bill.id}/files/delete`,{version:resource.data.version,fileIds:[deleting.id],reason:reason.trim()});
   saved=true;setCommitted(true);resource.update(response.data);clear();
   const fresh=await api.get(`/bl-register/${bill.id}/files`);resource.update(fresh.data);await onSaved?.();setCommitted(false);
  }catch(e){if(!saved)setConflict(e.response?.status===409);setError(saved?t('Perubahan sudah tersimpan. Muat ulang data tanpa mengirim ulang.'):e.response?.data?.message||e.message);}
  finally{inFlight.current=false;setBusy(false);}
 };
 const download=async row=>{setError('');try{const response=await api.get(`/bl-register/${bill.id}/files/${row.id}`,{responseType:'blob'});const url=URL.createObjectURL(response.data);const a=document.createElement('a');a.href=url;a.download=row.originalName||'DO';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e.response?.data?.message||e.message);}};
 return <DetailModal title={t('Delivery Order (DO)')} onClose={()=>!busy&&onClose()}><section className="space-y-4" data-bill-delivery-order>
  <p className="font-semibold">{bill.billNumber||t('Draf / B/L menyusul')}</p>
  <Notice message={error||loadError}/>{(committed||conflict||loadError)&&<Button variant="secondary" disabled={busy} onClick={reload}>{t('Muat ulang data')}</Button>}
  {resource.loading?<p>{t('Memuat ruang kerja…')}</p>:current?<div className="card p-3 space-y-2"><p>{t('DO sudah diunggah')}</p><p className="break-all">{current.originalName}</p>{(current.externalNumber||current.documentDate)&&<p className="text-sm">{[current.externalNumber,current.documentDate?.slice(0,10)].filter(Boolean).join(' · ')}</p>}<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={()=>setPreview(current)}>{t('Lihat DO')}</Button><Button variant="secondary" onClick={()=>download(current)}>{t('Unduh DO')}</Button>{!locked&&<Button variant="danger" disabled={blocked} onClick={()=>{setDeleting(current);setReason('');}}>{t('Hapus DO')}</Button>}</div></div>:<p>{t('Belum diunggah')}</p>}
  {!locked&&<fieldset disabled={blocked} className="space-y-3"><label className="block text-sm">{t('File DO')}<input ref={input} aria-label="File DO" type="file" className="input-field" onChange={e=>{const f=e.target.files?.[0]||null;setFile(f);setError(f?.size>5*1024*1024?t('Maksimal 5 MB per file.'): '');}}/></label><Button disabled={blocked||!file||file.size>5*1024*1024} onClick={()=>mutate('upload')}>{t(current?'Ganti DO':'Unggah DO')}</Button></fieldset>}
  {rows.length>1&&<details><summary>{t('Riwayat DO')} ({rows.length-1})</summary>{rows.slice(1).map(row=><div key={row.id} className="card p-3 space-y-2"><p className="break-all">{row.originalName}</p><Button variant="secondary" onClick={()=>setPreview(row)}>{t('Lihat')}</Button> <Button variant="secondary" onClick={()=>download(row)}>{t('Unduh asli')}</Button></div>)}</details>}
  {deleting&&<div className="card p-3 space-y-3"><p>{t('Hapus DO')} · {deleting.originalName}</p><label className="block text-sm">{t('Alasan penghapusan')}<textarea aria-label="Alasan penghapusan DO" className="input-field" maxLength={2000} disabled={blocked} value={reason} onChange={e=>setReason(e.target.value)}/></label><Button variant="danger" disabled={blocked||!reason.trim()} onClick={()=>mutate('delete')}>{t('Konfirmasi hapus DO')}</Button> <Button variant="secondary" disabled={busy} onClick={()=>setDeleting(null)}>{t('Batal')}</Button></div>}
  {preview&&<DetailModal title={t('Lihat DO')} onClose={()=>setPreview(null)}><DocumentPreview endpoint={`/bl-register/${bill.id}/files/${preview.id}`} name={preview.originalName} mimeType={preview.mimeType}/></DetailModal>}
 </section></DetailModal>;
}

import {useEffect,useId,useRef,useState} from 'react';
import api from '../../api/client';
import {Button,Modal,StatusBadge} from '../../components/common';
import {DataTable,DetailModal,Notice,useResource} from '../../components/jpt/Workspace';
import DocumentPreview from '../../components/jpt/DocumentPreview';

import PartnerPackingSummary from './PartnerPackingSummary';
import {useBL} from '../../i18n/bl.mjs';
import {isRegisterArchived} from './registerModel.mjs';
import {printInternalPacking} from './internalPackingPrint.mjs';
import {printVoyagePacking} from './voyagePackingPrint.mjs';
import {Link} from 'react-router-dom';
import {documentOptions,documentVisible,isReceiptReference} from '../Shipments/documentOwnership.mjs';
export default function RegisterDocuments({bill,onVersion,owner='SUPPORTING'}) {
 const {t}=useBL();const resource=useResource(bill.id?`/bl-register/${bill.id}/files`:null);
 const [file,setFile]=useState(null);const [category,setCategory]=useState(owner==='BL'?'FINAL':owner==='PACKING'?'PACKING_LIST':'SUPPORTING');const [note,setNote]=useState('');
 const [externalNumber,setExternalNumber]=useState('');const [documentDate,setDocumentDate]=useState('');const referenceRequired=['RECEIVING_REPORT','DELIVERY_ORDER'].includes(category);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [fileError,setFileError]=useState('');const [success,setSuccess]=useState('');const [conflict,setConflict]=useState(false);const [preview,setPreview]=useState(null);const input=useRef(null);
 const [summaryFile,setSummaryFile]=useState(null);
 const [deleting,setDeleting]=useState(null);const [reason,setReason]=useState('');const deleteForm=useId();
 const rows=(Array.isArray(resource.data)?resource.data:resource.data?.data||resource.data?.files||[]).filter(row=>documentVisible(row,owner));
 const [selected,setSelected]=useState([]);const selectAll=useRef(null);
 const chosen=rows.filter(row=>selected.includes(row.id));const one=chosen.length===1?chosen[0]:null;
 useEffect(()=>{setSelected([]);},[bill.id]);
 useEffect(()=>{if(selectAll.current)selectAll.current.indeterminate=chosen.length>0&&chosen.length<rows.length;},[chosen.length,rows.length]);
 const toggle=id=>setSelected(ids=>ids.includes(id)?ids.filter(value=>value!==id):[...ids,id]);
 const has=category=>(Array.isArray(resource.data)?resource.data:resource.data?.data||resource.data?.files||[]).some(row=>row.category===category);const policy=bill.register?.documentPolicy||'BL_ONLY';
 const choose=event=>{const selected=event.target.files?.[0]||null;setFile(selected);setFileError(selected&&selected.size>5*1024*1024?'File too large. Maximum size is 5MB.':'');};
 const upload=async()=>{
  if(!file||fileError||busy||isRegisterArchived(bill)||conflict||referenceRequired&&(!externalNumber.trim()||!documentDate))return;
  setBusy(true);setError('');setSuccess('');
  try{
   const payload=new FormData();payload.append('file',file);payload.append('version',String(bill.version));payload.append('category',category);payload.append('note',note);
   if(referenceRequired){payload.append('externalNumber',externalNumber);payload.append('documentDate',documentDate);}
   const uploaded=(await api.post(`/bl-register/${bill.id}/files`,payload)).data;const added=uploaded.data?.find(row=>!rows.some(old=>old.id===row.id)&&row.category==='PACKING_LIST');
   const [confirmed,history]=await Promise.all([api.get(`/bl-register/${bill.id}`),api.get(`/bl-register/${bill.id}/files`)]);
   resource.update(history.data);await onVersion?.(confirmed.data.version);setFile(null);setNote('');setExternalNumber('');setDocumentDate('');if(input.current)input.current.value='';setSuccess('Dokumen tersimpan. Riwayat file sebelumnya tetap tersedia.');if(added)setSummaryFile(added);
  }catch(error){const stale=error.response?.status===409&&/changed|reload|version/i.test(error.response?.data?.message||'');setConflict(stale);setError(stale?'Data telah berubah. Muat ulang sebelum mengunggah lagi; file pilihan tetap dipertahankan.':error.response?.data?.message||error.message);}
  finally{setBusy(false);}
 };
 const remove=async event=>{
  event.preventDefault();if(!deleting||busy||conflict||isRegisterArchived(bill)||!reason.trim())return;
  setBusy(true);setError('');setSuccess('');
  try{
   const response=await api.post(`/bl-register/${bill.id}/files/delete`,{fileIds:deleting.map(row=>row.id),version:bill.version,reason:reason.trim()});
   resource.update(response.data);await onVersion?.(response.data.version);setDeleting(null);setReason('');setSelected([]);
   const message=response.data.sharedFileRetained?'Lampiran dilepas dari pengiriman ini. Berkas tetap tersedia pada pengiriman atau sumber lain yang masih menggunakannya.':'Lampiran berhasil dihapus.';
   setSuccess([message,...(response.data.requiresPackingReview?['Periksa kembali transkripsi dan buat ulang Kepala Packing List bila diperlukan.']:[]),...(response.data.cleanupPending?['Pembersihan berkas di penyimpanan masih diproses otomatis.']:[])]);
  }catch(err){const stale=err.response?.status===409&&/changed|reload|version/i.test(err.response?.data?.message||'');setConflict(stale);setError(stale?'Data pengiriman telah berubah. Muat ulang sebelum menghapus lampiran.':err.response?.data?.message||err.message);}
  finally{setBusy(false);}
 };
 const refresh=async()=>{setBusy(true);try{await onVersion?.();resource.update((await api.get(`/bl-register/${bill.id}/files`)).data);setDeleting(null);setReason('');setConflict(false);setError('');}catch(err){setError(err.response?.data?.message||err.message);}finally{setBusy(false);}};
 const download=async row=>{setError('');try{const response=await api.get(`/bl-register/${bill.id}/files/${row.id}`,{responseType:'blob'});const url=URL.createObjectURL(response.data);const link=document.createElement('a');link.href=url;link.download=row.originalName||'dokumen';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){setError(error.response?.data?.message||error.message);}};
 const downloadSelected=async()=>{if(!chosen.length||busy)return;setBusy(true);setError('');try{if(one)await download(one);else{const response=await api.post(`/bl-register/${bill.id}/files/download`,{fileIds:chosen.map(row=>row.id)},{responseType:'blob',timeout:60000});const url=URL.createObjectURL(response.data);const link=document.createElement('a');link.href=url;link.download='dokumen-pengiriman.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}catch(e){setError(e.response?.data?.message||e.message);}finally{setBusy(false);}};
 const printSelected=async()=>{if(!one||busy)return;setBusy(true);setError('');try{const response=await api.get(`/bl-register/${bill.id}/files/${one.id}/packing-output`);if(response.data.kind==='VOYAGE_PACKING')printVoyagePacking(response.data);else printInternalPacking(response.data);}catch(e){setError(e.response?.data?.message||e.message);}finally{setBusy(false);}};
 return <section className="card p-5 space-y-4" data-register-documents data-document-owner={owner}>
  <h2 className="font-semibold">{t(owner==='BL'?'File B/L':owner==='PACKING'?'File Packing List & Rekap':'Dokumen pendukung pengiriman')}</h2><p className="text-sm text-zinc-400">{t(owner==='BL'?'File B/L dikelola di sini tanpa membuat register ganda.':owner==='PACKING'?'Packing List mitra, Packing List internal, dan rekap dikelola melalui bagian ini.':'B/L dan Packing List dikelola melalui tab masing-masing. Dokumen di halaman ini hanya untuk berkas pendukung.')}</p>
  {owner==='BL'&&<div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">{[
   ['B/L',resource.data?.availability?.billOfLading??bill.documentAvailability?.billOfLading??(has('DRAFT')||has('FINAL')),'Wajib'],
   ['Packing List mitra',has('PACKING_LIST'),policy==='BL_AND_PACKING'?'Wajib dari mitra':'Tidak diwajibkan'],
   ['Packing List internal',resource.data?.availability?.internalPackingList??bill.documentAvailability?.internalPackingList??has('INTERNAL_PACKING_LIST'),policy==='BL_ONLY'?'Perlu dibuat SCMU':'Opsional'],
   ['Pemeriksaan lapangan',bill.documentAvailability?.fieldInspection==='CONFIRMED',bill.documentAvailability?.fieldInspection==='STALE'?'Perlu diperiksa ulang':bill.documentAvailability?.fieldInspection==='DRAFT'?'Draf pemeriksaan':'Belum diperiksa'],
  ].map(([label,ready,expectation])=><div key={label} className="rounded-lg border border-zinc-800 p-3 text-sm"><p className="text-zinc-200">{t(label)}</p><p className={ready?'mt-1 text-emerald-400':'mt-1 text-zinc-500'}>{ready?t('Sudah tersedia'):t(expectation)}</p></div>)}</div>}
  <div className="flex flex-wrap gap-2">{['receiptStatus','internalStatus','releaseStatus'].map(key=>{const value=bill.documentSummary?.[key]||bill[key];return value?<span key={key} data-document-status={value}><StatusBadge status={value}/></span>:null;})}</div>
  <p className="text-xs text-zinc-400">{t('File tersimpan belum berarti B/L terverifikasi atau barang dilepas oleh pelayaran.')}</p>
  <Notice message={fileError||error||resource.error}/>{success&&<p role="status" className="text-sm text-emerald-300">{Array.isArray(success)?success.map(message=>t(message)).join(' '):t(success)}</p>}
  {conflict&&<Button type="button" variant="secondary" disabled={busy} onClick={refresh}>{t('Muat ulang data')}</Button>}
  <fieldset disabled={!bill.id||isRegisterArchived(bill)||busy||conflict} className="grid sm:grid-cols-2 gap-3">
   <label className="space-y-1"><span className="text-xs text-zinc-400">{t('File dokumen')}</span><input ref={input} aria-label={t('File dokumen')} className="input-field" type="file" onChange={choose}/></label>
   <label className="space-y-1"><span className="text-xs text-zinc-400">{t('Kategori dokumen')}</span><select className="input-field" aria-label={t('Kategori dokumen')} value={category} onChange={event=>setCategory(event.target.value)}>{documentOptions(owner).map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></label>
   {referenceRequired&&<><label className="space-y-1"><span className="text-xs text-zinc-400">{t('Nomor dokumen sumber')}</span><input className="input-field" aria-label={t('Nomor dokumen sumber')} maxLength={100} value={externalNumber} onChange={e=>setExternalNumber(e.target.value)}/></label><label className="space-y-1"><span className="text-xs text-zinc-400">{t('Tanggal dokumen sumber')}</span><input className="input-field" aria-label={t('Tanggal dokumen sumber')} type="date" value={documentDate} onChange={e=>setDocumentDate(e.target.value)}/></label></>}
   <label className="space-y-1"><span className="text-xs text-zinc-400">{t('Catatan dokumen')}</span><input aria-label={t('Catatan dokumen')} className="input-field" maxLength={2000} value={note} onChange={event=>setNote(event.target.value)}/></label>
   <div className="flex items-end"><Button type="button" disabled={!file||!!fileError||!bill.id||isRegisterArchived(bill)||busy||conflict||referenceRequired&&(!externalNumber.trim()||!documentDate)} onClick={upload}>{t(busy?'Mengunggah?':'Unggah dokumen')}</Button></div>
  </fieldset>
  <p className="text-xs text-zinc-500">{t('Semua format dokumen, maksimal 5 MB. File yang tidak dapat dipratinjau tetap bisa diunduh.')}</p>
  {owner==='SUPPORTING'&&<Link className="text-brand-500 text-sm" to={bill.journeyId?`/shipments/${bill.journeyId}?tab=driver-bons`:'?tab=driver-bons'}>{t('Bukti Serah Terima Barang dikelola melalui Bonrate Sopir.')}</Link>}
  {!bill.id&&<p className="text-sm text-zinc-500">{t('Simpan pengiriman terlebih dahulu untuk mengaktifkan unggah di bagian ini.')}</p>}
  <div className="rounded-xl border border-zinc-700 p-3 flex flex-wrap items-center gap-2" role="toolbar" aria-label={t('Tindakan dokumen')} data-document-toolbar>
   <label className="flex items-center gap-2 text-sm mr-2"><input ref={selectAll} type="checkbox" aria-label={t('Pilih semua dokumen')} checked={rows.length>0&&chosen.length===rows.length} disabled={!rows.length||busy} onChange={e=>setSelected(e.target.checked?rows.map(row=>row.id):[])}/>{t('Pilih semua')}</label>
   <span role="status" className="text-sm text-zinc-400 mr-auto">{chosen.length} {t('dokumen dipilih')}</span>
   <Button type="button" size="sm" variant="secondary" disabled={!one||busy} onClick={()=>setPreview(one)}>{t('View')}</Button>
   <Button type="button" size="sm" variant="secondary" disabled={!chosen.length||busy} onClick={downloadSelected}>{t(chosen.length>1?'Unduh ZIP':one?.category==='INTERNAL_PACKING_LIST'&&/\.xlsx$/i.test(one.originalName)?'Unduh Excel':'Unduh asli')}</Button>
   <Button type="button" size="sm" variant="secondary" disabled={!one||!(one.category==='INTERNAL_PACKING_LIST'||one.category==='INTERNAL_PACKING_RECAP'&&one.note?.startsWith('Rekap Packing List kapal;'))||busy} onClick={printSelected}>{t('Cetak / Simpan PDF')}</Button>
   <Button type="button" size="sm" variant="secondary" disabled={!one||one.category!=='PACKING_LIST'||busy} onClick={()=>setSummaryFile(one)}>{t('Ringkasan PL')}</Button>
   <Button type="button" size="sm" variant="danger" disabled={!chosen.length||busy||conflict||isRegisterArchived(bill)||chosen.some(row=>isReceiptReference(row,owner))} onClick={()=>{setError('');setReason('');setDeleting(chosen);}}>{t('Hapus lampiran')}</Button>
  </div>
  <p className="text-xs text-zinc-500">{t('Pilih satu dokumen untuk melihat. PDF tersedia untuk PL internal dan rekap kapal yang dibuat sistem. Beberapa dokumen diunduh sebagai ZIP.')}</p>
  <DataTable rows={rows.map((row,index)=>({...row,rowNumber:index+1}))} resetKey={bill.id} empty="Belum ada dokumen pada B/L ini." columns={[
   {key:'selected',label:t('Pilih'),className:'sticky left-0 bg-white w-12',render:row=><input type="checkbox" aria-label={`${t('Pilih dokumen')} ${row.originalName}`} checked={selected.includes(row.id)} disabled={busy} onChange={()=>toggle(row.id)}/>},
   {key:'rowNumber',label:'No.',className:'w-12 tabular-nums'},
   {key:'originalName',label:t('File dokumen'),className:'min-w-64 max-w-sm whitespace-normal break-words',render:row=><div>{row.originalName}{isReceiptReference(row,owner)&&<small className="block text-zinc-500">{t('Referensi baca saja · dikelola melalui Bonrate Sopir')}</small>}{row.category==='PACKING_LIST'&&<small className="block text-zinc-500 mt-1">{t(bill.registerData?.partnerPackingSummaries?.[row.id]?'File tersimpan · ringkasan siap':(bill.registerData?.operational?.packing?.groups||[]).some(g=>g.sourceFileId===row.id)?'File tersimpan ? rincian disiapkan':'File tersimpan ? rincian belum disiapkan')}</small>}</div>},
   {key:'category',label:t('Kategori dokumen'),render:row=>t(({DRAFT:'B/L draft',FINAL:'B/L final',PACKING_LIST:'Packing List mitra',INTERNAL_PACKING_LIST:'Packing List internal',INTERNAL_PACKING_RECAP:'Rekap Packing List internal',PACKING_HEADER:'Kepala Packing List',RECEIVING_REPORT:'Berita Acara',INVOICE:'Invoice/tagihan',DELIVERY_ORDER:'Delivery Order (DO)',MANIFEST:'Manifest',WAYBILL:'Surat jalan',POD:'Bukti serah terima/POD',TAX_INVOICE:'Faktur pajak',PPH23_CERTIFICATE:'Bukti potong PPh 23',DRIVER_BON:'Bonrate sopir',SUPPORTING:'Dokumen pendukung'})[row.category]||row.category)},{key:'createdAt',label:t('Date'),render:row=>row.createdAt?.slice(0,10)||'?'},
   {key:'note',label:t('Catatan dokumen'),className:'min-w-48 max-w-sm whitespace-normal break-words'},
  ]}/>
  {summaryFile&&<PartnerPackingSummary bill={bill} file={summaryFile} onClose={()=>setSummaryFile(null)} onSaved={async()=>{await onVersion?.();resource.reload();}}/>}
  {preview&&<DetailModal title="Document preview" onClose={()=>setPreview(null)}><DocumentPreview endpoint={`/bl-register/${bill.id}/files/${preview.id}`} name={preview.originalName} mimeType={preview.mimeType}/></DetailModal>}
  {deleting&&<Modal open title={t('Hapus lampiran')} width="max-w-lg" onClose={()=>!busy&&setDeleting(null)} footer={<div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={()=>setDeleting(null)}>{t('Cancel')}</Button><Button type="submit" form={deleteForm} variant="danger" disabled={busy||conflict||!reason.trim()}>{t(busy?'Menghapus…':'Hapus lampiran')}</Button></div>}>
   <form id={deleteForm} onSubmit={remove} className="space-y-4"><p className="text-sm text-zinc-300">{t('Lampiran yang dipilih akan dihapus dari pengiriman ini. Data pengiriman, kontainer, dan dokumen lainnya tetap tersimpan.')}</p><ul className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm font-medium break-words max-h-48 overflow-y-auto">{deleting.map(row=><li key={row.id}>{row.originalName}</li>)}</ul><p className="text-xs text-zinc-400">{t('Pemeriksaan yang memakai lampiran ini perlu diulang. Berkas yang masih digunakan pengiriman lain tetap tersedia di sana.')}</p><Notice message={error}/><label className="block space-y-1.5"><span className="text-sm text-zinc-300">{t('Alasan penghapusan')}</span><textarea className="input-field" aria-label={t('Alasan penghapusan')} required maxLength={2000} rows={3} disabled={busy||conflict} value={reason} onChange={e=>setReason(e.target.value)} placeholder={t('Contoh: salah memilih file B/L saat mengunggah.')}/></label>{conflict&&<Button type="button" variant="secondary" disabled={busy} onClick={refresh}>{t('Muat ulang data')}</Button>}</form>
  </Modal>}
 </section>;
}

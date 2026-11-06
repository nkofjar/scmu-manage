import {useState} from 'react';
import api from '../../api/client';
import {Button} from '../../components/common';
import {DetailModal,Notice,useResource} from '../../components/jpt/Workspace';
import {useBL} from '../../i18n/bl.mjs';
import {documentOwner} from './documentOwnership.mjs';

export default function DeleteBillFiles({bill,onClose,onSaved}){
 const {t}=useBL(),resource=useResource(`/bl-register/${bill.id}/files`);
 const [selected,setSelected]=useState([]),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[completed,setCompleted]=useState(false);
 const rows=(resource.data?.data||[]).filter(f=>documentOwner(f.category)==='BL');
 const refresh=async()=>{setBusy(true);setError('');try{await onSaved();onClose();}catch(e){setError(t('Lampiran sudah dihapus, tetapi tampilan belum diperbarui. Muat ulang data tanpa menghapus ulang.')+' '+(e.response?.data?.message||e.message));}finally{setBusy(false);}};
 const submit=async event=>{event.preventDefault();if(completed||busy||resource.loading||!!resource.error||conflict||!selected.length||!reason.trim())return;setBusy(true);setError('');try{
  await api.post(`/bl-register/${bill.id}/files/delete`,{fileIds:selected,version:resource.data.version,reason:reason.trim()});setCompleted(true);setSelected([]);await refresh();
 }catch(e){setConflict(e.response?.status===409);setError(e.response?.data?.message||e.message);}finally{setBusy(false);}};
 return <DetailModal title={t('Hapus file B/L')} onClose={()=>!busy&&onClose()} width="max-w-xl"><form data-bl-file-delete onSubmit={submit} className="space-y-4">
  <p className="font-semibold">{bill.billNumber||t('Draf / B/L menyusul')}</p>
  <p className="text-sm text-zinc-500">{t('Hanya lampiran B/L yang dilepas. Catatan B/L, kontainer, Packing List, dan bonrate tetap tersimpan. Status pemeriksaan dokumen dapat perlu diperbarui.')}</p>
  <Notice message={error||resource.error}/>
  {resource.loading?<p>{t('Memuat ruang kerja…')}</p>:<fieldset disabled={busy||conflict||completed} className="space-y-2">{rows.map(f=><label key={f.id} className="flex gap-2 text-sm"><input type="checkbox" checked={selected.includes(f.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,f.id]:ids.filter(id=>id!==f.id))}/><span className="break-all">{f.originalName}</span></label>)}{!rows.length&&<p>{t('Belum ada file B/L.')}</p>}</fieldset>}
  <label className="block text-sm space-y-1">{t('Alasan penghapusan')}<textarea aria-label={t('Alasan penghapusan')} className="input-field" required maxLength={2000} value={reason} disabled={busy||conflict||completed} onChange={e=>setReason(e.target.value)}/></label>
  {completed&&<p role="status">{t('Lampiran B/L sudah dihapus.')}</p>}
  {completed&&<Button type="button" variant="secondary" disabled={busy} onClick={refresh}>{t('Muat ulang data')}</Button>}
  {conflict&&!completed&&<Button type="button" variant="secondary" disabled={busy} onClick={()=>{resource.reload();setSelected([]);setConflict(false);setError('');}}>{t('Muat ulang data')}</Button>}
  <Button type="submit" variant="danger" disabled={completed||busy||resource.loading||!!resource.error||conflict||!selected.length||!reason.trim()}>{t(busy?'Menghapus…':'Konfirmasi hapus lampiran')}</Button>
 </form></DetailModal>;
}

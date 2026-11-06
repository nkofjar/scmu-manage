import {useState} from 'react';
import api from '../../api/client';
import {Button} from '../../components/common';
import {DataTable,DetailModal,Notice,useResource} from '../../components/jpt/Workspace';
import DocumentPreview from '../../components/jpt/DocumentPreview';
import {DriverDeliveriesSummary} from './DriverDeliveriesEditor';
import {useTransport} from '../../i18n/transport.mjs';
export default function DriverDispatch({billId,work,version,readonly=false,onChanged,onClose}){
 const {t}=useTransport(),base=`/bl-register/${billId}/driver-operations/works/${work.id}`,resource=useResource(base+'/dispatches');
 const [documentType,setDocumentType]=useState('TRANSPORT_ORDER'),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[committed,setCommitted]=useState(null),[error,setError]=useState(''),[view,setView]=useState(null);
 const issue=async()=>{if(busy||committed||readonly||work.status==='CANCELLED'||!confirmed)return;setBusy(true);setError('');try{
  const saved=(await api.post(base+'/dispatch',{version,documentType,confirmed:true})).data;
  setCommitted(saved);setConfirmed(false);resource.reload();
  try{await onChanged?.();}catch(e){setError(t('Tersimpan; muat ulang riwayat tanpa menerbitkan lagi.')+' '+(e.response?.data?.message||e.message));}
 }catch(e){setError(e.response?.data?.message||e.message);}finally{setBusy(false);}};
 const rows=[...new Map([...(resource.data?.data||[]),...(committed?[committed]:[])].map(d=>[d.id,d])).values()];
 return <DetailModal title={t('Surat tugas / jalan')} onClose={()=>{if(!busy)onClose();}} actions={!readonly&&work.status!=='CANCELLED'&&!committed&&<Button disabled={busy||!confirmed||!work.taskDate} onClick={issue}>{t('Terbitkan PDF')}</Button>}><div className="space-y-4" data-driver-dispatch>
 <Notice message={error||resource.error}/><h3 className="font-semibold">{t('Pratinjau penugasan')}</h3>
 <dl className="grid sm:grid-cols-2 gap-3 text-sm">{[['Nomor bon',work.number],['Tanggal tugas',work.taskDate],['Nama sopir',work.driverName],['Nomor plat',work.vehicleNumber],['Kontainer',work.containerNumber],['Rute',[work.origin,work.destination].filter(Boolean).join(' → ')],['Instruksi',work.instructions]].map(([label,value])=><div key={label}><dt className="text-zinc-500">{t(label)}</dt><dd className="whitespace-pre-wrap break-words">{value||''}</dd></div>)}</dl><DriverDeliveriesSummary work={work}/>
 {!readonly&&work.status!=='CANCELLED'&&!committed&&<fieldset disabled={busy} className="space-y-3"><label className="block text-sm">{t('Jenis dokumen')}<select className="input-field" aria-label={t('Jenis dokumen')} value={documentType} onChange={e=>{setDocumentType(e.target.value);setConfirmed(false);}}><option value="TRANSPORT_ORDER">{t('Surat tugas angkutan')}</option><option value="DELIVERY_NOTE">{t('Surat jalan')}</option></select></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{t('Saya mengonfirmasi penugasan ini.')}</label></fieldset>}
 <div className="flex justify-between gap-3"><h3 className="font-semibold">{t('Riwayat terbit')}</h3><Button variant="secondary" onClick={()=>{resource.reload();setError('');}}>{t('Muat ulang')}</Button></div>
 <DataTable rows={rows} actionPlacement="row" columns={[{key:'number',label:t('Nomor dokumen')},{key:'documentType',label:t('Jenis dokumen'),render:r=>t(r.documentType==='TRANSPORT_ORDER'?'Surat tugas angkutan':'Surat jalan')},{key:'taskDate',label:t('Tanggal tugas')},{key:'createdAt',label:t('Tanggal terbit')},{key:'actions',label:t('Tindakan'),items:[{key:'view',label:t('Lihat'),onClick:setView}]}]}/>
 {view&&<DocumentPreview endpoint={base+'/dispatches/'+view.id+'/pdf'} name={view.number+'.pdf'} mimeType="application/pdf"/>}
 </div></DetailModal>;
}

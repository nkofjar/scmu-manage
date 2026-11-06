import {useState} from 'react';
import api from '../../api/client';
import {Button} from '../../components/common';
import {DataTable,DetailModal,Notice,useResource} from '../../components/jpt/Workspace';
import DocumentPreview from '../../components/jpt/DocumentPreview';
import {DriverDeliveriesSummary} from './DriverDeliveriesEditor';
import {completedDriverWork} from './driverDeliveriesModel.mjs';
import {useTransport} from '../../i18n/transport.mjs';
export default function DriverDispatch({billId,journeyId,work,version,readonly=false,onChanged,onClose}){
 const {t}=useTransport(),postDelivery=work.recordingPolicy==='POST_DELIVERY',base=`${journeyId?'/journeys/'+journeyId:'/bl-register/'+billId}/driver-operations/works/${work.id}`,resource=useResource(base+'/dispatches');
 const [documentType,setDocumentType]=useState(postDelivery?'BONRATE':'TRANSPORT_ORDER'),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[committed,setCommitted]=useState(null),[error,setError]=useState(''),[view,setView]=useState(null);
 const rows=[...new Map([...(resource.data?.data||[]),...(committed?[committed]:[])].map(d=>[d.id,d])).values()];
 const issued=postDelivery&&(work.bonrateIssued||rows.some(d=>d.documentType==='BONRATE'));
 const canIssue=!readonly&&work.status!=='CANCELLED'&&!committed&&!issued;
 const ready=postDelivery?completedDriverWork(work)&&Boolean(work.driverName?.trim()&&work.vehicleNumber?.trim()):Boolean(work.taskDate);
 const issue=async()=>{if(busy||!canIssue||!ready||(!postDelivery&&!confirmed))return;setBusy(true);setError('');try{
  const saved=(await api.post(base+'/dispatch',{version,documentType:postDelivery?'BONRATE':documentType,...(!postDelivery?{confirmed:true}:{})})).data;
  setCommitted(saved);if(postDelivery)setView(saved);setConfirmed(false);resource.reload();
  try{await onChanged?.();}catch(e){setError(t('Tersimpan; muat ulang riwayat tanpa menerbitkan lagi.')+' '+(e.response?.data?.message||e.message));}
 }catch(e){setError(e.response?.data?.message||e.message);}finally{setBusy(false);}};
 const title=postDelivery?'SURAT JALAN MOBIL / BONRATE '+work.rateType:t('Surat tugas / jalan');
 return <DetailModal title={title} onClose={()=>{if(!busy)onClose();}} actions={canIssue&&<Button disabled={busy||(!postDelivery&&!confirmed)||!ready} onClick={issue}>{t(postDelivery?'Cetak Bonrate':'Terbitkan PDF')}</Button>}><div className="space-y-4" data-driver-dispatch>
 <Notice message={error||resource.error}/><h3 className="font-semibold">{postDelivery?title:t('Pratinjau penugasan')}</h3>
 {postDelivery&&<p className="text-sm">{t('Bonrate dapat dicetak setelah seluruh serah terima dan identitas sopir serta kendaraan lengkap. Gunakan riwayat untuk mencetak ulang PDF yang tersimpan.') }</p>}
 <dl className="grid sm:grid-cols-2 gap-3 text-sm">{[['Nomor bon',work.number],[postDelivery?'Tanggal selesai aktual':'Tanggal tugas',postDelivery?work.receivedDate:work.taskDate],['Nama sopir',work.driverName],['Nomor plat',work.vehicleNumber],['Kontainer',work.containerNumber],['Rute',[work.origin,work.destination].filter(Boolean).join(' → ')],...(!postDelivery?[['Instruksi',work.instructions]]:[])].map(([label,value])=><div key={label}><dt className="text-zinc-500">{t(label)}</dt><dd className="whitespace-pre-wrap break-words">{value||''}</dd></div>)}</dl><DriverDeliveriesSummary work={work}/>
 {canIssue&&<fieldset disabled={busy} className="space-y-3"><label className="block text-sm">{t('Jenis dokumen')}<select className="input-field" aria-label={t('Jenis dokumen')} value={documentType} onChange={e=>{setDocumentType(e.target.value);setConfirmed(false);}}>{postDelivery?<option value="BONRATE">{title}</option>:<><option value="TRANSPORT_ORDER">{t('Surat tugas angkutan')}</option><option value="DELIVERY_NOTE">{t('Surat jalan')}</option></>}</select></label>{!postDelivery&&<label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{t('Saya mengonfirmasi penugasan ini.')}</label>}</fieldset>}
 <div className="flex justify-between gap-3"><h3 className="font-semibold">{t('Riwayat terbit')}</h3><Button variant="secondary" onClick={()=>{resource.reload();setError('');}}>{t('Muat ulang')}</Button></div>
 <DataTable rows={rows} actionPlacement="row" columns={[{key:'number',label:t('Nomor dokumen')},{key:'documentType',label:t('Jenis dokumen'),render:r=>r.documentType==='BONRATE'?'SURAT JALAN MOBIL / BONRATE '+(r.rateType||work.rateType):t(r.documentType==='TRANSPORT_ORDER'?'Surat tugas angkutan':'Surat jalan')},{key:postDelivery?'receivedDate':'taskDate',label:t(postDelivery?'Tanggal selesai aktual':'Tanggal tugas')},{key:'createdAt',label:t('Tanggal terbit')},{key:'actions',label:t('Tindakan'),items:[{key:'view',label:t('Lihat'),onClick:setView}]}]}/>
 {view&&<DocumentPreview endpoint={base+'/dispatches/'+view.id+'/pdf'} name={view.number+'.pdf'} mimeType="application/pdf"/>}
 </div></DetailModal>;
}

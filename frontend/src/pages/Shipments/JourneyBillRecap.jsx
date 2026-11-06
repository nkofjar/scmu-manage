import {useState} from 'react';
import {Link} from 'react-router-dom';
import api from '../../api/client';
import {Button} from '../../components/common';
import {DataTable,DetailModal,Notice,useResource} from '../../components/jpt/Workspace';
import {useBL} from '../../i18n/bl.mjs';
const known=value=>value==null?'Belum tercatat':value;
export default function JourneyBillRecap({journeyId,onClose}){
 const {t}=useBL(),resource=useResource('/journeys/'+journeyId+'/bill-recap'),[busy,setBusy]=useState(''),[error,setError]=useState(''),recap=resource.data;
 const download=async extension=>{
  if(busy)return;setBusy(extension);setError('');
  try{const response=await api.get('/journeys/'+journeyId+'/bill-recap.'+extension,{responseType:'blob'}),url=URL.createObjectURL(response.data),a=document.createElement('a');a.href=url;a.download='rekapan-bl.'+extension;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  catch(e){setError(e.response?.data?.message||e.message);}finally{setBusy('');}
 };
 return <DetailModal title="Rekapan B/L" onClose={onClose} actions={<><Button variant="secondary" disabled={!recap||resource.loading||!!busy} onClick={()=>download('pdf')}>{t('Unduh PDF')}</Button><Button variant="secondary" disabled={!recap||resource.loading||!!busy} onClick={()=>download('xlsx')}>{t('Unduh Excel')}</Button></>}>
  <div data-journey-bill-recap className="space-y-4 min-w-0"><Notice message={resource.error||error}/>{resource.error&&<Button onClick={resource.reload}>{t('Muat ulang')}</Button>}{resource.loading&&<p>{t('Memuat rekap…')}</p>}
  {recap&&<><div><h2 className="font-semibold">{recap.journey.vesselName} · {recap.journey.voyageNumber}</h2><p className="text-sm">{recap.journey.number} · {recap.journey.period} · {recap.journey.destination}</p></div>
   <p className="text-sm">{recap.totals.bills} B/L · {recap.totals.containers.total} {t('kontainer fisik unik')} · 20 ft: {recap.totals.containers.twenty} · 40 ft: {recap.totals.containers.forty} · {t('Lain / tidak diketahui')}: {recap.totals.containers.other}</p>
   <DataTable pagination={false} rows={recap.bills} columns={[{key:'billNumber',label:'B/L',render:b=><Link className="text-brand-500 underline" to={'/bl-register/'+b.id}>{b.billNumber||b.id}</Link>},{key:'shipperName',label:'Shipper'},{key:'consigneeName',label:'Consignee'},{key:'twenty',label:'20 ft',render:b=>b.counts.twenty},{key:'forty',label:'40 ft',render:b=>b.counts.forty},{key:'other',label:'Lain',render:b=>b.counts.other},{key:'containers',label:'Kontainer',render:b=>b.containers.map(c=>c.number).join(', ')},{key:'cargo',label:'Muatan'},{key:'recordedAmount',label:'Nominal buku (bukan aktual)',render:b=>b.recordedAmount==null?'':b.currency+' '+b.recordedAmount}]}/>
   <h3 className="font-semibold">{t('Keuangan tercatat — sementara')}</h3>
   <DataTable pagination={false} rows={recap.financials.map((f,i)=>({...f,id:i}))} columns={[{key:'currency',label:'Mata uang',render:f=>f.currency||t('Tidak diketahui')},{key:'income',label:'Pendapatan aktual',render:f=>t(known(f.income))},{key:'cost',label:'Biaya aktual',render:f=>t(known(f.cost))},{key:'difference',label:'Selisih tercatat sementara',render:f=>t(known(f.difference))},{key:'status',label:'Status'},{key:'missing',label:'Belum lengkap',render:f=><span>{t('Job pendapatan belum tercatat')}: {f.missingIncomeJobIds.join(', ')}<br/>{t('Job biaya belum tercatat')}: {f.missingCostJobIds.join(', ')}<br/>{t('Usulan / nominal belum lengkap')}: {f.pendingCount}</span>}]}/>
   <h3 className="font-semibold">{t('Rincian transaksi — dihitung satu kali')}</h3>
   <DataTable pagination={false} rows={recap.charges} columns={[{key:'description',label:'Uraian',primary:true},{key:'scope',label:'Lingkup',render:c=>c.shared?t('Bersama'):c.billIds.map(id=>recap.bills.find(b=>b.id===id)?.billNumber||id).join(', ')},{key:'kind',label:'Jenis'},{key:'costSource',label:'Sumber biaya'},{key:'costCategory',label:'Kategori'},{key:'vendor',label:'Vendor'},{key:'status',label:'Status'},{key:'actualAmount',label:'Aktual',render:c=>c.actualAmount==null?t('Belum tercatat'):(c.currency||t('Tidak diketahui'))+' '+c.actualAmount},{key:'estimatedAmount',label:'Estimasi (bukan aktual)'},{key:'counted',label:'Dihitung',render:c=>t(c.counted?'Ya':'Tidak')}]}/>
   <ul className="text-sm text-zinc-400 space-y-1 list-disc pl-5">{recap.notes.map(note=><li key={note}>{t(note)}</li>)}</ul>
  </>}
  </div>
 </DetailModal>;
}

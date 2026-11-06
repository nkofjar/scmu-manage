import {useState} from 'react';
import {Link} from 'react-router-dom';
import api from '../../api/client';
import {Button} from '../../components/common';
import {DataTable,DetailModal,Notice,useResource} from '../../components/jpt/Workspace';
import DocumentPreview from '../../components/jpt/DocumentPreview';
import {printVoyagePacking} from '../BL/voyagePackingPrint.mjs';
import {printInternalPacking} from '../BL/internalPackingPrint.mjs';
import {journeyPackingOutputEndpoint,canPrintJourneyPacking,isVoyageReference} from '../BL/billScope.mjs';
import {useBL} from '../../i18n/bl.mjs';
import {documentDestination} from './documentOwnership.mjs';

// Compatibility archive: mutations belong to their individual workflows.
export default function JourneyDocuments({journey,recapsOnly=false}){
 const {t}=useBL(),resource=useResource('/journeys/'+journey.id+'/files'),[preview,setPreview]=useState(null),[error,setError]=useState('');
 const rows=(resource.data?.data||[]).filter(row=>!recapsOnly||isVoyageReference(row));
 const download=async row=>{try{setError('');const response=await api.get(row.endpoint,{responseType:'blob'}),url=URL.createObjectURL(response.data),a=document.createElement('a');a.href=url;a.download=row.originalName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e.response?.data?.message||e.message);}};
 const print=async row=>{try{setError('');const data=(await api.get(journeyPackingOutputEndpoint(row))).data;if(data.kind==='VOYAGE_PACKING')printVoyagePacking(data);else printInternalPacking(data);}catch(e){setError(e.response?.data?.message||e.message);}};
 return <section className="space-y-4" data-shipment-recap-history={recapsOnly||undefined} data-shipment-file-archive={!recapsOnly||undefined}>
  <h2 className="font-semibold">{t(recapsOnly?'Hasil dan riwayat rekap pengiriman':'Arsip berkas asli')}</h2>
  {recapsOnly&&<p className="text-sm text-zinc-500">{t('Revisi sebelumnya tetap tersimpan. PL mitra dan kepala PL per B/L tersedia di detail B/L masing-masing.')}</p>}
  <Notice message={error||resource.error}/>{resource.error&&<Button variant="secondary" onClick={resource.reload}>{t('Muat ulang data')}</Button>}
  <DataTable mobileCards rows={rows} columns={[
   {key:'originalName',label:'File dokumen',primary:true},
   {key:'category',label:'Kategori dokumen'},
   {key:'createdAt',label:'Tanggal',render:row=>row.createdAt?.slice(0,10)},
   {key:'billNumbers',label:'B/L terkait',render:row=>(row.billIds||[]).map((id,i)=><Link key={id} className="block text-brand-500" to={documentDestination({category:row.category,billId:id,journeyId:journey.id})}>{row.billNumbers?.[i]||id}</Link>)},
   {key:'note',label:'Catatan dokumen'},
   {key:'actions',label:'Tindakan',items:[{key:'view',label:'Lihat',onClick:setPreview},{key:'download',label:'Unduh asli',onClick:download},{key:'print',label:'Cetak / Simpan PDF',disabled:row=>!canPrintJourneyPacking(row),onClick:print}]},
  ]}/>
  {preview&&<DetailModal title="Document preview" onClose={()=>setPreview(null)}><DocumentPreview endpoint={preview.endpoint} name={preview.originalName} mimeType={preview.mimeType}/></DetailModal>}
 </section>;
}
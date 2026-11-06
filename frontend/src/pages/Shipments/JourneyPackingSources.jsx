import {useState} from 'react';
import {Link} from 'react-router-dom';
import {DataTable,DetailModal} from '../../components/jpt/Workspace';
import DocumentPreview from '../../components/jpt/DocumentPreview';
import {useBL} from '../../i18n/bl.mjs';
import {isSharedDocument} from '../BL/billScope.mjs';
export const partnerPackingFiles=bill=>(bill.files||[]).filter(f=>f.category==='PACKING_LIST');
export default function JourneyPackingSources({bills,onManage}){
 const {t}=useBL(),[preview,setPreview]=useState(null);
 return <section data-journey-packing-sources><DataTable mobileCards actionPlacement="row" rows={bills} columns={[
  {key:'billNumber',label:'Nomor B/L',primary:true,render:b=><Link className="font-semibold text-brand-500" to={`/bl-register/${b.id}?tab=packing`}>{b.billNumber||t('Draf / B/L menyusul')}</Link>},
  {key:'partnerPackingCount',label:t('Total PL mitra'),render:b=>partnerPackingFiles(b).length},
  {key:'files',label:t('Packing List mitra'),render:b=><div className="space-y-2">{partnerPackingFiles(b).map(f=><div key={f.id}><button className="text-brand-500 text-left break-all underline" onClick={()=>setPreview({bill:b,file:f})}>{f.originalName||t('Packing List mitra')}</button>{isSharedDocument(f)&&<small className="block text-amber-600">{t('Dokumen bersama')}</small>}</div>)}{!partnerPackingFiles(b).length&&<span>{t('Belum ada PL mitra.')}</span>}</div>},
  {key:'packingStatus',label:t('Status rincian PL'),render:b=>t(b.packingStatus?.detailReady?'Rincian terkonfirmasi':b.registerData?.operational?.packing?.groups?.length?'Rincian belum dikonfirmasi':partnerPackingFiles(b).length?'Rincian PL untuk B/L ini belum dipetakan':'Belum ada rincian PL.')},
  {key:'actions',label:'Tindakan',items:[{key:'packing',label:'Kelola Packing List',onClick:onManage}]},
 ]}/>{preview&&<DetailModal title={t('Document preview')} onClose={()=>setPreview(null)}><p className="font-semibold mb-2">{preview.bill.billNumber}</p><DocumentPreview endpoint={`/bl-register/${preview.bill.id}/files/${preview.file.id}`} name={preview.file.originalName} mimeType={preview.file.mimeType}/></DetailModal>}</section>;
}

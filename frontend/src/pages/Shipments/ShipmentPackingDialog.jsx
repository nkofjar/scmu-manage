import {useState} from 'react';
import api from '../../api/client';
import {Button} from '../../components/common';
import {DetailModal,Notice,useResource} from '../../components/jpt/Workspace';
import {useBL} from '../../i18n/bl.mjs';
import VoyagePacking from '../BL/VoyagePacking';
import JourneyDocuments from './JourneyDocuments';

export default function ShipmentPackingDialog({journeyId,onClose,onSaved}){
 const {t}=useBL(),resource=useResource('/journeys/'+journeyId),[history,setHistory]=useState(false);
 const journey=resource.data;
 const reload=async()=>{resource.update((await api.get('/journeys/'+journeyId)).data);await onSaved?.();};
 if(!journey)return <DetailModal title="Packing List Pengiriman" onClose={onClose}><Notice message={resource.error}/><p>{t('Memuat pengiriman…')}</p></DetailModal>;
 const bills=journey.bills.filter(b=>!b.archived&&!b.deleted&&b.billNumber);
 const blocked=journey.deleted||journey.archived||!bills.length||!journey.vesselName||!journey.voyageNumber;
 const saved=<><Button variant="secondary" onClick={()=>setHistory(value=>!value)} aria-expanded={history}>{t('Hasil tersimpan & revisi')}</Button>{history&&<JourneyDocuments key={journey.version} journey={journey} recapsOnly/>}</>;
 if(blocked)return <DetailModal title="Packing List Pengiriman" onClose={onClose}><p>{t(journey.archived||journey.deleted?'Pengiriman hanya baca.':'Lengkapi nomor B/L, kapal, dan voyage terlebih dahulu.')}</p>{saved}</DetailModal>;
 return <VoyagePacking initialIds={bills.map(b=>b.id)} autoPreview={bills.length<=40} onClose={onClose} onSaved={reload} savedResults={saved}/>;
}

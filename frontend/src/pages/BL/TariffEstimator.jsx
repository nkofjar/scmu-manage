import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { Button } from '../../components/common';
import { Notice, DataTable, useResource } from '../../components/jpt/Workspace';
import { useBL } from '../../i18n/bl.mjs';
import { formatMoney } from '../../utils/format.mjs';
import { selectableTariffs } from './registerModel.mjs';

export default function TariffEstimator({bill,onChanged}) {
 const {t,locale}=useBL();const resource=useResource('/jpt-tariffs');const [selected,setSelected]=useState([]);const [estimate,setEstimate]=useState(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [proposed,setProposed]=useState(false);
 const rows=(resource.data?.data||[]).filter(r=>r.category!=='DRIVER_BON');const allowed=selectableTariffs(rows,bill.containers);const ids=selected.filter(id=>allowed.some(row=>row.id===id));
 const money=value=>formatMoney(value,'IDR',locale);
 const toggle=id=>{setSelected(previous=>previous.includes(id)?previous.filter(value=>value!==id):[...previous,id]);setEstimate(null);setProposed(false);setError('');};
 const run=async propose=>{if(busy)return;if(!ids.length){setError(t('Select at least one tariff.'));return;}setBusy(true);setError('');try{const response=await api.post(`/bl-register/${bill.id}/${propose?'charges':'estimate'}`,{tariffIds:ids,version:bill.version});if(propose){setProposed(true);setEstimate(null);await onChanged?.();}else setEstimate(response.data);}catch(error){setError(error.response?.data?.message||error.message);}finally{setBusy(false);}};
 return <div className="space-y-4" data-tariff-estimator><h3 className="text-zinc-200 font-semibold">{t('Tariff estimator')}</h3><p className="text-sm text-zinc-400">{t('Select tariffs explicitly. Disabled or unconfirmed rates cannot be used.')}</p><Notice message={resource.error||error}/>
 <fieldset disabled={busy||resource.loading||proposed} className="grid sm:grid-cols-2 gap-2">{rows.map(row=>{const enabled=allowed.some(item=>item.id===row.id);return <label key={row.id} className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${ids.includes(row.id)?'border-brand-500/40 bg-brand-500/5':'border-zinc-800'} ${!enabled?'opacity-40':''}`}><input type="checkbox" className="mt-1 accent-orange-500" value={row.id} checked={ids.includes(row.id)} disabled={!enabled} onChange={()=>toggle(row.id)}/><span className="flex-1 text-zinc-300">{row.description}<span className="block text-xs text-zinc-500 mt-1">{row.size?`${row.size}′ · `:''}{row.carrierName?`${row.carrierName} · `:''}{money(row.unitPrice)} / {t(row.unit)} · {t(row.vatIncluded?'VAT included':'VAT excluded')}{row.vatRate?` ${row.vatRate}%`:''}{row.confirmationRequired?` · ${t('Confirmation required')}`:''}</span></span></label>;})}</fieldset>
 {!resource.loading&&!rows.length&&<p className="text-sm text-zinc-500">{t('No tariffs available')}</p>}
 <p className="text-xs text-amber-300">{t('Package / component overlap: confirm no duplicate billing before proposing charges.')}</p><p className="text-xs text-zinc-500">{t('PPh 23 2% is reference only; tax basis is unconfirmed. No tax is added automatically.')}</p>
 {estimate&&<><DataTable pagination={false} rows={estimate.lines||[]} columns={[{key:'description',label:t('Description')},{key:'quantity',label:t('Quantity')},{key:'unit',label:t('Unit'),render:row=>t(row.unit)},{key:'unitPrice',label:t('Unit price'),render:row=>money(row.unitPrice)},{key:'amount',label:t('Amount'),render:row=>money(row.amount)},{key:'vatIncluded',label:t('VAT included'),render:row=>`${t(row.vatIncluded?'VAT included':'VAT excluded')} ${row.vatRate||''}`}]} /><p className="text-right text-zinc-100 font-semibold">{t('Total')}: {money(estimate.total)}</p>{estimate.warnings?.map((warning,index)=><p key={index} className="text-sm text-amber-300">{warning}</p>)}</>}
 {proposed&&<div role="status" className="text-sm text-emerald-400">{t('Komponen tagihan diajukan dan belum berlaku sebelum disetujui direktur.')} <Link className="underline" to="/approvals">{t('Buka Persetujuan Direktur')} →</Link></div>}
 <div className="flex gap-3"><Button type="button" variant="secondary" disabled={!ids.length||busy||proposed} onClick={()=>run(false)}>{t('Estimate')}</Button><Button type="button" disabled={!estimate||!ids.length||busy||proposed} onClick={()=>run(true)}>{t('Ajukan komponen tagihan')}</Button></div></div>;
}

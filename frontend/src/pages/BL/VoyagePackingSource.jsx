import {useBL} from '../../i18n/bl.mjs';
import {packingRecipientName} from './packingRecipientDisplay.mjs';

export function PackingRecipients({row,headerRecipient}){
 return <div className="space-y-2 text-sm" data-packing-recipients>
  {(row.recipients||[]).map((recipient,index)=>{const name=packingRecipientName(row,recipient,headerRecipient);return (name||recipient.address||recipient.phone||recipient.quantity!=null||recipient.notes||recipient.instructions)&&<div key={index} className="border-l-2 border-brand-500/30 pl-2">
   {name&&<strong>{name}</strong>}
   {(recipient.address||recipient.phone)&&<p className="text-xs">{[recipient.address,recipient.phone].filter(Boolean).join(' · ')}</p>}
   {recipient.quantity!=null&&<p>{`${recipient.quantity} ${recipient.unit||''}`}</p>}
   {recipient.notes&&<p className="text-amber-600">{recipient.notes}</p>}
   {recipient.instructions&&<p className="text-amber-600">{recipient.instructions}</p>}
  </div>;})}
 </div>;
}

export default function VoyagePackingSource({row,busy,onChange}){
 const {t}=useBL();
 return <details className="space-y-2 mb-3" data-packing-source-row><summary className="text-xs cursor-pointer text-zinc-500">{t('Opsi sumber lanjutan')}</summary>
  <label className="block text-sm">{t('Sumber muatan')}<select className="input-field" data-packing-source aria-label={`${t('Sumber muatan')} ${row.number}`} value={row.sourceType||'BL_MANUAL'} disabled={busy} onChange={event=>onChange(event.target.value)}>
   <option value="AUTO">{t('Otomatis')}</option>
   <option value="BL_MANUAL">{t('Data B/L / input manual')}</option>
   <option value="PARTNER_PL">{t('PL mitra terkonfirmasi')}</option>
  </select></label>

  {(row.sources||[]).map((source,index)=><p className="text-xs break-all" key={source.id||index}>{t('Referensi sumber')}: {source.name||source.originalName||source.id}</p>)}
  {(row.sourceWarnings||[]).map(warning=><p className="text-xs text-amber-600" key={warning}>{warning}</p>)}
  <PackingRecipients row={row}/>
 </details>;
}

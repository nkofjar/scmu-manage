import {useEffect,useState} from 'react';
import api from '../../api/client';
import {Button} from '../../components/common';
import {DataTable,DetailModal,Notice} from '../../components/jpt/Workspace';
import DocumentPreview from '../../components/jpt/DocumentPreview';
import {usePackingBL as useBL} from './packingScopeLabels.mjs';
import {packingImportBill} from './packingBillScope.mjs';
import {isSharedDocument} from './billScope.mjs';
import {isRegisterArchived} from './registerModel.mjs';
import {printPartnerSummary,summaryTotals} from './partnerSummaryPrint.mjs';
const headers=[['partnerName','Nama mitra'],['vesselName','Kapal pada sumber'],['voyageNumber','Voyage pada sumber'],['billNumber','Nomor B/L pada sumber'],['departureDate','Tanggal berangkat pada sumber'],['arrivalDate','Tanggal tiba pada sumber'],['storageDate','Tanggal storage pada sumber'],['demurrageDate','Tanggal demurrage pada sumber']];
const quantityText=rows=>rows.map(q=>`${q.quantity??'—'} ${q.unit}`).join('; ')||'—';
export default function PartnerPackingSummary(props){
 const {bill,file}=props;
 // This endpoint summarizes an entire file, not mapped B/L rows. Never infer
 // cargo ownership from a shared or legacy attachment.
 return packingImportBill({...bill,files:[file]}).files.length?<BillPackingSummary {...props}/>:<SourceReference {...props}/>;
}
function SourceReference({bill,file,onClose}){
 const {t}=useBL(),[original,setOriginal]=useState(false);
 return <DetailModal title={t('Referensi file asli — bukan ringkasan muatan B/L ini')} onClose={onClose}>
 <div className="space-y-4" data-partner-source-reference><p className="font-semibold">B/L {bill.billNumber||'—'}</p><p className="break-all">{file.originalName}</p>
 <p className="text-amber-300">{t(isSharedDocument(file)?'Sumber bersama — bukan seluruh muatan B/L ini':'Cakupan sumber belum diketahui')} · {(file.scope?.billNumbers||[]).filter(Boolean).join(', ')}</p>
 <p>{t(bill.registerData?.operational?.packing?.scopeConfirmed===true&&bill.registerData.operational.packing.groups?.some(g=>g.sourceFileId===file.id)?'Rincian B/L ini telah dipilih dan dikonfirmasi':'Rincian PL untuk B/L ini belum dipetakan')}</p><p className="text-sm text-zinc-400">{t('Ringkasan seluruh sumber tidak ditampilkan atau diekspor sebagai ringkasan B/L ini. Catat bagian milik B/L ini melalui Kelola PL B/L ini.')}</p>
 <Button variant="secondary" onClick={()=>setOriginal(true)}>{t(isSharedDocument(file)?'Lihat file asli bersama':'Lihat file asli')}</Button></div>
 {original&&<DetailModal title={t('Referensi file asli — bukan ringkasan muatan B/L ini')} onClose={()=>setOriginal(false)}><DocumentPreview endpoint={`/bl-register/${bill.id}/files/${file.id}`} name={file.originalName} mimeType={file.mimeType}/></DetailModal>}
 </DetailModal>;
}
function BillPackingSummary({bill,file,onClose,onSaved}){
 const {t,locale}=useBL(),[data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[editing,setEditing]=useState(false),[original,setOriginal]=useState(false),[reviewed,setReviewed]=useState(false),[dirty,setDirty]=useState(false);
 const readonly=isRegisterArchived(bill)||['CLOSED','CANCELLED'].includes(bill.jobStatus),endpoint=`/bl-register/${bill.id}/partner-summary/${file.id}`;
 useEffect(()=>{const controller=new AbortController();api.get(endpoint,{signal:controller.signal}).then(r=>{setData(r.data);setReviewed(Boolean(r.data.saved));setEditing(!r.data.rows.length);}).catch(e=>{if(e.code!=='ERR_CANCELED')setError(e.response?.data?.message||e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[endpoint]);
 const change=patch=>{setData(old=>({...old,...patch,...(patch.rows?{totals:summaryTotals(patch.rows)}:{})}));setDirty(true);setReviewed(false);setError('');};
 const row=(index,patch)=>change({rows:data.rows.map((r,i)=>i===index?{...r,...patch}:r)});
 const valid=data?.rows.length&&data.rows.every(r=>(r.containerNumber?.trim()||r.recipients.some(n=>n.trim()))&&r.quantities.every(q=>q.unit?.trim()&&(q.quantity==null||q.quantity===''||/^\d+$/.test(String(q.quantity)))));
 const save=async()=>{if(data.saved&&!dirty)return data;const current=(await api.put(endpoint,{version:data.version,sourceHash:data.sourceHash,summary:{header:data.header,rows:data.rows},confirmed:reviewed})).data;setData(current);setDirty(false);await onSaved?.();return current;};
 const output=async format=>{setBusy(true);setError('');try{const current=await save();if(format==='PDF')printPartnerSummary(current);else{const response=await api.get(endpoint+'/export.xlsx',{responseType:'blob'}),url=URL.createObjectURL(response.data),a=document.createElement('a');a.href=url;a.download='Ringkasan-Packing-List-Mitra.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}catch(e){setError(e.response?.data?.message||e.message);}finally{setBusy(false);}};
 if(data?.scope&&!packingImportBill({...bill,files:[{...file,scope:data.scope}]}).files.length)return <SourceReference bill={bill} file={{...file,scope:data.scope}} onClose={onClose}/>;
 const input=(label,value,onChange,props={})=><label className="block text-sm space-y-1">{t(label)}<input className="input-field" aria-label={t(label)} value={value??''} onChange={e=>onChange(e.target.value)} {...props}/></label>;
 return <DetailModal title={t('Ringkasan sumber B/L ini')} onClose={()=>!busy&&onClose()} actions={<><Button disabled={loading||busy||!valid||!reviewed||readonly&&(!data?.saved||dirty)} onClick={()=>output('PDF')}>{t('Cetak / Simpan PDF')}</Button><Button variant="secondary" disabled={loading||busy||!valid||!reviewed||readonly&&(!data?.saved||dirty)} onClick={()=>output('EXCEL')}>{t('Unduh Excel')}</Button></>}>
 <div className="space-y-4" data-partner-summary><Notice message={error}/>{loading&&<p>{t('Membaca ringkasan sumber…')}</p>}{data&&<>
 <div className="rounded-lg bg-brand-500/5 p-3 text-sm"><p className="font-medium break-all">{data.sourceName}</p><p className="text-xs text-zinc-500 mt-1">B/L {bill.billNumber||'—'} · {t('Hanya rincian yang diperiksa untuk B/L ini boleh dicatat. File asli bukan alokasi otomatis.')}</p></div>
 <p className="border border-amber-500/30 rounded-lg p-3 text-sm text-amber-300">{t(data.notice)}</p>
 <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={()=>setOriginal(true)}>{t('Lihat file asli')}</Button><Button variant="secondary" disabled={readonly||busy} onClick={()=>setEditing(v=>!v)}>{t(editing?'Lihat pratinjau ringkasan':'Ubah ringkasan')}</Button></div>
 {!data.rows.length&&<p className="text-sm text-zinc-500">{t('Ringkasan belum terbaca otomatis. Lihat file asli dan isi kontainer atau penerima; rincian barang tidak wajib diisi.')}</p>}
 <fieldset disabled={busy||readonly} className="space-y-4">
 {editing?<><details className="rounded-lg border border-zinc-700 p-3" open={!data.rows.length}><summary className="cursor-pointer text-sm">{t('Kepala ringkasan (opsional)')}</summary>{data.sourceHeading&&<p className="text-xs text-zinc-500 mt-3">{data.sourceHeading}</p>}<div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mt-3">{headers.map(([key,label])=><div key={key}>{input(label,data.header[key],v=>change({header:{...data.header,[key]:v}}),{maxLength:200})}</div>)}</div></details>
 {data.rows.map((r,index)=><section className="border border-zinc-700 rounded-lg p-4 space-y-3" key={r.id||index}><div className="flex justify-between items-center"><h3 className="font-medium text-sm">{t('Baris ringkasan')} {index+1}</h3><Button size="sm" variant="secondary" onClick={()=>change({rows:data.rows.filter((_,i)=>i!==index)})}>{t('Hapus baris')}</Button></div><div className="grid sm:grid-cols-2 gap-3">{input('Nomor kontainer',r.containerNumber,v=>row(index,{containerNumber:v.toUpperCase()}),{maxLength:50})}{input('Segel',r.sealNumber,v=>row(index,{sealNumber:v}),{maxLength:100})}<label className="block text-sm space-y-1 sm:col-span-2">{t('Penerima / mark (satu nama per baris)')}<textarea className="input-field" aria-label={t('Penerima / mark (satu nama per baris)')} rows={4} value={r.recipients.join('\n')} onChange={e=>row(index,{recipients:e.target.value.split('\n')})}/></label></div>
 <div className="space-y-2">{r.quantities.map((q,qi)=><div className="flex flex-wrap gap-2 items-end" key={qi}><div className="flex-1">{input('Jumlah (boleh kosong)',q.quantity,v=>row(index,{quantities:r.quantities.map((n,i)=>i===qi?{...n,quantity:v}:n)}),{type:'number',min:0,max:1000000,step:1})}</div><div className="flex-1">{input('Satuan',q.unit,v=>row(index,{quantities:r.quantities.map((n,i)=>i===qi?{...n,unit:v.toUpperCase()}:n)}),{maxLength:30})}</div><Button size="sm" variant="secondary" onClick={()=>row(index,{quantities:r.quantities.filter((_,i)=>i!==qi)})}>{t('Hapus satuan')}</Button></div>)}<Button size="sm" variant="secondary" onClick={()=>row(index,{quantities:[...r.quantities,{unit:'',quantity:null}]})}>{t('Tambah satuan')}</Button></div>
 {input('Catatan ringkasan',r.notes,v=>row(index,{notes:v}),{maxLength:1000})}</section>)}<Button variant="secondary" disabled={data.rows.length>=200} onClick={()=>change({rows:[...data.rows,{id:crypto.randomUUID(),containerNumber:'',sealNumber:'',recipients:[],quantities:[{unit:'KOLI',quantity:null}],notes:''}]})}>{t('Tambah baris ringkasan')}</Button></>:<>
 <dl className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">{headers.filter(([key])=>data.header[key]).map(([key,label])=><div key={key}><dt className="text-xs text-zinc-500">{t(label)}</dt><dd>{data.header[key]}</dd></div>)}</dl>
 <DataTable mobileCards pagination={false} rows={data.rows} empty="Belum ada baris ringkasan." columns={[{key:'containerNumber',label:'Kontainer / Segel',primary:true,render:r=><div>{r.containerNumber||'—'}<small className="block text-zinc-500">{r.sealNumber||'—'}</small></div>},{key:'recipients',label:'Penerima / Mark',render:r=><div className="space-y-1">{r.recipients.map((n,i)=><p key={i}>{n}</p>)}</div>},{key:'quantities',label:'Jumlah dan satuan',render:r=>quantityText(r.quantities)},{key:'notes',label:'Catatan ringkasan'}]}/><p className="text-sm font-medium">{t('Total per satuan')}: {quantityText(data.totals)}</p>
 </>}
 </fieldset>
 <p className="text-xs text-zinc-500">{t('Isian kosong tetap belum diketahui; angka nol harus dinyatakan. Jumlah tidak digabung lintas satuan.')}</p>
 {!readonly&&<label className="flex gap-2 text-sm"><input type="checkbox" aria-label={t('Saya telah memeriksa ringkasan dengan file asli.')} checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>{t('Saya telah memeriksa ringkasan dengan file asli.')}</label>}
 {data.reviewedAt&&<p className="text-xs text-zinc-500">{t('Dicatat oleh')}: {data.reviewedByName} · {new Date(data.reviewedAt).toLocaleString(locale,{dateStyle:'medium',timeStyle:'long'})}</p>}
 {data.warnings?.length>0&&<details><summary className="cursor-pointer text-xs text-zinc-500">{t('Catatan pembacaan sumber')}</summary><div className="text-xs text-zinc-500 mt-2 space-y-1">{data.warnings.slice(0,30).map((w,i)=><p key={i}>{w}</p>)}</div></details>}
 </>}</div>{original&&<DetailModal title="Document preview" onClose={()=>setOriginal(false)}><DocumentPreview endpoint={`/bl-register/${bill.id}/files/${file.id}`} name={file.originalName} mimeType={file.mimeType}/></DetailModal>}
 </DetailModal>;
}

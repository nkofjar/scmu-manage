import {useState} from 'react';
import {Link} from 'react-router-dom';
import api from '../../api/client';
import {Button} from '../../components/common';
import {DataTable,DetailModal,Notice,useResource} from '../../components/jpt/Workspace';
import DocumentPreview from '../../components/jpt/DocumentPreview';
import {useBL} from '../../i18n/bl.mjs';
import DriverAssignmentFields from './DriverAssignmentFields';
import DriverDispatch from './DriverDispatch';
import DriverDeliveriesEditor,{DriverDeliveriesSummary} from './DriverDeliveriesEditor';
import {driverWorkPayload,blankDriverWork,editDeliveries,appendDeliveryEvidence,deliveryProgress,workEvidenceIds} from './driverDeliveriesModel.mjs';
import {useTransport} from '../../i18n/transport.mjs';
const labels={DRAFT:'Draf',SUBMITTED:'Diajukan',VERIFIED:'Terverifikasi',REJECTED:'Ditolak',CANCELLED:'Dibatalkan'};
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jayapura',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const blank=bill=>blankDriverWork(bill.id);
export function BillDriverWorkTable({works=[],actions,onView}){
 const {t}=useBL();
 return <DataTable mobileCards actionPlacement="row" rows={works} empty={t('Belum ada pekerjaan sopir yang dipetakan ke B/L ini.')} columns={[
  {key:'number',label:'Nomor bon',primary:true,render:row=>onView?<button type="button" className="text-brand-500" onClick={()=>onView(row)}>{row.number}</button>:row.number},
  {key:'containerNumber',label:'Nomor kontainer'},
  {key:'driverName',label:'Nama sopir',render:row=><div>{row.driverName||'—'}<small className="block text-zinc-500">{row.vehicleNumber}</small></div>},
  {key:'route',label:'Rute',render:row=>[row.origin,row.destination].filter(Boolean).join(' → ')||'—'},
  {key:'receivedDate',label:t('Tanggal diterima')},
  {key:'deliveries',label:'Serah terima',render:row=>{const p=deliveryProgress(row);return `${p.complete}/${p.total} selesai · 1 rit`;}},
  {key:'rateType',label:t('Jenis angkutan')},
  {key:'items',label:t('Rincian barang'),render:row=><ul className="text-xs space-y-1">{(row.items||[]).map((item,index)=><li key={index}>{[item.owner,item.goodsType,[item.collyCount,item.collyType].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</li>)}</ul>},
  {key:'status',label:'Status',render:row=><>{t(labels[row.status]||row.status)}{row.payrollId&&<small className="block text-zinc-500">{t('Dikunci dalam rekap upah')}</small>}{workEvidenceIds(row).length>0&&<small className="block text-emerald-400 font-medium">✓ {workEvidenceIds(row).length} {t('bukti')}</small>}</>},
  ...(actions?[{key:'actions',label:'Tindakan',items:actions}]:[]),
 ]}/>;
}
export default function BillDriverOperations(props){return <BillDriverManager key={props.bill.id} {...props}/>;}
function BillDriverManager({bill,onChanged}){
 const {t}=useBL(),{t:tt}=useTransport(),options=useResource('/journeys/driver-options'),[dispatch,setDispatch]=useState(null),base=`/bl-register/${bill.id}/driver-operations`,resource=useResource(base);
 const [dialog,setDialog]=useState(null),[form,setForm]=useState({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false),[viewFile,setViewFile]=useState(null);
 const [fresh,setFresh]=useState(null),[stale,setStale]=useState(false);
 const data=fresh||(resource.loadedUrl===base?resource.data:null),readonly=stale||!data||data.readOnly||bill.archived||bill.deleted;
 const open=(type,row,initial={})=>{setDialog({type,row});setForm(type==='edit'?{...initial,deliveries:editDeliveries(initial).map(d=>({...d,containerNumber:d.containerNumber||initial.containerNumber||''}))}:initial);setConfirmed(false);setError('');};
 const change=(key,value)=>setForm(old=>({...old,[key]:value}));
 const reload=async()=>{try{setFresh((await api.get(base)).data);setStale(false);setError('');}catch(e){setStale(true);throw e;}await onChanged?.();};
 const run=async fn=>{if(busy)return;setBusy(true);setError('');try{await fn();}catch(error){setError(error.response?.data?.message||error.message);}finally{setBusy(false);}};
 const upload=(file,index)=>run(async()=>{const body=new FormData();body.append('file',file);body.append('version',data.version);const result=(await api.post(base+'/evidence',body)).data;setStale(true);if(index!==undefined)setForm(old=>appendDeliveryEvidence(old,index,result.evidenceId||result.id));await reload();});
 const save=event=>{event.preventDefault();run(async()=>{if(dialog.type==='edit')await api[form.id?'put':'post'](base+'/works'+(form.id?'/'+form.id:''),{version:data.version,work:{...driverWorkPayload(form),billId:bill.id}});else await api.post(base+`/works/${dialog.row.id}/status`,{version:data.version,status:form.status,reason:form.reason,proofChecked:confirmed});setDialog(null);setStale(true);await reload();});};
 const field=(key,label,type='text',extra={})=><label className="block text-sm space-y-1">{t(label)}<input className="input-field" aria-label={t(label)} type={type} value={form[key]??''} onChange={e=>change(key,e.target.value)} {...extra}/></label>;
 const uploadControl=<label className="block text-sm space-y-1">{t('Unggah Bukti Serah Terima Barang')}<input className="input-field" aria-label={t('Unggah Bukti Serah Terima Barang')} type="file" disabled={readonly||busy} onChange={e=>{if(e.target.files[0])upload(e.target.files[0]);e.target.value='';}}/></label>;
 const proofs=work=>(data?.files||[]).filter(f=>workEvidenceIds(work).includes(f.evidenceId)).map(f=><button type="button" key={f.id} className="block text-brand-500 text-left" onClick={()=>setViewFile(f)}>{f.originalName}</button>);
 const actions=[{key:'dispatch',label:tt('Surat tugas / jalan'),onClick:setDispatch},{key:'view',label:'Lihat',onClick:w=>open('view',w)},{key:'edit',label:'Ubah',disabled:w=>readonly||busy||!!w.payrollId||!['DRAFT','REJECTED'].includes(w.status),onClick:w=>open('edit',w,structuredClone(w))},...Object.entries({SUBMITTED:['Ajukan','DRAFT'],VERIFIED:['Verifikasi','SUBMITTED'],REJECTED:['Tolak','SUBMITTED'],CANCELLED:['Batalkan',null]}).map(([status,[label,from]])=>({key:status,label,hidden:w=>from?w.status!==from:w.status==='CANCELLED',disabled:w=>readonly||busy||!!w.payrollId,onClick:w=>open('status',w,{status,reason:''})}))];
 return <section data-bill-driver-operations className="card p-5 space-y-4">
 <div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">{t('Pekerjaan sopir untuk B/L ini')}</h2><p className="text-sm text-zinc-500 mt-1">{t('Hanya pekerjaan dan bukti milik B/L ini ditampilkan. Jatah dan rekap upah gabungan dikelola terpisah.')}</p></div><Button disabled={readonly||busy} onClick={()=>open('edit',null,{...blank(bill),containerNumber:data.containers[0]?.number||''})}>{t('Tambah bonrate')}</Button></div>
 <Button variant="secondary" disabled={busy} onClick={()=>run(reload)}>{tt('Muat ulang')}</Button>
 <Notice message={(!fresh?resource.error:'')||(!dialog?error:'')}/>
 {!data?<p>{t('Memuat ruang kerja…')}</p>:<>
   <div className="space-y-3">
     <BillDriverWorkTable works={data.works.filter(w=>!w.sharedWork)} onView={w=>open('view',w)} actions={actions}/>
     {[...(Array.isArray(data.sharedWork)?data.sharedWork:[]),...data.works.filter(w=>w.sharedWork)].length>0&&<section data-shared-driver-work className="space-y-2"><h3 className="font-semibold text-sm">{t('Pekerjaan bersama (hanya baca)')}</h3><BillDriverWorkTable works={[...(Array.isArray(data.sharedWork)?data.sharedWork:[]),...data.works.filter(w=>w.sharedWork)]} onView={w=>open('view',w)}/><Link className="text-brand-500 underline text-sm" to={`/shipments/${bill.journeyId}?tab=costs&operations=1`}>{t('Ubah pekerjaan bersama di pengelolaan gabungan')} →</Link></section>}{data.mappingRequired&&<p className="text-sm text-amber-600">{t('Ada pekerjaan pada kontainer bersama yang belum dipetakan ke B/L. Gunakan pengelolaan gabungan untuk memeriksa pemetaan.')}</p>}
   </div>
   <details className="card p-4 space-y-3" data-driver-evidence-section open={Boolean(data.files?.length)}>
     <summary className="cursor-pointer select-none font-semibold text-sm flex flex-wrap items-center justify-between gap-2">
       <span>{t('Bukti Serah Terima Barang')} ({(data.files||[]).length})</span>
       <span className="text-xs font-normal text-zinc-500">{t('Kelola atau unggah berkas bukti')}</span>
     </summary>
     <div className="pt-2 space-y-3 border-t border-zinc-800">
       <div className="flex flex-wrap items-center justify-between gap-2">
         {uploadControl}
         <p className="text-xs text-zinc-500">{t('Semua format dokumen, maksimal 5 MB. Bukti disimpan pada B/L ini.')}</p>
       </div>
       {(data.files||[]).length===0?<p className="text-sm text-zinc-500 py-2">{t('Belum ada Bukti Serah Terima Barang.')}</p>:
         <DataTable rows={data.files} pagination={false} actionPlacement="row" empty="Belum ada Bukti Serah Terima Barang." columns={[
           {key:'originalName',label:'Dokumen',primary:true},
           {key:'actions',label:'Tindakan',items:[
             {key:'view',label:'Lihat',onClick:setViewFile},
             {key:'create',label:'Buat bonrate dari bukti',disabled:()=>readonly||busy,onClick:file=>open('edit',null,{...blank(bill),containerNumber:data.containers[0]?.number||'',deliveries:[{...editDeliveries({billId:bill.id,containerNumber:data.containers[0]?.number||''})[0],evidenceFileIds:[file.evidenceId]}]})}
           ]}
         ]}/>
       }
     </div>
   </details>
 </>}
 <details className="border-t pt-3"><summary className="cursor-pointer text-sm">{t('Pengaturan lanjutan dan rekap gabungan')}</summary><p className="text-sm text-zinc-500 my-2">{t('Jatah kontainer, rekonsiliasi bon lama, rekap upah, dan pembayaran mencakup seluruh B/L dalam pengiriman kapal.')}</p><Link className="text-brand-500 text-sm underline" to={`/shipments/${bill.journeyId}?tab=costs&operations=1`}>{t('Buka jatah dan rekap upah gabungan')} →</Link></details>
 {dialog&&data&&<DetailModal title={dialog.type==='edit'?(form.id?'Ubah bonrate sopir':'Tambah bonrate sopir'):dialog.type==='view'?dialog.row.number:labels[form.status]} onClose={()=>{if(!busy)setDialog(null);}} actions={dialog.type!=='view'&&<Button type="submit" form="bill-driver-form" disabled={busy||readonly||form.status==='VERIFIED'&&!confirmed}>{t(dialog.type==='edit'?'Simpan':labels[form.status])}</Button>}><Notice message={error}/>{stale&&<Button variant="secondary" disabled={busy} onClick={()=>run(reload)}>{tt('Muat ulang')}</Button>}{dialog.type==='view'?<div className="space-y-3"><BillDriverWorkTable works={[dialog.row]}/><DriverDeliveriesSummary work={dialog.row} files={data.files} onView={setViewFile}/><p className="text-sm whitespace-pre-wrap">{dialog.row.notes}</p>{proofs(dialog.row)}</div>:<form id="bill-driver-form" onSubmit={save}><fieldset disabled={busy||readonly} className="space-y-4">
 {dialog.type==='edit'?<><p className="text-sm">{t('Nomor B/L')}: {bill.billNumber||bill.id}</p><div className="grid sm:grid-cols-2 gap-3"><label className="block text-sm">{t('Kontainer')}<select className="input-field" aria-label={t('Kontainer')} required value={form.containerNumber} onChange={e=>change('containerNumber',e.target.value)}><option value="">{t('Belum dipilih')}</option>{data.containers.map(c=><option key={c.number} value={c.number}>{c.number} · {c.size||'?'} feet</option>)}</select></label><DriverAssignmentFields form={form} onChange={change} options={options.data||{}} error={options.error}/><label className="block text-sm">{t('Jenis angkutan')}<select className="input-field" value={form.rateType} onChange={e=>change('rateType',e.target.value)}><option value="RB">RB</option><option value="RK">RK</option></select></label></div><DriverDeliveriesEditor deliveries={form.deliveries} onChange={value=>change('deliveries',value)} bills={[bill]} selectedBillId={bill.id} containers={data.containers} files={data.files||[]} disabled={readonly||busy} onUpload={upload} onView={setViewFile}/>{field('notes','Catatan','text',{maxLength:2000})}</>:<><p>{dialog.row.number} · {dialog.row.driverName} · {dialog.row.containerNumber} · {dialog.row.rateType}</p><p className="text-sm">{t(form.status==='SUBMITTED'?'Pengajuan ini memakai satu jatah rit kontainer. Banyaknya barang dan foto tidak menambah jumlah rit.':form.status==='VERIFIED'?'Periksa bukti bertanda terima, identitas kontainer, dan jenis angkutan. Verifikasi tidak mencatat pembayaran.':'Jatah pekerjaan akan dikembalikan; riwayat dan bukti tetap disimpan.')}</p>{proofs(dialog.row)}{form.status==='VERIFIED'&&<label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{t('Bukti serah terima dan realisasi RB/RK sudah saya periksa.')}</label>}{['REJECTED','CANCELLED'].includes(form.status)&&field('reason','Alasan','text',{required:true,maxLength:2000})}</>}
 </fieldset></form>}</DetailModal>}
 {dispatch&&<DriverDispatch billId={bill.id} work={dispatch} version={data.version} readonly={readonly} onChanged={reload} onClose={()=>setDispatch(null)}/>}
 {viewFile&&<DetailModal title="Document preview" onClose={()=>setViewFile(null)}><DocumentPreview endpoint={viewFile.endpoint} name={viewFile.originalName} mimeType={viewFile.mimeType}/></DetailModal>}
 </section>;
}

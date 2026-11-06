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
import {driverWorkPayload,blankDriverWork,editDeliveries,appendDeliveryEvidence,deliveryProgress,workEvidenceIds,isPostDelivery,completedDriverWork} from './driverDeliveriesModel.mjs';
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
  {key:'deliveries',label:'Serah terima',render:row=>{const p=deliveryProgress(row);return `${p.complete}/${p.total} ${t('selesai')}`;}},
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
 const change=(key,value)=>setForm(old=>({...old,[key]:value,...(key==='containerNumber'?{deliveries:(old.deliveries||[]).map(d=>({...d,containerNumber:value}))}:{})}));
 const reload=async()=>{try{setFresh((await api.get(base)).data);setStale(false);setError('');}catch(e){setStale(true);throw e;}await onChanged?.();};
 const run=async fn=>{if(busy)return;setBusy(true);setError('');try{await fn();}catch(error){setError(t(error.response?.data?.message||error.message));}finally{setBusy(false);}};
 const upload=(file,index)=>run(async()=>{const body=new FormData();body.append('file',file);body.append('version',data.version);const result=(await api.post(base+'/evidence',body)).data;setStale(true);if(index!==undefined)setForm(old=>appendDeliveryEvidence(old,index,result.evidenceId||result.id));await reload();});
 const save=event=>{event.preventDefault();run(async()=>{if(dialog.type==='edit')await api[form.id?'put':'post'](base+'/works'+(form.id?'/'+form.id:''),{version:data.version,work:{...driverWorkPayload(form),billId:bill.id}});else await api.post(base+`/works/${dialog.row.id}/status`,{version:data.version,status:form.status,reason:form.reason,proofChecked:confirmed});setDialog(null);setStale(true);await reload();});};
 const field=(key,label,type='text',extra={})=><label className="block text-sm space-y-1">{t(label)}<input className="input-field" aria-label={t(label)} type={type} value={form[key]??''} onChange={e=>change(key,e.target.value)} {...extra}/></label>;

 const proofs=work=>(data?.files||[]).filter(f=>workEvidenceIds(work).includes(f.evidenceId)).map(f=><button type="button" key={f.id} className="block text-brand-500 text-left" onClick={()=>setViewFile(f)}>{f.originalName}</button>);
 const actions=[{key:'dispatch',label:t('Cetak / riwayat bonrate'),onClick:setDispatch},{key:'view',label:'Lihat',onClick:w=>open('view',w)},{key:'edit',label:'Ubah',disabled:w=>readonly||busy||!!w.bonrateIssued||!!w.payrollId||!['DRAFT','REJECTED'].includes(w.status),onClick:w=>open('edit',w,structuredClone(w))},...Object.entries({SUBMITTED:['Ajukan','DRAFT'],VERIFIED:['Verifikasi','SUBMITTED'],REJECTED:['Tolak','SUBMITTED'],CANCELLED:['Batalkan',null]}).map(([status,[label,from]])=>({key:status,label,hidden:w=>from?(w.recordingPolicy==='POST_DELIVERY'||w.status!==from):w.status==='CANCELLED',disabled:w=>readonly||busy||!!w.bonrateIssued||!!w.payrollId,onClick:w=>open('status',w,{status,reason:''})}))];
 return <section data-bill-driver-operations className="card p-5 space-y-4">
 <div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">{t('Pekerjaan sopir untuk B/L ini')}</h2><p className="text-sm text-zinc-500 mt-1">{t('Hanya pekerjaan dan bukti milik B/L ini ditampilkan. Jatah dan rekap upah gabungan dikelola terpisah.')}</p></div><Button disabled={readonly||busy} onClick={()=>open('edit',null,{...blank(bill),containerNumber:data.containers[0]?.number||''})}>{t('Catat Bonrate')}</Button></div>
 <Button variant="secondary" disabled={busy} onClick={()=>run(reload)}>{tt('Muat ulang')}</Button>
 <Notice message={(!fresh?resource.error:'')||(!dialog?error:'')}/>
 {!data?<p>{t('Memuat ruang kerja…')}</p>:<>
   <div className="space-y-3">
     <BillDriverWorkTable works={data.works.filter(w=>!w.sharedWork)} onView={w=>open('view',w)} actions={actions}/>
     {[...(Array.isArray(data.sharedWork)?data.sharedWork:[]),...data.works.filter(w=>w.sharedWork)].length>0&&<section data-shared-driver-work className="space-y-2"><h3 className="font-semibold text-sm">{t('Pekerjaan bersama (hanya baca)')}</h3><BillDriverWorkTable works={[...(Array.isArray(data.sharedWork)?data.sharedWork:[]),...data.works.filter(w=>w.sharedWork)]} onView={w=>open('view',w)}/><Link className="text-brand-500 underline text-sm" to={`/shipments/${bill.journeyId}?tab=costs&operations=1`}>{t('Ubah pekerjaan bersama di pengelolaan gabungan')} →</Link></section>}{data.mappingRequired&&<p className="text-sm text-amber-600">{t('Ada pekerjaan pada kontainer bersama yang belum dipetakan ke B/L. Gunakan pengelolaan gabungan untuk memeriksa pemetaan.')}</p>}
   </div>

 </>}

 {dialog&&data&&<DetailModal actionsEnd={dialog.type==='edit'} width={dialog.type==='edit'?'max-w-5xl':'max-w-6xl'} title={dialog.type==='edit'?(form.id?'Ubah bonrate sopir':'Catat Bonrate'):dialog.type==='view'?dialog.row.number:labels[form.status]} onClose={()=>{if(!busy)setDialog(null);}} actions={dialog.type!=='view'&&<Button type="submit" form="bill-driver-form" disabled={busy||readonly||dialog.type==='edit'&&isPostDelivery(form)&&!completedDriverWork(form)||form.status==='VERIFIED'&&!confirmed}>{t(dialog.type==='edit'?'Simpan':labels[form.status])}</Button>}><Notice message={error}/>{stale&&<Button variant="secondary" disabled={busy} onClick={()=>run(reload)}>{tt('Muat ulang')}</Button>}{dialog.type==='view'?<div className="space-y-3"><BillDriverWorkTable works={[dialog.row]}/><DriverDeliveriesSummary work={dialog.row} files={data.files} onView={setViewFile}/><p className="text-sm whitespace-pre-wrap">{dialog.row.notes}</p>{proofs(dialog.row)}</div>:<form id="bill-driver-form" onSubmit={save} className="[&_.input-field]:py-2 [&_label]:space-y-1"><fieldset disabled={busy||readonly} className="space-y-4">
 {dialog.type==='edit'?<><p className="text-sm">{t('Nomor B/L')}: {bill.billNumber||bill.id}</p><div data-bonrate-context className="grid sm:grid-cols-2 gap-4 items-start"><label className="block text-sm space-y-1">{t('Kontainer')}<select className="input-field" aria-label={t('Kontainer')} required value={form.containerNumber} onChange={e=>change('containerNumber',e.target.value)}><option value="">{t('Belum dipilih')}</option>{data.containers.map(c=><option key={c.number} value={c.number}>{c.number} · {c.size||'?'} feet</option>)}</select></label><label className="block text-sm">{t('Jenis angkutan')}<select className="input-field" aria-label={t('Jenis angkutan')} value={form.rateType} onChange={e=>change('rateType',e.target.value)}><option value="RB">RB</option><option value="RK">RK</option><option value="TONASE">{t('Tonase')}</option><option value="RBS">RBS</option></select></label></div><DriverAssignmentFields form={form} onChange={change} options={options.data||{}} error={options.error}/><p className="text-sm leading-relaxed text-zinc-500 rounded-lg border border-zinc-500/20 px-3 py-2">{t('Bonrate dicatat setelah seluruh pengantaran selesai. Setiap pemilik memiliki serah terima. Lampiran bukti bersifat opsional. Setelah disimpan, bonrate dapat langsung dicetak. Draf adalah pemeriksaan administrasi, bukan jadwal pengantaran.')}</p><DriverDeliveriesEditor parentContainerNumber={form.containerNumber} postDelivery={isPostDelivery(form)} deliveries={form.deliveries} onChange={value=>change('deliveries',value)} bills={[bill]} selectedBillId={bill.id} containers={data.containers} files={data.files||[]} disabled={readonly||busy} onUpload={upload} onView={setViewFile}/>{field('notes','Catatan','text',{maxLength:2000})}</>:<><p>{dialog.row.number} · {dialog.row.driverName} · {dialog.row.containerNumber} · {dialog.row.rateType}</p><p className="text-sm">{t(dialog.row.recordingPolicy==='POST_DELIVERY'?'Riwayat dan bukti tetap disimpan.':form.status==='SUBMITTED'?(['RB','RK'].includes(dialog.row.rateType)?'Pengajuan ini memakai satu jatah rit kontainer. Banyaknya barang dan foto tidak menambah jumlah rit.':'Tonase dan RBS dicatat terpisah tanpa memakai jatah RB/RK.'):form.status==='VERIFIED'?'Periksa bukti bertanda terima, identitas kontainer, dan jenis angkutan. Verifikasi tidak mencatat pembayaran.':'Jatah pekerjaan akan dikembalikan; riwayat dan bukti tetap disimpan.')}</p>{proofs(dialog.row)}{form.status==='VERIFIED'&&<label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{t('Bukti serah terima dan jenis angkutan sudah saya periksa.')}</label>}{['REJECTED','CANCELLED'].includes(form.status)&&field('reason','Alasan','text',{required:true,maxLength:2000})}</>}
 </fieldset></form>}</DetailModal>}
 {dispatch&&<DriverDispatch billId={bill.id} work={dispatch} version={data.version} readonly={readonly} onChanged={reload} onClose={()=>setDispatch(null)}/>}
 {viewFile&&<DetailModal title="Document preview" onClose={()=>setViewFile(null)}><DocumentPreview endpoint={viewFile.endpoint} name={viewFile.originalName} mimeType={viewFile.mimeType}/></DetailModal>}
 </section>;
}

import {useEffect,useState} from 'react';
import api from '../../api/client';
import {useAuth} from '../../context/AuthContext';
import {PageHeader,Button} from '../../components/common';
import {DataTable,DetailModal,Notice,Tabs,usePagedResource} from '../../components/jpt/Workspace';
import DocumentPreview from '../../components/jpt/DocumentPreview';
import {useTransport} from '../../i18n/transport.mjs';
import {expiryState,loadCompanies,masterPayload,vehicleTypes} from './transportModel.mjs';
export default function FleetDrivers(){
 const {t}=useTransport();const [tab,setTab]=useState('fleet');
 return <div className="space-y-5" data-transport-masters><PageHeader title={t('Kendaraan & Sopir')}/><Tabs items={[{value:'fleet',label:t('Kendaraan')},{value:'drivers',label:t('Sopir')}]} value={tab} onChange={setTab}/><MasterTable key={tab} kind={tab}/></div>;
}
function MasterTable({kind}){
 const {t}=useTransport(),{canManage}=useAuth(),vehicle=kind==='fleet',base='/'+kind;
 const [inactive,setInactive]=useState(false),[search,setSearch]=useState(''),[companies,setCompanies]=useState([]),[companyError,setCompanyError]=useState(''),[dialog,setDialog]=useState(null),[form,setForm]=useState({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[documents,setDocuments]=useState(null),[stale,setStale]=useState(false);
 const resource=usePagedResource(base,{active:inactive?'all':'true',search},kind);
 useEffect(()=>{if(!resource.loading&&!resource.error&&resource.data)setStale(false);},[resource.loading,resource.error,resource.data]);
 const getCompanies=()=>{setCompanyError('');loadCompanies(api.get).then(setCompanies).catch(e=>setCompanyError(e.message));};
 useEffect(getCompanies,[]);
 const classification=vehicle?'ownershipType':'employmentType';
 const open=row=>{setForm(row?{...row,...Object.fromEntries(['stnkExpiry','kirExpiry','licenseExpiry'].map(k=>[k,row[k]?.slice(0,10)||'']))}:{type:'TRUCK',capacity:'',companyId:'',[classification]:''});setDialog({type:'edit',row});setError('');setSaved(false);};
 const run=async fn=>{if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError(e.response?.data?.message||e.message);}finally{setBusy(false);}};
 const refresh=async()=>{await api.get(base,{params:{active:inactive?'all':'true',search,page:resource.pagination.page,limit:resource.pagination.limit}});resource.reload();};
 const commit=async fn=>{await fn();setDialog(null);setSaved(true);setStale(true);await refresh();};
 const save=e=>{e.preventDefault();run(()=>commit(()=>api[form.id?'put':'post'](base+(form.id?'/'+form.id:''),masterPayload(kind,form))));};
 const change=(key,value)=>setForm(old=>({...old,[key]:value,...(key===classification?{companyId:''}:{})}));
 const field=(key,label,type='text',required=false)=><label className="block text-sm space-y-1" key={key}>{t(label)}<input className="input-field" aria-label={t(label)} type={type} required={required} min={type==='number'?0:undefined} step={key==='capacity'?'any':undefined} value={form[key]??''} onChange={e=>change(key,e.target.value)}/></label>;
 const expiry=(label,value)=><div>{label}: {value?.slice(0,10)||''}{['expired','expiring'].includes(expiryState(value))&&<small className="block text-amber-500">{t(expiryState(value)==='expired'?'Kedaluwarsa':'Segera berakhir')}</small>}</div>;
 const allowed=companies.filter(c=>c.isActive!==false&&(!form[classification]||(form[classification]==='VENDOR'?!c.isInternal:c.isInternal)));
 return <section className="space-y-4">
 <div className="flex flex-wrap gap-3 items-center"><input className="input-field flex-1 min-w-0" aria-label={t('Cari kendaraan / sopir')} placeholder={t('Cari kendaraan / sopir')} value={search} onChange={e=>setSearch(e.target.value)}/><label className="text-sm flex gap-2"><input type="checkbox" checked={inactive} onChange={e=>setInactive(e.target.checked)}/>{t('Tampilkan nonaktif')}</label>{canManage()&&<Button disabled={busy||stale} onClick={()=>open(null)}>{t(vehicle?'Tambah kendaraan':'Tambah sopir')}</Button>}<Button variant="secondary" onClick={()=>{resource.reload();getCompanies();setError('');}}>{t('Muat ulang')}</Button></div>
 <Notice message={resource.error||(!dialog?error:'')||companyError}/>{saved&&<p role="status" className="text-sm text-emerald-500">{t('Data tersimpan. Muat ulang untuk memperbarui daftar.')}</p>}
 <DataTable rows={resource.rows} pagination={resource.pagination} actionPlacement="row" empty={t('Belum ada data.')} columns={[
 {key:vehicle?'registrationNo':'name',label:t(vehicle?'Nomor plat':'Nama sopir'),primary:true},
 {key:'details',label:t(vehicle?'Jenis kendaraan':'Telepon'),render:r=>vehicle?<>{r.type}<small className="block">{[r.make,r.model,r.year].filter(Boolean).join(' ')}</small>{r.capacity!=null&&<small className="block">{r.capacity} t</small>}</>:<>{r.phone}<small className="block">{r.licenseNo} {r.licenseClass}</small></>},
 {key:'company',label:t('Perusahaan'),render:r=><>{r.company?.name}<small className="block">{t(r[classification]==='VENDOR'?'Vendor':r[classification]?vehicle?'Milik sendiri':'Internal':'Belum diketahui')}</small></>},
 {key:'expiry',label:vehicle?'STNK / KIR':'SIM',render:r=>vehicle?<>{expiry('STNK',r.stnkExpiry)}{expiry('KIR',r.kirExpiry)}</>:expiry('SIM',r.licenseExpiry)},
 {key:'isActive',label:t('Status'),render:r=>t(r.isActive?'Aktif':'Nonaktif')},
 {key:'actions',label:t('Tindakan'),items:[{key:'edit',label:t('Ubah'),disabled:()=>!canManage()||busy||stale,onClick:open},{key:'docs',label:t('Dokumen'),onClick:setDocuments},{key:'deactivate',label:t('Nonaktifkan'),hidden:r=>!r.isActive,disabled:()=>!canManage()||busy||stale,onClick:row=>{setError('');setDialog({type:'deactivate',row});}},{key:'activate',label:t('Aktifkan'),hidden:r=>r.isActive,disabled:()=>!canManage()||busy||stale,onClick:r=>run(()=>commit(()=>api.put(base+'/'+r.id,{version:r.version,isActive:true})))}]}
 ]}/>
 {dialog&&<DetailModal width="max-w-3xl" title={t(dialog.type==='deactivate'?'Nonaktifkan':vehicle?form.id?'Ubah kendaraan':'Tambah kendaraan':form.id?'Ubah sopir':'Tambah sopir')} onClose={()=>{if(!busy)setDialog(null);}} actions={dialog.type==='edit'?<Button form="transport-master-form" type="submit" disabled={busy||!!companyError}>{t('Simpan')}</Button>:<Button disabled={busy} onClick={()=>run(()=>commit(()=>api.delete(base+'/'+dialog.row.id,{data:{version:dialog.row.version}})))}>{t('Konfirmasi nonaktifkan')}</Button>}><Notice message={error}/>{dialog.type==='deactivate'?<p>{dialog.row.registrationNo||dialog.row.name}. {t('Riwayat tetap tersimpan.')}</p>:<form id="transport-master-form" onSubmit={save}><fieldset disabled={busy} className="grid sm:grid-cols-2 gap-4">
 {vehicle?<>{field('registrationNo','Nomor plat','text',true)}<label className="block text-sm">{t('Jenis kendaraan')}<select className="input-field" aria-label={t('Jenis kendaraan')} value={form.type} onChange={e=>change('type',e.target.value)}>{vehicleTypes.map(v=><option key={v}>{v}</option>)}</select></label>{field('capacity','Kapasitas (ton)','number',true)}{field('make','Merek')}{field('model','Model')}{field('year','Tahun','number')}{field('stnkExpiry','Berlaku STNK','date')}{field('kirExpiry','Berlaku KIR','date')}</>:<>{field('name','Nama sopir','text',true)}{field('phone','Telepon','text',true)}{field('licenseNo','Nomor SIM','text',true)}{field('licenseClass','Golongan SIM')}{field('licenseExpiry','Berlaku SIM','date')}</>}
 <label className="block text-sm">{t(vehicle?'Kepemilikan':'Hubungan kerja')}<select className="input-field" aria-label={t(vehicle?'Kepemilikan':'Hubungan kerja')} value={form[classification]||''} onChange={e=>change(classification,e.target.value)}><option value="">{t('Belum diketahui')}</option><option value={vehicle?'OWN':'INTERNAL'}>{t(vehicle?'Milik sendiri':'Internal')}</option><option value="VENDOR">{t('Vendor')}</option></select></label>
 <label className="block text-sm">{t('Perusahaan')}<select className="input-field" aria-label={t('Perusahaan')} required={!!form[classification]} value={form.companyId||''} onChange={e=>change('companyId',e.target.value)}><option value="">{t('Pilih perusahaan')}</option>{form.companyId&&!allowed.some(c=>c.id===form.companyId)&&<option value={form.companyId}>{form.company?.name||form.companyId}</option>}{allowed.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 </fieldset></form>}</DetailModal>}
 {documents&&<MasterDocuments base={base+'/'+documents.id} row={documents} vehicle={vehicle} writable={canManage()&&documents.isActive} onClose={()=>{setDocuments(null);resource.reload();}}/>}
 </section>;
}
export function MasterDocuments({base,row,vehicle,writable,onClose}){
 const {t}=useTransport();const [files,setFiles]=useState([]),[version,setVersion]=useState(null),[inputKey,setInputKey]=useState(0),[category,setCategory]=useState(vehicle?'STNK':'SIM'),[file,setFile]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[view,setView]=useState(null);
 const load=async()=>{try{const result=(await api.get(base+'/documents')).data;setFiles(result.data);setVersion(result.version);setError('');}catch(e){setError(e.response?.data?.message||e.message);}};
 useEffect(()=>{load();},[base]);
 const upload=async()=>{if(!file||busy||version===null)return;setBusy(true);setError('');try{const body=new FormData();body.append('category',category);body.append('file',file);body.append('version',String(version));const result=(await api.post(base+'/documents',body)).data;setVersion(null);setFiles(old=>[result,...old]);setFile(null);setInputKey(old=>old+1);await load();}catch(e){setError(e.response?.data?.message||e.message);}finally{setBusy(false);}};
 return <DetailModal title={t('Dokumen')+' · '+(row.registrationNo||row.name)} onClose={()=>{if(!busy)onClose();}}><div className="space-y-4"><Notice message={error}/><div className="flex flex-wrap gap-3"><Button variant="secondary" onClick={load}>{t('Muat ulang')}</Button>{writable&&<><select aria-label={t('Jenis dokumen')} className="input-field w-auto" value={category} onChange={e=>setCategory(e.target.value)}>{(vehicle?['STNK','KIR']:['SIM']).map(c=><option key={c}>{c}</option>)}</select><input key={inputKey} className="min-w-0 max-w-full" aria-label={t('Pilih berkas')} type="file" disabled={busy||version===null} onChange={e=>setFile(e.target.files[0]||null)}/><Button disabled={busy||!file||version===null} onClick={upload}>{t('Unggah')}</Button></>}</div><DataTable rows={files} columns={[{key:'category',label:t('Jenis dokumen')},{key:'originalName',label:t('Nama file')},{key:'createdAt',label:t('Tanggal unggah')},{key:'actions',label:t('Tindakan'),items:[{key:'view',label:t('Lihat'),onClick:setView}]}]} actionPlacement="row"/>{view&&<DocumentPreview endpoint={base+'/documents/'+view.id+'/download'} name={view.originalName} mimeType={view.mimeType}/>}</div></DetailModal>;
}

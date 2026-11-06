import {Link} from 'react-router-dom';
import {useState} from 'react';
import {PageHeader,Button} from '../../components/common';
import {DataTable,Notice,usePagedResource,useResource} from '../../components/jpt/Workspace';
import {useTransport} from '../../i18n/transport.mjs';

export default function DriverTrips(){
 const {t}=useTransport();
 const [month,setMonth]=useState(()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jayapura',year:'numeric',month:'2-digit'}).format(new Date()));
 const [driverId,setDriver]=useState(''),[vehicleId,setVehicle]=useState(''),[payrollStatus,setPayrollStatus]=useState(''),[ownership,setOwnership]=useState(''),[size,setSize]=useState('');
 const options=useResource('/journeys/driver-options');
 const report=usePagedResource('/driver-trips',{month,driverId,vehicleId,payrollStatus,ownership,size,status:'VERIFIED'},'trips');
 const data=report.loading?null:report.data;
 const kind=value=>t(value==='INTERNAL'?'Internal':value==='VENDOR'?'Vendor':'Belum diketahui');
 const select=(label,value,onChange,items)=><label className="block text-sm min-w-0">{t(label)}<select className="input-field" aria-label={t(label)} value={value} onChange={e=>onChange(e.target.value)}><option value="">{t('Semua')}</option>{items.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>;
 return <div className="space-y-5 min-w-0" data-driver-trips><PageHeader title={t('Ritase & Upah')}/>
 <div className="card p-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-3"><label className="block text-sm min-w-0">{t('Bulan')}<input className="input-field" aria-label={t('Bulan')} type="month" required value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value);}}/></label>
 {select('Sopir',driverId,setDriver,(options.data?.drivers||[]).filter(d=>d.id).map(d=>[d.id,[d.name,d.companyName,d.id].filter(Boolean).join(' · ')]))}
 {select('Kepemilikan',ownership,setOwnership,[['INTERNAL',t('Internal')],['VENDOR',t('Vendor')],['UNKNOWN',t('Belum diketahui')]])}
 {select('Ukuran',size,setSize,[['20','20 ft'],['40','40 ft']])}
 {select('Kendaraan',vehicleId,setVehicle,(options.data?.vehicles||[]).filter(v=>v.id).map(v=>[v.id,[v.registrationNo||v.name,v.companyName,v.id].filter(Boolean).join(' · ')]))}
 {select('Status upah',payrollStatus,setPayrollStatus,[['NOT_LINKED',t('Belum direkap')],['PROPOSED',t('Menunggu persetujuan biaya')],['UNPAID',t('Belum dibayar')],['PART_PAID',t('Dibayar sebagian')],['PAID',t('Sudah dibayar')]])}<Button variant="secondary" onClick={()=>{report.reload();options.reload();}}>{t('Muat ulang')}</Button></div>
 <Notice message={report.error||options.error}/>
 <p className="text-sm text-zinc-500">{t('Hanya bonrate VERIFIED berdasarkan bulan tanggal diterima. Satu bonrate dihitung satu rit; bukan jumlah kontainer fisik. Vendor tidak termasuk upah internal.')}</p>
 {(data?.warnings||[]).map(w=><p key={w.code} className="text-sm text-amber-500">{t(w.message)}</p>)}
 <section className="space-y-3"><h2 className="font-semibold">{t('Ringkasan per sopir')}</h2><DataTable rows={(data?.summary||[]).map(r=>({...r,id:r.key}))} pagination={false} columns={[
 {key:'driverName',label:t('Sopir'),render:r=><>{r.driverName}<small className="block text-zinc-500">{r.driverId||t('Belum dipetakan')} · {kind(r.employmentType)}</small></>},
 ...[['rit20','20 ft'],['rit40','40 ft'],['ritOther',t('Ukuran lain')],['rb','RB'],['rk','RK'],['total',t('Total rit')],['payrollLinked',t('Dalam rekap')],['payrollPending',t('Belum direkap')]].map(([key,label])=>({key,label}))
 ]}/></section>
 <section className="space-y-3"><h2 className="font-semibold">{t('Rincian bonrate terverifikasi')}</h2><DataTable rows={report.rows} pagination={report.pagination} actionPlacement="row" columns={[
 {key:'number',label:t('Nomor bon'),primary:true,render:r=>r.billId?<Link className="text-brand-500" to={`/bl-register/${encodeURIComponent(r.billId)}?tab=driver-bons`}>{r.number}</Link>:<>{r.number}<small className="block">{t('Belum dipetakan')}</small></>},
 {key:'driverName',label:t('Sopir'),render:r=><>{r.driverName}<small className="block">{r.vehicleNumber}</small><small className="block">{kind(r.employmentType)}</small></>},
 {key:'journeyNumber',label:t('Pengiriman')},{key:'containerNumber',label:t('Kontainer')},{key:'size',label:t('Ukuran')},{key:'rateType',label:'RB / RK'},{key:'receivedDate',label:t('Tanggal diterima')},
 {key:'payrollId',label:t('Rekap upah'),render:r=><><small className="block">{t(({PAID:'Sudah dibayar',APPROVED:'Disetujui, belum dibayar',PART_PAID:'Dibayar sebagian',PROPOSED:'Menunggu persetujuan biaya',REJECTED:'Ditolak',NOT_LINKED:'Belum direkap',MISSING:'Rekap tidak ditemukan',VOID:'Rekap dibatalkan'})[r.payrollStatus]||'Status pembayaran belum diketahui')}</small><Link className="text-brand-500" to={`/shipments/${encodeURIComponent(r.payrollJourneyId||r.journeyId)}?tab=costs&operations=1`}>{t(r.payrollId?'Buka rekap upah':'Buka jatah dan rekap upah gabungan')}</Link></>}
 ]}/></section></div>;
}

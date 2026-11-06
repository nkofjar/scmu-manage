import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/common';
import { DataTable, Notice, usePagedResource } from '../../components/jpt/Workspace';
import { usePageQuery } from '../../components/Layout/PageNavigation';
import { useLanguage } from '../../i18n/LanguageContext';
import { formatRegisterAmount } from '../BL/registerModel.mjs';

export default function BillingTax(){
 const {t}=useLanguage();const [params,setQuery]=usePageQuery();const search=params.get('search')||'';const resource=usePagedResource('/operations/billing',{search},'billing');
 const rows=resource.rows,totals=resource.data?.summary||{gross:'0',pph:'0',net:'0',amountMissing:0};
 return <div className="space-y-5"><PageHeader title={t('Tagihan & Pajak')} subtitle={t('Rekap tagihan per B/L. PPh 23 hanya dihitung saat ditandai berlaku; verifikasi dasar pajak dan bukti potong tetap wajib.')}/>
  <div className="grid sm:grid-cols-3 gap-3">{[['Total tagihan hasil filter',totals.gross],['PPh 23 hasil filter',totals.pph],['Bersih dibayar hasil filter',totals.net]].map(([label,value])=><div className="card p-4" key={label}><p className="text-xs text-zinc-400">{t(label)}</p><p className="mt-2 text-xl tabular-nums">{formatRegisterAmount(value)}</p></div>)}</div>
  <p className="text-xs text-zinc-500">{t('Ringkasan mencakup seluruh hasil filter, bukan hanya halaman ini. Nominal belum diisi tidak dianggap nol.')}{totals.amountMissing>0&&<> {totals.amountMissing} {t('B/L belum memiliki nominal.')}</>}</p>
  <input className="input-field max-w-xl" type="search" aria-label={t('Cari B/L atau pelayaran')} placeholder={t('Cari B/L atau pelayaran')} value={search} onChange={event=>setQuery({search:event.target.value,page:null})}/>
  <Notice message={resource.error}/><DataTable mobileCards rows={rows} pagination={resource.pagination} empty={t('Belum ada data tagihan.')} columns={[
   {key:'billNumber',label:t('B/L & Mitra'),primary:true,width:'24%',render:row=><><Link className="font-semibold text-brand-400" to={`/bl-register/${row.id}`}>{row.billNumber}</Link><p className="table-subtext">{row.vendorName||'—'}</p></>},
   {key:'invoiceNumber',label:t('Invoice'),width:'16%',render:row=><>{row.invoiceNumber||'—'}<p className="table-subtext">{row.invoiceDate?.slice(0,10)||'—'}</p></>},
   {key:'dueDate',label:t('Jatuh tempo'),width:'13%',render:row=><>{row.dueDate?.slice(0,10)||'—'}<p className="table-subtext">{t(({NOT_RECEIVED:'Belum diterima',RECEIVED:'Diterima',CHECKED:'Diperiksa',PAID:'Lunas',PARTIALLY_PAID:'Dibayar sebagian'})[row.billingStatus]||row.billingStatus)}</p></>},
   {key:'grossAmount',label:t('Jumlah tagihan'),align:'right',width:'18%',render:row=><>{formatRegisterAmount(row.grossAmount)}<p className="table-subtext">{t('PPh 23')}: {row.pph23Applicable?formatRegisterAmount(row.pph23Amount):t('Tidak berlaku')}</p></>},
   {key:'netPayable',label:t('Bersih dibayar'),align:'right',width:'18%',render:row=>formatRegisterAmount(row.netPayable)},
   {key:'documents',label:t('Dokumen pajak'),width:'11%',render:row=><Link to={`/bl-register/${row.id}?tab=costs&documents=1`} className="text-brand-400"><span className="table-pill">{[row.hasInvoice,row.hasTaxInvoice,row.hasPphCertificate].filter(Boolean).length} {t('tersedia')}</span><p className="table-subtext">{t('Lihat dokumen')}</p></Link>},
  ]}/></div>;
}

import { ArrowRight, ChevronDown, FileText } from 'lucide-react';
import { useBL } from '../../i18n/bl.mjs';
import { formatRegisterAmount, isRegisterArchived } from './registerModel.mjs';
import { Link } from 'react-router-dom';
import { DataTable } from '../../components/jpt/Workspace';

function ReadField({ label, children }) { const { t } = useBL(); return <div><dt>{t(label)}</dt><dd>{children==null||children===''?'—':children}</dd></div>; }
export function BillingSummary({ bill }) {
  const { t, locale } = useBL(); const book = bill.register || {};
  const date = value => value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : '—';
  return <section className="bl-section"><div className="bl-section-heading"><div><h2>{t('Tagihan register')}</h2><p>{t('Data tagihan yang dicatat pada register pengiriman.')}</p></div><FileText size={18} className="text-zinc-400" /></div><dl className="bl-read-grid" style={{ paddingTop: 0 }}>
    <ReadField label="Nomor internal">{book.reference1}</ReadField><ReadField label="Nomor invoice">{book.reference2}</ReadField><ReadField label="Tanggal invoice">{date(book.additionalDate1)}</ReadField><ReadField label="Jumlah tagihan">{formatRegisterAmount(bill.registerAmount)}</ReadField>
    <ReadField label="Status tagihan">{t(({NOT_RECEIVED:'Belum diterima',RECEIVED:'Diterima',VERIFIED:'Terverifikasi',APPROVED:'Disetujui',PAID:'Lunas'})[book.billingStatus||'NOT_RECEIVED']||book.billingStatus)}</ReadField><ReadField label="Jatuh tempo">{date(book.additionalDate2)}</ReadField><ReadField label="Potong PPh 23 sebesar 2%">{t(book.pph23Applicable?'Ya':'Tidak')}</ReadField>
  </dl></section>;
}
export default function BLSummary({ bill }) {
  const { t, locale } = useBL(); const book = bill.register || {}; const containers = bill.containers || [];
  const date = value => value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : '—';
  return <section data-bl-summary className="space-y-5">
    <section className="bl-section">
      <div className="bl-section-heading"><h2>{t('Ringkasan & B/L')}</h2>{bill.vesselId && <Link className="text-brand-500 text-sm" to={bill.voyageId?`/vessels/${bill.vesselId}/voyages/${bill.voyageId}`:`/vessels/${bill.vesselId}`}>{t('Buka kapal dan voyage')} →</Link>}</div>
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3 text-sm"><span>{t('Pelabuhan asal')}: <strong>{bill.portOfLoading || '—'}</strong></span><ArrowRight size={16} aria-hidden="true" /><span>{t('Pelabuhan tujuan')}: <strong>{bill.portOfDischarge || '—'}</strong></span></div>
      <dl className="bl-read-grid" style={{ paddingTop: 0 }}>
        <ReadField label="Nomor B/L">{bill.billNumber}</ReadField><ReadField label="Pelayaran">{bill.carrierName}</ReadField>
        <ReadField label="Pengirim">{bill.shipperName}</ReadField><ReadField label="Penerima">{bill.consigneeName}</ReadField><ReadField label="Notify party">{bill.notifyPartyName}</ReadField><ReadField label="Vendor/JPT">{book.partyName}</ReadField>
      </dl>
    </section>
    <section className="bl-section"><div className="bl-section-heading"><h2>{t('Kontainer dalam B/L')} <span className="text-sm font-normal text-zinc-500">({containers.length})</span></h2></div><div className="bl-section-content"><DataTable mobileCards rows={containers} empty="Belum ada nomor kontainer pada B/L ini." columns={[{key:'number',label:'Nomor kontainer',primary:true},{key:'seal',label:'Segel'},{key:'size',label:'Ukuran'}]}/></div></section>
    <details className="bl-section bl-extra"><summary>{t('Muatan dan catatan tambahan')}<ChevronDown size={16} /></summary>
      <dl className="bl-read-grid" style={{ paddingTop: 0 }}>
        <ReadField label="Uraian barang">{book.cargoDescription}</ReadField><ReadField label="Berat kotor (kg)">{bill.grossWeightKg}</ReadField><ReadField label="Catatan">{bill.notes}</ReadField><ReadField label="Jumlah manual pada register">{['20', '21', '40'].map(size => `${size}′: ${book[`quantity${size}`] ?? '—'}`).join(' · ')}</ReadField><ReadField label="Catatan tambahan">{book.additionalNotes}</ReadField><ReadField label="Pihak penanggung jawab">{book.partyText}</ReadField>
        <ReadField label="Tanggal keluar">{date(book.departureDate)}</ReadField><ReadField label="Tanggal masuk">{date(book.arrivalDate)}</ReadField><ReadField label="Makna tanggal">{t(book.dateMeaning || 'UNCONFIRMED')}</ReadField><ReadField label="Tanggal penerbitan B/L">{date(bill.issueDate)}</ReadField><ReadField label="Tanggal muat di kapal">{date(bill.onBoardDate)}</ReadField>
      </dl>
      <h3 className="px-5 pb-3 text-sm font-semibold">{t('Aturan dokumen mitra')}</h3><dl className="bl-read-grid" style={{ paddingTop: 0 }}><ReadField label="Dokumen dari mitra">{book.documentPolicy?t(book.documentPolicy==='BL_AND_PACKING'?'B/L dan Packing List':'B/L saja'):'—'}</ReadField><ReadField label="Masukkan ke Kepala Packing List">{book.includeInPackingHeader==null?'—':t(book.includeInPackingHeader?'Ya':'Tidak')}</ReadField></dl>
      <h3 className="px-5 pb-3 text-sm font-semibold">{t('Informasi pencatatan')}</h3><dl className="bl-read-grid" style={{ paddingTop: 0 }}><ReadField label="Tanggal dibuat">{date(bill.createdAt)}</ReadField><ReadField label="Terakhir diperbarui">{date(bill.updatedAt)}</ReadField><ReadField label="Arsip">{t(isRegisterArchived(bill)?'Diarsipkan':'Aktif')}</ReadField></dl>
    </details>
  </section>;
}

import { ArrowRight, Ship, Boxes, Files, PackageCheck, CheckCircle2, Clock3, ChevronDown, FileText } from 'lucide-react';
import { useBL } from '../../i18n/bl.mjs';
import { registerDocumentAvailability, formatRegisterAmount, isRegisterArchived } from './registerModel.mjs';
import { Link } from 'react-router-dom';
import {DataTable} from '../../components/jpt/Workspace';

export function overviewOf(bill) {
  const book = bill.register || {}; const operational = bill.operational || bill.registerData?.operational || {};
  const sourceType=bill.registerData?.internalPackingList?.sourceType;
  const packing = sourceType==='MANUAL'?bill.registerData?.manualPacking||{}:sourceType==='RECEIVING_REPORT'?bill.registerData?.receivingReport||{}:operational.packing || {}; const files = bill.files || []; const flags = bill.documentAvailability || {};
  const has = category => files.some(file => file.category === category);
  const partner = book.documentPolicy === 'BL_AND_PACKING';
  const documents = [
    { label: 'File B/L', ready: registerDocumentAvailability(bill).billOfLading, tab: 'summary' },
    { label: 'Packing List SCMU', ready: Boolean(flags.internalPackingList ?? has('INTERNAL_PACKING_LIST')), tab: 'packing' },
  ];
  return { book, operational, packing, documents, ready: documents.filter(d => d.ready).length, containers: bill.containers || [] };
}
function ReadField({ label, children }) { const { t } = useBL(); return <div><dt>{t(label)}</dt><dd>{children==null||children===''?'—':children}</dd></div>; }
function Metric({ icon: Icon, label, value, note, color }) {
  const { t } = useBL();
  const palette = { blue: { background: '#eff6ff', color: '#2563eb' }, green: { background: '#ecfdf5', color: '#047857' }, amber: { background: '#fffbeb', color: '#b45309' } };
  return <div className="bl-metric"><div className="bl-metric-icon" style={palette[color]}><Icon size={20} /></div><div className="min-w-0"><p className="bl-metric-label">{t(label)}</p><strong className="bl-metric-value">{value}</strong><p className="bl-metric-note">{note}</p></div></div>;
}
export function BillingSummary({ bill }) {
  const { t, locale } = useBL(); const book = bill.register || {};
  const date = value => value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : '—';
  return <section className="bl-section"><div className="bl-section-heading"><div><h2>{t('Tagihan register')}</h2><p>{t('Data tagihan yang dicatat pada register pengiriman.')}</p></div><FileText size={18} className="text-zinc-400" /></div><dl className="bl-read-grid" style={{ paddingTop: 0 }}>
    <ReadField label="Nomor internal">{book.reference1}</ReadField><ReadField label="Nomor invoice">{book.reference2}</ReadField><ReadField label="Tanggal invoice">{date(book.additionalDate1)}</ReadField><ReadField label="Jumlah tagihan">{formatRegisterAmount(bill.registerAmount)}</ReadField>
    <ReadField label="Status tagihan">{t(({NOT_RECEIVED:'Belum diterima',RECEIVED:'Diterima',VERIFIED:'Terverifikasi',APPROVED:'Disetujui',PAID:'Lunas'})[book.billingStatus||'NOT_RECEIVED']||book.billingStatus)}</ReadField><ReadField label="Jatuh tempo">{date(book.additionalDate2)}</ReadField><ReadField label="Potong PPh 23 sebesar 2%">{t(book.pph23Applicable?'Ya':'Tidak')}</ReadField>
  </dl></section>;
}
export default function BLSummary({ bill, onNavigate }) {
  const { t, locale } = useBL(); const { book, operational, packing, documents, ready, containers } = overviewOf(bill);
  const date = value => value ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value)) : '—';
  const sizes = ['20', '21', '40'].map(size => ({ size, count: containers.filter(c => String(c.size) === size).length })).filter(c => c.count);
  const packingLabel = packing.status === 'CONFIRMED' ? 'Dikonfirmasi' : packing.groups?.length ? 'Draf' : 'Belum diisi';
  const missing = documents.filter(d => !d.ready);
  return <section data-bl-summary>
    {!bill.workflow&&<div className="bl-metrics">
      <Metric icon={Boxes} label="Total kontainer" value={containers.length} note={sizes.length ? sizes.map(c => `${c.count} × ${c.size}′`).join(' · ') : t('Ukuran belum dicatat')} color="blue" />
      <Metric icon={Files} label="Kelengkapan berkas" value={`${ready} / ${documents.length}`} note={t(ready === documents.length ? 'Seluruh berkas wajib tersedia' : 'Berkas wajib masih perlu dilengkapi')} color={ready === documents.length ? 'green' : 'amber'} />
      <Metric icon={PackageCheck} label="Transkripsi Packing List" value={t(packingLabel)} note={t(packing.status === 'CONFIRMED' ? 'Telah dikonfirmasi manual oleh admin' : 'Periksa rincian sebelum digunakan')} color={packing.status === 'CONFIRMED' ? 'green' : 'blue'} />
    </div>}
    <div className="bl-overview-grid">
      <div className="space-y-5">
        <section className="bl-section">
          <div className="bl-section-heading"><h2 className="flex items-center gap-2"><Ship size={17} className="text-brand-500" />{t('Rute pengiriman')}</h2><span className="bl-status bl-status-blue">{t('Angkutan laut')}</span></div>
          <div className="bl-route"><div><small>{t('Pelabuhan asal')}</small><strong>{bill.portOfLoading || '—'}</strong></div><ArrowRight size={27} className="bl-route-arrow" /><div><small>{t('Pelabuhan tujuan')}</small><strong>{bill.portOfDischarge || '—'}</strong></div></div>
          <dl className="bl-read-grid"><ReadField label="Tanggal keluar">{date(book.departureDate)}</ReadField><ReadField label="Tanggal masuk">{date(book.arrivalDate)}</ReadField><ReadField label="Pelayaran">{bill.carrierName}</ReadField><ReadField label="Makna tanggal">{t(book.dateMeaning || 'UNCONFIRMED')}</ReadField><ReadField label="Tanggal penerbitan B/L">{date(bill.issueDate)}</ReadField><ReadField label="Tanggal muat di kapal">{date(bill.onBoardDate)}</ReadField></dl>
          {bill.vesselId&&<div className="px-5 pb-4"><Link className="text-brand-400 text-sm" to={bill.voyageId?`/vessels/${bill.vesselId}/voyages/${bill.voyageId}`:`/vessels/${bill.vesselId}`}>{t('Buka kapal dan voyage')} →</Link></div>}
        </section>
        <section className="bl-section"><div className="bl-section-heading"><h2>{t('Pihak terkait')}</h2></div><dl className="bl-read-grid" style={{ paddingTop: 0 }}><ReadField label="Pengirim">{bill.shipperName}</ReadField><ReadField label="Penerima">{bill.consigneeName}</ReadField><ReadField label="Notify party">{bill.notifyPartyName}</ReadField><ReadField label="Vendor/JPT">{book.partyName}</ReadField><ReadField label="Pihak penanggung jawab">{book.partyText}</ReadField></dl></section>
        <section className="bl-section"><div className="bl-section-heading"><div><h2>{t('Kontainer dalam B/L')}</h2><p>{t('Identitas dari B/L untuk mencocokkan Packing List. Koreksi melalui Ubah data.')}</p></div></div><div className="bl-section-content"><DataTable mobileCards rows={containers} empty="Belum ada nomor kontainer pada B/L ini." columns={[{key:'number',label:'Nomor kontainer',primary:true},{key:'seal',label:'Segel'},{key:'size',label:'Ukuran'}]}/></div></section>
        <details className="bl-section bl-extra"><summary>{t('Muatan dan catatan tambahan')}<ChevronDown size={16} /></summary><dl className="bl-read-grid" style={{ paddingTop: 0 }}><ReadField label="Uraian barang">{book.cargoDescription}</ReadField><ReadField label="Berat kotor (kg)">{bill.grossWeightKg}</ReadField><ReadField label="Catatan">{bill.notes}</ReadField><ReadField label="Jumlah manual pada register">{['20', '21', '40'].map(size => `${size}′: ${book[`quantity${size}`] ?? '—'}`).join(' · ')}</ReadField><ReadField label="Catatan tambahan">{book.additionalNotes}</ReadField></dl></details>
        <details className="bl-section bl-extra"><summary>{t('Aturan dokumen mitra')}<ChevronDown size={16} /></summary><dl className="bl-read-grid" style={{ paddingTop: 0 }}><ReadField label="Dokumen dari mitra">{book.documentPolicy?t(book.documentPolicy==='BL_AND_PACKING'?'B/L dan Packing List':'B/L saja'):'—'}</ReadField><ReadField label="Masukkan ke Kepala Packing List">{book.includeInPackingHeader==null?'—':t(book.includeInPackingHeader?'Ya':'Tidak')}</ReadField></dl></details>
        <details className="bl-section bl-extra"><summary>{t('Informasi pencatatan')}<ChevronDown size={16} /></summary><dl className="bl-read-grid" style={{ paddingTop: 0 }}><ReadField label="Tanggal dibuat">{date(bill.createdAt)}</ReadField><ReadField label="Terakhir diperbarui">{date(bill.updatedAt)}</ReadField><ReadField label="Arsip">{t(isRegisterArchived(bill)?'Diarsipkan':'Aktif')}</ReadField></dl></details>
      </div>
      <div className="space-y-5">
        <BillingSummary bill={bill}/>
        <section className="bl-section"><div className="bl-section-heading"><div><h2>{t('Dokumen pengiriman')}</h2><p>{t('Ketersediaan berkas sesuai aturan mitra.')}</p></div></div><div className="bl-section-content">{documents.map(doc => <div key={doc.label} className="bl-document-row">{doc.ready ? <CheckCircle2 size={19} className="shrink-0 text-emerald-400" /> : <Clock3 size={19} className="shrink-0 text-amber-300" />}<div className="min-w-0"><strong>{t(doc.label)}</strong><span>{t(doc.ready ? 'Sudah tersedia' : 'Perlu dilengkapi')}</span></div><button type="button" onClick={() => onNavigate(doc.tab)}>{t(doc.ready ? 'Lihat' : 'Lengkapi')}</button></div>)}<p className="text-xs text-zinc-500 mt-2">{t('Berkas tersedia belum berarti B/L terverifikasi atau barang telah dilepas.')}</p></div></section>
        <section className="bl-section"><div className="bl-section-heading"><h2>{t('Tindakan berikutnya')}</h2></div><div className="bl-section-content space-y-3">{missing.length ? <><p className="text-sm text-zinc-400">{t('Lengkapi berkas pengiriman yang belum tersedia.')}</p><button type="button" className="btn btn-primary bg-brand-500 text-white rounded-lg px-4 py-2 text-sm font-medium inline-flex items-center gap-2" onClick={() => onNavigate(missing[0].tab)}>{t('Lengkapi dokumen')}<ArrowRight size={15} /></button></> : <><p className="text-sm text-zinc-400">{t('Berkas tersedia. Admin dapat memeriksa file asli dan mencatat koreksi.')}</p><button type="button" className="text-brand-400 text-sm font-medium" onClick={() => onNavigate('summary')}>{t('Periksa B/L')} →</button></>}</div></section>
        <section className="bl-section"><div className="bl-section-heading"><h2>{t('Bonrate Sopir')}</h2></div><div className="bl-section-content space-y-2"><p className="text-sm">{t('Total bonrate')}: <strong>{bill.registerData?.driverBons?.length||0}</strong></p><p className="text-xs text-zinc-500">{t('Penugasan sopir dan ritase terhubung ke B/L ini.')}</p><button type="button" className="text-brand-400 text-sm font-medium" onClick={()=>onNavigate('driver-bons')}>{t('Kelola bonrate sopir')} →</button></div></section>
      </div>
    </div>
  </section>;
}

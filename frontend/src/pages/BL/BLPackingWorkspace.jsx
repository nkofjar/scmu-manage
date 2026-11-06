import {useBL} from '../../i18n/bl.mjs';

import RegisterDocuments from './RegisterDocuments';
import InternalPackingCreator from './InternalPackingCreator';
import {isRegisterArchived} from './registerModel.mjs';
import BillFileReferences from './BillFileReferences';

export default function BLPackingWorkspace({bill,onChanged}) {
 const {t}=useBL();
 const packing=bill.registerData?.operational?.packing;
 const hasPartner=(bill.files||[]).some(file=>file.category==='PACKING_LIST');
 return <div className="space-y-5" data-bl-packing-workspace>
  <section className="card p-5 space-y-3" data-packing-primary="sources">
   <RegisterDocuments key="sources" compact embedded bill={bill} owner="PACKING" packingView="SOURCES" onVersion={onChanged}>
    <div className="flex flex-wrap items-center gap-3 text-sm"><span>{t('Status pemeriksaan sumber')}: <strong>{t(packing?.status==='CONFIRMED'?'Sudah diperiksa':packing?.groups?.length?'Perlu diperiksa ulang':'Belum diperiksa')}</strong></span><InternalPackingCreator bill={bill} purpose="HEAD" label="Periksa rincian" disabled={isRegisterArchived(bill)} onCreated={onChanged}/></div>
   </RegisterDocuments>
   {!hasPartner&&<p className="text-sm text-zinc-500">{t('PL mitra belum tersedia. Anda tetap dapat membuat PL dari data manual atau Berita Acara.')}</p>}
  </section>
  <section className="card p-5 space-y-3 border-brand-500/30" data-packing-primary="head" data-bl-packing-section="head">
   <h2 className="font-semibold">{t('Kepala Packing List B/L ini')}</h2>
   <p className="text-sm text-zinc-400">{t('Ringkasan dari PL mitra B/L ini, bukan rekap seluruh pengiriman.')}</p>
   <InternalPackingCreator bill={bill} purpose="HEAD" disabled={isRegisterArchived(bill)} onCreated={onChanged}/>
   <RegisterDocuments key="results" compact embedded bill={bill} owner="PACKING" packingView="RESULTS" onVersion={onChanged}/>
  </section>
  <details className="text-sm" data-bl-packing-secondary>
   <summary className="cursor-pointer font-semibold text-sm">{t('Opsi lain: manual, Berita Acara & pemeriksaan lapangan')}</summary>
   <div className="mt-3 space-y-3"><p className="text-sm text-zinc-400">{t('Buat PL dari data manual, Berita Acara, atau buka lembar pemeriksaan.')}</p><BillFileReferences bill={bill} categories={['RECEIVING_REPORT']} title="Berkas Berita Acara"/><InternalPackingCreator bill={bill} disabled={isRegisterArchived(bill)} onCreated={onChanged}/></div>
  </details>
 </div>;
}

import { useEffect, useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LayoutDashboard, Truck, PackageOpen, Wallet, Archive, Save } from 'lucide-react';
import api from '../../api/client';
import { Button, Modal } from '../../components/common';
import { DataTable, Notice, usePagedResource } from '../../components/jpt/Workspace';
import { useDetailNavigation, useWorkspaceNavigation } from '../../components/Layout/PageNavigation';
import { useBL } from '../../i18n/bl.mjs';
import RegisterForm from './RegisterForm';
import BLPageHeader from './BLPageHeader';
import BLSummary, { BillingSummary } from './BLSummary';
import RegisterDocuments from './RegisterDocuments';
import BLPackingWorkspace from './BLPackingWorkspace';
import TariffEstimator from './TariffEstimator';
import { OperationalWorkspace, OperationalCosts } from './BLWorkspacePanels';
import DriverBons from './DriverBons';
import BillDriverOperations from './BillDriverOperations';
import ShipmentProgress from './ShipmentProgress';
import BillFileReferences from './BillFileReferences';
import { isRegisterArchived, isRegisterDeleted } from './registerModel.mjs';

const sections = [
  { value: 'summary', label: 'Ringkasan & B/L', icon: LayoutDashboard, tabs: ['summary'] },
  { value: 'packing', label: 'Packing List', icon: PackageOpen, tabs: ['packing'] },
  { value: 'driver-bons', label: 'Bonrate Sopir', icon: Truck, tabs: ['driver-bons'] },
  { value: 'costs', label: 'Biaya & Riwayat', icon: Wallet, tabs: ['costs', 'history'] },
];

export default function BLWorkspace({ bill: initialBill }) {
  const [bill, setBill] = useState(initialBill); const [params, setParams] = useSearchParams();
  const documentsRequested = params.get('tab') === 'documents' || params.get('supporting') === '1' || params.get('documents') === '1';
  const deadlinesRequested = ['checks','matching'].includes(params.get('tab')) || params.get('deadlines') === '1';
  const [documentsOpen, setDocumentsOpen] = useState(documentsRequested); const [deadlinesOpen, setDeadlinesOpen] = useState(deadlinesRequested);
  useEffect(() => { if (documentsRequested) setDocumentsOpen(true); if (deadlinesRequested) setDeadlinesOpen(true); }, [documentsRequested, deadlinesRequested]);
  const { t } = useBL(); const navigation = useWorkspaceNavigation(); const id = useId();
  const [legacyFiles,setLegacyFiles]=useState(params.get('legacyFiles')==='1');
  useEffect(()=>{if(params.get('legacyFiles')==='1')setLegacyFiles(true);},[params]);
  const [editing, setEditing] = useState(() => !isRegisterArchived(initialBill) && (params.get('tab') === 'identity' || params.get('edit') === '1')); const [editorState, setEditorState] = useState({ saving: false, conflict: false }); const [success, setSuccess] = useState('');
  const legacyTab=params.get('tab');const requested=legacyTab==='documents'||params.get('supporting')==='1'?'costs':['containers','checks','matching'].includes(legacyTab)?'summary':legacyTab==='unloading'?'packing':legacyTab; const tab = sections.some(s => s.tabs.includes(requested)) ? requested : 'summary';
  const primary = sections.find(s => s.tabs.includes(tab)); const archived = isRegisterArchived(bill);
  const history = usePagedResource(tab === 'history' ? '/bl-register/' + bill.id + '/activity' : null, {}, 'activity');
  useDetailNavigation(bill.billNumber||t('Draf pengiriman'), null);
  const setTab = value => {
    navigation.scrollToTop();
    setParams(previous => { const next = new URLSearchParams(previous); next.set('tab', value); next.delete('supporting'); next.delete('documents'); return next; }, { replace: true });
  };
  const reload = async () => { const response = await api.get('/bl-register/' + bill.id); setBill(response.data); return response.data; };
  const closeEditor = (saved = false) => {
    if(editorState.saving && saved !== true)return;
    setEditing(false);
    if(params.get('tab')==='identity'||params.get('edit'))setParams(previous=>{const next=new URLSearchParams(previous);next.delete('edit');if(next.get('tab')==='identity')next.delete('tab');return next;},{replace:true});
  };
  const subTabs = primary.value === 'costs' ? [['costs', 'Biaya operasional'], ['history', 'Riwayat perubahan']] : [];
  const keyTabs = (event, index) => {
    const key = event.key; if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
    event.preventDefault(); const target = key === 'Home' ? 0 : key === 'End' ? sections.length - 1 : (index + (key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length;
    setTab(sections[target].value); document.getElementById(id + '-tab-' + sections[target].value)?.focus();
  };
  return <div className="bl-detail-page">
    <BLPageHeader bill={bill} onEdit={() => { setEditorState({ saving: false, conflict: false }); setEditing(true); }} />
    {!bill.journeyId&&<div className="bl-workspace-body"><Button variant="secondary" onClick={()=>setLegacyFiles(true)}>{t('Berkas lama B/L tanpa pengiriman')}</Button></div>}
    <div className="bl-workspace-body"><section data-bl-scope className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-brand-500/20 bg-brand-500/5 px-3 py-2 text-sm"><p>{t('Menampilkan data khusus B/L')}: <strong>{bill.billNumber || t('Draf pengiriman')}</strong></p>{bill.journeyId && <Link className="text-brand-500 underline" to={`/shipments/${bill.journeyId}`}>{t('Lihat pengiriman kapal')} →</Link>}</section>{!isRegisterDeleted(bill)&&<ShipmentProgress bill={bill}/>}
      {success && <p role="status" className="rounded-lg border border-emerald-600/30 bg-emerald-500/5 px-4 py-3 mb-5 text-sm text-emerald-400">{t(success)}</p>}
      {archived && <div className="bl-archived-notice"><Archive size={17} />{isRegisterDeleted(bill)?<div><p>{t('Pengiriman berada di Sampah dan hanya dapat dibaca. Pulihkan untuk mengubah data.')}</p><p className="text-sm mt-1">{t('Alasan penghapusan')}: {bill.trash?.reason||bill.registerData?.trash?.reason}</p><Link className="text-brand-500 underline" to="/bl-register/trash">{t('Buka Sampah')}</Link></div>:t('Register diarsipkan: hanya baca. Pulihkan dari daftar untuk mengubah data.')}</div>}
      <nav className="bl-primary-tabs" role="tablist" aria-label={t('Bagian pengiriman')} data-bl-tabs>
        {sections.map((s, index) => <button key={s.value} id={id + '-tab-' + s.value} role="tab" type="button" aria-selected={primary.value === s.value} tabIndex={primary.value === s.value ? 0 : -1} aria-controls={id + '-panel'} onClick={() => setTab(s.value)} onKeyDown={event => keyTabs(event, index)}><s.icon size={16} />{t(s.label)}</button>)}
      </nav>
      <div id={id + '-panel'} role="tabpanel" aria-labelledby={id + '-tab-' + primary.value} className="min-w-0">
        {subTabs.length > 0 && <div className="bl-subtabs" aria-label={t(primary.label)}>{subTabs.map(([value, label]) => <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}>{t(label)}</button>)}</div>}
        {tab === 'summary' && <div className="space-y-5"><BLSummary bill={bill} />
          <details className="bl-section bl-extra" open={deadlinesOpen} onToggle={event => setDeadlinesOpen(event.currentTarget.open)}><summary>{t('Batas waktu pelabuhan')}</summary>{deadlinesOpen && <div className="p-4"><OperationalWorkspace bill={bill} section="checks" onChanged={reload}/></div>}</details>
        </div>}
        {tab === 'driver-bons' && <div className="space-y-5">{bill.journeyId?<BillDriverOperations bill={bill} onChanged={reload}/>:<DriverBons bill={bill} onChanged={reload} />}</div>}
        {tab === 'packing' && <BLPackingWorkspace bill={bill} onChanged={reload}/>}
        {tab === 'costs' && <div className="space-y-5"><BillingSummary bill={bill} /><OperationalCosts bill={bill} onChanged={reload} /><details className="bl-section bl-extra" open={documentsOpen} onToggle={event=>setDocumentsOpen(event.currentTarget.open)}><summary>{t('Dokumen transaksi & pajak')}</summary>{documentsOpen&&<RegisterDocuments key="finance-files" owner="SUPPORTING" documentArea="FINANCE" compact bill={bill} onVersion={reload}/>}</details><details className="card overflow-hidden"><summary className="cursor-pointer select-none px-5 py-4 font-semibold text-zinc-200 hover:bg-zinc-900/60">{t('Tarif pendapatan')}<span className="ml-2 text-xs font-normal text-zinc-500">{t('Buka untuk menghitung tagihan berdasarkan master tarif')}</span></summary><div className="border-t border-zinc-800 p-4"><TariffEstimator bill={bill} onChanged={reload} /></div></details></div>}
        {tab === 'history' && <section className="space-y-3"><h2 className="font-semibold text-base">{t('Riwayat perubahan')}</h2><Notice message={history.error} /><DataTable rows={history.rows} pagination={history.pagination} empty={t('No activity yet')} columns={[
          { key: 'createdAt', label: t('Date'), render: row => row.createdAt?.slice(0, 19).replace('T', ' ') },
          { key: 'action', label: t('Action'), render: row => t(row.action) }, { key: 'user', label: t('User'), render: row => row.user?.name || '—' },
          { key: 'metadata', label: t('Details'), render: row => <code className="text-xs break-all">{JSON.stringify(row.metadata)}</code> },
        ]} /></section>}
      </div>
    </div>
    {legacyFiles&&!bill.journeyId&&<Modal open title={t('Berkas lama B/L tanpa pengiriman')} onClose={()=>setLegacyFiles(false)}><BillFileReferences bill={bill} title="Arsip berkas asli"/></Modal>}
    {editing && <Modal open title={t('Ubah data pengiriman')} onClose={closeEditor} width="max-w-5xl" footer={<div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-zinc-500">{t('Perubahan berlaku setelah disimpan.')}</p><div className="flex gap-2"><Button type="button" variant="secondary" disabled={editorState.saving} onClick={closeEditor}>{t('Cancel')}</Button><Button type="submit" form={id + '-edit'} disabled={editorState.saving || editorState.conflict || archived}><Save size={15} />{t(editorState.saving ? 'Saving...' : 'Simpan perubahan')}</Button></div></div>}>
      <RegisterForm initial={bill} formId={id + '-edit'} hideActions onStateChange={setEditorState} onSaved={confirmed => { setBill(confirmed); closeEditor(true); setSuccess('Data pengiriman berhasil diperbarui.'); }} />
    </Modal>}
  </div>;
}

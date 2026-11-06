import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { Button } from '../../components/common';
import { DetailModal, DataTable, Notice } from '../../components/jpt/Workspace';
import DocumentPreview from '../../components/jpt/DocumentPreview';
import { useAuth } from '../../context/AuthContext';
import { useBL } from '../../i18n/bl.mjs';
import VoyagePacking from './VoyagePacking';
import { batchRow, batchOutcome, resolveBatchBL } from './documentBatchModel.mjs';
import JourneyImportGroups from '../Shipments/JourneyImportGroups';
import {journeyGroupKey,journeyGroupPlan,journeyGroupValid} from '../Shipments/journeyImportModel.mjs';

const types = { BILL_OF_LADING: 'B/L', DELIVERY_ORDER: 'Delivery Order (DO)', POWER_OF_ATTORNEY: 'Surat kuasa', SUPPORTING: 'Dokumen pendukung', UNKNOWN: 'Tentukan jenis dokumen' };
const labels = { vesselName: 'Nama kapal', voyageNumber: 'Nomor voyage', carrierName: 'Pelayaran', shipperName: 'Pengirim pada dokumen', consigneeName: 'Penerima pada dokumen', notifyPartyName: 'Notify party', portOfLoading: 'Pelabuhan asal', portOfDischarge: 'Pelabuhan tujuan', issueDate: 'Tanggal penerbitan B/L' };
const references = row => row.documentType === 'BILL_OF_LADING' ? [row.fields.billNumber] : row.references.split(/[,;\n]+/).map(v => v.trim()).filter(Boolean);

export default function DocumentBatch({ onSaved, journey, createJourneys=false, onManual, autoOpen=false, blOnly=false, buttonLabel }) {
  const { t } = useBL(), { user } = useAuth();
  const [open, setOpen] = useState(false), [phase, setPhase] = useState('CHOOSE');
  const [rows, setRows] = useState([]), [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(''), [review, setReview] = useState(null), [recap, setRecap] = useState(false), [restored, setRestored] = useState(false);
  const [groups,setGroups]=useState([]),[groupConfirmed,setGroupConfirmed]=useState(false);
  const input = useRef(),autoStarted=useRef(false), storageKey = 'scmu_document_batch_' + user?.id+(createJourneys?'_new_shipments':journey?'_journey_'+journey.id+(blOnly?'_bl':''):'');
  const update = (key, patch) => setRows(old => old.map(row => row.key === key ? { ...row, ...patch } : row));
  useEffect(() => {
    let alive = true; setRestored(false); setRows([]);
    let ids = []; try { ids = JSON.parse(sessionStorage.getItem(storageKey) || '[]'); } catch { /* Empty queue. */ }
    Promise.all(ids.slice(0, 20).map(id => api.get('/bl-imports/batch/' + id).then(r => batchRow(r.data)).catch(() => null))).then(values => { if (alive) { setRows(values.filter(Boolean)); setRestored(true); } });
    return () => { alive = false; };
  }, [storageKey]);
  useEffect(() => {
    if (restored) try { sessionStorage.setItem(storageKey, JSON.stringify(rows.filter(row => row.id).map(row => row.id))); } catch { /* Browser storage is optional. */ }
  }, [rows, storageKey, restored]);
  const begin = async () => {
    setOpen(true); setPhase(journey?'UPLOAD':'CHOOSE'); setError(''); setRefreshing(true);
    try {
      // Refresh receipts: an attached file may have been deleted after upload.
      const current = await Promise.all(rows.filter(row => row.saved).map(row => api.get('/bl-imports/batch/' + row.id).then(r => ({ key: row.key, value: batchRow(r.data) })).catch(e => ({ key: row.key, error: e.response?.data?.message || e.message }))));
      setRows(old => old.map(row => { const result = current.find(item => item.key === row.key); return result ? result.value ? { ...row, ...result.value } : { ...row, status: 'ERROR', saved: null, reviewed: false, error: result.error } : row; }));
    } finally { setRefreshing(false); }
  };
  useEffect(()=>{if(autoOpen&&restored&&!autoStarted.current){autoStarted.current=true;void begin();}},[autoOpen,restored]);
  const upload = async (files, existingKey = null) => {
    if (busy || refreshing) return; setError('');
    if ((existingKey ? 0 : files.length) + rows.length > 20) { setError(t('Maksimal 20 dokumen per antrean.')); return; }
    setBusy(true);
    for (const file of files) {
      const key = existingKey || crypto.randomUUID();
      if (existingKey) update(key, { status: 'READING', error: '', saved: null, reviewed: false });
      else setRows(old => [...old, { key, name: file.name, localFile: file, status: 'READING' }]);
      try {
        if (!file.size || file.size > 5 * 1024 * 1024) throw Error(t('Setiap file harus berisi data dan maksimal 5 MB.'));
        const body = new FormData(); body.append('file', file);
        const data = (await api.post('/bl-imports/batch/file', body, { timeout: 110000 })).data;
        update(key, { ...batchRow(data), key, localFile: file, error: '' });
      } catch (e) { update(key, { status: 'ERROR', error: e.response?.data?.message || e.message }); }
    }
    setBusy(false); if (input.current) input.current.value = '';
  };
  const remove = async row => {
    setBusy(true); setError('');
    try { if (row.id) await api.delete('/bl-imports/' + row.id); setRows(old => old.filter(r => r.key !== row.key)); }
    catch (e) { setError(e.response?.data?.message || e.message); }
    finally { setBusy(false); }
  };
  const prepareGroups=async()=>{
    setBusy(true);setError('');setGroupConfirmed(false);
    try{const documents=ready.filter(r=>r.documentType==='BILL_OF_LADING').map(r=>({sessionId:r.id,fields:r.fields}));const data=documents.length?(await api.post('/bl-imports/batch/journeys/preview',{documents})).data:{groups:[]};setGroups(data.groups);setPhase('GROUP');}
    catch(e){setError(e.response?.data?.message||e.message);}finally{setBusy(false);}
  };
  const commit = async () => {
    setBusy(true); setError('');
    const planned=new Map();
    const selected = rows.filter(row => row.reviewed && !['SAVED', 'REMOVED', 'TRASHED'].includes(row.status)).sort((a, b) => Number(b.documentType === 'BILL_OF_LADING') - Number(a.documentType === 'BILL_OF_LADING'));
    for (const row of selected) {
      try {
        if(blOnly&&row.documentType!=='BILL_OF_LADING')throw Error(t('Gunakan tab Dokumen untuk berkas pendukung. Bagian ini khusus B/L.'));
        const numbers = references(row), targets = (await api.post('/bl-imports/batch/targets', { numbers })).data;
        if (row.documentType === 'BILL_OF_LADING' && row.action === 'CREATE' && resolveBatchBL(targets, row.fields.billNumber).kind !== 'NEW') {
          update(row.key, { reviewed: false, targets, error: t('Nomor B/L kini sudah tersedia. Periksa kembali untuk menambahkan file ke pengiriman tersebut.') }); continue;
        }
        const group=createJourneys&&row.documentType==='BILL_OF_LADING'?groups.find(g=>g.documents.some(d=>d.sessionId===row.id)):null;
        if(createJourneys&&row.documentType==='BILL_OF_LADING'&&(!groupConfirmed||!group||!journeyGroupValid(group)))throw Error(t('Periksa dan konfirmasi pengelompokan pengiriman.'));
        const key=group&&journeyGroupKey(group),journeyPlan=group?(planned.get(key)||journeyGroupPlan(group)):null;
        const result = (await api.post('/bl-imports/batch/commit', { sessionId: row.id, ...(journey?{journeyId:journey.id}:{}),...(journeyPlan?{journeyPlan}:{}), confirmed: true, documentType: row.documentType, category: row.category, fields: row.fields, referenceBillNumbers: numbers, documentNumber: row.documentNumber, documentDate: row.documentDate, action: row.action, targets: targets.flatMap(target => target.bills.map(bill => ({ id: bill.id, version: bill.version }))) })).data;
        if(group&&result.journeyTarget){const target=result.journeyTarget;planned.set(key,{mode:'EXISTING',targetId:target.id,identity:target.identity,confirmed:true});setGroups(old=>old.map(g=>journeyGroupKey(g)===key?{...g,mode:'EXISTING',targetId:target.id,candidates:[...g.candidates.filter(c=>c.id!==target.id),{...target.fields,id:target.id,identity:target.identity,archived:false}]}:g));}
        update(row.key, { status: 'SAVED', saved: result, error: '' });
      } catch (e) { update(row.key, { error: e.response?.data?.message || e.message }); }
    }
    try { await onSaved?.(); } finally { setBusy(false);if(createJourneys)setPhase('UPLOAD'); }
  };
  const outcome = batchOutcome(rows), ready = rows.filter(row => row.reviewed && !['SAVED', 'REMOVED', 'TRASHED'].includes(row.status)), disabled = busy || refreshing;
  return <>
    <Button disabled={!restored} onClick={begin}>{t(buttonLabel||(journey?'Unggah B/L dan dokumen':'Tambah pengiriman'))}</Button>
    {open && <DetailModal title={blOnly?'Unggah B/L':journey?'Unggah B/L dan dokumen':phase === 'CHOOSE' ? 'Tambah pengiriman' : 'Tambah pengiriman · Unggah dokumen'} onClose={() => !disabled && setOpen(false)} actions={phase === 'UPLOAD' ? <>
      {!journey&&<Button variant="secondary" disabled={disabled} onClick={() => setPhase('CHOOSE')}>{t('Kembali')}</Button>}
      <Button disabled={disabled || !ready.length} onClick={createJourneys?prepareGroups:commit}>{t(busy ? 'Memproses…' : createJourneys?'Periksa pengelompokan':'Simpan yang diperiksa')} ({ready.length})</Button>
      {outcome.billIds.length > 0 && (!createJourneys||outcome.journeyIds.length===1) && <Button variant="secondary" disabled={disabled} onClick={() => setRecap(true)}>{t('Buat Packing List Pengiriman')}</Button>}
    </> : phase==='GROUP'?<><Button variant="secondary" disabled={disabled} onClick={()=>setPhase('UPLOAD')}>{t('Kembali')}</Button><Button disabled={disabled||!groupConfirmed||!groups.every(journeyGroupValid)||!ready.length} onClick={commit}>{t('Simpan pengiriman dan dokumen')} ({ready.length})</Button></>:null}>
      {phase === 'CHOOSE' ? <div className="space-y-4" data-shipment-entry>
        <p className="text-sm text-zinc-500">{t('Mulai dari dokumen yang diterima atau isi pengiriman secara manual. Semua hasil tersimpan di daftar Pengiriman yang sama.')}</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <button type="button" className="card p-5 text-left border-brand-500/30 hover:bg-brand-500/5" disabled={disabled} onClick={() => setPhase('UPLOAD')}><span className="block font-semibold text-brand-500">{t(createJourneys?'Unggah B/L':'Unggah dokumen')}</span><span className="block text-sm text-zinc-500 mt-2">{t('Pilih satu atau banyak B/L, DO, surat kuasa, atau dokumen pendukung. Periksa hasil pembacaan sebelum menyimpan.')}</span></button>
          {onManual?<button type="button" className="card p-5 text-left hover:bg-brand-500/5" onClick={()=>{setOpen(false);onManual();}}><span className="block font-semibold text-brand-500">{t('Isi manual')}</span><span className="block text-sm text-zinc-500 mt-2">{t('Buat pengiriman meskipun dokumen belum tersedia. Dokumen dapat ditambahkan kemudian.')}</span></button>:<Link className="card p-5 hover:bg-brand-500/5" to="/bl-register/new"><span className="block font-semibold text-brand-500">{t('Isi manual')}</span></Link>}
        </div>
        {rows.length > 0 && <p className="text-sm text-zinc-500">{t('Antrean sebelumnya masih tersedia pada Unggah dokumen.')}</p>}
        {refreshing && <p role="status" className="text-sm">{t('Memperbarui status lampiran…')}</p>}
      </div> : phase==='GROUP'?<><Notice message={error}/><JourneyImportGroups groups={groups} disabled={disabled} confirmed={groupConfirmed} onConfirm={setGroupConfirmed} onChange={value=>{setGroups(value);setGroupConfirmed(false);}}/></>:<div className="space-y-4" data-document-batch>
        <p className="text-sm text-zinc-500">{t(journey?'Pilih satu atau banyak file. B/L baru ditambahkan ke pengiriman ini; dokumen untuk B/L yang sudah ada dilampirkan pada B/L tersebut.':createJourneys?'Unggah B/L, periksa hasil pembacaan, lalu tentukan pengelompokan pengiriman sebelum menyimpan.':'Pilih satu atau banyak file. Nomor B/L baru menjadi pengiriman baru; nomor yang sudah ada digunakan untuk menambahkan dokumen ke pengiriman tersebut.')}</p><Notice message={error} />
        <div className="border border-dashed border-brand-500/40 rounded-xl p-5 text-sm" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!disabled) upload(Array.from(event.dataTransfer.files)); }}><input aria-label={t('Pilih dokumen')} ref={input} type="file" multiple disabled={disabled} onChange={event => upload(Array.from(event.target.files))} /><p className="text-xs text-zinc-500 mt-2">{t('Maksimal 20 file, masing-masing 5 MB. PDF/gambar yang didukung dibaca lokal. Format lain dapat disimpan sebagai dokumen pendukung.')}</p></div>
        {(outcome.saved > 0 || outcome.removed > 0 || outcome.trashed > 0) && <div role="status" className="rounded-xl border border-brand-500/25 bg-brand-500/5 p-4 space-y-2" data-batch-outcome>
          <p className="font-medium">{createJourneys&&<>{outcome.journeyIds.length} {t('Pengiriman')} · </>}{outcome.created} {t(journey||createJourneys?'B/L baru':'pengiriman baru')} · {outcome.attached} {t(journey||createJourneys?'B/L dilengkapi':'pengiriman dilengkapi')} · {outcome.saved} {t('dokumen tersimpan')}</p>
          {outcome.pending > 0 && <p className="text-sm">{outcome.pending} {t('dokumen masih perlu diselesaikan. Rekap hanya mencakup dokumen yang sudah tersimpan dan masih tersedia.')}</p>}
          {outcome.removed > 0 && <p className="text-sm text-amber-500">{outcome.removed} {t('lampiran telah dihapus dari pengiriman. Unggah ulang jika ingin menambahkannya kembali.')}</p>}
          {outcome.trashed > 0 && <p className="text-sm text-amber-500">{outcome.trashed} {t('unggahan lama terhubung ke pengiriman di Sampah. Unggah kembali file untuk membuat pengiriman baru.')} <Link className="underline" to="/bl-register/trash">{t('Buka Sampah')}</Link></p>}
          <div className="flex flex-wrap gap-3"><Link className="text-brand-500 text-sm" to="/bl-register" onClick={() => setOpen(false)}>{t('Buka daftar pengiriman')}</Link>{createJourneys?outcome.journeyIds.map((id,i)=><Link key={id} className="text-brand-500 text-sm" to={'/shipments/'+id+'?tab=summary'} onClick={()=>setOpen(false)}>{t('Buka pengiriman')} {i+1} →</Link>):outcome.billIds.map(id => <Link key={id} className="text-brand-500 text-sm" to={'/bl-register/' + id}>{t('Buka pengiriman')} →</Link>)}</div>
        </div>}
        <DataTable mobileCards rows={rows} empty="Belum ada dokumen dipilih." actionPlacement="row" columns={[
          { key: 'name', label: 'File dokumen', primary: true, render: row => <span className="break-all">{row.originalName || row.name}</span> },
          { key: 'documentType', label: 'Jenis / Referensi', render: row => <><p>{t(types[row.documentType] || (row.status === 'READING' ? 'Membaca dokumen…' : '—'))}</p><p className="text-xs text-zinc-500 break-all">{row.documentType === 'BILL_OF_LADING' ? row.fields?.billNumber : row.references}</p></> },
          { key: 'status', label: 'Status', render: row => <div className="space-y-1"><span>{t(row.status === 'TRASHED' ? 'Pengiriman di Sampah' : row.status === 'REMOVED' ? 'Lampiran telah dihapus' : row.status === 'SAVED' ? 'Tersimpan' : row.status === 'READING' ? 'Membaca dokumen…' : row.status === 'ERROR' ? 'Gagal dibaca' : row.reviewed ? 'Siap disimpan' : 'Perlu diperiksa')}</span>{row.reviewed && row.status === 'READY' && row.documentType === 'BILL_OF_LADING' && <p className="text-xs text-zinc-500">{t(row.action === 'ATTACH' ? 'Menambahkan file ke pengiriman yang sudah ada' : createJourneys?'B/L baru; periksa pengelompokan sebelum menyimpan.':'Membuat pengiriman baru')}</p>}{row.error && <p role="alert" className="text-xs text-red-500">{row.error}</p>}{row.status === 'REMOVED' && <p className="text-xs text-amber-500">{t('Unggah ulang file bila masih diperlukan. Data pengiriman tetap tersedia.')}</p>}{!row.reviewed && row.status === 'READY' && row.targets?.some(target => target.bills.length) && <p className="text-xs text-brand-500">{t('Pengiriman sudah tersedia. File akan ditambahkan setelah diperiksa.')}</p>}</div> },
          { key: 'actions', label: 'Tindakan', items: [
            { key: 'review', label: 'Periksa', disabled: row => disabled || !row.id || ['SAVED', 'REMOVED', 'TRASHED', 'ERROR', 'READING'].includes(row.status), onClick: row => setReview(structuredClone({ ...row, localFile: undefined })) },
            { key: 'retry', label: row => ['REMOVED','TRASHED'].includes(row?.status) ? 'Unggah ulang' : 'Ulangi pembacaan', disabled: row => disabled || !['ERROR', 'REMOVED', 'TRASHED'].includes(row.status) || !row.localFile, onClick: row => upload([row.localFile], row.key) },
            { key: 'remove', label: 'Keluarkan dari antrean', disabled: () => disabled, onClick: remove },
          ] },
        ]} />
      </div>}
      {review && <Review row={review} journey={journey} createJourneys={createJourneys} blOnly={blOnly} onClose={() => setReview(null)} onConfirm={value => { update(value.key, { ...value, reviewed: true, error: '' }); setReview(null); }} />}
      {recap && <VoyagePacking initialIds={journey?[...new Set([...journey.bills.filter(b=>!b.archived&&b.billNumber).map(b=>b.id),...outcome.billIds])]:outcome.billIds} onClose={() => setRecap(false)} onSaved={onSaved} />}
    </DetailModal>}
  </>;
}

function Review({ row, journey, createJourneys, blOnly, onClose, onConfirm }) {
  const { t } = useBL(), [value, setValue] = useState(()=>blOnly&&!['BILL_OF_LADING','UNKNOWN'].includes(row.documentType)?{...row,documentType:'UNKNOWN'}:row), [confirmed, setConfirmed] = useState(false), [original, setOriginal] = useState(false);
  const [lookup, setLookup] = useState({ loading: true, targets: [], key: '' });
  const change = patch => { setValue(old => ({ ...old, ...patch })); setConfirmed(false); };
  const field = (key, input) => change({ fields: { ...value.fields, [key]: input } });
  const isBL = value.documentType === 'BILL_OF_LADING', lookupKey = JSON.stringify(references(value));
  useEffect(() => {
    const controller = new AbortController(); setLookup({ loading: true, targets: [], key: lookupKey }); setConfirmed(false);
    if (!JSON.parse(lookupKey).length || JSON.parse(lookupKey).some(number => !number?.trim())) { setLookup({ loading: false, targets: [], key: lookupKey }); return () => controller.abort(); }
    const timer = setTimeout(async () => {
      try { const result = await api.post('/bl-imports/batch/targets', { numbers: JSON.parse(lookupKey) }, { signal: controller.signal }); if (!controller.signal.aborted) setLookup({ loading: false, targets: result.data, key: lookupKey }); }
      catch (e) { if (!controller.signal.aborted) setLookup({ loading: false, targets: [], key: lookupKey, error: e.response?.data?.message || e.message }); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [lookupKey]);
  const resolution = resolveBatchBL(lookup.targets, value.fields.billNumber), attach = isBL && resolution.kind === 'EXISTING', checking = lookup.loading || lookup.key !== lookupKey;
  const blocked = isBL ? ['AMBIGUOUS', 'READ_ONLY'].includes(resolution.kind) : lookup.targets.some(target => target.bills.length > 1 || target.bills.some(bill => bill.readOnly || bill.archivedAt));
  const wrongJourney=attach&&journey&&resolution.bill.journeyId!==journey.id;
  const valid = !wrongJourney && (!blOnly||isBL) && value.documentType !== 'UNKNOWN' && (isBL ? value.fields.billNumber?.trim() : value.references.trim()) && (value.documentType !== 'DELIVERY_ORDER' || value.documentNumber && value.documentDate) && !checking && !lookup.error && !blocked;
  return <DetailModal title="Periksa dokumen unggahan" onClose={onClose} actions={<Button disabled={!confirmed || !valid} onClick={() => onConfirm({ ...value, targets: lookup.targets, action: attach ? 'ATTACH' : 'CREATE' })}>{t('Tandai sudah diperiksa')}</Button>}>
    <div className="space-y-4" data-batch-review>
      <p className="font-medium break-all">{value.originalName}</p><Button variant="secondary" onClick={() => setOriginal(true)}>{t('Lihat file asli')}</Button>
      <label className="block text-sm">{t('Jenis dokumen')}<select aria-label={t('Jenis dokumen')} className="input-field" value={value.documentType} onChange={event => change({ documentType: event.target.value })}>{Object.entries(types).filter(([key])=>!blOnly||['BILL_OF_LADING','UNKNOWN'].includes(key)).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}</select></label><Notice message={lookup.error||(wrongJourney?t('B/L sudah berada pada pengiriman lain. Buka pengiriman asalnya.'):'')} />
      {isBL ? <>
        <label className="block text-sm">{t('Nomor B/L')}<input aria-label={t('Nomor B/L')} className="input-field" value={value.fields.billNumber || ''} maxLength={100} onChange={event => field('billNumber', event.target.value)} /></label>
        <div className="rounded-xl border border-brand-500/25 bg-brand-500/5 p-4 space-y-2" role="status" data-batch-resolution>
          {checking ? <p>{t('Memeriksa nomor B/L…')}</p> : attach ? <><p className="font-semibold">{t('Pengiriman sudah tersedia')}</p><Link className="text-brand-500 break-all" target="_blank" rel="noreferrer" to={'/bl-register/' + resolution.bill.id}>{resolution.bill.billNumber} →</Link><p className="text-sm">{t('File akan ditambahkan ke pengiriman ini. Isian dan kontainer yang sudah tersimpan tetap dipertahankan.')}</p></> : resolution.kind === 'NEW' ? <p>{t(journey?'B/L baru akan ditambahkan ke pengiriman ini bersama file aslinya.':createJourneys?'B/L baru. Pengiriman tujuan ditentukan pada tahap pengelompokan.':'Nomor B/L baru. Setelah disimpan, sistem membuat satu pengiriman dengan file ini.')}</p> : <p className="text-amber-500">{t(resolution.kind === 'READ_ONLY' ? 'Pengiriman ini hanya baca. Pulihkan arsip atau periksa status pengiriman sebelum menambahkan dokumen.' : 'Nomor B/L merujuk ke beberapa pengiriman. Perbaiki nomor tujuan terlebih dahulu.')}</p>}
          {resolution.bill?.deleted&&<Link className="text-brand-500 underline text-sm" to="/bl-register/trash">{t('Pengiriman berada di Sampah. Buka Sampah untuk memulihkan.')}</Link>}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">{Object.entries(labels).map(([key, label]) => <label className="block text-sm" key={key}>{t(label)}<input aria-label={t(label)} className="input-field" readOnly={attach} type={key.endsWith('Date') ? 'date' : 'text'} value={key.endsWith('Date') ? value.fields[key]?.slice(0, 10) || '' : value.fields[key] || ''} maxLength={200} onChange={event => field(key, event.target.value)} /></label>)}</div>
        <label className="block text-sm">{t('Jenis B/L')}<select aria-label={t('Jenis B/L')} className="input-field" value={value.category} onChange={event => change({ category: event.target.value })}><option value="FINAL">B/L final</option><option value="DRAFT">B/L draft</option></select></label>
        <h3 className="font-semibold">{t('Kontainer hasil pembacaan')}</h3>
        {!attach && <Button variant="secondary" disabled={(value.fields.containers || []).length >= 100} onClick={() => field('containers', [...(value.fields.containers || []), { number: '', seal: '', size: '', goodsDescription: '' }])}>{t('Tambah kontainer')}</Button>}
        {(value.fields.containers || []).map((container, index) => <div key={index} className="grid sm:grid-cols-4 gap-2 rounded-lg border border-zinc-700 p-3">{[['number', 'Kontainer'], ['seal', 'Segel'], ['size', 'Ukuran'], ['goodsDescription', 'Uraian muatan']].map(([key, label]) => <label className="block text-xs" key={key}>{t(label)}<input className="input-field" readOnly={attach} aria-label={`${t(label)} ${index + 1}`} value={container[key] || ''} onChange={event => field('containers', value.fields.containers.map((item, n) => index === n ? { ...item, [key]: event.target.value } : item))} /></label>)}{!attach && <Button variant="secondary" onClick={() => field('containers', value.fields.containers.filter((_, n) => n !== index))}>{t('Hapus kontainer')}</Button>}<p className="text-xs text-zinc-500 sm:col-span-4">{t('Berat sumber (satuan belum dikonfirmasi)')}: {container.sourceWeight || '—'}</p></div>)}
      </> : <>
        <label className="block text-sm">{t('Nomor B/L tujuan (pisahkan dengan koma)')}<textarea className="input-field" aria-label={t('Nomor B/L tujuan (pisahkan dengan koma)')} value={value.references} onChange={event => change({ references: event.target.value })} /></label>
        {(value.fields.containers || []).length > 0 && <p className="text-sm text-zinc-500">{t('Kontainer pada lampiran tidak ditambahkan sebagai kontainer baru.')}</p>}
        {blocked && <p role="alert" className="text-sm text-amber-500">{t('Periksa nomor tujuan yang ambigu atau pengiriman yang hanya baca.')}</p>}
        <div className="grid sm:grid-cols-2 gap-3"><label className="block text-sm">{t('Nomor dokumen')}<input aria-label={t('Nomor dokumen')} className="input-field" value={value.documentNumber || ''} maxLength={100} onChange={event => change({ documentNumber: event.target.value })} /></label><label className="block text-sm">{t('Tanggal dokumen')}<input aria-label={t('Tanggal dokumen')} type="date" className="input-field" value={value.documentDate?.slice(0, 10) || ''} onChange={event => change({ documentDate: event.target.value })} /></label></div>
      </>}
      <details><summary className="cursor-pointer text-sm">{t('Catatan pembacaan sumber')}</summary>{value.warnings?.map(warning => <p className="text-xs text-zinc-500 mt-2" key={warning}>{warning}</p>)}</details>
      <label className="flex gap-2 text-sm"><input type="checkbox" disabled={!valid} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t(attach ? 'Saya telah memeriksa file asli dan menyetujui penambahan file ke pengiriman yang ditampilkan.' : 'Saya telah memeriksa jenis dokumen, isian, dan nomor B/L tujuan terhadap file asli.')}</label>
    </div>
    {original && <DetailModal title="Document preview" onClose={() => setOriginal(false)}><DocumentPreview endpoint={'/bl-imports/' + value.id + '/file'} name={value.originalName} mimeType={value.mimeType} /></DetailModal>}
  </DetailModal>;
}

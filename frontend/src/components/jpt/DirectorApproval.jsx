import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { Button, DataTable, DetailModal, Fields, ModalForm, ResourceState, StatusBadge, usePagedResource } from './Workspace';
import { formatDate, formatMoney } from '../../utils/format.mjs';
import { usePageQuery } from '../Layout/PageNavigation';

export const approvalChanged = submitted => window.dispatchEvent(new CustomEvent('scmu-approval-change', { detail: { submitted } }));
export async function requestDirector(action, entityId, payload = {}, note = '') {
  const response = await api.post('/approvals', { action, entityId, payload, note }); approvalChanged(true); return response.data;
}
export function ApprovalSubmit({ action, entityId, payload = {}, label = 'Submit for director approval', onChange, disabled, size = 'sm', variant = 'primary' }) {
  const { t } = useLanguage(); const [open, setOpen] = useState(false); const [note, setNote] = useState('');
  return <><Button type="button" size={size} variant={variant} disabled={disabled} onClick={() => { setNote(''); setOpen(true); }}>{t(label)}</Button>
    {open && <ModalForm title="Submit for director approval" onClose={() => setOpen(false)} onSubmit={async () => { await requestDirector(action, entityId, payload, note); onChange?.(); }} submitLabel="Submit request"><p className="text-sm text-zinc-400">{t('The director reviews the submitted data before this action takes effect.')}</p><Fields fields={[{ key: 'note', label: 'Request note', type: 'textarea', wide: true }]} values={{ note }} onChange={(_, value) => setNote(value)} /></ModalForm>}
  </>;
}
export function ApprovalToast() {
  const { t } = useLanguage(); const [visible, setVisible] = useState(false);
  useEffect(() => { const listener = event => { if (event.detail?.submitted) setVisible(true); }; window.addEventListener('scmu-approval-change', listener); return () => window.removeEventListener('scmu-approval-change', listener); }, []);
  return visible && <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-500/30 bg-brand-500/10 p-4 text-sm text-brand-200"><span>{t('Request submitted. The data remains pending until the director approves.')} <Link className="underline" to="/approvals">{t('View director approvals')}</Link></span><button type="button" aria-label={t('Close')} onClick={() => setVisible(false)}>×</button></div>;
}
export default function DirectorApprovals({ jobId, onChange }) {
  const { user, isSuperAdmin } = useAuth(); const { t, locale } = useLanguage(); const director = isSuperAdmin();
  const [query, setQuery] = usePageQuery(); const status = query.get('approvalStatus') === 'all' ? '' : query.get('approvalStatus') || (jobId || !director ? '' : 'SUBMITTED'); const search=query.get('search')||''; const setStatus = status => setQuery({ approvalStatus: status || 'all',approvalPage:null });
  const [selected, setSelected] = useState(null); const [dialog, setDialog] = useState(null); const [form, setForm] = useState({});
  const resource = usePagedResource('/approvals', {jobId,status,search}, 'approval');
  useEffect(() => { const listener = () => resource.reload(); window.addEventListener('scmu-approval-change', listener); return () => window.removeEventListener('scmu-approval-change', listener); }, [resource.reload]);
  const rows = resource.rows; const current = rows.find(row => row.id === selected);
  const open = (type, row) => { const now = new Date(); setSelected(row.id); setDialog({ type, row }); setForm({ decision: 'APPROVED', note: '', paidAt: new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16), notes: row.payload.notes || '' }); };
  const submit = async () => {
    if (dialog.type === 'review') await api.post(`/approvals/${dialog.row.id}/review`, { decision: form.decision, note: form.note });
    else if (dialog.type === 'withdraw') await api.post(`/approvals/${dialog.row.id}/withdraw`, { note: form.note });
    else await api.post(`/jobs/${dialog.row.jobId}/payments`, { ...dialog.row.payload, approvalId: dialog.row.id, paidAt: form.paidAt, notes: form.notes });
    setSelected(null); resource.reload(); onChange?.(); approvalChanged(false);
  };
  const value = (label, raw, row = current) => {
    if (raw === undefined || raw === null) return '—'; const currency = row?.snapshot.overview.find(field => field.label === 'Currency')?.value || 'IDR';
    if (['Amount','Estimated amount','Approved actual amount','Proposed actual amount','Sales total','Estimated total cost','Estimated gross profit','Freight','Tax','Total','Approved revenue','Approved cost','Billed gross profit','Receivable','Vendor payable','Internal costs outstanding','Declared amount'].includes(label)) return formatMoney(raw, currency, locale);
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(raw)) return formatDate(raw, locale, true);
    return t(String(raw));
  };
  return <div className="space-y-5"><div><h2 className="text-xl font-semibold text-zinc-100">{t('Director approvals')}</h2><p className="mt-1 text-sm text-zinc-400">{t('Admin submits. The director approves, returns for revision, or rejects. Approved payments still require recording the actual payment.')}</p></div>
    <div className="flex flex-wrap gap-3"><input className="input-field flex-1 min-w-64" type="search" aria-label={t('Search approvals')} placeholder={t('Cari pengiriman, bon, rekap, kontainer, atau nominal')} value={search} onChange={event=>setQuery({search:event.target.value,approvalPage:null})}/><select className="input-field max-w-xs" aria-label={t('Approval status')} value={status} onChange={event => { setStatus(event.target.value); setSelected(null); }}><option value="">{t('All Status')}</option>{['SUBMITTED','APPROVED','RETURNED','REJECTED','WITHDRAWN'].map(item => <option key={item} value={item}>{t(item)}</option>)}</select></div>
    <ResourceState resource={resource}><DataTable rows={rows} pagination={resource.pagination} columns={[
      { key: 'action', label: 'Approval type', render: row => t(row.action) }, { key: 'journey', label: 'Pengiriman', primary:true, render: row => row.journey || row.reference || '—' }, { key: 'reference', label: 'Bon / rekap', render: row => row.reference || '—' }, { key: 'container', label: 'Kontainer', render: row => row.container || '—' }, { key: 'amount', label: 'Nominal', align:'right', render: row => row.amount==null?'—':formatMoney(row.amount,'IDR',locale) },
      { key: 'requestedBy', label: 'Requested by', render: row => row.requestedBy?.name }, { key: 'createdAt', label: 'Submitted at', render: row => formatDate(row.createdAt, locale, true) }, { key: 'status', label: 'Status', render: row => <><StatusBadge status={row.status} />{row.executedAt && row.action === 'PAYMENT_AUTHORIZE' && <p className="text-xs text-emerald-300 mt-1">{t('Payment recorded')}</p>}</> },
      { key: 'actions', label: 'Actions', items:[{key:'view',label:'View',onClick:row=>setSelected(row.id)}] },
    ]} /></ResourceState>
    {current && !dialog && <DetailModal title="Approval details" onClose={() => setSelected(null)} actions={<>
      <Link className="self-center text-sm text-brand-300 underline mr-2" to={current.snapshot.targetUrl} onClick={() => setSelected(null)}>{t('Open source record')}</Link>
      {director && current.status === 'SUBMITTED' && current.requestedById !== user.id && <Button size="sm" onClick={() => open('review', current)}>{t('Review request')}</Button>}
      {(current.status === 'SUBMITTED' || (current.status === 'APPROVED' && current.action === 'PAYMENT_AUTHORIZE' && !current.executedAt)) && (director || current.requestedById === user.id) && <Button size="sm" variant="secondary" onClick={() => open('withdraw', current)}>{t('Withdraw request')}</Button>}
      {current.status === 'APPROVED' && current.action === 'PAYMENT_AUTHORIZE' && !current.executedAt && <Button size="sm" onClick={() => open('execute', current)}>{t('Record actual payment')}</Button>}
    </>}><section className="space-y-4" aria-label={t('Approval details')}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-zinc-100">{t(current.action)}</h3><StatusBadge status={current.status} /></div>
      <dl className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{current.snapshot.overview.map((field, index) => <div className="min-w-0" key={index}><dt className="text-xs text-zinc-500">{t(field.label === 'Approved actual amount' ? 'Proposed actual amount' : field.label)}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-200">{value(field.label, field.value)}</dd></div>)}</dl>
      {current.snapshot.tables.map((item, index) => <div className="space-y-2" key={index}><h4 className="font-medium text-zinc-300">{t(item.title)}</h4><DataTable rows={item.rows.map((row, i) => ({ ...row, id: row.id || i }))} columns={item.columns.map(column => ({ ...column, render: row => value(column.label, row[column.key]) }))} /></div>)}
      <div className="space-y-2 text-sm text-zinc-400"><p>{t('Requested by')}: {current.requestedBy?.name} · {formatDate(current.createdAt, locale, true)}</p>{current.requestNote && <p className="whitespace-pre-wrap">{t('Request note')}: {current.requestNote}</p>}{current.reviewedAt && <p>{t('Reviewed by')}: {current.reviewedBy?.name} · {formatDate(current.reviewedAt, locale, true)}</p>}{current.reviewNote && <p className="whitespace-pre-wrap">{t('Decision note')}: {current.reviewNote}</p>}{current.status === 'RETURNED' && <p>{t('Correct the source data, then submit a new request.')}</p>}</div>
      {director && current.status === 'SUBMITTED' && current.requestedById === user.id && <p className="text-sm text-brand-300">{t('Your own request requires another director. You can withdraw it and ask Admin to submit the checked data.')}</p>}
    </section></DetailModal>}
    {dialog && <ModalForm width="max-w-3xl" title={dialog.type === 'review' ? 'Review request' : dialog.type === 'withdraw' ? 'Withdraw request' : 'Record actual payment'} onClose={() => setDialog(null)} onSubmit={submit} submitLabel={dialog.type === 'review' ? 'Save decision' : 'Save'}>
      <p className="text-sm text-zinc-400">{t(dialog.row.action)}</p><Fields fields={dialog.type === 'execute' ? [{ key: 'paidAt', label: 'Paid Date', type: 'datetime-local', required: true }, { key: 'notes', label: 'Payment proof reference / notes', type: 'textarea', wide: true, required: true }] : [...(dialog.type === 'review' ? [{ key: 'decision', label: 'Decision', options: ['APPROVED','RETURNED','REJECTED'], required: true }] : []), { key: 'note', label: dialog.type === 'withdraw' ? 'Withdrawal note' : 'Decision note', type: 'textarea', required: dialog.type === 'withdraw' || form.decision !== 'APPROVED', wide: true }]} values={form} onChange={(key, input) => setForm(previous => ({ ...previous, [key]: input }))} />
    </ModalForm>}
  </div>;
}

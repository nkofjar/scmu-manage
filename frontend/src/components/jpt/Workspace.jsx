import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useLanguage } from '../../i18n/LanguageContext';
import { Button, Modal, Spinner, StatusBadge } from '../common';
import Pagination, { usePagination, usePageCorrection } from '../common/Pagination';
import { pageInfo } from '../common/paginationState.mjs';

export function useResource(url) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [loadedUrl, setLoadedUrl] = useState(null);
  const reload = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    if (!url) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    api.get(url, { signal: controller.signal }).then(response => { setData(response.data); setLoadedUrl(url); }).catch(error => {
      if (error.code !== 'ERR_CANCELED') setError(error.response?.data?.message || error.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, version]);
  return { data, loading, error, reload, update: setData, loadedUrl };
}
export function usePagedResource(path, filters = {}, scope = '') {
  const paging=usePagination(scope);const search=useDebouncedValue(filters.search);const pending=search!==filters.search;
  const query=new URLSearchParams(Object.entries({...filters,...(filters.search!==undefined?{search}:{}),...paging.params}).filter(([,value])=>value!==''&&value!==null&&value!==undefined));
  const url=path?`${path}?${query}`:null;const resource=useResource(url);const ready=resource.loadedUrl===url&&!!resource.data;const total=ready?resource.data.total:0;
  useEffect(()=>{if(ready&&!pending&&!resource.loading&&resource.data.page!==paging.page)paging.onPageChange(resource.data.page);},[ready,pending,resource.loading,resource.data?.page,paging.page,paging.onPageChange]);
  return {...resource,loading:pending||resource.loading||(!ready&&!resource.error&&!!path),rows:ready?resource.data.data:[],pagination:{...paging,total,page:ready?resource.data.page:paging.page,server:true,loading:pending||resource.loading||(!ready&&!resource.error&&!!path)}};
}
export function useDebouncedValue(value, delay=300) {
  const [settled,setSettled]=useState(value);
  useEffect(()=>{const timer=setTimeout(()=>setSettled(value),delay);return()=>clearTimeout(timer);},[value,delay]);
  return settled;
}
export function useAction(reload) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async action => {
    if (busy) return;
    setBusy(true); setError('');
    try { const value = await action(); reload?.(); return value; }
    catch (error) { setError(error.response?.data?.message || error.message); }
    finally { setBusy(false); }
  };
  return { run, busy, error };
}
export function Notice({ message }) {
  const { t } = useLanguage();
  return message ? <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{t(message)}</div> : null;
}
export function Field({ label, children, wide = false }) {
  const id = useId();
  const { t } = useLanguage();
  return <label htmlFor={id} className={`block space-y-1.5 ${wide ? 'sm:col-span-2' : ''}`}>
    <span className="text-sm font-medium text-zinc-300">{t(label)}</span>
    {typeof children === 'function' ? children(id) : children}
  </label>;
}
export function Fields({ fields, values, onChange }) {
  const { t } = useLanguage();
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{fields.map(field => <Field key={field.key} label={field.label} wide={field.wide}>
    {id => field.options ? <select id={id} className="input-field" value={values[field.key] ?? ''} required={field.required} onChange={event => onChange(field.key, event.target.value)}>
      {!field.required || field.placeholder ? <option value="">{t(field.placeholder || 'Select...')}</option> : null}
      {field.options.map(option => <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? t(option)}</option>)}
    </select> : field.type === 'textarea' ? <textarea id={id} className="input-field" rows={3} value={values[field.key] ?? ''} required={field.required} maxLength={field.maxLength || 3000} onChange={event => onChange(field.key, event.target.value)} />
      : <input id={id} className="input-field" type={field.type || 'text'} value={values[field.key] ?? ''} required={field.required} min={field.min} max={field.max} step={field.step} maxLength={field.maxLength || 300} onChange={event => onChange(field.key, event.target.value)} />}
  </Field>)}</div>;
}
export function ModalForm({ title, onClose, onSubmit, children, submitLabel = 'Save', width = 'max-w-3xl' }) {
  const { t } = useLanguage();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const formId = useId();
  const submit = async event => {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError('');
    try { await onSubmit(); onClose(); }
    catch (error) { setError(error.response?.data?.message || error.message); }
    finally { setSaving(false); }
  };
  return <Modal open onClose={() => { if (!saving) onClose(); }} title={t(title)} width={width} footer={
      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>{t('Cancel')}</Button>
        <Button type="submit" form={formId} disabled={saving}>{t(saving ? 'Saving...' : submitLabel)}</Button>
      </div>
    }>
    <form id={formId} onSubmit={submit} className="space-y-5"><Notice message={error} />{children}</form>
  </Modal>;
}
export function DetailModal({ title, onClose, children, actions, width = 'max-w-6xl' }) {
  const { t } = useLanguage();
  return <Modal open onClose={onClose} title={t(title)} width={width} footer={
    <div className="flex flex-wrap items-center gap-2">
      {actions}
      <Button type="button" variant="secondary" className="ml-auto" onClick={onClose}>{t('Close')}</Button>
    </div>
  }>{children}</Modal>;
}
export function DataTable({ paginationKey, ...props }) {
  return paginationKey ? <UrlDataTable {...props} paginationKey={paginationKey} /> : <TableBody {...props} />;
}
function UrlDataTable({paginationKey,rows,...props}) {
  const paging=usePagination(paginationKey);usePageCorrection(paging,rows.length);
  return <TableBody {...props} rows={rows} pagination={{...paging,total:rows.length}} />;
}
function TableBody({ columns, columnGroups, rows, empty = 'No records yet', pagination, resetKey, selection, layout='compact', mobileCards=false, stickyActions=false, emptyAction, actionPlacement='toolbar' }) {
  const { t } = useLanguage();
  const [page,setPage]=useState(1);const [limit,setLimit]=useState(10);
  useEffect(()=>setPage(1),[resetKey]);
  const paging=pagination||{page,limit,total:rows.length,onPageChange:setPage,onLimitChange:value=>{setLimit(value);setPage(1);}};
  const info=pageInfo(paging.total,paging.page,paging.limit);const visible=pagination===false||paging.server?rows:rows.slice((info.page-1)*paging.limit,info.page*paging.limit);
  useEffect(()=>{if(!pagination&&page!==info.page)setPage(info.page);},[pagination,page,info.page]);
  const [selectedKey,setSelectedKey]=useState(null);
  useEffect(()=>setSelectedKey(null),[info.page,paging.limit,resetKey]);
  useEffect(()=>{if(paging.loading)setSelectedKey(null);},[paging.loading]);
  const offset=pagination===false?0:(info.page-1)*paging.limit;
  const keyOf=(row,index)=>String(row.id??offset+index);
  const actionColumns=columns.filter(column=>column.key==='actions');
  const actions=actionPlacement==='row'?[]:actionColumns;
  const selectedKeys=selection?selection.keys.map(String):selectedKey===null?[]:[selectedKey];
  const picked=selectedKeys.length===1&&!paging.loading?visible.find((row,index)=>keyOf(row,index)===selectedKeys[0]):null;
  const pickedLabel=picked&&['billNumber','name','code','number','email'].map(key=>picked[key]).find(value=>typeof value==='string'&&value.length);
  const pick=(row,index,checked)=>selection?selection.onToggle(row,checked):setSelectedKey(checked?keyOf(row,index):null);
  const dataColumns=columns.filter(column=>actionPlacement==='row'||column.key!=='actions');
  const numbered=dataColumns.some(column=>column.key==='rowNumber'||['No.','No'].includes(column.label));
  const prefix=[...(actions.length?[{key:'__selection',label:'Pilih',className:'sticky left-0 z-10 bg-zinc-950 w-14',render:(row,index)=><input type="checkbox" aria-label={`${t('Pilih baris')} ${offset+index+1}`} checked={selectedKeys.includes(keyOf(row,index))} disabled={paging.loading||Boolean(selection?.max&&!selectedKeys.includes(keyOf(row,index))&&selectedKeys.length>=selection.max)} onChange={event=>pick(row,index,event.target.checked)}/>}]:[]),...(!numbered?[{key:'__rowNumber',label:'No.',className:'w-14 tabular-nums',render:(_row,index)=>offset+index+1}]:[])];
  const tableColumns=[...prefix,...dataColumns];
  const renderActions=(column,row)=>column.items?<div className="flex flex-wrap items-center gap-2">{column.items.map(item=>{
    if(row&&item.hidden?.(row))return null;
    const disabled=!row||paging.loading||Boolean(item.disabled?.(row));const label=t(typeof item.label==='function'?item.label(row):item.label);
    return item.href&&!disabled?<Link key={item.key||label} className="btn btn-secondary inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200" to={item.href(row)}>{label}</Link>:<Button key={item.key||label} type="button" size="sm" variant={item.variant||'secondary'} disabled={disabled} onClick={()=>row&&item.onClick?.(row)}>{label}</Button>;
  })}</div>:row?column.render(row):null;
  const groups=(columnGroups||[]).map(group=>({...group,colSpan:dataColumns.filter(column=>group.keys.includes(column.key)).length})).filter(group=>group.colSpan);
  if(groups.length&&prefix.length)groups.unshift({label:'',colSpan:prefix.length});
  return <div className="space-y-3" data-workspace-table data-table-layout={layout} data-mobile-cards={mobileCards||undefined}>
    {actions.length>0&&<div className={`card p-3 flex flex-wrap items-center gap-3 ${stickyActions?'table-toolbar-sticky':''}`} role="toolbar" aria-label={t('Tindakan tabel')} data-table-toolbar>
      <span className="text-sm text-zinc-500 mr-auto min-w-0 break-words">{picked?t('Satu baris dipilih'):selectedKeys.length>1?`${selectedKeys.length} ${t('baris dipilih; pilih satu untuk tindakan per data.')}`:t('Pilih satu baris untuk menampilkan tindakan.')}{pickedLabel&&<strong className="ml-2 font-medium text-zinc-300">{pickedLabel}</strong>}</span>
      {selectedKeys.length>0&&<Button type="button" variant="ghost" size="sm" onClick={()=>selection?selection.onClear():setSelectedKey(null)}>{t('Batalkan pilihan')}</Button>}
      {actions.map(column=><div key={column.key} data-selected-row-actions={picked?true:undefined}>{renderActions(column,picked)}</div>)}
    </div>}
    <div className="card overflow-hidden"><div className="overflow-x-auto table-scroll"><table className={`w-full text-sm ${layout==='wide'?'min-w-max':'workspace-compact-table'}`} style={layout==='compact'?{minWidth:Math.max(540,dataColumns.length*100+prefix.length*44)}:undefined} aria-busy={paging.loading}><colgroup>{tableColumns.map(column=><col key={column.key} style={{width:column.width||(['__selection','selected','select'].includes(column.key)?56:['__rowNumber','rowNumber'].includes(column.key)?44:undefined)}}/>)}</colgroup><thead>{groups.length>0&&<tr className="border-b border-zinc-800/70 bg-zinc-950/60">
    {groups.map(group=><th key={group.label} colSpan={group.colSpan} className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-widest text-brand-300/80">{t(group.label)}</th>)}
  </tr>}<tr className="border-b border-zinc-800">
    {tableColumns.map(column => <th key={column.key} scope="col" className={`px-4 py-3 whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-zinc-500 ${column.align === 'right' ? 'text-right' : 'text-left'} ${column.className || ''}`}>{t(column.label)}</th>)}
  </tr></thead><tbody className="divide-y divide-zinc-800/60">{paging.loading?<tr><td colSpan={tableColumns.length}><Spinner /></td></tr>:visible.length ? visible.map((row,index) => <tr key={keyOf(row,index)} data-row-number={offset+index+1} aria-selected={actions.length?selectedKeys.includes(keyOf(row,index)):undefined} className="hover:bg-zinc-900/40">{tableColumns.map(column => <td key={column.key} data-column={column.key} data-label={t(column.label)} data-primary={column.primary||undefined} className={`px-4 py-3 text-zinc-300 align-top ${column.align === 'right' ? 'text-right' : ''} ${column.className || ''}`}>{column.key==='actions'?renderActions(column,row):column.render ? column.render(row,index) : row[column.key] ?? '—'}</td>)}</tr>) : <tr><td colSpan={tableColumns.length} className="px-4 py-10 text-center text-zinc-500"><p>{t(empty)}</p>{emptyAction&&<div className="mt-3">{emptyAction}</div>}</td></tr>}</tbody></table></div>{pagination!==false&&<Pagination {...paging} page={info.page} />}</div></div>;
}
export function Tabs({ items, value, onChange }) {
  const { t } = useLanguage();
  return <div className="flex flex-wrap gap-2 border-b border-zinc-800 pb-3" role="tablist">{items.map(item => <button type="button" key={item.value} role="tab" aria-selected={value === item.value} onClick={() => onChange(item.value)} className={`rounded-lg px-4 py-2 text-sm ${value === item.value ? 'bg-brand-500/15 text-brand-300' : 'text-zinc-400 hover:bg-zinc-800'}`}>{t(item.label)}</button>)}</div>;
}
export function ResourceState({ resource, children }) {
  if (resource.loading && !resource.data) return <Spinner />;
  return <><Notice message={resource.error} />{resource.data && children}</>;
}
export const JobLink = ({ job }) => <Link className="text-brand-400 hover:underline font-mono text-xs" to={`/jobs/${job.id}`}>{job.jobNumber}</Link>;
export { Button, StatusBadge };
export const CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'INR'];
export const customerOptions = rows => rows.filter(row => row.isInternal).map(row => ({ value: row.id, label: row.name }));
export const vendorOptions = rows => rows.filter(row => ['TRANSPORTER', 'BROKER', 'BOTH'].includes(row.type)).map(row => ({ value: row.id, label: row.name }));
export const cargoFields = customers => [
  { key: 'title', label: 'Title', required: true },
  { key: 'originCity', label: 'Origin City', required: true }, { key: 'destCity', label: 'Destination City', required: true },
  { key: 'serviceType', label: 'Service', options: ['DOMESTIC', 'EXPORT', 'IMPORT'], required: true },
  { key: 'currency', label: 'Currency', options: CURRENCIES, required: true },
  { key: 'cargoDescription', label: 'Cargo description', type: 'textarea', required: true, wide: true },
  { key: 'packages', label: 'Packages', type: 'number', min: 1, step: 1, required: true },
  { key: 'weightKg', label: 'Weight (kg)', type: 'number', min: 0, step: 0.001 },
  { key: 'volumeCbm', label: 'Volume (CBM)', type: 'number', min: 0, step: 0.0001 },
  { key: 'plannedPickup', label: 'Planned pickup', type: 'datetime-local' }, { key: 'expectedDelivery', label: 'Expected Delivery', type: 'datetime-local' },
];
export const emptyCargo = { title: '', originCity: '', destCity: '', serviceType: 'DOMESTIC', cargoDescription: '', packages: 1, weightKg: 0, volumeCbm: 0, currency: 'IDR', plannedPickup: '', expectedDelivery: '' };
export const jobTypeField = t => ({ key: 'jobType', label: 'Job type', required: true, options: [{ value: 'SENDER', label: t('SCMU as sender') }, { value: 'RECEIVER', label: t('SCMU as receiver') }] });

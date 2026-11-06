import {useState} from 'react';
import api from '../../api/client';
import {Button} from '../../components/common';
import {DetailModal,Notice,useResource} from '../../components/jpt/Workspace';
import DocumentPreview from '../../components/jpt/DocumentPreview';
import {useBL} from '../../i18n/bl.mjs';
import {normalizeBillFiles} from './billScope.mjs';

export default function BillFileReferences({bill,categories,title}){
 const {t}=useBL(),resource=useResource(`/bl-register/${bill.id}/files`),[preview,setPreview]=useState(null),[error,setError]=useState('');
 const rows=normalizeBillFiles(resource.data,bill.files||[]).filter(row=>!categories||categories.includes(row.category));
 const endpoint=row=>`/bl-register/${bill.id}/files/${row.id}`;
 const download=async row=>{try{setError('');const response=await api.get(endpoint(row),{responseType:'blob'}),url=URL.createObjectURL(response.data),a=document.createElement('a');a.href=url;a.download=row.originalName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(e.response?.data?.message||e.message);}};
 return <div className="space-y-3" data-bill-file-references><h3 className="font-semibold text-sm">{t(title)}</h3><Notice message={error||resource.error}/>{resource.error&&<Button variant="secondary" onClick={resource.reload}>{t('Muat ulang data')}</Button>}{rows.map(row=><article key={row.id} className="border rounded-lg p-3 space-y-2"><p className="text-sm break-all">{row.originalName}</p>{row.scope?.billNumbers?.length>1&&<p className="text-xs">{t('Dokumen bersama')} · {row.scope.billNumbers.join(', ')}</p>}<div className="flex flex-wrap gap-2"><Button variant="secondary" aria-label={t('Lihat')+' '+row.originalName} onClick={()=>setPreview(row)}>{t('Lihat')}</Button><Button variant="secondary" onClick={()=>download(row)}>{t('Unduh asli')}</Button></div></article>)}{!rows.length&&!resource.loading&&<p className="text-sm text-zinc-500">{t('Belum ada dokumen pada B/L ini.')}</p>}{preview&&<DetailModal title="Document preview" onClose={()=>setPreview(null)}><DocumentPreview endpoint={endpoint(preview)} name={preview.originalName} mimeType={preview.mimeType}/></DetailModal>}</div>;
}

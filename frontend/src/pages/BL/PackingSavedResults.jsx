import {useState} from 'react';
import {Button} from '../../components/common';
import {useBL} from '../../i18n/bl.mjs';
import {isSharedDocument} from './billScope.mjs';

export default function PackingSavedResults({rows,busy,readonly,onView,onDownload,onPrint,onDelete}) {
 const {t}=useBL();const [historyOpen,setHistoryOpen]=useState(false);
 const local=rows.filter(row=>!isSharedDocument(row)),shared=rows.filter(isSharedDocument);
 const card=(row,latest=false)=><div key={row.id} data-shared-output={isSharedDocument(row)?row.id:undefined} className="border-t border-zinc-200/20 pt-3 text-sm space-y-2">
  <p className="break-words"><strong>{row.originalName}</strong>{latest&&<span className="ml-2 text-xs text-zinc-500">{t('Hasil terbaru')}</span>}</p>
  <p className="text-xs text-zinc-500">{t(({INTERNAL_PACKING_LIST:'Packing List internal',INTERNAL_PACKING_RECAP:'Rekap Packing List internal',PACKING_HEADER:'Kepala Packing List'})[row.category]||row.category)} · {row.createdAt?.slice(0,10)||'—'}{row.note&&` · ${row.note}`}</p>
  {isSharedDocument(row)&&<p className="text-xs text-amber-600">{t('Dokumen bersama')} · {(row.scope?.billNumbers?.length?row.scope.billNumbers:row.scope?.billIds||[]).join(', ')}</p>}
  <div className="flex flex-wrap gap-2">
   <Button size="sm" variant="secondary" aria-label={`${t('Lihat')} ${row.originalName}`} disabled={busy} onClick={()=>onView(row)}>{t('Lihat')}</Button>
   <Button size="sm" variant="secondary" disabled={busy} onClick={()=>onDownload(row)}>{t('Unduh asli')}</Button>
   {row.category==='INTERNAL_PACKING_LIST'&&<Button size="sm" variant="secondary" disabled={busy} onClick={()=>onPrint(row)}>{t('Cetak / Simpan PDF')}</Button>}
   <Button size="sm" variant="danger" disabled={busy||readonly} onClick={()=>onDelete(row)}>{t('Hapus lampiran')}</Button>
  </div>
 </div>;
 return <div className="space-y-3" data-packing-saved-results>
  {!local.length&&<p className="text-sm text-zinc-500">{t('Belum ada hasil Packing List tersimpan.')}</p>}
  {local.length>1&&<Button variant="secondary" size="sm" aria-expanded={historyOpen} onClick={()=>setHistoryOpen(value=>!value)}>{t('Riwayat revisi')}</Button>}
  {(historyOpen?local:local.slice(0,1)).map((row,index)=>card(row,index===0))}
  {shared.length>0&&<details className="text-sm"><summary className="cursor-pointer text-zinc-500">{t('Referensi hasil bersama')}</summary><div className="space-y-3 mt-2">{shared.map(row=>card(row))}</div></details>}
 </div>;
}

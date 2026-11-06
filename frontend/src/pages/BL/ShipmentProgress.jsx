import { useBL } from '../../i18n/bl.mjs';

export default function ShipmentProgress({ bill }) {
  const { t } = useBL(); const flow = bill.workflow;
  if (!flow) return null;
  const states = [
    ['Dokumen utama', flow.documents === 'COMPLETE' ? 'Lengkap sesuai kebutuhan' : 'Belum lengkap'],
    ['Rincian Packing List', flow.sourcePrepared ? 'Sudah diperiksa admin' : 'Perlu disiapkan'],
    ['Pekerjaan lapangan', ({ NOT_STARTED: 'Belum dimulai', IN_PROGRESS: 'Berjalan', COMPLETED: 'Selesai' })[flow.field] || 'Belum dimulai'],
  ];
  return <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500" role="status" data-shipment-progress>{states.map(([label, value]) => <span key={label}>{t(label)}: <strong className="font-medium text-zinc-300">{t(value)}</strong></span>)}</p>;
}

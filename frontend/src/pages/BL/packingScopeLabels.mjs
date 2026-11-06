import {useBL} from '../../i18n/bl.mjs';
const english={
 'Kelola PL B/L ini':'Manage this B/L packing list',
 'Sumber bersama — bukan seluruh muatan B/L ini':'Shared source — not all cargo belongs to this B/L',
 'Rincian PL untuk B/L ini belum dipetakan':'Packing details for this B/L have not been mapped',
 'Cakupan sumber belum diketahui':'Source scope is unknown',
 'Hanya rincian yang diperiksa untuk B/L ini boleh dicatat. File asli bukan alokasi otomatis.':'Record only details reviewed for this B/L. The original file is not an automatic allocation.',
 'File bersama tetap dapat dilihat. Salin hanya bagian B/L ini pada Periksa data; impor seluruh file dinonaktifkan.':'You can still view the shared file. Transcribe only this B/L’s portion in Review data; whole-file import is disabled.',
 'Ringkasan sumber B/L ini':'This B/L source summary',
 'Referensi file asli — bukan ringkasan muatan B/L ini':'Original-file reference — not this B/L’s cargo summary',
 'Ringkasan seluruh sumber tidak ditampilkan atau diekspor sebagai ringkasan B/L ini. Catat bagian milik B/L ini melalui Kelola PL B/L ini.':'The whole-source summary is not displayed or exported as this B/L’s summary. Record this B/L’s portion using Manage this B/L packing list.',
 'Lihat file asli bersama':'View shared original',
 'Saya memastikan hanya rincian milik B/L ini yang dicatat, bukan seluruh PL bersama.':'I confirm that only this B/L’s details are recorded, not the entire shared packing list.',
 'Konfirmasikan rincian milik B/L ini terlebih dahulu.':'Confirm this B/L’s details first.',
 'Kontainer sumber bersama harus termasuk dalam B/L ini.':'Shared-source containers must belong to this B/L.',
 'Rincian B/L ini telah dipilih dan dikonfirmasi':'This B/L’s details have been selected and confirmed',
 'Sumber dan isi PL hanya untuk B/L ini; rekap kapal dikelola pada pengiriman kapal.':'Packing sources and contents are for this B/L only; manage voyage recaps in the sea shipment.',
 'Simpan hanya rincian milik B/L ini. PL dapat dicetak tanpa menunggu dokumen B/L final.':'Save only this B/L’s details. The packing list can be printed before the final B/L document is available.'
};
export function usePackingBL(){const context=useBL();return {...context,t:key=>context.language==='en'?(english[key]??context.t(key)):context.t(key)};}

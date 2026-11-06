# Lingkup pengiriman kapal dan detail B/L

## Dua tingkat ruang kerja

- `/shipments/:id`: gambaran seluruh kapal/voyage/periode/tujuan, daftar B/L, dokumen bersama, rekap Packing List gabungan, pekerjaan lapangan dan biaya keseluruhan.
- `/bl-register/:id`: ruang kerja satu B/L. Ringkasan, dokumen, Packing List, bonrate sopir, biaya, dan riwayat tidak boleh mengambil milik B/L lain hanya karena berada dalam kapal yang sama.

Detail B/L menampilkan penanda konteks dan tautan eksplisit untuk kembali ke pengiriman kapal. Pengguna tidak berpindah ke lingkup gabungan secara diam-diam.

## Dokumen dan Packing List

Berkas sumber boleh ditautkan ke beberapa B/L tanpa diunggah ulang. Dokumen seperti itu harus diberi label **Dokumen bersama**. Ketersediaan file sumber tidak berarti seluruh isi file merupakan muatan satu B/L; rincian harus dipetakan dan diperiksa untuk B/L yang sedang dibuka.

Rekap kapal (`Rekap Packing List kapal; …`) adalah hasil gabungan. Di detail B/L, rekap tersebut hanya menjadi referensi baca saja menuju ruang kerja kapal, bukan pilihan PL internal B/L. Rekap kapal tidak membuktikan PL internal atau rincian PL B/L sudah disiapkan. Pencetakan rekap gabungan dilakukan pada lingkup kapal. Cetak tersimpan tersedia untuk PL internal dan rekap voyage yang memiliki API snapshot yang sesuai. Rekap B/L atau rekap bersama non-voyage tetap dapat dipratinjau dan diunduh sebagai berkas asli; tombol cetaknya dinonaktifkan karena API snapshot tersebut tidak mendukungnya.

Unggah dari detail B/L tetap memakai endpoint B/L terpilih. Pembuatan PL internal dan pemeriksaan rincian harus memakai sumber dan kontainer yang terkait dengan B/L tersebut.

## Tampilan pengiriman yang disederhanakan

- Tabel B/L memiliki **Total PL mitra**, yaitu jumlah file sumber berkategori `PACKING_LIST` yang terkait dengan B/L, bukan jumlah barang atau hasil rekap. Klik jumlah untuk membuka Packing List B/L tersebut. Sumber bersama tetap diberi label dan dihitung sekali per B/L terkait.
- **Hapus file B/L** membuka pilihan lampiran B/L saja dengan alasan dan konfirmasi. Endpoint pelepasan lampiran memeriksa versi terkini; konflik mewajibkan muat ulang dan pemilihan ulang. Record B/L, kontainer, PL, serta bonrate tidak dihapus.
- Tab Packing List & Rekap langsung menampilkan sumber per B/L, pratinjau, status rincian, dan pengelolaan PL. Tabel berkas hasil rekap tidak ditampilkan di sini; berkas tersimpan dan unggah sumber bersama tetap tersedia lewat tombol sekunder **Arsip rekap & unggah PL bersama**.
- Tombol **Rekap dari B/L** tetap di Ringkasan & B/L di samping Unggah B/L. Rekap rincian PL tetap pada tab Packing List.
- Bonrate Sopir bukan tab utama pengiriman lagi. Pekerjaan khusus B/L dikelola dari detail B/L; operasional gabungan (jatah bersama, upah dan pembayaran) tersedia sebagai akses lanjutan berlabel lintas B/L.

## Operasional, biaya, riwayat

Pekerjaan lintas B/L tetap dikelola pada pengiriman induk. Pada detail B/L, hanya pekerjaan/alokasi yang secara eksplisit terkait dengan B/L terpilih boleh ditampilkan. Nominal gabungan tidak boleh ditafsirkan sebagai nominal satu B/L. Biaya bersama yang belum dialokasikan tidak boleh otomatis dibagi atau dimasukkan sebagai biaya B/L.

Riwayat pada detail B/L mengacu pada perubahan B/L itu sendiri, bukan semua perubahan job atau kapal.

## Pengujian

```bash
cd frontend
npm run test:scope
npm test
npm run build
```

Jalankan `npm ci` terlebih dahulu pada checkout baru. `test:scope` mencakup tes helper, rendering, dan interaksi React memakai `react-test-renderer` sebagai devDependency; tidak membutuhkan paket di direktori scratch.

Regresi mencakup penanda konteks, dokumen sendiri dan bersama, referensi rekap kapal, status PL, bahasa Inggris, konfirmasi lingkup PL bersama, serta respons dokumen parsial. Metadata lingkup yang tidak dikirim ulang dipertahankan untuk ID yang masih tersedia; respons daftar kosong tetap otoritatif dan tidak memulihkan lampiran yang sudah dihapus. Tabel dokumen dan indikator ketersediaan memakai koleksi file ternormalisasi yang sama. Tes backend melengkapi pembatasan data dan tindakan. Jangan menjalankan migrasi atau seed pada database production untuk perubahan ini.

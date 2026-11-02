# Bonrate, jatah kontainer, dan upah sopir

Bonrate mencatat **satu pekerjaan angkut/rit**, didukung Bukti Serah Terima Barang (BST). RB/RK adalah jenis angkutan, bukan status pembayaran. Beberapa penerima, rincian barang, atau halaman bukti dalam satu rit tetap masuk **satu bon**.

## Pengaturan direktur

Di **Tarif & Biaya**, direktur mengelola Master Tarif dan Skema Angkutan. Skema awal: 20 feet / 3 RB, 20 feet / 2 RB + 2 RK, dan 40 feet / 6 RB. Admin memilih satu skema per kontainer melalui **Pengiriman > Bonrate Sopir > Jatah kontainer**. Ukuran 21 memerlukan skema tersendiri yang dikonfirmasi direktur; tidak disamakan dengan ukuran 20.

Skema disalin sebagai batas tersimpan. Perubahan master tidak mengubah batas yang sudah dipilih. Setelah pengajuan pertama, skema kontainer terkunci, termasuk jika pekerjaan kemudian dibatalkan. Perubahan batas memerlukan alasan, bukti instruksi, dan persetujuan direktur di **Persetujuan Direktur**. Pengaju tidak dapat menyetujui pengajuannya sendiri. Batas baru tidak boleh kurang dari rit terpakai. RK tidak dikonversi otomatis menjadi RB.

Tarif upah diisi direktur sebagai **Tarif sopir RB/RK > Per rit**, menurut jenis RB/RK, ukuran, rute pengambilan/pengantaran sopir, kendaraan, dan tanggal berlaku. Rute sopir tidak otomatis sama dengan rute pelayaran B/L. Akhir periode inklusif; tarif paling spesifik digunakan. Cakupan sama yang tumpang tindih atau pemilihan ambigu ditolak. Aplikasi tidak menetapkan nominal gaji dan tidak menambah pajak sopir otomatis.

## Pencatatan Admin

1. Buka **Pengiriman > Bonrate Sopir > Pekerjaan angkut > Tambah bonrate**. Nomor bon otomatis dan tetap saat diedit.
2. Pilih kontainer B/L. Kapal/voyage mengikuti pengiriman, ukuran mengikuti kontainer, dan pilihan B/L hanya memuat sumber untuk kontainer tersebut. Rujukan beberapa B/L ke kontainer yang sama memakai satu jatah dalam pengiriman induk.
3. Isi sopir, plat, RB/RK, rute, tanggal diterima, nomor BST, serta merek/pemilik, banyak colly, jenis colly, dan jenis barang. Tambahkan baris penerima/barang lain dalam rit yang sama.
4. Unggah bukti langsung atau pilih dokumen tersimpan. Semua format dapat dilampirkan, maksimum 5 MB per file. Unggahan juga muncul pada Dokumen pengiriman. Unggahan belum berarti terverifikasi.
5. **Simpan** sebagai draf jika belum lengkap. Draf belum memakai jatah. **Ajukan** setelah lengkap: satu RB atau RK dicadangkan dari jatah bersama seluruh sopir/B/L. Jika habis, pengajuan ditolak tanpa menambah hitungan.
6. **Verifikasi** setelah Admin memeriksa bukti bertanda terima dan realisasi. Verifikasi tidak menghitung rit dua kali. Penolakan/pembatalan mengembalikan jatah dan wajib beralasan. Pekerjaan terverifikasi tidak dapat diedit; jika belum direkap, batalkan beralasan lalu buat koreksi.

Nomor BST yang sudah dipakai pekerjaan aktif lain dalam pengiriman yang sama ditolak. Beberapa penerima/foto dari satu pekerjaan ditambahkan ke bon yang sama. Banyak colly atau berkas tidak menentukan jumlah rit. Admin tetap memeriksa bukti; mengganti nama/nomor dokumen tidak membuktikan pekerjaan berbeda.

## Rekap dan pembayaran upah

1. Buka **Rekap upah > Buat rekap upah**, pilih satu sopir, periode, dan pekerjaan terverifikasi yang belum direkap. Rekap dibuat per pengiriman; perjalanan lain mempunyai sumber dan jatah masing-masing.
2. **Pratinjau upah** menggunakan tarif per rit berdasarkan **tanggal diterima**, ukuran, rute, dan kendaraan pekerjaan. Tarif paket kontainer tidak dipakai untuk rekap rit agar tidak dibebankan berulang.
3. Periksa dan konfirmasikan rincian. Server menghitung ulang saat menyimpan; harga berubah setelah pratinjau memerlukan pratinjau ulang. Snapshot kode/versi tarif, harga, pekerjaan, dan total disimpan tetap.
4. **Ajukan rekap upah** membuat satu usulan biaya internal bersama pengiriman untuk direktur. Pekerjaan langsung dikunci ke rekap itu dan tidak dapat direkap lagi/dibatalkan. Pengajuan tidak membuat pembayaran.
5. Direktur menyetujui biaya di **Persetujuan Direktur**. Rekap ditolak dapat dibatalkan beralasan agar pekerjaan dapat direkap ulang. Rekap disetujui/dibayar tetap terkunci.
6. **Ajukan pembayaran**: jumlah (boleh sebagian), referensi, metode, tanggal, catatan, serta bukti. Direktur mengotorisasi di menu persetujuan. Setelah disetujui, Admin menekan **Catat pembayaran**. Satu otorisasi hanya dapat dicatat sekali; pembayaran tidak melebihi sisa biaya disetujui.
7. Status mengikuti transaksi nyata: menunggu persetujuan, disetujui/belum dibayar, dibayar sebagian, atau lunas. Catatan RB/RK tidak mencairkan uang.

## Riwayat dan validasi

Bon lama pengiriman/B/L tetap tersimpan dan ditampilkan hanya baca. Jalur simpan/biaya bon lama pada pengiriman induk ditutup agar tidak melewati jatah baru. Jika ada bon lama aktif, direktur merekonsiliasinya beralasan sebelum jatah baru dipakai. Sistem tidak otomatis mengubahnya menjadi rit/pembayaran baru.

Lampiran yang dirujuk pekerjaan (termasuk dibatalkan), perubahan jatah, atau pembayaran tidak dapat dihapus. Identitas/ukuran/segel kontainer terpakai tidak dapat diganti diam-diam. Pengiriman/B/L dengan pekerjaan diproses atau rekap upah tidak dapat dipindahkan ke Sampah; gunakan arsip.

Penyimpanan mengikuti JSON pengiriman yang ada. Seluruh mutasi memakai transaksi PostgreSQL Serializable, versi pengiriman, dan audit; pengajuan bersamaan tidak dapat memakai jatah terakhir dua kali. Tidak ada migrasi tambahan dan seed tidak dijalankan. Migrasi master tarif sebelumnya tetap digunakan.

## Menjalankan dan menguji

Demo: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-demo.ps1 -PostgresBin 'C:\Program Files\PostgreSQL\14\bin' -SkipSeed`, lalu buka http://localhost:5173.

- `cd backend; npm.cmd test`: validasi domain, termasuk driverOperations dan mesin tarif.
- `cd frontend; npm.cmd test`: terjemahan, pagination, formulir, navigasi, dan tabel.
- `$env:SCMU_QA_BROWSER='1'; node scripts/test-driver-operations.mjs`: API dan Chrome desktop/ponsel dengan data sintetis yang dibersihkan otomatis. Mencakup jatah 20/40 feet, kontainer lintas B/L, reservasi bersamaan, BST duplikat, pembatalan/penolakan, pengecualian direktur, snapshot upah, penguncian rekap, dan biaya/pembayaran nyata.
- `test-driver-tariffs.mjs` mengarahkan ke pengujian alur baru agar perintah lama tetap dapat digunakan. Unit test driverTariffs tetap menguji mesin tarif.

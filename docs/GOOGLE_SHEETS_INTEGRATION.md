# PANDUAN INTEGRASI GERBANG GOOGLE SHEETS & APPS SCRIPT
**Proyek:** RyokoRent Android APK — Rental Sepeda Motor Malang & Batu  
**Arsitektur:** Multi-Device Sync (Google Sheets sebagai Single Source of Truth via Gerbang Apps Script)  
**Rujukan:** `docs/SYNC_ARCHITECTURE.md`, `backend/Code.gs`, `TASK-030`  

---

## 1. STRUKTUR SKEMA 9 TABEL SPREADSHEET

Sistem menggunakan 1 file Spreadsheet Google Sheets bernama `RyokoRent_Data_Operasional` yang dikelola secara terpusat oleh gerbang Apps Script (`backend/Code.gs`). Spreadsheet terdiri dari 9 sheet terpisah:

### A. Sheet `Booking` (28 Kolom)
Menyimpan transaksi pemesanan sewa 13 field standar, detail durasi, unit, keuangan, kurir, dan kontrol versi data:
```text
1. noBooking             : ID unik booking terpusat dari server (mis. RYO-20261027-0001)
2. waktuPemesanan        : Timestamp ISO pemesanan dibuat
3. statusSewa            : ryokou_menunggu_verifikasi | ryokou_disewa | ryokou_selesai | ryokou_dibatalkan
4. namaPenyewa           : Nama lengkap penyewa sesuai KTP
5. nomorWa               : Nomor WhatsApp ternormalisasi format 62
6. noDarurat             : Kontak darurat / keluarga
7. alamatKtp             : Alamat domisili legal KTP (disaring untuk operator/publik)
8. jenisIdPendukung      : SIM C / NPWP / Kartu Pegawai / KTM
9. alamatSaatIni         : Lokasi inap (Hotel / Kos / Villa) di Malang/Batu
10. idSosmed             : Akun Instagram / media sosial
11. modelMotor           : Master model motor yang dipilih
12. kodeUnitFisik        : ID fisik unit armada (mis. U01, U02)
13. jumlahHelm           : Jumlah helm SNI (1 atau 2)
14. durasiSewa           : Paket sewa (1_hari, 2_minggu, 1_bulan, dsb.)
15. jadwalMulai          : Timestamp ISO waktu mulai sewa (WIB)
16. jadwalSelesai        : Timestamp ISO batas pengembalian sewa (WIB)
17. lokasiAntar          : Titik antar unit ke tamu (Pool / Stasiun / Hotel)
18. lokasiJemput         : Titik pengambilan kembali unit
19. kurirPengantar       : Nama kurir yang ditugaskan (jika ada)
20. totalEstimasiBiaya   : Total tarif sewa (HANYA terlihat oleh Admin; disembunyikan untuk Operator)
21. dendaKeterlambatan   : Akumulasi denda keterlambatan (HANYA terlihat oleh Admin)
22. catatanKhusus        : Catatan permintaan tamu / inspeksi fisik
23. statusReviewAdmin    : PENDING_REVIEW | APPROVED | REJECTED | NEED_DOCS
24. opsiTindakLanjut     : Siapkan Unit | Tugaskan Kurir | Kirim Tagihan DP | Jadwal Servis | Selesai & Arsip
25. aksiTerakhirDisetujui: Catatan aksi setelah review
26. createdAt            : Waktu pembuatan baris di server
27. updatedAt            : Waktu pembaruan terakhir di server
28. serverVersion        : Nomor versi inkremental baris
```

### B. Sheet `Unit` (11 Kolom)
Master data unit fisik sepeda motor:
```text
1. id             : ID unit (mis. U01)
2. kodeUnit       : Kode unit unik fisik
3. modelId        : ID model motor (mis. m_beat, m_vario)
4. namaModel      : Nama model lengkap (mis. Honda Beat ESP 110)
5. platNomor      : Plat nomor kendaraan (mis. N 2341 AA)
6. status         : ryokou_tersedia | ryokou_disewa | ryokou_diservis
7. tahun          : Tahun perakitan motor
8. warna          : Warna unit
9. lokasiTerakhir : Lokasi armada terkini (Pool Dinoyo, Pool Batu, dsb.)
10. updatedAt     : Timestamp update terakhir
11. serverVersion : Nomor versi server
```

### C. Sheet `Tracking` (9 Kolom)
Riwayat posisi pelacakan armada (Pool Malang, Pool Batu, Dipakai Kurir):
```text
1. id        : ID riwayat tracking (TRK-YYYYMMDD-HHmmss)
2. unitId    : ID unit terkait
3. kodeUnit  : Kode unit fisik
4. lokasi    : Nama titik lokasi (Pool Dinoyo / Pool Batu / Titik Kurir)
5. latitude  : Koordinat latitude
6. longitude : Koordinat longitude
7. namaKurir : Nama personil kurir pelapor
8. catatan   : Keterangan operasional tambahan
9. waktu     : Timestamp ISO pencatatan
```

### D. Sheet `Servis` (11 Kolom)
Catatan pemeliharaan dan servis berkala 7 kategori:
```text
1. id             : ID catatan servis (SRV-YYYYMMDD-HHmmss)
2. unitId         : ID unit fisik
3. kodeUnit       : Kode unit fisik
4. kategoriServis : 1 dari 7 kategori servis standar
5. biaya          : Biaya perawatan (Rp) (disembunyikan untuk non-admin)
6. odometer       : Angka odometer saat servis (km)
7. bengkel        : Nama bengkel rekanan
8. catatan        : Catatan pengerjaan montir
9. tanggal        : Tanggal servis (YYYY-MM-DD)
10. status        : selesai | dalam_pengerjaan
11. waktu         : Timestamp ISO entri
```

### E. Sheet `Log` (9 Kolom)
Log operasional harian dan insiden lapangan:
```text
1. id           : ID log operasional (LOG-YYYYMMDD-HHmmss)
2. tanggal      : Tanggal kejadian (YYYY-MM-DD)
3. waktu        : Jam kejadian (HH:mm)
4. kategori     : operasional | kendala_unit | insiden_tamu | cuaca | lainnya
5. judul        : Judul ringkas laporan
6. deskripsi    : Rincian laporan kejadian lapangan
7. prioritas    : normal | penting | darurat
8. namaPelapor  : Nama operator / personil pelapor
9. diselesaikan : TRUE | FALSE
```

### F. Sheet `Users` (8 Kolom)
Daftar kredensial dan peran pengguna (Hanya dapat diakses Admin):
```text
1. id            : USR-001, USR-002, dst.
2. username      : Username login (case-insensitive)
3. pinHash       : Hash PIN SHA-256 + salt
4. salt          : Garam acak per pengguna
5. role          : admin | operator | admin_custom
6. nama          : Nama lengkap personil
7. aktif         : TRUE | FALSE
8. terakhirLogin : Timestamp login terakhir
```

### G. Sheet `Penerima_Telegram` (7 Kolom)
Daftar penerima notifikasi bot Telegram pribadi (operator dan kurir):
```text
1. id        : ID registrasi
2. chatId    : Telegram Chat ID penerima (diperoleh saat /start)
3. role      : operator | kurir | admin
4. nama      : Nama personil
5. nomorWa   : Nomor WA aktif personil
6. aktif     : TRUE | FALSE
7. dibuatPada: Timestamp pendaftaran
```

### H. Sheet `Audit` (10 Kolom)
Jejak audit append-only dan penyimpan kunci idempotensi:
```text
1. id             : AUD-YYYYMMDD-HHmmssSSS
2. timestamp      : Waktu mutasi server
3. actorId        : ID pengguna eksekutor
4. actorRole      : Peran pengguna eksekutor
5. action         : LOGIN | CREATE_BOOKING | APPROVE_BOOKING | UPDATE_STATUS | RECORD_SERVICE | RECORD_LOG | UPDATE_TRACKING
6. entity         : Booking | Unit | Servis | Log | Users | Tracking
7. entityId       : ID objek terkait (No Booking, ID Servis, dsb.)
8. idempotencyKey : UUID kunci idempotensi unik dari klien
9. status         : SUCCESS | FAILED
10. details       : Rincian catatan eksekusi
```

### I. Sheet `Alert_Log` (7 Kolom)
Pencatatan riwayat pengiriman alert Telegram untuk mencegah notifikasi duplikat:
```text
1. id             : ID log alert
2. bookingId      : No booking terkait
3. tingkatAlert   : H-2 | H-1 | Overdue
4. waktuKirim     : Timestamp pengiriman
5. chatIdPenerima : ID Chat Telegram target
6. statusKirim    : SENT | FAILED
7. pesan          : Cuplikan teks pesan
```

---

## 2. PROSEDUR DEPLOYMENT GOOGLE APPS SCRIPT

1. Buat Spreadsheet baru di Google Drive melalui [sheets.new](https://sheets.new) dengan nama `RyokoRent_Data_Operasional`.
2. Buka menu **Ekstensi** > **Apps Script**.
3. Hapus kode default pada editor `Code.gs`, lalu salin seluruh isi dari berkas repositori `backend/Code.gs`.
4. Jalankan fungsi `setupDatabase()` sekali dari toolbar editor untuk membuat dan memformat otomatis seluruh 9 sheet beserta default user.
5. Klik **Deploy** (Terapkan) > **Penerapan Baru (New Deployment)**:
   - Jenis: **Aplikasi Web (Web App)**.
   - Deskripsi: `RyokoRent Multi-Device Gateway v2.0`.
   - Jalankan sebagai (*Execute as*): **Saya (Akun Google Anda)**.
   - Siapa yang memiliki akses (*Who has access*): **Siapa saja (Anyone)**.
6. Berikan otorisasi izin Spreadsheet saat diminta oleh Google.
7. Salin URL Web App yang dihasilkan (format: `https://script.google.com/macros/s/.../exec`).
8. Tempelkan URL tersebut ke konfigurasi aplikasi klien pada **Pengaturan > Google Sheets Gateway URL**.

---

## 3. PROTOKOL AUTENTIKASI & KEAMANAN

1. **Token Sesi:**
   - Klien melakukan POST `action: 'LOGIN'` dengan `username` dan `pin`.
   - Server memverifikasi hash PIN dengan salt yang tersimpan di sheet `Users`.
   - Jika valid, server menerbitkan token HMAC-SHA256 berumur 24 jam.
   - Klien menyertakan token ini pada setiap permintaan baca (`SYNC_PULL`) dan tulis.

2. **Pembatasan Hak Akses (RBAC) pada Kolom:**
   - Dilakukan di sisi server (gerbang), bukan sekadar kosmetik di UI klien.
   - **Admin:** Memperoleh seluruh data termasuk total omset, estimasi biaya sewa, dan denda.
   - **Operator:** Kolom keuangan (`totalEstimasiBiaya`, `dendaKeterlambatan`, `biaya`) otomatis disensor menjadi `null` oleh server.

3. **Serialisasi Mutasi dengan `LockService`:**
   - Semua operasi tulis dilindungi oleh `LockService.getScriptLock()` dengan batas tunggu 30 detik.
   - Mencegah race condition ketika dua operator melakukan perubahan bersamaan.

4. **Pencegahan Duplikasi dengan `idempotencyKey`:**
   - Setiap operasi tulis dari klien membawa UUID `idempotencyKey`.
   - Sebelum mengeksekusi mutasi, gerbang memeriksa tabel `Audit`. Jika kunci sudah ada, hasil sebelumnya langsung dikembalikan tanpa membuat data baru.

5. **Pemeriksaan Bentrok Jadwal di Server:**
   - Pada operasi `CREATE_BOOKING`, server secara independen memeriksa tumpang tindih waktu untuk unit yang sama terhadap status `ryokou_disewa` dan `ryokou_diservis` dengan toleransi buffer 60 menit.
   - Jika terjadi tabrakan jadwal, server menolak transaksi dengan kode error `SCHEDULE_CONFLICT`.

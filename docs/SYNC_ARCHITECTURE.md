# ARSITEKTUR SINKRONISASI MULTI-PERANGKAT: RyokoRent Android APK

**Dokumen rancangan konseptual (REV-10, `TASK-REV-10`).** Tidak ada perubahan kode. Dokumen ini menjelaskan target arsitektur; kondisi kode saat ini ada di bagian 12.
Rujukan keputusan: ID `ASM`/`Q` di `SESSION_STATE.md` bagian 4. Seluruh item sudah terjawab; tidak ada yang OPEN.

---

## 1. RINGKASAN KEPUTUSAN

| Topik | Keputusan | Rujukan |
| :--- | :--- | :--- |
| Sumber acuan data | Google Sheets, diakses hanya lewat gerbang Google Apps Script | `Q-12`, `Q-06` |
| Perangkat dan akun | Satu perangkat satu akun: Admin, Operator (dan `admin_custom` bila dipakai). Kurir tidak memakai PWA | `ASM-04`, `Q-16` |
| Skala | 25 unit, kurang dari 20 booking per hari | `ASM-05` |
| Sinkronisasi | Polling 60 detik, tanpa realtime | `Q-10` |
| Membuat dan menyetujui booking | Wajib online | `Q-08` |
| Tulis offline | Hanya catatan servis (entri baru), log operasional (entri baru), update posisi unit | `ASM-14` (ditolak), `Q-20`, `ASM-23` |
| Edit/hapus entri lama | Wajib online | `ASM-23` |
| Kurir | Menerima surat tugas dan kwitansi lewat grup WhatsApp, melapor serah terima di grup WA, menerima alert Telegram pribadi | `Q-09`, `Q-13`, `Q-17` |
| Foto | PWA tidak menyimpan foto; kurir mengirim foto serah terima ke grup WA | `Q-15`, `Q-19` |
| Edit Sheets manual | Tidak dilakukan; semua perubahan lewat gerbang | `Q-18` |
| Posisi pelacakan unit | Pool Malang, Pool Batu, Dipakai Kurir untuk lacak unit dan operasional, tidak untuk menentukan bentrok. "Servis" sama dengan `ryokou_diservis` dan dipakai sebagai istilah tunggal | `ASM-03`, `Q-25`, `Q-26(a)` |

---

## 2. PERAN DAN HAK AKSES

LocalStorage pada satu perangkat **bukan** sumber data bersama; ia hanya salinan (cache).

| Data | Admin | Operator | `admin_custom` | Kurir |
| :--- | :--- | :--- | :--- | :--- |
| Booking: data penyewa, jadwal, unit | R/W | R/W | R/W sesuai izin | Tidak ada akses aplikasi |
| Transisi status booking (termasuk serah terima dan selesai) | R/W | R/W (sesuai state machine) | Sesuai izin | Melapor lewat WA; operator/admin yang mengubah status |
| Tarif, total, denda, omset, laporan | R/W | Tersembunyi | Sesuai izin | - |
| Armada dan tarif model | R/W | R | Sesuai izin | - |
| Posisi unit (pelacakan) | R/W | R/W | Sesuai izin | - |
| Catatan servis | R/W | R/W | Sesuai izin | - |
| Log operasional | R/W | R/W | Sesuai izin | - |
| Pengguna, peran, pengaturan, integrasi, ekspor | R/W | - | - | - |
| Log audit | R | R terbatas | - | - |

Catatan:
- `admin_custom` dibatasi pada operasional dan pengiriman (`Q-07`, tafsiran). Rincian izin per fitur tetap dikonfigurasi Admin.
- Filter kolom dilakukan **di gerbang**, bukan di UI: Operator tidak menerima omset; Alamat KTP hanya diterima peran yang berhak.

### Skenario penggunaan

- **Admin:** memantau seluruh booking dan armada dari sumber data yang sama, menyetujui booking, mengatur tarif dan pengguna, melihat omset dan okupansi.
- **Operator:** menerima pesan penyewa, memasukkan booking (online), memeriksa bentrok jadwal dan buffer 60 menit, mengubah status setelah laporan kurir, mencatat servis, log operasional, dan posisi unit (boleh offline).
- **Kurir:** menerima surat tugas ambil/antar dan kwitansi paperless di grup WA, mengirim foto serah terima ke grup, melapor serah terima di grup, menerima alert Telegram untuk menghubungi penyewa.

---

## 3. DIAGRAM ARSITEKTUR (TEKS)

```text
 PERANGKAT ADMIN (1 akun)       PERANGKAT OPERATOR (1 akun)       KURIR (tanpa PWA)
 PWA baca+tulis penuh           PWA baca+tulis operasional        WhatsApp + Telegram pribadi
 cache baca + Outbox            cache baca + Outbox
 (IndexedDB)                    (IndexedDB)
        │                              │
        └──────── HTTPS + token sesi ──┘
                         ▼
 GOOGLE APPS SCRIPT WEB APP (gerbang)
   auth → peran → filter kolom → validasi (state machine, tarif, bentrok+buffer)
   → LockService → tulis → audit
                         ▼
 GOOGLE SHEETS (sumber acuan; hanya dibuka pemilik)
   Booking | Unit | Tracking | Servis | Log | Users | Penerima_Telegram | Audit | Alert_Log
        │ pemicu waktu                    │ polling ≤ 60 detik
        ▼                                 ▼
 Telegram chat pribadi             perangkat Admin/Operator lain
 (operator, kurir)                 (cache diperbarui)

 DI LUAR SISTEM (manual):
 surat tugas + kwitansi PDF dari app → grup WA → kurir kirim foto serah terima ke grup
 → kurir lapor serah terima → operator/admin memperbarui status di app
```

Prinsip:
1. Kebenaran data ada di Sheets, yang ditulis hanya oleh gerbang. Klien tidak menulis ke Sheets langsung.
2. Klien mengirim **niat operasi** (mis. "tambah catatan servis unit X"), bukan menimpa seluruh database.
3. Setiap operasi membawa ID unik dari klien (kunci idempotensi).

---

## 4. ALUR ONLINE, OFFLINE, DAN SINKRON KEMBALI

### Online
1. Perangkat login dan menerima token sesi berumur pendek.
2. Gerbang mengirim hanya data yang boleh dilihat peran tersebut.
3. Tulisan divalidasi gerbang, ditulis di bawah `LockService`, dan diberi nomor versi baru.
4. Perangkat lain memeriksa versi saat polling 60 detik; bila berubah, cache ditarik ulang.

### Offline
- **Baca:** dari cache lokal dengan penanda "data per [waktu]".
- **Tulis diizinkan (Q-20, ASM-23):** entri baru catatan servis, entri baru log operasional, update posisi unit pelacakan (bukan perpindahan ke/dari `ryokou_diservis`, yang merupakan transisi status). Disimpan di **Outbox** persisten (IndexedDB) dengan ID unik dan versi dasar.
- **Tulis tidak diizinkan:** membuat/menyetujui booking, transisi status booking (termasuk ke/dari `ryokou_diservis`), edit atau hapus entri lama, pengaturan. Tombol terkait dinonaktifkan dengan penjelasan.

### Kembali online
1. Outbox dikirim berurutan per entitas, dengan percobaan ulang dan jeda bertahap.
2. Gerbang memakai kunci idempotensi, sehingga pengiriman ganda tidak membuat duplikat.
3. Hasil tiap operasi: diterima, atau ditolak dengan alasan.
4. Operasi ditolak masuk kotak "Perlu ditinjau". Tidak dibuang diam-diam, dan antrean tidak dipotong tanpa pemberitahuan.
5. Cache ditarik ulang dari server.

### Konflik, duplikat, gagal jaringan

| Situasi | Penanganan |
| :--- | :--- |
| Entri baru servis/log dari dua perangkat | Tidak konflik (hanya tambah); ID dari klien |
| Update posisi unit pada unit yang sama dari dua perangkat | Peristiwa membawa versi dasar. Bila versi server sudah berubah, peristiwa masuk "Perlu ditinjau" |
| Dua operator menyimpan booking bersamaan (online) | `LockService` menyerialisasi; versi usang ditolak dengan pesan jelas |
| Nomor booking | `noBooking` dan ID urut dibuat gerbang di dalam kunci, bukan `maxSeq+1` lokal |
| Percobaan ulang karena respons hilang | Idempoten: operasi yang sama tidak diproses dua kali |
| Penyewa kembar | Peringatan lunak berdasarkan nomor WA ternormalisasi |
| Hapus | Hanya soft (mis. `ryokou_dibatalkan`), dengan jejak audit |
| Jam perangkat | Informasi saja; urutan dan keputusan memakai waktu server |

---

## 5. ATURAN BENTROK JADWAL

- Penentu bentrok: jadwal booking, buffer 60 menit, dan status booking yang menahan unit, yaitu `ryokou_disewa` dan `ryokou_diservis` (`ASM-22`). Diputuskan gerbang saat tulis; pemeriksaan klien hanya peringatan awal.
- "Servis" sama dengan `ryokou_diservis` (`Q-26(a)`). Istilah yang dipakai hanya `ryokou_diservis`.
- Posisi pelacakan lain (Pool Malang, Pool Batu, Dipakai Kurir) dipakai untuk lacak unit dan operasional, **tidak** untuk menentukan bentrok (`ASM-03`, `Q-25`).
- Pool Dinoyo adalah titik kendali operasional seluruh unit (`ASM-22`); posisi pelacakan mengikuti `ASM-03`.
- Perpindahan ke/dari `ryokou_diservis` adalah transisi status dan wajib online. Karena itu penulisan offline posisi unit (hanya posisi pelacakan non-status) tidak dapat menimbulkan bentrok jadwal.

---

## 6. AUTENTIKASI, PEMBATASAN AKSES, PERLINDUNGAN DATA

- **Akun:** satu akun per perangkat. Quick Switcher (pengganti pengguna di klien) tidak berlaku pada mode multi-perangkat; peran ditentukan oleh login.
- **Kredensial:** PIN/kata sandi disimpan sebagai hash bersalt di sisi server (gerbang), percobaan login dibatasi. Perangkat hilang dicabut aksesnya dari server.
- **Endpoint:** Web App Apps Script untuk klien non-Google harus berakses "Anyone". Karena itu **setiap permintaan wajib membawa token sesi** dan divalidasi gerbang.
- **Rahasia:** token bot Telegram dan kunci layanan hanya di properti server (Script Properties). Klien tidak menyimpannya.
- **Sheets:** hanya dibuka pemilik. Siapa pun yang diberi akses berkas melewati RBAC aplikasi.
- **Cache klien:** dihapus saat logout; kedaluwarsa bila lama tak tersambung.
- **Transport:** HTTPS. Enkripsi at-rest bergantung pada Google.
- **Audit:** log append-only di sheet `Audit`, ditulis hanya oleh gerbang.
- **Data pribadi penyewa:** disimpan (`Q-11`); nama dan nomor WA ikut dikirim ke Telegram (`Q-17`). Kebijakan lanjutan tentang foto dan UU PDP ditutup pemilik (`Q-24`).
- **Cadangan:** riwayat versi Sheets membantu, tetapi bukan pengganti salinan berkala.

---

## 7. FOTO DAN WHATSAPP

- PWA tidak menyimpan foto sama sekali (`Q-15`). Foto identitas dan kondisi unit dipotret kurir saat serah terima dan dikirim ke grup WA (`Q-19`).
- Foto hidup di grup WA dan di ponsel anggota. **Retensi 7 hari (`Q-11`) tidak dapat ditegakkan sistem**; di luar kendali aplikasi (`Q-24` ditutup).
- Surat tugas ambil/antar dan kwitansi paperless dibuat di aplikasi lalu dibagikan **manual** ke grup WA. Posting otomatis ke grup tidak tersedia secara gratis.
- Status serah terima bergantung pada langkah manusia: kurir melapor, operator/admin memperbarui status. Ada jeda dan risiko lupa.

---

## 8. TELEGRAM

- Alert H-2 jam, H-1 jam, dan overdue dikirim ke chat pribadi operator dan kurir agar menghubungi penyewa (`Q-13`, `Q-17`). Isi: nama dan nomor WA penyewa, tanpa dokumen identitas.
- Daftar penerima (chat ID, peran, aktif) disimpan di sheet `Penerima_Telegram`, terpisah dari akun login. Kurir tidak punya akun aplikasi.
- Bot tidak dapat memulai chat pribadi sebelum penerima menekan Start.
- Alert dijalankan **pemicu waktu di server**, sehingga berjalan walau semua perangkat tertutup. `Alert_Log` menjamin satu alert per booking per tingkat.
- Pemicu Apps Script punya batas interval dan kuota waktu eksekusi harian; angka perlu diverifikasi di dokumentasi resmi Google.

---

## 9. LOCALSTORAGE: BATASAN DAN DAMPAK

- Terpisah per perangkat dan per origin; tidak dapat menjadi sumber bersama.
- Sekitar 5 MB, hanya string, sinkron (memblokir UI), tanpa transaksi dan indeks, dapat dibersihkan peramban atau pengguna, tidak dapat dibaca Service Worker.
- Seluruh database sebagai satu blob berarti dua perangkat yang menulis akan saling menimpa.
- Dapat dibaca skrip apa pun di halaman, sehingga tidak cocok untuk rahasia.
- Penyimpanan situs di iOS yang tidak dipasang ke layar utama dapat dihapus setelah sekitar 7 hari tak dipakai.
- Dampak pada arsitektur ini: cache baca dan Outbox ditempatkan di IndexedDB; LocalStorage hanya untuk preferensi UI non-rahasia. Disetujui lewat `Q-26(b)` (menggantikan `ASM-01` untuk data bersama).

### Dampak Google Sheets sebagai backend

- Latensi Apps Script terasa (hingga beberapa detik, termasuk start dingin); cukup untuk polling 60 detik.
- Tidak ada kunci unik atau transaksi nyata; integritas sepenuhnya di kode gerbang (`LockService`, kunci idempotensi, nomor dibuat server).
- Sheets tidak punya keamanan baris/kolom; semua pembatasan akses ada di gerbang.
- Kuota Apps Script (waktu eksekusi, eksekusi bersamaan, pemicu) ada dan dapat berubah. **Verifikasi di dokumentasi resmi.**
- Sekitar 7 ribu booking per tahun jauh di bawah batas sel Sheets; pembacaan penuh melambat bila baris menumpuk, sehingga pengarsipan tahunan layak dipertimbangkan.
- Skema dapat rusak oleh edit manual; kebijakan `Q-18` (tidak mengedit Sheets langsung) menutup risiko ini.

---

## 10. PERBANDINGAN OPSI GRATIS

Angka kuota adalah perkiraan dan dapat berubah. Verifikasi di halaman resmi sebelum memutuskan.

| Aspek | Google Sheets + Apps Script | Firebase Firestore (Spark) | Supabase (Free) |
| :--- | :--- | :--- | :--- |
| Model | Tabel/baris, tanpa skema ketat | Dokumen NoSQL | Postgres relasional |
| Autentikasi | Tidak ada auth nyata untuk klien non-Google; token buatan sendiri | Firebase Auth | Auth bawaan |
| Akses per peran | Hanya lewat kode gerbang | Security Rules per dokumen | Row Level Security |
| Konkurensi/integritas | `LockService`; tanpa kunci unik | Transaksi dokumen | Transaksi, kunci unik, batasan overlap |
| Realtime | Tidak (polling) | Ya | Ya |
| Offline bawaan | Tidak (Outbox buatan sendiri) | Ya | Tidak (Outbox buatan sendiri) |
| Batas gratis (perkiraan) | Kuota eksekusi Apps Script, batas sel | ~1 GiB, ~50 rb baca/hari, ~20 rb tulis/hari | ~500 MB DB; proyek dapat di-pause bila tak aktif |
| Risiko gratis | Kuota harian, skema rusak oleh edit manual, endpoint publik | Kuota habis menghentikan operasi sampai reset; ketergantungan vendor | Pause karena tidak aktif; cadangan otomatis terbatas |
| Kecocokan kode saat ini | Tertinggi (sudah ada `googleSheetsService`) | Sedang | Sedang |

Alasan memilih Sheets: pemilik menetapkannya sebagai sumber acuan (`Q-12`), akun Google tersedia tanpa kartu kredit (`Q-06`), volume kecil (`ASM-05`), polling 60 detik cukup (`Q-10`), penulisan kritis wajib online (`Q-08`), dan kurir tidak menulis ke data bersama (`Q-09`). Alternatif lain yang dipertimbangkan namun tidak dipilih: Airtable (batas rekaman rendah di paket gratis), PocketBase/Appwrite (butuh server), Cloudflare Workers + D1 (butuh backend buatan sendiri).

Batasan yang diterima: latensi dan kuota Apps Script, integritas bergantung kode gerbang, Outbox offline dibuat sendiri, ketergantungan manusia pada jalur WA.

---

## 11. ASUMSI DAN HAL BELUM PASTI

| Rujukan | Isi | Status |
| :--- | :--- | :--- |
| `Q-26(a)` | "Servis" = `ryokou_diservis` (istilah tunggal); "disewa"/"diservis" pada `ASM-22` dibaca sebagai status booking | ANSWERED |
| `Q-26(b)` | `ASM-01` tidak berlaku untuk data bersama; cache dan Outbox di IndexedDB | ANSWERED: setuju |
| Kuota | Angka kuota Apps Script, Firestore, Supabase | Perlu verifikasi resmi |
| `admin_custom` | Cakupan izin rinci per fitur | Dikonfigurasi Admin |

---

## 12. KONDISI KODE SAAT INI (SELISIH DENGAN TARGET)

Fakta yang diverifikasi dari repositori; bukan daftar pekerjaan.

- Database disimpan sebagai satu JSON di LocalStorage (`ryokourent_db_v1`) per perangkat.
- RBAC hanya di klien; `currentUserId` dan Quick Switcher (`TopBar`) memungkinkan pergantian peran tanpa kredensial.
- Sheets hanya didorong satu arah (`UPSERT_BOOKING` lewat webhook); belum ada pembacaan balik. Antrean offline dipotong `queue.slice(-50)` di `googleSheetsService.ts`.
- `generateBookingNumber` memakai `maxSeq + 1` dari data lokal (`bookingEngine.ts`), sehingga bentrok bila lebih dari satu perangkat menulis.
- `telegramBotToken` dan `googleSheetsWebhookUrl` disimpan di `settings` pada LocalStorage; ekspor JSON menyembunyikannya, tetapi tetap berada di perangkat.
- PWA memakai `registerType: 'prompt'`, sehingga tiap perangkat dapat menjalankan versi aplikasi yang berbeda sementara waktu.

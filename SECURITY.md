# Kebijakan Keamanan (Security Policy)

## Arsitektur Privasi & Penyimpanan Data

1. **100% Sisi Klien (Client-Side)**:
   - Aplikasi web ZLCE Studio berjalan sepenuhnya di browser pengguna.
   - Semua input teks, draf `SESSION_STATE.md`, dan riwayat undo/redo disimpan secara lokal di `localStorage` peramban Anda.
   - Tidak ada data dokumen atau potongan kode proyek yang dikirimkan ke server jarak jauh (kecuali Anda sendiri yang menghubungkan integrasi eksternal).

2. **Perhatian Terhadap Kredensial**:
   - Jangan pernah menyalin atau menyimpan rahasia (kunci API privat, kata sandi database, token akses OAuth) ke dalam berkas kontrol `SESSION_STATE.md`, `TASKS.md`, maupun snapshot git.
   - Gunakan selalu berkas lingkungan lokal (`.env`) yang dikecualikan di `.gitignore`.

## Keamanan Data Aplikasi RyokoRent (Rancangan Multi-Perangkat, REV-10)

Bagian di atas mengenai ZLCE Studio. Untuk aplikasi RyokoRent pada mode multi-perangkat berlaku (rancangan, lihat `docs/SYNC_ARCHITECTURE.md` bagian 6):
- RBAC dievaluasi di gerbang server, bukan hanya di klien; satu akun per perangkat; tanpa Quick Switcher.
- Setiap permintaan membawa token sesi berumur pendek; PIN/kata sandi disimpan sebagai hash bersalt di server; percobaan login dibatasi.
- Token bot Telegram dan kunci layanan hanya di properti server, tidak di klien dan tidak di repositori.
- Berkas Google Sheets hanya dibuka pemilik; perubahan hanya lewat gerbang; audit append-only.
- Cache klien dihapus saat logout dan dibatasi pada data sesuai peran.
- PWA tidak menyimpan foto. Foto serah terima berada di grup WhatsApp, di luar kendali aplikasi.

## Pelaporan Kerentanan (Reporting a Vulnerability)

Jika Anda menemukan potensi kerentanan keamanan pada kit atau aplikasi web ZLCE Studio:
- Harap tidak mempublikasikannya langsung di issue publik.
- Kirimkan detail temuan dan langkah reproduksi melalui email ke pengelola proyek atau buat *Security Advisory* privat di repositori GitHub resmi: `https://github.com/acimau99-netizen/ZLCEv3.2.2/security/advisories`.
- Kami akan meninjau dan merespons laporan dalam waktu 1–3 hari kerja.

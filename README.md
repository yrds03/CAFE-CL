# CAFE CL — Artisanal Coffee & Roastery POS (PWA)

Aplikasi Web Progresif (PWA) khusus operasional **Cafe** untuk **PC & HP** dengan desain elegan, sinkronisasi **Google Sheets** otomatis, **auto-generate sheet & header**, tombol **Download untuk PC & HP** di bawah login, serta **Auto-Update Service Worker** dengan animasi loading setiap kali aplikasi dibuka atau ada perbaikan baru.

## Link Penting
- **Live Aplikasi (GitHub Pages):** https://yrds03.github.io/CAFE-CL/
- **Repository GitHub:** https://github.com/yrds03/CAFE-CL
- **Google Spreadsheet:** https://docs.google.com/spreadsheets/d/1fmNy_guFg-obp4JdVrNsQsCbbXPGp8IK7nPetVlCmTQ/edit?usp=sharing
- **Google Apps Script:** https://script.google.com/u/0/home/projects/1iTO7Qzup1t6NC9avQDFJfnc5sW11SpX1MB2LinQcAuhXFD3-u3rqYceT/edit

## Fitur Utama Khusus Cafe
1. **Login Modern (Akun & PIN Cepat)** + tombol **Download untuk PC** & **Download untuk HP** langsung di bawah form login.
2. **Startup & Live Auto-Update Spinner**: Setiap kali aplikasi dibuka, sistem memeriksa `version.json` & Service Worker terbaru. Saat ada pembaruan di GitHub, layar otomatis memutar loading update, membersihkan cache lama, dan memuat versi terbaru secara otomatis.
3. **Kasir POS Cafe**: Kategori Signature, Espresso, Non-Coffee, Tea, Pastry, Food; custom varian (`Iced/Hot`, `Sugar`, `Oat Milk +8k`); Dine-In/Take Away/Delivery; Open Bill meja; pembayaran QRIS/Tunai/Debit/Transfer/E-Wallet; cetak struk thermal 58mm/80mm & kirim struk via WhatsApp.
4. **Layar Barista (KDS)**: Antrean pembuatan minuman & makanan real-time (`Menunggu` → `Diproses` → `Siap` → `Selesai`).
5. **Denah Meja Cafe**: Indoor AC, Coffee Bar, Outdoor Garden, VIP Lounge dengan status `Tersedia / Terisi / Reservasi`.
6. **Manajemen Menu, HPP & Stok**, **Riwayat Order**, **Keuangan & Shift Kasir (Laba Rugi)**, serta **Member & Poin Loyalitas**.

## Cara Pasang `Code.gs` & Auto-Generate Sheet
1. Buka project Apps Script Anda: https://script.google.com/u/0/home/projects/1iTO7Qzup1t6NC9avQDFJfnc5sW11SpX1MB2LinQcAuhXFD3-u3rqYceT/edit
2. Salin seluruh isi file `Code.gs` dari folder ini lalu tempel ke `Code.gs` di Apps Script, kemudian **Save**.
3. Pilih fungsi `setupDatabase` di toolbar atas lalu klik **Run** (izin akses Google Sheets sekali saja) — **9 sheet (`Users`, `Menu`, `Meja`, `Pesanan`, `Detail_Pesanan`, `Pengeluaran`, `Shift_Kasir`, `Member`, `Pengaturan`) beserta header berwarna & data awal cafe langsung terbentuk otomatis!**
4. Klik **Deploy → New deployment → Web app**:
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
5. Salin URL Web App (`https://script.google.com/macros/s/.../exec`), buka aplikasi CAFE CL → klik **Hubungkan Google Sheets** → tempel URL → klik **Simpan & Generate Sheet**.

## Akun Default Awal
| Role | Username | Password | PIN Cepat |
|------|----------|----------|-----------|
| Owner | `owner` | `owner123` | `1111` |
| Kasir | `kasir` | `kasir123` | `2222` |
| Barista | `barista` | `barista123` | `3333` |

## Cara Update & Auto-Deploy (SW Otomatis Update)
Setiap kali ada perbaikan kode di PC Anda, cukup:
- **Klik ganda `deploy.bat`**, atau jalankan `npm run deploy` di terminal.
- Versi di `sw.js`, `version.json`, dan `config.js` otomatis naik, langsung push ke GitHub, GitHub Pages otomatis deploy, dan seluruh aplikasi di PC maupun HP langsung memutar animasi update otomatis!

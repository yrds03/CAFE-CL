# CAFE CL — Artisanal Coffee & Cashier POS (PWA)

Aplikasi Web Progresif (PWA) khusus **Kasir Cafe** untuk **PC & HP** dengan desain elegan, **Printer Thermal Bluetooth (ESC/POS 58mm/80mm)**, **Manajemen Role & Hak Akses**, tombol **Download untuk PC & HP** di bawah login, sinkronisasi **Google Sheets** otomatis, serta **Auto-Update Service Worker** dengan animasi loading setiap kali aplikasi dibuka atau ada perbaikan baru.

## Link Live
- **Aplikasi Live (GitHub Pages):** https://yrds03.github.io/CAFE-CL/
- **Repository GitHub:** https://github.com/yrds03/CAFE-CL

## Fitur Utama (Fokus Kasir)
1. **Printer Thermal Bluetooth (BT Indikator Merah / Hijau)**: Indikator langsung di topbar (**Merah** = belum konek, **Hijau** = sudah konek), mendukung cetak ESC/POS 58mm/80mm, Test Print, Auto-Print setelah bayar, cetak ulang struk, dan cetak laporan tutup shift.
2. **Keamanan & Role-Based Access Control (RBAC)**:
   - Tambah, edit, dan hapus **Role** beserta checklist hak akses tiap menu.
   - Kelola akun staff (username, password, PIN 4 digit, status aktif).
   - Tanpa ekspos link Apps Script atau kredensial demo di halaman publik.
3. **Kasir POS Cafe**: Kategori Signature, Espresso, Non-Coffee, Tea, Pastry, Food; custom varian (`Iced/Hot`, `Sugar`, `Oat Milk +8k`); Dine-In/Take Away/Delivery; Member & Open Bill; pembayaran QRIS/Tunai/Debit/Transfer/E-Wallet; struk Bluetooth Thermal, Browser Print & WhatsApp.
4. **Denah Meja, Riwayat Transaksi, Manajemen Menu/Stok, Keuangan & Shift Kasir, Member Loyalitas**.
5. **Auto-Update PWA & Auto-Deploy**: Jalankan `deploy.bat` atau `npm run deploy` — versi di `sw.js`, `version.json`, dan `config.js` otomatis naik dan langsung deploy ke GitHub Pages.

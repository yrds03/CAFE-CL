# NOUS — Coffee & Cashier POS (PWA)

Aplikasi Web Progresif (PWA) khusus **Kasir Cafe NOUS** untuk **PC, Tablet & HP** dengan desain *Slate-Indigo & Warm Cream* sesuai identitas visual **NOUS**, **Printer Thermal Bluetooth (ESC/POS 58mm/80mm)**, **Manajemen Role & Hak Akses**, tombol **Download untuk PC & HP** di bawah login, **Pindah & Generate Google Sheet Klien 1-Klik**, Export **CSV Rapi & Excel (`.xls`)**, serta **Auto-Update Service Worker** dengan animasi loading setiap kali aplikasi dibuka atau ada perbaikan baru.

## Link Live
- **Aplikasi Live (GitHub Pages):** https://yrds03.github.io/CAFE-CL/
- **Repository GitHub:** https://github.com/yrds03/CAFE-CL

## Fitur Utama
1. **Identitas & Icon Resmi NOUS**: Warna *Slate-Indigo & Warm Cream* (Mode Gelap & Terang) dan icon aplikasi **NOUS** otomatis terpasang saat diinstall di PC maupun HP.
2. **Printer Thermal Bluetooth (BT Indikator Merah / Hijau)**: Indikator di topbar, cetak ESC/POS 58mm/80mm, Test Print, Auto-Print setelah bayar, cetak struk & tutup shift.
3. **Manajemen Role & Keamanan (RBAC)**: Tambah/edit/hapus Role beserta checklist hak akses per menu, tanpa mengekspos link sensitif di halaman publik.
4. **Pindah & Generate Google Sheet Klien 1-Klik**: Cukup copas link Google Sheet klien di Pengaturan → Generate 10 sheet & header otomatis + fitur salin `Code.gs` khusus klien & Link Setup Perangkat Kasir.
5. **Auto-Update PWA & Auto-Deploy**: Jalankan `deploy.bat` atau `npm run deploy`.

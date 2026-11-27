// CAFE CL — Konfigurasi Aplikasi & Integrasi Google Sheets / Apps Script
window.CAFE_CONFIG = {
  APP_NAME: 'CAFE CL',
  APP_TAGLINE: 'Artisanal Coffee & Roastery POS',
  APP_VERSION: '1.0.0',
  APP_BUILD: '20261127-1040',

  // ID Google Spreadsheet & Apps Script milik Anda
  SPREADSHEET_ID: '1fmNy_guFg-obp4JdVrNsQsCbbXPGp8IK7nPetVlCmTQ',
  SPREADSHEET_URL: 'https://docs.google.com/spreadsheets/d/1fmNy_guFg-obp4JdVrNsQsCbbXPGp8IK7nPetVlCmTQ/edit?usp=sharing',
  APPS_SCRIPT_ID: '1iTO7Qzup1t6NC9avQDFJfnc5sW11SpX1MB2LinQcAuhXFD3-u3rqYceT',
  APPS_SCRIPT_URL: 'https://script.google.com/u/0/home/projects/1iTO7Qzup1t6NC9avQDFJfnc5sW11SpX1MB2LinQcAuhXFD3-u3rqYceT/edit',

  // Tempel URL Web App hasil Deploy Google Apps Script Anda di sini (berakhiran /exec)
  // Bisa juga diisi langsung dari tombol "Hubungkan GAS" di layar Login atau Pengaturan!
  GAS_WEBAPP_URL: '',

  // Interval pengecekan update otomatis di latar belakang (milidetik)
  UPDATE_CHECK_INTERVAL_MS: 60000,

  // Data awal default (otomatis terpakai jika belum terhubung ke GAS / mode offline)
  DEFAULT_SETTINGS: {
    cafe_name: 'CAFE CL',
    tagline: 'Artisanal Coffee & Roastery',
    address: 'Jl. Aroma Kopi No. 27, Kota Anda',
    phone: '0812-3456-7890',
    instagram: '@cafecl.official',
    tax_percent: 10,
    service_percent: 0,
    receipt_footer: 'Terima kasih telah menikmati kopi di CAFE CL. Sampai jumpa kembali!',
    paper_size: '58mm',
    currency: 'Rp'
  },

  DEFAULT_USERS: [
    { id: 'USR-001', username: 'owner', password: 'owner123', nama: 'Owner CAFE CL', role: 'Owner', pin: '1111', aktif: true },
    { id: 'USR-002', username: 'kasir', password: 'kasir123', nama: 'Kasir Utama', role: 'Kasir', pin: '2222', aktif: true },
    { id: 'USR-003', username: 'barista', password: 'barista123', nama: 'Head Barista', role: 'Barista', pin: '3333', aktif: true }
  ],

  DEFAULT_TABLES: [
    { id: 'TBL-01', nomor: '01', nama: 'Meja 01', area: 'Indoor AC', kapasitas: 2, status: 'Tersedia', order_aktif: '' },
    { id: 'TBL-02', nomor: '02', nama: 'Meja 02', area: 'Indoor AC', kapasitas: 4, status: 'Tersedia', order_aktif: '' },
    { id: 'TBL-03', nomor: '03', nama: 'Meja 03', area: 'Indoor AC', kapasitas: 4, status: 'Tersedia', order_aktif: '' },
    { id: 'TBL-04', nomor: '04', nama: 'Meja 04', area: 'Indoor AC', kapasitas: 6, status: 'Tersedia', order_aktif: '' },
    { id: 'TBL-05', nomor: '05', nama: 'Bar 01', area: 'Coffee Bar', kapasitas: 2, status: 'Tersedia', order_aktif: '' },
    { id: 'TBL-06', nomor: '06', nama: 'Bar 02', area: 'Coffee Bar', kapasitas: 2, status: 'Tersedia', order_aktif: '' },
    { id: 'TBL-07', nomor: '07', nama: 'Garden 01', area: 'Outdoor Garden', kapasitas: 4, status: 'Tersedia', order_aktif: '' },
    { id: 'TBL-08', nomor: '08', nama: 'Garden 02', area: 'Outdoor Garden', kapasitas: 4, status: 'Tersedia', order_aktif: '' },
    { id: 'TBL-09', nomor: '09', nama: 'Garden 03', area: 'Outdoor Garden', kapasitas: 6, status: 'Tersedia', order_aktif: '' },
    { id: 'TBL-10', nomor: '10', nama: 'VIP Lounge', area: 'VIP Lounge', kapasitas: 8, status: 'Tersedia', order_aktif: '' }
  ],

  DEFAULT_MENU: [
    {
      id: 'MNU-001', kode: 'SIG-01', nama: 'CL Signature Palm Sugar Latte', kategori: 'Signature',
      harga: 28000, hpp: 10500, stok: 80, deskripsi: 'Double ristretto house blend dengan gula aren organik & susu velvety.',
      foto_url: '', varian: 'Iced,Hot|Normal Sugar,Less Sugar,No Sugar|Fresh Milk,Oat Milk (+8000)', tersedia: true, favorit: true
    },
    {
      id: 'MNU-002', kode: 'SIG-02', nama: 'Velvet Caramel Macchiato', kategori: 'Signature',
      harga: 32000, hpp: 12000, stok: 65, deskripsi: 'Espresso lembut dengan vanilla bean dan homemade salted caramel drizzle.',
      foto_url: '', varian: 'Iced,Hot|Normal Sugar,Less Sugar|Fresh Milk,Oat Milk (+8000)', tersedia: true, favorit: true
    },
    {
      id: 'MNU-003', kode: 'SIG-03', nama: 'Butterscotch Sea Salt Latte', kategori: 'Signature',
      harga: 34000, hpp: 12800, stok: 50, deskripsi: 'Creamy butterscotch dipadukan sea salt foam lembut khas CAFE CL.',
      foto_url: '', varian: 'Iced,Hot|Normal Sugar,Less Sugar', tersedia: true, favorit: true
    },
    {
      id: 'MNU-004', kode: 'ESP-01', nama: 'Double Shot Americano', kategori: 'Espresso',
      harga: 22000, hpp: 7000, stok: 120, deskripsi: '100% Arabica Gayo & Bali Kintamani roasted medium-dark.',
      foto_url: '', varian: 'Iced,Hot|No Sugar,Less Sugar,Normal Sugar', tersedia: true, favorit: false
    },
    {
      id: 'MNU-005', kode: 'ESP-02', nama: 'Artisan Cappuccino', kategori: 'Espresso',
      harga: 28000, hpp: 9800, stok: 90, deskripsi: 'Espresso seimbang dengan microfoam tebal dan taburan cokelat halus.',
      foto_url: '', varian: 'Hot,Iced|No Sugar,Less Sugar|Fresh Milk,Oat Milk (+8000)', tersedia: true, favorit: true
    },
    {
      id: 'MNU-006', kode: 'ESP-03', nama: 'Caffe Latte', kategori: 'Espresso',
      harga: 28000, hpp: 9800, stok: 90, deskripsi: 'Espresso single origin dengan steamed milk lembut.',
      foto_url: '', varian: 'Hot,Iced|No Sugar,Less Sugar,Normal Sugar|Fresh Milk,Oat Milk (+8000)', tersedia: true, favorit: false
    },
    {
      id: 'MNU-007', kode: 'ESP-04', nama: 'Manual Brew V60 Pour Over', kategori: 'Espresso',
      harga: 32000, hpp: 11000, stok: 40, deskripsi: 'Seduhan manual single origin pilihan barista dengan notes floral & citrus.',
      foto_url: '', varian: 'Hot,Japanese Iced', tersedia: true, favorit: false
    },
    {
      id: 'MNU-008', kode: 'NON-01', nama: 'Ceremonial Uji Matcha Latte', kategori: 'Non-Coffee',
      harga: 33000, hpp: 13500, stok: 55, deskripsi: 'Matcha Jepang grade ceremonial dengan susu segar dingin/hangat.',
      foto_url: '', varian: 'Iced,Hot|Normal Sugar,Less Sugar|Fresh Milk,Oat Milk (+8000)', tersedia: true, favorit: true
    },
    {
      id: 'MNU-009', kode: 'NON-02', nama: 'Belgian Dark Chocolate', kategori: 'Non-Coffee',
      harga: 30000, hpp: 11500, stok: 60, deskripsi: 'Cokelat hitam Belgia 70% kaya rasa dengan tekstur pekat lembut.',
      foto_url: '', varian: 'Iced,Hot|Normal Sugar,Less Sugar', tersedia: true, favorit: false
    },
    {
      id: 'MNU-010', kode: 'NON-03', nama: 'Red Velvet Cream Cheese', kategori: 'Non-Coffee',
      harga: 31000, hpp: 11800, stok: 45, deskripsi: 'Minuman red velvet lembut dengan topping cheese foam gurih.',
      foto_url: '', varian: 'Iced,Hot|Normal Sugar,Less Sugar', tersedia: true, favorit: false
    },
    {
      id: 'MNU-011', kode: 'TEA-01', nama: 'Lychee Rose Artisanal Tea', kategori: 'Tea',
      harga: 25000, hpp: 8200, stok: 70, deskripsi: 'Teh hitam premium dengan kelopak mawar & buah leci segar.',
      foto_url: '', varian: 'Iced,Hot|Normal Sugar,Less Sugar', tersedia: true, favorit: false
    },
    {
      id: 'MNU-012', kode: 'TEA-02', nama: 'Peach Sunset Sparkling Tea', kategori: 'Tea',
      harga: 27000, hpp: 9000, stok: 65, deskripsi: 'Teh buah persik menyegarkan dengan sentuhan soda ringan & mint.',
      foto_url: '', varian: 'Iced|Normal Sugar,Less Sugar', tersedia: true, favorit: false
    },
    {
      id: 'MNU-013', kode: 'PAS-01', nama: 'French Butter Croissant', kategori: 'Pastry',
      harga: 26000, hpp: 11000, stok: 30, deskripsi: 'Croissant flaky renyah dipanggang segar setiap pagi dengan mentega Prancis.',
      foto_url: '', varian: 'Hangat,Normal', tersedia: true, favorit: true
    },
    {
      id: 'MNU-014', kode: 'PAS-02', nama: 'Burnt Basque Cheesecake', kategori: 'Pastry',
      harga: 38000, hpp: 16500, stok: 24, deskripsi: 'Cheesecake lembut lumer dengan karamelisasi klasik di bagian atas.',
      foto_url: '', varian: 'Original,With Berry Compote (+5000)', tersedia: true, favorit: true
    },
    {
      id: 'MNU-015', kode: 'PAS-03', nama: 'Pain au Chocolat', kategori: 'Pastry',
      harga: 28000, hpp: 12000, stok: 25, deskripsi: 'Pastry lapis mentega berisi batang cokelat gelap Prancis.',
      foto_url: '', varian: 'Hangat,Normal', tersedia: true, favorit: false
    },
    {
      id: 'MNU-016', kode: 'FOD-01', nama: 'Truffle Parmesan Fries', kategori: 'Food',
      harga: 32000, hpp: 12500, stok: 45, deskripsi: 'Kentang goreng renyah dengan minyak truffle, keju parmesan & aioli.',
      foto_url: '', varian: 'Regular,Extra Aioli (+5000)', tersedia: true, favorit: false
    },
    {
      id: 'MNU-017', kode: 'FOD-02', nama: 'Creamy Chicken Carbonara', kategori: 'Food',
      harga: 46000, hpp: 20000, stok: 30, deskripsi: 'Spaghetti al dente dengan smoked chicken, saus krim parmesan & lada hitam.',
      foto_url: '', varian: 'Normal,Pedas', tersedia: true, favorit: false
    },
    {
      id: 'MNU-018', kode: 'FOD-03', nama: 'Rice Bowl Chicken Sambal Matah', kategori: 'Food',
      harga: 42000, hpp: 18000, stok: 35, deskripsi: 'Nasi hangat, ayam crispy, telur setengah matang & sambal matah segar Bali.',
      foto_url: '', varian: 'Sedang,Pedas,Tidak Pedas', tersedia: true, favorit: true
    }
  ],

  DEFAULT_MEMBERS: [
    { id: 'MBR-001', nama: 'Nadia Kusuma', telepon: '081290001122', email: 'nadia@example.com', poin: 145, total_belanja: 1450000, kunjungan: 14, tier: 'Gold' },
    { id: 'MBR-002', nama: 'Raka Pratama', telepon: '081388776655', email: 'raka@example.com', poin: 62, total_belanja: 620000, kunjungan: 7, tier: 'Silver' }
  ]
};

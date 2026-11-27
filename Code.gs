/**
 * ============================================================================
 * CAFE CL — Google Apps Script Backend (Code.gs)
 * ============================================================================
 * Spreadsheet ID : 1fmNy_guFg-obp4JdVrNsQsCbbXPGp8IK7nPetVlCmTQ
 * Apps Script ID : 1iTO7Qzup1t6NC9avQDFJfnc5sW11SpX1MB2LinQcAuhXFD3-u3rqYceT
 *
 * CARA DEPLOY CEPAT:
 * 1. Tempel seluruh kode ini ke Code.gs di project Apps Script Anda.
 * 2. (Opsional) Pilih fungsi `setupDatabase` lalu klik Run untuk langsung
 *    meng-generate seluruh sheet + header + data awal cafe secara otomatis!
 *    (Atau cukup deploy — sheet & header otomatis terbuat pada request pertama!)
 * 3. Klik Deploy -> New deployment -> Web app:
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Salin URL Web App (/exec) lalu tempel di aplikasi CAFE CL (tombol Hubungkan GAS).
 * ============================================================================
 */

const SPREADSHEET_ID = '1fmNy_guFg-obp4JdVrNsQsCbbXPGp8IK7nPetVlCmTQ';
const TIMEZONE = 'Asia/Jakarta';

// Skema seluruh sheet dan header otomatis khusus sistem Cafe
const SCHEMA = {
  Users: [
    'id', 'username', 'password', 'nama', 'role', 'pin', 'aktif', 'created_at'
  ],
  Menu: [
    'id', 'kode', 'nama', 'kategori', 'harga', 'hpp', 'stok',
    'deskripsi', 'foto_url', 'varian', 'tersedia', 'favorit', 'updated_at'
  ],
  Meja: [
    'id', 'nomor', 'nama', 'area', 'kapasitas', 'status', 'order_aktif', 'updated_at'
  ],
  Pesanan: [
    'id', 'no_invoice', 'tanggal', 'waktu', 'kasir', 'pelanggan',
    'tipe_order', 'meja', 'items_json', 'subtotal', 'diskon', 'pajak',
    'service_charge', 'total', 'metode_bayar', 'bayar', 'kembalian',
    'status_bayar', 'status_dapur', 'catatan', 'updated_at'
  ],
  Detail_Pesanan: [
    'id', 'no_invoice', 'tanggal', 'menu_id', 'nama_menu', 'kategori',
    'varian', 'catatan_item', 'qty', 'harga', 'hpp', 'subtotal', 'profit'
  ],
  Pengeluaran: [
    'id', 'tanggal', 'kategori', 'deskripsi', 'nominal', 'metode',
    'dicatat_oleh', 'catatan', 'created_at'
  ],
  Shift_Kasir: [
    'id', 'kasir', 'buka_waktu', 'tutup_waktu', 'modal_awal',
    'total_tunai', 'total_non_tunai', 'kas_aktual', 'selisih', 'status', 'catatan'
  ],
  Member: [
    'id', 'nama', 'telepon', 'email', 'poin', 'total_belanja',
    'kunjungan', 'tier', 'created_at'
  ],
  Pengaturan: [
    'key', 'value', 'updated_at'
  ]
};

// ============================================================================
// UTILITY HELPERS
// ============================================================================

function getSS() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function nowISO() {
  return Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}

function todayStr() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
}

function timeStr() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'HH:mm:ss');
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseBool(val) {
  if (val === true || val === 'TRUE' || val === 'true' || val === 1 || val === '1') return true;
  return false;
}

function toNum(val) {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

// ============================================================================
// AUTO-GENERATE SHEETS, STYLED HEADERS & INITIAL SEED DATA
// ============================================================================

function setupDatabase() {
  const result = ensureDatabaseSetup(true);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function ensureDatabaseSetup(seedIfEmpty) {
  const ss = getSS();
  const createdSheets = [];
  const repairedHeaders = [];
  const seededSheets = [];
  const now = nowISO();

  Object.keys(SCHEMA).forEach((sheetName) => {
    const headers = SCHEMA[sheetName];
    let sheet = ss.getSheetByName(sheetName);
    let isNew = false;

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      isNew = true;
      createdSheets.push(sheetName);
    }

    // Pastikan baris header sesuai skema
    const lastCol = Math.max(sheet.getLastColumn(), headers.length);
    const existingHeader = sheet.getLastRow() >= 1
      ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim())
      : [];

    const headerMismatch = headers.some((h, idx) => existingHeader[idx] !== h);
    if (isNew || sheet.getLastRow() === 0 || headerMismatch) {
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(headers);
      } else {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      }
      styleHeaderRow(sheet, headers.length);
      if (!isNew) repairedHeaders.push(sheetName);
    }

    // Seed data awal otomatis jika sheet baru dibuat atau masih kosong
    if (seedIfEmpty && sheet.getLastRow() <= 1) {
      const seedRows = getSeedRows(sheetName, now);
      if (seedRows && seedRows.length > 0) {
        sheet.getRange(2, 1, seedRows.length, headers.length).setValues(seedRows);
        seededSheets.push(sheetName);
      }
    }
  });

  // Hapus sheet bawaan kosong "Sheet1" jika sudah ada sheet Cafe
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
    try { ss.deleteSheet(defaultSheet); } catch (e) {}
  }

  return {
    ok: true,
    spreadsheetId: SPREADSHEET_ID,
    spreadsheetName: ss.getName(),
    sheets: Object.keys(SCHEMA),
    createdSheets: createdSheets,
    repairedHeaders: repairedHeaders,
    seededSheets: seededSheets,
    timestamp: now
  };
}

function styleHeaderRow(sheet, colCount) {
  const headerRange = sheet.getRange(1, 1, 1, colCount);
  headerRange
    .setBackground('#241610')
    .setFontColor('#F4D59B')
    .setFontWeight('bold')
    .setFontFamily('Arial')
    .setFontSize(10)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 32);
  try {
    sheet.autoResizeColumns(1, colCount);
  } catch (e) {}
}

function getSeedRows(sheetName, now) {
  if (sheetName === 'Users') {
    return [
      ['USR-001', 'owner', 'owner123', 'Owner CAFE CL', 'Owner', '1111', true, now],
      ['USR-002', 'kasir', 'kasir123', 'Kasir Utama', 'Kasir', '2222', true, now],
      ['USR-003', 'barista', 'barista123', 'Head Barista', 'Barista', '3333', true, now]
    ];
  }
  if (sheetName === 'Meja') {
    return [
      ['TBL-01', '01', 'Meja 01', 'Indoor AC', 2, 'Tersedia', '', now],
      ['TBL-02', '02', 'Meja 02', 'Indoor AC', 4, 'Tersedia', '', now],
      ['TBL-03', '03', 'Meja 03', 'Indoor AC', 4, 'Tersedia', '', now],
      ['TBL-04', '04', 'Meja 04', 'Indoor AC', 6, 'Tersedia', '', now],
      ['TBL-05', '05', 'Bar 01', 'Coffee Bar', 2, 'Tersedia', '', now],
      ['TBL-06', '06', 'Bar 02', 'Coffee Bar', 2, 'Tersedia', '', now],
      ['TBL-07', '07', 'Garden 01', 'Outdoor Garden', 4, 'Tersedia', '', now],
      ['TBL-08', '08', 'Garden 02', 'Outdoor Garden', 4, 'Tersedia', '', now],
      ['TBL-09', '09', 'Garden 03', 'Outdoor Garden', 6, 'Tersedia', '', now],
      ['TBL-10', '10', 'VIP Lounge', 'VIP Lounge', 8, 'Tersedia', '', now]
    ];
  }
  if (sheetName === 'Menu') {
    return [
      ['MNU-001', 'SIG-01', 'CL Signature Palm Sugar Latte', 'Signature', 28000, 10500, 80, 'Double ristretto house blend dengan gula aren organik & susu velvety.', '', 'Iced,Hot|Normal Sugar,Less Sugar,No Sugar|Fresh Milk,Oat Milk (+8000)', true, true, now],
      ['MNU-002', 'SIG-02', 'Velvet Caramel Macchiato', 'Signature', 32000, 12000, 65, 'Espresso lembut dengan vanilla bean dan homemade salted caramel drizzle.', '', 'Iced,Hot|Normal Sugar,Less Sugar|Fresh Milk,Oat Milk (+8000)', true, true, now],
      ['MNU-003', 'SIG-03', 'Butterscotch Sea Salt Latte', 'Signature', 34000, 12800, 50, 'Creamy butterscotch dipadukan sea salt foam lembut khas CAFE CL.', '', 'Iced,Hot|Normal Sugar,Less Sugar', true, true, now],
      ['MNU-004', 'ESP-01', 'Double Shot Americano', 'Espresso', 22000, 7000, 120, '100% Arabica Gayo & Bali Kintamani roasted medium-dark.', '', 'Iced,Hot|No Sugar,Less Sugar,Normal Sugar', true, false, now],
      ['MNU-005', 'ESP-02', 'Artisan Cappuccino', 'Espresso', 28000, 9800, 90, 'Espresso seimbang dengan microfoam tebal dan taburan cokelat halus.', '', 'Hot,Iced|No Sugar,Less Sugar|Fresh Milk,Oat Milk (+8000)', true, true, now],
      ['MNU-006', 'ESP-03', 'Caffe Latte', 'Espresso', 28000, 9800, 90, 'Espresso single origin dengan steamed milk lembut.', '', 'Hot,Iced|No Sugar,Less Sugar,Normal Sugar|Fresh Milk,Oat Milk (+8000)', true, false, now],
      ['MNU-007', 'ESP-04', 'Manual Brew V60 Pour Over', 'Espresso', 32000, 11000, 40, 'Seduhan manual single origin pilihan barista dengan notes floral & citrus.', '', 'Hot,Japanese Iced', true, false, now],
      ['MNU-008', 'NON-01', 'Ceremonial Uji Matcha Latte', 'Non-Coffee', 33000, 13500, 55, 'Matcha Jepang grade ceremonial dengan susu segar dingin/hangat.', '', 'Iced,Hot|Normal Sugar,Less Sugar|Fresh Milk,Oat Milk (+8000)', true, true, now],
      ['MNU-009', 'NON-02', 'Belgian Dark Chocolate', 'Non-Coffee', 30000, 11500, 60, 'Cokelat hitam Belgia 70% kaya rasa dengan tekstur pekat lembut.', '', 'Iced,Hot|Normal Sugar,Less Sugar', true, false, now],
      ['MNU-010', 'NON-03', 'Red Velvet Cream Cheese', 'Non-Coffee', 31000, 11800, 45, 'Minuman red velvet lembut dengan topping cheese foam gurih.', '', 'Iced,Hot|Normal Sugar,Less Sugar', true, false, now],
      ['MNU-011', 'TEA-01', 'Lychee Rose Artisanal Tea', 'Tea', 25000, 8200, 70, 'Teh hitam premium dengan kelopak mawar & buah leci segar.', '', 'Iced,Hot|Normal Sugar,Less Sugar', true, false, now],
      ['MNU-012', 'TEA-02', 'Peach Sunset Sparkling Tea', 'Tea', 27000, 9000, 65, 'Teh buah persik menyegarkan dengan sentuhan soda ringan & mint.', '', 'Iced|Normal Sugar,Less Sugar', true, false, now],
      ['MNU-013', 'PAS-01', 'French Butter Croissant', 'Pastry', 26000, 11000, 30, 'Croissant flaky renyah dipanggang segar setiap pagi dengan mentega Prancis.', '', 'Hangat,Normal', true, true, now],
      ['MNU-014', 'PAS-02', 'Burnt Basque Cheesecake', 'Pastry', 38000, 16500, 24, 'Cheesecake lembut lumer dengan karamelisasi klasik di bagian atas.', '', 'Original,With Berry Compote (+5000)', true, true, now],
      ['MNU-015', 'PAS-03', 'Pain au Chocolat', 'Pastry', 28000, 12000, 25, 'Pastry lapis mentega berisi batang cokelat gelap Prancis.', '', 'Hangat,Normal', true, false, now],
      ['MNU-016', 'FOD-01', 'Truffle Parmesan Fries', 'Food', 32000, 12500, 45, 'Kentang goreng renyah dengan minyak truffle, keju parmesan & aioli.', '', 'Regular,Extra Aioli (+5000)', true, false, now],
      ['MNU-017', 'FOD-02', 'Creamy Chicken Carbonara', 'Food', 46000, 20000, 30, 'Spaghetti al dente dengan smoked chicken, saus krim parmesan & lada hitam.', '', 'Normal,Pedas', true, false, now],
      ['MNU-018', 'FOD-03', 'Rice Bowl Chicken Sambal Matah', 'Food', 42000, 18000, 35, 'Nasi hangat, ayam crispy, telur setengah matang & sambal matah segar Bali.', '', 'Sedang,Pedas,Tidak Pedas', true, true, now]
    ];
  }
  if (sheetName === 'Member') {
    return [
      ['MBR-001', 'Nadia Kusuma', '081290001122', 'nadia@example.com', 145, 1450000, 14, 'Gold', now],
      ['MBR-002', 'Raka Pratama', '081388776655', 'raka@example.com', 62, 620000, 7, 'Silver', now]
    ];
  }
  if (sheetName === 'Pengaturan') {
    return [
      ['cafe_name', 'CAFE CL', now],
      ['tagline', 'Artisanal Coffee & Roastery', now],
      ['address', 'Jl. Aroma Kopi No. 27, Kota Anda', now],
      ['phone', '0812-3456-7890', now],
      ['instagram', '@cafecl.official', now],
      ['tax_percent', '10', now],
      ['service_percent', '0', now],
      ['receipt_footer', 'Terima kasih telah menikmati kopi di CAFE CL. Sampai jumpa kembali!', now],
      ['paper_size', '58mm', now],
      ['currency', 'Rp', now]
    ];
  }
  return [];
}

// ============================================================================
// GENERIC SHEET DATA ACCESSORS
// ============================================================================

function readSheetObjects(sheetName) {
  const ss = getSS();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map((h) => String(h).trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every((cell) => cell === '' || cell === null)) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      let val = row[idx];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
      }
      obj[h] = val;
    });
    rows.push(obj);
  }
  return rows;
}

function upsertRowByKey(sheetName, keyCol, record) {
  const ss = getSS();
  const sheet = ss.getSheetByName(sheetName);
  const headers = SCHEMA[sheetName];
  const keyIndex = headers.indexOf(keyCol);
  if (keyIndex === -1) throw new Error('Kolom kunci tidak ditemukan: ' + keyCol);

  const rowValues = headers.map((h) => (record[h] !== undefined && record[h] !== null ? record[h] : ''));
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyIndex]) === String(record[keyCol])) {
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([rowValues]);
      return { updated: true, row: i + 1 };
    }
  }
  sheet.appendRow(rowValues);
  return { inserted: true, row: sheet.getLastRow() };
}

function deleteRowByKey(sheetName, keyCol, keyVal) {
  const ss = getSS();
  const sheet = ss.getSheetByName(sheetName);
  const headers = SCHEMA[sheetName];
  const keyIndex = headers.indexOf(keyCol);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][keyIndex]) === String(keyVal)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

// ============================================================================
// HTTP ENTRYPOINTS (doGet & doPost)
// ============================================================================

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'ping';

    if (action === 'init' || action === 'initSheets') {
      return jsonOut(ensureDatabaseSetup(true));
    }

    // Otomatis pastikan sheet & header tersedia saat akses pertama
    ensureDatabaseSetup(true);

    if (action === 'sync' || action === 'getAll') {
      return jsonOut(handleSyncAll());
    }

    return jsonOut({
      ok: true,
      app: 'CAFE CL Backend',
      spreadsheetId: SPREADSHEET_ID,
      status: 'READY',
      serverTime: nowISO(),
      sheets: Object.keys(SCHEMA)
    });
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    ensureDatabaseSetup(true);

    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const body = JSON.parse(raw);
    const action = body.action || '';
    const data = body.data || {};

    switch (action) {
      case 'ping':
        return jsonOut({ ok: true, status: 'READY', serverTime: nowISO(), spreadsheetId: SPREADSHEET_ID });

      case 'initSheets':
        return jsonOut(ensureDatabaseSetup(true));

      case 'syncAll':
        return jsonOut(handleSyncAll());

      case 'login':
        return jsonOut(handleLogin(data));

      case 'saveOrder':
        return jsonOut(handleSaveOrder(data));

      case 'updateOrderStatus':
        return jsonOut(handleUpdateOrderStatus(data));

      case 'voidOrder':
        return jsonOut(handleVoidOrder(data));

      case 'saveMenu':
        return jsonOut(handleSaveMenu(data));

      case 'deleteMenu':
        return jsonOut({ ok: deleteRowByKey('Menu', 'id', data.id) });

      case 'saveTable':
        return jsonOut(handleSaveTable(data));

      case 'deleteTable':
        return jsonOut({ ok: deleteRowByKey('Meja', 'id', data.id) });

      case 'saveExpense':
        return jsonOut(handleSaveExpense(data));

      case 'deleteExpense':
        return jsonOut({ ok: deleteRowByKey('Pengeluaran', 'id', data.id) });

      case 'saveShift':
        return jsonOut(handleSaveShift(data));

      case 'saveMember':
        return jsonOut(handleSaveMember(data));

      case 'deleteMember':
        return jsonOut({ ok: deleteRowByKey('Member', 'id', data.id) });

      case 'saveUser':
        return jsonOut(handleSaveUser(data));

      case 'deleteUser':
        return jsonOut({ ok: deleteRowByKey('Users', 'id', data.id) });

      case 'saveSettings':
        return jsonOut(handleSaveSettings(data));

      default:
        return jsonOut({ ok: false, error: 'Action tidak dikenali: ' + action });
    }
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ============================================================================
// BUSINESS LOGIC HANDLERS
// ============================================================================

function handleSyncAll() {
  const settingsArr = readSheetObjects('Pengaturan');
  const settingsObj = {};
  settingsArr.forEach((r) => { settingsObj[r.key] = r.value; });

  const menu = readSheetObjects('Menu').map((m) => ({
    ...m,
    harga: toNum(m.harga),
    hpp: toNum(m.hpp),
    stok: toNum(m.stok),
    tersedia: parseBool(m.tersedia),
    favorit: parseBool(m.favorit)
  }));

  const tables = readSheetObjects('Meja').map((t) => ({
    ...t,
    kapasitas: toNum(t.kapasitas)
  }));

  const orders = readSheetObjects('Pesanan').map((o) => {
    let items = [];
    try { items = JSON.parse(o.items_json || '[]'); } catch (e) {}
    return {
      ...o,
      items: items,
      subtotal: toNum(o.subtotal),
      diskon: toNum(o.diskon),
      pajak: toNum(o.pajak),
      service_charge: toNum(o.service_charge),
      total: toNum(o.total),
      bayar: toNum(o.bayar),
      kembalian: toNum(o.kembalian)
    };
  });

  const expenses = readSheetObjects('Pengeluaran').map((x) => ({
    ...x,
    nominal: toNum(x.nominal)
  }));

  const shifts = readSheetObjects('Shift_Kasir').map((s) => ({
    ...s,
    modal_awal: toNum(s.modal_awal),
    total_tunai: toNum(s.total_tunai),
    total_non_tunai: toNum(s.total_non_tunai),
    kas_aktual: toNum(s.kas_aktual),
    selisih: toNum(s.selisih)
  }));

  const members = readSheetObjects('Member').map((m) => ({
    ...m,
    poin: toNum(m.poin),
    total_belanja: toNum(m.total_belanja),
    kunjungan: toNum(m.kunjungan)
  }));

  const users = readSheetObjects('Users').map((u) => ({
    ...u,
    aktif: parseBool(u.aktif)
  }));

  return {
    ok: true,
    serverTime: nowISO(),
    spreadsheetId: SPREADSHEET_ID,
    data: {
      settings: settingsObj,
      users: users,
      menu: menu,
      tables: tables,
      orders: orders,
      expenses: expenses,
      shifts: shifts,
      members: members
    }
  };
}

function handleLogin(data) {
  const users = readSheetObjects('Users');
  const pin = String(data.pin || '').trim();
  const username = String(data.username || '').trim().toLowerCase();
  const password = String(data.password || '').trim();

  let found = null;
  if (pin) {
    found = users.find((u) => String(u.pin) === pin && parseBool(u.aktif));
  } else {
    found = users.find(
      (u) => String(u.username).toLowerCase() === username && String(u.password) === password && parseBool(u.aktif)
    );
  }

  if (!found) {
    return { ok: false, error: 'Username/Password atau PIN tidak sesuai, atau akun non-aktif.' };
  }

  return {
    ok: true,
    user: {
      id: found.id,
      username: found.username,
      nama: found.nama,
      role: found.role
    }
  };
}

function handleSaveOrder(order) {
  const now = nowISO();
  const id = order.id || ('ORD-' + Date.now());
  const invoice = order.no_invoice || ('INV-' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss'));
  const items = Array.isArray(order.items) ? order.items : [];

  const record = {
    id: id,
    no_invoice: invoice,
    tanggal: order.tanggal || todayStr(),
    waktu: order.waktu || timeStr(),
    kasir: order.kasir || 'Kasir',
    pelanggan: order.pelanggan || 'Tamu Walk-in',
    tipe_order: order.tipe_order || 'Dine-In',
    meja: order.meja || '-',
    items_json: JSON.stringify(items),
    subtotal: toNum(order.subtotal),
    diskon: toNum(order.diskon),
    pajak: toNum(order.pajak),
    service_charge: toNum(order.service_charge),
    total: toNum(order.total),
    metode_bayar: order.metode_bayar || 'Tunai',
    bayar: toNum(order.bayar),
    kembalian: toNum(order.kembalian),
    status_bayar: order.status_bayar || 'Lunas',
    status_dapur: order.status_dapur || 'Menunggu',
    catatan: order.catatan || '',
    updated_at: now
  };

  const res = upsertRowByKey('Pesanan', 'id', record);

  // Simpan detail item ke sheet Detail_Pesanan (hanya saat insert pesanan baru)
  if (res.inserted && items.length > 0) {
    const detailSheet = getSS().getSheetByName('Detail_Pesanan');
    const detailRows = items.map((it, idx) => {
      const qty = toNum(it.qty || 1);
      const harga = toNum(it.harga || 0);
      const hpp = toNum(it.hpp || 0);
      const sub = qty * harga;
      return [
        id + '-' + (idx + 1),
        invoice,
        record.tanggal,
        it.menu_id || it.id || '',
        it.nama || '',
        it.kategori || '',
        it.varian || '',
        it.catatan || '',
        qty,
        harga,
        hpp,
        sub,
        sub - (qty * hpp)
      ];
    });
    detailSheet.getRange(detailSheet.getLastRow() + 1, 1, detailRows.length, SCHEMA.Detail_Pesanan.length).setValues(detailRows);

    // Kurangi stok menu secara otomatis
    const menuSheet = getSS().getSheetByName('Menu');
    const menuData = menuSheet.getDataRange().getValues();
    const idIdx = SCHEMA.Menu.indexOf('id');
    const stokIdx = SCHEMA.Menu.indexOf('stok');
    items.forEach((it) => {
      const targetId = String(it.menu_id || it.id || '');
      for (let r = 1; r < menuData.length; r++) {
        if (String(menuData[r][idIdx]) === targetId) {
          const newStok = Math.max(0, toNum(menuData[r][stokIdx]) - toNum(it.qty || 1));
          menuSheet.getRange(r + 1, stokIdx + 1).setValue(newStok);
          break;
        }
      }
    });
  }

  // Update status Meja otomatis jika Dine-In
  if (record.tipe_order === 'Dine-In' && record.meja && record.meja !== '-') {
    const mejaSheet = getSS().getSheetByName('Meja');
    const mejaData = mejaSheet.getDataRange().getValues();
    const namaIdx = SCHEMA.Meja.indexOf('nama');
    const statusIdx = SCHEMA.Meja.indexOf('status');
    const orderIdx = SCHEMA.Meja.indexOf('order_aktif');
    for (let r = 1; r < mejaData.length; r++) {
      if (String(mejaData[r][namaIdx]) === String(record.meja)) {
        const nextStatus = (record.status_bayar === 'Open Bill') ? 'Terisi' : (record.status_dapur === 'Selesai' ? 'Tersedia' : 'Terisi');
        mejaSheet.getRange(r + 1, statusIdx + 1).setValue(nextStatus);
        mejaSheet.getRange(r + 1, orderIdx + 1).setValue(nextStatus === 'Terisi' ? invoice : '');
        break;
      }
    }
  }

  // Update poin Member otomatis jika ada member_id & status Lunas
  if (order.member_id && record.status_bayar === 'Lunas' && res.inserted) {
    const memberSheet = getSS().getSheetByName('Member');
    const mData = memberSheet.getDataRange().getValues();
    const mIdIdx = SCHEMA.Member.indexOf('id');
    const poinIdx = SCHEMA.Member.indexOf('poin');
    const totIdx = SCHEMA.Member.indexOf('total_belanja');
    const kunIdx = SCHEMA.Member.indexOf('kunjungan');
    const tierIdx = SCHEMA.Member.indexOf('tier');
    for (let r = 1; r < mData.length; r++) {
      if (String(mData[r][mIdIdx]) === String(order.member_id)) {
        const addPoin = Math.floor(record.total / 10000);
        const newPoin = toNum(mData[r][poinIdx]) + addPoin;
        const newTot = toNum(mData[r][totIdx]) + record.total;
        const newKun = toNum(mData[r][kunIdx]) + 1;
        const tier = newTot >= 3000000 ? 'Signature' : newTot >= 1200000 ? 'Gold' : newTot >= 400000 ? 'Silver' : 'Bronze';
        memberSheet.getRange(r + 1, poinIdx + 1).setValue(newPoin);
        memberSheet.getRange(r + 1, totIdx + 1).setValue(newTot);
        memberSheet.getRange(r + 1, kunIdx + 1).setValue(newKun);
        memberSheet.getRange(r + 1, tierIdx + 1).setValue(tier);
        break;
      }
    }
  }

  return { ok: true, id: id, no_invoice: invoice, order: { ...record, items: items } };
}

function handleUpdateOrderStatus(data) {
  const ss = getSS();
  const sheet = ss.getSheetByName('Pesanan');
  const rows = sheet.getDataRange().getValues();
  const idIdx = SCHEMA.Pesanan.indexOf('id');
  const dapurIdx = SCHEMA.Pesanan.indexOf('status_dapur');
  const bayarIdx = SCHEMA.Pesanan.indexOf('status_bayar');
  const mejaIdx = SCHEMA.Pesanan.indexOf('meja');
  const updIdx = SCHEMA.Pesanan.indexOf('updated_at');

  for (let r = 1; r < rows.length; r++) {
    if (String(rows[r][idIdx]) === String(data.id)) {
      if (data.status_dapur) sheet.getRange(r + 1, dapurIdx + 1).setValue(data.status_dapur);
      if (data.status_bayar) sheet.getRange(r + 1, bayarIdx + 1).setValue(data.status_bayar);
      sheet.getRange(r + 1, updIdx + 1).setValue(nowISO());

      // Jika selesai dan lunas, kosongkan meja otomatis
      const finalDapur = data.status_dapur || rows[r][dapurIdx];
      const finalBayar = data.status_bayar || rows[r][bayarIdx];
      const mejaNama = rows[r][mejaIdx];
      if (finalDapur === 'Selesai' && finalBayar === 'Lunas' && mejaNama && mejaNama !== '-') {
        freeTableByName(mejaNama);
      }
      return { ok: true };
    }
  }
  return { ok: false, error: 'Pesanan tidak ditemukan' };
}

function handleVoidOrder(data) {
  return handleUpdateOrderStatus({ id: data.id, status_bayar: 'Dibatalkan', status_dapur: 'Dibatalkan' });
}

function freeTableByName(mejaNama) {
  const sheet = getSS().getSheetByName('Meja');
  const rows = sheet.getDataRange().getValues();
  const namaIdx = SCHEMA.Meja.indexOf('nama');
  const statusIdx = SCHEMA.Meja.indexOf('status');
  const orderIdx = SCHEMA.Meja.indexOf('order_aktif');
  for (let r = 1; r < rows.length; r++) {
    if (String(rows[r][namaIdx]) === String(mejaNama)) {
      sheet.getRange(r + 1, statusIdx + 1).setValue('Tersedia');
      sheet.getRange(r + 1, orderIdx + 1).setValue('');
      break;
    }
  }
}

function handleSaveMenu(m) {
  const record = {
    id: m.id || ('MNU-' + Date.now()),
    kode: m.kode || ('MN-' + Math.floor(100 + Math.random() * 900)),
    nama: m.nama || 'Menu Baru',
    kategori: m.kategori || 'Signature',
    harga: toNum(m.harga),
    hpp: toNum(m.hpp),
    stok: toNum(m.stok),
    deskripsi: m.deskripsi || '',
    foto_url: m.foto_url || '',
    varian: m.varian || 'Iced,Hot',
    tersedia: m.tersedia !== false,
    favorit: Boolean(m.favorit),
    updated_at: nowISO()
  };
  upsertRowByKey('Menu', 'id', record);
  return { ok: true, item: record };
}

function handleSaveTable(t) {
  const record = {
    id: t.id || ('TBL-' + Date.now()),
    nomor: t.nomor || '00',
    nama: t.nama || ('Meja ' + (t.nomor || '')),
    area: t.area || 'Indoor AC',
    kapasitas: toNum(t.kapasitas || 4),
    status: t.status || 'Tersedia',
    order_aktif: t.order_aktif || '',
    updated_at: nowISO()
  };
  upsertRowByKey('Meja', 'id', record);
  return { ok: true, item: record };
}

function handleSaveExpense(x) {
  const record = {
    id: x.id || ('EXP-' + Date.now()),
    tanggal: x.tanggal || todayStr(),
    kategori: x.kategori || 'Bahan Baku',
    deskripsi: x.deskripsi || '',
    nominal: toNum(x.nominal),
    metode: x.metode || 'Tunai',
    dicatat_oleh: x.dicatat_oleh || 'Owner',
    catatan: x.catatan || '',
    created_at: x.created_at || nowISO()
  };
  upsertRowByKey('Pengeluaran', 'id', record);
  return { ok: true, item: record };
}

function handleSaveShift(s) {
  const record = {
    id: s.id || ('SHF-' + Date.now()),
    kasir: s.kasir || 'Kasir',
    buka_waktu: s.buka_waktu || nowISO(),
    tutup_waktu: s.tutup_waktu || '',
    modal_awal: toNum(s.modal_awal),
    total_tunai: toNum(s.total_tunai),
    total_non_tunai: toNum(s.total_non_tunai),
    kas_aktual: toNum(s.kas_aktual),
    selisih: toNum(s.selisih),
    status: s.status || 'Buka',
    catatan: s.catatan || ''
  };
  upsertRowByKey('Shift_Kasir', 'id', record);
  return { ok: true, item: record };
}

function handleSaveMember(m) {
  const record = {
    id: m.id || ('MBR-' + Date.now()),
    nama: m.nama || 'Member',
    telepon: m.telepon || '',
    email: m.email || '',
    poin: toNum(m.poin),
    total_belanja: toNum(m.total_belanja),
    kunjungan: toNum(m.kunjungan),
    tier: m.tier || 'Bronze',
    created_at: m.created_at || nowISO()
  };
  upsertRowByKey('Member', 'id', record);
  return { ok: true, item: record };
}

function handleSaveUser(u) {
  const record = {
    id: u.id || ('USR-' + Date.now()),
    username: String(u.username || '').trim().toLowerCase(),
    password: u.password || '123456',
    nama: u.nama || 'Staff Cafe',
    role: u.role || 'Kasir',
    pin: String(u.pin || '0000'),
    aktif: u.aktif !== false,
    created_at: u.created_at || nowISO()
  };
  upsertRowByKey('Users', 'id', record);
  return { ok: true, item: record };
}

function handleSaveSettings(settingsObj) {
  const now = nowISO();
  Object.keys(settingsObj || {}).forEach((k) => {
    upsertRowByKey('Pengaturan', 'key', {
      key: k,
      value: String(settingsObj[k]),
      updated_at: now
    });
  });
  return { ok: true };
}

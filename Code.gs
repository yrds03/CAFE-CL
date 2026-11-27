/**
 * ============================================================================
 * CAFE CL — Google Apps Script Backend (Code.gs) v1.2.0
 * ============================================================================
 * Mendukung:
 * - Dynamic Client Spreadsheet ID (pindah ke Google Sheet klien langsung dari aplikasi!)
 * - Auto-generate 10 sheet + header bergaya & data awal otomatis
 * - Opsi migrasi data (Menu, Meja, Roles, Staff, Member, Pengaturan) ke Sheet Klien
 * - Void pesanan otomatis mengembalikan stok menu & mengosongkan meja
 * - Upsert & delete aman dengan LockService
 * ============================================================================
 */

const DEFAULT_SPREADSHEET_ID = '1fmNy_guFg-obp4JdVrNsQsCbbXPGp8IK7nPetVlCmTQ';
const TIMEZONE = 'Asia/Jakarta';

// Request-scoped Spreadsheet ID agar setiap request aman menargetkan Sheet Klien yang tepat
let REQUEST_SPREADSHEET_ID = null;

const SCHEMA = {
  Roles: [
    'id', 'nama', 'deskripsi', 'akses_json', 'is_system', 'created_at'
  ],
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
// DYNAMIC SPREADSHEET RESOLVER
// ============================================================================

function extractSpreadsheetId(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const urlMatch = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i) || s.match(/\/d\/([a-zA-Z0-9-_]+)/i);
  if (urlMatch && urlMatch[1]) return urlMatch[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return '';
}

function getActiveSpreadsheetId() {
  if (REQUEST_SPREADSHEET_ID) return REQUEST_SPREADSHEET_ID;
  try {
    const saved = PropertiesService.getScriptProperties().getProperty('ACTIVE_SPREADSHEET_ID');
    if (saved && saved.trim()) return saved.trim();
  } catch (e) {}
  return DEFAULT_SPREADSHEET_ID;
}

function getSS() {
  const id = getActiveSpreadsheetId();
  try {
    return SpreadsheetApp.openById(id);
  } catch (err) {
    throw new Error(
      'Tidak dapat membuka Google Sheet (ID: ' + id + '). Pastikan link benar dan akun Google pemilik Apps Script sudah diberi akses Editor pada Spreadsheet klien.'
    );
  }
}

function nowISO() { return Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss"); }
function todayStr() { return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd'); }
function timeStr() { return Utilities.formatDate(new Date(), TIMEZONE, 'HH:mm:ss'); }
function jsonOut(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function parseBool(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1'; }
function toNum(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

// ============================================================================
// AUTO-GENERATE SHEETS, STYLED HEADERS & CLIENT MIGRATION
// ============================================================================

function setupDatabase() {
  REQUEST_SPREADSHEET_ID = null;
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

    const lastCol = Math.max(sheet.getLastColumn(), headers.length);
    const existingHeader = sheet.getLastRow() >= 1
      ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim())
      : [];

    const headerMismatch = headers.some((h, idx) => existingHeader[idx] !== h);
    if (isNew || sheet.getLastRow() === 0 || headerMismatch) {
      if (sheet.getLastRow() === 0) sheet.appendRow(headers);
      else sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      styleHeaderRow(sheet, headers.length);
      if (!isNew) repairedHeaders.push(sheetName);
    }

    if (seedIfEmpty && sheet.getLastRow() <= 1) {
      const seedRows = getSeedRows(sheetName, now);
      if (seedRows && seedRows.length > 0) {
        sheet.getRange(2, 1, seedRows.length, headers.length).setValues(seedRows);
        seededSheets.push(sheetName);
      }
    }
  });

  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
    try { ss.deleteSheet(defaultSheet); } catch (e) {}
  }

  return {
    ok: true,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    sheets: Object.keys(SCHEMA),
    createdSheets: createdSheets,
    repairedHeaders: repairedHeaders,
    seededSheets: seededSheets,
    timestamp: now
  };
}

function handleInitAndMigrate(data) {
  const incomingId = extractSpreadsheetId(data.spreadsheetUrl || data.spreadsheetId || REQUEST_SPREADSHEET_ID);
  if (incomingId) {
    REQUEST_SPREADSHEET_ID = incomingId;
  }

  const hasMigration = Boolean(data && data.migrateData);
  const result = ensureDatabaseSetup(!hasMigration);

  // Simpan sebagai Spreadsheet aktif di ScriptProperties jika diminta
  if (incomingId && data.saveAsActive !== false) {
    try {
      PropertiesService.getScriptProperties().setProperty('ACTIVE_SPREADSHEET_ID', incomingId);
    } catch (e) {}
  }

  // Migrasi data master saat ini ke Google Sheet klien jika dicentang
  if (hasMigration) {
    const mig = data.migrateData;
    if (Array.isArray(mig.roles) && mig.roles.length) {
      mig.roles.forEach((r) => handleSaveRole(r));
    }
    if (Array.isArray(mig.users) && mig.users.length) {
      mig.users.forEach((u) => handleSaveUser(u));
    }
    if (Array.isArray(mig.menu) && mig.menu.length) {
      mig.menu.forEach((m) => handleSaveMenu(m));
    }
    if (Array.isArray(mig.tables) && mig.tables.length) {
      mig.tables.forEach((t) => handleSaveTable({ ...t, status: 'Tersedia', order_aktif: '' }));
    }
    if (Array.isArray(mig.members) && mig.members.length) {
      mig.members.forEach((m) => handleSaveMember(m));
    }
    if (mig.settings && typeof mig.settings === 'object') {
      handleSaveSettings(mig.settings);
    }
    // Pastikan sheet default yang tidak termasuk migrasi tetap punya seed minimal jika kosong
    ensureDatabaseSetup(true);
    result.migrated = true;
  }

  return result;
}

function styleHeaderRow(sheet, colCount) {
  const headerRange = sheet.getRange(1, 1, 1, colCount);
  headerRange
    .setBackground('#4A516F')
    .setFontColor('#F4F2EA')
    .setFontWeight('bold')
    .setFontFamily('Arial')
    .setFontSize(10)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 32);
  try { sheet.autoResizeColumns(1, colCount); } catch (e) {}
}

function getSeedRows(sheetName, now) {
  if (sheetName === 'Roles') {
    return [
      ['ROL-OWNER', 'Owner', 'Akses penuh ke seluruh fitur kasir, laporan, staff, role & pengaturan sistem.', JSON.stringify(['dashboard', 'pos', 'tables', 'history', 'menu', 'finance', 'members', 'void_order', 'settings', 'manage_staff']), true, now],
      ['ROL-MANAGER', 'Supervisor', 'Akses operasional, kelola menu, keuangan, shift & void transaksi.', JSON.stringify(['dashboard', 'pos', 'tables', 'history', 'menu', 'finance', 'members', 'void_order']), false, now],
      ['ROL-KASIR', 'Kasir', 'Fokus layanan kasir POS, meja cafe, riwayat struk, member & shift kasir.', JSON.stringify(['dashboard', 'pos', 'tables', 'history', 'members', 'finance']), true, now]
    ];
  }
  if (sheetName === 'Users') {
    return [
      ['USR-001', 'owner', 'owner123', 'Owner NOUS', 'Owner', '1111', true, now],
      ['USR-002', 'kasir', 'kasir123', 'Kasir Utama', 'Kasir', '2222', true, now]
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
      ['MNU-007', 'ESP-04', 'Manual Brew V60 Pour Over', 'Espresso', 32000, 11000, 40, 'Seduhan manual single origin pilihan dengan notes floral & citrus.', '', 'Hot,Japanese Iced', true, false, now],
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
      ['cafe_name', 'NOUS', now],
      ['tagline', 'Coffee & Eatery', now],
      ['address', 'Jl. Aroma Kopi No. 27, Kota Anda', now],
      ['phone', '0812-3456-7890', now],
      ['instagram', '@nous.coffee', now],
      ['tax_percent', '10', now],
      ['service_percent', '0', now],
      ['receipt_footer', 'Terima kasih telah menikmati kopi di NOUS. Sampai jumpa kembali!', now],
      ['paper_size', '58mm', now],
      ['auto_print_bt', 'false', now],
      ['currency', 'Rp', now]
    ];
  }
  return [];
}

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
      if (val instanceof Date) val = Utilities.formatDate(val, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
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
// HTTP ENTRYPOINTS
// ============================================================================

function doGet(e) {
  try {
    const paramSheet = e && e.parameter ? (e.parameter.spreadsheetId || e.parameter.sheetId) : '';
    REQUEST_SPREADSHEET_ID = extractSpreadsheetId(paramSheet) || null;

    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'ping';
    if (action === 'init' || action === 'initSheets') return jsonOut(ensureDatabaseSetup(true));
    ensureDatabaseSetup(true);
    if (action === 'sync' || action === 'getAll') return jsonOut(handleSyncAll());
    const ss = getSS();
    return jsonOut({
      ok: true,
      app: 'CAFE CL Cashier Backend',
      status: 'READY',
      spreadsheetId: ss.getId(),
      spreadsheetName: ss.getName(),
      serverTime: nowISO(),
      sheets: Object.keys(SCHEMA)
    });
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  } finally {
    REQUEST_SPREADSHEET_ID = null;
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);

    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const body = JSON.parse(raw);
    const action = body.action || '';
    const data = body.data || {};

    // Deteksi target Spreadsheet Klien (jika dikirim dari aplikasi)
    const targetSheetId = extractSpreadsheetId(body.spreadsheetId || data.spreadsheetUrl || data.spreadsheetId);
    REQUEST_SPREADSHEET_ID = targetSheetId || null;

    if (action === 'ping') {
      const ss = getSS();
      return jsonOut({
        ok: true,
        status: 'READY',
        spreadsheetId: ss.getId(),
        spreadsheetName: ss.getName(),
        serverTime: nowISO()
      });
    }

    if (action === 'initSheets' || action === 'switchSpreadsheet') {
      return jsonOut(handleInitAndMigrate(data));
    }

    ensureDatabaseSetup(true);

    switch (action) {
      case 'syncAll': return jsonOut(handleSyncAll());
      case 'login': return jsonOut(handleLogin(data));
      case 'saveOrder': return jsonOut(handleSaveOrder(data));
      case 'updateOrderStatus': return jsonOut(handleUpdateOrderStatus(data));
      case 'voidOrder': return jsonOut(handleVoidOrder(data));
      case 'saveMenu': return jsonOut(handleSaveMenu(data));
      case 'deleteMenu': return jsonOut({ ok: deleteRowByKey('Menu', 'id', data.id) });
      case 'saveTable': return jsonOut(handleSaveTable(data));
      case 'deleteTable': return jsonOut({ ok: deleteRowByKey('Meja', 'id', data.id) });
      case 'saveExpense': return jsonOut(handleSaveExpense(data));
      case 'deleteExpense': return jsonOut({ ok: deleteRowByKey('Pengeluaran', 'id', data.id) });
      case 'saveShift': return jsonOut(handleSaveShift(data));
      case 'saveMember': return jsonOut(handleSaveMember(data));
      case 'deleteMember': return jsonOut({ ok: deleteRowByKey('Member', 'id', data.id) });
      case 'saveUser': return jsonOut(handleSaveUser(data));
      case 'deleteUser': return jsonOut({ ok: deleteRowByKey('Users', 'id', data.id) });
      case 'saveRole': return jsonOut(handleSaveRole(data));
      case 'deleteRole': return jsonOut({ ok: deleteRowByKey('Roles', 'id', data.id) });
      case 'saveSettings': return jsonOut(handleSaveSettings(data));
      default: return jsonOut({ ok: false, error: 'Action tidak dikenali: ' + action });
    }
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  } finally {
    REQUEST_SPREADSHEET_ID = null;
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ============================================================================
// BUSINESS LOGIC HANDLERS
// ============================================================================

function handleSyncAll() {
  const ss = getSS();
  const settingsArr = readSheetObjects('Pengaturan');
  const settingsObj = {};
  settingsArr.forEach((r) => { settingsObj[r.key] = r.value; });

  const roles = readSheetObjects('Roles').map((r) => {
    let akses = [];
    try { akses = JSON.parse(r.akses_json || '[]'); } catch (e) {}
    return {
      id: r.id,
      nama: r.nama,
      deskripsi: r.deskripsi || '',
      akses: akses,
      is_system: parseBool(r.is_system)
    };
  });

  const menu = readSheetObjects('Menu').map((m) => ({
    ...m,
    harga: toNum(m.harga),
    hpp: toNum(m.hpp),
    stok: toNum(m.stok),
    tersedia: parseBool(m.tersedia),
    favorit: parseBool(m.favorit)
  }));

  const tables = readSheetObjects('Meja').map((t) => ({ ...t, kapasitas: toNum(t.kapasitas) }));

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

  const expenses = readSheetObjects('Pengeluaran').map((x) => ({ ...x, nominal: toNum(x.nominal) }));
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
  const users = readSheetObjects('Users').map((u) => ({ ...u, aktif: parseBool(u.aktif) }));

  return {
    ok: true,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    serverTime: nowISO(),
    data: { settings: settingsObj, roles, users, menu, tables, orders, expenses, shifts, members }
  };
}

function handleLogin(data) {
  const users = readSheetObjects('Users');
  const pin = String(data.pin || '').trim();
  const username = String(data.username || '').trim().toLowerCase();
  const password = String(data.password || '').trim();

  const found = pin
    ? users.find((u) => String(u.pin) === pin && parseBool(u.aktif))
    : users.find((u) => String(u.username).toLowerCase() === username && String(u.password) === password && parseBool(u.aktif));

  if (!found) return { ok: false, error: 'Username/Password atau PIN tidak sesuai.' };
  return { ok: true, user: { id: found.id, username: found.username, nama: found.nama, role: found.role } };
}

function adjustMenuStock(items, direction) {
  const menuSheet = getSS().getSheetByName('Menu');
  const menuData = menuSheet.getDataRange().getValues();
  const idIdx = SCHEMA.Menu.indexOf('id');
  const stokIdx = SCHEMA.Menu.indexOf('stok');
  (items || []).forEach((it) => {
    const targetId = String(it.menu_id || it.id || '');
    for (let r = 1; r < menuData.length; r++) {
      if (String(menuData[r][idIdx]) === targetId) {
        const nextStok = Math.max(0, toNum(menuData[r][stokIdx]) + direction * toNum(it.qty || 1));
        menuSheet.getRange(r + 1, stokIdx + 1).setValue(nextStok);
        menuData[r][stokIdx] = nextStok;
        break;
      }
    }
  });
}

function handleSaveOrder(order) {
  const now = nowISO();
  const id = order.id || ('ORD-' + Date.now());
  const invoice = order.no_invoice || ('INV-' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd-HHmmss'));
  const items = Array.isArray(order.items) ? order.items : [];

  const record = {
    id,
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
    status_dapur: 'Selesai',
    catatan: order.catatan || '',
    updated_at: now
  };

  const res = upsertRowByKey('Pesanan', 'id', record);

  if (res.inserted && items.length > 0) {
    const detailSheet = getSS().getSheetByName('Detail_Pesanan');
    const detailRows = items.map((it, idx) => {
      const qty = toNum(it.qty || 1);
      const harga = toNum(it.harga || 0);
      const hpp = toNum(it.hpp || 0);
      const sub = qty * harga;
      return [
        id + '-' + (idx + 1), invoice, record.tanggal,
        it.menu_id || it.id || '', it.nama || '', it.kategori || '',
        it.varian || '', it.catatan || '', qty, harga, hpp, sub, sub - (qty * hpp)
      ];
    });
    detailSheet.getRange(detailSheet.getLastRow() + 1, 1, detailRows.length, SCHEMA.Detail_Pesanan.length).setValues(detailRows);
    adjustMenuStock(items, -1);
  }

  if (record.tipe_order === 'Dine-In' && record.meja && record.meja !== '-') {
    const mejaSheet = getSS().getSheetByName('Meja');
    const mejaData = mejaSheet.getDataRange().getValues();
    const namaIdx = SCHEMA.Meja.indexOf('nama');
    const statusIdx = SCHEMA.Meja.indexOf('status');
    const orderIdx = SCHEMA.Meja.indexOf('order_aktif');
    for (let r = 1; r < mejaData.length; r++) {
      if (String(mejaData[r][namaIdx]) === String(record.meja)) {
        const isOpenBill = record.status_bayar === 'Open Bill';
        mejaSheet.getRange(r + 1, statusIdx + 1).setValue(isOpenBill ? 'Terisi' : 'Tersedia');
        mejaSheet.getRange(r + 1, orderIdx + 1).setValue(isOpenBill ? invoice : '');
        break;
      }
    }
  }

  if (order.member_id && record.status_bayar === 'Lunas') {
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

  return { ok: true, id, no_invoice: invoice, order: { ...record, items } };
}

function handleUpdateOrderStatus(data) {
  const sheet = getSS().getSheetByName('Pesanan');
  const rows = sheet.getDataRange().getValues();
  const idIdx = SCHEMA.Pesanan.indexOf('id');
  const bayarIdx = SCHEMA.Pesanan.indexOf('status_bayar');
  const mejaIdx = SCHEMA.Pesanan.indexOf('meja');
  const updIdx = SCHEMA.Pesanan.indexOf('updated_at');

  for (let r = 1; r < rows.length; r++) {
    if (String(rows[r][idIdx]) === String(data.id)) {
      if (data.status_bayar) sheet.getRange(r + 1, bayarIdx + 1).setValue(data.status_bayar);
      sheet.getRange(r + 1, updIdx + 1).setValue(nowISO());
      const mejaNama = rows[r][mejaIdx];
      if ((data.status_bayar === 'Lunas' || data.status_bayar === 'Dibatalkan') && mejaNama && mejaNama !== '-') {
        freeTableByName(mejaNama);
      }
      return { ok: true };
    }
  }
  return { ok: false, error: 'Pesanan tidak ditemukan' };
}

function handleVoidOrder(data) {
  const sheet = getSS().getSheetByName('Pesanan');
  const rows = sheet.getDataRange().getValues();
  const idIdx = SCHEMA.Pesanan.indexOf('id');
  const bayarIdx = SCHEMA.Pesanan.indexOf('status_bayar');
  const itemsIdx = SCHEMA.Pesanan.indexOf('items_json');
  const mejaIdx = SCHEMA.Pesanan.indexOf('meja');
  const updIdx = SCHEMA.Pesanan.indexOf('updated_at');

  for (let r = 1; r < rows.length; r++) {
    if (String(rows[r][idIdx]) === String(data.id)) {
      if (rows[r][bayarIdx] === 'Dibatalkan') return { ok: true };
      sheet.getRange(r + 1, bayarIdx + 1).setValue('Dibatalkan');
      sheet.getRange(r + 1, updIdx + 1).setValue(nowISO());
      try {
        const items = JSON.parse(rows[r][itemsIdx] || '[]');
        adjustMenuStock(items, +1);
      } catch (e) {}
      if (rows[r][mejaIdx] && rows[r][mejaIdx] !== '-') freeTableByName(rows[r][mejaIdx]);
      return { ok: true };
    }
  }
  return { ok: false, error: 'Pesanan tidak ditemukan' };
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

function handleSaveRole(r) {
  const record = {
    id: r.id || ('ROL-' + Date.now()),
    nama: String(r.nama || '').trim(),
    deskripsi: r.deskripsi || '',
    akses_json: JSON.stringify(Array.isArray(r.akses) ? r.akses : ['pos']),
    is_system: Boolean(r.is_system),
    created_at: r.created_at || nowISO()
  };
  upsertRowByKey('Roles', 'id', record);
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

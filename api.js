// CAFE CL — Layer Data Hybrid (Dynamic Client Google Sheets + Offline LocalStorage)
window.CafeAPI = (() => {
  const STORAGE_KEY = 'cafe_cl_db_v1';
  const GAS_URL_KEY = 'cafe_cl_gas_url';
  const SHEET_ID_KEY = 'cafe_cl_sheet_id';
  const SHEET_NAME_KEY = 'cafe_cl_sheet_name';
  const QUEUE_KEY = 'cafe_cl_sync_queue';

  function extractSpreadsheetId(input) {
    const s = String(input || '').trim();
    if (!s) return '';
    const match = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i) || s.match(/\/d\/([a-zA-Z0-9-_]+)/i);
    if (match && match[1]) return match[1];
    if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
    return '';
  }

  function getGasUrl() {
    const saved = localStorage.getItem(GAS_URL_KEY);
    if (saved && saved.trim()) return saved.trim();
    return (window.CAFE_CONFIG.GAS_WEBAPP_URL || '').trim();
  }

  function setGasUrl(url) {
    const clean = String(url || '').trim();
    if (clean) localStorage.setItem(GAS_URL_KEY, clean);
    else localStorage.removeItem(GAS_URL_KEY);
  }

  function getSpreadsheetId() {
    const saved = localStorage.getItem(SHEET_ID_KEY);
    if (saved && saved.trim()) return saved.trim();
    return (window.CAFE_CONFIG.SPREADSHEET_ID || '').trim();
  }

  function setSpreadsheetId(idOrUrl) {
    const id = extractSpreadsheetId(idOrUrl);
    if (id) localStorage.setItem(SHEET_ID_KEY, id);
    else localStorage.removeItem(SHEET_ID_KEY);
    return id;
  }

  function getSpreadsheetName() {
    return localStorage.getItem(SHEET_NAME_KEY) || '';
  }

  function setSpreadsheetName(name) {
    if (name) localStorage.setItem(SHEET_NAME_KEY, String(name));
    else localStorage.removeItem(SHEET_NAME_KEY);
  }

  function isConnected() {
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/i.test(getGasUrl());
  }

  function clearQueue() {
    localStorage.removeItem(QUEUE_KEY);
  }

  // Terapkan konfigurasi otomatis jika dibuka lewat Link Setup Perangkat Klien (?setup=...)
  function applySetupParamFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('setup');
      if (!token) return { applied: false };

      const decoded = JSON.parse(decodeURIComponent(escape(atob(token))));
      const gas = String(decoded.g || '').trim();
      const sheet = extractSpreadsheetId(decoded.s || '');

      if (/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/i.test(gas)) {
        const prevSheet = getSpreadsheetId();
        setGasUrl(gas);
        if (sheet) {
          setSpreadsheetId(sheet);
          if (sheet !== prevSheet) {
            clearQueue();
            localStorage.removeItem(STORAGE_KEY);
          }
        }
        // Hapus parameter setup dari address bar segera demi keamanan
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
        return { applied: true, sheetId: sheet };
      }
    } catch (e) {
      console.warn('Invalid setup token ignored');
    }
    return { applied: false };
  }

  function buildClientSetupLink() {
    const g = getGasUrl();
    const s = getSpreadsheetId();
    if (!g) return '';
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ g, s }))));
    const base = window.location.origin + window.location.pathname;
    return `${base}?setup=${encodeURIComponent(payload)}`;
  }

  function getDefaultDB() {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);

    return {
      settings: { ...window.CAFE_CONFIG.DEFAULT_SETTINGS },
      roles: JSON.parse(JSON.stringify(window.CAFE_CONFIG.DEFAULT_ROLES)),
      users: JSON.parse(JSON.stringify(window.CAFE_CONFIG.DEFAULT_USERS)),
      menu: JSON.parse(JSON.stringify(window.CAFE_CONFIG.DEFAULT_MENU)),
      tables: JSON.parse(JSON.stringify(window.CAFE_CONFIG.DEFAULT_TABLES)),
      members: JSON.parse(JSON.stringify(window.CAFE_CONFIG.DEFAULT_MEMBERS)),
      orders: [
        {
          id: 'ORD-DEMO-1',
          no_invoice: 'INV-' + today.replace(/-/g, '') + '-001',
          tanggal: today,
          waktu: '09:15:00',
          kasir: 'Kasir Utama',
          pelanggan: 'Nadia Kusuma',
          tipe_order: 'Dine-In',
          meja: 'Meja 02',
          items: [
            { menu_id: 'MNU-001', nama: 'CL Signature Palm Sugar Latte', kategori: 'Signature', varian: 'Iced • Less Sugar • Oat Milk (+8000)', qty: 2, harga: 36000, hpp: 13500, catatan: 'Es sedikit' },
            { menu_id: 'MNU-013', nama: 'French Butter Croissant', kategori: 'Pastry', varian: 'Hangat', qty: 1, harga: 26000, hpp: 11000, catatan: '' }
          ],
          subtotal: 98000, diskon: 0, pajak: 9800, service_charge: 0, total: 107800,
          metode_bayar: 'QRIS', bayar: 107800, kembalian: 0,
          status_bayar: 'Lunas', status_dapur: 'Selesai', catatan: ''
        },
        {
          id: 'ORD-DEMO-2',
          no_invoice: 'INV-' + today.replace(/-/g, '') + '-002',
          tanggal: today,
          waktu: '10:05:00',
          kasir: 'Kasir Utama',
          pelanggan: 'Raka Pratama',
          tipe_order: 'Take Away',
          meja: '-',
          items: [
            { menu_id: 'MNU-008', nama: 'Ceremonial Uji Matcha Latte', kategori: 'Non-Coffee', varian: 'Iced • Less Sugar', qty: 1, harga: 33000, hpp: 13500, catatan: '' },
            { menu_id: 'MNU-014', nama: 'Burnt Basque Cheesecake', kategori: 'Pastry', varian: 'Original', qty: 1, harga: 38000, hpp: 16500, catatan: '' }
          ],
          subtotal: 71000, diskon: 0, pajak: 7100, service_charge: 0, total: 78100,
          metode_bayar: 'Tunai', bayar: 100000, kembalian: 21900,
          status_bayar: 'Lunas', status_dapur: 'Selesai', catatan: ''
        },
        {
          id: 'ORD-DEMO-3',
          no_invoice: 'INV-' + yesterday.replace(/-/g, '') + '-018',
          tanggal: yesterday,
          waktu: '16:40:00',
          kasir: 'Owner CAFE CL',
          pelanggan: 'Tamu Walk-in',
          tipe_order: 'Dine-In',
          meja: 'Garden 01',
          items: [
            { menu_id: 'MNU-002', nama: 'Velvet Caramel Macchiato', kategori: 'Signature', varian: 'Iced • Normal Sugar', qty: 3, harga: 32000, hpp: 12000, catatan: '' },
            { menu_id: 'MNU-018', nama: 'Rice Bowl Chicken Sambal Matah', kategori: 'Food', varian: 'Pedas', qty: 2, harga: 42000, hpp: 18000, catatan: '' }
          ],
          subtotal: 180000, diskon: 10000, pajak: 17000, service_charge: 0, total: 187000,
          metode_bayar: 'QRIS', bayar: 187000, kembalian: 0,
          status_bayar: 'Lunas', status_dapur: 'Selesai', catatan: ''
        },
        {
          id: 'ORD-DEMO-4',
          no_invoice: 'INV-' + twoDaysAgo.replace(/-/g, '') + '-011',
          tanggal: twoDaysAgo,
          waktu: '14:20:00',
          kasir: 'Kasir Utama',
          pelanggan: 'Tamu Walk-in',
          tipe_order: 'Dine-In',
          meja: 'Bar 01',
          items: [
            { menu_id: 'MNU-005', nama: 'Artisan Cappuccino', kategori: 'Espresso', varian: 'Hot', qty: 2, harga: 28000, hpp: 9800, catatan: '' },
            { menu_id: 'MNU-016', nama: 'Truffle Parmesan Fries', kategori: 'Food', varian: 'Regular', qty: 1, harga: 32000, hpp: 12500, catatan: '' }
          ],
          subtotal: 88000, diskon: 0, pajak: 8800, service_charge: 0, total: 96800,
          metode_bayar: 'Debit/Kartu', bayar: 96800, kembalian: 0,
          status_bayar: 'Lunas', status_dapur: 'Selesai', catatan: ''
        }
      ],
      expenses: [
        { id: 'EXP-DEMO-1', tanggal: today, kategori: 'Bahan Baku', deskripsi: 'Susu Fresh Milk & Oat Milk 12 Karton', nominal: 285000, metode: 'Transfer', dicatat_oleh: 'Owner CAFE CL', catatan: 'Supplier rutin' },
        { id: 'EXP-DEMO-2', tanggal: yesterday, kategori: 'Biji Kopi', deskripsi: 'House Blend Arabica Gayo 3 Kg', nominal: 495000, metode: 'Transfer', dicatat_oleh: 'Owner CAFE CL', catatan: 'Roastery batch baru' }
      ],
      shifts: [],
      lastSync: null
    };
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const fresh = getDefaultDB();
        saveLocal(fresh);
        return fresh;
      }
      const parsed = JSON.parse(raw);
      const defaults = getDefaultDB();
      const mergedSettings = { ...defaults.settings, ...(parsed.settings || {}) };
      // Migrasi otomatis nama brand lama 'CAFE CL' -> 'NOUS' pada perangkat yang sudah pernah buka
      if (!mergedSettings.cafe_name || mergedSettings.cafe_name === 'CAFE CL') {
        mergedSettings.cafe_name = 'NOUS';
      }
      if (mergedSettings.instagram === '@cafecl.official') {
        mergedSettings.instagram = '@nous.coffee';
      }
      if (String(mergedSettings.receipt_footer || '').includes('CAFE CL')) {
        mergedSettings.receipt_footer = mergedSettings.receipt_footer.replace(/CAFE CL/g, 'NOUS');
      }
      return {
        ...defaults,
        ...parsed,
        settings: mergedSettings,
        roles: Array.isArray(parsed.roles) && parsed.roles.length ? parsed.roles : defaults.roles
      };
    } catch (e) {
      const fresh = getDefaultDB();
      saveLocal(fresh);
      return fresh;
    }
  }

  function saveLocal(db) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }

  function getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
    catch { return []; }
  }

  function pushQueue(action, data) {
    const q = getQueue();
    q.push({ action, data, ts: Date.now() });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  }

  async function postGas(action, data = {}, customUrl = null, customSheetId = null) {
    const url = (customUrl || getGasUrl()).trim();
    if (!url) throw new Error('URL Endpoint Web App belum diatur.');

    const spreadsheetId = customSheetId !== null ? customSheetId : getSpreadsheetId();
    const res = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, spreadsheetId, data })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json && json.ok === false) throw new Error(json.error || 'Terjadi kesalahan di server.');
    return json;
  }

  async function testConnection(customUrl, customSheetId = '') {
    const url = (customUrl || getGasUrl()).trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/i.test(url)) {
      throw new Error('Format URL harus berawalan https://script.google.com/macros/s/... dan berakhiran /exec');
    }
    const sid = customSheetId ? extractSpreadsheetId(customSheetId) : getSpreadsheetId();
    return postGas('ping', {}, url, sid);
  }

  async function initSheets(extraData = {}) {
    return postGas('initSheets', extraData);
  }

  // 1-Klik Pindah / Hubungkan Google Sheet Klien + Generate Otomatis + Opsional Migrasi Data
  async function connectAndGenerate({ gasUrl, sheetInput, migrateCurrent, currentDb }) {
    const cleanGas = String(gasUrl || '').trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/i.test(cleanGas)) {
      throw new Error('Link Web App GAS harus berawalan https://script.google.com/macros/s/... dan berakhiran /exec');
    }

    const oldSheetId = getSpreadsheetId();
    const extractedSheetId = sheetInput ? extractSpreadsheetId(sheetInput) : '';
    if (sheetInput && !extractedSheetId) {
      throw new Error('Link atau ID Google Sheet klien tidak valid. Copas link lengkap Google Sheets Anda.');
    }

    const targetSheetId = extractedSheetId || oldSheetId;

    // 1. Test akses ke endpoint + Spreadsheet target
    const pingRes = await testConnection(cleanGas, targetSheetId);

    // 2. Simpan konfigurasi baru (jika pindah sheet berbeda, bersihkan antrean lama agar tidak campur!)
    const switchedSheet = Boolean(targetSheetId && targetSheetId !== oldSheetId);
    if (switchedSheet) clearQueue();
    setGasUrl(cleanGas);
    if (targetSheetId) setSpreadsheetId(targetSheetId);
    if (pingRes.spreadsheetName) setSpreadsheetName(pingRes.spreadsheetName);

    // 3. Auto-generate semua 10 sheet + header + opsional migrasi data master saat ini
    const payload = {
      spreadsheetId: targetSheetId,
      saveAsActive: true,
      migrateData: migrateCurrent && currentDb ? {
        settings: currentDb.settings,
        roles: currentDb.roles,
        users: currentDb.users,
        menu: currentDb.menu,
        tables: currentDb.tables,
        members: currentDb.members
      } : null
    };

    const initRes = await postGas('initSheets', payload, cleanGas, targetSheetId);
    if (initRes.spreadsheetName) setSpreadsheetName(initRes.spreadsheetName);
    if (initRes.spreadsheetId) setSpreadsheetId(initRes.spreadsheetId);

    // 4. Tarik data bersih dari Sheet Klien yang baru ter-generate
    const synced = await syncFromCloud(switchedSheet);
    return {
      ok: true,
      init: initRes,
      db: synced.db,
      switchedSheet
    };
  }

  // Ambil Code.gs & otomatis ganti DEFAULT_SPREADSHEET_ID dengan Sheet ID Klien
  async function generateClientCodeGs(sheetInput) {
    const res = await fetch(`./Code.gs?t=${Date.now()}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Gagal memuat template Code.gs');
    let code = await res.text();
    const targetId = extractSpreadsheetId(sheetInput) || getSpreadsheetId();
    if (targetId) {
      code = code.replace(
        /const DEFAULT_SPREADSHEET_ID = '[^']+';/,
        `const DEFAULT_SPREADSHEET_ID = '${targetId}';`
      );
    }
    return { code, spreadsheetId: targetId };
  }

  async function flushQueue() {
    if (!isConnected() || !navigator.onLine) return 0;
    const q = getQueue();
    if (!q.length) return 0;
    const remaining = [];
    let flushed = 0;
    for (const job of q) {
      try {
        await postGas(job.action, job.data);
        flushed++;
      } catch (e) {
        remaining.push(job);
      }
    }
    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    return flushed;
  }

  async function syncFromCloud(replaceOrdersOnSwitch = false) {
    if (!isConnected()) return { ok: false, localOnly: true, db: loadLocal() };
    await flushQueue();
    const res = await postGas('syncAll', {});
    if (res && res.ok && res.data) {
      if (res.spreadsheetName) setSpreadsheetName(res.spreadsheetName);
      if (res.spreadsheetId) setSpreadsheetId(res.spreadsheetId);

      const current = replaceOrdersOnSwitch ? getDefaultDB() : loadLocal();
      const merged = {
        ...current,
        settings: { ...window.CAFE_CONFIG.DEFAULT_SETTINGS, ...(res.data.settings || {}) },
        roles: res.data.roles?.length ? res.data.roles : current.roles,
        users: res.data.users?.length ? res.data.users : current.users,
        menu: res.data.menu?.length ? res.data.menu : current.menu,
        tables: res.data.tables?.length ? res.data.tables : current.tables,
        orders: Array.isArray(res.data.orders) ? res.data.orders : (replaceOrdersOnSwitch ? [] : current.orders),
        expenses: Array.isArray(res.data.expenses) ? res.data.expenses : (replaceOrdersOnSwitch ? [] : current.expenses),
        shifts: Array.isArray(res.data.shifts) ? res.data.shifts : (replaceOrdersOnSwitch ? [] : current.shifts),
        members: Array.isArray(res.data.members) ? res.data.members : current.members,
        lastSync: new Date().toISOString()
      };
      merged.settings.tax_percent = Number(merged.settings.tax_percent ?? 10);
      merged.settings.service_percent = Number(merged.settings.service_percent ?? 0);
      merged.settings.auto_print_bt = merged.settings.auto_print_bt === true || merged.settings.auto_print_bt === 'true';
      saveLocal(merged);
      return { ok: true, db: merged };
    }
    return { ok: false, db: loadLocal() };
  }

  async function sendAction(action, data) {
    if (!isConnected()) return { ok: true, offline: true };
    if (!navigator.onLine) {
      pushQueue(action, data);
      return { ok: true, queued: true };
    }
    try {
      return await postGas(action, data);
    } catch (err) {
      pushQueue(action, data);
      return { ok: false, queued: true, error: err.message };
    }
  }

  return {
    extractSpreadsheetId,
    getGasUrl,
    setGasUrl,
    getSpreadsheetId,
    setSpreadsheetId,
    getSpreadsheetName,
    setSpreadsheetName,
    isConnected,
    applySetupParamFromUrl,
    buildClientSetupLink,
    loadLocal,
    saveLocal,
    getQueue,
    testConnection,
    initSheets,
    connectAndGenerate,
    generateClientCodeGs,
    syncFromCloud,
    flushQueue,
    sendAction
  };
})();

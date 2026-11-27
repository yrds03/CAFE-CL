// CAFE CL — Layer Data Hybrid (Google Apps Script Real-time Sync + Offline LocalStorage)
window.CafeAPI = (() => {
  const STORAGE_KEY = 'cafe_cl_db_v1';
  const GAS_URL_KEY = 'cafe_cl_gas_url';
  const QUEUE_KEY = 'cafe_cl_sync_queue';

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

  function isConnected() {
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/i.test(getGasUrl());
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
      return {
        ...defaults,
        ...parsed,
        settings: { ...defaults.settings, ...(parsed.settings || {}) },
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

  async function postGas(action, data = {}) {
    const url = getGasUrl();
    if (!url) throw new Error('URL Google Apps Script belum diatur.');

    const res = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, data })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json && json.ok === false) throw new Error(json.error || 'Terjadi kesalahan di server.');
    return json;
  }

  async function testConnection(customUrl) {
    const url = (customUrl || getGasUrl()).trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/i.test(url)) {
      throw new Error('Format URL harus berawalan https://script.google.com/macros/s/... dan berakhiran /exec');
    }
    const res = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'ping', data: {} })
    });
    const json = await res.json();
    if (!json || !json.ok) throw new Error(json?.error || 'Koneksi gagal.');
    return json;
  }

  async function initSheets() {
    return postGas('initSheets', {});
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

  async function syncFromCloud() {
    if (!isConnected()) return { ok: false, localOnly: true, db: loadLocal() };
    await flushQueue();
    const res = await postGas('syncAll', {});
    if (res && res.ok && res.data) {
      const current = loadLocal();
      const merged = {
        ...current,
        settings: { ...window.CAFE_CONFIG.DEFAULT_SETTINGS, ...(res.data.settings || {}) },
        roles: res.data.roles?.length ? res.data.roles : current.roles,
        users: res.data.users?.length ? res.data.users : current.users,
        menu: res.data.menu?.length ? res.data.menu : current.menu,
        tables: res.data.tables?.length ? res.data.tables : current.tables,
        orders: Array.isArray(res.data.orders) ? res.data.orders : current.orders,
        expenses: Array.isArray(res.data.expenses) ? res.data.expenses : current.expenses,
        shifts: Array.isArray(res.data.shifts) ? res.data.shifts : current.shifts,
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
    getGasUrl,
    setGasUrl,
    isConnected,
    loadLocal,
    saveLocal,
    getQueue,
    testConnection,
    initSheets,
    syncFromCloud,
    flushQueue,
    sendAction
  };
})();

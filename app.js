/* ============================================================================
 * CAFE CL — Cashier-Focused POS, Bluetooth Thermal Printer, RBAC & Auto-Update PWA
 * ============================================================================ */
(() => {
  'use strict';

  const CFG = window.CAFE_CONFIG;
  const API = window.CafeAPI;
  const Printer = window.CafePrinter;

  // ==========================================================================
  // APPLICATION STATE
  // ==========================================================================
  const state = {
    db: API.loadLocal(),
    user: loadSessionUser(),
    route: 'pos',
    theme: localStorage.getItem('cafe_cl_theme') || 'dark',
    syncing: false,
    submittingOrder: false,
    deferredPrompt: null,
    isStandalone: window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
    updateInProgress: false,
    swReg: null,

    // Bluetooth Thermal Printer status
    btConnected: Printer ? Printer.isConnected() : false,
    btName: Printer ? Printer.getDeviceName() : '',

    // Login UI state
    loginMode: 'password', // 'password' | 'pin'
    pinBuffer: '',

    // POS state
    posSearch: '',
    posCategory: 'Semua',
    orderType: 'Dine-In',
    selectedTable: '',
    customerName: '',
    selectedMemberId: '',
    orderNote: '',
    discount: 0,
    cart: [],
    editingOrderId: null,
    mobileCartOpen: false,

    // Filters
    txSearch: '',
    txDate: '',
    menuSearch: '',
    sidebarOpen: false
  };

  function loadSessionUser() {
    try {
      const raw = localStorage.getItem('cafe_cl_user');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function saveSessionUser(u) {
    state.user = u;
    if (u) localStorage.setItem('cafe_cl_user', JSON.stringify(u));
    else localStorage.removeItem('cafe_cl_user');
  }

  // ==========================================================================
  // ROLE-BASED ACCESS CONTROL (RBAC SECURITY)
  // ==========================================================================
  function getUserRoleObj() {
    if (!state.user) return null;
    const roles = state.db.roles || CFG.DEFAULT_ROLES;
    const found = roles.find((r) => String(r.nama).toLowerCase() === String(state.user.role).toLowerCase());
    if (found) return found;
    // Fallback aman jika role dihapus: akses kasir dasar saja
    return { nama: state.user.role, akses: ['dashboard', 'pos', 'tables', 'history'] };
  }

  function hasPerm(permKey) {
    if (!state.user) return false;
    const roleObj = getUserRoleObj();
    if (!roleObj) return false;
    if (String(roleObj.nama).toLowerCase() === 'owner') return true;
    return Array.isArray(roleObj.akses) && roleObj.akses.includes(permKey);
  }

  function getFirstAllowedRoute() {
    const order = ['dashboard', 'pos', 'tables', 'history', 'menu', 'finance', 'members', 'settings'];
    return order.find((r) => hasPerm(r)) || 'pos';
  }

  // ==========================================================================
  // HELPERS & SECURITY SANITIZERS
  // ==========================================================================
  const fmtRp = (n) => {
    const cur = state.db.settings?.currency || 'Rp';
    const num = Math.round(Number(n) || 0);
    return `${cur} ${num.toLocaleString('id-ID')}`;
  };

  const todayISO = () => {
    const d = new Date();
    const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return tz.toISOString().slice(0, 10);
  };

  const nowTime = () => new Date().toTimeString().slice(0, 8);

  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const safeUrl = (u) => {
    const str = String(u || '').trim();
    if (!str) return '';
    return /^https?:\/\//i.test(str) ? str : '';
  };

  const categoryIcon = (cat) => ({
    'Signature': '☕',
    'Espresso': '🥃',
    'Non-Coffee': '🍵',
    'Tea': '🫖',
    'Pastry': '🥐',
    'Food': '🍝'
  })[cat] || '✨';

  function toast(msg, type = 'info') {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const dot = type === 'success' ? '✓' : type === 'error' ? '!' : '✦';
    const color = type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : 'var(--gold-400)';
    el.innerHTML = `<span style="color:${color};font-weight:800">${dot}</span><span>${esc(msg)}</span>`;
    root.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      el.style.transition = '0.25s';
      setTimeout(() => el.remove(), 260);
    }, 3200);
  }

  // ==========================================================================
  // MODAL ENGINE (BULLETPROOF CLOSE VIA X, BATAL, BACKDROP & ESCAPE KEY)
  // ==========================================================================
  function syncBodyScrollLock() {
    const modalOpen = Boolean(document.getElementById('modal-root')?.classList.contains('open'));
    const locked = modalOpen || state.sidebarOpen || state.mobileCartOpen;
    document.body.classList.toggle('scroll-locked', locked);
  }

  function openModal(html) {
    const root = document.getElementById('modal-root');
    if (!root) return;
    root.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">${html}</div>`;
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    syncBodyScrollLock();

    // Event delegation: klik backdrop ATAU tombol [data-close-modal] apa pun langsung menutup modal!
    root.onclick = (e) => {
      if (e.target === root || e.target.closest('[data-close-modal]')) {
        e.preventDefault();
        closeModal();
      }
    };
  }

  function closeModal() {
    const root = document.getElementById('modal-root');
    if (!root) return;
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = '';
    root.onclick = null;
    syncBodyScrollLock();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const root = document.getElementById('modal-root');
      if (root && root.classList.contains('open')) closeModal();
    }
  });

  // ==========================================================================
  // AUTO-UPDATE ENGINE & STARTUP SPINNING LOADER
  // ==========================================================================
  const BUILD_KEY = 'cafe_cl_installed_build';

  function setOverlay(visible, title, subtitle, progressPct, versionText) {
    const ov = document.getElementById('boot-update-overlay');
    if (!ov) return;
    if (title !== undefined) document.getElementById('update-title').textContent = title;
    if (subtitle !== undefined) document.getElementById('update-subtitle').textContent = subtitle;
    if (progressPct !== undefined) document.getElementById('update-progress-bar').style.width = `${progressPct}%`;
    if (versionText !== undefined) document.getElementById('update-version-pill').textContent = versionText;
    ov.classList.toggle('active', Boolean(visible));
  }

  async function triggerSeamlessUpdate(newVersionLabel, newBuildKey, notesText) {
    if (state.updateInProgress) return;
    state.updateInProgress = true;

    setOverlay(
      true,
      'Update Sistem Ditemukan!',
      notesText || 'Mengunduh & menerapkan versi terbaru secara otomatis...',
      45,
      newVersionLabel || `v${CFG.APP_VERSION}`
    );

    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      setOverlay(true, 'Menerapkan Pembaruan...', 'Mengaktifkan Service Worker terbaru...', 78, newVersionLabel);

      if (state.swReg) {
        await state.swReg.update().catch(() => {});
        if (state.swReg.waiting) state.swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      if (newBuildKey) localStorage.setItem(BUILD_KEY, newBuildKey);
      setOverlay(true, 'Pembaruan Selesai!', 'Memuat ulang aplikasi dengan versi terbaru...', 100, newVersionLabel);
    } catch (e) {
      console.warn('Auto update warning:', e);
    }

    setTimeout(() => window.location.reload(), 900);
  }

  async function checkRemoteVersion(isStartup = false) {
    const localBuild = `${CFG.APP_VERSION}-${CFG.APP_BUILD}`;
    if (!localStorage.getItem(BUILD_KEY)) localStorage.setItem(BUILD_KEY, localBuild);

    if (isStartup) {
      setOverlay(true, 'Memeriksa Pembaruan Terbaru...', 'Menghubungkan ke server CAFE CL & Service Worker', 38, `v${CFG.APP_VERSION}`);
    }

    let remote = null;
    try {
      const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) remote = await res.json();
    } catch (e) {}

    if (remote && remote.version && remote.build) {
      const remoteBuild = `${remote.version}-${remote.build}`;
      if (remoteBuild !== localBuild) {
        await triggerSeamlessUpdate(`v${remote.version} • ${remote.build}`, remoteBuild, remote.notes);
        return true;
      }
      localStorage.setItem(BUILD_KEY, remoteBuild);
    }

    if (isStartup) {
      setOverlay(true, 'Aplikasi Versi Terbaru Siap', 'Memuat sistem kasir CAFE CL...', 100, `v${CFG.APP_VERSION} • Up to date`);
      setTimeout(() => {
        if (!state.updateInProgress) setOverlay(false);
      }, 650);
    }
    return false;
  }

  async function initServiceWorkerAndUpdater() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredPrompt = e;
      render();
    });

    window.addEventListener('appinstalled', () => {
      state.deferredPrompt = null;
      state.isStandalone = true;
      toast('CAFE CL berhasil diinstall di perangkat Anda!', 'success');
      render();
    });

    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
        state.swReg = reg;

        if (reg.waiting) {
          triggerSeamlessUpdate(`Versi Terbaru`);
          return;
        }

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              triggerSeamlessUpdate(`Versi Terbaru`);
            }
          });
        });

        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'SW_UPDATED' && !state.updateInProgress) {
            triggerSeamlessUpdate(`v${event.data.version || CFG.APP_VERSION}`);
          }
        });

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          if (!state.updateInProgress) {
            setOverlay(true, 'Menerapkan Update Terbaru...', 'Memuat ulang aplikasi otomatis...', 95, `v${CFG.APP_VERSION}`);
            setTimeout(() => window.location.reload(), 600);
          }
        });

        reg.update().catch(() => {});
      } catch (err) {
        console.warn('SW register info:', err);
      }
    }

    await checkRemoteVersion(true);

    setInterval(() => {
      if (navigator.onLine && !state.updateInProgress) {
        state.swReg?.update().catch(() => {});
        checkRemoteVersion(false);
      }
    }, CFG.UPDATE_CHECK_INTERVAL_MS || 60000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine && !state.updateInProgress) {
        state.swReg?.update().catch(() => {});
        checkRemoteVersion(false);
      }
    });
  }

  async function manualCheckUpdate() {
    setOverlay(true, 'Memeriksa Pembaruan...', 'Menghubungi server & Service Worker terbaru', 42, `v${CFG.APP_VERSION}`);
    try {
      if (state.swReg) await state.swReg.update();
      const updated = await checkRemoteVersion(false);
      if (!updated) {
        setOverlay(true, 'Sudah Versi Terbaru!', 'Aplikasi Anda sudah menggunakan rilis terkini.', 100, `v${CFG.APP_VERSION}`);
        setTimeout(() => setOverlay(false), 900);
      }
    } catch {
      setOverlay(false);
      toast('Tidak dapat memeriksa update (periksa koneksi internet).', 'error');
    }
  }

  // ==========================================================================
  // BLUETOOTH THERMAL PRINTER MODAL & ACTIONS
  // ==========================================================================
  if (Printer) {
    Printer.onStatusChange((info) => {
      const wasConnected = state.btConnected;
      state.btConnected = info.connected;
      state.btName = info.name;
      if (wasConnected && !info.connected) {
        toast('Printer Bluetooth terputus!', 'error');
      }
      render();
    });
  }

  function openBluetoothModal() {
    const s = state.db.settings || CFG.DEFAULT_SETTINGS;
    const supported = Printer && Printer.isSupported();
    const connected = state.btConnected;
    const lastBt = localStorage.getItem('cafe_cl_last_bt_name') || '';

    openModal(`
      <div class="modal-head">
        <div>
          <div class="modal-title">Printer Thermal Bluetooth</div>
          <div style="font-size:12px;color:var(--text-secondary)">ESC/POS 58mm & 80mm untuk cetak struk kasir</div>
        </div>
        <button type="button" class="modal-close-btn" data-close-modal aria-label="Tutup">✕</button>
      </div>

      <div class="card" style="background:var(--bg-elevated);margin-bottom:14px;border-color:${connected ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.45)'}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="width:13px;height:13px;border-radius:50%;background:${connected ? '#22C55E' : '#EF4444'};box-shadow:0 0 12px ${connected ? '#22C55E' : '#EF4444'}"></span>
            <div>
              <strong style="font-size:14px">${connected ? esc(state.btName || 'Thermal Printer') : 'Belum Terhubung'}</strong>
              <div style="font-size:11.5px;color:var(--text-secondary)">${connected ? 'Status: HIJAU — Siap mencetak struk thermal' : 'Status: MERAH — Nyalakan printer lalu klik Hubungkan'}</div>
            </div>
          </div>
          <span class="badge ${connected ? 'badge-success' : 'badge-danger'}">${connected ? 'Terhubung' : 'Offline'}</span>
        </div>
        ${!connected && lastBt ? `<div style="font-size:11px;color:var(--text-muted);margin-top:8px">Printer terakhir: ${esc(lastBt)}</div>` : ''}
      </div>

      ${!supported ? `
        <div class="card" style="background:var(--danger-bg);border-color:rgba(248,113,113,0.4);font-size:12.5px;margin-bottom:14px">
          Browser ini tidak mendukung Web Bluetooth. Gunakan <strong>Google Chrome / Microsoft Edge</strong> di Android, Windows, atau macOS untuk cetak Bluetooth langsung. (Untuk iPhone/Safari gunakan tombol Cetak Browser/AirPrint).
        </div>
      ` : ''}

      <div class="grid-2" style="margin-bottom:14px">
        <div class="field" style="margin-bottom:0">
          <label>Ukuran Kertas Thermal</label>
          <select id="bt-paper-size" class="select">
            <option value="58mm" ${(s.paper_size || '58mm') === '58mm' ? 'selected' : ''}>58mm (32 karakter)</option>
            <option value="80mm" ${s.paper_size === '80mm' ? 'selected' : ''}>80mm (48 karakter)</option>
          </select>
        </div>
        <div class="field" style="margin-bottom:0;display:flex;align-items:flex-end">
          <label class="perm-item" style="width:100%;margin:0">
            <input type="checkbox" id="bt-auto-print" ${s.auto_print_bt ? 'checked' : ''} />
            <span>Auto-Print saat Bayar</span>
          </label>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:9px">
        ${!connected ? `
          <button type="button" class="btn btn-primary btn-lg btn-full" id="btn-bt-connect" ${!supported ? 'disabled' : ''}>
            🔵 Cari & Hubungkan Printer Bluetooth
          </button>
        ` : `
          <div class="grid-2">
            <button type="button" class="btn btn-primary" id="btn-bt-test">🖨 Test Print Struk</button>
            <button type="button" class="btn btn-danger" id="btn-bt-disconnect">Putuskan Koneksi</button>
          </div>
        `}
      </div>

      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-close-modal>Tutup</button>
      </div>
    `);

    const saveBtPrefs = () => {
      const paper = document.getElementById('bt-paper-size')?.value || '58mm';
      const autoP = Boolean(document.getElementById('bt-auto-print')?.checked);
      state.db.settings.paper_size = paper;
      state.db.settings.auto_print_bt = autoP;
      API.saveLocal(state.db);
      API.sendAction('saveSettings', state.db.settings);
    };

    document.getElementById('bt-paper-size')?.addEventListener('change', () => { saveBtPrefs(); toast('Ukuran kertas disimpan.', 'success'); });
    document.getElementById('bt-auto-print')?.addEventListener('change', () => { saveBtPrefs(); toast('Pengaturan auto-print disimpan.', 'success'); });

    document.getElementById('btn-bt-connect')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-bt-connect');
      btn.disabled = true;
      btn.textContent = 'Mencari Printer Bluetooth...';
      try {
        const res = await Printer.connect();
        state.btConnected = true;
        state.btName = res.name;
        toast(`Printer ${res.name} terhubung (HIJAU)!`, 'success');
        closeModal();
        render();
      } catch (err) {
        if (!String(err.message || '').toLowerCase().includes('cancel')) {
          toast('Gagal konek BT: ' + err.message, 'error');
        }
        btn.disabled = false;
        btn.textContent = '🔵 Cari & Hubungkan Printer Bluetooth';
      }
    });

    document.getElementById('btn-bt-test')?.addEventListener('click', async () => {
      try {
        await Printer.printTest(state.db.settings);
        toast('Test print berhasil dikirim ke printer!', 'success');
      } catch (err) {
        toast('Gagal test print: ' + err.message, 'error');
      }
    });

    document.getElementById('btn-bt-disconnect')?.addEventListener('click', () => {
      Printer.disconnect();
      toast('Printer Bluetooth diputuskan.', 'info');
      closeModal();
      render();
    });
  }

  // ==========================================================================
  // PWA INSTALL HANDLER (PC & HP)
  // ==========================================================================
  async function handleInstallDevice(targetDevice) {
    if (state.isStandalone) {
      toast('Aplikasi CAFE CL sudah terinstall dan berjalan di perangkat ini!', 'success');
      return;
    }

    if (state.deferredPrompt) {
      state.deferredPrompt.prompt();
      const choice = await state.deferredPrompt.userChoice;
      state.deferredPrompt = null;
      if (choice.outcome === 'accepted') {
        toast(`Menginstall CAFE CL untuk ${targetDevice}...`, 'success');
      }
      render();
      return;
    }

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (targetDevice === 'PC') {
      openModal(`
        <div class="modal-head">
          <div class="modal-title">Download CAFE CL untuk PC</div>
          <button type="button" class="modal-close-btn" data-close-modal aria-label="Tutup">✕</button>
        </div>
        <p class="text-muted" style="margin-bottom:14px">Install CAFE CL sebagai aplikasi Desktop di Windows / macOS agar bisa dibuka langsung dari Start Menu atau Desktop:</p>
        <div class="card" style="background:var(--bg-elevated);margin-bottom:14px">
          <div style="display:flex;flex-direction:column;gap:10px;font-size:13px">
            <div><strong class="text-gold">1. Chrome / Edge di PC:</strong> Klik ikon <strong>Install (⊕ / monitor ↓)</strong> di ujung kanan address bar browser.</div>
            <div><strong class="text-gold">2. Atau via Menu Browser:</strong> Klik menu <strong>⋮ (kanan atas)</strong> → <strong>Cast, save, and share</strong> → <strong>Install CAFE CL</strong>.</div>
            <div><strong class="text-gold">3. Selesai!</strong> Aplikasi langsung siap dipakai & mendukung Auto-Update otomatis.</div>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-primary" data-close-modal>Mengerti</button>
        </div>
      `);
    } else {
      openModal(`
        <div class="modal-head">
          <div class="modal-title">Download CAFE CL untuk HP</div>
          <button type="button" class="modal-close-btn" data-close-modal aria-label="Tutup">✕</button>
        </div>
        <p class="text-muted" style="margin-bottom:14px">Pasang CAFE CL di Layar Utama HP (Android / iPhone) seperti aplikasi native & otomatis update:</p>
        <div class="card" style="background:var(--bg-elevated);margin-bottom:12px">
          <div style="font-weight:700;color:var(--gold-400);margin-bottom:6px">Android (Chrome / Edge)</div>
          <div style="font-size:13px;color:var(--text-secondary)">
            1. Buka halaman ini di <strong>Google Chrome</strong>.<br/>
            2. Tap tombol menu <strong>⋮ (pojok kanan atas)</strong>.<br/>
            3. Pilih <strong>"Install aplikasi"</strong> atau <strong>"Tambahkan ke layar utama"</strong>.<br/>
            4. Tap <strong>Install</strong> — ikon CAFE CL langsung muncul di HP Anda!
          </div>
        </div>
        <div class="card" style="background:var(--bg-elevated)">
          <div style="font-weight:700;color:var(--gold-400);margin-bottom:6px">iPhone / iPad (Safari)${isIOS ? ' • Perangkat Anda' : ''}</div>
          <div style="font-size:13px;color:var(--text-secondary)">
            1. Buka halaman ini menggunakan <strong>Safari</strong>.<br/>
            2. Tap ikon <strong>Bagikan (↑ kotak panah atas)</strong> di bagian bawah.<br/>
            3. Pilih <strong>"Tambahkan ke Layar Utama" (Add to Home Screen)</strong>.<br/>
            4. Tap <strong>Tambah</strong>.
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-primary" data-close-modal>Mengerti</button>
        </div>
      `);
    }
  }

  // ==========================================================================
  // CLOUD SYNC & SECURE GAS CONFIG MODAL (OWNER ONLY, TANPA LINK APPS SCRIPT)
  // ==========================================================================
  async function syncCloud(silent = false) {
    if (!API.isConnected()) {
      if (!silent) toast('Mode Lokal aktif. Owner dapat mengatur koneksi server di Pengaturan.', 'info');
      return;
    }
    state.syncing = true;
    render();
    try {
      const res = await API.syncFromCloud();
      if (res.ok) {
        state.db = res.db;
        if (!silent) toast('Data berhasil disinkronkan dengan Google Sheets!', 'success');
      }
    } catch (e) {
      if (!silent) toast('Gagal sinkronisasi: ' + e.message, 'error');
    } finally {
      state.syncing = false;
      render();
    }
  }

  function openGasSetupModal() {
    if (!hasPerm('settings')) {
      toast('Hanya Owner yang dapat mengakses pengaturan database klien.', 'error');
      return;
    }
    const currentUrl = API.getGasUrl();
    const currentSheetId = API.getSpreadsheetId();
    const currentSheetName = API.getSpreadsheetName();

    openModal(`
      <div class="modal-head">
        <div>
          <div class="modal-title">Pindah / Setup Google Sheet Klien</div>
          <div style="font-size:12px;color:var(--text-secondary)">Copas link Google Sheet klien + endpoint GAS, lalu klik Generate — 10 sheet & header langsung terbentuk otomatis!</div>
        </div>
        <button type="button" class="modal-close-btn" data-close-modal aria-label="Tutup">✕</button>
      </div>

      ${currentSheetName ? `
        <div style="padding:10px 12px;border-radius:12px;background:var(--success-bg);border:1px solid rgba(52,211,153,0.35);font-size:12px;margin-bottom:14px">
          <strong class="text-success">● Sheet Aktif Saat Ini:</strong> ${esc(currentSheetName)} <span class="mono" style="opacity:0.8">(${esc(currentSheetId.slice(0, 8))}…${esc(currentSheetId.slice(-6))})</span>
        </div>
      ` : ''}

      <div class="field">
        <label>1. Link Google Sheet Klien (atau ID Spreadsheet)</label>
        <input id="gas-sheet-input" class="input mono" style="font-size:12px" placeholder="https://docs.google.com/spreadsheets/d/....../edit" value="${esc(currentSheetId)}" autocomplete="off" />
        <div id="gas-sheet-preview" style="font-size:11px;margin-top:5px;color:var(--text-secondary)">
          ${currentSheetId ? `✓ ID terdeteksi: <span class="mono text-gold">${esc(currentSheetId)}</span>` : 'Tempel link Google Sheets klien di sini'}
        </div>
      </div>

      <div class="field">
        <label>2. Link Web App GAS Endpoint (berakhiran /exec)</label>
        <div style="display:flex;gap:8px">
          <input id="gas-url-input" class="input mono" type="password" style="font-size:12px" placeholder="https://script.google.com/macros/s/.../exec" value="${esc(currentUrl)}" autocomplete="off" />
          <button type="button" class="btn btn-secondary btn-sm" id="btn-toggle-gas-vis">Lihat</button>
        </div>
      </div>

      <div class="field">
        <label>3. Pilihan Data Awal di Sheet Klien</label>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label class="perm-item">
            <input type="radio" name="mig-mode" value="fresh" checked />
            <span>Buat Sheet Baru + Data Contoh Default Cafe (klien baru dari awal)</span>
          </label>
          <label class="perm-item">
            <input type="radio" name="mig-mode" value="migrate" />
            <span>Buat Sheet Baru + Pindahkan Menu, Meja, Role & Pengaturan saat ini ke Sheet Klien</span>
          </label>
        </div>
      </div>

      <div class="card" style="background:var(--bg-elevated);padding:13px;margin-bottom:14px">
        <div style="font-size:12px;font-weight:700;color:var(--gold-400);margin-bottom:6px">Pindah ke Akun Google Milik Klien Sendiri?</div>
        <div style="font-size:11.5px;color:var(--text-secondary);margin-bottom:10px">
          • <strong>Cara Tercepat (5 detik):</strong> Share Google Sheet klien sebagai <em>Editor</em> ke akun Google Anda → cukup copas Link Sheet Klien di atas → klik <strong>Generate Otomatis</strong>!<br/>
          • <strong>Pindah Penuh ke Akun Klien:</strong> Klik tombol di bawah untuk menyalin <code>Code.gs</code> yang sudah otomatis terisi ID Sheet Klien → deploy Web App di akun klien → tempel URL <code>/exec</code> di kolom #2 → klik <strong>Generate Otomatis</strong>.
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-secondary btn-sm" id="btn-copy-client-codegs">📋 Salin Code.gs Khusus Sheet Klien</button>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-download-client-codegs">⬇ Download Code.gs</button>
        </div>
      </div>

      <div class="modal-actions" style="justify-content:space-between;flex-wrap:wrap">
        <button type="button" class="btn btn-ghost btn-sm text-danger" id="btn-disconnect-gas" ${!currentUrl ? 'style="visibility:hidden"' : ''}>Lepas Koneksi</button>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn btn-secondary" data-close-modal>Batal</button>
          <button type="button" class="btn btn-primary" id="btn-save-gas-connect">✨ Hubungkan & Generate Otomatis</button>
        </div>
      </div>
    `);

    const sheetInp = document.getElementById('gas-sheet-input');
    const sheetPreview = document.getElementById('gas-sheet-preview');
    sheetInp.oninput = () => {
      const val = sheetInp.value.trim();
      const id = API.extractSpreadsheetId(val);
      if (!val) {
        sheetPreview.innerHTML = 'Tempel link Google Sheets klien di sini';
      } else if (id) {
        sheetPreview.innerHTML = `<span class="text-success">✓ ID Sheet valid:</span> <span class="mono text-gold">${esc(id)}</span>`;
      } else {
        sheetPreview.innerHTML = `<span class="text-danger">! Format link/ID Google Sheets belum valid</span>`;
      }
    };

    document.getElementById('btn-toggle-gas-vis').onclick = () => {
      const inp = document.getElementById('gas-url-input');
      const btn = document.getElementById('btn-toggle-gas-vis');
      const hidden = inp.type === 'password';
      inp.type = hidden ? 'text' : 'password';
      btn.textContent = hidden ? 'Sembunyi' : 'Lihat';
    };

    document.getElementById('btn-copy-client-codegs').onclick = async () => {
      try {
        const { code, spreadsheetId } = await API.generateClientCodeGs(sheetInp.value.trim());
        await navigator.clipboard.writeText(code);
        toast(`Code.gs siap pakai disalin! (ID Sheet: ${spreadsheetId.slice(0, 10)}...)`, 'success');
      } catch (err) {
        toast('Gagal menyalin Code.gs: ' + err.message, 'error');
      }
    };

    document.getElementById('btn-download-client-codegs').onclick = async () => {
      try {
        const { code } = await API.generateClientCodeGs(sheetInp.value.trim());
        const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'Code.gs';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast('File Code.gs khusus klien berhasil diunduh!', 'success');
      } catch (err) {
        toast('Gagal mengunduh Code.gs: ' + err.message, 'error');
      }
    };

    document.getElementById('btn-disconnect-gas')?.addEventListener('click', () => {
      if (!confirm('Lepas koneksi server Google Sheets dan kembali ke Mode Lokal?')) return;
      API.setGasUrl('');
      API.setSpreadsheetName('');
      toast('Koneksi server dilepas (Mode Lokal).', 'info');
      closeModal();
      render();
    });

    document.getElementById('btn-save-gas-connect').onclick = async () => {
      const gasUrl = document.getElementById('gas-url-input').value.trim();
      const sheetInput = sheetInp.value.trim();
      const migrateCurrent = document.querySelector('input[name="mig-mode"]:checked')?.value === 'migrate';
      const btn = document.getElementById('btn-save-gas-connect');

      if (!gasUrl) {
        toast('Masukkan Link Web App GAS (/exec) terlebih dahulu.', 'error');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Menghubungkan & Generate 10 Sheet...';
      try {
        const res = await API.connectAndGenerate({
          gasUrl,
          sheetInput,
          migrateCurrent,
          currentDb: state.db
        });
        state.db = res.db;
        const sheetLabel = res.init?.spreadsheetName || 'Google Sheet Klien';
        const totalSheets = res.init?.sheets?.length || 10;
        toast(`Sukses! "${sheetLabel}" terhubung & ${totalSheets} sheet + header siap!`, 'success');
        closeModal();
        render();
      } catch (err) {
        toast('Gagal: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = '✨ Hubungkan & Generate Otomatis';
      }
    };
  }

  // ==========================================================================
  // THEME & NAVIGATION
  // ==========================================================================
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', state.theme === 'dark' ? '#0F0A08' : '#F6F1EA');
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('cafe_cl_theme', state.theme);
    applyTheme();
    render();
  }

  function setRoute(route) {
    if (!hasPerm(route)) {
      toast('Role Anda tidak memiliki izin untuk membuka menu ini.', 'error');
      return;
    }
    state.route = route;
    state.sidebarOpen = false;
    state.mobileCartOpen = false;
    window.scrollTo({ top: 0, behavior: 'instant' });
    render();
  }

  // ==========================================================================
  // SVG ICONS
  // ==========================================================================
  const ICO = {
    dashboard: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>`,
    pos: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
    tables: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="6" rx="2"/><path d="M7 11v8"/><path d="M17 11v8"/></svg>`,
    menu: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>`,
    history: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    finance: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
    members: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    settings: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    bt: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5"/></svg>`,
    pc: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
    phone: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
    refresh: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`,
    search: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    sun: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
    moon: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
    logout: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
    burger: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`
  };

  // ==========================================================================
  // RENDER LOGIN SCREEN (AMAN, TANPA PASSWORD DEMO, DOWNLOAD PC & HP DI BAWAH)
  // ==========================================================================
  function renderLogin() {
    const cafeName = state.db.settings?.cafe_name || CFG.APP_NAME;
    const tagline = state.db.settings?.tagline || CFG.APP_TAGLINE;

    return `
      <div class="login-page">
        <aside class="login-hero">
          <div class="hero-top">
            <img src="./assets/icon.svg" alt="${esc(cafeName)}" />
            <div>
              <div class="hero-brand-name">${esc(cafeName)}</div>
              <div class="hero-brand-sub">${esc(tagline)}</div>
            </div>
          </div>

          <div class="hero-main">
            <div class="hero-kicker">✦ Smart Cafe Cashier PWA • v${esc(CFG.APP_VERSION)}</div>
            <h1 class="hero-headline">
              Crafting Moments in <em>Every Single Pour.</em>
            </h1>
            <p class="hero-desc">
              Platform kasir POS modern khusus cafe dengan cetak struk Bluetooth Thermal, denah meja, shift kasir, hak akses role aman, dan sinkronisasi otomatis ke Google Sheets.
            </p>
            <div class="hero-features">
              <div class="hero-feat-item">
                <div class="hero-feat-icon">${ICO.pos}</div>
                <div><strong>POS Kasir Kilat</strong><br/><span style="font-size:11px;color:#A99888">Varian, Open Bill & Struk WA</span></div>
              </div>
              <div class="hero-feat-item">
                <div class="hero-feat-icon">${ICO.bt}</div>
                <div><strong>Printer Thermal BT</strong><br/><span style="font-size:11px;color:#A99888">Cetak struk 58mm & 80mm</span></div>
              </div>
              <div class="hero-feat-item">
                <div class="hero-feat-icon">${ICO.tables}</div>
                <div><strong>Denah Meja Cafe</strong><br/><span style="font-size:11px;color:#A99888">Indoor, Bar & Outdoor</span></div>
              </div>
              <div class="hero-feat-item">
                <div class="hero-feat-icon">${ICO.refresh}</div>
                <div><strong>Auto-Update PWA</strong><br/><span style="font-size:11px;color:#A99888">Selalu versi terbaru otomatis</span></div>
              </div>
            </div>
          </div>

          <div class="hero-footer">
            <span>Sistem Kasir Terproteksi Role & PIN</span>
            <span class="mono">v${esc(CFG.APP_VERSION)} • ${esc(CFG.APP_BUILD)}</span>
          </div>
        </aside>

        <main class="login-panel">
          <div class="login-box">
            <div class="login-mobile-brand">
              <img src="./assets/icon.svg" alt="${esc(cafeName)}" />
              <div class="hero-brand-name" style="color:var(--gold-400)">${esc(cafeName)}</div>
              <div class="hero-brand-sub">${esc(tagline)}</div>
            </div>

            <div class="login-card">
              <div class="login-card-head">
                <div>
                  <h2 class="login-title">Masuk Kasir</h2>
                  <p class="login-sub">Gunakan akun staff atau PIN kasir Anda</p>
                </div>
                <button type="button" class="btn btn-secondary btn-icon" id="btn-theme-login" title="Ganti Tema">
                  ${state.theme === 'dark' ? ICO.sun : ICO.moon}
                </button>
              </div>

              <div class="auth-tabs">
                <button type="button" class="auth-tab ${state.loginMode === 'password' ? 'active' : ''}" data-login-mode="password">Akun & Sandi</button>
                <button type="button" class="auth-tab ${state.loginMode === 'pin' ? 'active' : ''}" data-login-mode="pin">PIN Cepat</button>
              </div>

              ${state.loginMode === 'password' ? `
                <form id="login-form">
                  <div class="field">
                    <label>Username</label>
                    <input id="login-username" class="input" type="text" placeholder="Masukkan username Anda" autocomplete="username" required />
                  </div>
                  <div class="field">
                    <label>Password</label>
                    <input id="login-password" class="input" type="password" placeholder="Masukkan kata sandi" autocomplete="current-password" required />
                  </div>
                  <button type="submit" class="btn btn-primary btn-lg btn-full" style="margin-top:4px">
                    Masuk ke Kasir →
                  </button>
                </form>
              ` : `
                <div>
                  <div style="text-align:center;font-size:12px;color:var(--text-secondary)">Masukkan 4 digit PIN Staff Anda</div>
                  <div class="pin-dots">
                    ${[0, 1, 2, 3].map((i) => `<span class="pin-dot ${state.pinBuffer.length > i ? 'filled' : ''}"></span>`).join('')}
                  </div>
                  <div class="pin-pad">
                    ${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => `
                      <button type="button" class="pin-key" data-pin-key="${k}">${k}</button>
                    `).join('')}
                  </div>
                </div>
              `}
            </div>

            <!-- DOWNLOAD APLIKASI UNTUK PC & HP DI BAWAH LOGIN -->
            <div class="download-app-box">
              <div class="download-app-header">
                <div class="download-app-title">
                  <span>⬇</span> Download Aplikasi CAFE CL
                </div>
                <span class="download-status-tag">
                  ${state.isStandalone ? '✓ Terinstall' : state.deferredPrompt ? 'Siap 1-Klik Install' : 'PWA PC & HP'}
                </span>
              </div>
              <div class="download-grid">
                <button type="button" class="btn-download-device" id="btn-download-pc">
                  <span class="dev-ico">${ICO.pc}</span>
                  <div>
                    <strong>Download untuk PC</strong>
                    <span>Windows & macOS</span>
                  </div>
                </button>
                <button type="button" class="btn-download-device" id="btn-download-hp">
                  <span class="dev-ico">${ICO.phone}</span>
                  <div>
                    <strong>Download untuk HP</strong>
                    <span>Android & iPhone</span>
                  </div>
                </button>
              </div>
            </div>

            <div class="login-meta-bar">
              <span>Auto-Update Aktif</span>
              <button type="button" class="link-subtle" id="btn-check-update-login">
                ${ICO.refresh} Cek Update (v${esc(CFG.APP_VERSION)})
              </button>
            </div>
          </div>
        </main>
      </div>
    `;
  }

  // ==========================================================================
  // RENDER APP SHELL (FOKUS KASIR + BT MERAH/HIJAU + RBAC NAVIGATION)
  // ==========================================================================
  function getOpenBillsCount() {
    return (state.db.orders || []).filter((o) => o.status_bayar === 'Open Bill').length;
  }

  function renderAppShell() {
    if (!hasPerm(state.route)) {
      state.route = getFirstAllowedRoute();
    }

    const cafeName = state.db.settings?.cafe_name || CFG.APP_NAME;
    const openBills = getOpenBillsCount();
    const connected = API.isConnected();
    const pendingQ = API.getQueue().length;

    const allNavItems = [
      { id: 'dashboard', label: 'Dashboard', icon: ICO.dashboard, section: 'Kasir' },
      { id: 'pos', label: 'Kasir POS', icon: ICO.pos, section: 'Kasir' },
      { id: 'tables', label: 'Meja Cafe', icon: ICO.tables, badge: openBills || null, section: 'Kasir' },
      { id: 'history', label: 'Riwayat Order', icon: ICO.history, section: 'Kasir' },
      { id: 'menu', label: 'Kelola Menu', icon: ICO.menu, section: 'Manajemen' },
      { id: 'finance', label: 'Keuangan & Shift', icon: ICO.finance, section: 'Manajemen' },
      { id: 'members', label: 'Member Loyal', icon: ICO.members, section: 'Manajemen' },
      { id: 'settings', label: 'Pengaturan', icon: ICO.settings, section: 'Sistem' }
    ].filter((item) => hasPerm(item.id));

    const routeTitles = {
      dashboard: 'Dashboard Eksekutif',
      pos: 'Kasir POS Cafe',
      tables: 'Denah Meja Cafe',
      menu: 'Manajemen Menu & Stok',
      history: 'Riwayat Transaksi',
      finance: 'Keuangan, Shift & Laba Rugi',
      members: 'Member & Poin Loyalitas',
      settings: 'Pengaturan Sistem & Staff'
    };

    let currentSection = '';
    const sidebarNavHTML = allNavItems.map((item) => {
      let secHeader = '';
      if (item.section !== currentSection) {
        currentSection = item.section;
        secHeader = `<div class="nav-section-label">${item.section}</div>`;
      }
      return `
        ${secHeader}
        <button type="button" class="nav-item ${state.route === item.id ? 'active' : ''}" data-nav="${item.id}">
          ${item.icon}
          <span>${item.label}</span>
          ${item.badge ? `<span class="nav-badge">${item.badge}</span>` : ''}
        </button>
      `;
    }).join('');

    // Mobile bottom nav (maksimal 5 menu sesuai hak akses role!)
    const mobileNavPool = [
      { id: 'dashboard', label: 'Home', icon: ICO.dashboard },
      { id: 'pos', label: 'Kasir', icon: ICO.pos },
      { id: 'tables', label: 'Meja', icon: ICO.tables, badge: openBills },
      { id: 'history', label: 'Riwayat', icon: ICO.history },
      { id: 'settings', label: 'Setelan', icon: ICO.settings },
      { id: 'finance', label: 'Shift', icon: ICO.finance }
    ].filter((x) => hasPerm(x.id)).slice(0, 5);

    const initials = (state.user?.nama || 'CL').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const btShortName = state.btName ? (state.btName.length > 14 ? state.btName.slice(0, 14) + '…' : state.btName) : 'Konek';

    return `
      <div class="app-shell">
        <div class="sidebar-backdrop ${state.sidebarOpen ? 'open' : ''}" id="sidebar-backdrop"></div>

        <aside class="sidebar ${state.sidebarOpen ? 'open' : ''}">
          <div class="sidebar-brand">
            <img src="./assets/icon.svg" alt="${esc(cafeName)}" />
            <div>
              <div class="sidebar-brand-title">${esc(cafeName)}</div>
              <div class="sidebar-brand-sub">v${esc(CFG.APP_VERSION)} • Kasir</div>
            </div>
          </div>

          <nav class="sidebar-nav">
            ${sidebarNavHTML}
          </nav>

          <div class="sidebar-footer">
            ${!state.isStandalone ? `
              <button type="button" class="btn btn-secondary btn-sm btn-full" id="btn-install-sidebar">
                ⬇ Install Aplikasi PC/HP
              </button>
            ` : ''}
            <div class="user-chip">
              <div class="user-avatar">${esc(initials)}</div>
              <div class="user-meta">
                <strong>${esc(state.user?.nama || 'Staff')}</strong>
                <span>${esc(state.user?.role || 'Kasir')}</span>
              </div>
              <button type="button" class="btn btn-ghost btn-icon" id="btn-logout" title="Keluar">${ICO.logout}</button>
            </div>
          </div>
        </aside>

        <div class="main-area">
          <header class="topbar">
            <div class="topbar-left">
              <button type="button" class="btn btn-secondary btn-icon mobile-menu-btn" id="btn-toggle-sidebar">${ICO.burger}</button>
              <h1 class="page-title">${routeTitles[state.route] || cafeName}</h1>
            </div>
            <div class="topbar-right">
              <!-- INDIKATOR BLUETOOTH THERMAL PRINTER: MERAH BELUM KONEK, HIJAU SUDAH KONEK -->
              <button type="button" class="bt-pill ${state.btConnected ? 'connected' : 'disconnected'}" id="btn-bt-status" title="Printer Thermal Bluetooth">
                <span class="bt-dot"></span>
                ${ICO.bt}
                <span>BT</span>
                <span class="bt-label-full">${state.btConnected ? '• ' + esc(btShortName) : '• Belum Konek'}</span>
              </button>

              <button type="button" class="sync-pill" id="btn-sync-cloud" title="Status Sinkronisasi Cloud">
                <span class="sync-dot ${state.syncing ? 'syncing' : connected ? 'online' : ''}"></span>
                <span class="sync-text">${state.syncing ? 'Sinkron...' : connected ? (pendingQ ? `Antre ${pendingQ}` : 'Cloud Aktif') : 'Mode Lokal'}</span>
              </button>
              <button type="button" class="btn btn-secondary btn-icon" id="btn-check-update-top" title="Cek Update Terbaru">${ICO.refresh}</button>
              <button type="button" class="btn btn-secondary btn-icon" id="btn-theme-top" title="Tema Gelap/Terang">
                ${state.theme === 'dark' ? ICO.sun : ICO.moon}
              </button>
            </div>
          </header>

          <main class="content-body">
            ${renderRouteView()}
          </main>
        </div>

        <nav class="mobile-bottom-nav" style="grid-template-columns:repeat(${mobileNavPool.length},1fr)">
          ${mobileNavPool.map((b) => `
            <button type="button" class="bnav-btn ${state.route === b.id ? 'active' : ''}" data-nav="${b.id}">
              ${b.icon}
              <span>${b.label}</span>
              ${b.badge ? `<span style="position:absolute;top:6px;right:18%;min-width:16px;height:16px;padding:0 4px;border-radius:99px;background:var(--gold-400);color:#160E0A;font-size:10px;font-weight:800;display:grid;place-items:center">${b.badge}</span>` : ''}
            </button>
          `).join('')}
        </nav>
      </div>
    `;
  }

  function renderRouteView() {
    switch (state.route) {
      case 'dashboard': return renderDashboard();
      case 'pos': return renderPOS();
      case 'tables': return renderTables();
      case 'menu': return renderMenuManager();
      case 'history': return renderHistory();
      case 'finance': return renderFinance();
      case 'members': return renderMembers();
      case 'settings': return renderSettings();
      default: return renderPOS();
    }
  }

  // ==========================================================================
  // VIEW 1: DASHBOARD EKSEKUTIF (FOKUS KASIR)
  // ==========================================================================
  function renderDashboard() {
    const today = todayISO();
    const validOrders = (state.db.orders || []).filter((o) => o.status_bayar !== 'Dibatalkan');
    const todayOrders = validOrders.filter((o) => String(o.tanggal).slice(0, 10) === today);
    const todayRevenue = todayOrders.reduce((s, o) => s + Number(o.total || 0), 0);

    let todayHpp = 0;
    let todayCups = 0;
    todayOrders.forEach((o) => {
      (o.items || []).forEach((it) => {
        const q = Number(it.qty || 1);
        todayHpp += Number(it.hpp || 0) * q;
        todayCups += q;
      });
    });

    const todayExpense = (state.db.expenses || [])
      .filter((e) => String(e.tanggal).slice(0, 10) === today)
      .reduce((s, e) => s + Number(e.nominal || 0), 0);
    const todayProfit = todayRevenue - todayHpp - todayExpense;

    const occupiedTables = (state.db.tables || []).filter((t) => t.status === 'Terisi').length;
    const totalTables = (state.db.tables || []).length;
    const openBills = getOpenBillsCount();

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
      const iso = tz.toISOString().slice(0, 10);
      const rev = validOrders
        .filter((o) => String(o.tanggal).slice(0, 10) === iso)
        .reduce((s, o) => s + Number(o.total || 0), 0);
      days.push({ label: d.toLocaleDateString('id-ID', { weekday: 'short' }), iso, rev });
    }
    const maxRev = Math.max(...days.map((d) => d.rev), 100000);

    const menuCounts = {};
    validOrders.forEach((o) => {
      (o.items || []).forEach((it) => {
        const key = it.nama || 'Menu';
        if (!menuCounts[key]) menuCounts[key] = { nama: key, qty: 0, rev: 0 };
        menuCounts[key].qty += Number(it.qty || 1);
        menuCounts[key].rev += Number(it.harga || 0) * Number(it.qty || 1);
      });
    });
    const topMenus = Object.values(menuCounts).sort((a, b) => b.qty - a.qty).slice(0, 5);

    const payMap = {};
    validOrders.forEach((o) => {
      const m = o.metode_bayar || 'Tunai';
      payMap[m] = (payMap[m] || 0) + Number(o.total || 0);
    });
    const totalAllRev = Object.values(payMap).reduce((a, b) => a + b, 0) || 1;

    return `
      ${!API.isConnected() && hasPerm('settings') ? `
        <div class="card" style="margin-bottom:18px;border-color:var(--border-strong);background:linear-gradient(135deg, rgba(216,167,91,0.14), rgba(216,167,91,0.03));display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
          <div>
            <div style="font-weight:700;color:var(--gold-300)">✦ Hubungkan Sinkronisasi Google Sheets (Khusus Owner)</div>
            <div style="font-size:12.5px;color:var(--text-secondary)">Saat ini aplikasi berjalan dalam Mode Lokal. Masukkan URL endpoint Web App untuk menyinkronkan data & auto-generate sheet.</div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="btn-dash-connect-gas">Atur Koneksi Server</button>
        </div>
      ` : ''}

      <section class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-head">
            <span class="kpi-label">Omzet Hari Ini</span>
            <span class="kpi-ico">${ICO.finance}</span>
          </div>
          <div class="kpi-value">${fmtRp(todayRevenue)}</div>
          <div class="kpi-sub">${todayOrders.length} transaksi • ${todayCups} item terjual</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-head">
            <span class="kpi-label">Estimasi Profit Bersih</span>
            <span class="kpi-ico">✦</span>
          </div>
          <div class="kpi-value ${todayProfit >= 0 ? 'text-success' : 'text-danger'}">${fmtRp(todayProfit)}</div>
          <div class="kpi-sub">Omzet − HPP − Pengeluaran</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-head">
            <span class="kpi-label">Open Bill Aktif</span>
            <span class="kpi-ico">${ICO.history}</span>
          </div>
          <div class="kpi-value">${openBills} <span style="font-size:13px;font-weight:500;color:var(--text-secondary)">tagihan</span></div>
          <div class="kpi-sub"><button type="button" class="link-subtle" data-nav="tables">Lihat Meja / Tagihan →</button></div>
        </div>
        <div class="kpi-card">
          <div class="kpi-head">
            <span class="kpi-label">Okupansi Meja</span>
            <span class="kpi-ico">${ICO.tables}</span>
          </div>
          <div class="kpi-value">${occupiedTables} / ${totalTables}</div>
          <div class="kpi-sub"><button type="button" class="link-subtle" data-nav="pos">+ Buka Kasir POS →</button></div>
        </div>
      </section>

      <section class="dash-grid">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Tren Penjualan 7 Hari Terakhir</div>
              <div class="card-subtitle">Akumulasi omzet harian CAFE CL</div>
            </div>
            ${hasPerm('pos') ? `<button type="button" class="btn btn-primary btn-sm" data-nav="pos">+ Pesanan Baru</button>` : ''}
          </div>
          <div class="bar-chart">
            ${days.map((d) => {
              const pct = Math.max(4, Math.round((d.rev / maxRev) * 100));
              const shortVal = d.rev >= 1000000 ? (d.rev / 1000000).toFixed(1) + 'jt' : d.rev >= 1000 ? Math.round(d.rev / 1000) + 'k' : '0';
              return `
                <div class="bar-col" title="${d.iso}: ${fmtRp(d.rev)}">
                  <div class="bar-val">${shortVal}</div>
                  <div class="bar-fill-wrap">
                    <div class="bar-fill" style="height:${pct}%"></div>
                  </div>
                  <div class="bar-label">${esc(d.label)}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Menu Paling Laris</div>
              <div class="card-subtitle">Top 5 favorit pelanggan</div>
            </div>
          </div>
          <div class="top-menu-list">
            ${topMenus.length ? topMenus.map((m, i) => `
              <div class="top-menu-row">
                <div class="rank-num">#${i + 1}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.nama)}</div>
                  <div style="font-size:11.5px;color:var(--text-secondary)">${m.qty} cup/porsi terjual</div>
                </div>
                <div class="mono text-gold" style="font-size:12.5px;font-weight:700">${fmtRp(m.rev)}</div>
              </div>
            `).join('') : `<div class="empty-state">Belum ada data penjualan.</div>`}
          </div>
        </div>
      </section>

      <section class="dash-grid">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Transaksi Terakhir</div>
              <div class="card-subtitle">Pembayaran & Open Bill terbaru</div>
            </div>
            ${hasPerm('history') ? `<button type="button" class="btn btn-secondary btn-sm" data-nav="history">Lihat Semua</button>` : ''}
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr><th>Invoice</th><th>Pelanggan / Meja</th><th>Total</th><th>Status</th></tr>
              </thead>
              <tbody>
                ${(state.db.orders || []).slice().reverse().slice(0, 6).map((o) => `
                  <tr>
                    <td class="mono" style="font-size:12px">${esc(o.no_invoice)}</td>
                    <td><strong>${esc(o.pelanggan)}</strong><br/><span style="font-size:11px;color:var(--text-secondary)">${esc(o.tipe_order)} ${o.meja && o.meja !== '-' ? '• ' + esc(o.meja) : ''}</span></td>
                    <td class="mono" style="font-weight:700">${fmtRp(o.total)}</td>
                    <td>
                      <span class="badge ${o.status_bayar === 'Lunas' ? 'badge-success' : o.status_bayar === 'Open Bill' ? 'badge-warning' : 'badge-danger'}">${esc(o.status_bayar)}</span>
                    </td>
                  </tr>
                `).join('') || `<tr><td colspan="4" class="empty-state">Belum ada pesanan.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Metode Pembayaran</div>
              <div class="card-subtitle">Distribusi transaksi</div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:12px">
            ${Object.keys(payMap).length ? Object.entries(payMap).map(([method, val]) => {
              const pct = Math.round((val / totalAllRev) * 100);
              return `
                <div>
                  <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px">
                    <strong>${esc(method)}</strong>
                    <span class="mono">${fmtRp(val)} (${pct}%)</span>
                  </div>
                  <div style="height:8px;border-radius:99px;background:rgba(216,167,91,0.12);overflow:hidden">
                    <div style="height:100%;width:${pct}%;border-radius:99px;background:linear-gradient(90deg,var(--gold-500),var(--gold-300))"></div>
                  </div>
                </div>
              `;
            }).join('') : `<div class="empty-state">Belum ada transaksi.</div>`}
          </div>
        </div>
      </section>
    `;
  }

  // ==========================================================================
  // VIEW 2: POS KASIR
  // ==========================================================================
  function calcCartTotals() {
    const subtotal = state.cart.reduce((s, it) => s + Number(it.harga) * Number(it.qty), 0);
    const diskon = Math.min(subtotal, Math.max(0, Number(state.discount) || 0));
    const afterDisc = subtotal - diskon;
    const taxPct = Number(state.db.settings?.tax_percent ?? 10);
    const srvPct = Number(state.db.settings?.service_percent ?? 0);
    const pajak = Math.round(afterDisc * (taxPct / 100));
    const service = Math.round(afterDisc * (srvPct / 100));
    const total = afterDisc + pajak + service;
    return { subtotal, diskon, pajak, service, total, taxPct, srvPct };
  }

  function renderPOS() {
    const categories = ['Semua', 'Favorit', 'Signature', 'Espresso', 'Non-Coffee', 'Tea', 'Pastry', 'Food'];
    const q = state.posSearch.trim().toLowerCase();
    const filteredMenu = (state.db.menu || []).filter((m) => {
      if (state.posCategory === 'Favorit' && !m.favorit) return false;
      if (state.posCategory !== 'Semua' && state.posCategory !== 'Favorit' && m.kategori !== state.posCategory) return false;
      if (q && !(m.nama.toLowerCase().includes(q) || (m.kode || '').toLowerCase().includes(q) || (m.deskripsi || '').toLowerCase().includes(q))) return false;
      return true;
    });

    const totals = calcCartTotals();
    const cartCount = state.cart.reduce((s, i) => s + i.qty, 0);

    return `
      <div class="pos-layout">
        <div>
          <div class="pos-toolbar">
            <div class="search-wrap">
              ${ICO.search}
              <input id="pos-search-input" class="input" type="search" placeholder="Cari kopi, matcha, croissant, kode menu..." value="${esc(state.posSearch)}" />
            </div>
            ${state.editingOrderId ? `<span class="badge badge-warning">Menyelesaikan Open Bill</span>` : ''}
          </div>

          <div class="cat-pills">
            ${categories.map((c) => `
              <button type="button" class="cat-pill ${state.posCategory === c ? 'active' : ''}" data-pos-cat="${esc(c)}">
                ${c === 'Favorit' ? '★ ' : ''}${esc(c)}
              </button>
            `).join('')}
          </div>

          <div class="menu-grid">
            ${filteredMenu.map((m) => {
              const soldOut = !m.tersedia || Number(m.stok) <= 0;
              const imgUrl = safeUrl(m.foto_url);
              return `
                <article class="menu-card ${soldOut ? 'sold-out' : ''}" data-pick-menu="${esc(m.id)}">
                  <div class="menu-thumb">
                    ${imgUrl ? `<img src="${esc(imgUrl)}" alt="${esc(m.nama)}" loading="lazy" />` : `<span class="menu-art-emoji">${categoryIcon(m.kategori)}</span>`}
                    <span class="menu-cat-tag">${esc(m.kategori)}</span>
                    ${m.favorit ? `<span class="menu-fav-star">★</span>` : ''}
                  </div>
                  <div class="menu-body">
                    <div class="menu-name">${esc(m.nama)}</div>
                    <div class="menu-desc">${esc(m.deskripsi || 'Menu spesial racikan CAFE CL')}</div>
                    <div class="menu-foot">
                      <span class="menu-price">${fmtRp(m.harga)}</span>
                      <span class="menu-stock">${soldOut ? 'Habis' : `Stok ${m.stok}`}</span>
                    </div>
                  </div>
                </article>
              `;
            }).join('') || `<div class="empty-state" style="grid-column:1/-1"><div class="empty-ico">☕</div>Menu tidak ditemukan.</div>`}
          </div>
        </div>

        <!-- ORDER CART PANEL (PC & TABLET STICKY / MOBILE SLIDE-UP SHEET) -->
        <div class="cart-backdrop ${state.mobileCartOpen ? 'open' : ''}" id="cart-backdrop"></div>
        <aside class="cart-panel ${state.mobileCartOpen ? 'mobile-open' : ''}">
          <div class="cart-grabber"></div>
          <div class="cart-head">
            <div>
              <strong style="font-size:15px">Keranjang Kasir</strong>
              <div style="font-size:11.5px;color:var(--text-secondary)">${cartCount} item dipilih</div>
            </div>
            <div style="display:flex;gap:6px">
              ${state.cart.length ? `<button type="button" class="btn btn-ghost btn-sm text-danger" id="btn-clear-cart">Hapus</button>` : ''}
              <button type="button" class="btn btn-secondary btn-icon cart-close-mobile" id="btn-close-mobile-cart" aria-label="Tutup Keranjang">✕</button>
            </div>
          </div>

          <div class="order-type-tabs">
            ${['Dine-In', 'Take Away', 'Delivery'].map((t) => `
              <button type="button" class="type-btn ${state.orderType === t ? 'active' : ''}" data-order-type="${t}">${t}</button>
            `).join('')}
          </div>

          <div class="cart-meta-inputs">
            <input id="cart-customer" class="input" placeholder="Nama Pelanggan" value="${esc(state.customerName)}" />
            <select id="cart-member" class="select">
              <option value="">-- Member (Opsional) --</option>
              ${(state.db.members || []).map((m) => `
                <option value="${esc(m.id)}" ${state.selectedMemberId === m.id ? 'selected' : ''}>${esc(m.nama)} (${m.poin} pt)</option>
              `).join('')}
            </select>
            ${state.orderType === 'Dine-In' ? `
              <select id="cart-table" class="select" style="grid-column:1/-1">
                <option value="">-- Pilih Meja Cafe --</option>
                ${(state.db.tables || []).map((t) => `
                  <option value="${esc(t.nama)}" ${state.selectedTable === t.nama ? 'selected' : ''}>
                    ${esc(t.nama)} — ${esc(t.area)} (${esc(t.status)})
                  </option>
                `).join('')}
              </select>
            ` : ''}
          </div>

          <div class="cart-items">
            ${state.cart.length ? state.cart.map((it, idx) => `
              <div class="cart-item">
                <div class="cart-item-info">
                  <div class="cart-item-name">${esc(it.nama)}</div>
                  ${it.varian ? `<div class="cart-item-var">${esc(it.varian)}</div>` : ''}
                  ${it.catatan ? `<div class="cart-item-note">"${esc(it.catatan)}"</div>` : ''}
                  <div class="cart-qty-ctrl">
                    <button type="button" class="qty-btn" data-qty-dec="${idx}">−</button>
                    <span class="mono" style="min-width:20px;text-align:center;font-weight:700">${it.qty}</span>
                    <button type="button" class="qty-btn" data-qty-inc="${idx}">+</button>
                  </div>
                </div>
                <div style="text-align:right">
                  <div class="mono" style="font-weight:700;font-size:13px">${fmtRp(it.harga * it.qty)}</div>
                  <div style="font-size:10.5px;color:var(--text-muted)">@${fmtRp(it.harga)}</div>
                </div>
              </div>
            `).join('') : `
              <div class="empty-state" style="padding:28px 10px">
                <div class="empty-ico">☕</div>
                <div>Ketuk menu untuk mulai mencatat pesanan</div>
              </div>
            `}
          </div>

          <div class="cart-summary">
            <div style="display:flex;gap:8px;margin-bottom:10px">
              <input id="cart-discount" class="input mono" type="number" min="0" placeholder="Diskon (Rp)" value="${state.discount || ''}" style="padding:7px 10px;font-size:12px" />
              <input id="cart-note" class="input" placeholder="Catatan order..." value="${esc(state.orderNote)}" style="padding:7px 10px;font-size:12px" />
            </div>
            <div id="cart-totals-box">
              ${renderCartTotalsHTML(totals)}
            </div>

            <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:8px;margin-top:12px">
              <button type="button" class="btn btn-secondary" id="btn-open-bill" ${!state.cart.length ? 'disabled' : ''}>Open Bill</button>
              <button type="button" class="btn btn-primary" id="btn-checkout" ${!state.cart.length ? 'disabled' : ''}>Bayar Sekarang</button>
            </div>
          </div>
        </aside>

        <button type="button" class="mobile-cart-fab" id="btn-open-mobile-cart">
          <span>🛒 ${cartCount} Item • Lihat Keranjang</span>
          <span class="mono">${fmtRp(totals.total)} →</span>
        </button>
      </div>
    `;
  }

  function renderCartTotalsHTML(totals) {
    return `
      <div class="sum-row"><span>Subtotal</span><span class="mono">${fmtRp(totals.subtotal)}</span></div>
      ${totals.diskon > 0 ? `<div class="sum-row text-success"><span>Diskon</span><span class="mono">−${fmtRp(totals.diskon)}</span></div>` : ''}
      ${totals.taxPct > 0 ? `<div class="sum-row"><span>Pajak PB1 (${totals.taxPct}%)</span><span class="mono">${fmtRp(totals.pajak)}</span></div>` : ''}
      ${totals.srvPct > 0 ? `<div class="sum-row"><span>Service (${totals.srvPct}%)</span><span class="mono">${fmtRp(totals.service)}</span></div>` : ''}
      <div class="sum-row total"><span>Total Bayar</span><span class="mono text-gold">${fmtRp(totals.total)}</span></div>
    `;
  }

  function openMenuVariantModal(menuId) {
    const m = (state.db.menu || []).find((x) => x.id === menuId);
    if (!m) return;

    const groups = String(m.varian || '')
      .split('|')
      .map((g) => g.split(',').map((s) => s.trim()).filter(Boolean))
      .filter((arr) => arr.length > 0);

    const selectedOpts = groups.map((g) => g[0]);
    let savedNote = '';

    function calcExtra() {
      let extra = 0;
      selectedOpts.forEach((opt) => {
        const match = opt.match(/\(\+(\d+)\)/);
        if (match) extra += Number(match[1]);
      });
      return extra;
    }

    const renderModalBody = () => {
      const unitPrice = Number(m.harga) + calcExtra();
      openModal(`
        <div class="modal-head">
          <div>
            <div class="modal-title">${esc(m.nama)}</div>
            <div class="mono text-gold" style="font-weight:700">${fmtRp(unitPrice)}</div>
          </div>
          <button type="button" class="modal-close-btn" data-close-modal aria-label="Tutup">✕</button>
        </div>
        ${m.deskripsi ? `<p style="font-size:12.5px;color:var(--text-secondary);margin-bottom:14px">${esc(m.deskripsi)}</p>` : ''}
        ${groups.map((g, gi) => `
          <div class="field">
            <label>Pilihan ${gi + 1}</label>
            <div class="option-chip-group">
              ${g.map((opt) => `
                <button type="button" class="option-chip ${selectedOpts[gi] === opt ? 'active' : ''}" data-opt-g="${gi}" data-opt-v="${esc(opt)}">${esc(opt)}</button>
              `).join('')}
            </div>
          </div>
        `).join('')}
        <div class="field">
          <label>Catatan Pesanan (Opsional)</label>
          <input id="item-note-input" class="input" placeholder="Misal: es sedikit, ekstra panas, pisah gula..." value="${esc(savedNote)}" />
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-close-modal>Batal</button>
          <button type="button" class="btn btn-primary" id="btn-confirm-add-cart">+ Tambah • ${fmtRp(unitPrice)}</button>
        </div>
      `);

      const noteEl = document.getElementById('item-note-input');
      noteEl?.addEventListener('input', (e) => { savedNote = e.target.value; });

      document.querySelectorAll('[data-opt-g]').forEach((btn) => {
        btn.onclick = () => {
          const gi = Number(btn.dataset.optG);
          selectedOpts[gi] = btn.dataset.optV;
          renderModalBody();
        };
      });

      document.getElementById('btn-confirm-add-cart').onclick = () => {
        const note = (document.getElementById('item-note-input')?.value || '').trim();
        const varianStr = selectedOpts.join(' • ');
        const finalPrice = Number(m.harga) + calcExtra();
        const existing = state.cart.find(
          (c) => c.menu_id === m.id && c.varian === varianStr && c.catatan === note
        );
        if (existing) {
          existing.qty += 1;
        } else {
          state.cart.push({
            menu_id: m.id,
            nama: m.nama,
            kategori: m.kategori,
            varian: varianStr,
            catatan: note,
            qty: 1,
            harga: finalPrice,
            hpp: Number(m.hpp || 0)
          });
        }
        closeModal();
        toast(`${m.nama} ditambahkan`, 'success');
        render();
      };
    };

    renderModalBody();
  }

  function openCheckoutModal(isOpenBill = false) {
    if (!state.cart.length || state.submittingOrder) return;
    if (state.orderType === 'Dine-In' && !state.selectedTable) {
      toast('Silakan pilih meja terlebih dahulu untuk Dine-In.', 'error');
      return;
    }

    const totals = calcCartTotals();

    if (isOpenBill) {
      finalizeOrder({
        metode_bayar: 'Belum Bayar',
        bayar: 0,
        kembalian: 0,
        status_bayar: 'Open Bill'
      });
      return;
    }

    let payMethod = 'QRIS';
    let cashReceived = totals.total;

    const drawPayModal = () => {
      const change = payMethod === 'Tunai' ? Math.max(0, cashReceived - totals.total) : 0;
      const quickAmounts = [totals.total, 50000, 100000, 150000, 200000].filter((v, i, a) => a.indexOf(v) === i);

      openModal(`
        <div class="modal-head">
          <div>
            <div class="modal-title">Pembayaran Kasir</div>
            <div style="font-size:12px;color:var(--text-secondary)">${esc(state.orderType)} ${state.selectedTable ? '• ' + esc(state.selectedTable) : ''}</div>
          </div>
          <button type="button" class="modal-close-btn" data-close-modal aria-label="Tutup">✕</button>
        </div>

        <div class="card" style="background:var(--bg-elevated);text-align:center;margin-bottom:16px">
          <div style="font-size:12px;color:var(--text-secondary)">Total Tagihan</div>
          <div class="mono text-gold" style="font-size:28px;font-weight:800">${fmtRp(totals.total)}</div>
        </div>

        <div class="field">
          <label>Metode Pembayaran</label>
          <div class="option-chip-group">
            ${['QRIS', 'Tunai', 'Debit/Kartu', 'Transfer', 'E-Wallet'].map((m) => `
              <button type="button" class="option-chip ${payMethod === m ? 'active' : ''}" data-pay-method="${m}">${m}</button>
            `).join('')}
          </div>
        </div>

        ${payMethod === 'Tunai' ? `
          <div class="field">
            <label>Uang Diterima (Rp)</label>
            <input id="pay-cash-input" class="input mono" type="number" min="0" value="${cashReceived}" />
            <div class="option-chip-group" style="margin-top:8px">
              ${quickAmounts.map((amt) => `
                <button type="button" class="option-chip" data-quick-cash="${amt}">${amt === totals.total ? 'Uang Pas' : fmtRp(amt)}</button>
              `).join('')}
            </div>
          </div>
          <div class="sum-row" style="font-size:15px;font-weight:700;padding:8px 0">
            <span>Kembalian</span>
            <span id="pay-change-val" class="mono text-success">${fmtRp(change)}</span>
          </div>
        ` : ''}

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-close-modal>Batal</button>
          <button type="button" class="btn btn-primary btn-lg" id="btn-confirm-pay">Selesaikan & Struk ✓</button>
        </div>
      `);

      document.querySelectorAll('[data-pay-method]').forEach((b) => {
        b.onclick = () => {
          payMethod = b.dataset.payMethod;
          cashReceived = totals.total;
          drawPayModal();
        };
      });

      document.querySelectorAll('[data-quick-cash]').forEach((b) => {
        b.onclick = () => {
          cashReceived = Number(b.dataset.quickCash);
          drawPayModal();
        };
      });

      const cashInput = document.getElementById('pay-cash-input');
      if (cashInput) {
        cashInput.oninput = () => {
          cashReceived = Math.max(0, Number(cashInput.value) || 0);
          const chEl = document.getElementById('pay-change-val');
          if (chEl) chEl.textContent = fmtRp(Math.max(0, cashReceived - totals.total));
        };
      }

      document.getElementById('btn-confirm-pay').onclick = () => {
        if (payMethod === 'Tunai' && cashReceived < totals.total) {
          toast('Uang diterima kurang dari total tagihan!', 'error');
          return;
        }
        finalizeOrder({
          metode_bayar: payMethod,
          bayar: payMethod === 'Tunai' ? cashReceived : totals.total,
          kembalian: payMethod === 'Tunai' ? Math.max(0, cashReceived - totals.total) : 0,
          status_bayar: 'Lunas'
        });
      };
    };

    drawPayModal();
  }

  async function finalizeOrder(paymentInfo) {
    if (state.submittingOrder) return;
    state.submittingOrder = true;
    try {
      const totals = calcCartTotals();
      const today = todayISO();
      const existingIdx = state.editingOrderId
        ? state.db.orders.findIndex((o) => o.id === state.editingOrderId)
        : -1;

      const orderId = existingIdx >= 0 ? state.db.orders[existingIdx].id : ('ORD-' + Date.now());
      const invoice = existingIdx >= 0
        ? state.db.orders[existingIdx].no_invoice
        : ('INV-' + today.replace(/-/g, '') + '-' + String(Math.floor(100 + Math.random() * 900)));

      const order = {
        id: orderId,
        no_invoice: invoice,
        tanggal: today,
        waktu: nowTime(),
        kasir: state.user?.nama || 'Kasir',
        pelanggan: state.customerName.trim() || 'Tamu Walk-in',
        tipe_order: state.orderType,
        meja: state.orderType === 'Dine-In' ? state.selectedTable : '-',
        items: JSON.parse(JSON.stringify(state.cart)),
        subtotal: totals.subtotal,
        diskon: totals.diskon,
        pajak: totals.pajak,
        service_charge: totals.service,
        total: totals.total,
        metode_bayar: paymentInfo.metode_bayar,
        bayar: paymentInfo.bayar,
        kembalian: paymentInfo.kembalian,
        status_bayar: paymentInfo.status_bayar,
        status_dapur: 'Selesai',
        catatan: state.orderNote.trim(),
        member_id: state.selectedMemberId || ''
      };

      if (existingIdx >= 0) {
        // Hitung selisih qty item lama vs baru agar stok selalu akurat saat edit Open Bill
        const oldOrder = state.db.orders[existingIdx];
        const oldQtyMap = {};
        (oldOrder.items || []).forEach((it) => {
          oldQtyMap[it.menu_id] = (oldQtyMap[it.menu_id] || 0) + Number(it.qty || 1);
        });
        const newQtyMap = {};
        order.items.forEach((it) => {
          newQtyMap[it.menu_id] = (newQtyMap[it.menu_id] || 0) + Number(it.qty || 1);
        });
        const allIds = new Set([...Object.keys(oldQtyMap), ...Object.keys(newQtyMap)]);
        allIds.forEach((mid) => {
          const delta = (newQtyMap[mid] || 0) - (oldQtyMap[mid] || 0);
          if (delta !== 0) {
            const m = state.db.menu.find((x) => x.id === mid);
            if (m) m.stok = Math.max(0, Number(m.stok || 0) - delta);
          }
        });
        state.db.orders[existingIdx] = order;
      } else {
        state.db.orders.push(order);
        order.items.forEach((it) => {
          const m = state.db.menu.find((x) => x.id === it.menu_id);
          if (m) m.stok = Math.max(0, Number(m.stok) - Number(it.qty));
        });
      }

      // Update status Meja otomatis: Open Bill -> Terisi, Lunas -> Tersedia
      if (order.tipe_order === 'Dine-In' && order.meja !== '-') {
        const tbl = state.db.tables.find((t) => t.nama === order.meja);
        if (tbl) {
          const isOpen = order.status_bayar === 'Open Bill';
          tbl.status = isOpen ? 'Terisi' : 'Tersedia';
          tbl.order_aktif = isOpen ? order.no_invoice : '';
        }
      }

      // Update poin Member otomatis saat Lunas
      if (order.member_id && order.status_bayar === 'Lunas') {
        const mbr = state.db.members.find((m) => m.id === order.member_id);
        if (mbr) {
          mbr.poin += Math.floor(order.total / 10000);
          mbr.total_belanja += order.total;
          mbr.kunjungan += 1;
          mbr.tier = mbr.total_belanja >= 3000000 ? 'Signature' : mbr.total_belanja >= 1200000 ? 'Gold' : mbr.total_belanja >= 400000 ? 'Silver' : 'Bronze';
        }
      }

      API.saveLocal(state.db);
      API.sendAction('saveOrder', order);

      state.cart = [];
      state.customerName = '';
      state.selectedTable = '';
      state.selectedMemberId = '';
      state.orderNote = '';
      state.discount = 0;
      state.editingOrderId = null;
      state.mobileCartOpen = false;

      closeModal();
      render();
      toast(order.status_bayar === 'Open Bill' ? `Open Bill ${order.no_invoice} tersimpan!` : `Pembayaran ${order.no_invoice} berhasil!`, 'success');

      // Auto-print Bluetooth Thermal jika aktif & terhubung
      if (state.db.settings?.auto_print_bt && state.btConnected && order.status_bayar === 'Lunas') {
        Printer.printOrderReceipt(order, state.db.settings)
          .then(() => toast('Struk otomatis tercetak di Printer Bluetooth!', 'success'))
          .catch((err) => toast('Auto-print BT gagal: ' + err.message, 'error'));
      }

      openReceiptModal(order);
    } finally {
      state.submittingOrder = false;
    }
  }

  function openReceiptModal(order) {
    const s = state.db.settings || CFG.DEFAULT_SETTINGS;
    const receiptHTML = `
      <div style="font-family:var(--font-mono);font-size:12px;background:#fff;color:#111;padding:18px;border-radius:14px">
        <div style="text-align:center;margin-bottom:10px">
          <div style="font-size:16px;font-weight:800;letter-spacing:2px">${esc(s.cafe_name || 'CAFE CL')}</div>
          <div style="font-size:11px">${esc(s.address || '')}</div>
          <div style="font-size:11px">${esc(s.phone || '')} ${s.instagram ? '• ' + esc(s.instagram) : ''}</div>
        </div>
        <div style="border-top:1px dashed #333;margin:8px 0"></div>
        <div style="display:flex;justify-content:space-between"><span>No</span><span>${esc(order.no_invoice)}</span></div>
        <div style="display:flex;justify-content:space-between"><span>Waktu</span><span>${esc(order.tanggal)} ${esc(order.waktu)}</span></div>
        <div style="display:flex;justify-content:space-between"><span>Kasir</span><span>${esc(order.kasir)}</span></div>
        <div style="display:flex;justify-content:space-between"><span>Order</span><span>${esc(order.tipe_order)} ${order.meja !== '-' ? '(' + esc(order.meja) + ')' : ''}</span></div>
        <div style="display:flex;justify-content:space-between"><span>Tamu</span><span>${esc(order.pelanggan)}</span></div>
        <div style="border-top:1px dashed #333;margin:8px 0"></div>
        ${(order.items || []).map((it) => `
          <div style="margin-bottom:6px">
            <div style="font-weight:700">${esc(it.nama)}</div>
            ${it.varian ? `<div style="font-size:10.5px;color:#555">${esc(it.varian)}</div>` : ''}
            <div style="display:flex;justify-content:space-between">
              <span>${it.qty} x ${fmtRp(it.harga)}</span>
              <span>${fmtRp(it.qty * it.harga)}</span>
            </div>
          </div>
        `).join('')}
        <div style="border-top:1px dashed #333;margin:8px 0"></div>
        <div style="display:flex;justify-content:space-between"><span>Subtotal</span><span>${fmtRp(order.subtotal)}</span></div>
        ${order.diskon ? `<div style="display:flex;justify-content:space-between"><span>Diskon</span><span>-${fmtRp(order.diskon)}</span></div>` : ''}
        ${order.pajak ? `<div style="display:flex;justify-content:space-between"><span>Pajak PB1</span><span>${fmtRp(order.pajak)}</span></div>` : ''}
        ${order.service_charge ? `<div style="display:flex;justify-content:space-between"><span>Service</span><span>${fmtRp(order.service_charge)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:800;margin-top:6px">
          <span>TOTAL</span><span>${fmtRp(order.total)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px"><span>${esc(order.metode_bayar)}</span><span>${fmtRp(order.bayar)}</span></div>
        ${order.kembalian ? `<div style="display:flex;justify-content:space-between"><span>Kembali</span><span>${fmtRp(order.kembalian)}</span></div>` : ''}
        <div style="border-top:1px dashed #333;margin:10px 0"></div>
        <div style="text-align:center;font-size:11px">${esc(s.receipt_footer || 'Terima kasih!')}</div>
      </div>
    `;

    openModal(`
      <div class="modal-head">
        <div class="modal-title">Struk ${esc(order.no_invoice)}</div>
        <button type="button" class="modal-close-btn" data-close-modal aria-label="Tutup">✕</button>
      </div>
      ${receiptHTML}
      <div class="modal-actions" style="flex-wrap:wrap;justify-content:space-between">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-secondary btn-sm" id="btn-share-wa">WhatsApp</button>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-print-browser">Cetak Browser</button>
        </div>
        <button type="button" class="btn btn-primary" id="btn-print-bt-receipt">
          ${state.btConnected ? '🟢 Cetak Thermal BT' : '🔴 Hubungkan & Cetak BT'}
        </button>
      </div>
    `);

    document.getElementById('btn-print-bt-receipt').onclick = async () => {
      const btn = document.getElementById('btn-print-bt-receipt');
      try {
        if (!state.btConnected) {
          btn.disabled = true;
          btn.textContent = 'Menghubungkan BT...';
          const res = await Printer.connect();
          state.btConnected = true;
          state.btName = res.name;
        }
        btn.disabled = true;
        btn.textContent = 'Mencetak ke Thermal BT...';
        await Printer.printOrderReceipt(order, state.db.settings);
        toast('Struk berhasil dicetak ke Printer Bluetooth!', 'success');
        btn.disabled = false;
        btn.textContent = '🟢 Cetak Ulang BT';
        render();
      } catch (err) {
        if (!String(err.message || '').toLowerCase().includes('cancel')) {
          toast('Gagal cetak BT: ' + err.message, 'error');
        }
        btn.disabled = false;
        btn.textContent = state.btConnected ? '🟢 Cetak Thermal BT' : '🔴 Hubungkan & Cetak BT';
      }
    };

    document.getElementById('btn-print-browser').onclick = () => {
      const area = document.getElementById('print-receipt-area');
      area.style.width = (state.db.settings?.paper_size === '80mm') ? '76mm' : '54mm';
      area.innerHTML = receiptHTML;
      window.print();
    };

    document.getElementById('btn-share-wa').onclick = () => {
      const lines = [
        `*${s.cafe_name || 'CAFE CL'}*`,
        `Invoice: ${order.no_invoice}`,
        `Tanggal: ${order.tanggal} ${order.waktu}`,
        `Tamu: ${order.pelanggan} (${order.tipe_order}${order.meja !== '-' ? ' - ' + order.meja : ''})`,
        `------------------------`,
        ...(order.items || []).map((it) => `${it.qty}x ${it.nama}${it.varian ? ' [' + it.varian + ']' : ''} = ${fmtRp(it.qty * it.harga)}`),
        `------------------------`,
        `*TOTAL: ${fmtRp(order.total)}*`,
        `Status: ${order.status_bayar} (${order.metode_bayar})`,
        ``,
        s.receipt_footer || 'Terima kasih!'
      ];
      window.open(`https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
    };
  }

  // ==========================================================================
  // VIEW 3: DENAH MEJA CAFE
  // ==========================================================================
  function renderTables() {
    const areas = [...new Set((state.db.tables || []).map((t) => t.area || 'Indoor AC'))];

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <span class="badge badge-success">● Tersedia: ${(state.db.tables || []).filter((t) => t.status === 'Tersedia').length}</span>
          <span class="badge badge-warning">● Terisi: ${(state.db.tables || []).filter((t) => t.status === 'Terisi').length}</span>
          <span class="badge badge-info">● Reservasi: ${(state.db.tables || []).filter((t) => t.status === 'Reservasi').length}</span>
        </div>
        ${hasPerm('menu') ? `<button type="button" class="btn btn-primary btn-sm" id="btn-add-table">+ Tambah Meja</button>` : ''}
      </div>

      ${areas.map((area) => `
        <div style="margin-bottom:22px">
          <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:0.12em;color:var(--gold-400);margin-bottom:10px">${esc(area)}</h3>
          <div class="floor-grid">
            ${(state.db.tables || []).filter((t) => (t.area || 'Indoor AC') === area).map((t) => {
              const cls = t.status === 'Terisi' ? 'occupied' : t.status === 'Reservasi' ? 'reserved' : '';
              const badge = t.status === 'Terisi' ? 'badge-warning' : t.status === 'Reservasi' ? 'badge-info' : 'badge-success';
              return `
                <div class="table-tile ${cls}" data-table-click="${esc(t.id)}">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <strong style="font-size:16px">${esc(t.nama)}</strong>
                    <span class="badge ${badge}">${esc(t.status)}</span>
                  </div>
                  <div style="font-size:12px;color:var(--text-secondary)">Kapasitas ${t.kapasitas} kursi</div>
                  ${t.order_aktif ? `<div class="mono text-gold" style="font-size:11.5px">Bill: ${esc(t.order_aktif)}</div>` : `<div style="font-size:11.5px;color:var(--text-muted)">Ketuk untuk order / atur</div>`}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `).join('')}
    `;
  }

  function loadOpenBillToPOS(openOrder) {
    state.orderType = openOrder.tipe_order || 'Dine-In';
    state.selectedTable = openOrder.meja !== '-' ? openOrder.meja : '';
    state.customerName = openOrder.pelanggan || '';
    state.selectedMemberId = openOrder.member_id || '';
    state.cart = JSON.parse(JSON.stringify(openOrder.items || []));
    state.discount = Number(openOrder.diskon || 0);
    state.orderNote = openOrder.catatan || '';
    state.editingOrderId = openOrder.id;
    closeModal();
    setRoute('pos');
    setTimeout(() => openCheckoutModal(false), 100);
  }

  function openTableActionModal(tableId) {
    const t = (state.db.tables || []).find((x) => x.id === tableId);
    if (!t) return;
    const openOrder = (state.db.orders || []).find(
      (o) => o.no_invoice === t.order_aktif && o.status_bayar === 'Open Bill'
    );

    openModal(`
      <div class="modal-head">
        <div>
          <div class="modal-title">${esc(t.nama)}</div>
          <div style="font-size:12px;color:var(--text-secondary)">${esc(t.area)} • ${t.kapasitas} Kursi • Status: ${esc(t.status)}</div>
        </div>
        <button type="button" class="modal-close-btn" data-close-modal aria-label="Tutup">✕</button>
      </div>

      <div style="display:flex;flex-direction:column;gap:10px">
        <button type="button" class="btn btn-primary btn-full" id="btn-table-new-order">☕ Buat Pesanan Dine-In di ${esc(t.nama)}</button>
        ${openOrder ? `
          <button type="button" class="btn btn-success btn-full" id="btn-table-pay-bill">💳 Bayar Open Bill (${esc(openOrder.no_invoice)} • ${fmtRp(openOrder.total)})</button>
        ` : ''}
        <div class="grid-3" style="margin-top:6px">
          ${['Tersedia', 'Terisi', 'Reservasi'].map((st) => `
            <button type="button" class="btn btn-secondary btn-sm" data-set-table-status="${st}">${st}</button>
          `).join('')}
        </div>
        ${hasPerm('menu') && t.status === 'Tersedia' ? `
          <button type="button" class="btn btn-danger btn-sm btn-full" style="margin-top:4px" id="btn-table-delete">Hapus Meja Ini</button>
        ` : ''}
      </div>
    `);

    document.getElementById('btn-table-delete')?.addEventListener('click', () => {
      if (!confirm(`Hapus ${t.nama}?`)) return;
      state.db.tables = state.db.tables.filter((x) => x.id !== t.id);
      API.saveLocal(state.db);
      API.sendAction('deleteTable', { id: t.id });
      closeModal();
      toast(`${t.nama} dihapus.`, 'info');
      render();
    });

    document.getElementById('btn-table-new-order').onclick = () => {
      state.orderType = 'Dine-In';
      state.selectedTable = t.nama;
      closeModal();
      setRoute('pos');
    };

    const payBtn = document.getElementById('btn-table-pay-bill');
    if (payBtn && openOrder) {
      payBtn.onclick = () => loadOpenBillToPOS(openOrder);
    }

    document.querySelectorAll('[data-set-table-status]').forEach((b) => {
      b.onclick = () => {
        t.status = b.dataset.setTableStatus;
        if (t.status === 'Tersedia') t.order_aktif = '';
        API.saveLocal(state.db);
        API.sendAction('saveTable', t);
        closeModal();
        toast(`${t.nama} diubah menjadi ${t.status}`, 'success');
        render();
      };
    });
  }

  // ==========================================================================
  // VIEW 4: KELOLA MENU & STOK
  // ==========================================================================
  function renderMenuManager() {
    const q = state.menuSearch.trim().toLowerCase();
    const list = (state.db.menu || []).filter(
      (m) => !q || m.nama.toLowerCase().includes(q) || (m.kategori || '').toLowerCase().includes(q)
    );

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <div class="search-wrap" style="max-width:340px">
          ${ICO.search}
          <input id="menu-mgr-search" class="input" placeholder="Cari menu atau kategori..." value="${esc(state.menuSearch)}" />
        </div>
        <button type="button" class="btn btn-primary" id="btn-add-menu">+ Tambah Menu Baru</button>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr><th>Menu</th><th>Kategori</th><th>Harga</th><th>HPP</th><th>Margin</th><th>Stok</th><th>Status</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              ${list.map((m) => {
                const margin = Number(m.harga) - Number(m.hpp || 0);
                return `
                  <tr>
                    <td>
                      <strong>${esc(m.nama)}</strong> ${m.favorit ? '<span class="text-gold">★</span>' : ''}
                      <div style="font-size:11px;color:var(--text-muted)">${esc(m.kode || '')}</div>
                    </td>
                    <td><span class="badge badge-gold">${esc(m.kategori)}</span></td>
                    <td class="mono" style="font-weight:700">${fmtRp(m.harga)}</td>
                    <td class="mono text-muted">${fmtRp(m.hpp || 0)}</td>
                    <td class="mono text-success">${fmtRp(margin)}</td>
                    <td class="mono">${m.stok}</td>
                    <td>
                      <button type="button" class="badge ${m.tersedia ? 'badge-success' : 'badge-danger'}" style="border:none;cursor:pointer" data-toggle-avail="${esc(m.id)}">
                        ${m.tersedia ? 'Tersedia' : 'Habis'}
                      </button>
                    </td>
                    <td>
                      <div style="display:flex;gap:6px">
                        <button type="button" class="btn btn-secondary btn-sm" data-edit-menu="${esc(m.id)}">Edit</button>
                        <button type="button" class="btn btn-danger btn-sm" data-del-menu="${esc(m.id)}">Hapus</button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function openMenuFormModal(menuId = null) {
    const existing = menuId ? state.db.menu.find((m) => m.id === menuId) : null;
    const m = existing || {
      id: '', kode: '', nama: '', kategori: 'Signature', harga: 28000, hpp: 10000, stok: 50,
      deskripsi: '', foto_url: '', varian: 'Iced,Hot|Normal Sugar,Less Sugar', tersedia: true, favorit: false
    };

    openModal(`
      <div class="modal-head">
        <div class="modal-title">${existing ? 'Edit Menu' : 'Tambah Menu Cafe'}</div>
        <button type="button" class="modal-close-btn" data-close-modal aria-label="Tutup">✕</button>
      </div>
      <form id="menu-form">
        <div class="grid-2">
          <div class="field">
            <label>Nama Menu</label>
            <input name="nama" class="input" required value="${esc(m.nama)}" placeholder="Misal: Spanish Latte" />
          </div>
          <div class="field">
            <label>Kategori</label>
            <select name="kategori" class="select">
              ${['Signature', 'Espresso', 'Non-Coffee', 'Tea', 'Pastry', 'Food'].map((c) => `<option ${m.kategori === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid-3">
          <div class="field"><label>Harga Jual (Rp)</label><input name="harga" type="number" min="0" class="input mono" required value="${m.harga}" /></div>
          <div class="field"><label>HPP Modal (Rp)</label><input name="hpp" type="number" min="0" class="input mono" value="${m.hpp}" /></div>
          <div class="field"><label>Stok</label><input name="stok" type="number" min="0" class="input mono" value="${m.stok}" /></div>
        </div>
        <div class="field">
          <label>Varian (pisahkan grup dengan <code>|</code>, opsi dengan <code>,</code>, tambah harga pakai <code>(+8000)</code>)</label>
          <input name="varian" class="input" value="${esc(m.varian)}" />
        </div>
        <div class="field">
          <label>Deskripsi Singkat</label>
          <input name="deskripsi" class="input" value="${esc(m.deskripsi)}" />
        </div>
        <div class="field">
          <label>URL Foto Menu (Opsional, https://...)</label>
          <input name="foto_url" class="input" value="${esc(m.foto_url)}" placeholder="https://..." />
        </div>
        <div style="display:flex;gap:18px;margin-bottom:10px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" name="tersedia" ${m.tersedia ? 'checked' : ''} /> Tersedia</label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" name="favorit" ${m.favorit ? 'checked' : ''} /> Menu Favorit ★</label>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-close-modal>Batal</button>
          <button type="submit" class="btn btn-primary">Simpan Menu</button>
        </div>
      </form>
    `);

    document.getElementById('menu-form').onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const item = {
        id: existing ? existing.id : ('MNU-' + Date.now()),
        kode: existing?.kode || ('MN-' + Math.floor(100 + Math.random() * 900)),
        nama: fd.get('nama').trim(),
        kategori: fd.get('kategori'),
        harga: Math.max(0, Number(fd.get('harga'))),
        hpp: Math.max(0, Number(fd.get('hpp'))),
        stok: Math.max(0, Number(fd.get('stok'))),
        varian: fd.get('varian').trim(),
        deskripsi: fd.get('deskripsi').trim(),
        foto_url: safeUrl(fd.get('foto_url').trim()),
        tersedia: fd.get('tersedia') === 'on',
        favorit: fd.get('favorit') === 'on'
      };
      if (existing) {
        const idx = state.db.menu.findIndex((x) => x.id === existing.id);
        state.db.menu[idx] = item;
      } else {
        state.db.menu.push(item);
      }
      API.saveLocal(state.db);
      API.sendAction('saveMenu', item);
      closeModal();
      toast('Menu berhasil disimpan!', 'success');
      render();
    };
  }

  // ==========================================================================
  // VIEW 5: RIWAYAT TRANSAKSI
  // ==========================================================================
  function renderHistory() {
    const q = state.txSearch.trim().toLowerCase();
    const list = (state.db.orders || []).slice().reverse().filter((o) => {
      if (state.txDate && String(o.tanggal).slice(0, 10) !== state.txDate) return false;
      if (q && !(o.no_invoice.toLowerCase().includes(q) || (o.pelanggan || '').toLowerCase().includes(q))) return false;
      return true;
    });

    const canVoid = hasPerm('void_order');

    return `
      <div style="display:flex;gap:10px;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap">
        <div style="display:flex;gap:10px;flex-wrap:wrap;flex:1">
          <div class="search-wrap" style="max-width:280px">
            ${ICO.search}
            <input id="tx-search" class="input" placeholder="Cari invoice atau pelanggan..." value="${esc(state.txSearch)}" />
          </div>
          <input id="tx-date" type="date" class="input" style="max-width:175px" value="${esc(state.txDate)}" />
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary btn-sm" id="btn-export-orders-excel">📊 Export Excel (.xls)</button>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-export-orders">⬇ Export CSV Rapi</button>
        </div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr><th>Invoice</th><th>Waktu</th><th>Pelanggan</th><th>Metode</th><th>Total</th><th>Status</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              ${list.map((o) => `
                <tr>
                  <td class="mono" style="font-weight:700;font-size:12px">${esc(o.no_invoice)}</td>
                  <td style="font-size:12px">${esc(o.tanggal)}<br/><span class="text-muted">${esc(o.waktu)}</span></td>
                  <td><strong>${esc(o.pelanggan)}</strong><br/><span style="font-size:11px;color:var(--text-secondary)">${esc(o.tipe_order)} ${o.meja !== '-' ? '• ' + esc(o.meja) : ''}</span></td>
                  <td>${esc(o.metode_bayar)}</td>
                  <td class="mono" style="font-weight:700">${fmtRp(o.total)}</td>
                  <td>
                    <span class="badge ${o.status_bayar === 'Lunas' ? 'badge-success' : o.status_bayar === 'Open Bill' ? 'badge-warning' : 'badge-danger'}">${esc(o.status_bayar)}</span>
                  </td>
                  <td>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      ${o.status_bayar === 'Open Bill' ? `<button type="button" class="btn btn-primary btn-sm" data-pay-openbill="${esc(o.id)}">Bayar</button>` : ''}
                      <button type="button" class="btn btn-secondary btn-sm" data-view-receipt="${esc(o.id)}">Struk</button>
                      ${o.status_bayar !== 'Dibatalkan' && canVoid ? `<button type="button" class="btn btn-danger btn-sm" data-void-order="${esc(o.id)}">Void</button>` : ''}
                    </div>
                  </td>
                </tr>
              `).join('') || `<tr><td colspan="7" class="empty-state">Tidak ada transaksi sesuai filter.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // VIEW 6: KEUANGAN, SHIFT KASIR & LABA RUGI
  // ==========================================================================
  function renderFinance() {
    const validOrders = (state.db.orders || []).filter((o) => o.status_bayar === 'Lunas');
    const totalOmzet = validOrders.reduce((s, o) => s + Number(o.total || 0), 0);
    let totalHpp = 0;
    validOrders.forEach((o) => (o.items || []).forEach((it) => { totalHpp += Number(it.hpp || 0) * Number(it.qty || 1); }));
    const totalExp = (state.db.expenses || []).reduce((s, e) => s + Number(e.nominal || 0), 0);
    const netProfit = totalOmzet - totalHpp - totalExp;

    const openShift = (state.db.shifts || []).find((s) => s.status === 'Buka');

    return `
      <section class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-head"><span class="kpi-label">Total Omzet Lunas</span><span class="kpi-ico">💰</span></div>
          <div class="kpi-value">${fmtRp(totalOmzet)}</div>
          <div class="kpi-sub">${validOrders.length} transaksi selesai</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-head"><span class="kpi-label">Total HPP Bahan</span><span class="kpi-ico">☕</span></div>
          <div class="kpi-value">${fmtRp(totalHpp)}</div>
          <div class="kpi-sub">Harga pokok produksi</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-head"><span class="kpi-label">Total Pengeluaran</span><span class="kpi-ico">📉</span></div>
          <div class="kpi-value text-danger">${fmtRp(totalExp)}</div>
          <div class="kpi-sub">${(state.db.expenses || []).length} catatan operasional</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-head"><span class="kpi-label">Laba Bersih</span><span class="kpi-ico">✦</span></div>
          <div class="kpi-value ${netProfit >= 0 ? 'text-success' : 'text-danger'}">${fmtRp(netProfit)}</div>
          <div class="kpi-sub">Omzet − HPP − Pengeluaran</div>
        </div>
      </section>

      <div class="dash-grid">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Pengeluaran Operasional Cafe</div>
              <div class="card-subtitle">Biji kopi, susu, listrik, gaji, kemasan, dll</div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button type="button" class="btn btn-secondary btn-sm" id="btn-export-finance-excel">📊 Excel Laba Rugi</button>
              <button type="button" class="btn btn-primary btn-sm" id="btn-add-expense">+ Catat Pengeluaran</button>
            </div>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th>Nominal</th><th>Aksi</th></tr></thead>
              <tbody>
                ${(state.db.expenses || []).slice().reverse().map((x) => `
                  <tr>
                    <td class="mono" style="font-size:12px">${esc(x.tanggal)}</td>
                    <td><span class="badge badge-gold">${esc(x.kategori)}</span></td>
                    <td><strong>${esc(x.deskripsi)}</strong><br/><span style="font-size:11px;color:var(--text-muted)">${esc(x.metode)} • ${esc(x.dicatat_oleh)}</span></td>
                    <td class="mono text-danger" style="font-weight:700">${fmtRp(x.nominal)}</td>
                    <td><button type="button" class="btn btn-danger btn-sm" data-del-expense="${esc(x.id)}">Hapus</button></td>
                  </tr>
                `).join('') || `<tr><td colspan="5" class="empty-state">Belum ada catatan pengeluaran.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Shift Kasir & Laci Tunai</div>
              <div class="card-subtitle">Kontrol buka/tutup kasir harian</div>
            </div>
          </div>
          ${openShift ? `
            <div class="card" style="background:var(--bg-elevated);border-color:rgba(52,211,153,0.4);margin-bottom:14px">
              <span class="badge badge-success" style="margin-bottom:8px">● Shift Sedang Aktif</span>
              <div style="font-size:13px">Kasir: <strong>${esc(openShift.kasir)}</strong></div>
              <div style="font-size:12px;color:var(--text-secondary)">Dibuka: ${esc(openShift.buka_waktu)}</div>
              <div style="font-size:13px;margin-top:6px">Modal Awal: <strong class="mono text-gold">${fmtRp(openShift.modal_awal)}</strong></div>
              <button type="button" class="btn btn-danger btn-full" style="margin-top:12px" id="btn-close-shift">Tutup Shift & Hitung Kas</button>
            </div>
          ` : `
            <div class="empty-state" style="padding:18px 0">
              <p style="margin-bottom:12px">Belum ada shift kasir yang dibuka saat ini.</p>
              <button type="button" class="btn btn-primary btn-full" id="btn-open-shift">Buka Shift Kasir Baru</button>
            </div>
          `}
          <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
            ${(state.db.shifts || []).filter((s) => s.status === 'Tutup').slice().reverse().slice(0, 4).map((s) => `
              <div style="padding:10px;border-radius:12px;background:var(--bg-elevated);font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:8px">
                <div>
                  <strong>${esc(s.kasir)}</strong> • <span class="mono ${s.selisih === 0 ? 'text-success' : 'text-warning'}">Selisih: ${fmtRp(s.selisih)}</span>
                  <div class="text-muted">Tunai: ${fmtRp(s.total_tunai)} • Non-Tunai: ${fmtRp(s.total_non_tunai)}</div>
                </div>
                <button type="button" class="btn btn-secondary btn-sm" data-print-shift="${esc(s.id)}">🖨 BT</button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // VIEW 7: MEMBER & LOYALITAS
  // ==========================================================================
  function renderMembers() {
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div class="text-muted">Otomatis mengumpulkan 1 poin setiap transaksi Rp 10.000</div>
        <button type="button" class="btn btn-primary btn-sm" id="btn-add-member">+ Tambah Member</button>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Nama Member</th><th>Kontak</th><th>Tier</th><th>Poin</th><th>Total Belanja</th><th>Kunjungan</th><th>Aksi</th></tr></thead>
            <tbody>
              ${(state.db.members || []).map((m) => `
                <tr>
                  <td><strong>${esc(m.nama)}</strong></td>
                  <td style="font-size:12px">${esc(m.telepon)}<br/><span class="text-muted">${esc(m.email || '-')}</span></td>
                  <td><span class="badge badge-gold">${esc(m.tier)}</span></td>
                  <td class="mono text-gold" style="font-weight:700">${m.poin} pt</td>
                  <td class="mono">${fmtRp(m.total_belanja)}</td>
                  <td class="mono">${m.kunjungan}x</td>
                  <td><button type="button" class="btn btn-danger btn-sm" data-del-member="${esc(m.id)}">Hapus</button></td>
                </tr>
              `).join('') || `<tr><td colspan="7" class="empty-state">Belum ada member terdaftar.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // VIEW 8: PENGATURAN, ROLE MANAGEMENT, STAFF & INTEGRASI AMAN (NO APPS SCRIPT LINK!)
  // ==========================================================================
  function renderSettings() {
    const s = state.db.settings || CFG.DEFAULT_SETTINGS;
    const connected = API.isConnected();
    const canManageStaff = hasPerm('manage_staff');

    return `
      <div class="dash-grid">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">Profil Cafe & Struk Thermal</div>
              <div class="card-subtitle">Tampil di header aplikasi dan cetakan struk Bluetooth</div>
            </div>
          </div>
          <form id="settings-form">
            <div class="grid-2">
              <div class="field"><label>Nama Cafe</label><input name="cafe_name" class="input" value="${esc(s.cafe_name)}" required /></div>
              <div class="field"><label>Tagline</label><input name="tagline" class="input" value="${esc(s.tagline)}" /></div>
            </div>
            <div class="field"><label>Alamat Cafe</label><input name="address" class="input" value="${esc(s.address)}" /></div>
            <div class="grid-2">
              <div class="field"><label>No. Telepon / WA</label><input name="phone" class="input" value="${esc(s.phone)}" /></div>
              <div class="field"><label>Instagram</label><input name="instagram" class="input" value="${esc(s.instagram)}" /></div>
            </div>
            <div class="grid-3">
              <div class="field"><label>Pajak PB1 (%)</label><input name="tax_percent" type="number" min="0" max="100" class="input mono" value="${s.tax_percent}" /></div>
              <div class="field"><label>Service (%)</label><input name="service_percent" type="number" min="0" max="100" class="input mono" value="${s.service_percent}" /></div>
              <div class="field">
                <label>Kertas Struk</label>
                <select name="paper_size" class="select">
                  <option value="58mm" ${(s.paper_size || '58mm') === '58mm' ? 'selected' : ''}>58mm</option>
                  <option value="80mm" ${s.paper_size === '80mm' ? 'selected' : ''}>80mm</option>
                </select>
              </div>
            </div>
            <div class="field"><label>Catatan Footer Struk</label><textarea name="receipt_footer" class="textarea">${esc(s.receipt_footer)}</textarea></div>
            <button type="submit" class="btn btn-primary">Simpan Pengaturan</button>
          </form>
        </div>

        <div style="display:flex;flex-direction:column;gap:18px">
          <!-- INTEGRASI & MIGRASI GOOGLE SHEET KLIEN (OWNER ONLY, TANPA LINK APPS SCRIPT!) -->
          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">Database & Migrasi Google Sheet Klien</div>
                <div class="card-subtitle">
                  ${connected
                    ? `${esc(API.getSpreadsheetName() || 'Google Sheets Terhubung')} • ID ${esc(API.getSpreadsheetId().slice(0, 6))}…${esc(API.getSpreadsheetId().slice(-5))}`
                    : 'Mode Lokal — Copas link Sheet klien untuk generate otomatis'}
                </div>
              </div>
              <span class="badge ${connected ? 'badge-success' : 'badge-warning'}">${connected ? '● Online' : '○ Lokal'}</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              <button type="button" class="btn btn-primary btn-sm" id="btn-set-gas-modal">🔄 Pindah / Hubungkan Sheet Klien</button>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-generate-sheets" ${!connected ? 'disabled' : ''}>✨ Generate Header & Sheet Otomatis</button>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-sync-now" ${!connected ? 'disabled' : ''}>↻ Sinkronkan</button>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-copy-setup-link" ${!connected ? 'disabled' : ''}>📲 Salin Link Setup Kasir Klien</button>
            </div>
          </div>

          <!-- PRINTER THERMAL BLUETOOTH & PWA UPDATE -->
          <div class="card">
            <div class="card-header">
              <div>
                <div class="card-title">Printer Bluetooth & Auto-Update PWA</div>
                <div class="card-subtitle">Versi aktif: <span class="mono text-gold">v${esc(CFG.APP_VERSION)} (${esc(CFG.APP_BUILD)})</span></div>
              </div>
              <span class="badge ${state.btConnected ? 'badge-success' : 'badge-danger'}">${state.btConnected ? 'BT Hijau' : 'BT Merah'}</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              <button type="button" class="btn btn-primary btn-sm" id="btn-open-bt-settings">🔵 Pengaturan Printer BT</button>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-check-update-settings">${ICO.refresh} Cek & Terapkan Update</button>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-install-pc-settings">⬇ Install PC</button>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-install-hp-settings">⬇ Install HP</button>
            </div>
          </div>

          ${canManageStaff ? `
            <!-- MANAJEMEN ROLE & HAK AKSES -->
            <div class="card">
              <div class="card-header">
                <div>
                  <div class="card-title">Manajemen Role & Hak Akses</div>
                  <div class="card-subtitle">Atur peran kasir, supervisor, atau tambah role custom</div>
                </div>
                <button type="button" class="btn btn-primary btn-sm" id="btn-add-role">+ Tambah Role</button>
              </div>
              <div style="display:flex;flex-direction:column;gap:8px">
                ${(state.db.roles || []).map((r) => `
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 12px;border-radius:12px;background:var(--bg-elevated);border:1px solid var(--border-subtle)">
                    <div style="min-width:0">
                      <strong>${esc(r.nama)}</strong>
                      <span class="badge badge-gold" style="margin-left:6px">${(r.akses || []).length} izin</span>
                      <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px">${esc(r.deskripsi || 'Role akses kasir')}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0">
                      ${String(r.nama).toLowerCase() !== 'owner' ? `<button type="button" class="btn btn-secondary btn-sm" data-edit-role="${esc(r.id)}">Edit</button>` : `<span class="badge badge-success">Penuh</span>`}
                      ${!r.is_system ? `<button type="button" class="btn btn-danger btn-sm" data-del-role="${esc(r.id)}">Hapus</button>` : ''}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- AKUN STAFF CAFE -->
            <div class="card">
              <div class="card-header">
                <div>
                  <div class="card-title">Akun Staff Kasir</div>
                  <div class="card-subtitle">Kelola username, password, PIN & role staff</div>
                </div>
                <button type="button" class="btn btn-primary btn-sm" id="btn-add-user">+ Tambah Staff</button>
              </div>
              <div style="display:flex;flex-direction:column;gap:8px">
                ${(state.db.users || []).map((u) => `
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:var(--bg-elevated);border:1px solid var(--border-subtle)">
                    <div style="min-width:0">
                      <strong>${esc(u.nama)}</strong>
                      <span class="badge badge-gold" style="margin-left:6px">${esc(u.role)}</span>
                      ${u.aktif === false ? `<span class="badge badge-danger" style="margin-left:4px">Nonaktif</span>` : ''}
                      <div style="font-size:11.5px;color:var(--text-muted)">User: ${esc(u.username)} • PIN: ••••</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0">
                      <button type="button" class="btn btn-secondary btn-sm" data-edit-user="${esc(u.id)}">Edit</button>
                      ${u.username !== 'owner' ? `<button type="button" class="btn btn-danger btn-sm" data-del-user="${esc(u.id)}">Hapus</button>` : ''}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  function openRoleFormModal(roleId = null) {
    const existing = roleId ? (state.db.roles || []).find((r) => r.id === roleId) : null;
    const r = existing || { id: '', nama: '', deskripsi: '', akses: ['dashboard', 'pos', 'tables', 'history'], is_system: false };

    openModal(`
      <div class="modal-head">
        <div class="modal-title">${existing ? 'Edit Role Akses' : 'Tambah Role Baru'}</div>
        <button type="button" class="modal-close-btn" data-close-modal aria-label="Tutup">✕</button>
      </div>
      <form id="role-form">
        <div class="field">
          <label>Nama Role</label>
          <input name="nama" class="input" required value="${esc(r.nama)}" placeholder="Misal: Head Kasir, Shift Leader, Admin" ${r.is_system ? 'readonly' : ''} />
        </div>
        <div class="field">
          <label>Deskripsi Singkat</label>
          <input name="deskripsi" class="input" value="${esc(r.deskripsi)}" placeholder="Tugas dan cakupan akses role ini..." />
        </div>
        <div class="field">
          <label>Hak Akses Menu & Fitur</label>
          <div class="perm-grid">
            ${CFG.ALL_PERMISSIONS.map((p) => `
              <label class="perm-item">
                <input type="checkbox" name="akses" value="${p.key}" ${(r.akses || []).includes(p.key) ? 'checked' : ''} />
                <span>${esc(p.label)}</span>
              </label>
            `).join('')}
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-close-modal>Batal</button>
          <button type="submit" class="btn btn-primary">Simpan Role</button>
        </div>
      </form>
    `);

    document.getElementById('role-form').onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const nama = fd.get('nama').trim();
      const akses = fd.getAll('akses');
      if (!nama) { toast('Nama role wajib diisi!', 'error'); return; }
      if (!akses.length) { toast('Pilih minimal 1 hak akses!', 'error'); return; }

      const dup = (state.db.roles || []).find(
        (x) => x.nama.toLowerCase() === nama.toLowerCase() && x.id !== (existing?.id || '')
      );
      if (dup) { toast('Nama role sudah ada!', 'error'); return; }

      const roleObj = {
        id: existing ? existing.id : ('ROL-' + Date.now()),
        nama,
        deskripsi: fd.get('deskripsi').trim(),
        akses,
        is_system: Boolean(existing?.is_system)
      };

      if (existing) {
        const idx = state.db.roles.findIndex((x) => x.id === existing.id);
        state.db.roles[idx] = roleObj;
      } else {
        state.db.roles.push(roleObj);
      }

      API.saveLocal(state.db);
      API.sendAction('saveRole', roleObj);
      closeModal();
      toast(`Role "${nama}" berhasil disimpan!`, 'success');
      render();
    };
  }

  function openUserFormModal(userId = null) {
    const existing = userId ? (state.db.users || []).find((u) => u.id === userId) : null;
    const u = existing || { id: '', nama: '', role: 'Kasir', username: '', password: '', pin: '', aktif: true };
    const roleList = state.db.roles || CFG.DEFAULT_ROLES;

    openModal(`
      <div class="modal-head">
        <div class="modal-title">${existing ? 'Edit Akun Staff' : 'Tambah Akun Staff'}</div>
        <button type="button" class="modal-close-btn" data-close-modal aria-label="Tutup">✕</button>
      </div>
      <form id="user-form">
        <div class="grid-2">
          <div class="field"><label>Nama Lengkap</label><input name="nama" class="input" required value="${esc(u.nama)}" placeholder="Nama staff kasir" /></div>
          <div class="field">
            <label>Role</label>
            <select name="role" class="select" ${u.username === 'owner' ? 'disabled' : ''}>
              ${roleList.map((r) => `<option value="${esc(r.nama)}" ${u.role === r.nama ? 'selected' : ''}>${esc(r.nama)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid-3">
          <div class="field"><label>Username</label><input name="username" class="input" required value="${esc(u.username)}" ${u.username === 'owner' ? 'readonly' : ''} placeholder="kasir2" /></div>
          <div class="field"><label>Password</label><input name="password" type="password" class="input" required value="${esc(u.password)}" placeholder="Min. 4 karakter" /></div>
          <div class="field"><label>PIN 4 Digit</label><input name="pin" maxlength="4" pattern="\\d{4}" class="input mono" required value="${esc(u.pin)}" placeholder="4444" /></div>
        </div>
        ${u.username !== 'owner' ? `
          <label class="perm-item" style="margin-bottom:10px;width:fit-content">
            <input type="checkbox" name="aktif" ${u.aktif !== false ? 'checked' : ''} />
            <span>Akun Aktif</span>
          </label>
        ` : ''}
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-close-modal>Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>
    `);

    document.getElementById('user-form').onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const username = fd.get('username').trim().toLowerCase();
      const password = fd.get('password').trim();
      const pin = fd.get('pin').trim();
      const role = u.username === 'owner' ? 'Owner' : fd.get('role');

      if (password.length < 4) { toast('Password minimal 4 karakter!', 'error'); return; }
      if (!/^\d{4}$/.test(pin)) { toast('PIN harus tepat 4 digit angka!', 'error'); return; }

      const dupUser = (state.db.users || []).find((x) => x.username.toLowerCase() === username && x.id !== (existing?.id || ''));
      if (dupUser) { toast('Username sudah digunakan staff lain!', 'error'); return; }

      const dupPin = (state.db.users || []).find((x) => String(x.pin) === pin && x.id !== (existing?.id || ''));
      if (dupPin) { toast('PIN 4 digit sudah digunakan staff lain!', 'error'); return; }

      const usr = {
        id: existing ? existing.id : ('USR-' + Date.now()),
        nama: fd.get('nama').trim(),
        role,
        username,
        password,
        pin,
        aktif: u.username === 'owner' ? true : fd.get('aktif') === 'on'
      };

      if (existing) {
        const idx = state.db.users.findIndex((x) => x.id === existing.id);
        state.db.users[idx] = usr;
      } else {
        state.db.users.push(usr);
      }

      API.saveLocal(state.db);
      API.sendAction('saveUser', usr);
      closeModal();
      toast(existing ? 'Data staff diperbarui!' : 'Akun staff ditambahkan!', 'success');
      render();
    };
  }

  // ==========================================================================
  // EVENT BINDING AFTER RENDER
  // ==========================================================================
  function bindEvents() {
    if (!state.user) {
      document.getElementById('btn-theme-login')?.addEventListener('click', toggleTheme);
      document.getElementById('btn-download-pc')?.addEventListener('click', () => handleInstallDevice('PC'));
      document.getElementById('btn-download-hp')?.addEventListener('click', () => handleInstallDevice('HP'));
      document.getElementById('btn-check-update-login')?.addEventListener('click', manualCheckUpdate);

      document.querySelectorAll('[data-login-mode]').forEach((b) => {
        b.onclick = () => {
          state.loginMode = b.dataset.loginMode;
          state.pinBuffer = '';
          render();
        };
      });

      document.getElementById('login-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const u = document.getElementById('login-username').value.trim().toLowerCase();
        const p = document.getElementById('login-password').value.trim();
        let found = (state.db.users || []).find(
          (x) => String(x.username).toLowerCase() === u && String(x.password) === p && x.aktif !== false
        );
        // Jika belum ketemu secara lokal namun terhubung ke Google Sheets, verifikasi ke server
        if (!found && API.isConnected() && navigator.onLine) {
          try {
            const res = await API.sendAction('login', { username: u, password: p });
            if (res && res.ok && res.user) found = res.user;
          } catch {}
        }
        if (!found) {
          toast('Username atau kata sandi salah, atau akun nonaktif.', 'error');
          return;
        }
        saveSessionUser({ id: found.id, username: found.username, nama: found.nama, role: found.role });
        state.route = found.role === 'Kasir' ? 'pos' : getFirstAllowedRoute();
        toast(`Selamat datang, ${found.nama}!`, 'success');
        render();
        syncCloud(true);
      });

      document.querySelectorAll('[data-pin-key]').forEach((b) => {
        b.onclick = async () => {
          const k = b.dataset.pinKey;
          if (k === 'C') state.pinBuffer = '';
          else if (k === '⌫') state.pinBuffer = state.pinBuffer.slice(0, -1);
          else if (state.pinBuffer.length < 4) state.pinBuffer += k;

          if (state.pinBuffer.length === 4) {
            const pinEntered = state.pinBuffer;
            let found = (state.db.users || []).find((x) => String(x.pin) === pinEntered && x.aktif !== false);
            if (!found && API.isConnected() && navigator.onLine) {
              try {
                const res = await API.sendAction('login', { pin: pinEntered });
                if (res && res.ok && res.user) found = res.user;
              } catch {}
            }
            if (found) {
              saveSessionUser({ id: found.id, username: found.username, nama: found.nama, role: found.role });
              state.pinBuffer = '';
              state.route = found.role === 'Kasir' ? 'pos' : getFirstAllowedRoute();
              toast(`Selamat datang, ${found.nama}!`, 'success');
              render();
              syncCloud(true);
              return;
            } else {
              toast('PIN tidak valid atau akun nonaktif!', 'error');
              state.pinBuffer = '';
            }
          }
          render();
        };
      });
      return;
    }

    // Shell events
    document.querySelectorAll('[data-nav]').forEach((b) => {
      b.onclick = () => setRoute(b.dataset.nav);
    });
    document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => {
      state.sidebarOpen = !state.sidebarOpen;
      render();
    });
    document.getElementById('sidebar-backdrop')?.addEventListener('click', () => {
      state.sidebarOpen = false;
      render();
    });
    document.getElementById('btn-logout')?.addEventListener('click', () => {
      saveSessionUser(null);
      toast('Anda telah keluar.', 'info');
      render();
    });
    document.getElementById('btn-theme-top')?.addEventListener('click', toggleTheme);
    document.getElementById('btn-bt-status')?.addEventListener('click', openBluetoothModal);
    document.getElementById('btn-sync-cloud')?.addEventListener('click', () => {
      if (API.isConnected()) syncCloud(false);
      else if (hasPerm('settings')) openGasSetupModal();
      else toast('Mode Lokal aktif. Hubungi Owner untuk sinkronisasi server.', 'info');
    });
    document.getElementById('btn-check-update-top')?.addEventListener('click', manualCheckUpdate);
    document.getElementById('btn-install-sidebar')?.addEventListener('click', () => {
      handleInstallDevice(window.innerWidth > 900 ? 'PC' : 'HP');
    });

    // Dashboard
    document.getElementById('btn-dash-connect-gas')?.addEventListener('click', openGasSetupModal);

    // POS events
    if (state.route === 'pos') {
      const sInput = document.getElementById('pos-search-input');
      if (sInput) {
        sInput.oninput = (e) => {
          state.posSearch = e.target.value;
          const pos = e.target.selectionStart;
          render();
          const el = document.getElementById('pos-search-input');
          if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch {} }
        };
      }
      document.querySelectorAll('[data-pos-cat]').forEach((b) => {
        b.onclick = () => { state.posCategory = b.dataset.posCat; render(); };
      });
      document.querySelectorAll('[data-pick-menu]').forEach((el) => {
        el.onclick = () => openMenuVariantModal(el.dataset.pickMenu);
      });
      document.querySelectorAll('[data-order-type]').forEach((b) => {
        b.onclick = () => { state.orderType = b.dataset.orderType; render(); };
      });
      document.getElementById('cart-customer')?.addEventListener('input', (e) => { state.customerName = e.target.value; });
      document.getElementById('cart-table')?.addEventListener('change', (e) => { state.selectedTable = e.target.value; });
      document.getElementById('cart-member')?.addEventListener('change', (e) => {
        state.selectedMemberId = e.target.value;
        const m = state.db.members.find((x) => x.id === e.target.value);
        if (m && !state.customerName) {
          state.customerName = m.nama;
          const custEl = document.getElementById('cart-customer');
          if (custEl) custEl.value = m.nama;
        }
      });
      // Update total langsung tanpa re-render penuh agar keyboard tidak hilang fokus!
      document.getElementById('cart-discount')?.addEventListener('input', (e) => {
        state.discount = Math.max(0, Number(e.target.value) || 0);
        const totals = calcCartTotals();
        const box = document.getElementById('cart-totals-box');
        if (box) box.innerHTML = renderCartTotalsHTML(totals);
        const fabTotal = document.querySelector('#btn-open-mobile-cart .mono');
        if (fabTotal) fabTotal.textContent = fmtRp(totals.total);
      });
      document.getElementById('cart-note')?.addEventListener('input', (e) => { state.orderNote = e.target.value; });

      document.querySelectorAll('[data-qty-inc]').forEach((b) => {
        b.onclick = () => { state.cart[Number(b.dataset.qtyInc)].qty += 1; render(); };
      });
      document.querySelectorAll('[data-qty-dec]').forEach((b) => {
        b.onclick = () => {
          const i = Number(b.dataset.qtyDec);
          if (state.cart[i].qty > 1) state.cart[i].qty -= 1;
          else state.cart.splice(i, 1);
          render();
        };
      });
      document.getElementById('btn-clear-cart')?.addEventListener('click', () => {
        state.cart = []; state.editingOrderId = null; state.discount = 0; render();
      });
      document.getElementById('btn-open-bill')?.addEventListener('click', () => openCheckoutModal(true));
      document.getElementById('btn-checkout')?.addEventListener('click', () => openCheckoutModal(false));
      document.getElementById('btn-open-mobile-cart')?.addEventListener('click', () => { state.mobileCartOpen = true; render(); });
      document.getElementById('btn-close-mobile-cart')?.addEventListener('click', () => { state.mobileCartOpen = false; render(); });
      document.getElementById('cart-backdrop')?.addEventListener('click', () => { state.mobileCartOpen = false; render(); });
    }

    // Tables events
    if (state.route === 'tables') {
      document.querySelectorAll('[data-table-click]').forEach((el) => {
        el.onclick = () => openTableActionModal(el.dataset.tableClick);
      });
      document.getElementById('btn-add-table')?.addEventListener('click', () => {
        openModal(`
          <div class="modal-head"><div class="modal-title">Tambah Meja Baru</div><button type="button" class="modal-close-btn" data-close-modal aria-label="Tutup">✕</button></div>
          <form id="table-form">
            <div class="grid-2">
              <div class="field"><label>Nomor</label><input name="nomor" class="input" required placeholder="11" /></div>
              <div class="field"><label>Nama Meja</label><input name="nama" class="input" required placeholder="Meja 11" /></div>
            </div>
            <div class="grid-2">
              <div class="field"><label>Area</label><select name="area" class="select"><option>Indoor AC</option><option>Outdoor Garden</option><option>Coffee Bar</option><option>VIP Lounge</option></select></div>
              <div class="field"><label>Kapasitas Kursi</label><input name="kapasitas" type="number" min="1" class="input" value="4" /></div>
            </div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" data-close-modal>Batal</button><button type="submit" class="btn btn-primary">Simpan</button></div>
          </form>
        `);
        document.getElementById('table-form').onsubmit = (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const tbl = { id: 'TBL-' + Date.now(), nomor: fd.get('nomor').trim(), nama: fd.get('nama').trim(), area: fd.get('area'), kapasitas: Math.max(1, Number(fd.get('kapasitas'))), status: 'Tersedia', order_aktif: '' };
          state.db.tables.push(tbl);
          API.saveLocal(state.db);
          API.sendAction('saveTable', tbl);
          closeModal(); toast('Meja ditambahkan!', 'success'); render();
        };
      });
    }

    // Menu manager events
    if (state.route === 'menu') {
      document.getElementById('menu-mgr-search')?.addEventListener('input', (e) => {
        state.menuSearch = e.target.value;
        const pos = e.target.selectionStart;
        render();
        const el = document.getElementById('menu-mgr-search');
        if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch {} }
      });
      document.getElementById('btn-add-menu')?.addEventListener('click', () => openMenuFormModal());
      document.querySelectorAll('[data-edit-menu]').forEach((b) => { b.onclick = () => openMenuFormModal(b.dataset.editMenu); });
      document.querySelectorAll('[data-toggle-avail]').forEach((b) => {
        b.onclick = () => {
          const m = state.db.menu.find((x) => x.id === b.dataset.toggleAvail);
          if (!m) return;
          m.tersedia = !m.tersedia;
          API.saveLocal(state.db);
          API.sendAction('saveMenu', m);
          render();
        };
      });
      document.querySelectorAll('[data-del-menu]').forEach((b) => {
        b.onclick = () => {
          if (!confirm('Hapus menu ini?')) return;
          const id = b.dataset.delMenu;
          state.db.menu = state.db.menu.filter((x) => x.id !== id);
          API.saveLocal(state.db);
          API.sendAction('deleteMenu', { id });
          toast('Menu dihapus.', 'info');
          render();
        };
      });
    }

    // History events
    if (state.route === 'history') {
      document.getElementById('tx-search')?.addEventListener('input', (e) => {
        state.txSearch = e.target.value;
        const pos = e.target.selectionStart;
        render();
        const el = document.getElementById('tx-search');
        if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch {} }
      });
      document.getElementById('tx-date')?.addEventListener('change', (e) => { state.txDate = e.target.value; render(); });
      document.querySelectorAll('[data-pay-openbill]').forEach((b) => {
        b.onclick = () => {
          const ord = state.db.orders.find((o) => o.id === b.dataset.payOpenbill);
          if (ord) loadOpenBillToPOS(ord);
        };
      });
      document.querySelectorAll('[data-view-receipt]').forEach((b) => {
        b.onclick = () => {
          const ord = state.db.orders.find((o) => o.id === b.dataset.viewReceipt);
          if (ord) openReceiptModal(ord);
        };
      });
      document.querySelectorAll('[data-void-order]').forEach((b) => {
        b.onclick = () => {
          if (!hasPerm('void_order')) { toast('Tidak memiliki izin Void!', 'error'); return; }
          if (!confirm('Batalkan (Void) transaksi ini? Stok menu & meja akan dikembalikan otomatis.')) return;
          const ord = state.db.orders.find((o) => o.id === b.dataset.voidOrder);
          if (!ord || ord.status_bayar === 'Dibatalkan') return;
          ord.status_bayar = 'Dibatalkan';
          // Kembalikan stok menu lokal
          (ord.items || []).forEach((it) => {
            const m = state.db.menu.find((x) => x.id === it.menu_id);
            if (m) m.stok = Number(m.stok || 0) + Number(it.qty || 1);
          });
          // Bebaskan meja jika sedang memakai meja
          if (ord.meja && ord.meja !== '-') {
            const tbl = state.db.tables.find((t) => t.nama === ord.meja);
            if (tbl && tbl.order_aktif === ord.no_invoice) {
              tbl.status = 'Tersedia';
              tbl.order_aktif = '';
            }
          }
          API.saveLocal(state.db);
          API.sendAction('voidOrder', { id: ord.id });
          toast('Transaksi dibatalkan & stok dikembalikan.', 'info');
          render();
        };
      });
      const buildOrderExportData = () => {
        const q = state.txSearch.trim().toLowerCase();
        const filtered = (state.db.orders || []).filter((o) => {
          if (state.txDate && String(o.tanggal).slice(0, 10) !== state.txDate) return false;
          if (q && !(o.no_invoice.toLowerCase().includes(q) || (o.pelanggan || '').toLowerCase().includes(q))) return false;
          return true;
        });

        const headers = [
          'No', 'No Invoice', 'Tanggal', 'Waktu', 'Kasir', 'Pelanggan',
          'Tipe Order', 'Meja', 'Rincian Pesanan',
          'Subtotal (Rp)', 'Diskon (Rp)', 'Pajak (Rp)', 'Service (Rp)', 'Total (Rp)',
          'Metode Bayar', 'Status'
        ];

        let sumSub = 0, sumDisc = 0, sumTax = 0, sumSrv = 0, sumTot = 0;
        const rows = filtered.map((o, idx) => {
          const itemStr = (o.items || [])
            .map((it) => `${it.qty}x ${it.nama}${it.varian ? ' (' + it.varian + ')' : ''}`)
            .join(', ');
          if (o.status_bayar !== 'Dibatalkan') {
            sumSub += Number(o.subtotal || 0);
            sumDisc += Number(o.diskon || 0);
            sumTax += Number(o.pajak || 0);
            sumSrv += Number(o.service_charge || 0);
            sumTot += Number(o.total || 0);
          }
          return [
            idx + 1,
            o.no_invoice,
            String(o.tanggal || '').slice(0, 10),
            o.waktu || '',
            o.kasir || '',
            o.pelanggan || '',
            o.tipe_order || '',
            o.meja || '-',
            itemStr,
            Number(o.subtotal || 0),
            Number(o.diskon || 0),
            Number(o.pajak || 0),
            Number(o.service_charge || 0),
            Number(o.total || 0),
            o.metode_bayar || '',
            o.status_bayar || ''
          ];
        });

        const footer = [
          '', 'TOTAL VALID (NON-VOID)', '', '', '', '', '', '', `${filtered.length} Transaksi`,
          sumSub, sumDisc, sumTax, sumSrv, sumTot, '', ''
        ];
        const suffix = state.txDate || todayISO();
        return { headers, rows, footer, suffix };
      };

      document.getElementById('btn-export-orders')?.addEventListener('click', () => {
        const { headers, rows, footer, suffix } = buildOrderExportData();
        if (!rows.length) { toast('Tidak ada data transaksi untuk diexport.', 'error'); return; }
        downloadCSV(`CAFE-CL-Transaksi-${suffix}.csv`, [headers, ...rows, footer]);
        toast('CSV rapi berhasil diunduh (siap buka di Excel)!', 'success');
      });

      document.getElementById('btn-export-orders-excel')?.addEventListener('click', () => {
        const { headers, rows, footer, suffix } = buildOrderExportData();
        if (!rows.length) { toast('Tidak ada data transaksi untuk diexport.', 'error'); return; }
        const cafeName = state.db.settings?.cafe_name || 'CAFE CL';
        downloadExcel(
          `CAFE-CL-Laporan-Transaksi-${suffix}.xls`,
          `LAPORAN TRANSAKSI PENJUALAN — ${cafeName}`,
          `Periode: ${state.txDate || 'Semua Tanggal'} • Dicetak: ${new Date().toLocaleString('id-ID')}`,
          headers,
          rows,
          footer,
          [9, 10, 11, 12, 13]
        );
        toast('File Excel (.xls) rapi berhasil diunduh!', 'success');
      });
    }

    // Finance events
    if (state.route === 'finance') {
      document.getElementById('btn-export-finance-excel')?.addEventListener('click', () => {
        const cafeName = state.db.settings?.cafe_name || 'CAFE CL';
        const validOrders = (state.db.orders || []).filter((o) => o.status_bayar === 'Lunas');
        const totalOmzet = validOrders.reduce((s, o) => s + Number(o.total || 0), 0);
        let totalHpp = 0;
        validOrders.forEach((o) => (o.items || []).forEach((it) => { totalHpp += Number(it.hpp || 0) * Number(it.qty || 1); }));
        const exps = state.db.expenses || [];
        const totalExp = exps.reduce((s, e) => s + Number(e.nominal || 0), 0);
        const netProfit = totalOmzet - totalHpp - totalExp;

        const headers = ['No', 'Tanggal', 'Kategori', 'Deskripsi Pengeluaran', 'Metode', 'Dicatat Oleh', 'Nominal (Rp)'];
        const rows = exps.map((x, idx) => [
          idx + 1, String(x.tanggal || '').slice(0, 10), x.kategori, x.deskripsi, x.metode, x.dicatat_oleh, Number(x.nominal || 0)
        ]);
        rows.push(['', '', '', '', '', '', '']);
        rows.push(['', 'RINGKASAN LABA RUGI', 'Total Omzet Lunas', `${validOrders.length} Transaksi`, '', '', totalOmzet]);
        rows.push(['', '', 'Total HPP Bahan Baku', '', '', '', -totalHpp]);
        rows.push(['', '', 'Total Pengeluaran Operasional', `${exps.length} Catatan`, '', '', -totalExp]);
        const footer = ['', 'LABA BERSIH', '', '', '', '', netProfit];

        downloadExcel(
          `CAFE-CL-Laba-Rugi-${todayISO()}.xls`,
          `LAPORAN KEUANGAN & LABA RUGI — ${cafeName}`,
          `Dicetak: ${new Date().toLocaleString('id-ID')}`,
          headers,
          rows,
          footer,
          [6]
        );
        toast('Laporan Excel Laba Rugi berhasil diunduh!', 'success');
      });

      document.getElementById('btn-add-expense')?.addEventListener('click', () => {
        openModal(`
          <div class="modal-head"><div class="modal-title">Catat Pengeluaran Cafe</div><button type="button" class="modal-close-btn" data-close-modal aria-label="Tutup">✕</button></div>
          <form id="exp-form">
            <div class="grid-2">
              <div class="field"><label>Tanggal</label><input name="tanggal" type="date" class="input" value="${todayISO()}" required /></div>
              <div class="field"><label>Kategori</label><select name="kategori" class="select"><option>Biji Kopi</option><option>Bahan Baku</option><option>Packaging</option><option>Listrik & Air</option><option>Gaji Staff</option><option>Operasional Lain</option></select></div>
            </div>
            <div class="field"><label>Deskripsi</label><input name="deskripsi" class="input" required placeholder="Misal: Pembelian Susu Fresh Milk 10L" /></div>
            <div class="grid-2">
              <div class="field"><label>Nominal (Rp)</label><input name="nominal" type="number" min="1" class="input mono" required /></div>
              <div class="field"><label>Metode</label><select name="metode" class="select"><option>Tunai</option><option>Transfer</option><option>QRIS</option></select></div>
            </div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" data-close-modal>Batal</button><button type="submit" class="btn btn-primary">Simpan</button></div>
          </form>
        `);
        document.getElementById('exp-form').onsubmit = (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const exp = { id: 'EXP-' + Date.now(), tanggal: fd.get('tanggal'), kategori: fd.get('kategori'), deskripsi: fd.get('deskripsi').trim(), nominal: Math.max(0, Number(fd.get('nominal'))), metode: fd.get('metode'), dicatat_oleh: state.user?.nama || 'Owner', catatan: '' };
          state.db.expenses.push(exp);
          API.saveLocal(state.db);
          API.sendAction('saveExpense', exp);
          closeModal(); toast('Pengeluaran dicatat!', 'success'); render();
        };
      });

      document.querySelectorAll('[data-del-expense]').forEach((b) => {
        b.onclick = () => {
          if (!confirm('Hapus catatan pengeluaran ini?')) return;
          const id = b.dataset.delExpense;
          state.db.expenses = state.db.expenses.filter((x) => x.id !== id);
          API.saveLocal(state.db);
          API.sendAction('deleteExpense', { id });
          render();
        };
      });

      document.querySelectorAll('[data-print-shift]').forEach((b) => {
        b.onclick = async () => {
          const shf = state.db.shifts.find((s) => s.id === b.dataset.printShift);
          if (!shf) return;
          if (!state.btConnected) { openBluetoothModal(); return; }
          try {
            await Printer.printShiftSummary(shf, state.db.settings);
            toast('Struk Tutup Shift dicetak di Printer Bluetooth!', 'success');
          } catch (err) {
            toast('Gagal cetak shift: ' + err.message, 'error');
          }
        };
      });

      document.getElementById('btn-open-shift')?.addEventListener('click', () => {
        openModal(`
          <div class="modal-head"><div class="modal-title">Buka Shift Kasir</div><button type="button" class="modal-close-btn" data-close-modal aria-label="Tutup">✕</button></div>
          <form id="shift-open-form">
            <div class="field"><label>Modal Awal Laci Tunai (Rp)</label><input name="modal" type="number" min="0" class="input mono" value="300000" required /></div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" data-close-modal>Batal</button><button type="submit" class="btn btn-primary">Buka Shift</button></div>
          </form>
        `);
        document.getElementById('shift-open-form').onsubmit = (e) => {
          e.preventDefault();
          const modal = Math.max(0, Number(new FormData(e.target).get('modal')));
          const shf = { id: 'SHF-' + Date.now(), kasir: state.user?.nama || 'Kasir', buka_waktu: new Date().toLocaleString('id-ID'), tutup_waktu: '', modal_awal: modal, total_tunai: 0, total_non_tunai: 0, kas_aktual: 0, selisih: 0, status: 'Buka', catatan: '' };
          state.db.shifts.push(shf);
          API.saveLocal(state.db);
          API.sendAction('saveShift', shf);
          closeModal(); toast('Shift kasir dibuka!', 'success'); render();
        };
      });

      document.getElementById('btn-close-shift')?.addEventListener('click', () => {
        const shf = state.db.shifts.find((s) => s.status === 'Buka');
        if (!shf) return;
        const today = todayISO();
        const todayLunas = (state.db.orders || []).filter((o) => o.status_bayar === 'Lunas' && String(o.tanggal).slice(0, 10) === today);
        const tunai = todayLunas.filter((o) => o.metode_bayar === 'Tunai').reduce((s, o) => s + Number(o.total), 0);
        const nonTunai = todayLunas.filter((o) => o.metode_bayar !== 'Tunai').reduce((s, o) => s + Number(o.total), 0);
        const expected = Number(shf.modal_awal) + tunai;

        openModal(`
          <div class="modal-head"><div class="modal-title">Tutup Shift & Rekonsiliasi</div><button type="button" class="modal-close-btn" data-close-modal aria-label="Tutup">✕</button></div>
          <div class="card" style="background:var(--bg-elevated);margin-bottom:14px;font-size:13px">
            <div class="sum-row"><span>Modal Awal</span><span class="mono">${fmtRp(shf.modal_awal)}</span></div>
            <div class="sum-row"><span>Penjualan Tunai</span><span class="mono">${fmtRp(tunai)}</span></div>
            <div class="sum-row"><span>Penjualan Non-Tunai</span><span class="mono">${fmtRp(nonTunai)}</span></div>
            <div class="sum-row total"><span>Kas Seharusnya di Laci</span><span class="mono text-gold">${fmtRp(expected)}</span></div>
          </div>
          <form id="shift-close-form">
            <div class="field"><label>Uang Fisik Aktual di Laci (Rp)</label><input name="aktual" type="number" min="0" class="input mono" value="${expected}" required /></div>
            <div class="field"><label>Catatan Shift</label><input name="catatan" class="input" placeholder="Opsional..." /></div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" data-close-modal>Batal</button><button type="submit" class="btn btn-danger">Tutup Shift</button></div>
          </form>
        `);
        document.getElementById('shift-close-form').onsubmit = (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const aktual = Math.max(0, Number(fd.get('aktual')));
          shf.tutup_waktu = new Date().toLocaleString('id-ID');
          shf.total_tunai = tunai;
          shf.total_non_tunai = nonTunai;
          shf.kas_aktual = aktual;
          shf.selisih = aktual - expected;
          shf.status = 'Tutup';
          shf.catatan = (fd.get('catatan') || '').trim();
          API.saveLocal(state.db);
          API.sendAction('saveShift', shf);
          closeModal(); toast('Shift kasir berhasil ditutup!', 'success'); render();
        };
      });
    }

    // Members events
    if (state.route === 'members') {
      document.getElementById('btn-add-member')?.addEventListener('click', () => {
        openModal(`
          <div class="modal-head"><div class="modal-title">Tambah Member Loyal</div><button type="button" class="modal-close-btn" data-close-modal aria-label="Tutup">✕</button></div>
          <form id="member-form">
            <div class="field"><label>Nama Lengkap</label><input name="nama" class="input" required /></div>
            <div class="grid-2">
              <div class="field"><label>No. HP / WA</label><input name="telepon" class="input" required /></div>
              <div class="field"><label>Email (Opsional)</label><input name="email" type="email" class="input" /></div>
            </div>
            <div class="modal-actions"><button type="button" class="btn btn-secondary" data-close-modal>Batal</button><button type="submit" class="btn btn-primary">Simpan</button></div>
          </form>
        `);
        document.getElementById('member-form').onsubmit = (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const mbr = { id: 'MBR-' + Date.now(), nama: fd.get('nama').trim(), telepon: fd.get('telepon').trim(), email: (fd.get('email') || '').trim(), poin: 0, total_belanja: 0, kunjungan: 0, tier: 'Bronze' };
          state.db.members.push(mbr);
          API.saveLocal(state.db);
          API.sendAction('saveMember', mbr);
          closeModal(); toast('Member berhasil didaftarkan!', 'success'); render();
        };
      });
      document.querySelectorAll('[data-del-member]').forEach((b) => {
        b.onclick = () => {
          if (!confirm('Hapus member ini?')) return;
          const id = b.dataset.delMember;
          state.db.members = state.db.members.filter((m) => m.id !== id);
          API.saveLocal(state.db);
          API.sendAction('deleteMember', { id });
          render();
        };
      });
    }

    // Settings events
    if (state.route === 'settings') {
      document.getElementById('settings-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const updated = {
          ...state.db.settings,
          cafe_name: fd.get('cafe_name').trim(),
          tagline: fd.get('tagline').trim(),
          address: fd.get('address').trim(),
          phone: fd.get('phone').trim(),
          instagram: fd.get('instagram').trim(),
          tax_percent: Math.max(0, Math.min(100, Number(fd.get('tax_percent')) || 0)),
          service_percent: Math.max(0, Math.min(100, Number(fd.get('service_percent')) || 0)),
          paper_size: fd.get('paper_size') || '58mm',
          receipt_footer: fd.get('receipt_footer').trim()
        };
        state.db.settings = updated;
        API.saveLocal(state.db);
        API.sendAction('saveSettings', updated);
        toast('Pengaturan cafe disimpan!', 'success');
        render();
      });

      document.getElementById('btn-set-gas-modal')?.addEventListener('click', openGasSetupModal);
      document.getElementById('btn-sync-now')?.addEventListener('click', () => syncCloud(false));
      document.getElementById('btn-copy-setup-link')?.addEventListener('click', async () => {
        const link = API.buildClientSetupLink();
        if (!link) return;
        try {
          await navigator.clipboard.writeText(link);
          toast('Link Setup Kasir Klien disalin! Buka link ini di PC/HP kasir klien untuk konek otomatis.', 'success');
        } catch {
          prompt('Salin link setup perangkat kasir klien ini:', link);
        }
      });
      document.getElementById('btn-generate-sheets')?.addEventListener('click', async () => {
        toast('Meng-generate sheet & header otomatis...', 'info');
        try {
          const res = await API.initSheets();
          toast(`Sukses! ${res.sheets?.length || 10} sheet & header terverifikasi di Spreadsheet.`, 'success');
          await syncCloud(true);
        } catch (err) {
          toast('Gagal generate sheet: ' + err.message, 'error');
        }
      });

      document.getElementById('btn-open-bt-settings')?.addEventListener('click', openBluetoothModal);
      document.getElementById('btn-check-update-settings')?.addEventListener('click', manualCheckUpdate);
      document.getElementById('btn-install-pc-settings')?.addEventListener('click', () => handleInstallDevice('PC'));
      document.getElementById('btn-install-hp-settings')?.addEventListener('click', () => handleInstallDevice('HP'));

      // Role Management
      document.getElementById('btn-add-role')?.addEventListener('click', () => openRoleFormModal());
      document.querySelectorAll('[data-edit-role]').forEach((b) => {
        b.onclick = () => openRoleFormModal(b.dataset.editRole);
      });
      document.querySelectorAll('[data-del-role]').forEach((b) => {
        b.onclick = () => {
          const id = b.dataset.delRole;
          const r = state.db.roles.find((x) => x.id === id);
          if (!r || r.is_system) return;
          const inUse = (state.db.users || []).some((u) => u.role === r.nama);
          if (inUse) { toast(`Role "${r.nama}" masih dipakai oleh akun staff. Ubah role staff tersebut dulu.`, 'error'); return; }
          if (!confirm(`Hapus role "${r.nama}"?`)) return;
          state.db.roles = state.db.roles.filter((x) => x.id !== id);
          API.saveLocal(state.db);
          API.sendAction('deleteRole', { id });
          toast('Role dihapus.', 'info');
          render();
        };
      });

      // Staff Management
      document.getElementById('btn-add-user')?.addEventListener('click', () => openUserFormModal());
      document.querySelectorAll('[data-edit-user]').forEach((b) => {
        b.onclick = () => openUserFormModal(b.dataset.editUser);
      });
      document.querySelectorAll('[data-del-user]').forEach((b) => {
        b.onclick = () => {
          if (!confirm('Hapus akun staff ini?')) return;
          const id = b.dataset.delUser;
          state.db.users = state.db.users.filter((u) => u.id !== id);
          API.saveLocal(state.db);
          API.sendAction('deleteUser', { id });
          toast('Akun staff dihapus.', 'info');
          render();
        };
      });
    }
  }

  // Export CSV Rapi: UTF-8 BOM + sep=; (terpisah rapi per kolom di Excel Indonesia & English)
  function downloadCSV(filename, rows) {
    const sanitizeCell = (val) => {
      let s = String(val ?? '').replace(/\r?\n/g, ' ').trim();
      // Cegah CSV Formula Injection tanpa merusak angka negatif atau tanda '-'
      if (/^[=+@\t\r]|^-(?![0-9.,]*$)/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const body = rows.map((r) => r.map(sanitizeCell).join(';')).join('\r\n');
    const content = '\uFEFFsep=;\r\n' + body;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // Export Excel (.xls) Berformat Rapi: Header Espresso-Emas, Border, Format Rupiah & Baris Total
  function downloadExcel(filename, title, subtitle, headers, rows, footerRow = null, currencyCols = []) {
    const safeCell = (val) => {
      let s = String(val ?? '');
      if (/^[=+@\t\r]|^-(?![0-9.,]*$)/.test(s)) s = "'" + s;
      return esc(s);
    };
    const isMoney = (idx) => currencyCols.includes(idx);

    const html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Arial, sans-serif; font-size: 11pt; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #C8B9A6; padding: 6px 10px; vertical-align: middle; }
          .title { font-size: 15pt; font-weight: bold; background: #241610; color: #F4D59B; text-align: left; border: none; padding: 10px; }
          .sub { font-size: 10pt; background: #362218; color: #E5D4C0; text-align: left; border: none; padding: 6px 10px; }
          .th { background: #2B1A12; color: #F4D59B; font-weight: bold; text-align: center; white-space: nowrap; }
          .even { background: #FAF6F0; }
          .num { text-align: right; mso-number-format:"\\#\\,\\#\\#0"; white-space: nowrap; }
          .text { mso-number-format:"\\@"; }
          .foot { background: #EFE3D0; font-weight: bold; color: #241610; }
        </style>
      </head>
      <body>
        <table>
          <tr><td colspan="${headers.length}" class="title">${esc(title)}</td></tr>
          <tr><td colspan="${headers.length}" class="sub">${esc(subtitle)}</td></tr>
          <tr>${headers.map((h) => `<th class="th">${esc(h)}</th>`).join('')}</tr>
          ${rows.map((r, ri) => `
            <tr class="${ri % 2 === 1 ? 'even' : ''}">
              ${r.map((cell, ci) => {
                if (isMoney(ci) && cell !== '' && !isNaN(Number(cell))) {
                  return `<td class="num">${Number(cell)}</td>`;
                }
                return `<td class="text">${safeCell(cell)}</td>`;
              }).join('')}
            </tr>
          `).join('')}
          ${footerRow ? `
            <tr>
              ${footerRow.map((cell, ci) => {
                if (isMoney(ci) && cell !== '' && !isNaN(Number(cell))) {
                  return `<td class="foot num">${Number(cell)}</td>`;
                }
                return `<td class="foot">${safeCell(cell)}</td>`;
              }).join('')}
            </tr>
          ` : ''}
        </table>
      </body>
      </html>
    `;

    const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ==========================================================================
  // ROOT RENDER & BOOTSTRAP
  // ==========================================================================
  function render() {
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = state.user ? renderAppShell() : renderLogin();
    bindEvents();
    syncBodyScrollLock();
  }

  async function bootstrap() {
    applyTheme();
    const setupRes = API.applySetupParamFromUrl();
    if (setupRes.applied) {
      state.db = API.loadLocal();
    }
    if (state.user && !hasPerm(state.route)) {
      state.route = getFirstAllowedRoute();
    }
    render();
    await initServiceWorkerAndUpdater();
    if (setupRes.applied) {
      toast('Perangkat kasir berhasil dikonfigurasi otomatis ke Google Sheet klien!', 'success');
      await syncCloud(true);
    } else if (state.user && API.isConnected()) {
      syncCloud(true);
    }
  }

  window.addEventListener('online', () => {
    toast('Koneksi kembali online — menyinkronkan data...', 'success');
    API.flushQueue().then(() => syncCloud(true));
  });

  bootstrap();
})();

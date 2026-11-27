/* ============================================================================
 * CAFE CL — Web Bluetooth ESC/POS Thermal Printer Engine (58mm & 80mm)
 * Mendukung RPP02N, Eppos, Panda, Blueprint, Xprinter, MPT-II, Cashino, dll.
 * ============================================================================ */
window.CafePrinter = (() => {
  'use strict';

  const SERVICE_UUIDS = [
    '000018f0-0000-1000-8000-00805f9b34fb',
    '0000ff00-0000-1000-8000-00805f9b34fb',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '0000ae30-0000-1000-8000-00805f9b34fb',
    '0000ffe0-0000-1000-8000-00805f9b34fb'
  ];

  let device = null;
  let server = null;
  let characteristic = null;
  let listeners = [];

  function isSupported() {
    return typeof navigator !== 'undefined' && Boolean(navigator.bluetooth);
  }

  function isConnected() {
    return Boolean(device && device.gatt && device.gatt.connected && characteristic);
  }

  function getDeviceName() {
    return isConnected() ? (device.name || 'Thermal Printer') : '';
  }

  function onStatusChange(cb) {
    if (typeof cb === 'function') listeners.push(cb);
  }

  function emitStatus() {
    const info = { connected: isConnected(), name: getDeviceName() };
    listeners.forEach((fn) => {
      try { fn(info); } catch (e) {}
    });
  }

  async function findWritableCharacteristic(gattServer) {
    // 1. Coba layanan thermal printer umum terlebih dahulu
    for (const uuid of SERVICE_UUIDS) {
      try {
        const svc = await gattServer.getPrimaryService(uuid);
        const chars = await svc.getCharacteristics();
        const writable = chars.find((c) => c.properties.writeWithoutResponse || c.properties.write);
        if (writable) return writable;
      } catch (e) {}
    }
    // 2. Fallback: scan semua primary services yang tersedia di printer
    try {
      const services = await gattServer.getPrimaryServices();
      for (const svc of services) {
        const chars = await svc.getCharacteristics();
        const writable = chars.find((c) => c.properties.writeWithoutResponse || c.properties.write);
        if (writable) return writable;
      }
    } catch (e) {}
    return null;
  }

  async function connect() {
    if (!isSupported()) {
      throw new Error('Browser ini tidak mendukung Web Bluetooth. Gunakan Chrome/Edge di Android, Windows, atau macOS.');
    }

    const picked = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: SERVICE_UUIDS
    });

    if (device && device !== picked) {
      try { device.gatt.disconnect(); } catch (e) {}
    }

    device = picked;
    device.addEventListener('gattserverdisconnected', () => {
      characteristic = null;
      server = null;
      emitStatus();
    });

    server = await device.gatt.connect();
    characteristic = await findWritableCharacteristic(server);

    if (!characteristic) {
      try { device.gatt.disconnect(); } catch (e) {}
      device = null;
      server = null;
      throw new Error('Printer Bluetooth tidak memiliki layanan cetak ESC/POS yang kompatibel.');
    }

    localStorage.setItem('cafe_cl_last_bt_name', device.name || 'Thermal Printer');
    emitStatus();
    return { connected: true, name: getDeviceName() };
  }

  function disconnect() {
    if (device && device.gatt && device.gatt.connected) {
      try { device.gatt.disconnect(); } catch (e) {}
    }
    device = null;
    server = null;
    characteristic = null;
    emitStatus();
  }

  async function writeBytes(bytes) {
    if (!isConnected()) throw new Error('Printer Bluetooth belum terhubung.');
    const CHUNK = 96; // Ukuran aman agar buffer BLE printer 58mm tidak overflow
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
      const slice = bytes.slice(offset, offset + CHUNK);
      if (characteristic.properties.writeWithoutResponse) {
        await characteristic.writeValueWithoutResponse(slice);
      } else {
        await characteristic.writeValue(slice);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  // ESC/POS Builder
  function escPosEncode(lines) {
    const encoder = new TextEncoder();
    const parts = [];
    const push = (arr) => parts.push(new Uint8Array(arr));
    const pushText = (txt) => {
      // Bersihkan karakter non-ASCII agar tercetak rapi di printer thermal standar
      const clean = String(txt ?? '')
        .replace(/[•·]/g, '-')
        .replace(/[—–]/g, '-')
        .replace(/[^\x20-\x7E\n]/g, '');
      parts.push(encoder.encode(clean + '\n'));
    };

    push([0x1B, 0x40]); // ESC @ Initialize
    lines.forEach((cmd) => {
      if (cmd.align === 'center') push([0x1B, 0x61, 0x01]);
      else if (cmd.align === 'right') push([0x1B, 0x61, 0x02]);
      else push([0x1B, 0x61, 0x00]);

      if (cmd.bold) push([0x1B, 0x45, 0x01]);
      else push([0x1B, 0x45, 0x00]);

      if (cmd.double) push([0x1D, 0x21, 0x11]);
      else push([0x1D, 0x21, 0x00]);

      if (cmd.text !== undefined) pushText(cmd.text);
    });

    push([0x1B, 0x45, 0x00]);
    push([0x1D, 0x21, 0x00]);
    push([0x1B, 0x64, 0x04]); // Feed 4 lines
    push([0x1D, 0x56, 0x42, 0x00]); // Partial cut (jika didukung printer)

    const totalLen = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (const p of parts) {
      out.set(p, pos);
      pos += p.length;
    }
    return out;
  }

  function formatPair(left, right, width) {
    const l = String(left || '');
    const r = String(right || '');
    const space = Math.max(1, width - l.length - r.length);
    return l.slice(0, Math.max(1, width - r.length - 1)) + ' '.repeat(space) + r;
  }

  function fmtIDR(n, cur = 'Rp') {
    return `${cur} ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
  }

  async function printTest(settings = {}) {
    const w = settings.paper_size === '80mm' ? 48 : 32;
    const sep = '-'.repeat(w);
    const bytes = escPosEncode([
      { align: 'center', bold: true, double: true, text: settings.cafe_name || 'CAFE CL' },
      { align: 'center', text: settings.tagline || 'Artisanal Coffee & POS' },
      { align: 'center', text: sep },
      { align: 'center', bold: true, text: 'TEST PRINT BERHASIL!' },
      { align: 'left', text: formatPair('Printer', getDeviceName(), w) },
      { align: 'left', text: formatPair('Kertas', settings.paper_size || '58mm', w) },
      { align: 'left', text: formatPair('Waktu', new Date().toLocaleTimeString('id-ID'), w) },
      { align: 'center', text: sep },
      { align: 'center', text: 'Siap cetak struk kasir.' }
    ]);
    await writeBytes(bytes);
  }

  async function printOrderReceipt(order, settings = {}) {
    const w = settings.paper_size === '80mm' ? 48 : 32;
    const sep = '-'.repeat(w);
    const cur = settings.currency || 'Rp';
    const lines = [
      { align: 'center', bold: true, double: true, text: settings.cafe_name || 'CAFE CL' },
      { align: 'center', text: settings.address || '' },
      { align: 'center', text: [settings.phone, settings.instagram].filter(Boolean).join(' | ') },
      { align: 'center', text: sep },
      { align: 'left', text: formatPair('No', order.no_invoice, w) },
      { align: 'left', text: formatPair('Tgl', `${order.tanggal} ${order.waktu}`, w) },
      { align: 'left', text: formatPair('Kasir', order.kasir || 'Kasir', w) },
      { align: 'left', text: formatPair('Order', `${order.tipe_order}${order.meja && order.meja !== '-' ? ' (' + order.meja + ')' : ''}`, w) },
      { align: 'left', text: formatPair('Tamu', order.pelanggan || 'Walk-in', w) },
      { align: 'center', text: sep }
    ];

    (order.items || []).forEach((it) => {
      lines.push({ align: 'left', bold: true, text: it.nama });
      if (it.varian) lines.push({ align: 'left', text: '  ' + it.varian });
      if (it.catatan) lines.push({ align: 'left', text: '  * ' + it.catatan });
      lines.push({
        align: 'left',
        text: formatPair(`${it.qty}x ${fmtIDR(it.harga, cur)}`, fmtIDR(it.qty * it.harga, cur), w)
      });
    });

    lines.push({ align: 'center', text: sep });
    lines.push({ align: 'left', text: formatPair('Subtotal', fmtIDR(order.subtotal, cur), w) });
    if (order.diskon > 0) lines.push({ align: 'left', text: formatPair('Diskon', '-' + fmtIDR(order.diskon, cur), w) });
    if (order.pajak > 0) lines.push({ align: 'left', text: formatPair('Pajak PB1', fmtIDR(order.pajak, cur), w) });
    if (order.service_charge > 0) lines.push({ align: 'left', text: formatPair('Service', fmtIDR(order.service_charge, cur), w) });
    lines.push({ align: 'left', bold: true, text: formatPair('TOTAL', fmtIDR(order.total, cur), w) });
    lines.push({ align: 'left', text: formatPair(order.metode_bayar || 'Bayar', fmtIDR(order.bayar, cur), w) });
    if (order.kembalian > 0) lines.push({ align: 'left', text: formatPair('Kembalian', fmtIDR(order.kembalian, cur), w) });
    lines.push({ align: 'left', text: formatPair('Status', order.status_bayar || 'Lunas', w) });
    lines.push({ align: 'center', text: sep });
    lines.push({ align: 'center', text: settings.receipt_footer || 'Terima kasih!' });

    await writeBytes(escPosEncode(lines));
  }

  async function printShiftSummary(shift, settings = {}) {
    const w = settings.paper_size === '80mm' ? 48 : 32;
    const sep = '-'.repeat(w);
    const cur = settings.currency || 'Rp';
    const bytes = escPosEncode([
      { align: 'center', bold: true, double: true, text: settings.cafe_name || 'CAFE CL' },
      { align: 'center', bold: true, text: 'LAPORAN TUTUP SHIFT KASIR' },
      { align: 'center', text: sep },
      { align: 'left', text: formatPair('Kasir', shift.kasir, w) },
      { align: 'left', text: formatPair('Buka', shift.buka_waktu, w) },
      { align: 'left', text: formatPair('Tutup', shift.tutup_waktu, w) },
      { align: 'center', text: sep },
      { align: 'left', text: formatPair('Modal Awal', fmtIDR(shift.modal_awal, cur), w) },
      { align: 'left', text: formatPair('Sales Tunai', fmtIDR(shift.total_tunai, cur), w) },
      { align: 'left', text: formatPair('Non-Tunai', fmtIDR(shift.total_non_tunai, cur), w) },
      { align: 'left', bold: true, text: formatPair('Kas Aktual', fmtIDR(shift.kas_aktual, cur), w) },
      { align: 'left', bold: true, text: formatPair('Selisih', fmtIDR(shift.selisih, cur), w) },
      { align: 'center', text: sep },
      { align: 'center', text: 'Dicetak oleh sistem CAFE CL' }
    ]);
    await writeBytes(bytes);
  }

  return {
    isSupported,
    isConnected,
    getDeviceName,
    onStatusChange,
    connect,
    disconnect,
    printTest,
    printOrderReceipt,
    printShiftSummary
  };
})();

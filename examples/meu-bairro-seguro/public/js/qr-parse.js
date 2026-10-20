'use strict';

// Reads what is inside a camera's QR code (or a code typed from its sticker) and turns it
// into form fields. Camera QR codes usually carry the serial number and a verification code
// for the vendor's cloud app; on several brands that code is also the camera's password.
// Works in the browser (window.parseCameraCode) and in Node tests (module.exports).
(function (root) {
  const CLOUD_ONLY = /tuya|smartlife|smart-life|ring\.com|nest\.com|wyze|xiaomi|mi\.com/i;

  function fromUrl(text) {
    let url;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    const scheme = url.protocol.replace(':', '').toLowerCase();
    if (['rtsp', 'rtsps', 'rtmp', 'rtmps'].includes(scheme) || (/^https?$/.test(scheme) && /\.m3u8$|mjpe?g|video|stream/i.test(url.pathname))) {
      const username = decodeURIComponent(url.username);
      const password = decodeURIComponent(url.password);
      url.username = '';
      url.password = '';
      return {
        kind: 'url',
        brand: scheme.startsWith('rtmp') ? 'rtmp' : scheme.startsWith('http') ? 'http' : 'generic',
        url: url.toString(),
        username,
        password,
      };
    }
    if (CLOUD_ONLY.test(url.hostname)) return { kind: 'cloud', cloudOnly: true };
    // Vendor app links (Yoosee, EZVIZ, Imou...) carry the device id as a query parameter.
    const id = ['id', 'sn', 'serial', 'deviceId', 'devId', 'uid'].map((k) => url.searchParams.get(k)).find(Boolean);
    if (id) return { kind: 'serial', serial: id, brand: guessBrand(url.hostname + url.pathname, id) };
    return null;
  }

  function guessBrand(text, serial) {
    if (/intelbras|mibo/i.test(text)) return 'intelbras';
    if (/ezviz|ys7|hik/i.test(text)) return 'hikvision';
    if (/imou|dahua|lechange/i.test(text)) return 'dahua';
    if (/yoosee|gwell|2cu/i.test(text)) return 'yoosee';
    if (/xmeye|icsee|xiongmai|xm030/i.test(text)) return 'xmeye';
    if (/tapo|tp-?link/i.test(text)) return 'tapo';
    if (serial && /^[0-9a-f]{16}$/i.test(serial)) return 'xmeye';
    if (serial && /^\d{7,10}$/.test(serial)) return 'yoosee';
    return '';
  }

  function parseCameraCode(raw) {
    const text = String(raw || '').trim();
    if (!text) return { kind: 'empty' };
    if (CLOUD_ONLY.test(text)) return { kind: 'cloud', cloudOnly: true, raw: text };

    const asUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? fromUrl(text) : null;
    if (asUrl) return { ...asUrl, raw: text };

    // Dahua / Imou / Intelbras: "SN:7F0ABC123,DT:IPC-...,SC:abcd1234" (sometimes inside braces).
    if (/\bSN\s*[:=]/i.test(text)) {
      const fields = {};
      for (const m of text.replace(/[{}]/g, '').matchAll(/([A-Za-z]{2,4})\s*[:=]\s*([^,;\s]+)/g)) fields[m[1].toUpperCase()] = m[2];
      return {
        kind: 'serial',
        serial: fields.SN,
        code: fields.SC || fields.RD || fields.VC || '',
        model: fields.DT || '',
        brand: guessBrand(text, fields.SN) || 'dahua',
        raw: text,
      };
    }

    // Hikvision / EZVIZ: lines with domain, 9-char serial, 6-letter verification code, model.
    const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      const serial = lines.find((l) => /^[A-Z0-9]{9}$/.test(l)) || lines.find((l) => /^[A-Z0-9]{8,20}$/.test(l));
      const code = lines.find((l) => /^[A-Z]{6}$/.test(l) && l !== serial) || '';
      const model = lines.find((l) => /^(CS|DS|IPC|HIK)-/i.test(l)) || '';
      if (serial) return { kind: 'serial', serial, code, model, brand: guessBrand(text, serial) || 'hikvision', raw: text };
    }

    // Just a code typed from the sticker.
    const compact = text.replace(/\s+/g, '');
    if (/^[A-Za-z0-9-]{6,40}$/.test(compact)) return { kind: 'serial', serial: compact, brand: guessBrand('', compact), raw: text };
    return { kind: 'unknown', raw: text };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { parseCameraCode };
  else root.parseCameraCode = parseCameraCode;
})(typeof window !== 'undefined' ? window : globalThis);

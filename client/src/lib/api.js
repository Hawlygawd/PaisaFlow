// Tiny data layer for PaisaFlow with TWO interchangeable modes:
// - 'server' (hosted website): calls same-origin /api (the classic Express backend)
// - 'local'  (Android APK, or any static hosting): every call is served by the
//   on-device backend in localBackend.js and stored on the phone. No server needed.
//
// Mode is detected once at startup: native Capacitor = local; otherwise probe
// /api/health — if no server answers, we fall back to local automatically.

import { Capacitor } from '@capacitor/core';
import * as local from './localBackend.js';

export { setPin, clearPin, hasPin, verifyPin, wipeLocalData } from './localBackend.js';

export const isNative = () => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

let MODE = null; // 'server' | 'local' — resolved by initApi() before the app renders
export const getMode = () => MODE;
export const isLocal = () => MODE === 'local';

export async function initApi() {
  if (MODE) return MODE;
  if (isNative()) {
    MODE = 'local';
  } else {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 2500);
      const res = await fetch('/api/health', { signal: ctl.signal, credentials: 'include' });
      clearTimeout(timer);
      MODE = res.ok ? 'server' : 'local';
    } catch {
      MODE = 'local';
    }
  }
  if (MODE === 'local') local.ensureLocalProfile();
  return MODE;
}

export const getToken = () => localStorage.getItem('pf_token') || '';
export const setToken = (t) => {
  if (t) localStorage.setItem('pf_token', t);
  else localStorage.removeItem('pf_token');
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function serverRequest(path, { method = 'GET', body, raw = false } = {}) {
  const opts = { method, credentials: 'include', headers: {} };
  const token = getToken();
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) {
    if (raw) {
      opts.headers['Content-Type'] = 'text/csv';
      opts.body = body;
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch('/api' + path, opts);
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
  if (res.status === 401 && !path.startsWith('/auth/me')) {
    window.dispatchEvent(new Event('pf:unauthorized'));
  }
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

async function request(path, opts = {}) {
  if (MODE === 'local') {
    try {
      return await local.handle(opts.method || 'GET', path, { body: opts.body, rawBody: opts.body });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(e.status || 500, e.message || 'Something went wrong');
    }
  }
  return serverRequest(path, opts);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const api = {
  get: (p) => request(p),
  post: (p, b) => request(p, { method: 'POST', body: b }),
  put: (p, b) => request(p, { method: 'PUT', body: b }),
  patch: (p, b) => request(p, { method: 'PATCH', body: b }),
  del: (p) => request(p, { method: 'DELETE' }),
  postRaw: (p, text) => request(p, { method: 'POST', body: text, raw: true }),
  download: async (p) => {
    if (MODE === 'local') {
      // Generate the CSV on-device and hand it to Android's share sheet
      // (Share → Save to Files / WhatsApp / Drive), with a plain download fallback.
      const csv = '\ufeff' + local.buildExportCsv();
      const filename = `paisaflow-export-${new Date().toISOString().slice(0, 10)}.csv`;
      try {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const file = new File([blob], filename, { type: 'text/csv' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'PaisaFlow export' });
          return;
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return; // user closed the share sheet
      }
      triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
      return;
    }
    const a = document.createElement('a');
    a.href = '/api' + p;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
};

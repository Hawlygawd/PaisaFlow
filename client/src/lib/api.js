// Tiny fetch wrapper for the PaisaFlow API.
// - Browser build: calls same-origin /api
// - Packaged Android app: calls the server URL saved in localStorage (pf_server_url)
//   and authenticates with a Bearer token (cookies don't travel cross-origin in WebViews).

export const getServerUrl = () => (localStorage.getItem('pf_server_url') || '').replace(/\/+$/, '');
export const setServerUrl = (url) => {
  if (url) localStorage.setItem('pf_server_url', url.trim().replace(/\/+$/, ''));
  else localStorage.removeItem('pf_server_url');
};
export const getToken = () => localStorage.getItem('pf_token') || '';
export const setToken = (t) => {
  if (t) localStorage.setItem('pf_token', t);
  else localStorage.removeItem('pf_token');
};

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, raw = false } = {}) {
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
    res = await fetch(getServerUrl() + '/api' + path, opts);
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check the Server URL in Settings and your connection.');
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

export const api = {
  get: (p) => request(p),
  post: (p, b) => request(p, { method: 'POST', body: b }),
  put: (p, b) => request(p, { method: 'PUT', body: b }),
  patch: (p, b) => request(p, { method: 'PATCH', body: b }),
  del: (p) => request(p, { method: 'DELETE' }),
  postRaw: (p, text) => request(p, { method: 'POST', body: text, raw: true }),
  download: (p) => {
    const a = document.createElement('a');
    a.href = getServerUrl() + '/api' + p;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
};

export { ApiError };

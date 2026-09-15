// Money & date helpers — all amounts are integer paise internally (₹1 = 100 paise)

const inrFmt = (opts) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, ...opts });

export function inr(paise, { symbol = true, decimals = 2 } = {}) {
  const v = (Number(paise) || 0) / 100;
  const s = inrFmt({ minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Math.abs(v));
  return `${v < 0 ? '−' : ''}${symbol ? '₹' : ''}${s}`;
}

// Compact for charts/axes: ₹1.2L, ₹45.6K, ₹3Cr
export function inrCompact(paise) {
  const v = Math.abs(Number(paise) || 0) / 100;
  const sign = (Number(paise) || 0) < 0 ? '−' : '';
  if (v >= 1e7) return `${sign}₹${(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)}Cr`;
  if (v >= 1e5) return `${sign}₹${(v / 1e5).toFixed(v >= 1e6 ? 0 : 1)}L`;
  if (v >= 1000) return `${sign}₹${(v / 1000).toFixed(v >= 1e4 ? 0 : 1)}K`;
  return `${sign}₹${Math.round(v)}`;
}

export const paiseToRupeeInput = (paise) => {
  if (!paise) return '';
  const s = (paise / 100).toFixed(2);
  return s.endsWith('.00') ? s.slice(0, -3) : s.endsWith('0') ? s.slice(0, -1) : s;
};

export const rupeeInputToPaise = (str) => {
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
};

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function thisMonth() {
  return todayStr().slice(0, 7);
}

export function addMonthsStr(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export function monthLabelShort(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

export function dateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = todayStr();
  if (dateStr === today) return 'Today';
  if (dateStr === addDaysStr(today, -1)) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}

export function addDaysStr(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isFuture(dateStr) {
  return dateStr > todayStr();
}

export function signedInr(paise, type) {
  if (type === 'income') return `+${inr(paise)}`;
  if (type === 'expense') return `−${inr(paise)}`;
  return inr(paise);
}

export const pctChange = (curr, prev) => {
  if (!prev) return curr ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
};

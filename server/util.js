// ---- helpers shared across routes ----

function camelizeRow(row) {
  if (!row) return row;
  const out = {};
  for (const k of Object.keys(row)) {
    out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = row[k];
  }
  return out;
}
const camelize = (rows) => (Array.isArray(rows) ? rows.map(camelizeRow) : camelizeRow(rows));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

function localDateStr(d = new Date()) {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 10);
}
function localMonthStr(d = new Date()) {
  return localDateStr(d).slice(0, 7);
}
const todayStr = () => localDateStr();

function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function addFrequency(dateStr, freq) {
  switch (freq) {
    case 'daily': return addDays(dateStr, 1);
    case 'weekly': return addDays(dateStr, 7);
    case 'monthly': return addMonths(dateStr, 1);
    case 'yearly': return addMonths(dateStr, 12);
    default: return addMonths(dateStr, 1);
  }
}
function monthRange(month) {
  // month 'YYYY-MM' → { from, to }
  const from = month + '-01';
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: month + '-' + String(last).padStart(2, '0') };
}
function monthsBetween(from, to) {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  let k = (y2 - y1) * 12 + (m2 - m1);
  if (d2 < d1) k--;
  return Math.max(0, k);
}

// rupees (number/string) → integer paise, or null if invalid
function toPaise(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function calcEmi(principalPaise, rateAnnualPct, months) {
  const r = rateAnnualPct / 1200;
  if (r === 0) return Math.round(principalPaise / months);
  const p = Math.pow(1 + r, months);
  return Math.round((principalPaise * r * p) / (p - 1));
}

// Outstanding loan balance using compound math (handles extra payments)
function loanOutstanding(loan, payments) {
  const r = loan.rate / 1200;
  const now = todayStr();
  const k = monthsBetween(loan.start_date, now);
  let out = loan.principal * Math.pow(1 + r, k);
  for (const p of payments) {
    const kk = monthsBetween(p.date, now);
    out -= p.amount * Math.pow(1 + r, kk);
  }
  return Math.max(0, Math.round(out));
}

// Full amortization schedule for display
function loanSchedule(loan) {
  const r = loan.rate / 1200;
  const rows = [];
  let balance = loan.principal;
  for (let i = 1; i <= loan.tenure_months && balance > 0; i++) {
    const interest = Math.round(balance * r);
    let principalPart = loan.emi - interest;
    if (principalPart > balance) principalPart = balance;
    const payment = principalPart + interest;
    balance = Math.max(0, balance - principalPart);
    rows.push({
      month: i,
      date: addMonths(loan.start_date, i),
      emi: payment,
      interest,
      principal: principalPart,
      balance
    });
  }
  return rows;
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Minimal robust CSV parser (handles quoted fields)
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* skip */ }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

module.exports = {
  camelize, DATE_RE, MONTH_RE, localDateStr, localMonthStr, todayStr,
  addMonths, addDays, addFrequency, monthRange, monthsBetween,
  toPaise, calcEmi, loanOutstanding, loanSchedule, csvEscape, parseCsv
};

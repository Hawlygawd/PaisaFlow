// PaisaFlow local backend — a complete, faithful, on-device implementation of the
// server's REST API. When the app runs inside the Android APK (or anywhere no
// PaisaFlow server is reachable), every api.* call is served from here and the
// data is persisted in localStorage on the device. No server, no internet, no setup.
//
// Response shapes mirror server/routes/* exactly (including snake_case → camelCase),
// so the UI code is identical in both modes.

const STORAGE_KEY = 'pf_local_db_v1';

// ---------------------------------------------------------------- date helpers
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

function localDateStr(d = new Date()) {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 10);
}
const localMonthStr = () => localDateStr().slice(0, 7);
const todayStr = () => localDateStr();
const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

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
    rows.push({ month: i, date: addMonths(loan.start_date, i), emi: payment, interest, principal: principalPart, balance });
  }
  return rows;
}
function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function parseCsv(text) {
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

// ---------------------------------------------------------------- database
function camelizeRow(row) {
  if (!row) return row;
  const out = {};
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = row[k];
  return out;
}
const camelize = (rows) => (Array.isArray(rows) ? rows.map(camelizeRow) : camelizeRow(rows));

let saveTimer = null;
function persist() {
  // Debounced save batches multi-step operations (imports, recurring catch-ups)
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (e) {
      console.error('PaisaFlow: could not save data on this device', e);
    }
  }, 60);
  // Also flush synchronously when the app goes to background
  if (typeof document !== 'undefined' && !document.__pfFlushHook) {
    document.__pfFlushHook = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && db) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch { /* best effort */ }
      }
    });
  }
}

function emptyDb() {
  return {
    version: 1,
    seq: {},
    user: null, // { id, name, email, upi_id, password_hash?, pin_hash?, created_at }
    accounts: [],
    categories: [],
    transactions: [],
    budgets: [],
    goals: [],
    goal_entries: [],
    recurring: [],
    loans: [],
    loan_payments: [],
    requests: [],
    sms_seen: {}
  };
}

let db = null;
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  db = raw ? JSON.parse(raw) : null;
  if (!db || typeof db !== 'object' || !db.version) db = null;
} catch { db = null; }

const SEQ_TABLES = {
  users: 'users', accounts: 'accounts', categories: 'categories', transactions: 'transactions',
  budgets: 'budgets', goals: 'goals', goal_entries: 'goal_entries', recurring: 'recurring',
  loans: 'loans', loan_payments: 'loan_payments', requests: 'requests'
};
function nextId(table) {
  if (!db.seq[table]) db.seq[table] = 1;
  return db.seq[table]++;
}

const DEFAULT_CATEGORIES = [
  ['expense', 'Food & Dining', '🍔', '#f97316'],
  ['expense', 'Groceries', '🛒', '#84cc16'],
  ['expense', 'Shopping', '🛍️', '#ec4899'],
  ['expense', 'Transport', '🚗', '#3b82f6'],
  ['expense', 'Rent', '🏠', '#8b5cf6'],
  ['expense', 'Utilities', '💡', '#eab308'],
  ['expense', 'Bills & Recharge', '📱', '#06b6d4'],
  ['expense', 'Health', '🏥', '#ef4444'],
  ['expense', 'Education', '📚', '#6366f1'],
  ['expense', 'Entertainment', '🎬', '#d946ef'],
  ['expense', 'Travel', '✈️', '#0ea5e9'],
  ['expense', 'Fitness', '💪', '#22c55e'],
  ['expense', 'EMI & Loans', '🏦', '#64748b'],
  ['expense', 'Gifts & Donations', '🎁', '#f43f5e'],
  ['expense', 'Subscriptions', '📺', '#a855f7'],
  ['expense', 'Others', '📦', '#94a3b8'],
  ['income', 'Salary', '💼', '#22c55e'],
  ['income', 'Business', '📈', '#10b981'],
  ['income', 'Investments', '📊', '#14b8a6'],
  ['income', 'Freelance', '💻', '#0ea5e9'],
  ['income', 'Interest & Cashback', '🪙', '#eab308'],
  ['income', 'Other Income', '💰', '#84cc16']
];

function seedUser() {
  db.user = {
    id: nextId('users'),
    name: 'You',
    email: 'local@device',
    password_hash: '',
    pin_hash: '',
    upi_id: '',
    created_at: nowStr()
  };
  for (const [type, name, emoji, color] of DEFAULT_CATEGORIES) {
    db.categories.push({ id: nextId('categories'), user_id: db.user.id, name, type, emoji, color, is_default: 1 });
  }
  db.accounts.push({
    id: nextId('accounts'), user_id: db.user.id, name: 'Cash', type: 'cash', emoji: '💵',
    color: '#22c55e', initial_balance: 0, is_archived: 0, created_at: nowStr()
  });
  persist();
}

export function ensureLocalProfile() {
  if (!db) { db = emptyDb(); }
  if (!db.user) seedUser();
  return db.user;
}

// Adopt a user identity (name + email). Used when importing/restoring data and
// by the parity test so both backends represent the same person.
export function adoptIdentity(name, email) {
  ensureLocalProfile();
  if (name) db.user.name = String(name);
  if (email) db.user.email = String(email);
  persist();
}

// Public view of the user — mirrors the server's SELECT (no password/pin hashes)
function publicUser() {
  const u = db.user;
  return { id: u.id, name: u.name, email: u.email, upi_id: u.upi_id, created_at: u.created_at };
}

export function wipeLocalData() {
  db = emptyDb();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  seedUser();
}

// ---------------------------------------------------------------- auth extras
async function sha256(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Very old WebViews without crypto.subtle — non-critical fallback
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
    return 'f' + h.toString(16);
  }
}
export async function setPin(pin) {
  ensureLocalProfile();
  db.user.pin_hash = await sha256('pf-pin:' + String(pin));
  persist();
  return true;
}
export async function clearPin(pin) {
  ensureLocalProfile();
  if (!db.user.pin_hash) return true;
  const h = await sha256('pf-pin:' + String(pin));
  if (h !== db.user.pin_hash) return false;
  db.user.pin_hash = '';
  persist();
  return true;
}
export function hasPin() {
  return !!(db && db.user && db.user.pin_hash);
}
export async function verifyPin(pin) {
  if (!hasPin()) return true;
  const h = await sha256('pf-pin:' + String(pin));
  return h === db.user.pin_hash;
}

// ---------------------------------------------------------------- recurring
function processDueRecurring() {
  const today = todayStr();
  const uid = db.user.id;
  const due = db.recurring.filter((r) =>
    r.user_id === uid && r.active === 1 && r.next_date <= today && (!r.end_date || r.end_date >= r.next_date));
  if (!due.length) return 0;

  let posted = 0;
  for (const r of due) {
    let next = r.next_date;
    let lastPosted = r.last_posted;
    let count = 0;
    while (next <= today && count < 12 && (!r.end_date || next <= r.end_date)) {
      db.transactions.push({
        id: nextId('transactions'), user_id: uid, type: r.type, amount: r.amount, account_id: r.account_id,
        to_account_id: null, category_id: r.category_id, note: r.name, tags: '[]',
        date: next, source: 'recurring', created_at: nowStr(), updated_at: nowStr()
      });
      lastPosted = next;
      next = addFrequency(next, r.frequency);
      count++;
      posted++;
    }
    if (r.end_date && next > r.end_date) {
      r.active = 0; r.next_date = next; r.last_posted = lastPosted;
    } else {
      let guard = 0;
      while (next <= today && guard++ < 500) next = addFrequency(next, r.frequency);
      r.next_date = next; r.last_posted = lastPosted;
    }
  }
  persist();
  return posted;
}

// ---------------------------------------------------------------- join helpers
function joinTxn(t) {
  const c = db.categories.find((x) => x.id === t.category_id) || null;
  const a = db.accounts.find((x) => x.id === t.account_id) || null;
  const a2 = db.accounts.find((x) => x.id === t.to_account_id) || null;
  return {
    ...t,
    category_name: c ? c.name : null, category_emoji: c ? c.emoji : null,
    category_color: c ? c.color : null, category_type: c ? c.type : null,
    account_name: a ? a.name : null, account_emoji: a ? a.emoji : null, account_color: a ? a.color : null,
    to_account_name: a2 ? a2.name : null, to_account_emoji: a2 ? a2.emoji : null
  };
}
function accountBalance(a) {
  let bal = a.initial_balance;
  let count = 0;
  for (const t of db.transactions) {
    if (t.type === 'income' && t.account_id === a.id) bal += t.amount;
    else if (t.type === 'expense' && t.account_id === a.id) bal -= t.amount;
    else if (t.type === 'transfer' && t.to_account_id === a.id) bal += t.amount;
    else if (t.type === 'transfer' && t.account_id === a.id) bal -= t.amount;
    if (t.account_id === a.id || t.to_account_id === a.id) count++;
  }
  return { balance: bal, txn_count: count };
}
function accountsWithBalance() {
  return db.accounts
    .slice()
    .sort((a, b) => (a.is_archived - b.is_archived) || (a.id - b.id))
    .map((a) => ({ ...accountBalance(a), ...a }));
}
function accountView(id) {
  const a = db.accounts.find((x) => x.id === id);
  if (!a) return null;
  return { ...accountBalance(a), ...a };
}
function goalView(g) {
  let saved = 0, count = 0;
  for (const e of db.goal_entries) {
    if (e.goal_id === g.id) { saved += e.amount; count++; }
  }
  return { ...g, saved, entry_count: count };
}
function recurringView(r) {
  const c = db.categories.find((x) => x.id === r.category_id) || null;
  const a = db.accounts.find((x) => x.id === r.account_id) || null;
  return {
    ...r,
    category_name: c ? c.name : null, category_emoji: c ? c.emoji : null, category_color: c ? c.color : null,
    account_name: a ? a.name : null, account_emoji: a ? a.emoji : null
  };
}
function loanView(loan) {
  const payments = db.loan_payments.filter((p) => p.loan_id === loan.id);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = loanOutstanding(loan, payments);
  const principalRepaid = Math.max(0, Math.min(loan.principal, loan.principal - outstanding));
  const interestPaid = Math.max(0, totalPaid - principalRepaid);
  const monthsElapsed = monthsBetween(loan.start_date, todayStr());
  return {
    ...camelize(loan),
    totalPaid,
    outstanding,
    interestPaid,
    monthsElapsed,
    progress: loan.principal > 0 ? Math.min(100, Math.round((principalRepaid / loan.principal) * 100)) : 0,
    totalInterest: loanSchedule(loan).reduce((s, r) => s + r.interest, 0)
  };
}

// ---------------------------------------------------------------- routing
class LocalApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const err = (status, message) => { throw new LocalApiError(status, message); };

function monthTotals(from, to) {
  let income = 0, expense = 0;
  for (const t of db.transactions) {
    if (t.user_id !== db.user.id || t.date < from || t.date > to) continue;
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
  }
  return { income, expense };
}

function expenseByCategory(from, to, limit) {
  const map = new Map();
  for (const t of db.transactions) {
    if (t.user_id !== db.user.id || t.date < from || t.date > to || t.type !== 'expense') continue;
    const c = db.categories.find((x) => x.id === t.category_id);
    const key = c ? c.id : 0;
    const cur = map.get(key) || {
      name: c ? c.name : 'Uncategorized', emoji: c ? c.emoji : '📦', color: c ? c.color : '#94a3b8', total: 0
    };
    cur.total += t.amount;
    map.set(key, cur);
  }
  const rows = [...map.values()].sort((a, b) => b.total - a.total);
  return limit ? rows.slice(0, limit) : rows;
}
function incomeByCategory(from, to) {
  const map = new Map();
  for (const t of db.transactions) {
    if (t.user_id !== db.user.id || t.date < from || t.date > to || t.type !== 'income') continue;
    const c = db.categories.find((x) => x.id === t.category_id);
    const key = c ? c.id : 0;
    const cur = map.get(key) || {
      name: c ? c.name : 'Uncategorized', emoji: c ? c.emoji : '📦', color: c ? c.color : '#22c55e', total: 0
    };
    cur.total += t.amount;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}
function expenseByAccount(from, to) {
  const map = new Map();
  for (const t of db.transactions) {
    if (t.user_id !== db.user.id || t.date < from || t.date > to || t.type !== 'expense') continue;
    const a = db.accounts.find((x) => x.id === t.account_id);
    const key = a ? a.id : 0;
    const cur = map.get(key) || {
      name: a ? a.name : 'No account', emoji: a ? a.emoji : '💳', color: a ? a.color : '#6366f1', total: 0
    };
    cur.total += t.amount;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}
function dailyExpense(from, to) {
  const map = new Map();
  for (const t of db.transactions) {
    if (t.user_id !== db.user.id || t.date < from || t.date > to || t.type !== 'expense') continue;
    map.set(t.date, (map.get(t.date) || 0) + t.amount);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, total]) => ({ date, total }));
}

function txnList(q) {
  processDueRecurring();
  const uid = db.user.id;
  let rows = db.transactions.filter((t) => t.user_id === uid);
  if (q.type && ['income', 'expense', 'transfer'].includes(q.type)) rows = rows.filter((t) => t.type === q.type);
  if (q.accountId) rows = rows.filter((t) => t.account_id === Number(q.accountId) || t.to_account_id === Number(q.accountId));
  if (q.categoryId) rows = rows.filter((t) => t.category_id === Number(q.categoryId));
  if (q.month && MONTH_RE.test(q.month)) {
    const { from, to } = monthRange(q.month);
    rows = rows.filter((t) => t.date >= from && t.date <= to);
  } else {
    if (q.from && DATE_RE.test(q.from)) rows = rows.filter((t) => t.date >= q.from);
    if (q.to && DATE_RE.test(q.to)) rows = rows.filter((t) => t.date <= q.to);
  }
  if (q.tag) rows = rows.filter((t) => String(t.tags || '[]').includes('"' + q.tag + '"'));
  if (q.q) {
    const needle = String(q.q).toLowerCase();
    rows = rows.filter((t) => (t.note || '').toLowerCase().includes(needle) || String(t.tags || '').toLowerCase().includes(needle));
  }

  const sorts = {
    date_desc: (a, b) => b.date.localeCompare(a.date) || b.id - a.id,
    date_asc: (a, b) => a.date.localeCompare(b.date) || a.id - b.id,
    amount_desc: (a, b) => b.amount - a.amount || b.id - a.id,
    amount_asc: (a, b) => a.amount - b.amount || a.id - b.id
  };
  rows.sort(sorts[q.sort] || sorts.date_desc);

  let income = 0, expense = 0;
  for (const t of rows) {
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
  }
  const total = rows.length;
  const limit = Math.min(Math.max(parseInt(q.limit) || 40, 1), 200);
  const page = Math.max(parseInt(q.page) || 1, 1);
  const items = rows.slice((page - 1) * limit, page * limit).map((t) => camelize(joinTxn(t)));
  return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)), totals: { income, expense, net: income - expense } };
}

function validateTxnBody(body, partial = false) {
  const out = {};
  const type = body.type;
  if (!partial || type !== undefined) {
    if (!['income', 'expense', 'transfer'].includes(type)) return { error: 'Type must be income, expense or transfer' };
    out.type = type;
  }
  if (!partial || body.amount !== undefined) {
    const amount = toPaise(body.amount);
    if (!amount) return { error: 'Enter a valid amount greater than zero' };
    out.amount = amount;
  }
  if (!partial || body.date !== undefined) {
    if (!DATE_RE.test(String(body.date || ''))) return { error: 'A valid date is required' };
    out.date = String(body.date);
  }
  const effType = out.type;
  if (effType === 'transfer') {
    if (body.accountId != null && body.toAccountId != null && Number(body.accountId) === Number(body.toAccountId)) {
      return { error: 'From and To accounts must be different' };
    }
  }
  if (body.accountId !== undefined) out.account_id = body.accountId ? Number(body.accountId) : null;
  if (body.toAccountId !== undefined) out.to_account_id = body.toAccountId ? Number(body.toAccountId) : null;
  if (body.categoryId !== undefined) out.category_id = body.categoryId ? Number(body.categoryId) : null;
  if (body.note !== undefined) out.note = String(body.note).slice(0, 300);
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) return { error: 'Tags must be a list' };
    out.tags = JSON.stringify([...new Set(body.tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 10));
  }
  if (body.source !== undefined) out.source = String(body.source).slice(0, 20);
  return { out };
}

function firstOfMonth(month) { return month + '-01'; }

function route(method, path, { body, rawBody } = {}) {
  const uid = db.user.id;
  const user = () => db.user;
  const [pathOnly, queryStr] = path.split('?');
  const q = Object.fromEntries(new URLSearchParams(queryStr || ''));
  const seg = pathOnly.split('/').filter(Boolean); // e.g. ['transactions', '12', 'payments']
  const root = seg[0];
  const p1 = seg[1];
  const p2 = seg[2];
  const b = body || {};

  // ---------- auth ----------
  if (root === 'auth') {
    if (p1 === 'me' && method === 'GET') return { user: camelize(publicUser()) };
    if (p1 === 'me' && method === 'PATCH') {
      if (!b.name || !String(b.name).trim()) return err(400, 'Name is required');
      const upi = b.upiId !== undefined ? String(b.upiId).trim().toLowerCase() : undefined;
      if (upi && !/^[a-z0-9.\-_]{2,}@[a-z]{2,}$/i.test(upi)) return err(400, 'Enter a valid UPI ID, e.g. yourname@okhdfcbank');
      user().name = String(b.name).trim();
      if (upi !== undefined) user().upi_id = upi;
      persist();
      return { user: camelize(publicUser()) };
    }
    if (p1 === 'password' && method === 'POST') return { ok: true }; // PIN is managed natively in local mode
    if (p1 === 'register' || p1 === 'login') {
      // Local mode always has a profile; these only exist for API parity.
      return { user: camelize(publicUser()), token: 'local' };
    }
    if (p1 === 'logout') return { ok: true };
  }

  // ---------- accounts ----------
  if (root === 'accounts') {
    if (!p1 && method === 'GET') return { accounts: camelize(accountsWithBalance()) };
    if (!p1 && method === 'POST') {
      if (!b.name || !String(b.name).trim()) return err(400, 'Account name is required');
      const VALID_TYPES = ['cash', 'bank', 'upi', 'card', 'wallet', 'other'];
      const t = VALID_TYPES.includes(b.type) ? b.type : 'other';
      const init = b.initialBalance == null || b.initialBalance === '' ? 0 : Math.round(Number(b.initialBalance) * 100);
      if (!isFinite(init)) return err(400, 'Invalid opening balance');
      const acc = {
        id: nextId('accounts'), user_id: uid, name: String(b.name).trim(), type: t,
        emoji: String(b.emoji || '💵'), color: String(b.color || '#6366f1'),
        initial_balance: init, is_archived: 0, created_at: nowStr()
      };
      db.accounts.push(acc);
      persist();
      return { account: camelize(accountView(acc.id)) };
    }
    const acc = db.accounts.find((x) => x.id === Number(p1) && x.user_id === uid);
    if (acc && method === 'PATCH') {
      const { name, type, emoji, color, initialBalance, isArchived } = b;
      if (initialBalance != null && initialBalance !== '' && !isFinite(Math.round(Number(initialBalance) * 100))) {
        return err(400, 'Invalid opening balance');
      }
      const VALID_TYPES = ['cash', 'bank', 'upi', 'card', 'wallet', 'other'];
      acc.name = name != null ? (String(name).trim() || acc.name) : acc.name;
      acc.type = VALID_TYPES.includes(type) ? type : acc.type;
      acc.emoji = emoji != null ? String(emoji) : acc.emoji;
      acc.color = color != null ? String(color) : acc.color;
      acc.initial_balance = initialBalance != null && initialBalance !== '' ? Math.round(Number(initialBalance) * 100) : acc.initial_balance;
      acc.is_archived = isArchived != null ? (isArchived ? 1 : 0) : acc.is_archived;
      persist();
      return { account: camelize(accountView(acc.id)) };
    }
    if (acc && method === 'DELETE') {
      const count = db.transactions.filter((t) => t.user_id === uid && (t.account_id === acc.id || t.to_account_id === acc.id)).length;
      if (count > 0) return err(400, `This account has ${count} transaction(s). Archive it instead, or delete those transactions first.`);
      db.accounts = db.accounts.filter((x) => x.id !== acc.id);
      persist();
      return { ok: true };
    }
    if (!acc && p1) return err(404, 'Account not found');
  }

  // ---------- categories ----------
  if (root === 'categories') {
    if (!p1 && method === 'GET') {
      const rows = db.categories
        .slice()
        .sort((a, b) => b.type.localeCompare(a.type) || (b.is_default - a.is_default) || (a.id - b.id));
      return { categories: camelize(rows) };
    }
    if (!p1 && method === 'POST') {
      if (!b.name || !String(b.name).trim()) return err(400, 'Category name is required');
      if (!['income', 'expense'].includes(b.type)) return err(400, 'Type must be income or expense');
      const dup = db.categories.find((c) => c.user_id === uid && c.name.toLowerCase() === String(b.name).trim().toLowerCase() && c.type === b.type);
      if (dup) return err(409, 'A category with this name already exists');
      const cat = { id: nextId('categories'), user_id: uid, name: String(b.name).trim(), type: b.type, emoji: String(b.emoji || '📦'), color: String(b.color || '#6366f1'), is_default: 0 };
      db.categories.push(cat);
      persist();
      return { category: camelize(cat) };
    }
    const cat = db.categories.find((x) => x.id === Number(p1) && x.user_id === uid);
    if (cat && method === 'PATCH') {
      if (b.name != null && String(b.name).trim()) cat.name = String(b.name).trim();
      if (b.emoji != null) cat.emoji = String(b.emoji);
      if (b.color != null) cat.color = String(b.color);
      persist();
      return { category: camelize(cat) };
    }
    if (cat && method === 'DELETE') {
      // Transactions keep existing but become uncategorized; budgets are removed (mirrors FK behaviour)
      db.categories = db.categories.filter((x) => x.id !== cat.id);
      db.budgets = db.budgets.filter((x) => x.category_id !== cat.id);
      persist();
      return { ok: true };
    }
    if (!cat && p1) return err(404, 'Category not found');
  }

  // ---------- transactions ----------
  if (root === 'transactions') {
    if (!p1 && method === 'GET') return txnList(q);
    if (p1 === 'tags' && method === 'GET') {
      const set = new Set();
      for (const t of db.transactions) {
        if (t.user_id !== uid || t.tags === '[]') continue;
        try { for (const tg of JSON.parse(t.tags)) set.add(tg); } catch { /* ignore */ }
      }
      return { tags: [...set].sort() };
    }
    if (p1 === 'bulk-delete' && method === 'POST') {
      const ids = (b.ids || []).map(Number);
      if (!Array.isArray(ids) || !ids.length) return err(400, 'No transactions selected');
      let deleted = 0;
      db.transactions = db.transactions.filter((t) => {
        if (t.user_id === uid && ids.includes(t.id)) { deleted++; return false; }
        return true;
      });
      persist();
      return { deleted };
    }
    if (!p1 && method === 'POST') {
      const v = validateTxnBody(b);
      if (v.error) return err(400, v.error);
      const t = v.out;
      if (t.type === 'transfer' && (!t.account_id || !t.to_account_id)) return err(400, 'Transfers need both a from and a to account');
      if (t.account_id && !db.accounts.find((a) => a.id === t.account_id && a.user_id === uid)) return err(400, 'Account not found');
      if (t.to_account_id && !db.accounts.find((a) => a.id === t.to_account_id && a.user_id === uid)) return err(400, 'Destination account not found');
      const row = {
        id: nextId('transactions'), user_id: uid, type: t.type, amount: t.amount,
        account_id: t.account_id ?? null, to_account_id: t.to_account_id ?? null,
        category_id: t.category_id ?? null, note: t.note ?? '', tags: t.tags ?? '[]',
        date: t.date, source: t.source || 'manual', created_at: nowStr(), updated_at: nowStr()
      };
      db.transactions.push(row);
      persist();
      return { transaction: camelize(joinTxn(row)) };
    }
    const txn = db.transactions.find((x) => x.id === Number(p1) && x.user_id === uid);
    if (txn && method === 'PATCH') {
      const v = validateTxnBody(b, true);
      if (v.error) return err(400, v.error);
      const merged = { ...txn, ...v.out };
      if (merged.type === 'transfer' && (!merged.account_id || !merged.to_account_id)) return err(400, 'Transfers need both a from and a to account');
      if (merged.type === 'transfer' && merged.account_id === merged.to_account_id) return err(400, 'From and To accounts must be different');
      if (merged.type !== 'transfer') merged.to_account_id = null;
      if (merged.type === 'transfer') merged.category_id = null;
      Object.assign(txn, {
        type: merged.type, amount: merged.amount, account_id: merged.account_id ?? null,
        to_account_id: merged.to_account_id ?? null, category_id: merged.category_id ?? null,
        note: merged.note ?? '', tags: merged.tags ?? '[]', date: merged.date, updated_at: nowStr()
      });
      persist();
      return { transaction: camelize(joinTxn(txn)) };
    }
    if (txn && method === 'DELETE') {
      db.transactions = db.transactions.filter((x) => x.id !== txn.id);
      persist();
      return { ok: true };
    }
    if (!txn && p1 && p1 !== 'tags' && p1 !== 'bulk-delete') return err(404, 'Transaction not found');
  }

  // ---------- budgets ----------
  if (root === 'budgets') {
    if (!p1 && method === 'GET') {
      const month = MONTH_RE.test(String(q.month || '')) ? q.month : localMonthStr();
      const { from, to } = monthRange(month);
      const rows = db.budgets
        .filter((x) => x.user_id === uid && x.month === month)
        .map((bd) => {
          const c = db.categories.find((x) => x.id === bd.category_id);
          let spent = 0;
          for (const t of db.transactions) {
            if (t.user_id === uid && t.type === 'expense' && t.category_id === bd.category_id && t.date.slice(0, 7) === bd.month) spent += t.amount;
          }
          return {
            id: bd.id, category_id: bd.category_id, month: bd.month, amount: bd.amount,
            category_name: c ? c.name : null, category_emoji: c ? c.emoji : null, category_color: c ? c.color : null,
            spent
          };
        })
        .sort((a, x) => (x.spent / (x.amount || 1)) - (a.spent / (a.amount || 1)) || a.id - x.id);
      const totals = monthTotals(from, to);
      return { month, budgets: camelize(rows), totals: { income: totals.income, expense: totals.expense } };
    }
    if (!p1 && method === 'PUT') {
      if (!MONTH_RE.test(String(b.month || ''))) return err(400, 'Invalid month');
      const cat = db.categories.find((c) => c.id === Number(b.categoryId) && c.user_id === uid && c.type === 'expense');
      if (!cat) return err(400, 'Choose a valid expense category');
      const amt = toPaise(b.amount);
      if (!amt) return err(400, 'Enter a valid budget amount');
      let row = db.budgets.find((x) => x.user_id === uid && x.category_id === cat.id && x.month === b.month);
      if (row) row.amount = amt;
      else db.budgets.push({ id: nextId('budgets'), user_id: uid, category_id: cat.id, month: b.month, amount: amt });
      persist();
      const fresh = db.budgets.find((x) => x.user_id === uid && x.category_id === cat.id && x.month === b.month);
      let spent = 0;
      for (const t of db.transactions) {
        if (t.user_id === uid && t.type === 'expense' && t.category_id === cat.id && t.date.slice(0, 7) === b.month) spent += t.amount;
      }
      return { budget: camelize({ id: fresh.id, category_id: fresh.category_id, month: fresh.month, amount: fresh.amount, category_name: cat.name, category_emoji: cat.emoji, category_color: cat.color, spent }) };
    }
    if (p1 === 'copy' && method === 'POST') {
      if (!MONTH_RE.test(String(b.from || '')) || !MONTH_RE.test(String(b.to || ''))) return err(400, 'Invalid month range');
      const src = db.budgets.filter((x) => x.user_id === uid && x.month === b.from);
      for (const r of src) {
        const existing = db.budgets.find((x) => x.user_id === uid && x.category_id === r.category_id && x.month === b.to);
        if (existing) existing.amount = r.amount;
        else db.budgets.push({ id: nextId('budgets'), user_id: uid, category_id: r.category_id, month: b.to, amount: r.amount });
      }
      persist();
      return { copied: src.length };
    }
    const bud = db.budgets.find((x) => x.id === Number(p1) && x.user_id === uid);
    if (bud && method === 'DELETE') {
      db.budgets = db.budgets.filter((x) => x.id !== bud.id);
      persist();
      return { ok: true };
    }
    if (!bud && p1 && p1 !== 'copy') return err(404, 'Budget not found');
  }

  // ---------- goals ----------
  if (root === 'goals') {
    if (!p1 && method === 'GET') {
      const rows = db.goals.filter((g) => g.user_id === uid && g.archived === 0).sort((a, b) => b.id - a.id).map(goalView);
      return { goals: camelize(rows) };
    }
    if (!p1 && method === 'POST') {
      if (!b.name || !String(b.name).trim()) return err(400, 'Goal name is required');
      const tgt = toPaise(b.target);
      if (!tgt) return err(400, 'Enter a valid target amount');
      if (b.deadline && !DATE_RE.test(String(b.deadline))) return err(400, 'Invalid deadline');
      const g = {
        id: nextId('goals'), user_id: uid, name: String(b.name).trim(), target: tgt,
        deadline: b.deadline || null, emoji: String(b.emoji || '🎯'), color: String(b.color || '#6366f1'),
        archived: 0, created_at: nowStr()
      };
      db.goals.push(g);
      persist();
      return { goal: camelize(goalView(g)) };
    }
    const goal = db.goals.find((g) => g.id === Number(p1) && g.user_id === uid);
    if (goal && !p2 && method === 'PATCH') {
      const { name, target, deadline, emoji, color, archived } = b;
      let tgt = goal.target;
      if (target !== undefined) {
        tgt = toPaise(target);
        if (!tgt) return err(400, 'Enter a valid target amount');
      }
      if (name != null && String(name).trim()) goal.name = String(name).trim();
      goal.target = tgt;
      if (deadline !== undefined) goal.deadline = deadline || null;
      if (emoji != null) goal.emoji = String(emoji);
      if (color != null) goal.color = String(color);
      if (archived != null) goal.archived = archived ? 1 : 0;
      persist();
      return { goal: camelize(goalView(goal)) };
    }
    if (goal && !p2 && method === 'DELETE') {
      db.goals = db.goals.filter((g) => g.id !== goal.id);
      db.goal_entries = db.goal_entries.filter((e) => e.goal_id !== goal.id);
      persist();
      return { ok: true };
    }
    if (goal && p2 === 'entries' && !p3gen(seg) && method === 'GET') {
      const rows = db.goal_entries.filter((e) => e.goal_id === goal.id).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
      return { entries: camelize(rows) };
    }
    if (goal && p2 === 'entries' && method === 'POST') {
      const amt = toPaise(b.amount);
      if (!amt) return err(400, 'Enter a valid amount');
      if (b.date && !DATE_RE.test(String(b.date))) return err(400, 'Invalid date');
      const entry = {
        id: nextId('goal_entries'), user_id: uid, goal_id: goal.id,
        amount: b.kind === 'withdraw' ? -amt : amt,
        date: b.date || todayStr(), note: String(b.note || '').slice(0, 200)
      };
      db.goal_entries.push(entry);
      persist();
      return { entry: camelize(entry), goal: camelize(goalView(goal)) };
    }
    if (goal && p2 === 'entries' && p3gen(seg) && method === 'DELETE') {
      const entryId = Number(p3gen(seg));
      const e = db.goal_entries.find((x) => x.id === entryId && x.user_id === uid && x.goal_id === goal.id);
      if (!e) return err(404, 'Entry not found');
      db.goal_entries = db.goal_entries.filter((x) => x.id !== e.id);
      persist();
      return { ok: true, goal: camelize(goalView(goal)) };
    }
    if (!goal && p1 && !['goals'].includes(p1)) return err(404, 'Goal not found');
  }

  // ---------- recurring ----------
  if (root === 'recurring') {
    const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];
    if (!p1 && method === 'GET') {
      processDueRecurring();
      const rows = db.recurring
        .filter((r) => r.user_id === uid)
        .sort((a, b) => (b.active - a.active) || a.next_date.localeCompare(b.next_date))
        .map(recurringView);
      return { items: camelize(rows) };
    }
    const validateRec = (body, partial = false) => {
      const out = {};
      if (!partial || body.name !== undefined) {
        if (!body.name || !String(body.name).trim()) return { error: 'Name is required' };
        out.name = String(body.name).trim();
      }
      if (!partial || body.type !== undefined) {
        if (!['income', 'expense'].includes(body.type)) return { error: 'Type must be income or expense' };
        out.type = body.type;
      }
      if (!partial || body.amount !== undefined) {
        const amt = toPaise(body.amount);
        if (!amt) return { error: 'Enter a valid amount' };
        out.amount = amt;
      }
      if (!partial || body.frequency !== undefined) {
        if (!FREQUENCIES.includes(body.frequency)) return { error: 'Invalid frequency' };
        out.frequency = body.frequency;
      }
      if (!partial || body.startDate !== undefined) {
        if (!DATE_RE.test(String(body.startDate || ''))) return { error: 'A valid start date is required' };
        out.start_date = String(body.startDate);
      }
      if (body.endDate !== undefined) out.end_date = body.endDate && DATE_RE.test(String(body.endDate)) ? String(body.endDate) : null;
      if (body.categoryId !== undefined) out.category_id = body.categoryId ? Number(body.categoryId) : null;
      if (body.accountId !== undefined) out.account_id = body.accountId ? Number(body.accountId) : null;
      if (body.note !== undefined) out.note = String(body.note).slice(0, 300);
      if (body.active !== undefined) out.active = body.active ? 1 : 0;
      return { out };
    };
    if (!p1 && method === 'POST') {
      const v = validateRec(b);
      if (v.error) return err(400, v.error);
      const r = {
        id: nextId('recurring'), user_id: uid, name: v.out.name, type: v.out.type, amount: v.out.amount,
        category_id: v.out.category_id ?? null, account_id: v.out.account_id ?? null,
        frequency: v.out.frequency, start_date: v.out.start_date, end_date: v.out.end_date ?? null,
        next_date: v.out.start_date, last_posted: null, active: 1, note: v.out.note ?? ''
      };
      db.recurring.push(r);
      processDueRecurring();
      persist();
      return { item: camelize(recurringView(r)) };
    }
    const rec = db.recurring.find((r) => r.id === Number(p1) && r.user_id === uid);
    if (rec && !p2 && method === 'PATCH') {
      const v = validateRec(b, true);
      if (v.error) return err(400, v.error);
      const existingStart = rec.start_date;
      const existingFreq = rec.frequency;
      const existingLast = rec.last_posted;
      Object.assign(rec, v.out);
      if (rec.active == null) rec.active = 1;
      let next = rec.next_date;
      if (v.out.start_date && v.out.start_date !== existingStart) next = v.out.start_date;
      if (v.out.frequency && v.out.frequency !== existingFreq && !existingLast) next = rec.start_date;
      rec.next_date = next;
      processDueRecurring();
      persist();
      return { item: camelize(recurringView(rec)) };
    }
    if (rec && p2 === 'post' && method === 'POST') {
      const today = todayStr();
      db.transactions.push({
        id: nextId('transactions'), user_id: uid, type: rec.type, amount: rec.amount, account_id: rec.account_id,
        to_account_id: null, category_id: rec.category_id, note: rec.name, tags: '[]',
        date: today, source: 'recurring', created_at: nowStr(), updated_at: nowStr()
      });
      let next = rec.next_date;
      if (rec.next_date <= today) {
        next = addFrequency(next, rec.frequency);
        let guard = 0;
        while (next <= today && guard++ < 500) next = addFrequency(next, rec.frequency);
      }
      rec.next_date = next; rec.last_posted = today; rec.active = 1;
      persist();
      return { item: camelize(recurringView(rec)) };
    }
    if (rec && !p2 && method === 'DELETE') {
      db.recurring = db.recurring.filter((r) => r.id !== rec.id);
      persist();
      return { ok: true };
    }
    if (!rec && p1 && p1 !== 'post') return err(404, 'Recurring item not found');
  }

  // ---------- loans ----------
  if (root === 'loans') {
    if (!p1 && method === 'GET') {
      const rows = db.loans.filter((l) => l.user_id === uid).sort((a, b) => (a.closed - b.closed) || (b.id - a.id)).map(loanView);
      return { loans: rows };
    }
    const validateLoan = (body, partial = false) => {
      const out = {};
      if (!partial || body.name !== undefined) {
        if (!body.name || !String(body.name).trim()) return { error: 'Loan name is required' };
        out.name = String(body.name).trim();
      }
      if (body.lender !== undefined) out.lender = String(body.lender).slice(0, 100);
      if (!partial || body.principal !== undefined) {
        const p = toPaise(body.principal);
        if (!p) return { error: 'Enter a valid principal amount' };
        out.principal = p;
      }
      if (!partial || body.rate !== undefined) {
        const r = Number(body.rate);
        if (!isFinite(r) || r < 0 || r > 100) return { error: 'Interest rate must be between 0 and 100' };
        out.rate = r;
      }
      if (!partial || body.tenureMonths !== undefined) {
        const t = parseInt(body.tenureMonths);
        if (!isFinite(t) || t < 1 || t > 600) return { error: 'Tenure must be between 1 and 600 months' };
        out.tenure_months = t;
      }
      if (!partial || body.startDate !== undefined) {
        if (!DATE_RE.test(String(body.startDate || ''))) return { error: 'A valid start date is required' };
        out.start_date = String(body.startDate);
      }
      if (body.emi !== undefined && body.emi !== null && body.emi !== '') {
        const e = toPaise(body.emi);
        if (!e) return { error: 'Enter a valid EMI' };
        out.emi = e;
      }
      if (body.note !== undefined) out.note = String(body.note).slice(0, 300);
      if (body.closed !== undefined) out.closed = body.closed ? 1 : 0;
      return { out };
    };
    if (!p1 && method === 'POST') {
      const v = validateLoan(b);
      if (v.error) return err(400, v.error);
      const l = v.out;
      const emi = l.emi || calcEmi(l.principal, l.rate, l.tenure_months);
      const loan = {
        id: nextId('loans'), user_id: uid, name: l.name, lender: l.lender ?? '', principal: l.principal,
        rate: l.rate ?? 0, tenure_months: l.tenure_months, emi, start_date: l.start_date,
        note: l.note ?? '', closed: 0, created_at: nowStr()
      };
      db.loans.push(loan);
      persist();
      return { loan: loanView(loan) };
    }
    const loan = db.loans.find((l) => l.id === Number(p1) && l.user_id === uid);
    if (loan && !p2 && method === 'PATCH') {
      const v = validateLoan(b, true);
      if (v.error) return err(400, v.error);
      const hadEmi = v.out.emi !== undefined;
      Object.assign(loan, v.out);
      if (!hadEmi && (v.out.principal !== undefined || v.out.rate !== undefined || v.out.tenure_months !== undefined)) {
        loan.emi = calcEmi(loan.principal, loan.rate, loan.tenure_months);
      }
      if (loan.closed == null) loan.closed = 0;
      persist();
      return { loan: loanView(loan) };
    }
    if (loan && !p2 && method === 'DELETE') {
      db.loans = db.loans.filter((l) => l.id !== loan.id);
      db.loan_payments = db.loan_payments.filter((p) => p.loan_id !== loan.id);
      persist();
      return { ok: true };
    }
    if (loan && p2 === 'schedule' && method === 'GET') return { schedule: loanSchedule(loan) };
    if (loan && p2 === 'payments' && !p3gen(seg) && method === 'GET') {
      const rows = db.loan_payments.filter((p) => p.loan_id === loan.id).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
      return { payments: camelize(rows) };
    }
    if (loan && p2 === 'payments' && !p3gen(seg) && method === 'POST') {
      const amt = toPaise(b.amount);
      if (!amt) return err(400, 'Enter a valid amount');
      if (b.date && !DATE_RE.test(String(b.date))) return err(400, 'Invalid date');
      db.loan_payments.push({
        id: nextId('loan_payments'), user_id: uid, loan_id: loan.id, amount: amt,
        date: b.date || todayStr(), note: String(b.note || '').slice(0, 200)
      });
      persist();
      return { loan: loanView(loan) };
    }
    if (loan && p2 === 'payments' && p3gen(seg) && method === 'DELETE') {
      const paymentId = Number(p3gen(seg));
      const p = db.loan_payments.find((x) => x.id === paymentId && x.user_id === uid && x.loan_id === loan.id);
      if (!p) return err(404, 'Payment not found');
      db.loan_payments = db.loan_payments.filter((x) => x.id !== p.id);
      persist();
      return { ok: true, loan: loanView(loan) };
    }
    if (!loan && p1 && p1 !== 'schedule') return err(404, 'Loan not found');
  }

  // ---------- requests ----------
  if (root === 'requests') {
    if (!p1 && method === 'GET') {
      const rows = db.requests
        .filter((r) => r.user_id === uid)
        .sort((a, b) => ((a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1)) || (b.id - a.id));
      return { requests: camelize(rows) };
    }
    if (!p1 && method === 'POST') {
      const amt = toPaise(b.amount);
      if (!amt) return err(400, 'Enter a valid amount');
      if (b.dueDate && !DATE_RE.test(String(b.dueDate))) return err(400, 'Invalid due date');
      if (!user().upi_id) return err(400, 'Set your UPI ID in Settings first');
      const row = {
        id: nextId('requests'), user_id: uid, amount: amt, note: String(b.note || '').slice(0, 100),
        from_name: String(b.fromName || '').slice(0, 60), due_date: b.dueDate || null,
        status: 'pending', upi_id: user().upi_id, payee_name: user().name,
        created_at: nowStr(), received_at: null, txn_id: null
      };
      db.requests.push(row);
      persist();
      return { request: camelize(row) };
    }
    const req = db.requests.find((r) => r.id === Number(p1) && r.user_id === uid);
    if (req && !p2 && method === 'PATCH') {
      const { status, amount, note, fromName, dueDate } = b;
      const nextStatus = ['pending', 'received', 'cancelled'].includes(status) ? status : req.status;
      const amt = amount !== undefined ? toPaise(amount) : req.amount;
      if (!amt) return err(400, 'Enter a valid amount');
      req.status = nextStatus;
      req.amount = amt;
      if (note !== undefined) req.note = String(note).slice(0, 100);
      if (fromName !== undefined) req.from_name = String(fromName).slice(0, 60);
      if (dueDate !== undefined) req.due_date = dueDate || null;
      if (nextStatus === 'received' && !req.received_at) req.received_at = nowStr();
      persist();
      return { request: camelize(req) };
    }
    if (req && p2 === 'receive' && method === 'POST') {
      if (req.status === 'received') return err(400, 'Already marked as received');
      const cat = db.categories.find((c) => c.user_id === uid && c.type === 'income' && c.name === 'Other Income');
      const note = `Received${req.from_name ? ' from ' + req.from_name : ''}${req.note ? ': ' + req.note : ''} (UPI)`.slice(0, 300);
      const txnId = nextId('transactions');
      db.transactions.push({
        id: txnId, user_id: uid, type: 'income', amount: req.amount, account_id: null,
        to_account_id: null, category_id: cat ? cat.id : null, note, tags: '[]',
        date: todayStr(), source: 'manual', created_at: nowStr(), updated_at: nowStr()
      });
      req.status = 'received';
      req.received_at = nowStr();
      req.txn_id = txnId;
      persist();
      return { request: camelize(req), txnId };
    }
    if (req && !p2 && method === 'DELETE') {
      db.requests = db.requests.filter((r) => r.id !== req.id);
      persist();
      return { ok: true };
    }
    if (!req && p1 && p1 !== 'receive') return err(404, 'Request not found');
  }

  // ---------- reports ----------
  if (root === 'reports') {
    if (p1 === 'trend') {
      const n = Math.min(Math.max(parseInt(q.months) || 12, 1), 36);
      const start = addMonths(localMonthStr() + '-01', -(n - 1));
      const map = {};
      for (const t of db.transactions) {
        if (t.user_id !== uid || t.date < start) continue;
        const m = t.date.slice(0, 7);
        map[m] = map[m] || { month: m, income: 0, expense: 0 };
        if (t.type === 'income') map[m].income += t.amount;
        else if (t.type === 'expense') map[m].expense += t.amount;
      }
      const out = [];
      for (let i = 0; i < n; i++) {
        const m = addMonths(start, i).slice(0, 7);
        out.push(map[m] || { month: m, income: 0, expense: 0 });
      }
      return { trend: out };
    }
    if (p1 === 'month') {
      const month = /^\d{4}-\d{2}$/.test(String(q.month || '')) ? q.month : localMonthStr();
      const { from, to } = monthRange(month);
      const totals = monthTotals(from, to);
      let count = 0;
      for (const t of db.transactions) if (t.user_id === uid && t.date >= from && t.date <= to) count++;
      const prev = monthRange(addMonths(from, -1).slice(0, 7));
      const prevTotals = monthTotals(prev.from, prev.to);
      const topTransactions = db.transactions
        .filter((t) => t.user_id === uid && t.date >= from && t.date <= to && t.type === 'expense')
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
        .map((t) => {
          const c = db.categories.find((x) => x.id === t.category_id);
          return { id: t.id, amount: t.amount, date: t.date, note: t.note, category: c ? c.name : 'Uncategorized', emoji: c ? c.emoji : '📦' };
        });
      return {
        month,
        totals: { income: totals.income, expense: totals.expense, net: totals.income - totals.expense, count },
        prevTotals: { income: prevTotals.income, expense: prevTotals.expense },
        byCategory: expenseByCategory(from, to),
        incomeByCategory: incomeByCategory(from, to),
        daily: dailyExpense(from, to),
        byAccount: expenseByAccount(from, to),
        topTransactions
      };
    }
    if (p1 === 'year') {
      const year = /^\d{4}$/.test(String(q.year || '')) ? q.year : todayStr().slice(0, 4);
      const from = year + '-01-01';
      const to = year + '-12-31';
      const totals = monthTotals(from, to);
      let count = 0;
      for (const t of db.transactions) if (t.user_id === uid && t.date >= from && t.date <= to) count++;
      const map = {};
      for (const t of db.transactions) {
        if (t.user_id !== uid || t.date < from || t.date > to) continue;
        const m = t.date.slice(0, 7);
        map[m] = map[m] || { month: m, income: 0, expense: 0 };
        if (t.type === 'income') map[m].income += t.amount;
        else if (t.type === 'expense') map[m].expense += t.amount;
      }
      const monthly = Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
      return {
        year,
        totals: { income: totals.income, expense: totals.expense, count, net: totals.income - totals.expense },
        monthly,
        byCategory: expenseByCategory(from, to),
        byAccount: expenseByAccount(from, to)
      };
    }
  }

  // ---------- dashboard ----------
  if (root === 'dashboard' && method === 'GET') {
    processDueRecurring();
    const month = /^\d{4}-\d{2}$/.test(String(q.month || '')) ? q.month : localMonthStr();
    const { from, to } = monthRange(month);
    const totals = monthTotals(from, to);
    const prev = monthRange(addMonths(from, -1).slice(0, 7));
    const prevTotals = monthTotals(prev.from, prev.to);
    const accounts = camelize(accountsWithBalance());
    const balance = accounts.filter((a) => !a.isArchived).reduce((s, a) => s + a.balance, 0);
    const daily = dailyExpense(from, to);
    const byCategory = expenseByCategory(from, to, 6);
    const recent = db.transactions
      .filter((t) => t.user_id === uid)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .slice(0, 8)
      .map((t) => {
        const v = camelize(joinTxn(t));
        delete v.categoryType;    // ┬ not in the server's dashboard SELECT
        delete v.accountColor;    // │
        delete v.toAccountEmoji;  // ┘
        return v;
      });
    const budgets = db.budgets
      .filter((x) => x.user_id === uid && x.month === month)
      .map((bd) => {
        const c = db.categories.find((x) => x.id === bd.category_id);
        let spent = 0;
        for (const t of db.transactions) {
          if (t.user_id === uid && t.type === 'expense' && t.category_id === bd.category_id && t.date.slice(0, 7) === bd.month) spent += t.amount;
        }
        return {
          id: bd.id, category_id: bd.category_id, amount: bd.amount,
          category_name: c ? c.name : null, category_emoji: c ? c.emoji : null, category_color: c ? c.color : null,
          spent
        };
      })
      .sort((a, x) => (x.spent / (x.amount || 1)) - (a.spent / (a.amount || 1)))
      .slice(0, 4)
      .map(camelize);
    const goals = db.goals
      .filter((g) => g.user_id === uid && g.archived === 0)
      .sort((a, b) => b.id - a.id)
      .slice(0, 4)
      .map((g) => {
        const v = goalView(g);
        return { id: v.id, name: v.name, target: v.target, emoji: v.emoji, color: v.color, deadline: v.deadline, saved: v.saved };
      });
    const upcomingEnd = addMonths(from, 1).slice(0, 7) + '-31';
    const upcoming = db.recurring
      .filter((r) => r.user_id === uid && r.active === 1 && r.next_date <= upcomingEnd)
      .sort((a, b) => a.next_date.localeCompare(b.next_date))
      .slice(0, 5)
      .map((r) => {
        const c = db.categories.find((x) => x.id === r.category_id);
        return { id: r.id, name: r.name, type: r.type, amount: r.amount, frequency: r.frequency, next_date: r.next_date, category_emoji: c ? c.emoji : null };
      })
      .map(camelize);
    return {
      month,
      today: todayStr(),
      totals: { income: totals.income, expense: totals.expense, net: totals.income - totals.expense },
      prevTotals: { income: prevTotals.income, expense: prevTotals.expense },
      balance,
      accounts,
      daily,
      byCategory,
      recent,
      budgets,
      goals,
      upcoming
    };
  }

  // ---------- data ----------
  if (root === 'data') {
    if (p1 === 'export.csv' && method === 'GET') return buildExportCsv();
    if (p1 === 'import' && method === 'POST') return importCsv(rawBody || '');
    if (p1 === 'account' && method === 'DELETE') {
      wipeLocalData();
      return { ok: true };
    }
  }

  return err(404, 'Not found: ' + method + ' /' + pathOnly);
}

// helper for 3rd segment after p2 (goals/:id/entries/:entryId, loans/:id/payments/:paymentId)
// seg = [root, p1, p2, p3] → for '/goals/5/entries/12', p3 is seg[3] = '12'
function p3gen(seg) { return seg.length > 3 ? seg[3] : null; }

// ---------------------------------------------------------------- CSV
export function buildExportCsv() {
  const rows = db.transactions
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .map((t) => {
      const c = db.categories.find((x) => x.id === t.category_id);
      const a = db.accounts.find((x) => x.id === t.account_id);
      const a2 = db.accounts.find((x) => x.id === t.to_account_id);
      let tags = '';
      try { tags = JSON.parse(t.tags || '[]').join('|'); } catch { tags = ''; }
      return [t.date, t.type, (t.amount / 100).toFixed(2), c ? c.name : '', a ? a.name : '', a2 ? a2.name : '', t.note || '', tags];
    });
  const lines = ['Date,Type,Amount,Category,Account,To Account,Note,Tags'];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  return lines.join('\n');
}

function importCsv(text) {
  if (!String(text).trim()) return err(400, 'CSV content is empty');
  const rows = parseCsv(String(text));
  if (rows.length < 2) return err(400, 'CSV needs a header row and at least one data row');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (names) => {
    for (const n of names) { const i = header.indexOf(n); if (i !== -1) return i; }
    return -1;
  };
  const iDate = idx(['date']);
  const iType = idx(['type']);
  const iAmount = idx(['amount']);
  const iCategory = idx(['category']);
  const iAccount = idx(['account']);
  const iNote = idx(['note', 'description', 'details']);
  const iTags = idx(['tags']);
  if (iDate === -1 || iAmount === -1) return err(400, 'CSV must contain at least Date and Amount columns');

  const uid = db.user.id;
  let imported = 0;
  const errors = [];
  for (let i = 1; i < rows.length && i <= 20000; i++) {
    const r = rows[i];
    try {
      const date = String(r[iDate] || '').trim().slice(0, 10);
      if (!DATE_RE.test(date)) { errors.push(`Row ${i + 1}: invalid date`); continue; }
      const typeRaw = String((iType !== -1 && r[iType]) || 'expense').trim().toLowerCase();
      const type = typeRaw === 'income' || typeRaw === 'credit' ? 'income'
        : typeRaw === 'expense' || typeRaw === 'debit' ? 'expense' : null;
      if (!type) { errors.push(`Row ${i + 1}: type must be income or expense`); continue; }
      let amount = parseFloat(String(r[iAmount] || '').replace(/[₹,\s]/g, ''));
      if (!isFinite(amount)) { errors.push(`Row ${i + 1}: invalid amount`); continue; }
      if (amount < 0) amount = -amount;
      if (amount === 0) { errors.push(`Row ${i + 1}: zero amount`); continue; }
      const paise = Math.round(amount * 100);

      let categoryId = null;
      if (iCategory !== -1 && r[iCategory] && String(r[iCategory]).trim()) {
        const cname = String(r[iCategory]).trim();
        let found = db.categories.find((c) => c.user_id === uid && c.name.toLowerCase() === cname.toLowerCase() && c.type === type);
        if (!found) {
          found = { id: nextId('categories'), user_id: uid, name: cname, type, emoji: '📦', color: '#6366f1', is_default: 0 };
          db.categories.push(found);
        }
        categoryId = found.id;
      }
      let accountId = null;
      if (iAccount !== -1 && r[iAccount] && String(r[iAccount]).trim()) {
        const found = db.accounts.find((a) => a.user_id === uid && a.name.toLowerCase() === String(r[iAccount]).trim().toLowerCase());
        if (found) accountId = found.id;
      }
      let tags = '[]';
      if (iTags !== -1 && r[iTags] && String(r[iTags]).trim()) {
        tags = JSON.stringify(String(r[iTags]).split('|').map((t) => t.trim()).filter(Boolean).slice(0, 10));
      }
      db.transactions.push({
        id: nextId('transactions'), user_id: uid, type, amount: paise, account_id: accountId, to_account_id: null,
        category_id: categoryId, note: iNote !== -1 ? String(r[iNote] || '').slice(0, 300) : '',
        tags, date, source: 'import', created_at: nowStr(), updated_at: nowStr()
      });
      imported++;
    } catch (e) {
      errors.push(`Row ${i + 1}: ${e.message}`);
    }
  }
  persist();
  return { imported, skipped: errors.length, errors: errors.slice(0, 20) };
}

// ---------------------------------------------------------------- SMS auto-capture support
// Called by lib/smsCapture.js to record a parsed bank SMS as a transaction.
export function seenSms(key) {
  return !!db.sms_seen[key];
}
export function rememberSms(key) {
  db.sms_seen[key] = Date.now();
  const keys = Object.keys(db.sms_seen);
  if (keys.length > 500) {
    keys.sort((a, b) => db.sms_seen[a] - db.sms_seen[b]);
    for (const k of keys.slice(0, keys.length - 500)) delete db.sms_seen[k];
  }
  persist();
}
export function findCategoryByName(name, type) {
  return db.categories.find((c) => c.user_id === db.user.id && c.name === name && c.type === type) || null;
}
export function matchAccountByLast4(last4) {
  if (!last4) return null;
  const active = db.accounts.filter((a) => a.user_id === db.user.id && !a.is_archived);
  // Prefer an account whose name mentions those digits (e.g. "HDFC •1234"), else the only bank/card account
  const byName = active.find((a) => a.name.includes(last4));
  if (byName) return byName;
  const bankish = active.filter((a) => ['bank', 'card', 'upi', 'wallet'].includes(a.type));
  return bankish.length === 1 ? bankish[0] : null;
}
export function smsStats() {
  return { captured: Object.keys(db.sms_seen).length };
}

export async function handle(method, path, opts = {}) {
  ensureLocalProfile();
  // All handlers are synchronous; wrap in a promise for API parity with fetch.
  return Promise.resolve(route(method, path, opts));
}

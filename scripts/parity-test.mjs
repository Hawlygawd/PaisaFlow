// Parity test: runs an identical API scenario against (a) the Express server over
// HTTP and (b) the on-device local backend, then diffs every response. Any drift
// between the two shows up as a FAIL. Run: node scripts/parity-test.mjs [base_url]
import * as local from '../client/src/lib/localBackend.js';

const BASE = process.argv[2] || 'http://localhost:4400';

// ---- minimal browser polyfills for localBackend in Node ----
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
if (!globalThis.document) globalThis.document = { addEventListener: () => {}, visibilityState: 'visible' };
if (!globalThis.crypto) globalThis.crypto = (await import('node:crypto')).webcrypto;

// ---- test data ----
const email = `parity_${Date.now()}@test.dev`;
let token = '';
let serverCookie = '';

function normalize(x) {
  if (x === null || x === undefined) return x;
  if (Array.isArray(x)) return x.map(normalize);
  if (typeof x === 'object') {
    const out = {};
    for (const k of Object.keys(x).sort()) {
      if (['token', 'createdAt', 'updatedAt', 'receivedAt', 'created_at', 'updated_at', 'received_at'].includes(k)) continue;
      out[k] = normalize(x[k]);
    }
    return out;
  }
  return x;
}

async function serverCall(method, path, { body, raw } = {}) {
  const isRaw = raw !== undefined && raw !== null;
  const payload = isRaw ? raw : body !== undefined ? JSON.stringify(body) : undefined;
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: {
      ...(payload !== undefined && !isRaw ? { 'content-type': 'application/json' } : {}),
      ...(payload !== undefined && isRaw ? { 'content-type': 'text/csv' } : {}),
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(serverCookie ? { cookie: serverCookie } : {})
    },
    body: payload
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) serverCookie = setCookie.split(';')[0];
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

class ApiFail extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function localCall(method, path, { body, raw } = {}) {
  try {
    const data = await local.handle(method, path, { body, rawBody: raw !== undefined ? raw : undefined });
    return { status: 200, data };
  } catch (e) {
    return { status: e.status || 500, data: { error: e.message } };
  }
}

function firstDiff(a, b, path = '$') {
  if (JSON.stringify(a) === JSON.stringify(b)) return { path, a: '<equal>', b: '<equal>' };
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return { path, a, b };
  const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])];
  for (const k of keys) {
    const sub = firstDiff(a?.[k], b?.[k], `${path}.${k}`);
    if (sub.a !== '<equal>') return sub;
  }
  return { path, a, b };
}

let pass = 0, fail = 0;
const failures = [];
async function step(name, method, path, opts = {}) {
  const s = await serverCall(method, path, opts);
  const l = await localCall(method, path, opts);
  // register/login are intentionally server-only (the local app has no login)
  const compare = !opts.loose;
  // The web app never checks success status codes, only error ones — so
  // 201 Created and 200 OK are equivalent for the local backend.
  const okStatus = s.status === l.status || (s.status === 201 && l.status === 200);
  const okBody = !compare || JSON.stringify(normalize(s.data)) === JSON.stringify(normalize(l.data));
  if (okStatus && okBody) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push({ name, path, method, server: s, local: l });
    console.log(`  ✗ ${name}`);
    if (!okStatus) console.log(`      status: server=${s.status} local=${l.status}`);
    if (!okBody) {
      const d = firstDiff(normalize(s.data), normalize(l.data));
      console.log(`      diff at ${d.path}:`);
      console.log(`        server: ${JSON.stringify(d.a)?.slice(0, 220)}`);
      console.log(`        local : ${JSON.stringify(d.b)?.slice(0, 220)}`);
    }
  }
}

// ================= scenario =================
console.log('— auth —');
await step('register (status only)', 'POST', '/auth/register', { body: { name: 'Parity Tester', email, password: 'secret123' }, loose: true });
local.adoptIdentity('Parity Tester', email); // align identities: local has no registration
{
  const s = await serverCall('POST', '/auth/login', { body: { email, password: 'secret123' } });
  token = s.data.token || '';
}
await step('auth/me', 'GET', '/auth/me');
await step('patch profile', 'PATCH', '/auth/me', { body: { name: 'Paisa Tester', upiId: 'parity@ybl' } });
await step('bad upi', 'PATCH', '/auth/me', { body: { name: 'X', upiId: 'nope' } });

console.log('— accounts —');
await step('list accounts', 'GET', '/accounts');
await step('create bank', 'POST', '/accounts', { body: { name: 'HDFC Bank', type: 'bank', emoji: '🏦', color: '#3b82f6', initialBalance: 25000 } });
await step('create card', 'POST', '/accounts', { body: { name: 'Amazon Pay', type: 'card', emoji: '💳', color: '#f59e0b', initialBalance: 0 } });
await step('bad account', 'POST', '/accounts', { body: { name: '' } });

console.log('— categories —');
await step('list categories', 'GET', '/categories');
await step('create cat', 'POST', '/categories', { body: { name: 'Chai Fund', type: 'expense', emoji: '☕', color: '#a16207' } });
await step('dup cat', 'POST', '/categories', { body: { name: 'Chai Fund', type: 'expense' } });
let catId = 0, otherCatId = 0, incomeCatId = 0;
{
  const s = await serverCall('GET', '/categories');
  const food = s.data.categories.find((c) => c.name === 'Food & Dining');
  const other = s.data.categories.find((c) => c.name === 'Others');
  const oi = s.data.categories.find((c) => c.name === 'Other Income');
  catId = food.id; otherCatId = other.id; incomeCatId = oi.id;
}

console.log('— transactions —');
const d = (offset) => {
  const t = new Date();
  t.setDate(t.getDate() - offset);
  return t.toISOString().slice(0, 10);
};
await step('create expense', 'POST', '/transactions', { body: { type: 'expense', amount: 250.5, date: d(0), accountId: 2, categoryId: catId, note: 'Lunch thali', tags: ['food', 'work'] } });
await step('create income', 'POST', '/transactions', { body: { type: 'income', amount: 50000, date: d(1), accountId: 2, categoryId: incomeCatId, note: 'Salary' } });
await step('create transfer', 'POST', '/transactions', { body: { type: 'transfer', amount: 4000, date: d(2), accountId: 2, toAccountId: 3, note: 'Top-up wallet' } });
await step('transfer same acct', 'POST', '/transactions', { body: { type: 'transfer', amount: 100, date: d(0), accountId: 2, toAccountId: 2 } });
await step('invalid amount', 'POST', '/transactions', { body: { type: 'expense', amount: 0, date: d(0) } });
await step('unknown account', 'POST', '/transactions', { body: { type: 'expense', amount: 10, date: d(0), accountId: 999 } });
await step('bad date', 'POST', '/transactions', { body: { type: 'expense', amount: 10, date: '15/06/2026' } });
await step('list page1', 'GET', '/transactions?page=1&limit=2');
await step('list page2', 'GET', '/transactions?page=2&limit=2');
await step('filter type', 'GET', '/transactions?type=expense');
await step('filter category', 'GET', `/transactions?categoryId=${catId}`);
await step('filter account', 'GET', '/transactions?accountId=2');
await step('filter tag', 'GET', '/transactions?tag=food');
await step('search q', 'GET', '/transactions?q=lunch');
await step('sort amount', 'GET', '/transactions?sort=amount_desc&limit=5');
await step('month range', 'GET', `/transactions?month=${d(0).slice(0, 7)}`);
await step('tags endpoint', 'GET', '/transactions/tags');
await step('patch txn', 'PATCH', '/transactions/1', { body: { amount: 300, note: 'Lunch + chai' } });
await step('patch to transfer', 'PATCH', '/transactions/1', { body: { type: 'transfer', accountId: 2, toAccountId: 3 } });
await step('bulk delete', 'POST', '/transactions/bulk-delete', { body: { ids: [3] } });

console.log('— budgets —');
const month = d(0).slice(0, 7);
await step('put budget', 'PUT', '/budgets', { body: { categoryId: catId, month, amount: 5000 } });
await step('bad budget cat', 'PUT', '/budgets', { body: { categoryId: incomeCatId, month, amount: 500 } });
await step('get budgets', 'GET', `/budgets?month=${month}`);
await step('copy budgets', 'POST', '/budgets/copy', { body: { from: month, to: '2026-10' } });
await step('get budgets next', 'GET', '/budgets?month=2026-10');
await step('budgets copy bad', 'POST', '/budgets/copy', { body: { from: 'xx', to: '2026-10' } });

console.log('— goals —');
await step('create goal', 'POST', '/goals', { body: { name: 'Goa trip', target: 30000, deadline: '2026-12-01', emoji: '🏖️', color: '#0ea5e9' } });
await step('bad goal', 'POST', '/goals', { body: { name: '', target: 100 } });
await step('goal entry in', 'POST', '/goals/1/entries', { body: { amount: 5000, date: d(0), note: 'First save' } });
await step('goal entry out', 'POST', '/goals/1/entries', { body: { amount: 1000, kind: 'withdraw', note: 'Ticket advance' } });
await step('goal entries list', 'GET', '/goals/1/entries');
await step('goals list', 'GET', '/goals');
await step('patch goal', 'PATCH', '/goals/1', { body: { target: 35000 } });
await step('bad entry date', 'POST', '/goals/1/entries', { body: { amount: 10, date: 'bad' } });

console.log('— recurring —');
const today = d(0);
await step('create recurring', 'POST', '/recurring', { body: { name: 'Rent', type: 'expense', amount: 15000, frequency: 'monthly', startDate: d(40), categoryId: otherCatId, accountId: 2, note: 'Flat rent' } });
await step('create due now', 'POST', '/recurring', { body: { name: 'Gym', type: 'expense', amount: 1200, frequency: 'monthly', startDate: d(70), accountId: 2 } });
await step('recurring list (catch-up)', 'GET', '/recurring');
await step('bad frequency', 'POST', '/recurring', { body: { name: 'X', type: 'expense', amount: 10, frequency: 'fortnightly', startDate: today } });
await step('patch recurring', 'PATCH', '/recurring/1', { body: { amount: 16000 } });
await step('post now', 'POST', '/recurring/2/post', {});
await step('pause recurring', 'PATCH', '/recurring/1', { body: { active: false } });

console.log('— loans —');
await step('create loan', 'POST', '/loans', { body: { name: 'Bike loan', lender: 'Bajaj Finance', principal: 120000, rate: 11.5, tenureMonths: 24, startDate: d(100) } });
await step('bad loan', 'POST', '/loans', { body: { name: 'X', principal: -5, rate: 5, tenureMonths: 12, startDate: today } });
await step('loan payment', 'POST', '/loans/1/payments', { body: { amount: 5628, date: d(5), note: 'EMI 1' } });
await step('loan payments list', 'GET', '/loans/1/payments');
await step('loan schedule', 'GET', '/loans/1/schedule');
await step('patch loan', 'PATCH', '/loans/1', { body: { rate: 12 } });
await step('bad payment date', 'POST', '/loans/1/payments', { body: { amount: 10, date: 'nope' } });

console.log('— requests —');
await step('request before upi?', 'GET', '/requests');
await step('create request', 'POST', '/requests', { body: { amount: 750, note: 'Dinner split', fromName: 'Rahul', dueDate: d(-7) } });
await step('bad request date', 'POST', '/requests', { body: { amount: 100, dueDate: '31-12-2026' } });
await step('receive request', 'POST', '/requests/1/receive', {});
await step('receive again', 'POST', '/requests/1/receive', {});
await step('requests list', 'GET', '/requests');

console.log('— dashboard & reports —');
await step('dashboard', 'GET', `/dashboard?month=${month}`);
await step('reports trend', 'GET', '/reports/trend?months=6');
await step('reports month', 'GET', `/reports/month?month=${month}`);
await step('reports year', 'GET', `/reports/year?year=${d(0).slice(0, 4)}`);

console.log('— data —');
await step('export csv', 'GET', '/data/export.csv');
await step('import csv', 'POST', '/data/import', { raw: 'Date,Type,Amount,Category,Account,Note\n' + `${d(3)},expense,199.99,Books,Amazon Pay,Order 123\n${d(4)},income,50,Unknown,,Cashback\nbad,row,here\n` });
await step('import empty (status)', 'POST', '/data/import', { raw: '', loose: true });
await step('import headerless (status)', 'POST', '/data/import', { raw: 'a,b,c\n1,2,3', loose: true });

console.log('— edge cases —');
await step('404 route (status-only, SPA fallback difference)', 'GET', '/nonexistent', { loose: true });
await step('delete goal entry', 'DELETE', '/goals/1/entries/2');
await step('loan payment delete', 'DELETE', '/loans/1/payments/1');
await step('delete account w/ txns', 'DELETE', '/accounts/2');
await step('archive account', 'PATCH', '/accounts/3', { body: { isArchived: true } });
await step('delete budget', 'DELETE', '/budgets/1');
await step('delete txn', 'DELETE', '/transactions/2');
await step('delete recurring', 'DELETE', '/recurring/1');
await step('delete loan', 'DELETE', '/loans/1');
await step('delete request', 'DELETE', '/requests/1');
await step('final dashboard', 'GET', `/dashboard?month=${month}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFirst failure detail:');
  const f = failures[0];
  console.log(JSON.stringify({ name: f.name, path: f.path, method: f.method, server: f.server, local: f.local }, null, 2).slice(0, 3000));
  process.exit(1);
}

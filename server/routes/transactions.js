const express = require('express');
const { db } = require('../db');
const { auth } = require('../middleware/auth');
const { camelize, toPaise, DATE_RE, MONTH_RE, monthRange } = require('../util');
const { processDueRecurring } = require('./recurring');

const router = express.Router();
router.use(auth);

const JOIN_SELECT = `
  SELECT t.*,
    c.name AS category_name, c.emoji AS category_emoji, c.color AS category_color, c.type AS category_type,
    a.name AS account_name, a.emoji AS account_emoji, a.color AS account_color,
    a2.name AS to_account_name, a2.emoji AS to_account_emoji
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts a2 ON a2.id = t.to_account_id
`;

function buildFilters(userId, q) {
  const where = ['t.user_id = ?'];
  const params = [userId];
  if (q.type && ['income', 'expense', 'transfer'].includes(q.type)) {
    where.push('t.type = ?'); params.push(q.type);
  }
  if (q.accountId) { where.push('(t.account_id = ? OR t.to_account_id = ?)'); params.push(Number(q.accountId), Number(q.accountId)); }
  if (q.categoryId) { where.push('t.category_id = ?'); params.push(Number(q.categoryId)); }
  if (q.month && MONTH_RE.test(q.month)) {
    const { from, to } = monthRange(q.month);
    where.push('t.date BETWEEN ? AND ?'); params.push(from, to);
  } else {
    if (q.from && DATE_RE.test(q.from)) { where.push('t.date >= ?'); params.push(q.from); }
    if (q.to && DATE_RE.test(q.to)) { where.push('t.date <= ?'); params.push(q.to); }
  }
  if (q.tag) { where.push("t.tags LIKE ?"); params.push('%"' + String(q.tag) + '"%'); }
  if (q.q) { where.push('(t.note LIKE ? OR t.tags LIKE ?)'); params.push('%' + q.q + '%', '%' + q.q + '%'); }
  return { clause: 'WHERE ' + where.join(' AND '), params };
}

router.get('/', (req, res) => {
  processDueRecurring(req.userId);
  const { clause, params } = buildFilters(req.userId, req.query);
  const sortMap = {
    date_desc: 't.date DESC, t.id DESC',
    date_asc: 't.date ASC, t.id ASC',
    amount_desc: 't.amount DESC, t.id DESC',
    amount_asc: 't.amount ASC, t.id ASC'
  };
  const orderBy = sortMap[req.query.sort] || sortMap.date_desc;
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 40, 1), 200);
  const page = Math.max(parseInt(req.query.page) || 1, 1);

  const total = db.prepare(`SELECT COUNT(*) c FROM transactions t ${clause}`).get(...params).c;
  const totals = db.prepare(
    `SELECT
      COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount END),0) AS income,
      COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount END),0) AS expense
     FROM transactions t ${clause}`
  ).get(...params);
  const rows = db.prepare(
    `${JOIN_SELECT} ${clause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  ).all(...params, limit, (page - 1) * limit);

  res.json({
    items: camelize(rows),
    total, page, pages: Math.max(1, Math.ceil(total / limit)),
    totals: { income: totals.income, expense: totals.expense, net: totals.income - totals.expense }
  });
});

router.get('/tags', (req, res) => {
  const rows = db.prepare("SELECT tags FROM transactions WHERE user_id = ? AND tags != '[]'").all(req.userId);
  const set = new Set();
  for (const r of rows) {
    try { for (const t of JSON.parse(r.tags)) set.add(t); } catch { /* ignore */ }
  }
  res.json({ tags: [...set].sort() });
});

function validateBody(body, userId, partial = false) {
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
  const effType = out.type || (partial ? undefined : null);
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
  return { out };
}

router.post('/', (req, res) => {
  const v = validateBody(req.body || {}, req.userId);
  if (v.error) return res.status(400).json({ error: v.error });
  const t = v.out;
  if (t.type === 'transfer' && (!t.account_id || !t.to_account_id)) {
    return res.status(400).json({ error: 'Transfers need both a from and a to account' });
  }
  if (t.account_id) {
    const acc = db.prepare('SELECT id FROM accounts WHERE id=? AND user_id=?').get(t.account_id, req.userId);
    if (!acc) return res.status(400).json({ error: 'Account not found' });
  }
  if (t.to_account_id) {
    const acc = db.prepare('SELECT id FROM accounts WHERE id=? AND user_id=?').get(t.to_account_id, req.userId);
    if (!acc) return res.status(400).json({ error: 'Destination account not found' });
  }
  const info = db.prepare(
    `INSERT INTO transactions (user_id, type, amount, account_id, to_account_id, category_id, note, tags, date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(req.userId, t.type, t.amount, t.account_id ?? null, t.to_account_id ?? null, t.category_id ?? null,
        t.note ?? '', t.tags ?? '[]', t.date);
  const row = db.prepare(`${JOIN_SELECT} WHERE t.id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ transaction: camelize(row) });
});

router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Transaction not found' });
  const v = validateBody(req.body || {}, req.userId, true);
  if (v.error) return res.status(400).json({ error: v.error });
  const merged = { ...existing, ...v.out };
  if (merged.type === 'transfer' && (!merged.account_id || !merged.to_account_id)) {
    return res.status(400).json({ error: 'Transfers need both a from and a to account' });
  }
  if (merged.type === 'transfer' && merged.account_id === merged.to_account_id) {
    return res.status(400).json({ error: 'From and To accounts must be different' });
  }
  if (merged.type !== 'transfer') { merged.to_account_id = null; }
  if (merged.type === 'transfer') { merged.category_id = null; }
  db.prepare(
    `UPDATE transactions SET type=?, amount=?, account_id=?, to_account_id=?, category_id=?, note=?, tags=?, date=?, updated_at=datetime('now') WHERE id=?`
  ).run(merged.type, merged.amount, merged.account_id ?? null, merged.to_account_id ?? null, merged.category_id ?? null,
       merged.note ?? '', merged.tags ?? '[]', merged.date, existing.id);
  const row = db.prepare(`${JOIN_SELECT} WHERE t.id = ?`).get(existing.id);
  res.json({ transaction: camelize(row) });
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Transaction not found' });
  db.prepare('DELETE FROM transactions WHERE id = ?').run(existing.id);
  res.json({ ok: true });
});

router.post('/bulk-delete', (req, res) => {
  const ids = (req.body && req.body.ids) || [];
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'No transactions selected' });
  const stmt = db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?');
  const del = db.transaction((list) => { let n = 0; for (const id of list) n += stmt.run(Number(id), req.userId).changes; return n; });
  res.json({ deleted: del(ids) });
});

module.exports = router;

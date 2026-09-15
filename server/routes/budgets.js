const express = require('express');
const { db } = require('../db');
const { auth } = require('../middleware/auth');
const { camelize, MONTH_RE, monthRange, localMonthStr, addMonths, toPaise } = require('../util');

const router = express.Router();
router.use(auth);

const BUDGET_CORE = `
  SELECT b.id, b.category_id, b.month, b.amount,
    c.name AS category_name, c.emoji AS category_emoji, c.color AS category_color,
    COALESCE((SELECT SUM(t.amount) FROM transactions t
              WHERE t.user_id = b.user_id AND t.type = 'expense'
                AND t.category_id = b.category_id
                AND strftime('%Y-%m', t.date) = b.month), 0) AS spent
  FROM budgets b
  JOIN categories c ON c.id = b.category_id
  WHERE b.user_id = ? AND b.month = ?`;

router.get('/', (req, res) => {
  const month = MONTH_RE.test(String(req.query.month || '')) ? req.query.month : localMonthStr();
  const rows = db.prepare(BUDGET_CORE + ' ORDER BY spent DESC, b.id ASC').all(req.userId, month);
  const { from, to } = monthRange(month);
  const totals = db.prepare(
    `SELECT
      COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
     FROM transactions WHERE user_id=? AND date BETWEEN ? AND ?`
  ).get(req.userId, from, to);
  res.json({ month, budgets: camelize(rows), totals: { income: totals.income, expense: totals.expense } });
});

router.put('/', (req, res) => {
  const { categoryId, month, amount } = req.body || {};
  if (!MONTH_RE.test(String(month || ''))) return res.status(400).json({ error: 'Invalid month' });
  const cat = db.prepare("SELECT id FROM categories WHERE id=? AND user_id=? AND type='expense'").get(Number(categoryId), req.userId);
  if (!cat) return res.status(400).json({ error: 'Choose a valid expense category' });
  const amt = toPaise(amount);
  if (!amt) return res.status(400).json({ error: 'Enter a valid budget amount' });
  db.prepare(
    `INSERT INTO budgets (user_id, category_id, month, amount) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, category_id, month) DO UPDATE SET amount = excluded.amount`
  ).run(req.userId, cat.id, month, amt);
  const row = db.prepare(BUDGET_CORE + ' AND b.category_id = ?').get(req.userId, month, cat.id);
  res.json({ budget: camelize(row) });
});

router.delete('/:id', (req, res) => {
  const b = db.prepare('SELECT * FROM budgets WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!b) return res.status(404).json({ error: 'Budget not found' });
  db.prepare('DELETE FROM budgets WHERE id=?').run(b.id);
  res.json({ ok: true });
});

router.post('/copy', (req, res) => {
  const { from, to } = req.body || {};
  if (!MONTH_RE.test(String(from || '')) || !MONTH_RE.test(String(to || ''))) {
    return res.status(400).json({ error: 'Invalid month range' });
  }
  const rows = db.prepare('SELECT category_id, amount FROM budgets WHERE user_id=? AND month=?').all(req.userId, from);
  const ins = db.prepare(
    `INSERT INTO budgets (user_id, category_id, month, amount) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, category_id, month) DO UPDATE SET amount = excluded.amount`
  );
  const copy = db.transaction(() => { for (const r of rows) ins.run(req.userId, r.category_id, to, r.amount); });
  copy();
  res.json({ copied: rows.length });
});

module.exports = router;

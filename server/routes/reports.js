const express = require('express');
const { db } = require('../db');
const { auth } = require('../middleware/auth');
const { localMonthStr, localDateStr, monthRange, addMonths } = require('../util');

const router = express.Router();
router.use(auth);

// Last N months trend: [{month:'YYYY-MM', income, expense}]
router.get('/trend', (req, res) => {
  const n = Math.min(Math.max(parseInt(req.query.months) || 12, 1), 36);
  const start = addMonths(localMonthStr() + '-01', -(n - 1));
  const rows = db.prepare(
    `SELECT strftime('%Y-%m', date) AS month,
            COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
            COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
     FROM transactions
     WHERE user_id=? AND date >= ?
     GROUP BY month ORDER BY month`
  ).all(req.userId, start);
  // Fill missing months with zeros
  const map = Object.fromEntries(rows.map((r) => [r.month, r]));
  const out = [];
  for (let i = 0; i < n; i++) {
    const m = addMonths(start, i).slice(0, 7);
    out.push(map[m] || { month: m, income: 0, expense: 0 });
  }
  res.json({ trend: out });
});

// Month detail: totals, category splits, daily spend, per-account split
router.get('/month', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : localMonthStr();
  const { from, to } = monthRange(month);
  const base = 'FROM transactions WHERE user_id=? AND date BETWEEN ? AND ?';

  const totals = db.prepare(
    `SELECT
      COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense,
      COUNT(*) AS count ${base}`
  ).get(req.userId, from, to);

  const byCategory = db.prepare(
    `SELECT COALESCE(c.name, 'Uncategorized') AS name, COALESCE(c.emoji, '📦') AS emoji,
            COALESCE(c.color, '#94a3b8') AS color, SUM(t.amount) AS total
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id=? AND t.date BETWEEN ? AND ? AND t.type='expense'
     GROUP BY t.category_id ORDER BY total DESC`
  ).all(req.userId, from, to);

  const incomeByCategory = db.prepare(
    `SELECT COALESCE(c.name, 'Uncategorized') AS name, COALESCE(c.emoji, '📦') AS emoji,
            COALESCE(c.color, '#22c55e') AS color, SUM(t.amount) AS total
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id=? AND t.date BETWEEN ? AND ? AND t.type='income'
     GROUP BY t.category_id ORDER BY total DESC`
  ).all(req.userId, from, to);

  const daily = db.prepare(
    `SELECT date, SUM(amount) AS total FROM transactions
     WHERE user_id=? AND date BETWEEN ? AND ? AND type='expense'
     GROUP BY date ORDER BY date`
  ).all(req.userId, from, to);

  const byAccount = db.prepare(
    `SELECT COALESCE(a.name, 'No account') AS name, COALESCE(a.emoji, '💳') AS emoji,
            COALESCE(a.color, '#6366f1') AS color, SUM(t.amount) AS total
     FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
     WHERE t.user_id=? AND t.date BETWEEN ? AND ? AND t.type='expense'
     GROUP BY t.account_id ORDER BY total DESC`
  ).all(req.userId, from, to);

  const topTransactions = db.prepare(
    `SELECT t.id, t.amount, t.date, t.note, COALESCE(c.name,'Uncategorized') AS category, COALESCE(c.emoji,'📦') AS emoji
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id=? AND t.date BETWEEN ? AND ? AND t.type='expense'
     ORDER BY t.amount DESC LIMIT 5`
  ).all(req.userId, from, to);

  const prevMonth = addMonths(from, -1).slice(0, 7);
  const prev = monthRange(prevMonth);
  const prevTotals = db.prepare(
    `SELECT
      COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense ${base}`
  ).get(req.userId, prev.from, prev.to);

  res.json({
    month,
    totals: { income: totals.income, expense: totals.expense, net: totals.income - totals.expense, count: totals.count },
    prevTotals: { income: prevTotals.income, expense: prevTotals.expense },
    byCategory, incomeByCategory, daily, byAccount, topTransactions
  });
});

// Year detail: 12-month bars + full-year category split
router.get('/year', (req, res) => {
  const year = /^\d{4}$/.test(String(req.query.year || '')) ? req.query.year : localDateStr().slice(0, 4);
  const from = year + '-01-01';
  const to = year + '-12-31';
  const base = 'FROM transactions WHERE user_id=? AND date BETWEEN ? AND ?';

  const totals = db.prepare(
    `SELECT
      COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense,
      COUNT(*) AS count ${base}`
  ).get(req.userId, from, to);

  const monthly = db.prepare(
    `SELECT strftime('%Y-%m', date) AS month,
            COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
            COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
     ${base} GROUP BY month ORDER BY month`
  ).all(req.userId, from, to);

  const byCategory = db.prepare(
    `SELECT COALESCE(c.name, 'Uncategorized') AS name, COALESCE(c.emoji, '📦') AS emoji,
            COALESCE(c.color, '#94a3b8') AS color, SUM(t.amount) AS total
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id=? AND t.date BETWEEN ? AND ? AND t.type='expense'
     GROUP BY t.category_id ORDER BY total DESC`
  ).all(req.userId, from, to);

  const byAccount = db.prepare(
    `SELECT COALESCE(a.name, 'No account') AS name, COALESCE(a.emoji, '💳') AS emoji,
            COALESCE(a.color, '#6366f1') AS color, SUM(t.amount) AS total
     FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
     WHERE t.user_id=? AND t.date BETWEEN ? AND ? AND t.type='expense'
     GROUP BY t.account_id ORDER BY total DESC`
  ).all(req.userId, from, to);

  res.json({ year, totals: { ...totals, net: totals.income - totals.expense }, monthly, byCategory, byAccount });
});

module.exports = router;

const express = require('express');
const { db } = require('../db');
const { auth } = require('../middleware/auth');
const { BALANCE_SQL } = require('./accounts');
const { processDueRecurring } = require('./recurring');
const { camelize, localMonthStr, localDateStr, monthRange, addMonths } = require('../util');

const router = express.Router();
router.use(auth);

router.get('/', (req, res) => {
  processDueRecurring(req.userId);
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : localMonthStr();
  const { from, to } = monthRange(month);
  const uid = req.userId;

  const totals = db.prepare(
    `SELECT
      COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
     FROM transactions WHERE user_id=? AND date BETWEEN ? AND ?`
  ).get(uid, from, to);

  const prev = monthRange(addMonths(from, -1).slice(0, 7));
  const prevTotals = db.prepare(
    `SELECT
      COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
     FROM transactions WHERE user_id=? AND date BETWEEN ? AND ?`
  ).get(uid, prev.from, prev.to);

  const accounts = camelize(db.prepare(BALANCE_SQL).all(uid));
  const balance = accounts.filter((a) => !a.isArchived).reduce((s, a) => s + a.balance, 0);

  const daily = db.prepare(
    `SELECT date, SUM(amount) AS total FROM transactions
     WHERE user_id=? AND date BETWEEN ? AND ? AND type='expense'
     GROUP BY date ORDER BY date`
  ).all(uid, from, to);

  const byCategory = db.prepare(
    `SELECT COALESCE(c.name, 'Uncategorized') AS name, COALESCE(c.emoji, '📦') AS emoji,
            COALESCE(c.color, '#94a3b8') AS color, SUM(t.amount) AS total
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id=? AND t.date BETWEEN ? AND ? AND t.type='expense'
     GROUP BY t.category_id ORDER BY total DESC LIMIT 6`
  ).all(uid, from, to);

  const recent = camelize(db.prepare(
    `SELECT t.*, c.name AS category_name, c.emoji AS category_emoji, c.color AS category_color,
            a.name AS account_name, a.emoji AS account_emoji, a2.name AS to_account_name
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN accounts a ON a.id = t.account_id
     LEFT JOIN accounts a2 ON a2.id = t.to_account_id
     WHERE t.user_id=? ORDER BY t.date DESC, t.id DESC LIMIT 8`
  ).all(uid));

  const budgets = camelize(db.prepare(
    `SELECT b.id, b.category_id, b.amount, c.name AS category_name, c.emoji AS category_emoji, c.color AS category_color,
      COALESCE((SELECT SUM(t.amount) FROM transactions t
                WHERE t.user_id = b.user_id AND t.type='expense' AND t.category_id = b.category_id
                  AND strftime('%Y-%m', t.date) = b.month), 0) AS spent
     FROM budgets b JOIN categories c ON c.id = b.category_id
     WHERE b.user_id=? AND b.month=? ORDER BY (CAST(spent AS REAL)/b.amount) DESC LIMIT 4`
  ).all(uid, month));

  const goals = camelize(db.prepare(
    `SELECT g.id, g.name, g.target, g.emoji, g.color, g.deadline,
      COALESCE((SELECT SUM(e.amount) FROM goal_entries e WHERE e.goal_id = g.id), 0) AS saved
     FROM goals g WHERE g.user_id=? AND g.archived=0 ORDER BY g.id DESC LIMIT 4`
  ).all(uid));

  const upcoming = camelize(db.prepare(
    `SELECT r.id, r.name, r.type, r.amount, r.frequency, r.next_date,
            c.emoji AS category_emoji
     FROM recurring r LEFT JOIN categories c ON c.id = r.category_id
     WHERE r.user_id=? AND r.active=1 AND r.next_date <= ?
     ORDER BY r.next_date ASC LIMIT 5`
  ).all(uid, addMonths(from, 1).slice(0, 7) + '-31'));

  res.json({
    month,
    today: localDateStr(),
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
  });
});

module.exports = router;

const express = require('express');
const { db } = require('../db');
const { auth } = require('../middleware/auth');
const { camelize, toPaise } = require('../util');

const router = express.Router();
router.use(auth);

const VALID_TYPES = ['cash', 'bank', 'upi', 'card', 'wallet', 'other'];

const BALANCE_SQL = `
  SELECT a.*,
    a.initial_balance
    + COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.type = 'income'   AND t.account_id = a.id), 0)
    - COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.type = 'expense'  AND t.account_id = a.id), 0)
    + COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.type = 'transfer' AND t.to_account_id = a.id), 0)
    - COALESCE((SELECT SUM(amount) FROM transactions t WHERE t.type = 'transfer' AND t.account_id = a.id), 0)
    AS balance,
    (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id OR t.to_account_id = a.id) AS txn_count
  FROM accounts a
  WHERE a.user_id = ?
  ORDER BY a.is_archived ASC, a.id ASC
`;

router.get('/', (req, res) => {
  const rows = db.prepare(BALANCE_SQL).all(req.userId);
  res.json({ accounts: camelize(rows) });
});

router.post('/', (req, res) => {
  const { name, type, emoji, color, initialBalance } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Account name is required' });
  const t = VALID_TYPES.includes(type) ? type : 'other';
  const init = initialBalance == null || initialBalance === '' ? 0 : Math.round(Number(initialBalance) * 100);
  if (!isFinite(init)) return res.status(400).json({ error: 'Invalid opening balance' });
  const info = db.prepare(
    'INSERT INTO accounts (user_id, name, type, emoji, color, initial_balance) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.userId, String(name).trim(), t, String(emoji || '💵'), String(color || '#6366f1'), init);
  const row = db.prepare(BALANCE_SQL.replace('WHERE a.user_id = ?', 'WHERE a.id = ?')).get(info.lastInsertRowid);
  res.status(201).json({ account: camelize(row) });
});

router.patch('/:id', (req, res) => {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  const { name, type, emoji, color, initialBalance, isArchived } = req.body || {};
  const next = {
    name: name != null ? String(name).trim() || acc.name : acc.name,
    type: VALID_TYPES.includes(type) ? type : acc.type,
    emoji: emoji != null ? String(emoji) : acc.emoji,
    color: color != null ? String(color) : acc.color,
    initial_balance: initialBalance != null && initialBalance !== '' ? Math.round(Number(initialBalance) * 100) : acc.initial_balance,
    is_archived: isArchived != null ? (isArchived ? 1 : 0) : acc.is_archived
  };
  if (!isFinite(next.initial_balance)) return res.status(400).json({ error: 'Invalid opening balance' });
  db.prepare(
    'UPDATE accounts SET name=?, type=?, emoji=?, color=?, initial_balance=?, is_archived=? WHERE id=?'
  ).run(next.name, next.type, next.emoji, next.color, next.initial_balance, next.is_archived, acc.id);
  const row = db.prepare(BALANCE_SQL.replace('WHERE a.user_id = ?', 'WHERE a.id = ?')).get(acc.id);
  res.json({ account: camelize(row) });
});

router.delete('/:id', (req, res) => {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  const count = db.prepare('SELECT COUNT(*) c FROM transactions WHERE user_id=? AND (account_id=? OR to_account_id=?)')
    .get(req.userId, acc.id, acc.id).c;
  if (count > 0) {
    return res.status(400).json({ error: `This account has ${count} transaction(s). Archive it instead, or delete those transactions first.` });
  }
  db.prepare('DELETE FROM accounts WHERE id = ?').run(acc.id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.BALANCE_SQL = BALANCE_SQL;

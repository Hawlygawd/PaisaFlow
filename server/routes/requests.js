const express = require('express');
const { db } = require('../db');
const { auth } = require('../middleware/auth');
const { camelize, toPaise, DATE_RE, todayStr } = require('../util');

const router = express.Router();
router.use(auth);

router.get('/', (req, res) => {
  const rows = db.prepare(
    `SELECT * FROM requests WHERE user_id = ? ORDER BY
       CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC`
  ).all(req.userId);
  res.json({ requests: camelize(rows) });
});

router.post('/', (req, res) => {
  const { amount, note, fromName, dueDate } = req.body || {};
  const amt = toPaise(amount);
  if (!amt) return res.status(400).json({ error: 'Enter a valid amount' });
  if (dueDate && !DATE_RE.test(String(dueDate))) return res.status(400).json({ error: 'Invalid due date' });
  const user = db.prepare('SELECT name, upi_id FROM users WHERE id = ?').get(req.userId);
  if (!user.upi_id) return res.status(400).json({ error: 'Set your UPI ID in Settings first' });
  const info = db.prepare(
    'INSERT INTO requests (user_id, amount, note, from_name, due_date, upi_id, payee_name) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.userId, amt, String(note || '').slice(0, 100), String(fromName || '').slice(0, 60),
        dueDate || null, user.upi_id, user.name);
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ request: camelize(row) });
});

router.patch('/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM requests WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  const { status, amount, note, fromName, dueDate } = req.body || {};
  const nextStatus = ['pending', 'received', 'cancelled'].includes(status) ? status : r.status;
  const amt = amount !== undefined ? toPaise(amount) : r.amount;
  if (!amt) return res.status(400).json({ error: 'Enter a valid amount' });
  db.prepare(
    `UPDATE requests SET status=?, amount=?, note=?, from_name=?, due_date=?,
       received_at = CASE WHEN ? = 'received' AND received_at IS NULL THEN datetime('now') ELSE received_at END
     WHERE id=?`
  ).run(nextStatus, amt,
        note !== undefined ? String(note).slice(0, 100) : r.note,
        fromName !== undefined ? String(fromName).slice(0, 60) : r.from_name,
        dueDate !== undefined ? (dueDate || null) : r.due_date,
        nextStatus, r.id);
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(r.id);
  res.json({ request: camelize(row) });
});

// Mark as received → auto-create an income transaction
router.post('/:id/receive', (req, res) => {
  const r = db.prepare('SELECT * FROM requests WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  if (r.status === 'received') return res.status(400).json({ error: 'Already marked as received' });

  const cat = db.prepare("SELECT id FROM categories WHERE user_id=? AND type='income' AND name='Other Income'").get(req.userId);
  const note = `Received${r.from_name ? ' from ' + r.from_name : ''}${r.note ? ': ' + r.note : ''} (UPI)`;
  const run = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO transactions (user_id, type, amount, category_id, note, date, source)
       VALUES (?, 'income', ?, ?, ?, ?, 'manual')`
    ).run(req.userId, r.amount, cat ? cat.id : null, note.slice(0, 300), todayStr());
    db.prepare("UPDATE requests SET status='received', received_at=datetime('now'), txn_id=? WHERE id=?")
      .run(info.lastInsertRowid, r.id);
    return info.lastInsertRowid;
  });
  const txnId = run();
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(r.id);
  res.json({ request: camelize(row), txnId });
});

router.delete('/:id', (req, res) => {
  const r = db.prepare('SELECT id FROM requests WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  db.prepare('DELETE FROM requests WHERE id=?').run(r.id);
  res.json({ ok: true });
});

module.exports = router;

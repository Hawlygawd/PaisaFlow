const express = require('express');
const { db } = require('../db');
const { auth } = require('../middleware/auth');
const { camelize, toPaise, DATE_RE, todayStr, addFrequency } = require('../util');

const router = express.Router();

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];

const JOIN_SELECT = `
  SELECT r.*,
    c.name AS category_name, c.emoji AS category_emoji, c.color AS category_color,
    a.name AS account_name, a.emoji AS account_emoji
  FROM recurring r
  LEFT JOIN categories c ON c.id = r.category_id
  LEFT JOIN accounts a ON a.id = r.account_id
`;

// Post every due occurrence of every active recurring item (idempotent per day)
function processDueRecurring(userId) {
  const today = todayStr();
  const due = db.prepare(
    `SELECT * FROM recurring
     WHERE user_id = ? AND active = 1 AND next_date <= ? AND (end_date IS NULL OR end_date >= next_date)`
  ).all(userId, today);
  if (!due.length) return 0;

  const ins = db.prepare(
    `INSERT INTO transactions (user_id, type, amount, account_id, category_id, note, date, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'recurring')`
  );
  let posted = 0;
  const run = db.transaction(() => {
    for (const r of due) {
      let next = r.next_date;
      let lastPosted = r.last_posted;
      let count = 0;
      while (next <= today && count < 12 && (!r.end_date || next <= r.end_date)) {
        ins.run(userId, r.type, r.amount, r.account_id, r.category_id, r.name, next);
        lastPosted = next;
        next = addFrequency(next, r.frequency);
        count++;
        posted++;
      }
      if (r.end_date && next > r.end_date) {
        db.prepare('UPDATE recurring SET active = 0, next_date = ?, last_posted = ? WHERE id = ?')
          .run(next, lastPosted, r.id);
      } else {
        // If still behind (very old next_date), fast-forward without flooding
        let guard = 0;
        while (next <= today && guard++ < 500) next = addFrequency(next, r.frequency);
        db.prepare('UPDATE recurring SET next_date = ?, last_posted = ? WHERE id = ?').run(next, lastPosted, r.id);
      }
    }
  });
  run();
  return posted;
}

router.use(auth);

router.get('/', (req, res) => {
  processDueRecurring(req.userId);
  const rows = db.prepare(JOIN_SELECT + ' WHERE r.user_id = ? ORDER BY r.active DESC, r.next_date ASC').all(req.userId);
  res.json({ items: camelize(rows) });
});

function validate(body, partial = false) {
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
  if (body.endDate !== undefined) {
    out.end_date = body.endDate && DATE_RE.test(String(body.endDate)) ? String(body.endDate) : null;
  }
  if (body.categoryId !== undefined) out.category_id = body.categoryId ? Number(body.categoryId) : null;
  if (body.accountId !== undefined) out.account_id = body.accountId ? Number(body.accountId) : null;
  if (body.note !== undefined) out.note = String(body.note).slice(0, 300);
  if (body.active !== undefined) out.active = body.active ? 1 : 0;
  return { out };
}

router.post('/', (req, res) => {
  const v = validate(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  const r = v.out;
  const info = db.prepare(
    `INSERT INTO recurring (user_id, name, type, amount, category_id, account_id, frequency, start_date, end_date, next_date, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(req.userId, r.name, r.type, r.amount, r.category_id ?? null, r.account_id ?? null,
        r.frequency, r.start_date, r.end_date ?? null, r.start_date, r.note ?? '');
  processDueRecurring(req.userId);
  const row = db.prepare(JOIN_SELECT + ' WHERE r.id = ?').get(info.lastInsertRowid);
  res.status(201).json({ item: camelize(row) });
});

router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM recurring WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Recurring item not found' });
  const v = validate(req.body || {}, true);
  if (v.error) return res.status(400).json({ error: v.error });
  const m = { ...existing, ...v.out };
  // If start date changed, rebase next_date
  let next = existing.next_date;
  if (v.out.start_date && v.out.start_date !== existing.start_date) next = v.out.start_date;
  if (v.out.frequency && v.out.frequency !== existing.frequency && !existing.last_posted) next = m.start_date;
  db.prepare(
    `UPDATE recurring SET name=?, type=?, amount=?, category_id=?, account_id=?, frequency=?,
       start_date=?, end_date=?, next_date=?, note=?, active=? WHERE id=?`
  ).run(m.name, m.type, m.amount, m.category_id ?? null, m.account_id ?? null, m.frequency,
        m.start_date, m.end_date ?? null, next, m.note ?? '', m.active != null ? m.active : existing.active, existing.id);
  processDueRecurring(req.userId);
  const row = db.prepare(JOIN_SELECT + ' WHERE r.id = ?').get(existing.id);
  res.json({ item: camelize(row) });
});

router.post('/:id/post', (req, res) => {
  const r = db.prepare('SELECT * FROM recurring WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!r) return res.status(404).json({ error: 'Recurring item not found' });
  const today = todayStr();
  db.prepare(
    `INSERT INTO transactions (user_id, type, amount, account_id, category_id, note, date, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'recurring')`
  ).run(req.userId, r.type, r.amount, r.account_id, r.category_id, r.name, today);
  // If the item was due (or overdue), advance the schedule past today.
  // If it posts early (next date still in the future), keep the original schedule.
  let next = r.next_date;
  if (r.next_date <= today) {
    next = addFrequency(next, r.frequency);
    let guard = 0;
    while (next <= today && guard++ < 500) next = addFrequency(next, r.frequency);
  }
  db.prepare('UPDATE recurring SET next_date=?, last_posted=?, active=1 WHERE id=?').run(next, today, r.id);
  const row = db.prepare(JOIN_SELECT + ' WHERE r.id = ?').get(r.id);
  res.json({ item: camelize(row) });
});

router.delete('/:id', (req, res) => {
  const r = db.prepare('SELECT id FROM recurring WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!r) return res.status(404).json({ error: 'Recurring item not found' });
  db.prepare('DELETE FROM recurring WHERE id=?').run(r.id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.processDueRecurring = processDueRecurring;

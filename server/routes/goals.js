const express = require('express');
const { db } = require('../db');
const { auth } = require('../middleware/auth');
const { camelize, toPaise, DATE_RE, todayStr } = require('../util');

const router = express.Router();
router.use(auth);

const GOAL_CORE = `
  SELECT g.*,
    COALESCE((SELECT SUM(e.amount) FROM goal_entries e WHERE e.goal_id = g.id), 0) AS saved,
    (SELECT COUNT(*) FROM goal_entries e WHERE e.goal_id = g.id) AS entry_count
  FROM goals g
  WHERE g.user_id = ? AND g.archived = 0`;

const GOAL_ANY = GOAL_CORE.replace(' AND g.archived = 0', '');

router.get('/', (req, res) => {
  const rows = db.prepare(GOAL_CORE + ' ORDER BY g.id DESC').all(req.userId);
  res.json({ goals: camelize(rows) });
});

router.post('/', (req, res) => {
  const { name, target, deadline, emoji, color } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Goal name is required' });
  const tgt = toPaise(target);
  if (!tgt) return res.status(400).json({ error: 'Enter a valid target amount' });
  if (deadline && !DATE_RE.test(String(deadline))) return res.status(400).json({ error: 'Invalid deadline' });
  const info = db.prepare(
    'INSERT INTO goals (user_id, name, target, deadline, emoji, color) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.userId, String(name).trim(), tgt, deadline || null, String(emoji || '🎯'), String(color || '#6366f1'));
  const row = db.prepare(GOAL_CORE + ' AND g.id = ?').get(req.userId, info.lastInsertRowid);
  res.status(201).json({ goal: camelize(row) });
});

router.patch('/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM goals WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!g) return res.status(404).json({ error: 'Goal not found' });
  const { name, target, deadline, emoji, color, archived } = req.body || {};
  let tgt = g.target;
  if (target !== undefined) {
    tgt = toPaise(target);
    if (!tgt) return res.status(400).json({ error: 'Enter a valid target amount' });
  }
  db.prepare('UPDATE goals SET name=?, target=?, deadline=?, emoji=?, color=?, archived=? WHERE id=?').run(
    name != null && String(name).trim() ? String(name).trim() : g.name,
    tgt,
    deadline !== undefined ? (deadline || null) : g.deadline,
    emoji != null ? String(emoji) : g.emoji,
    color != null ? String(color) : g.color,
    archived != null ? (archived ? 1 : 0) : g.archived,
    g.id
  );
  const row = db.prepare(GOAL_ANY + ' AND g.id = ?').get(req.userId, g.id);
  res.json({ goal: camelize(row) });
});

router.delete('/:id', (req, res) => {
  const g = db.prepare('SELECT id FROM goals WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!g) return res.status(404).json({ error: 'Goal not found' });
  db.prepare('DELETE FROM goals WHERE id=?').run(g.id);
  res.json({ ok: true });
});

router.get('/:id/entries', (req, res) => {
  const g = db.prepare('SELECT id FROM goals WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!g) return res.status(404).json({ error: 'Goal not found' });
  const rows = db.prepare('SELECT * FROM goal_entries WHERE goal_id=? ORDER BY date DESC, id DESC').all(g.id);
  res.json({ entries: camelize(rows) });
});

router.post('/:id/entries', (req, res) => {
  const g = db.prepare('SELECT * FROM goals WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!g) return res.status(404).json({ error: 'Goal not found' });
  const { amount, date, note, kind } = req.body || {};
  const amt = toPaise(amount);
  if (!amt) return res.status(400).json({ error: 'Enter a valid amount' });
  if (date && !DATE_RE.test(String(date))) return res.status(400).json({ error: 'Invalid date' });
  const signed = kind === 'withdraw' ? -amt : amt;
  const info = db.prepare('INSERT INTO goal_entries (user_id, goal_id, amount, date, note) VALUES (?, ?, ?, ?, ?)')
    .run(req.userId, g.id, signed, date || todayStr(), String(note || '').slice(0, 200));
  const entry = db.prepare('SELECT * FROM goal_entries WHERE id=?').get(info.lastInsertRowid);
  const goal = db.prepare(GOAL_CORE + ' AND g.id = ?').get(req.userId, g.id);
  res.status(201).json({ entry: camelize(entry), goal: camelize(goal) });
});

router.delete('/:id/entries/:entryId', (req, res) => {
  const e = db.prepare(
    'SELECT e.* FROM goal_entries e JOIN goals g ON g.id = e.goal_id WHERE e.id=? AND e.user_id=? AND g.id=?'
  ).get(req.params.entryId, req.userId, req.params.id);
  if (!e) return res.status(404).json({ error: 'Entry not found' });
  db.prepare('DELETE FROM goal_entries WHERE id=?').run(e.id);
  const goal = db.prepare(GOAL_ANY + ' AND g.id = ?').get(req.userId, e.goal_id);
  res.json({ ok: true, goal: camelize(goal) });
});

module.exports = router;

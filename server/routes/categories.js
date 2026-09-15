const express = require('express');
const { db } = require('../db');
const { auth } = require('../middleware/auth');
const { camelize } = require('../util');

const router = express.Router();
router.use(auth);

router.get('/', (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM categories WHERE user_id = ? ORDER BY type DESC, is_default DESC, id ASC"
  ).all(req.userId);
  res.json({ categories: camelize(rows) });
});

router.post('/', (req, res) => {
  const { name, type, emoji, color } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Category name is required' });
  if (!['income', 'expense'].includes(type)) return res.status(400).json({ error: 'Type must be income or expense' });
  const dup = db.prepare('SELECT id FROM categories WHERE user_id=? AND name=? COLLATE NOCASE AND type=?')
    .get(req.userId, String(name).trim(), type);
  if (dup) return res.status(409).json({ error: 'A category with this name already exists' });
  const info = db.prepare('INSERT INTO categories (user_id, name, type, emoji, color) VALUES (?, ?, ?, ?, ?)')
    .run(req.userId, String(name).trim(), type, String(emoji || '📦'), String(color || '#6366f1'));
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ category: camelize(row) });
});

router.patch('/:id', (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  const { name, emoji, color } = req.body || {};
  db.prepare('UPDATE categories SET name=?, emoji=?, color=? WHERE id=?').run(
    name != null && String(name).trim() ? String(name).trim() : cat.name,
    emoji != null ? String(emoji) : cat.emoji,
    color != null ? String(color) : cat.color,
    cat.id
  );
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(cat.id);
  res.json({ category: camelize(row) });
});

router.delete('/:id', (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  // Transactions keep existing but become uncategorized (ON DELETE SET NULL); budgets are removed.
  db.prepare('DELETE FROM categories WHERE id = ?').run(cat.id);
  res.json({ ok: true });
});

module.exports = router;

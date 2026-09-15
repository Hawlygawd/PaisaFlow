const express = require('express');
const { db } = require('../db');
const { auth } = require('../middleware/auth');
const { csvEscape, parseCsv, DATE_RE, todayStr } = require('../util');

const router = express.Router();
router.use(auth);

// GET /api/data/export.csv — full transaction history
router.get('/export.csv', (req, res) => {
  const rows = db.prepare(
    `SELECT t.date, t.type, t.amount, c.name AS category, a.name AS account, a2.name AS to_account, t.note, t.tags
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN accounts a ON a.id = t.account_id
     LEFT JOIN accounts a2 ON a2.id = t.to_account_id
     WHERE t.user_id = ? ORDER BY t.date DESC, t.id DESC`
  ).all(req.userId);

  const lines = ['Date,Type,Amount,Category,Account,To Account,Note,Tags'];
  for (const r of rows) {
    let tags = '';
    try { tags = JSON.parse(r.tags || '[]').join('|'); } catch { tags = ''; }
    lines.push([
      r.date, r.type, (r.amount / 100).toFixed(2), r.category || '', r.account || '',
      r.to_account || '', r.note || '', tags
    ].map(csvEscape).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="paisaflow-export-${todayStr()}.csv"`);
  res.send(lines.join('\n'));
});

// POST /api/data/import — raw CSV text body
router.post('/import', express.text({ type: '*/*', limit: '10mb' }), (req, res) => {
  const text = String(req.body || '');
  if (!text.trim()) return res.status(400).json({ error: 'CSV content is empty' });
  const rows = parseCsv(text);
  if (rows.length < 2) return res.status(400).json({ error: 'CSV needs a header row and at least one data row' });

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (names) => {
    for (const n of names) { const i = header.indexOf(n); if (i !== -1) return i; }
    return -1;
  };
  const iDate = idx(['date']);
  const iType = idx(['type']);
  const iAmount = idx(['amount']);
  const iCategory = idx(['category']);
  const iAccount = idx(['account']);
  const iNote = idx(['note', 'description', 'details']);
  const iTags = idx(['tags']);
  if (iDate === -1 || iAmount === -1) {
    return res.status(400).json({ error: 'CSV must contain at least Date and Amount columns' });
  }

  const findCategory = db.prepare('SELECT id FROM categories WHERE user_id=? AND name=? COLLATE NOCASE AND type=?');
  const createCategory = db.prepare('INSERT INTO categories (user_id, name, type) VALUES (?, ?, ?)');
  const findAccount = db.prepare('SELECT id FROM accounts WHERE user_id=? AND name=? COLLATE NOCASE');
  const insertTxn = db.prepare(
    `INSERT INTO transactions (user_id, type, amount, account_id, category_id, note, tags, date, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'import')`
  );

  let imported = 0;
  const errors = [];
  const run = db.transaction(() => {
    for (let i = 1; i < rows.length && i <= 20000; i++) {
      const r = rows[i];
      try {
        const date = String(r[iDate] || '').trim().slice(0, 10);
        if (!DATE_RE.test(date)) { errors.push(`Row ${i + 1}: invalid date`); continue; }
        const typeRaw = String((iType !== -1 && r[iType]) || 'expense').trim().toLowerCase();
        const type = typeRaw === 'income' || typeRaw === 'credit' ? 'income'
          : typeRaw === 'expense' || typeRaw === 'debit' ? 'expense' : null;
        if (!type) { errors.push(`Row ${i + 1}: type must be income or expense`); continue; }
        let amount = parseFloat(String(r[iAmount] || '').replace(/[₹,\s]/g, ''));
        if (!isFinite(amount)) { errors.push(`Row ${i + 1}: invalid amount`); continue; }
        if (amount < 0) amount = -amount;
        if (amount === 0) { errors.push(`Row ${i + 1}: zero amount`); continue; }
        const paise = Math.round(amount * 100);

        let categoryId = null;
        if (iCategory !== -1 && r[iCategory] && String(r[iCategory]).trim()) {
          const cname = String(r[iCategory]).trim();
          const found = findCategory.get(req.userId, cname, type);
          if (found) categoryId = found.id;
          else categoryId = createCategory.run(req.userId, cname, type).lastInsertRowid;
        }
        let accountId = null;
        if (iAccount !== -1 && r[iAccount] && String(r[iAccount]).trim()) {
          const found = findAccount.get(req.userId, String(r[iAccount]).trim());
          if (found) accountId = found.id;
        }
        let tags = '[]';
        if (iTags !== -1 && r[iTags] && String(r[iTags]).trim()) {
          tags = JSON.stringify(String(r[iTags]).split('|').map((t) => t.trim()).filter(Boolean).slice(0, 10));
        }
        insertTxn.run(req.userId, type, paise, accountId, categoryId,
          iNote !== -1 ? String(r[iNote] || '').slice(0, 300) : '', tags, date);
        imported++;
      } catch (e) {
        errors.push(`Row ${i + 1}: ${e.message}`);
      }
    }
  });
  run();
  res.json({ imported, skipped: errors.length, errors: errors.slice(0, 20) });
});

// DELETE /api/data/account — delete user and everything
router.delete('/account', (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.userId);
  res.json({ ok: true });
});

module.exports = router;

const express = require('express');
const bcrypt = require('bcryptjs');
const { db, seedUser } = require('../db');
const { auth, setAuthCookie, clearAuthCookie, signToken } = require('../middleware/auth');
const { camelize } = require('../util');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  if (!email || !EMAIL_RE.test(String(email).trim())) return res.status(400).json({ error: 'Enter a valid email address' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (exists) return res.status(409).json({ error: 'An account with this email already exists' });

  const hash = bcrypt.hashSync(String(password), 10);
  const info = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(String(name).trim(), String(email).trim().toLowerCase(), hash);
  const userId = info.lastInsertRowid;
  seedUser(userId);

  setAuthCookie(res, userId);
  const user = db.prepare('SELECT id, name, email, upi_id, created_at FROM users WHERE id = ?').get(userId);
  res.json({ user: camelize(user), token: signToken(userId) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  setAuthCookie(res, user.id);
  res.json({
    user: camelize({ id: user.id, name: user.name, email: user.email, upi_id: user.upi_id, created_at: user.created_at }),
    token: signToken(user.id)
  });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, upi_id, created_at FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(401).json({ error: 'Account not found' });
  res.json({ user: camelize(user) });
});

router.patch('/me', auth, (req, res) => {
  const { name, upiId } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  const upi = upiId !== undefined ? String(upiId).trim().toLowerCase() : undefined;
  if (upi && !/^[a-z0-9.\-_]{2,}@[a-z]{2,}$/i.test(upi)) {
    return res.status(400).json({ error: 'Enter a valid UPI ID, e.g. yourname@okhdfcbank' });
  }
  if (upi !== undefined) {
    db.prepare('UPDATE users SET name = ?, upi_id = ? WHERE id = ?').run(String(name).trim(), upi, req.userId);
  } else {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).trim(), req.userId);
  }
  const user = db.prepare('SELECT id, name, email, upi_id, created_at FROM users WHERE id = ?').get(req.userId);
  res.json({ user: camelize(user) });
});

router.post('/password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!bcrypt.compareSync(String(currentPassword || ''), user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(newPassword), 10), req.userId);
  res.json({ ok: true });
});

module.exports = router;

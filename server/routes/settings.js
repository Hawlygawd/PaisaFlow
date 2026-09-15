const express = require('express');
const { db } = require('../db');
const { auth } = require('../middleware/auth');
const { sendDigest, getSettings } = require('../digest');

const router = express.Router();
router.use(auth);

const ALLOWED_KEYS = new Set([
  'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass',
  'digest_to', 'digest_enabled', 'digest_day', 'digest_hour'
]);

router.get('/', (req, res) => {
  res.json({ settings: getSettings(req.userId) });
});

router.put('/', (req, res) => {
  const body = req.body || {};
  const upsert = db.prepare(
    `INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
  );
  const run = db.transaction(() => {
    for (const [k, v] of Object.entries(body)) {
      if (!ALLOWED_KEYS.has(k)) continue;
      upsert.run(req.userId, k, v == null ? '' : String(v));
    }
  });
  run();
  res.json({ settings: getSettings(req.userId) });
});

router.post('/send-test', async (req, res) => {
  try {
    const s = getSettings(req.userId);
    await sendDigest(req.userId, s, { test: true });
    res.json({ ok: true, to: s.digest_to || 'your account email' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;

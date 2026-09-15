const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('../db');

// Persist a JWT secret so sessions survive restarts
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
let SECRET;
if (fs.existsSync(SECRET_FILE)) {
  SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
} else {
  SECRET = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 });
}

const COOKIE_NAME = 'pf_token';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, SECRET, { expiresIn: '7d' });
}

function setAuthCookie(res, userId) {
  res.cookie(COOKIE_NAME, signToken(userId), COOKIE_OPTS);
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function auth(req, res, next) {
  // Accept the session cookie (browser) or a Bearer token (mobile app / API clients)
  let token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) {
    const h = req.headers.authorization;
    if (h && h.startsWith('Bearer ')) token = h.slice(7);
  }
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const payload = jwt.verify(token, SECRET);
    req.userId = Number(payload.sub);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired, please sign in again' });
  }
}

module.exports = { auth, setAuthCookie, clearAuthCookie, signToken, COOKIE_NAME };

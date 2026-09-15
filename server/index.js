const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const app = express();
app.disable('x-powered-by');

// CORS: allow any origin WITH credentials so the packaged Android app
// (served from https://localhost inside the WebView) can call a remote server.
// Fine for a self-hosted personal app; tighten `origin` if you expose it publicly.
app.use(cors({ origin: true, credentials: true }));

app.use((req, res, next) => {
  // Basic security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'PaisaFlow' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/budgets', require('./routes/budgets'));
app.use('/api/goals', require('./routes/goals'));
app.use('/api/recurring', require('./routes/recurring'));
app.use('/api/loans', require('./routes/loans'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/data', require('./routes/data'));

// Serve the built frontend (production)
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

// Central error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side' });
});

// Weekly digest scheduler — checks every 15 minutes
const { runDigestScheduler } = require('./digest');
setTimeout(() => runDigestScheduler().catch((e) => console.error('[digest]', e)), 30 * 1000);
setInterval(() => runDigestScheduler().catch((e) => console.error('[digest]', e)), 15 * 60 * 1000);

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PaisaFlow server running on http://0.0.0.0:${PORT}`);
});

const nodemailer = require('nodemailer');
const { db } = require('./db');
const { localDateStr, addDays } = require('./util');

// 'YYYY-MM' → 'September 2026'
function monthLabel(month) {
  const [y, m] = String(month).split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

// ---------- data ----------

function weeklyData(userId) {
  const today = localDateStr();
  const from = addDays(today, -6);

  const totals = db.prepare(
    `SELECT
      COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
     FROM transactions WHERE user_id=? AND date BETWEEN ? AND ?`
  ).get(userId, from, today);

  const byCategory = db.prepare(
    `SELECT COALESCE(c.name,'Uncategorized') AS name, COALESCE(c.emoji,'📦') AS emoji, SUM(t.amount) AS total
     FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
     WHERE t.user_id=? AND t.type='expense' AND t.date BETWEEN ? AND ?
     GROUP BY t.category_id ORDER BY total DESC LIMIT 5`
  ).all(userId, from, today);

  const month = today.slice(0, 7);
  const budgets = db.prepare(
    `SELECT c.name, c.emoji, b.amount,
      COALESCE((SELECT SUM(t.amount) FROM transactions t
        WHERE t.user_id=b.user_id AND t.type='expense' AND t.category_id=b.category_id
          AND strftime('%Y-%m',t.date)=b.month),0) AS spent
     FROM budgets b JOIN categories c ON c.id=b.category_id
     WHERE b.user_id=? AND b.month=?`
  ).all(userId, month).filter((b) => b.spent / b.amount >= 0.75);

  const upcoming = db.prepare(
    `SELECT r.name, r.amount, r.type, r.next_date FROM recurring r
     WHERE r.user_id=? AND r.active=1 AND r.next_date BETWEEN ? AND ?
     ORDER BY r.next_date LIMIT 5`
  ).all(userId, today, addDays(today, 7));

  const goals = db.prepare(
    `SELECT g.name, g.emoji, g.target,
      COALESCE((SELECT SUM(e.amount) FROM goal_entries e WHERE e.goal_id=g.id),0) AS saved
     FROM goals g WHERE g.user_id=? AND g.archived=0 ORDER BY g.id DESC LIMIT 3`
  ).all(userId);

  const loans = db.prepare('SELECT * FROM loans WHERE user_id=? AND closed=0').all(userId);

  return { from, to: today, totals, byCategory, budgets, upcoming, goals, loans, month };
}

// ---------- helpers ----------

const inr = (p) => '₹' + (Number(p) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

function buildDigestHtml(userId, userName) {
  const d = weeklyData(userId);
  const net = d.totals.income - d.totals.expense;

  // Loan outstanding (same compound method as the loans route)
  const { loanOutstanding } = require('./util');
  let loanOut = 0;
  for (const l of d.loans) {
    const pays = db.prepare('SELECT * FROM loan_payments WHERE loan_id=?').all(l.id);
    loanOut += loanOutstanding(l, pays);
  }

  const rows = (list, fmt) => list.map(fmt).join('');

  return `
<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;background:#f8fafc;padding:20px">
  <div style="background:#4f46e5;border-radius:16px 16px 0 0;padding:20px 24px;color:#fff">
    <div style="font-size:13px;opacity:.85">💸 PaisaFlow · Weekly Digest</div>
    <div style="font-size:20px;font-weight:800;margin-top:2px">Namaste ${esc(userName)} 🙏</div>
    <div style="font-size:12px;opacity:.8;margin-top:2px">${esc(d.from)} → ${esc(d.to)}</div>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:20px 24px">
    <table width="100%" cellspacing="0" cellpadding="8" style="border-collapse:collapse;text-align:center">
      <tr>
        <td style="background:#f0fdf4;border-radius:10px"><div style="font-size:11px;color:#64748b">INCOME</div><div style="font-size:17px;font-weight:800;color:#16a34a">${inr(d.totals.income)}</div></td>
        <td style="background:#fff1f2;border-radius:10px"><div style="font-size:11px;color:#64748b">EXPENSES</div><div style="font-size:17px;font-weight:800;color:#e11d48">${inr(d.totals.expense)}</div></td>
        <td style="background:#eef2ff;border-radius:10px"><div style="font-size:11px;color:#64748b">NET</div><div style="font-size:17px;font-weight:800;color:#4f46e5">${inr(net)}</div></td>
      </tr>
    </table>

    ${d.byCategory.length ? `
    <div style="margin-top:20px;font-weight:800;font-size:14px">Top spending this week</div>
    ${rows(d.byCategory, (c) => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
        <span>${c.emoji} ${esc(c.name)}</span><b>${inr(c.total)}</b>
      </div>`)}
    ` : '<div style="margin-top:20px;font-size:13px;color:#64748b">No expenses recorded this week.</div>'}

    ${d.budgets.length ? `
    <div style="margin-top:20px;font-weight:800;font-size:14px">⚠️ Budget watch (${esc(monthLabel(d.month))})</div>
    ${rows(d.budgets, (b) => {
      const pct = Math.round((b.spent / b.amount) * 100);
      return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
        <span>${b.emoji} ${esc(b.name)}</span><b style="color:${pct >= 100 ? '#e11d48' : '#d97706'}">${pct}% used (${inr(b.spent)} / ${inr(b.amount)})</b>
      </div>`;
    })}` : ''}

    ${d.upcoming.length ? `
    <div style="margin-top:20px;font-weight:800;font-size:14px">🔁 Coming up (next 7 days)</div>
    ${rows(d.upcoming, (r) => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
        <span>${esc(r.name)} <span style="color:#94a3b8">· ${esc(r.next_date)}</span></span>
        <b style="color:${r.type === 'income' ? '#16a34a' : '#e11d48'}">${r.type === 'income' ? '+' : '−'}${inr(r.amount)}</b>
      </div>`)}
    ` : ''}

    ${d.goals.length ? `
    <div style="margin-top:20px;font-weight:800;font-size:14px">🎯 Goals</div>
    ${rows(d.goals, (g) => {
      const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
      return `<div style="padding:6px 0;font-size:13px">
        <div style="display:flex;justify-content:space-between"><span>${g.emoji} ${esc(g.name)}</span><b>${pct}%</b></div>
        <div style="background:#f1f5f9;border-radius:99px;height:6px;margin-top:4px"><div style="background:#4f46e5;height:6px;border-radius:99px;width:${pct}%"></div></div>
      </div>`;
    })}` : ''}

    ${loanOut > 0 ? `
    <div style="margin-top:20px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;font-size:13px">
      🏦 Total loan outstanding: <b>${inr(loanOut)}</b>
    </div>` : ''}

    <div style="margin-top:22px;font-size:11px;color:#94a3b8;text-align:center">
      You are receiving this from your self-hosted PaisaFlow. Adjust or disable it in Settings → Weekly Email Digest.
    </div>
  </div>
</div>`;
}

// ---------- sending ----------

function makeTransporter(s) {
  if (!s.smtp_host || !s.smtp_user) throw new Error('SMTP is not configured yet — set host, user and password in Settings');
  return nodemailer.createTransport({
    host: s.smtp_host,
    port: Number(s.smtp_port) || 587,
    secure: String(s.smtp_secure) === '1' || Number(s.smtp_port) === 465,
    auth: { user: s.smtp_user, pass: s.smtp_pass || '' }
  });
}

async function sendDigest(userId, settings, { test = false } = {}) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('User not found');
  const to = settings.digest_to || user.email;
  const transporter = makeTransporter(settings);
  const html = buildDigestHtml(userId, user.name);
  const d = weeklyData(userId);
  const info = await transporter.sendMail({
    from: `"PaisaFlow" <${settings.smtp_user}>`,
    to,
    subject: test
      ? '📊 PaisaFlow — test digest email'
      : `📊 PaisaFlow weekly digest · ${d.from} → ${d.to}`,
    html
  });
  return info;
}

// ---------- scheduler ----------

function getSettings(userId) {
  const rows = db.prepare('SELECT key, value FROM settings WHERE user_id = ?').all(userId);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function runDigestScheduler() {
  const now = new Date();
  const users = db.prepare('SELECT id FROM users').all();
  for (const u of users) {
    try {
      const s = getSettings(u.id);
      if (s.digest_enabled !== '1') continue;
      const day = s.digest_day != null && s.digest_day !== '' ? Number(s.digest_day) : 1; // Monday
      const hour = s.digest_hour != null && s.digest_hour !== '' ? Number(s.digest_hour) : 9;
      if (now.getDay() !== day || now.getHours() !== hour) continue;
      const bucket = `${localDateStr()}T${hour}`;
      if (s.last_digest_sent === bucket) continue; // already sent this hour
      await sendDigest(u.id, s);
      db.prepare(
        `INSERT INTO settings (user_id, key, value) VALUES (?, 'last_digest_sent', ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
      ).run(u.id, bucket);
      console.log(`[digest] weekly digest sent to user ${u.id}`);
    } catch (e) {
      console.error(`[digest] failed for user ${u.id}:`, e.message);
    }
  }
}

module.exports = { sendDigest, runDigestScheduler, getSettings, weeklyData };

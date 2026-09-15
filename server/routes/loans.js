const express = require('express');
const { db } = require('../db');
const { auth } = require('../middleware/auth');
const { camelize, toPaise, DATE_RE, todayStr, calcEmi, loanOutstanding, loanSchedule, monthsBetween } = require('../util');

const router = express.Router();
router.use(auth);

function loanView(loan) {
  const payments = db.prepare('SELECT * FROM loan_payments WHERE loan_id = ?').all(loan.id);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = loanOutstanding(loan, payments);
  const principalRepaid = Math.max(0, Math.min(loan.principal, loan.principal - outstanding));
  const interestPaid = Math.max(0, totalPaid - principalRepaid);
  const monthsElapsed = monthsBetween(loan.start_date, todayStr());
  return {
    ...camelize(loan),
    totalPaid,
    outstanding,
    interestPaid,
    monthsElapsed,
    progress: loan.principal > 0 ? Math.min(100, Math.round((principalRepaid / loan.principal) * 100)) : 0,
    totalInterest: loanSchedule(loan).reduce((s, r) => s + r.interest, 0)
  };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM loans WHERE user_id = ? ORDER BY closed ASC, id DESC').all(req.userId);
  res.json({ loans: rows.map(loanView) });
});

function validate(body, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) {
    if (!body.name || !String(body.name).trim()) return { error: 'Loan name is required' };
    out.name = String(body.name).trim();
  }
  if (body.lender !== undefined) out.lender = String(body.lender).slice(0, 100);
  if (!partial || body.principal !== undefined) {
    const p = toPaise(body.principal);
    if (!p) return { error: 'Enter a valid principal amount' };
    out.principal = p;
  }
  if (!partial || body.rate !== undefined) {
    const r = Number(body.rate);
    if (!isFinite(r) || r < 0 || r > 100) return { error: 'Interest rate must be between 0 and 100' };
    out.rate = r;
  }
  if (!partial || body.tenureMonths !== undefined) {
    const t = parseInt(body.tenureMonths);
    if (!isFinite(t) || t < 1 || t > 600) return { error: 'Tenure must be between 1 and 600 months' };
    out.tenure_months = t;
  }
  if (!partial || body.startDate !== undefined) {
    if (!DATE_RE.test(String(body.startDate || ''))) return { error: 'A valid start date is required' };
    out.start_date = String(body.startDate);
  }
  if (body.emi !== undefined && body.emi !== null && body.emi !== '') {
    const e = toPaise(body.emi);
    if (!e) return { error: 'Enter a valid EMI' };
    out.emi = e;
  }
  if (body.note !== undefined) out.note = String(body.note).slice(0, 300);
  if (body.closed !== undefined) out.closed = body.closed ? 1 : 0;
  return { out };
}

router.post('/', (req, res) => {
  const v = validate(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  const l = v.out;
  const emi = l.emi || calcEmi(l.principal, l.rate, l.tenure_months);
  const info = db.prepare(
    `INSERT INTO loans (user_id, name, lender, principal, rate, tenure_months, emi, start_date, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(req.userId, l.name, l.lender ?? '', l.principal, l.rate ?? 0, l.tenure_months, emi, l.start_date, l.note ?? '');
  const loan = db.prepare('SELECT * FROM loans WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json({ loan: loanView(loan) });
});

router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM loans WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Loan not found' });
  const v = validate(req.body || {}, true);
  if (v.error) return res.status(400).json({ error: v.error });
  const m = { ...existing, ...v.out };
  // Recompute EMI automatically when core terms change and EMI wasn't explicitly set
  let emi = m.emi;
  if (v.out.emi === undefined && (v.out.principal !== undefined || v.out.rate !== undefined || v.out.tenure_months !== undefined)) {
    emi = calcEmi(m.principal, m.rate, m.tenure_months);
  }
  db.prepare(
    `UPDATE loans SET name=?, lender=?, principal=?, rate=?, tenure_months=?, emi=?, start_date=?, note=?, closed=? WHERE id=?`
  ).run(m.name, m.lender ?? '', m.principal, m.rate ?? 0, m.tenure_months, emi, m.start_date, m.note ?? '',
        m.closed != null ? m.closed : existing.closed, existing.id);
  const loan = db.prepare('SELECT * FROM loans WHERE id=?').get(existing.id);
  res.json({ loan: loanView(loan) });
});

router.delete('/:id', (req, res) => {
  const l = db.prepare('SELECT id FROM loans WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!l) return res.status(404).json({ error: 'Loan not found' });
  db.prepare('DELETE FROM loans WHERE id=?').run(l.id);
  res.json({ ok: true });
});

router.get('/:id/schedule', (req, res) => {
  const loan = db.prepare('SELECT * FROM loans WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  res.json({ schedule: loanSchedule(loan) });
});

router.get('/:id/payments', (req, res) => {
  const loan = db.prepare('SELECT id FROM loans WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  const rows = db.prepare('SELECT * FROM loan_payments WHERE loan_id=? ORDER BY date DESC, id DESC').all(loan.id);
  res.json({ payments: camelize(rows) });
});

router.post('/:id/payments', (req, res) => {
  const loan = db.prepare('SELECT * FROM loans WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  const { amount, date, note } = req.body || {};
  const amt = toPaise(amount);
  if (!amt) return res.status(400).json({ error: 'Enter a valid amount' });
  if (date && !DATE_RE.test(String(date))) return res.status(400).json({ error: 'Invalid date' });
  db.prepare('INSERT INTO loan_payments (user_id, loan_id, amount, date, note) VALUES (?, ?, ?, ?, ?)')
    .run(req.userId, loan.id, amt, date || todayStr(), String(note || '').slice(0, 200));
  const fresh = db.prepare('SELECT * FROM loans WHERE id=?').get(loan.id);
  res.status(201).json({ loan: loanView(fresh) });
});

router.delete('/:id/payments/:paymentId', (req, res) => {
  const p = db.prepare('SELECT * FROM loan_payments WHERE id=? AND user_id=? AND loan_id=?')
    .get(req.params.paymentId, req.userId, req.params.id);
  if (!p) return res.status(404).json({ error: 'Payment not found' });
  db.prepare('DELETE FROM loan_payments WHERE id=?').run(p.id);
  const fresh = db.prepare('SELECT * FROM loans WHERE id=?').get(p.loan_id);
  res.json({ ok: true, loan: loanView(fresh) });
});

module.exports = router;

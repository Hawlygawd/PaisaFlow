import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, IndianRupee, CalendarClock, CheckCircle2, History } from 'lucide-react';
import { api } from '../lib/api.js';
import { inr, inrCompact, dateLabel, todayStr } from '../lib/format.js';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../components/Layout.jsx';
import { PageHeader, Modal, Progress, EmptyState, Spinner } from '../components/ui.jsx';
import { rupeeInputToPaise, paiseToRupeeInput } from '../lib/format.js';

function emiPreview(principal, ratePct, months) {
  const r = ratePct / 1200;
  if (!principal || !months) return 0;
  if (r === 0) return principal / months;
  const p = Math.pow(1 + r, months);
  return (principal * r * p) / (p - 1);
}

export default function Loans() {
  const { toast } = useApp();
  const { confirm } = useUI();
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // create|edit|pay|schedule|history
  const [form, setForm] = useState({ name: '', lender: '', principal: '', rate: '', tenureMonths: '', startDate: todayStr(), emi: '', note: '' });
  const [payForm, setPayForm] = useState({ amount: '', date: todayStr(), note: '' });
  const [schedule, setSchedule] = useState([]);
  const [payments, setPayments] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { loans } = await api.get('/loans');
      setLoans(loans);
    } catch (e) { toast('error', e.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm({ name: '', lender: '', principal: '', rate: '', tenureMonths: '', startDate: todayStr(), emi: '', note: '' }); setModal({ mode: 'create' }); };
  const openEdit = (l) => {
    setForm({
      name: l.name, lender: l.lender || '', principal: paiseToRupeeInput(l.principal),
      rate: String(l.rate), tenureMonths: String(l.tenureMonths), startDate: l.startDate,
      emi: paiseToRupeeInput(l.emi), note: l.note || ''
    });
    setModal({ mode: 'edit', loan: l });
  };
  const openPay = (l) => { setPayForm({ amount: paiseToRupeeInput(l.emi), date: todayStr(), note: '' }); setModal({ mode: 'pay', loan: l }); };
  const openSchedule = async (l) => {
    setModal({ mode: 'schedule', loan: l });
    try {
      const { schedule } = await api.get(`/loans/${l.id}/schedule`);
      setSchedule(schedule);
    } catch (e) { toast('error', e.message); }
  };
  const openHistory = async (l) => {
    setModal({ mode: 'history', loan: l });
    try {
      const { payments } = await api.get(`/loans/${l.id}/payments`);
      setPayments(payments);
    } catch (e) { toast('error', e.message); }
  };

  const save = async () => {
    const principal = rupeeInputToPaise(form.principal);
    const tenure = parseInt(form.tenureMonths);
    if (!form.name.trim()) { toast('warning', 'Name the loan'); return; }
    if (!principal) { toast('warning', 'Enter the principal amount'); return; }
    if (!isFinite(tenure) || tenure < 1) { toast('warning', 'Enter tenure in months'); return; }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(), lender: form.lender, principal: principal / 100,
        rate: Number(form.rate) || 0, tenureMonths: tenure, startDate: form.startDate,
        emi: form.emi ? rupeeInputToPaise(form.emi) / 100 : null, note: form.note
      };
      if (modal.mode === 'create') await api.post('/loans', payload);
      else await api.patch(`/loans/${modal.loan.id}`, payload);
      toast('success', modal.mode === 'create' ? 'Loan added' : 'Loan updated');
      setModal(null);
      load(true);
    } catch (e) { toast('error', e.message); }
    finally { setBusy(false); }
  };

  const pay = async () => {
    const amount = rupeeInputToPaise(payForm.amount);
    if (!amount) { toast('warning', 'Enter an amount'); return; }
    const loan = modal.loan;
    setModal(null);
    try {
      const { loan: updated } = await api.post(`/loans/${loan.id}/payments`, { amount: amount / 100, date: payForm.date, note: payForm.note });
      setLoans((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      toast('success', `Payment of ${inr(amount, { decimals: 0 })} recorded`);
    } catch (e) { toast('error', e.message); load(true); }
  };

  const removePayment = async (p) => {
    const loan = modal.loan;
    try {
      const { loan: updated } = await api.del(`/loans/${loan.id}/payments/${p.id}`);
      setLoans((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      setPayments((prev) => prev.filter((x) => x.id !== p.id));
      toast('success', 'Payment removed');
    } catch (e) { toast('error', e.message); }
  };

  const toggleClosed = async (l) => {
    try {
      const { loan } = await api.patch(`/loans/${l.id}`, { closed: !l.closed });
      setLoans((prev) => prev.map((x) => (x.id === loan.id ? loan : x)));
      toast('success', l.closed ? 'Loan reopened' : 'Loan marked as closed 🎉');
    } catch (e) { toast('error', e.message); }
  };

  const remove = async (l) => {
    const ok = await confirm({ emoji: '🏦', title: `Delete loan "${l.name}"?`, message: 'The loan and its payment history will be deleted. (EMI transactions you recorded separately are unaffected.)', confirmLabel: 'Delete loan' });
    if (!ok) return;
    setLoans((prev) => prev.filter((x) => x.id !== l.id));
    try { await api.del(`/loans/${l.id}`); toast('success', 'Loan deleted'); }
    catch (e) { toast('error', e.message); load(true); }
  };

  const preview = useMemo(
    () => emiPreview(rupeeInputToPaise(form.principal), Number(form.rate) || 0, parseInt(form.tenureMonths) || 0),
    [form.principal, form.rate, form.tenureMonths]
  );

  const active = loans.filter((l) => !l.closed);
  const closed = loans.filter((l) => l.closed);
  const totalOutstanding = active.reduce((s, l) => s + l.outstanding, 0);
  const monthlyEmi = active.reduce((s, l) => s + l.emi, 0);

  if (loading) {
    return <div className="space-y-5"><div className="skeleton h-10 w-56" />{Array.from({ length: 2 }).map((_, i) => <div key={i} className="skeleton h-44" />)}</div>;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Loans & EMIs"
        subtitle="Track outstanding balance, interest and every EMI you pay"
        right={<button className="btn-primary" onClick={openCreate}><Plus className="h-4 w-4" /> Add loan</button>}
      />

      {loans.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="card p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Total outstanding</div>
            <div className="mt-1 text-xl font-extrabold">{inr(totalOutstanding, { decimals: 0 })}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Monthly EMI burden</div>
            <div className="mt-1 text-xl font-extrabold">{inr(monthlyEmi, { decimals: 0 })}</div>
          </div>
        </div>
      )}

      {loans.length === 0 ? (
        <EmptyState
          emoji="🏦"
          title="No loans tracked"
          subtitle="Home loan, car loan, personal loan or a friend's udhaar — add it here and see your EMI schedule and outstanding balance."
          action={<button className="btn-primary" onClick={openCreate}><Plus className="h-4 w-4" /> Add your first loan</button>}
        />
      ) : (
        <>
          {[...active, ...closed].map((l) => (
            <div key={l.id} className={`card p-4 ${l.closed ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-2xl dark:bg-slate-800">{l.closed ? '✅' : '🏦'}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{l.name}</span>
                      {l.closed && <span className="chip bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">closed</span>}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {l.lender && <span>{l.lender} · </span>}
                      {inr(l.principal, { decimals: 0 })} @ {l.rate}% · {l.tenureMonths} months
                    </div>
                  </div>
                </div>
                <div className="flex gap-0.5">
                  {!l.closed && <button className="btn-outline btn-sm" onClick={() => openPay(l)}><IndianRupee className="h-3.5 w-3.5" /> Pay EMI</button>}
                  <button className="icon-btn h-8 w-8" onClick={() => openSchedule(l)} title="Amortisation schedule"><CalendarClock className="h-3.5 w-3.5" /></button>
                  <button className="icon-btn h-8 w-8" onClick={() => openHistory(l)} title="Payment history"><History className="h-3.5 w-3.5" /></button>
                  <button className="icon-btn h-8 w-8" onClick={() => openEdit(l)} title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                  <button className="icon-btn h-8 w-8 hover:text-rose-500" onClick={() => remove(l)} title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">EMI</div><div className="text-sm font-extrabold">{inr(l.emi, { decimals: 0 })}</div></div>
                <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Outstanding</div><div className="text-sm font-extrabold text-rose-500">{inr(l.outstanding, { decimals: 0 })}</div></div>
                <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Paid so far</div><div className="text-sm font-extrabold text-emerald-600">{inr(l.totalPaid, { decimals: 0 })}</div></div>
                <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Interest (total est.)</div><div className="text-sm font-extrabold">{inr(l.totalInterest, { decimals: 0 })}</div></div>
              </div>

              <div className="mt-3">
                <div className="mb-1 flex justify-between text-[11px] text-slate-400">
                  <span>{l.progress}% repaid</span>
                  <span>{Math.max(0, l.tenureMonths - l.monthsElapsed)} EMIs left</span>
                </div>
                <Progress value={l.progress} color={l.closed ? '#22c55e' : '#6366f1'} className="h-2" />
              </div>

              {!l.closed && (
                <button className="mt-3 text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400" onClick={() => toggleClosed(l)}>
                  <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> Mark loan as fully paid
                </button>
              )}
            </div>
          ))}
        </>
      )}

      {/* Create/edit loan */}
      <Modal open={modal?.mode === 'create' || modal?.mode === 'edit'} onClose={() => setModal(null)} title={modal?.mode === 'edit' ? 'Edit loan' : 'Add loan'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Loan name</label>
              <input className="input" placeholder="e.g. Home loan" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
            </div>
            <div>
              <label className="label">Lender (optional)</label>
              <input className="input" placeholder="e.g. SBI, Dadaji 😄" value={form.lender} onChange={(e) => setForm((f) => ({ ...f, lender: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Principal (₹)</label>
              <input className="input font-bold" type="number" min="1" placeholder="500000" value={form.principal} onChange={(e) => setForm((f) => ({ ...f, principal: e.target.value }))} />
            </div>
            <div>
              <label className="label">Rate % p.a.</label>
              <input className="input" type="number" step="0.01" min="0" placeholder="8.5" value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
            </div>
            <div>
              <label className="label">Tenure (months)</label>
              <input className="input" type="number" min="1" placeholder="60" value={form.tenureMonths} onChange={(e) => setForm((f) => ({ ...f, tenureMonths: e.target.value }))} />
            </div>
          </div>
          {preview > 0 && (
            <div className="rounded-xl bg-indigo-50 px-3 py-2.5 text-sm dark:bg-indigo-500/10">
              Calculated EMI: <span className="font-extrabold text-indigo-700 dark:text-indigo-300">{inr(Math.round(preview * 100), { decimals: 0 })}</span>
              <span className="ml-1 text-[11px] text-slate-400">(you can override below)</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">EMI (₹, optional)</label>
              <input className="input" type="number" min="0" placeholder={preview ? String(Math.round(preview)) : 'auto'} value={form.emi} onChange={(e) => setForm((f) => ({ ...f, emi: e.target.value }))} />
            </div>
            <div>
              <label className="label">Start date</label>
              <input className="input" type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Note (optional)</label>
            <input className="input" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          </div>
          <button className="btn-primary w-full py-2.5" onClick={save} disabled={busy}>{busy ? <Spinner className="h-4 w-4 text-white" /> : null}{modal?.mode === 'edit' ? 'Save changes' : 'Add loan'}</button>
        </div>
      </Modal>

      {/* Pay EMI */}
      <Modal open={modal?.mode === 'pay'} onClose={() => setModal(null)} title={`Record payment · ${modal?.loan?.name || ''}`}>
        <div className="space-y-4">
          <div>
            <label className="label">Amount (₹)</label>
            <input className="input text-lg font-bold" type="number" min="1" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Date</label>
              <input className="input" type="date" value={payForm.date} onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Note</label>
              <input className="input" placeholder="e.g. EMI #12" value={payForm.note} onChange={(e) => setPayForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">Tip: also record the EMI as a transaction (category "EMI & Loans") so it reflects in your expenses. Extra payments here reduce the outstanding faster.</p>
          <button className="btn-primary w-full py-2.5" onClick={pay} disabled={busy}>Record payment</button>
        </div>
      </Modal>

      {/* Schedule */}
      <Modal open={modal?.mode === 'schedule'} onClose={() => setModal(null)} title={`EMI schedule · ${modal?.loan?.name || ''}`} wide>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 dark:border-slate-700">
                <th className="py-2 pr-3 font-semibold">#</th>
                <th className="py-2 pr-3 font-semibold">Date</th>
                <th className="py-2 pr-3 text-right font-semibold">EMI</th>
                <th className="py-2 pr-3 text-right font-semibold">Interest</th>
                <th className="py-2 pr-3 text-right font-semibold">Principal</th>
                <th className="py-2 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {schedule.map((r) => (
                <tr key={r.month}>
                  <td className="py-1.5 pr-3 text-slate-400">{r.month}</td>
                  <td className="py-1.5 pr-3">{dateLabel(r.date)}</td>
                  <td className="py-1.5 pr-3 text-right font-semibold">{inr(r.emi, { decimals: 0 })}</td>
                  <td className="py-1.5 pr-3 text-right text-rose-500">{inr(r.interest, { decimals: 0 })}</td>
                  <td className="py-1.5 pr-3 text-right text-emerald-600">{inr(r.principal, { decimals: 0 })}</td>
                  <td className="py-1.5 text-right font-bold">{inr(r.balance, { decimals: 0 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>

      {/* Payment history */}
      <Modal open={modal?.mode === 'history'} onClose={() => setModal(null)} title={`Payments · ${modal?.loan?.name || ''}`}>
        {payments.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No payments recorded yet.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {payments.map((p) => (
              <div key={p.id} className="group flex items-center gap-3 py-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10"><IndianRupee className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{p.note || 'Payment'}</div>
                  <div className="text-[11px] text-slate-400">{dateLabel(p.date)}</div>
                </div>
                <span className="text-sm font-bold text-emerald-600">{inr(p.amount, { decimals: 0 })}</span>
                <button className="icon-btn h-7 w-7 opacity-0 transition group-hover:opacity-100 hover:text-rose-500" onClick={() => removePayment(p)}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

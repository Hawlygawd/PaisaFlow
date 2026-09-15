import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, PlusCircle, MinusCircle, History } from 'lucide-react';
import { api } from '../lib/api.js';
import { inr, dateLabel, todayStr } from '../lib/format.js';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../components/Layout.jsx';
import { PageHeader, Modal, Progress, EmptyState, Spinner } from '../components/ui.jsx';
import { EmojiPicker, ColorPicker } from '../components/inputs.jsx';
import { rupeeInputToPaise, paiseToRupeeInput } from '../lib/format.js';

function Ring({ pct, color, emoji, size = 76 }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="7" className="stroke-slate-100 dark:stroke-slate-800" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="7" strokeLinecap="round"
          stroke={color} strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.min(1, pct / 100))}
          className="transition-all duration-700"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-2xl">{emoji}</span>
    </div>
  );
}

export default function Goals() {
  const { toast } = useApp();
  const { confirm } = useUI();
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // {mode:'create'}|{mode:'edit',goal}|{mode:'contribute',goal,kind}|{mode:'history',goal}
  const [form, setForm] = useState({ name: '', target: '', deadline: '', emoji: '🎯', color: '#6366f1' });
  const [contribute, setContribute] = useState({ amount: '', date: todayStr(), note: '' });
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { goals } = await api.get('/goals');
      setGoals(goals);
    } catch (e) { toast('error', e.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm({ name: '', target: '', deadline: '', emoji: '🎯', color: '#6366f1' }); setModal({ mode: 'create' }); };
  const openEdit = (g) => { setForm({ name: g.name, target: paiseToRupeeInput(g.target), deadline: g.deadline || '', emoji: g.emoji, color: g.color }); setModal({ mode: 'edit', goal: g }); };
  const openContribute = (g, kind) => { setContribute({ amount: '', date: todayStr(), note: '' }); setModal({ mode: 'contribute', goal: g, kind }); };

  const openHistory = async (g) => {
    setModal({ mode: 'history', goal: g });
    try {
      const { entries } = await api.get(`/goals/${g.id}/entries`);
      setEntries(entries);
    } catch (e) { toast('error', e.message); }
  };

  const save = async () => {
    const target = rupeeInputToPaise(form.target);
    if (!form.name.trim()) { toast('warning', 'Name your goal'); return; }
    if (!target) { toast('warning', 'Enter a target amount'); return; }
    setBusy(true);
    try {
      const payload = { name: form.name.trim(), target: target / 100, deadline: form.deadline || null, emoji: form.emoji, color: form.color };
      if (modal.mode === 'create') await api.post('/goals', payload);
      else await api.patch(`/goals/${modal.goal.id}`, payload);
      toast('success', modal.mode === 'create' ? 'Goal created 🎯' : 'Goal updated');
      setModal(null);
      load(true);
    } catch (e) { toast('error', e.message); }
    finally { setBusy(false); }
  };

  const saveContribution = async () => {
    const amount = rupeeInputToPaise(contribute.amount);
    if (!amount) { toast('warning', 'Enter an amount'); return; }
    const goal = modal.goal;
    const kind = modal.kind;
    // Optimistic update
    setGoals((prev) => prev.map((g) => (g.id === goal.id ? { ...g, saved: g.saved + (kind === 'withdraw' ? -amount : amount) } : g)));
    setModal(null);
    try {
      const { goal: updated } = await api.post(`/goals/${goal.id}/entries`, { amount: amount / 100, date: contribute.date, note: contribute.note, kind });
      setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
      toast('success', kind === 'withdraw' ? 'Withdrawal recorded' : 'Contribution added 🎉');
    } catch (e) {
      toast('error', e.message);
      load(true); // rollback via refresh
    }
  };

  const removeEntry = async (entry) => {
    const g = modal.goal;
    try {
      const { goal } = await api.del(`/goals/${g.id}/entries/${entry.id}`);
      setGoals((prev) => prev.map((x) => (x.id === goal.id ? goal : x)));
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      toast('success', 'Entry removed');
    } catch (e) { toast('error', e.message); }
  };

  const removeGoal = async (g) => {
    const ok = await confirm({ emoji: g.emoji, title: `Delete goal "${g.name}"?`, message: 'All contributions toward this goal will also be deleted.', confirmLabel: 'Delete goal' });
    if (!ok) return;
    setGoals((prev) => prev.filter((x) => x.id !== g.id));
    try {
      await api.del(`/goals/${g.id}`);
      toast('success', 'Goal deleted');
    } catch (e) { toast('error', e.message); load(true); }
  };

  if (loading) {
    return <div className="space-y-5"><div className="skeleton h-10 w-56" /><div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-44" />)}</div></div>;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Savings Goals"
        subtitle="Save for what matters — track every contribution"
        right={<button className="btn-primary" onClick={openCreate}><Plus className="h-4 w-4" /> New goal</button>}
      />

      {goals.length === 0 ? (
        <EmptyState
          emoji="🎯"
          title="No goals yet"
          subtitle="Dreaming of a Goa trip, a new phone, or an emergency fund? Create a goal and add money to it as you save."
          action={<button className="btn-primary" onClick={openCreate}><Plus className="h-4 w-4" /> Create your first goal</button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {goals.map((g) => {
            const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
            const done = g.saved >= g.target;
            return (
              <div key={g.id} className="card p-4">
                <div className="flex items-start gap-4">
                  <Ring pct={pct} color={g.color} emoji={g.emoji} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-bold">{g.name}</div>
                        <div className="text-xs text-slate-400">
                          {done ? '🎉 Goal reached!' : `${inr(g.target - g.saved, { decimals: 0 })} to go`}
                          {g.deadline && <span> · by {dateLabel(g.deadline)}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-0.5">
                        <button className="icon-btn h-7 w-7" onClick={() => openHistory(g)} title="History"><History className="h-3.5 w-3.5" /></button>
                        <button className="icon-btn h-7 w-7" onClick={() => openEdit(g)} title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                        <button className="icon-btn h-7 w-7 hover:text-rose-500" onClick={() => removeGoal(g)} title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                    <div className="mt-2 text-lg font-extrabold tracking-tight">
                      {inr(g.saved, { decimals: 0 })} <span className="text-sm font-semibold text-slate-400">/ {inr(g.target, { decimals: 0 })}</span>
                    </div>
                    <Progress value={pct} color={g.color} className="mt-1.5 h-2" />
                    <div className="mt-3 flex gap-2">
                      <button className="btn-primary btn-sm flex-1" onClick={() => openContribute(g, 'add')}><PlusCircle className="h-3.5 w-3.5" /> Add money</button>
                      <button className="btn-outline btn-sm flex-1" onClick={() => openContribute(g, 'withdraw')}><MinusCircle className="h-3.5 w-3.5" /> Withdraw</button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/edit goal */}
      <Modal open={modal?.mode === 'create' || modal?.mode === 'edit'} onClose={() => setModal(null)} title={modal?.mode === 'edit' ? 'Edit goal' : 'New goal'}>
        <div className="space-y-4">
          <div>
            <label className="label">Goal name</label>
            <input className="input" placeholder="e.g. Goa trip, Emergency fund, iPhone" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Target (₹)</label>
              <input className="input font-bold" type="number" min="1" placeholder="50000" value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))} />
            </div>
            <div>
              <label className="label">Deadline (optional)</label>
              <input className="input" type="date" value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} />
            </div>
          </div>
          <div className="flex items-end gap-4">
            <div><label className="label">Icon</label><EmojiPicker value={form.emoji} onChange={(emoji) => setForm((f) => ({ ...f, emoji }))} /></div>
            <div className="flex-1"><label className="label">Color</label><ColorPicker value={form.color} onChange={(color) => setForm((f) => ({ ...f, color }))} /></div>
          </div>
          <button className="btn-primary w-full py-2.5" onClick={save} disabled={busy}>{busy ? <Spinner className="h-4 w-4 text-white" /> : null}{modal?.mode === 'edit' ? 'Save changes' : 'Create goal'}</button>
        </div>
      </Modal>

      {/* Contribute / withdraw */}
      <Modal open={modal?.mode === 'contribute'} onClose={() => setModal(null)} title={`${modal?.kind === 'withdraw' ? 'Withdraw from' : 'Add money to'} "${modal?.goal?.name || ''}"`}>
        <div className="space-y-4">
          <div>
            <label className="label">Amount (₹)</label>
            <input className="input text-lg font-bold" type="number" min="1" placeholder="e.g. 2500" value={contribute.amount} onChange={(e) => setContribute((c) => ({ ...c, amount: e.target.value }))} autoFocus />
            <div className="mt-2 flex gap-2">
              {[500, 1000, 2000, 5000].map((v) => (
                <button key={v} type="button" className="chip border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" onClick={() => setContribute((c) => ({ ...c, amount: String((Number(c.amount || 0) + v)) }))}>
                  +₹{v >= 1000 ? v / 1000 + 'K' : v}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Date</label>
              <input className="input" type="date" value={contribute.date} onChange={(e) => setContribute((c) => ({ ...c, date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Note (optional)</label>
              <input className="input" placeholder="e.g. from bonus" value={contribute.note} onChange={(e) => setContribute((c) => ({ ...c, note: e.target.value }))} />
            </div>
          </div>
          <button className="btn-primary w-full py-2.5" onClick={saveContribution} disabled={busy}>
            {modal?.kind === 'withdraw' ? 'Withdraw' : 'Add money'}
          </button>
        </div>
      </Modal>

      {/* History */}
      <Modal open={modal?.mode === 'history'} onClose={() => setModal(null)} title={`"${modal?.goal?.name || ''}" — history`}>
        {entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No contributions yet.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {entries.map((e) => (
              <div key={e.id} className="group flex items-center gap-3 py-2.5">
                <span className={`flex h-8 w-8 items-center justify-center rounded-full ${e.amount >= 0 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10' : 'bg-rose-50 text-rose-600 dark:bg-rose-500/10'}`}>
                  {e.amount >= 0 ? <PlusCircle className="h-4 w-4" /> : <MinusCircle className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{e.note || (e.amount >= 0 ? 'Added' : 'Withdrawn')}</div>
                  <div className="text-[11px] text-slate-400">{dateLabel(e.date)}</div>
                </div>
                <span className={`text-sm font-bold ${e.amount >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {e.amount >= 0 ? '+' : '−'}{inr(Math.abs(e.amount), { decimals: 0 })}
                </span>
                <button className="icon-btn h-7 w-7 opacity-0 transition group-hover:opacity-100 hover:text-rose-500" onClick={() => removeEntry(e)} title="Remove entry"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

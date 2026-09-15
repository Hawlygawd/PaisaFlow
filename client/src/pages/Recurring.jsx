import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Zap, Play } from 'lucide-react';
import { api } from '../lib/api.js';
import { inr, dateLabel, todayStr, isFuture } from '../lib/format.js';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../components/Layout.jsx';
import { PageHeader, Modal, EmptyState, Spinner, Segmented } from '../components/ui.jsx';
import { Select, EmojiPicker, ColorPicker } from '../components/inputs.jsx';
import { rupeeInputToPaise, paiseToRupeeInput } from '../lib/format.js';

const FREQS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' }
];

export default function Recurring() {
  const { toast } = useApp();
  const { confirm, accounts, categories, refreshShared } = useUI();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: '', type: 'expense', amount: '', categoryId: '', accountId: '', frequency: 'monthly', startDate: todayStr(), endDate: '', note: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { items } = await api.get('/recurring');
      setItems(items);
    } catch (e) { toast('error', e.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const activeAccounts = accounts.filter((a) => !a.isArchived);

  const openCreate = () => {
    setForm({ name: '', type: 'expense', amount: '', categoryId: '', accountId: activeAccounts[0]?.id || '', frequency: 'monthly', startDate: todayStr(), endDate: '', note: '' });
    setModal({ mode: 'create' });
  };
  const openEdit = (r) => {
    setForm({
      name: r.name, type: r.type, amount: paiseToRupeeInput(r.amount),
      categoryId: r.categoryId || '', accountId: r.accountId || '',
      frequency: r.frequency, startDate: r.startDate, endDate: r.endDate || '', note: r.note || ''
    });
    setModal({ mode: 'edit', item: r });
  };

  const save = async () => {
    const amount = rupeeInputToPaise(form.amount);
    if (!form.name.trim()) { toast('warning', 'Name this recurring item'); return; }
    if (!amount) { toast('warning', 'Enter an amount'); return; }
    if (form.type === 'expense' && !form.categoryId) { toast('warning', 'Pick a category'); return; }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(), type: form.type, amount: amount / 100,
        categoryId: form.categoryId || null, accountId: form.accountId || null,
        frequency: form.frequency, startDate: form.startDate, endDate: form.endDate || null, note: form.note
      };
      if (modal.mode === 'create') await api.post('/recurring', payload);
      else await api.patch(`/recurring/${modal.item.id}`, payload);
      toast('success', modal.mode === 'create' ? 'Recurring item added — due entries post automatically' : 'Updated');
      setModal(null);
      await load(true);
      refreshShared();
    } catch (e) { toast('error', e.message); }
    finally { setBusy(false); }
  };

  const toggle = async (r) => {
    setItems((prev) => prev.map((x) => (x.id === r.id ? { ...x, active: r.active ? 0 : 1 } : x)));
    try {
      await api.patch(`/recurring/${r.id}`, { active: !r.active });
      toast('success', r.active ? 'Paused' : 'Resumed');
      load(true);
    } catch (e) { toast('error', e.message); load(true); }
  };

  const postNow = async (r) => {
    try {
      await api.post(`/recurring/${r.id}/post`, {});
      toast('success', `"${r.name}" posted for today`);
      load(true); refreshShared();
    } catch (e) { toast('error', e.message); }
  };

  const remove = async (r) => {
    const ok = await confirm({ emoji: r.categoryEmoji || '🔁', title: `Delete "${r.name}"?`, message: 'Already-posted transactions stay in your history. Future postings will stop.', confirmLabel: 'Delete' });
    if (!ok) return;
    setItems((prev) => prev.filter((x) => x.id !== r.id));
    try { await api.del(`/recurring/${r.id}`); toast('success', 'Deleted'); }
    catch (e) { toast('error', e.message); load(true); }
  };

  if (loading) {
    return <div className="space-y-5"><div className="skeleton h-10 w-56" />{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-20" />)}</div>;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Recurring"
        subtitle="Rent, EMIs, salaries, subscriptions — posted automatically on due date"
        right={<button className="btn-primary" onClick={openCreate}><Plus className="h-4 w-4" /> Add recurring</button>}
      />

      {items.length === 0 ? (
        <EmptyState
          emoji="🔁"
          title="Nothing recurring yet"
          subtitle="Add things that repeat — rent, SIPs, Netflix, salary — and PaisaFlow will post them automatically every month."
          action={<button className="btn-primary" onClick={openCreate}><Plus className="h-4 w-4" /> Add your first recurring item</button>}
        />
      ) : (
        <div className="space-y-2.5">
          {items.map((r) => {
            const overdue = r.active && r.nextDate <= todayStr();
            return (
              <div key={r.id} className={`card group flex flex-wrap items-center gap-3 p-4 ${!r.active ? 'opacity-55' : ''}`}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl" style={{ backgroundColor: (r.categoryColor || '#8b5cf6') + '1e' }}>
                  {r.categoryEmoji || (r.type === 'income' ? '💰' : '💸')}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-bold">{r.name}</span>
                    <span className="chip bg-slate-100 text-slate-500 capitalize dark:bg-slate-800 dark:text-slate-400">{r.frequency}</span>
                    {!r.active && <span className="chip bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">paused</span>}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {r.categoryName && <span>{r.categoryName} · </span>}
                    {r.accountName && <span>{r.accountEmoji} {r.accountName} · </span>}
                    {r.active ? (
                      <span className={overdue ? 'font-semibold text-amber-600 dark:text-amber-400' : ''}>
                        {overdue ? 'Posting today' : `Next: ${dateLabel(r.nextDate)}`}
                      </span>
                    ) : 'Paused'}
                  </div>
                </div>
                <span className={`shrink-0 text-sm font-extrabold ${r.type === 'income' ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {r.type === 'income' ? '+' : '−'}{inr(r.amount, { decimals: 0 })}
                </span>
                <div className="flex shrink-0 gap-0.5">
                  <button className="icon-btn h-8 w-8" onClick={() => postNow(r)} title="Post now"><Play className="h-3.5 w-3.5" /></button>
                  <button className="icon-btn h-8 w-8" onClick={() => toggle(r)} title={r.active ? 'Pause' : 'Resume'}>
                    {r.active ? <Zap className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </button>
                  <button className="icon-btn h-8 w-8" onClick={() => openEdit(r)} title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                  <button className="icon-btn h-8 w-8 hover:text-rose-500" onClick={() => remove(r)} title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.mode === 'edit' ? 'Edit recurring' : 'Add recurring'}>
        <div className="space-y-4">
          <Segmented
            options={[{ value: 'expense', label: '💸 Expense' }, { value: 'income', label: '💰 Income' }]}
            value={form.type}
            onChange={(type) => setForm((f) => ({ ...f, type }))}
          />
          <div>
            <label className="label">Name</label>
            <input className="input" placeholder="e.g. House rent, Netflix, Salary credit" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Amount (₹)</label>
              <input className="input font-bold" type="number" min="1" placeholder="5000" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className="label">Frequency</label>
              <select className="input" value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}>
                {FREQS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{form.type === 'income' ? 'Category' : 'Category'}</label>
              <Select value={form.categoryId} onChange={(v) => setForm((f) => ({ ...f, categoryId: v }))} placeholder="Select category">
                {categories.filter((c) => c.type === form.type).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
              </Select>
            </div>
            <div>
              <label className="label">Account</label>
              <Select value={form.accountId} onChange={(v) => setForm((f) => ({ ...f, accountId: v }))} placeholder="Select account">
                {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Starts on</label>
              <input className="input" type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            </div>
            <div>
              <label className="label">Ends (optional)</label>
              <input className="input" type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Note (optional)</label>
            <input className="input" placeholder="Shown on auto-posted transactions" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          </div>
          <button className="btn-primary w-full py-2.5" onClick={save} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4 text-white" /> : null}{modal?.mode === 'edit' ? 'Save changes' : 'Add recurring'}
          </button>
          <p className="text-center text-[11px] text-slate-400">Due entries are posted automatically whenever you open the app — even if a date was missed while you were away.</p>
        </div>
      </Modal>
    </div>
  );
}

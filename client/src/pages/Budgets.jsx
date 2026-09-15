import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Copy } from 'lucide-react';
import { api } from '../lib/api.js';
import { inr, thisMonth, addMonthsStr, monthLabel } from '../lib/format.js';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../components/Layout.jsx';
import { PageHeader, MonthNav, Progress, EmptyState, Modal, Spinner } from '../components/ui.jsx';
import { Select } from '../components/inputs.jsx';
import { rupeeInputToPaise, paiseToRupeeInput } from '../lib/format.js';

export default function Budgets() {
  const { toast } = useApp();
  const { confirm, categories } = useUI();
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // {mode:'create'} | {mode:'edit', budget}
  const [form, setForm] = useState({ categoryId: '', amount: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d = await api.get(`/budgets?month=${month}`);
      setData(d);
    } catch (e) { toast('error', e.message); }
    finally { setLoading(false); }
  }, [month, toast]);

  useEffect(() => { load(); }, [load]);

  const expenseCategories = categories.filter((c) => c.type === 'expense');
  const budgetedIds = new Set((data?.budgets || []).map((b) => b.categoryId));

  const openCreate = () => { setForm({ categoryId: '', amount: '' }); setModal({ mode: 'create' }); };
  const openEdit = (b) => { setForm({ categoryId: b.categoryId, amount: paiseToRupeeInput(b.amount) }); setModal({ mode: 'edit', budget: b }); };

  const save = async () => {
    const amount = rupeeInputToPaise(form.amount);
    if (!form.categoryId) { toast('warning', 'Pick a category'); return; }
    if (!amount) { toast('warning', 'Enter a budget amount'); return; }
    setBusy(true);
    try {
      await api.put('/budgets', { categoryId: form.categoryId, month, amount: amount / 100 });
      toast('success', modal.mode === 'edit' ? 'Budget updated' : 'Budget set');
      // Optimistic: update locally then quietly refresh
      if (modal.mode === 'edit') {
        setData((d) => ({ ...d, budgets: d.budgets.map((b) => (b.id === modal.budget.id ? { ...b, amount } : b)) }));
      }
      setModal(null);
      load(true);
    } catch (e) { toast('error', e.message); }
    finally { setBusy(false); }
  };

  const remove = async (b) => {
    const ok = await confirm({ emoji: b.categoryEmoji, title: `Remove ${b.categoryName} budget?`, message: `The ${monthLabel(month)} budget of ${inr(b.amount)} will be removed.`, confirmLabel: 'Remove' });
    if (!ok) return;
    // Optimistic removal
    setData((d) => ({ ...d, budgets: d.budgets.filter((x) => x.id !== b.id) }));
    try {
      await api.del(`/budgets/${b.id}`);
      toast('success', 'Budget removed');
    } catch (e) {
      toast('error', e.message);
      load(true);
    }
  };

  const copyLast = async () => {
    const from = addMonthsStr(month, -1);
    try {
      const { copied } = await api.post('/budgets/copy', { from, to: month });
      toast(copied ? 'success' : 'info', copied ? `Copied ${copied} budget(s) from ${monthLabel(from)}` : `No budgets found in ${monthLabel(from)}`);
      load(true);
    } catch (e) { toast('error', e.message); }
  };

  if (loading || !data) {
    return (
      <div className="space-y-5">
        <div className="skeleton h-10 w-64" />
        <div className="skeleton h-24" />
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-16" />)}
      </div>
    );
  }

  const totalBudget = data.budgets.reduce((s, b) => s + b.amount, 0);
  const totalSpent = data.budgets.reduce((s, b) => s + b.spent, 0);
  const overCount = data.budgets.filter((b) => b.spent > b.amount).length;
  const overallPct = totalBudget ? Math.round((totalSpent / totalBudget) * 100) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Budgets"
        subtitle="Set monthly limits per category and stay on track"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <MonthNav month={month} onChange={setMonth} />
            <button className="btn-outline" onClick={copyLast} title="Copy budgets from previous month"><Copy className="h-4 w-4" /><span className="hidden sm:inline">Copy last month</span></button>
            <button className="btn-primary" onClick={openCreate}><Plus className="h-4 w-4" /> Set budget</button>
          </div>
        }
      />

      {data.budgets.length === 0 ? (
        <EmptyState
          emoji="🎯"
          title={`No budgets for ${monthLabel(month)}`}
          subtitle="Budgets keep spending in check. Set a monthly limit for categories like Food, Shopping or Transport."
          action={
            <div className="flex gap-2">
              <button className="btn-primary" onClick={openCreate}><Plus className="h-4 w-4" /> Set your first budget</button>
              <button className="btn-outline" onClick={copyLast}><Copy className="h-4 w-4" /> Copy last month</button>
            </div>
          }
        />
      ) : (
        <>
          {/* Overall summary */}
          <div className="card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-bold">{monthLabel(month)} overview</span>
              <span className="text-slate-500 dark:text-slate-400">
                <span className="font-bold text-slate-900 dark:text-slate-100">{inr(totalSpent, { decimals: 0 })}</span> of {inr(totalBudget, { decimals: 0 })} budgeted
                {overCount > 0 && <span className="ml-2 chip bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">{overCount} over budget</span>}
              </span>
            </div>
            <Progress value={overallPct} color={overallPct >= 100 ? '#f43f5e' : overallPct >= 80 ? '#f59e0b' : '#22c55e'} className="h-2.5" />
          </div>

          <div className="space-y-2.5">
            {data.budgets.map((b) => {
              const pct = Math.round((b.spent / b.amount) * 100);
              const left = b.amount - b.spent;
              const color = pct >= 100 ? '#f43f5e' : pct >= 75 ? '#f59e0b' : b.color;
              return (
                <div key={b.id} className="card group flex items-center gap-3 p-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl" style={{ backgroundColor: b.categoryColor + '1e' }}>{b.categoryEmoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-bold">{b.categoryName}</span>
                      <span className={`shrink-0 text-xs font-bold ${left < 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                        {left < 0 ? `${inr(-left, { decimals: 0 })} over` : `${inr(left, { decimals: 0 })} left`}
                      </span>
                    </div>
                    <Progress value={pct} color={color} className="h-2" />
                    <div className="mt-1 flex justify-between text-[11px] text-slate-400">
                      <span>{inr(b.spent, { decimals: 0 })} spent</span>
                      <span>{pct}% of {inr(b.amount, { decimals: 0 })}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100">
                    <button className="icon-btn h-8 w-8" onClick={() => openEdit(b)}><Pencil className="h-3.5 w-3.5" /></button>
                    <button className="icon-btn h-8 w-8 hover:text-rose-500" onClick={() => remove(b)}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.mode === 'edit' ? `Edit budget · ${modal.budget.categoryName}` : `Set budget · ${monthLabel(month)}`}>
        <div className="space-y-4">
          {modal?.mode === 'create' ? (
            <div>
              <label className="label">Category</label>
              <Select value={form.categoryId} onChange={setCategoryIdSafe(setForm)} placeholder="Choose an expense category">
                {expenseCategories.filter((c) => !budgetedIds.has(c.id)).map((c) => (
                  <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                ))}
              </Select>
            </div>
          ) : null}
          <div>
            <label className="label">Monthly limit (₹)</label>
            <input className="input text-lg font-bold" type="number" min="1" step="1" placeholder="e.g. 8000" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} autoFocus />
            <div className="mt-2 flex gap-2">
              {[2000, 5000, 10000, 20000].map((v) => (
                <button key={v} type="button" className="chip border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" onClick={() => setForm((f) => ({ ...f, amount: String((Number(f.amount || 0) + v)) }))}>
                  +₹{v >= 1000 ? v / 1000 + 'K' : v}
                </button>
              ))}
            </div>
          </div>
          <button className="btn-primary w-full py-2.5" onClick={save} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4 text-white" /> : null}{modal?.mode === 'edit' ? 'Save budget' : 'Set budget'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function setCategoryIdSafe(setForm) {
  return (v) => setForm((f) => ({ ...f, categoryId: v }));
}

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Archive, ArchiveRestore, ArrowRightLeft } from 'lucide-react';
import { api } from '../lib/api.js';
import { inr } from '../lib/format.js';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../components/Layout.jsx';
import { Modal, PageHeader, EmptyState, Spinner, SkeletonCards } from '../components/ui.jsx';
import { EmojiPicker, ColorPicker } from '../components/inputs.jsx';

const TYPES = [
  { value: 'cash', label: 'Cash', emoji: '💵' },
  { value: 'bank', label: 'Bank a/c', emoji: '🏦' },
  { value: 'upi', label: 'UPI', emoji: '📱' },
  { value: 'card', label: 'Credit card', emoji: '💳' },
  { value: 'wallet', label: 'Wallet', emoji: '👛' },
  { value: 'other', label: 'Other', emoji: '🏧' }
];

export default function Accounts() {
  const { toast } = useApp();
  const { openTxn, refreshShared } = useUI();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | {mode:'create'} | {mode:'edit', account}
  const [form, setForm] = useState({ name: '', type: 'bank', emoji: '🏦', color: '#6366f1', initialBalance: '' });
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    try {
      const { accounts } = await api.get('/accounts');
      setAccounts(accounts);
    } catch (e) { toast('error', e.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm({ name: '', type: 'bank', emoji: '🏦', color: '#6366f1', initialBalance: '' }); setModal({ mode: 'create' }); };
  const openEdit = (a) => {
    setForm({ name: a.name, type: a.type, emoji: a.emoji, color: a.color, initialBalance: a.initialBalance ? String(a.initialBalance / 100) : '' });
    setModal({ mode: 'edit', account: a });
  };

  const setType = (t) => {
    const def = TYPES.find((x) => x.value === t);
    setForm((f) => ({ ...f, type: t, emoji: def ? def.emoji : f.emoji }));
  };

  const save = async () => {
    if (!form.name.trim()) { toast('warning', 'Give the account a name'); return; }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(), type: form.type, emoji: form.emoji, color: form.color,
        initialBalance: form.initialBalance === '' ? 0 : Number(form.initialBalance)
      };
      if (modal.mode === 'create') await api.post('/accounts', payload);
      else await api.patch(`/accounts/${modal.account.id}`, payload);
      toast('success', modal.mode === 'create' ? 'Account added' : 'Account updated');
      setModal(null);
      await load();
      refreshShared();
    } catch (e) { toast('error', e.message); }
    finally { setBusy(false); }
  };

  const toggleArchive = async (a) => {
    try {
      await api.patch(`/accounts/${a.id}`, { isArchived: !a.isArchived });
      toast('success', a.isArchived ? 'Account restored' : 'Account archived');
      await load(); refreshShared();
    } catch (e) { toast('error', e.message); }
  };

  const remove = async (a) => {
    try {
      await api.del(`/accounts/${a.id}`);
      toast('success', 'Account deleted');
      await load(); refreshShared();
    } catch (e) { toast('error', e.message); }
  };

  const visible = accounts.filter((a) => (showArchived ? a.isArchived : !a.isArchived));
  const netWorth = accounts.filter((a) => !a.isArchived).reduce((s, a) => s + a.balance, 0);

  if (loading) return <div className="space-y-5"><SkeletonCards cards={4} /><SkeletonCards cards={4} /></div>;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Accounts"
        subtitle={`Net worth across active accounts: ${inr(netWorth, { decimals: 0 })}`}
        right={
          <div className="flex gap-2">
            {accounts.some((a) => a.isArchived) && (
              <button className="btn-outline" onClick={() => setShowArchived((s) => !s)}>
                {showArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                {showArchived ? 'Show active' : 'Archived'}
              </button>
            )}
            <button className="btn-primary" onClick={openCreate}><Plus className="h-4 w-4" /> Add account</button>
          </div>
        }
      />

      {visible.length === 0 ? (
        showArchived ? (
          <EmptyState emoji="🗄️" title="No archived accounts" subtitle="Archived accounts will appear here." action={<button className="btn-outline" onClick={() => setShowArchived(false)}>View active</button>} />
        ) : (
          <EmptyState emoji="🏦" title="No accounts yet" subtitle="Add your bank account, UPI, cash wallet or credit card to start tracking balances." action={<button className="btn-primary" onClick={openCreate}><Plus className="h-4 w-4" /> Add your first account</button>} />
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((a) => (
            <div key={a.id} className={`card group relative p-4 ${a.isArchived ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl text-2xl" style={{ backgroundColor: a.color + '1e' }}>{a.emoji}</span>
                  <div>
                    <div className="font-bold">{a.name}</div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      {TYPES.find((t) => t.value === a.type)?.label || a.type}
                      {a.isArchived ? ' · archived' : ''}
                    </div>
                  </div>
                </div>
                <div className="flex gap-0.5 opacity-0 transition group-hover:opacity-100">
                  <button className="icon-btn h-8 w-8" onClick={() => openEdit(a)} title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                  {!a.isArchived && a.txnCount === 0 && (
                    <button className="icon-btn h-8 w-8 hover:text-rose-500" onClick={() => remove(a)} title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                  )}
                  {a.txnCount > 0 && (
                    <button className="icon-btn h-8 w-8" onClick={() => toggleArchive(a)} title="Archive"><Archive className="h-3.5 w-3.5" /></button>
                  )}
                  {a.isArchived && (
                    <button className="icon-btn h-8 w-8" onClick={() => toggleArchive(a)} title="Restore"><ArchiveRestore className="h-3.5 w-3.5" /></button>
                  )}
                </div>
              </div>
              <div className={`mt-4 text-2xl font-extrabold tracking-tight ${a.balance < 0 ? 'text-rose-500' : ''}`}>{inr(a.balance, { decimals: 0 })}</div>
              <div className="mt-1 text-[11px] text-slate-400">{a.txnCount} transaction{a.txnCount !== 1 ? 's' : ''}{a.initialBalance ? ` · opening ${inr(a.initialBalance, { decimals: 0 })}` : ''}</div>
              {!a.isArchived && (
                <button
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-1.5 text-xs font-semibold text-slate-500 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700"
                  onClick={() => openTxn({ type: 'transfer', handlers: { onSaved: () => load() } })}
                >
                  <ArrowRightLeft className="h-3.5 w-3.5" /> Transfer money
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create / edit modal */}
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.mode === 'edit' ? 'Edit account' : 'Add account'}>
        <div className="space-y-4">
          <div>
            <label className="label">Account type</label>
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map((t) => (
                <button key={t.value} type="button" onClick={() => setType(t.value)}
                  className={`flex flex-col items-center gap-1 rounded-xl border p-2.5 text-xs font-semibold transition ${form.type === t.value ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/15' : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'}`}>
                  <span className="text-lg">{t.emoji}</span>{t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Name</label>
            <input className="input" placeholder="e.g. HDFC Salary, PhonePe, Cash wallet" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="flex items-end gap-4">
            <div>
              <label className="label">Icon</label>
              <EmojiPicker value={form.emoji} onChange={(emoji) => setForm((f) => ({ ...f, emoji }))} />
            </div>
            <div className="flex-1">
              <label className="label">Color</label>
              <ColorPicker value={form.color} onChange={(color) => setForm((f) => ({ ...f, color }))} />
            </div>
          </div>
          <div>
            <label className="label">Opening balance (₹)</label>
            <input className="input" type="number" step="0.01" placeholder="0" value={form.initialBalance} onChange={(e) => setForm((f) => ({ ...f, initialBalance: e.target.value }))} />
            <p className="mt-1 text-[11px] text-slate-400">Current balance = opening + income − expenses ± transfers. Credit cards go negative as you spend.</p>
          </div>
          <button className="btn-primary w-full py-2.5" onClick={save} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4 text-white" /> : null}{modal?.mode === 'edit' ? 'Save changes' : 'Add account'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

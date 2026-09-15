import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Trash2 } from 'lucide-react';
import { Modal, Spinner } from './ui.jsx';
import { AmountInput, CategoryPicker, TagInput, Select } from './inputs.jsx';
import { api } from '../lib/api.js';
import { todayStr } from '../lib/format.js';

export default function TransactionModal({
  open, onClose, txn = null, defaultType = 'expense',
  accounts, categories, tags = [],
  onOptimistic, onSaved, onError
}) {
  const isEdit = Boolean(txn);
  const [type, setType] = useState(defaultType);
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(todayStr());
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [note, setNote] = useState('');
  const [txnTags, setTxnTags] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const activeAccounts = useMemo(() => accounts.filter((a) => !a.isArchived), [accounts]);

  useEffect(() => {
    if (!open) return;
    setError('');
    setConfirmDelete(false);
    if (txn) {
      setType(txn.type);
      setAmount(txn.amount);
      setDate(txn.date);
      setCategoryId(txn.categoryId || '');
      setAccountId(txn.accountId || '');
      setToAccountId(txn.toAccountId || '');
      setNote(txn.note || '');
      try { setTxnTags(JSON.parse(txn.tags || '[]')); } catch { setTxnTags([]); }
    } else {
      setType(defaultType);
      setAmount(0);
      setDate(todayStr());
      setCategoryId('');
      setAccountId(activeAccounts[0]?.id || '');
      setToAccountId(activeAccounts[1]?.id || activeAccounts[0]?.id || '');
      setNote('');
      setTxnTags([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, txn]);

  const numIds = () => ({
    catId: type === 'transfer' || !categoryId ? null : Number(categoryId),
    acctId: accountId ? Number(accountId) : null,
    toAcctId: type === 'transfer' && toAccountId ? Number(toAccountId) : null
  });

  const buildDraft = () => {
    const { catId, acctId, toAcctId } = numIds();
    const cat = categories.find((c) => c.id === catId);
    const acct = accounts.find((a) => a.id === acctId);
    const toAcct = accounts.find((a) => a.id === toAcctId);
    return {
      id: txn?.id || 'tmp-' + Date.now(),
      type, amount, date,
      categoryId: catId,
      accountId: acctId,
      toAccountId: toAcctId,
      note,
      tags: JSON.stringify(txnTags),
      category_name: cat?.name || (type === 'transfer' ? 'Transfer' : 'Uncategorized'),
      category_emoji: cat?.emoji || (type === 'transfer' ? '🔁' : '📦'),
      category_color: cat?.color || '#94a3b8',
      account_name: acct?.name || '',
      account_emoji: acct?.emoji || '💳',
      to_account_name: toAcct?.name || '',
      pending: true
    };
  };

  const validate = () => {
    if (!amount) return 'Enter an amount';
    if (type === 'transfer' && (!accountId || !toAccountId)) return 'Pick both accounts for a transfer';
    if (type === 'transfer' && accountId === toAccountId) return 'From and To accounts must be different';
    if (type !== 'transfer' && !categoryId) return 'Pick a category';
    if (!date) return 'Pick a date';
    return '';
  };

  const save = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    const draft = buildDraft();
    onOptimistic && onOptimistic(draft, isEdit ? 'update' : 'create');
    setSaving(true);
    setError('');
    const { catId, acctId, toAcctId } = numIds();
    const payload = {
      type, amount, date,
      categoryId: catId,
      accountId: acctId,
      toAccountId: toAcctId,
      note, tags: txnTags
    };
    try {
      const res = isEdit
        ? await api.patch(`/transactions/${txn.id}`, payload)
        : await api.post('/transactions', payload);
      onSaved && onSaved(res.transaction, isEdit ? 'update' : 'create');
      onClose();
    } catch (e) {
      onError && onError(draft.id, isEdit ? 'update' : 'create', txn);
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!txn) return;
    const draft = buildDraft();
    onOptimistic && onOptimistic(draft, 'delete');
    setSaving(true);
    try {
      await api.del(`/transactions/${txn.id}`);
      onSaved && onSaved(txn, 'delete');
      onClose();
    } catch (e) {
      onError && onError(draft.id, 'delete', txn);
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const types = [
    { value: 'expense', label: '💸 Expense' },
    { value: 'income', label: '💰 Income' },
    { value: 'transfer', label: '🔁 Transfer' }
  ];

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit transaction' : 'Add transaction'}>
      <div className="space-y-4">
        {/* Type */}
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {types.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => { setType(t.value); setError(''); }}
              className={`rounded-lg px-2 py-2 text-xs font-bold transition sm:text-sm ${
                type === t.value ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <AmountInput value={amount} onChange={(v) => { setAmount(v); setError(''); }} />

        {type !== 'transfer' && (
          <div>
            <label className="label">Category</label>
            <CategoryPicker
              categories={categories}
              type={type}
              value={categoryId}
              onChange={(id) => { setCategoryId(id); setError(''); }}
              onCreate={() => {}}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">{type === 'transfer' ? 'From account' : 'Account'}</label>
            <Select value={accountId} onChange={setAccountId} placeholder="Select account">
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
              ))}
            </Select>
          </div>
          {type === 'transfer' ? (
            <div>
              <label className="label">To account</label>
              <Select value={toAccountId} onChange={setToAccountId} placeholder="Select account">
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
                ))}
              </Select>
            </div>
          ) : (
            <div>
              <label className="label">Date</label>
              <input type="date" className="input" value={date} max={type === 'expense' || type === 'income' ? undefined : undefined} onChange={(e) => setDate(e.target.value)} />
            </div>
          )}
        </div>

        {type === 'transfer' && (
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        )}

        <div>
          <label className="label">Note</label>
          <input className="input" placeholder={type === 'transfer' ? 'e.g. To savings' : 'e.g. Lunch at office'} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </div>

        {type !== 'transfer' && (
          <div>
            <label className="label">Tags</label>
            <TagInput value={txnTags} onChange={setTxnTags} suggestions={tags} />
          </div>
        )}

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          {isEdit ? (
            confirmDelete ? (
              <div className="flex flex-1 items-center gap-2">
                <button className="btn-danger btn-sm flex-1" onClick={remove} disabled={saving}>Yes, delete</button>
                <button className="btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>No</button>
              </div>
            ) : (
              <>
                <button className="btn-outline text-rose-600 dark:text-rose-400" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-4 w-4" />
                </button>
                <button className="btn-primary flex-1" onClick={save} disabled={saving}>
                  {saving ? <Spinner className="h-4 w-4 text-white" /> : null} Save changes
                </button>
              </>
            )
          ) : (
            <button className="btn-primary w-full py-2.5" onClick={save} disabled={saving}>
              {saving ? <><Spinner className="h-4 w-4 text-white" /> Saving…</> : `Add ${type === 'income' ? 'income' : type === 'transfer' ? 'transfer' : 'expense'}`}
            </button>
          )}
        </div>

        {type === 'transfer' && (
          <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400">
            <ArrowRightLeft className="h-3 w-3" /> Transfers move money between your accounts — they don't affect income or expense totals.
          </p>
        )}
      </div>
    </Modal>
  );
}

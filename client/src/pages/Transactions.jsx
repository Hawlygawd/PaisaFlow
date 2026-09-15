import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, ArrowUpRight, ArrowDownRight, ArrowRightLeft, Filter, X, Pencil } from 'lucide-react';
import { api } from '../lib/api.js';
import { inr, dateLabel, thisMonth, addMonthsStr } from '../lib/format.js';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../components/Layout.jsx';
import { MonthNav, EmptyState, SkeletonRows, Segmented } from '../components/ui.jsx';
import { Select } from '../components/inputs.jsx';

const PAGE_SIZE = 40;

export default function Transactions() {
  const { toast } = useApp();
  const { openTxn, accounts, categories, tags, refreshShared } = useUI();

  const [month, setMonth] = useState(thisMonth());
  const [isAll, setIsAll] = useState(false);
  const [type, setType] = useState('all');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [tag, setTag] = useState('');
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [sort, setSort] = useState('date_desc');
  const [items, setItems] = useState([]);
  const [totals, setTotals] = useState({ income: 0, expense: 0, net: 0 });
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const originalsRef = useRef({}); // id → original item for rollback

  const load = useCallback(async (pageNum = 1, append = false) => {
    setLoading(!append);
    try {
      const params = new URLSearchParams({ page: pageNum, limit: PAGE_SIZE, sort });
      if (!isAll) params.set('month', month);
      if (type !== 'all') params.set('type', type);
      if (categoryId) params.set('categoryId', categoryId);
      if (accountId) params.set('accountId', accountId);
      if (tag) params.set('tag', tag);
      if (q) params.set('q', q);
      const data = await api.get('/transactions?' + params);
      setItems((prev) => (append ? [...prev, ...data.items] : data.items));
      setTotals(data.totals);
      setPage(data.page);
      setPages(data.pages);
      setTotal(data.total);
    } catch (e) {
      toast('error', e.message);
    } finally {
      setLoading(false);
    }
  }, [month, isAll, type, categoryId, accountId, tag, q, sort, toast]);

  useEffect(() => { load(1); }, [load]);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 350);
    return () => clearTimeout(t);
  }, [qInput]);

  // ---- optimistic handlers (passed to the global modal) ----
  const onOptimistic = (draft, action) => {
    if (action === 'create') {
      setItems((prev) => [draft, ...prev]);
      setTotal((t) => t + 1);
    } else if (action === 'update') {
      setItems((prev) => prev.map((it) => {
        if (it.id === draft.id) { originalsRef.current[draft.id] = it; return { ...it, ...draft }; }
        return it;
      }));
    } else if (action === 'delete') {
      setItems((prev) => {
        const orig = prev.find((it) => it.id === draft.id);
        if (orig) originalsRef.current[draft.id] = orig;
        return prev.filter((it) => it.id !== draft.id);
      });
      setTotal((t) => Math.max(0, t - 1));
    }
  };
  const onSaved = (txn, action) => {
    if (action === 'create') {
      setItems((prev) => prev.map((it) => (it.id === txn.id ? txn : String(it.id).startsWith('tmp-') && it.pending ? txn : it)));
      toast('success', 'Transaction added');
      refreshShared();
    } else if (action === 'update') {
      setItems((prev) => prev.map((it) => (it.id === txn.id ? txn : it)));
      toast('success', 'Transaction updated');
    } else {
      toast('success', 'Transaction deleted');
    }
    delete originalsRef.current[txn.id];
    // Quiet background refresh keeps totals exact
    load(page > 0 ? 1 : 1, true).catch(() => {});
  };
  const onError = (draftId, action, original) => {
    if (action === 'create') setItems((prev) => prev.filter((it) => it.id !== draftId));
    else if (original) setItems((prev) => prev.map((it) => (it.id === original.id ? original : it)));
    delete originalsRef.current[draftId];
  };

  const handlers = { onOptimistic, onSaved, onError };

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map();
    for (const t of items) {
      if (!map.has(t.date)) map.set(t.date, []);
      map.get(t.date).push(t);
    }
    return [...map.entries()].sort((a, b) => (sort === 'date_asc' ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0])));
  }, [items, sort]);

  const clearFilters = () => {
    setType('all'); setCategoryId(''); setAccountId(''); setTag(''); setQ(''); setQInput('');
  };
  const hasFilters = type !== 'all' || categoryId || accountId || tag || q;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">Transactions</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{total} transaction{total !== 1 ? 's' : ''} · Income {inr(totals.income, { decimals: 0 })} · Expense {inr(totals.expense, { decimals: 0 })}</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthNav
            month={month} isAll={isAll} allowAll
            maxMonth={thisMonth()}
            onChange={(m) => { setMonth(m); setIsAll(false); }}
            onAll={() => { if (isAll) { setIsAll(false); } else { setIsAll(true); } }}
          />
          <button className="btn-primary btn-sm !rounded-full" onClick={() => openTxn({ handlers })}>
            <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Add</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search notes & tags…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
        <Select value={type === 'all' ? '' : type} onChange={(v) => setType(v || 'all')}>
          <option value="">All types</option>
          <option value="expense">Expenses</option>
          <option value="income">Income</option>
          <option value="transfer">Transfers</option>
        </Select>
        <Select value={categoryId} onChange={setCategoryId} placeholder="All categories">
          {categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
        </Select>
        <Select value={accountId} onChange={setAccountId} placeholder="All accounts">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
        </Select>
        {tags.length > 0 && (
          <select className="input w-auto cursor-pointer" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">All tags</option>
            {tags.map((t) => <option key={t} value={t}>#{t}</option>)}
          </select>
        )}
        <select className="input w-auto cursor-pointer" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="date_desc">Newest first</option>
          <option value="date_asc">Oldest first</option>
          <option value="amount_desc">Largest amount</option>
          <option value="amount_asc">Smallest amount</option>
        </select>
        {hasFilters && (
          <button className="btn-ghost btn-sm" onClick={clearFilters}><X className="h-3.5 w-3.5" /> Clear</button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <SkeletonRows rows={6} />
      ) : items.length === 0 ? (
        hasFilters ? (
          <EmptyState emoji="🔍" title="No matching transactions" subtitle="Try adjusting or clearing your filters." action={<button className="btn-outline" onClick={clearFilters}>Clear filters</button>} />
        ) : (
          <EmptyState
            emoji="🧾"
            title={isAll ? 'No transactions yet' : 'Nothing recorded this month'}
            subtitle="Every journey starts with one entry. Add your first transaction and watch your history build up."
            action={<button className="btn-primary" onClick={() => openTxn({ handlers })}><Plus className="h-4 w-4" /> Add transaction</button>}
          />
        )
      ) : (
        <div className="space-y-4">
          {grouped.map(([date, txns]) => {
            const dayExp = txns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
            const dayInc = txns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
            return (
              <div key={date}>
                <div className="mb-1.5 flex items-center justify-between px-1">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{dateLabel(date)}</span>
                  <span className="text-[11px] font-medium text-slate-400">
                    {dayInc > 0 && <span className="text-emerald-600">+{inr(dayInc, { decimals: 0 })}</span>}
                    {dayInc > 0 && dayExp > 0 && ' · '}
                    {dayExp > 0 && <span className="text-rose-500">−{inr(dayExp, { decimals: 0 })}</span>}
                  </span>
                </div>
                <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
                  {txns.map((t) => (
                    <button
                      key={t.id}
                      className={`group flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50 ${t.pending ? 'opacity-60' : ''}`}
                      onClick={() => !String(t.id).startsWith('tmp-') && openTxn({ txn: t, handlers })}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg" style={{ backgroundColor: (t.categoryColor || '#6366f1') + '1e' }}>
                        {t.type === 'transfer' ? <ArrowRightLeft className="h-4 w-4 text-indigo-500" /> : t.categoryEmoji || '📦'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold">{t.note || (t.type === 'transfer' ? 'Transfer' : t.categoryName)}</span>
                          {t.source === 'recurring' && <span className="chip bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">auto</span>}
                          {t.source === 'import' && <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">import</span>}
                        </div>
                        <div className="flex items-center gap-1.5 truncate text-[11px] text-slate-400">
                          <span>{t.type === 'transfer' ? `${t.accountEmoji || ''} ${t.accountName || ''} → ${t.toAccountName || ''}` : t.categoryName}</span>
                          {t.accountName && t.type !== 'transfer' && <span>· {t.accountEmoji} {t.accountName}</span>}
                          {(() => { try { const tg = JSON.parse(t.tags || '[]'); return tg.length ? <span className="text-indigo-400">· {tg.map((x) => '#' + x).join(' ')}</span> : null; } catch { return null; } })()}
                        </div>
                      </div>
                      <span className={`flex shrink-0 items-center gap-0.5 text-sm font-bold ${t.type === 'income' ? 'text-emerald-600' : t.type === 'expense' ? 'text-rose-500' : 'text-indigo-500'}`}>
                        {t.type === 'income' ? <ArrowDownRight className="h-3.5 w-3.5" /> : t.type === 'expense' ? <ArrowUpRight className="h-3.5 w-3.5" /> : null}
                        {t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}{inr(t.amount, { decimals: t.amount % 100 === 0 ? 0 : 2 })}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {page < pages && (
            <div className="flex justify-center pt-1">
              <button className="btn-outline" onClick={() => load(page + 1, true)}>Load more ({total - items.length} remaining)</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

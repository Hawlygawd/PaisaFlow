import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  PieChart, Pie, Cell, CartesianGrid
} from 'recharts';
import { Download, Upload, ArrowUpRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { inr, inrCompact, thisMonth, monthLabel, monthLabelShort, dateLabel } from '../lib/format.js';
import { useApp } from '../context/AppContext.jsx';
import { PageHeader, MonthNav, Segmented, EmptyState, Spinner } from '../components/ui.jsx';

function Tip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
      {label && <div className="font-semibold text-slate-500 dark:text-slate-400">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="mt-0.5 flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color || p.fill }} />
          <span className="text-slate-500 dark:text-slate-400">{p.name}:</span>
          <span className="font-bold">{inr(p.value, { decimals: 0 })}</span>
        </div>
      ))}
    </div>
  );
}

export default function Insights() {
  const { toast } = useApp();
  const [mode, setMode] = useState('month'); // month | year
  const [month, setMonth] = useState(thisMonth());
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [mData, setMData] = useState(null);
  const [yData, setYData] = useState(null);
  const [trend, setTrend] = useState(null);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t] = await Promise.all([api.get('/reports/trend?months=12')]);
      setTrend(t.trend);
      if (mode === 'month') setMData(await api.get(`/reports/month?month=${month}`));
      else setYData(await api.get(`/reports/year?year=${year}`));
    } catch (e) { toast('error', e.message); }
    finally { setLoading(false); }
  }, [mode, month, year, toast]);

  useEffect(() => { load(); }, [load]);

  const doImport = async (text) => {
    setImporting(true);
    try {
      const res = await api.postRaw('/data/import', text);
      toast('success', `Imported ${res.imported} transaction(s)${res.skipped ? `, skipped ${res.skipped}` : ''}`);
      setImportOpen(false);
      load();
    } catch (e) { toast('error', e.message); }
    finally { setImporting(false); }
  };

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => doImport(String(reader.result));
    reader.readAsText(f);
    e.target.value = '';
  };

  const d = mode === 'month' ? mData : yData;
  const years = (() => { const y = new Date().getFullYear(); return [y, y - 1, y - 2, y - 3]; })();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Insights"
        subtitle="Where your money goes — trends, splits and patterns"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented options={[{ value: 'month', label: 'Monthly' }, { value: 'year', label: 'Yearly' }]} value={mode} onChange={setMode} />
            {mode === 'month' ? (
              <MonthNav month={month} onChange={setMonth} maxMonth={thisMonth()} />
            ) : (
              <select className="input w-auto" value={year} onChange={(e) => setYear(e.target.value)}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            )}
          </div>
        }
      />

      {/* Export / Import */}
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="text-sm font-bold">Your data, yours</div>
          <p className="text-xs text-slate-400">Export everything to CSV, or import from a bank statement / any CSV with Date & Amount columns.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={() => api.download('/data/export.csv')}><Download className="h-4 w-4" /> Export CSV</button>
          <button className="btn-outline" onClick={() => setImportOpen((o) => !o)}><Upload className="h-4 w-4" /> Import CSV</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
        </div>
      </div>
      {importOpen && (
        <div className="card space-y-3 p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Choose a CSV file. Expected columns: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">Date, Type, Amount, Category, Account, Note, Tags</code> (only Date & Amount are required).
            Income/expense types are detected automatically; unknown categories are created for you.
          </p>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? <Spinner className="h-4 w-4 text-white" /> : null} Choose CSV file
            </button>
            <button className="btn-ghost" onClick={() => setImportOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading || !d ? (
        <div className="space-y-4">
          <div className="skeleton h-24" />
          <div className="grid gap-4 lg:grid-cols-2"><div className="skeleton h-80" /><div className="skeleton h-80" /></div>
        </div>
      ) : (
        <>
          {/* Headline stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="card p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Income</div>
              <div className="mt-1 text-lg font-extrabold text-emerald-600">{inr(d.totals.income, { decimals: 0 })}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Expenses</div>
              <div className="mt-1 text-lg font-extrabold text-rose-500">{inr(d.totals.expense, { decimals: 0 })}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Net savings</div>
              <div className={`mt-1 text-lg font-extrabold ${d.totals.net >= 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-rose-500'}`}>{inr(d.totals.net, { decimals: 0 })}</div>
            </div>
          </div>

          {/* 12-month trend (always shown) */}
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-bold">Income vs Expense · last 12 months</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trend} margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
                <XAxis dataKey="month" tickFormatter={monthLabelShort} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={1} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={inrCompact} width={54} />
                <Tooltip content={<Tip />} cursor={{ fill: 'rgba(99,102,241,.05)' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="income" name="Income" fill="#22c55e" radius={[5, 5, 0, 0]} maxBarSize={18} />
                <Bar dataKey="expense" name="Expense" fill="#f43f5e" radius={[5, 5, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {d.totals.count === 0 ? (
            <EmptyState emoji="📊" title={`No data for ${mode === 'month' ? monthLabel(d.month) : d.year}`} subtitle="Record a few transactions and your insights will appear here automatically." />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Category split */}
              <div className="card p-4">
                <h3 className="mb-3 text-sm font-bold">Expense by category</h3>
                {d.byCategory.length ? (
                  <>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={d.byCategory} dataKey="total" nameKey="name" innerRadius={52} outerRadius={84} paddingAngle={3} strokeWidth={0}>
                          {d.byCategory.map((c, i) => <Cell key={i} fill={c.color} />)}
                        </Pie>
                        <Tooltip content={<Tip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="mt-3 space-y-2">
                      {d.byCategory.slice(0, 6).map((c) => {
                        const pct = d.totals.expense ? Math.round((c.total / d.totals.expense) * 100) : 0;
                        return (
                          <div key={c.name} className="flex items-center gap-2 text-xs">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                            <span className="flex-1 truncate">{c.emoji} {c.name}</span>
                            <span className="font-bold">{inr(c.total, { decimals: 0 })}</span>
                            <span className="w-9 text-right text-slate-400">{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : <p className="py-14 text-center text-sm text-slate-400">No expenses in this period.</p>}
              </div>

              {/* Account split */}
              <div className="card p-4">
                <h3 className="mb-3 text-sm font-bold">Expense by account</h3>
                {d.byAccount.length ? (
                  <div className="space-y-3 pt-2">
                    {d.byAccount.map((a) => {
                      const pct = d.totals.expense ? Math.round((a.total / d.totals.expense) * 100) : 0;
                      return (
                        <div key={a.name}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="font-medium">{a.emoji} {a.name}</span>
                            <span className="font-bold">{inr(a.total, { decimals: 0 })} <span className="font-normal text-slate-400">({pct}%)</span></span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: a.color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="py-14 text-center text-sm text-slate-400">No expenses in this period.</p>}
              </div>

              {/* Top transactions (month mode only) */}
              {mode === 'month' && d.topTransactions?.length > 0 && (
                <div className="card p-4 lg:col-span-2">
                  <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold"><ArrowUpRight className="h-4 w-4 text-rose-500" /> Biggest expenses this month</h3>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {d.topTransactions.map((t) => (
                      <div key={t.id} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                        <span className="text-xl">{t.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{t.note || t.category}</div>
                          <div className="text-[11px] text-slate-400">{t.category} · {dateLabel(t.date)}</div>
                        </div>
                        <span className="text-sm font-extrabold text-rose-500">{inr(t.amount, { decimals: 0 })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Monthly bars for year mode */}
              {mode === 'year' && (
                <div className="card p-4 lg:col-span-2">
                  <h3 className="mb-3 text-sm font-bold">Month-wise breakdown · {d.year}</h3>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={d.monthly} margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
                      <XAxis dataKey="month" tickFormatter={monthLabelShort} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={inrCompact} width={54} />
                      <Tooltip content={<Tip />} cursor={{ fill: 'rgba(99,102,241,.05)' }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="income" name="Income" fill="#22c55e" radius={[5, 5, 0, 0]} maxBarSize={20} />
                      <Bar dataKey="expense" name="Expense" fill="#f43f5e" radius={[5, 5, 0, 0]} maxBarSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

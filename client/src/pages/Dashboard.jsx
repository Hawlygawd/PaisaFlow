import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, CartesianGrid
} from 'recharts';
import { TrendingUp, TrendingDown, Wallet, Scale, ArrowUpRight, ArrowDownRight, ArrowRightLeft, Plus, Target, Repeat, PiggyBank } from 'lucide-react';
import { api } from '../lib/api.js';
import { inr, inrCompact, thisMonth, monthLabel, dateLabel, pctChange } from '../lib/format.js';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../components/Layout.jsx';
import { MonthNav, Progress, SkeletonCards, SkeletonRows, EmptyState } from '../components/ui.jsx';

function ChartTooltip({ active, payload, label, name = 'Spent' }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
      <div className="font-semibold text-slate-500 dark:text-slate-400">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="mt-0.5 font-bold" style={{ color: p.color || p.fill }}>
          {name}: {inr(p.value)}
        </div>
      ))}
    </div>
  );
}

function StatCard({ title, value, sub, icon: Icon, tone = 'indigo', delta }) {
  const tones = {
    indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  };
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="h-4 w-4" /></span>
      </div>
      <div className="mt-2 text-xl font-extrabold tracking-tight sm:text-2xl">{value}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium">
        {delta !== undefined && delta !== 0 && (
          <span className={`chip ${delta > 0 ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'}`}>
            {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(delta)}% vs last month
          </span>
        )}
        {sub && <span className="text-slate-400">{sub}</span>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, toast } = useApp();
  const { openTxn } = useUI();
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d = await api.get(`/dashboard?month=${month}`);
      setData(d);
    } catch (e) {
      toast('error', e.message);
    } finally {
      setLoading(false);
    }
  }, [month, toast]);

  useEffect(() => { load(); }, [load]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (loading) {
    return (
      <div className="space-y-5">
        <SkeletonCards />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="skeleton h-72 lg:col-span-2" />
          <div className="skeleton h-72" />
        </div>
        <SkeletonRows rows={4} />
      </div>
    );
  }

  const d = data;
  const expenseDelta = pctChange(d.totals.expense, d.prevTotals.expense);
  const dailyData = d.daily.map((x) => ({ day: Number(x.date.slice(8)), Spent: x.total }));
  const hasActivity = d.totals.income > 0 || d.totals.expense > 0;

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">{greeting}, {String(user?.name || '').split(' ')[0]} 👋</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Here's your money flow for {monthLabel(d.month)}.</p>
        </div>
        <MonthNav month={month} onChange={setMonth} maxMonth={thisMonth()} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Income" value={inr(d.totals.income, { decimals: 0 })} icon={TrendingUp} tone="emerald" />
        <StatCard title="Expenses" value={inr(d.totals.expense, { decimals: 0 })} icon={TrendingDown} tone="rose" delta={d.prevTotals.expense ? expenseDelta : undefined} />
        <StatCard
          title="Net flow"
          value={inr(d.totals.net, { decimals: 0 })}
          icon={Scale}
          tone={d.totals.net >= 0 ? 'indigo' : 'rose'}
          sub={d.totals.net >= 0 ? 'You saved this month 🎉' : 'Spent more than earned'}
        />
        <StatCard title="Total balance" value={inr(d.balance, { decimals: 0 })} icon={Wallet} tone="slate" sub="across all accounts" />
      </div>

      {!hasActivity ? (
        <EmptyState
          emoji="🌱"
          title="Let's track your first rupee"
          subtitle="Add an expense or income to see your dashboard come alive — charts, budgets and insights will build up automatically."
          action={<button className="btn-primary" onClick={() => openTxn({ handlers: { onSaved: () => load(true) } })}><Plus className="h-4 w-4" /> Add transaction</button>}
        />
      ) : (
        <>
          {/* Charts */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card p-4 lg:col-span-2">
              <h3 className="mb-1 text-sm font-bold">Daily spending</h3>
              <p className="mb-3 text-xs text-slate-400">{monthLabel(d.month)}</p>
              {dailyData.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={dailyData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200 dark:text-slate-800" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={inrCompact} width={54} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(99,102,241,.06)' }} />
                    <Bar dataKey="Spent" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={26} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-16 text-center text-sm text-slate-400">No spending recorded this month.</p>
              )}
            </div>

            <div className="card p-4">
              <h3 className="mb-3 text-sm font-bold">Spending by category</h3>
              {d.byCategory.length ? (
                <>
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie data={d.byCategory} dataKey="total" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={3} strokeWidth={0}>
                        {d.byCategory.map((c, i) => <Cell key={i} fill={c.color} />)}
                      </Pie>
                      <Tooltip content={<ChartTooltip name="Total" />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-2 space-y-1.5">
                    {d.byCategory.slice(0, 4).map((c) => (
                      <div key={c.name} className="flex items-center gap-2 text-xs">
                        <span>{c.emoji}</span>
                        <span className="flex-1 truncate text-slate-500 dark:text-slate-400">{c.name}</span>
                        <span className="font-bold">{inr(c.total, { decimals: 0 })}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="py-16 text-center text-sm text-slate-400">No expenses yet this month.</p>
              )}
            </div>
          </div>

          {/* Budgets + Goals + Upcoming */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-bold"><PiggyBank className="h-4 w-4 text-indigo-500" /> Budgets</h3>
                <Link to="/budgets" className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">View all</Link>
              </div>
              {d.budgets.length ? (
                <div className="space-y-3">
                  {d.budgets.map((b) => {
                    const pct = Math.round((b.spent / b.amount) * 100);
                    return (
                      <div key={b.id}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 font-medium">{b.categoryEmoji} {b.categoryName}</span>
                          <span className={pct >= 100 ? 'font-bold text-rose-500' : 'text-slate-400'}>{pct}%</span>
                        </div>
                        <Progress value={pct} color={pct >= 100 ? '#f43f5e' : pct >= 75 ? '#f59e0b' : '#6366f1'} className="h-1.5" />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-6 text-center">
                  <p className="text-xs text-slate-400">No budgets set for {monthLabel(d.month)}.</p>
                  <Link to="/budgets" className="btn-outline btn-sm mt-3">Set a budget</Link>
                </div>
              )}
            </div>

            <div className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-bold"><Target className="h-4 w-4 text-emerald-500" /> Goals</h3>
                <Link to="/goals" className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">View all</Link>
              </div>
              {d.goals.length ? (
                <div className="space-y-3">
                  {d.goals.map((g) => {
                    const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
                    return (
                      <div key={g.id} className="flex items-center gap-3">
                        <span className="text-xl">{g.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between text-xs">
                            <span className="truncate font-medium">{g.name}</span>
                            <span className="font-bold">{pct}%</span>
                          </div>
                          <Progress value={pct} color={g.color} className="mt-1 h-1.5" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-6 text-center">
                  <p className="text-xs text-slate-400">No savings goals yet.</p>
                  <Link to="/goals" className="btn-outline btn-sm mt-3">Create a goal</Link>
                </div>
              )}
            </div>

            <div className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-bold"><Repeat className="h-4 w-4 text-violet-500" /> Upcoming recurring</h3>
                <Link to="/recurring" className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">Manage</Link>
              </div>
              {d.upcoming.length ? (
                <div className="space-y-2.5">
                  {d.upcoming.map((r) => (
                    <div key={r.id} className="flex items-center gap-2.5 text-xs">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-sm dark:bg-slate-800">{r.categoryEmoji || (r.type === 'income' ? '💰' : '💸')}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{r.name}</div>
                        <div className="text-[11px] text-slate-400">{dateLabel(r.nextDate)} · {r.frequency}</div>
                      </div>
                      <span className={`font-bold ${r.type === 'income' ? 'text-emerald-600' : 'text-rose-500'}`}>
                        {r.type === 'income' ? '+' : '−'}{inr(r.amount, { decimals: 0 })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center">
                  <p className="text-xs text-slate-400">Nothing scheduled soon.</p>
                  <Link to="/recurring" className="btn-outline btn-sm mt-3">Add recurring</Link>
                </div>
              )}
            </div>
          </div>

          {/* Accounts strip */}
          <div className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
            {d.accounts.filter((a) => !a.isArchived).map((a) => (
              <div key={a.id} className="card flex min-w-[11rem] flex-1 items-center gap-3 p-3.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl text-lg" style={{ backgroundColor: a.color + '22' }}>{a.emoji}</span>
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{a.name}</div>
                  <div className={`text-sm font-extrabold ${a.balance < 0 ? 'text-rose-500' : ''}`}>{inr(a.balance, { decimals: 0 })}</div>
                </div>
              </div>
            ))}
            <Link to="/accounts" className="card flex min-w-[8rem] items-center justify-center gap-1.5 p-3.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10">
              <Plus className="h-4 w-4" /> Add account
            </Link>
          </div>

          {/* Recent transactions */}
          <div className="card">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <h3 className="text-sm font-bold">Recent transactions</h3>
              <Link to="/transactions" className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">See all →</Link>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {d.recent.map((t) => (
                <button
                  key={t.id}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  onClick={() => openTxn({ txn: t, handlers: { onSaved: () => load(true) } })}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg" style={{ backgroundColor: (t.categoryColor || '#6366f1') + '1e' }}>
                    {t.type === 'transfer' ? <ArrowRightLeft className="h-4 w-4 text-indigo-500" /> : t.categoryEmoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{t.note || (t.type === 'transfer' ? `Transfer` : t.categoryName)}</div>
                    <div className="truncate text-[11px] text-slate-400">
                      {t.categoryName} · {dateLabel(t.date)}{t.accountName ? ` · ${t.accountEmoji} ${t.accountName}` : ''}
                    </div>
                  </div>
                  <span className={`flex items-center gap-0.5 text-sm font-bold ${t.type === 'income' ? 'text-emerald-600' : t.type === 'expense' ? 'text-rose-500' : 'text-indigo-500'}`}>
                    {t.type === 'income' ? <ArrowDownRight className="h-3.5 w-3.5" /> : t.type === 'expense' ? <ArrowUpRight className="h-3.5 w-3.5" /> : null}
                    {t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}{inr(t.amount, { decimals: t.amount % 100 === 0 ? 0 : 2 })}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ArrowLeftRight, Wallet, PiggyBank, Target, Repeat, Landmark,
  BarChart3, Shapes, Settings as SettingsIcon, Menu, X, Sun, Moon, LogOut, Plus, QrCode
} from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { Avatar, ConfirmDialog } from './ui.jsx';
import TransactionModal from './TransactionModal.jsx';
import { api } from '../lib/api.js';

const UIContext = createContext(null);
export const useUI = () => useContext(UIContext);

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/requests', label: 'Request Money', icon: QrCode },
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/budgets', label: 'Budgets', icon: PiggyBank },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/recurring', label: 'Recurring', icon: Repeat },
  { to: '/loans', label: 'Loans & EMIs', icon: Landmark },
  { to: '/insights', label: 'Insights', icon: BarChart3 },
  { to: '/categories', label: 'Categories', icon: Shapes },
  { to: '/settings', label: 'Settings', icon: SettingsIcon }
];

export default function Layout() {
  const { user, logout, theme, toggleTheme } = useApp();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();

  // Shared data for the global transaction modal
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [txnModal, setTxnModal] = useState({ open: false, txn: null, type: 'expense', handlers: {} });
  const [confirmState, setConfirmState] = useState(null);
  const [userMenu, setUserMenu] = useState(false);

  const loadShared = useCallback(async () => {
    try {
      const [a, c, t] = await Promise.all([
        api.get('/accounts'), api.get('/categories'), api.get('/transactions/tags')
      ]);
      setAccounts(a.accounts);
      setCategories(c.categories);
      setTags(t.tags);
    } catch { /* handled elsewhere */ }
  }, []);

  useEffect(() => { loadShared(); }, [loadShared, location.pathname]);
  useEffect(() => { setDrawer(false); setUserMenu(false); }, [location.pathname]);

  const openTxn = useCallback((opts = {}) => {
    setTxnModal({ open: true, txn: opts.txn || null, type: opts.type || 'expense', handlers: opts.handlers || {} });
  }, []);
  const closeTxn = useCallback(() => setTxnModal((m) => ({ ...m, open: false })), []);

  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      setConfirmState({ ...opts, resolve });
    });
  }, []);
  const resolveConfirm = (val) => {
    setConfirmState((s) => { s && s.resolve(val); return null; });
  };

  const ui = useMemo(() => ({
    openTxn, confirm,
    accounts, categories, tags,
    refreshShared: loadShared
  }), [openTxn, confirm, accounts, categories, tags, loadShared]);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-xl shadow-lg shadow-indigo-600/30">💸</div>
        <div>
          <div className="text-base font-extrabold tracking-tight">PaisaFlow</div>
          <div className="-mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-indigo-500">your money, sorted</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}>
            <Icon className="h-[18px] w-[18px]" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-100 p-3 dark:border-slate-800">
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
          <Avatar name={user?.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{user?.name}</div>
            <div className="truncate text-[11px] text-slate-400">{user?.email}</div>
          </div>
        </div>
        <button className="nav-item w-full text-rose-600 hover:bg-rose-50 hover:text-rose-600 dark:text-rose-400 dark:hover:bg-rose-500/10" onClick={logout}>
          <LogOut className="h-[18px] w-[18px]" /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <UIContext.Provider value={ui}>
      <div className="min-h-screen">
        {/* Desktop sidebar */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:block">
          {sidebar}
        </aside>

        {/* Mobile drawer */}
        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 animate-fade-in bg-slate-950/50" onClick={() => setDrawer(false)} />
            <aside className="absolute inset-y-0 left-0 w-72 animate-slide-up border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <button className="icon-btn absolute right-2 top-4" onClick={() => setDrawer(false)}><X className="h-5 w-5" /></button>
              {sidebar}
            </aside>
          </div>
        )}

        {/* Main column */}
        <div className="lg:pl-64">
          {/* Topbar */}
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
            <button className="icon-btn lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
            <div className="flex items-center gap-2 lg:hidden">
              <span className="text-lg">💸</span>
              <span className="text-sm font-extrabold">PaisaFlow</span>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">
                {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
              </button>
              <button className="btn-primary btn-sm !rounded-full px-3.5" onClick={() => openTxn({})}>
                <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Add</span>
              </button>
              <div className="relative ml-1 lg:hidden">
                <button onClick={() => setUserMenu((m) => !m)}><Avatar name={user?.name} /></button>
                {userMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setUserMenu(false)} />
                    <div className="absolute right-0 top-11 z-20 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                      <div className="px-2.5 py-1.5 text-xs font-semibold text-slate-400">{user?.email}</div>
                      <button className="nav-item w-full text-rose-600" onClick={logout}><LogOut className="h-4 w-4" /> Sign out</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-6xl px-4 py-5 pb-24 sm:px-6 sm:py-6">
            <Outlet />
          </main>
        </div>

        {/* Mobile FAB */}
        <button
          className="fixed bottom-5 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-xl shadow-indigo-600/40 transition hover:bg-indigo-500 active:scale-95 sm:hidden"
          onClick={() => openTxn({})}
          aria-label="Add transaction"
        >
          <Plus className="h-6 w-6" />
        </button>

        {/* Global transaction modal */}
        <TransactionModal
          open={txnModal.open}
          onClose={closeTxn}
          txn={txnModal.txn}
          defaultType={txnModal.type}
          accounts={accounts}
          categories={categories}
          tags={tags}
          {...txnModal.handlers}
        />

        {/* Global confirm dialog */}
        <ConfirmDialog
          state={confirmState}
          onCancel={() => resolveConfirm(false)}
          onConfirm={() => resolveConfirm(true)}
        />
      </div>
    </UIContext.Provider>
  );
}

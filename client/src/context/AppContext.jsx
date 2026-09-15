import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, initApi, getMode, setToken } from '../lib/api.js';
import { startSmsCapture } from '../lib/smsCapture.js';
import { CheckCircle2, XCircle, Info, AlertTriangle, Smartphone, X } from 'lucide-react';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

const TOAST_ICONS = {
  success: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  error: <XCircle className="h-4 w-4 text-rose-500" />,
  info: <Info className="h-4 w-4 text-indigo-500" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  sms: <Smartphone className="h-4 w-4 text-emerald-500" />
};

const RELOCK_DELAY_MS = 30000; // re-lock when the app was backgrounded for 30s+

export function AppProvider({ children }) {
  // ---------- mode (server vs fully-offline local) ----------
  const [mode, setMode] = useState(() => getMode());

  // ---------- auth ----------
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  // ---------- PIN lock (local mode only) ----------
  const [locked, setLocked] = useState(false);
  const hiddenAtRef = useRef(0);
  const pinEnabledRef = useRef(false);

  const refreshUser = useCallback(async () => {
    try {
      const { user } = await api.get('/auth/me');
      setUser(user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const m = await initApi();
      if (!alive) return;
      setMode(m);
      // In local mode there is no login — the profile is created/loaded on-device
      // automatically. Server mode restores any existing session.
      if (m === 'local') {
        pinEnabledRef.current = hasPin();
        if (pinEnabledRef.current) setLocked(true);
      }
      await refreshUser().catch(() => {});
      if (alive) setInitializing(false);
    })();
    const onUnauthorized = () => setUser(null);
    window.addEventListener('pf:unauthorized', onUnauthorized);
    return () => {
      alive = false;
      window.removeEventListener('pf:unauthorized', onUnauthorized);
    };
  }, [refreshUser]);

  // Lock again after the app was in the background for a while (local + PIN set)
  useEffect(() => {
    const onVis = () => {
      if (!pinEnabledRef.current || !getMode || getMode() !== 'local') return;
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
      } else if (hiddenAtRef.current && Date.now() - hiddenAtRef.current > RELOCK_DELAY_MS) {
        hiddenAtRef.current = 0;
        setLocked(true);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const pinChanged = useCallback((enabled) => {
    pinEnabledRef.current = enabled;
    if (!enabled) setLocked(false);
  }, []);
  const lockNow = useCallback(() => setLocked(true), []);

  const login = useCallback(async (email, password) => {
    const { user, token } = await api.post('/auth/login', { email, password });
    setToken(token);
    setUser(user);
    return user;
  }, []);

  const register = useCallback(async (name, email, password) => {
    const { user, token } = await api.post('/auth/register', { name, email, password });
    setToken(token);
    setUser(user);
    return user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout', {}); } catch { /* ignore */ }
    setToken(null);
    setUser(null);
  }, []);

  // ---------- SMS auto-capture (local/Android only) ----------
  useEffect(() => {
    if (mode !== 'local' || initializing) return;
    startSmsCapture(({ type, amount, account }) => {
      const rupees = (amount / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
      window.dispatchEvent(new CustomEvent('pf:sms-captured', {
        detail: { type, amount, account }
      }));
      // Toast via a tiny synthetic event the provider listens for (defined below)
    });
  }, [mode, initializing]);

  useEffect(() => {
    const onSms = (e) => toast('sms', e.detail.type === 'income'
      ? `Auto-captured credit: ₹${(e.detail.amount / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}${e.detail.account ? ' → ' + e.detail.account : ''}`
      : `Auto-captured expense: ₹${(e.detail.amount / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}${e.detail.account ? ' · ' + e.detail.account : ''}`);
    window.addEventListener('pf:sms-captured', onSms);
    return () => window.removeEventListener('pf:sms-captured', onSms);
  }, []);

  // ---------- theme ----------
  const [theme, setTheme] = useState(() => localStorage.getItem('pf_theme') || 'light');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('pf_theme', theme);
  }, [theme]);
  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  // ---------- toasts ----------
  const [toasts, setToasts] = useState([]);
  const timerRef = useRef({});
  const dismissToast = useCallback((id) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    clearTimeout(timerRef.current[id]);
  }, []);
  const toast = useCallback((type, msg) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((ts) => [...ts.slice(-3), { id, type, msg }]);
    timerRef.current[id] = setTimeout(() => dismissToast(id), 3800);
  }, [dismissToast]);

  const value = useMemo(
    () => ({ user, setUser, initializing, login, register, logout, refreshUser, theme, toggleTheme, toast, mode, locked, setLocked, pinChanged, lockNow }),
    [user, initializing, login, register, logout, refreshUser, theme, toggleTheme, toast, mode, locked, pinChanged, lockNow]
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      {/* Toast container */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex w-full max-w-sm animate-slide-up items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800"
          >
            {TOAST_ICONS[t.type] || TOAST_ICONS.info}
            <span className="flex-1">{t.msg}</span>
            <button onClick={() => dismissToast(t.id)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

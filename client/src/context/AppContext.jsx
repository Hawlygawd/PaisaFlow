import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, setToken } from '../lib/api.js';
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

const TOAST_ICONS = {
  success: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  error: <XCircle className="h-4 w-4 text-rose-500" />,
  info: <Info className="h-4 w-4 text-indigo-500" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-500" />
};

export function AppProvider({ children }) {
  // ---------- auth ----------
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const { user } = await api.get('/auth/me');
      setUser(user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setInitializing(false));
    const onUnauthorized = () => setUser(null);
    window.addEventListener('pf:unauthorized', onUnauthorized);
    return () => window.removeEventListener('pf:unauthorized', onUnauthorized);
  }, [refreshUser]);

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
    () => ({ user, setUser, initializing, login, register, logout, refreshUser, theme, toggleTheme, toast }),
    [user, initializing, login, register, logout, refreshUser, theme, toggleTheme, toast]
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

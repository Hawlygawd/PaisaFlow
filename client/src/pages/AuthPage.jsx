import React, { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { Spinner } from '../components/ui.jsx';
import { Eye, EyeOff, Wallet, Target, Repeat, PieChart } from 'lucide-react';

const FEATURES = [
  { icon: Wallet, text: 'Track spending across cash, bank, UPI & cards' },
  { icon: PieChart, text: 'Monthly budgets, insights & reports in ₹' },
  { icon: Target, text: 'Savings goals with progress rings' },
  { icon: Repeat, text: 'Auto-post rent, EMIs & subscriptions' }
];

export default function AuthPage() {
  const { login, register } = useApp();
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(name, email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Left brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-indigo-700 p-12 text-white lg:flex">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-indigo-500/40 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-violet-500/30 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-2xl backdrop-blur">💸</div>
          <div>
            <div className="text-xl font-extrabold">PaisaFlow</div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-indigo-200">your money, sorted</div>
          </div>
        </div>
        <div className="relative">
          <h1 className="text-4xl font-extrabold leading-tight">
            Har rupaye ka<br />hisaab. <span className="text-indigo-200">₹</span>
          </h1>
          <p className="mt-3 max-w-sm text-indigo-100">
            The complete personal finance tracker built for India — expenses, budgets, goals, EMIs and insights, all in one place.
          </p>
          <ul className="mt-8 space-y-3.5">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-indigo-100">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 backdrop-blur"><Icon className="h-5 w-5" /></span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative text-xs text-indigo-300">100% free · Your data stays on your device/server · No ads, ever</div>
      </div>

      {/* Right form panel */}
      <div className="flex w-full items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-xl shadow-lg shadow-indigo-600/30">💸</div>
            <div>
              <div className="text-lg font-extrabold">PaisaFlow</div>
              <div className="-mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-indigo-500">your money, sorted</div>
            </div>
          </div>

          <h2 className="text-2xl font-extrabold tracking-tight">{mode === 'login' ? 'Welcome back 👋' : 'Create your account'}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {mode === 'login' ? 'Sign in to see where your money went.' : 'Free forever. Takes 10 seconds.'}
          </p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            {mode === 'register' && (
              <div>
                <label className="label">Full name</label>
                <input className="input" placeholder="e.g. Priya Sharma" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
            )}
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showPw ? 'text' : 'password'}
                  placeholder={mode === 'register' ? 'Min 6 characters' : 'Your password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                />
                <button type="button" className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600" onClick={() => setShowPw((s) => !s)}>
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">{error}</p>}

            <button className="btn-primary w-full py-2.5" disabled={busy}>
              {busy ? <><Spinner className="h-4 w-4 text-white" /> Please wait…</> : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {mode === 'login' ? "New to PaisaFlow? " : 'Already have an account? '}
            <button
              className="font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
            >
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>

        </div>
      </div>
    </div>
  );
}

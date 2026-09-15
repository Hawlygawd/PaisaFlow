import React, { useEffect, useRef, useState } from 'react';
import {
  Sun, Moon, Download, Upload, Trash2, LogOut, UserRound, Lock, ShieldCheck,
  Smartphone, RefreshCw, CheckCircle2, XCircle
} from 'lucide-react';
import { api, isLocal, hasPin } from '../lib/api.js';
import { autoSmsEnabled, setAutoSmsEnabled, smsPermissions, requestSmsPermissions, startSmsCapture } from '../lib/smsCapture.js';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../components/Layout.jsx';
import { PageHeader, Spinner } from '../components/ui.jsx';
import { PinSetupModal } from '../components/LockScreen.jsx';

function Toggle({ on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 rounded-full transition ${on ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}`}
      aria-label="Toggle"
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
    </button>
  );
}

export default function Settings() {
  const { user, setUser, theme, toggleTheme, logout, toast, mode, pinChanged, lockNow } = useApp();
  const { confirm } = useUI();
  const [name, setName] = useState(user?.name || '');
  const [upiId, setUpiId] = useState(user?.upiId || '');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);
  const localMode = mode === 'local' || isLocal();

  // PIN lock (local mode)
  const [pinOn, setPinOn] = useState(hasPin());
  const [pinModal, setPinModal] = useState(null); // 'enable' | 'disable'

  // SMS auto-capture (Android)
  const [smsOn, setSmsOn] = useState(autoSmsEnabled());
  const [smsPerm, setSmsPerm] = useState(null); // 'granted' | 'denied' | 'prompt' | 'unsupported'
  useEffect(() => { smsPermissions().then((r) => setSmsPerm(r && r.sms)); }, []);

  useEffect(() => {
    setName(user?.name || '');
    setUpiId(user?.upiId || '');
  }, [user]);

  const saveProfile = async () => {
    if (!name.trim()) return;
    setBusy('name');
    try {
      const { user } = await api.patch('/auth/me', { name: name.trim(), upiId });
      setUser(user);
      toast('success', 'Profile updated');
    } catch (e) { toast('error', e.message); }
    finally { setBusy(''); }
  };

  const savePassword = async () => {
    if (pw.next !== pw.confirm) { toast('warning', 'New passwords do not match'); return; }
    setBusy('pw');
    try {
      await api.post('/auth/password', { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      toast('success', 'Password changed');
    } catch (e) { toast('error', e.message); }
    finally { setBusy(''); }
  };

  const onPinClosed = (changed) => {
    setPinModal(null);
    if (!changed) return;
    const nowOn = hasPin();
    setPinOn(nowOn);
    pinChanged(nowOn);
    toast('success', nowOn ? 'PIN lock is on 🔒' : 'PIN lock turned off');
  };

  const toggleSms = async (on) => {
    if (on) {
      const perm = await requestSmsPermissions();
      setSmsPerm(perm && perm.sms);
      if (!perm || perm.sms !== 'granted') {
        setSmsOn(false);
        setAutoSmsEnabled(false);
        toast('warning', 'SMS permission is required for auto-capture');
        return;
      }
      setAutoSmsEnabled(true);
      setSmsOn(true);
      startSmsCapture();
      toast('success', 'Auto-capture on — payments will be logged from bank SMS 📲');
    } else {
      setAutoSmsEnabled(false);
      setSmsOn(false);
      toast('info', 'Auto-capture off');
    }
  };

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await api.postRaw('/data/import', String(reader.result));
        toast('success', `Imported ${res.imported} transaction(s)`);
      } catch (err) { toast('error', err.message); }
    };
    reader.readAsText(f);
    e.target.value = '';
  };

  const wipeDeviceData = async () => {
    const ok = await confirm({
      emoji: '🗑️',
      title: 'Erase all data on this phone?',
      message: 'This permanently deletes EVERYTHING stored in the app on this device — transactions, accounts, budgets, goals, loans. Export a CSV backup first. There is no undo.',
      confirmLabel: 'Erase everything'
    });
    if (!ok) return;
    await api.del('/data/account');
    window.location.reload();
  };

  const deleteAccount = async () => {
    const ok = await confirm({
      emoji: '🗑️',
      title: 'Delete your account?',
      message: 'This permanently deletes your account and ALL data — transactions, budgets, goals, loans. There is no undo. Export a CSV backup first if needed.',
      confirmLabel: 'Delete everything'
    });
    if (!ok) return;
    try {
      await api.del('/data/account');
      toast('info', 'Account deleted. Take care! 👋');
      logout();
    } catch (e) { toast('error', e.message); }
  };

  const permBadge = (state) => {
    if (state === 'granted') return <span className="chip bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" /> permission granted</span>;
    if (state === 'denied') return <span className="chip bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400"><XCircle className="h-3 w-3" /> permission denied</span>;
    if (state === 'unsupported') return <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">web — Android app only</span>;
    return <span className="chip bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">permission needed</span>;
  };

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader
        title="Settings"
        subtitle={localMode ? 'Profile, security, auto-capture and your data — all on this device' : 'Profile, appearance and your data'}
      />

      {/* Profile */}
      <div className="card p-5">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-bold"><UserRound className="h-4 w-4 text-indigo-500" /> Profile</h3>
        <div className="space-y-3">
          <div>
            <label className="label">Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">UPI ID (VPA) — used in your Request Money QR codes</label>
            <input className="input" placeholder="e.g. 9876543210@ybl or yourname@okhdfcbank" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
          </div>
          {!localMode && (
            <div>
              <label className="label">Email</label>
              <input className="input opacity-60" value={user?.email} disabled />
            </div>
          )}
          <button className="btn-primary" onClick={saveProfile} disabled={busy === 'name' || (name.trim() === user?.name && upiId === (user?.upiId || ''))}>
            {busy === 'name' ? <Spinner className="h-4 w-4 text-white" /> : 'Save profile'}
          </button>
        </div>
      </div>

      {/* Security */}
      {localMode ? (
        <div className="card p-5">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-bold"><Lock className="h-4 w-4 text-violet-500" /> App lock (PIN)</h3>
          <p className="mb-3 text-xs text-slate-400">Ask for a 4-digit PIN when the app opens or returns from the background. Your data stays unlocked otherwise.</p>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">PIN lock {pinOn ? '· on' : '· off'}</div>
              <div className="text-xs text-slate-400">{pinOn ? 'App asks for your PIN on open' : 'Anyone holding this phone can open the app'}</div>
            </div>
            <div className="flex items-center gap-2">
              {pinOn && <button className="btn-outline btn-sm" onClick={lockNow}>Lock now</button>}
              <Toggle on={pinOn} onChange={(v) => setPinModal(v ? 'enable' : 'disable')} />
            </div>
          </div>
        </div>
      ) : (
        <div className="card p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-bold">🔒 Change password</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label">Current</label>
              <input className="input" type="password" value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} autoComplete="current-password" />
            </div>
            <div>
              <label className="label">New</label>
              <input className="input" type="password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} autoComplete="new-password" />
            </div>
            <div>
              <label className="label">Confirm new</label>
              <input className="input" type="password" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} autoComplete="new-password" />
            </div>
          </div>
          <button className="btn-primary mt-3" onClick={savePassword} disabled={busy === 'pw' || !pw.current || !pw.next || !pw.confirm}>
            {busy === 'pw' ? <Spinner className="h-4 w-4 text-white" /> : null} Update password
          </button>
        </div>
      )}

      {/* SMS auto-capture */}
      {localMode && (
        <div className="card p-5">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-bold"><Smartphone className="h-4 w-4 text-emerald-500" /> Auto-capture payments</h3>
          <p className="mb-3 text-xs text-slate-400">
            Every UPI / card / netbanking payment triggers an SMS from your bank. With this on, PaisaFlow reads
            <b> transaction SMS only</b> (never OTPs or personal messages) and logs them automatically — offline and free, works with every bank &amp; payment app.
          </p>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold">Auto-capture {smsOn ? '· on' : '· off'} {permBadge(smsPerm)}</div>
              <div className="text-xs text-slate-400">Works while PaisaFlow is running (open or in recents). Captured entries are tagged “auto”.</div>
            </div>
            <Toggle on={smsOn} onChange={toggleSms} />
          </div>
          {smsOn && (
            <button
              className="btn-outline btn-sm mt-3"
              onClick={async () => {
                const perm = await requestSmsPermissions();
                setSmsPerm(perm && perm.sms);
                if (perm && perm.sms === 'granted') startSmsCapture();
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Re-check permission
            </button>
          )}
        </div>
      )}

      {/* Appearance */}
      <div className="card p-5">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-bold">{theme === 'dark' ? <Moon className="h-4 w-4 text-indigo-500" /> : <Sun className="h-4 w-4 text-amber-500" />} Appearance</h3>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Dark mode</div>
            <div className="text-xs text-slate-400">Easier on the eyes at night</div>
          </div>
          <Toggle on={theme === 'dark'} onChange={toggleTheme} />
        </div>
      </div>

      {/* Data */}
      <div className="card p-5">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-bold"><Download className="h-4 w-4 text-emerald-500" /> Your data</h3>
        <div className="flex flex-wrap gap-2">
          <button className="btn-outline" onClick={() => api.download('/data/export.csv')}><Download className="h-4 w-4" /> Export all transactions (CSV)</button>
          <button className="btn-outline" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Import CSV</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          {localMode
            ? 'Your data lives only inside this app on your phone — it works offline and nothing is sent to any server. Export a CSV regularly as a backup.'
            : 'Your data lives in a single SQLite file on the server — nothing is sent to third parties, ever.'}
        </p>
      </div>

      {/* Danger zone */}
      <div className="card border-rose-200 p-5 dark:border-rose-500/30">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-rose-600 dark:text-rose-400"><Trash2 className="h-4 w-4" /> Danger zone</h3>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          {localMode
            ? 'Permanently erase everything stored in the app on this phone. This cannot be undone.'
            : 'Permanently delete your account and all data. This cannot be undone.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {!localMode && <button className="btn-outline" onClick={logout}><LogOut className="h-4 w-4" /> Sign out</button>}
          {localMode
            ? <button className="btn-danger" onClick={wipeDeviceData}><Trash2 className="h-4 w-4" /> Erase all data</button>
            : <button className="btn-danger" onClick={deleteAccount}><Trash2 className="h-4 w-4" /> Delete account</button>}
        </div>
      </div>

      <p className="flex items-center justify-center gap-1.5 pb-4 text-center text-[11px] text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5" /> PaisaFlow v1.2 · Made with ❤️ for India · All amounts in ₹ (INR)
      </p>

      {pinModal && <PinSetupModal mode={pinModal} onClose={onPinClosed} />}
    </div>
  );
}

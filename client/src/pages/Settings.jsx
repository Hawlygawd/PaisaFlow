import React, { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Download, Upload, Trash2, LogOut, UserRound, Mail, Smartphone, Send } from 'lucide-react';
import { api, getServerUrl, setServerUrl } from '../lib/api.js';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../components/Layout.jsx';
import { PageHeader, Spinner } from '../components/ui.jsx';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

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
  const { user, setUser, theme, toggleTheme, logout, toast } = useApp();
  const { confirm } = useUI();
  const [name, setName] = useState(user?.name || '');
  const [upiId, setUpiId] = useState(user?.upiId || '');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);

  // digest settings
  const [dg, setDg] = useState(null);
  const [dgBusy, setDgBusy] = useState('');
  // server url
  const [serverUrl, setServerUrlState] = useState(getServerUrl());

  useEffect(() => {
    api.get('/settings').then(({ settings }) => setDg({
      digest_enabled: settings.digest_enabled === '1',
      digest_to: settings.digest_to || '',
      digest_day: settings.digest_day ?? '1',
      digest_hour: settings.digest_hour ?? '9',
      smtp_host: settings.smtp_host || '',
      smtp_port: settings.smtp_port || '587',
      smtp_secure: settings.smtp_secure === '1',
      smtp_user: settings.smtp_user || '',
      smtp_pass: settings.smtp_pass || ''
    })).catch(() => setDg({}));
  }, []);

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

  const saveDigest = async () => {
    setDgBusy('save');
    try {
      await api.put('/settings', {
        digest_enabled: dg.digest_enabled ? '1' : '0',
        digest_to: dg.digest_to,
        digest_day: String(dg.digest_day),
        digest_hour: String(dg.digest_hour),
        smtp_host: dg.smtp_host.trim(),
        smtp_port: String(dg.smtp_port),
        smtp_secure: dg.smtp_secure ? '1' : '0',
        smtp_user: dg.smtp_user.trim(),
        smtp_pass: dg.smtp_pass
      });
      toast('success', 'Digest settings saved');
    } catch (e) { toast('error', e.message); }
    finally { setDgBusy(''); }
  };

  const sendTest = async () => {
    setDgBusy('test');
    try {
      const res = await api.post('/settings/send-test', {});
      toast('success', `Test email sent to ${res.to} 📬`);
    } catch (e) { toast('error', e.message); }
    finally { setDgBusy(''); }
  };

  const saveServerUrl = () => {
    setServerUrl(serverUrl.trim());
    toast('success', serverUrl.trim() ? 'Server URL saved' : 'Using this device (relative mode)');
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

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader title="Settings" subtitle="Profile, digest emails, appearance and your data" />

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
          <div>
            <label className="label">Email</label>
            <input className="input opacity-60" value={user?.email} disabled />
          </div>
          <button className="btn-primary" onClick={saveProfile} disabled={busy === 'name' || (name.trim() === user?.name && upiId === (user?.upiId || ''))}>
            {busy === 'name' ? <Spinner className="h-4 w-4 text-white" /> : 'Save profile'}
          </button>
        </div>
      </div>

      {/* Weekly digest */}
      <div className="card p-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-bold"><Mail className="h-4 w-4 text-emerald-500" /> Weekly Email Digest</h3>
        <p className="mb-4 text-xs text-slate-400">Get a summary of income, expenses, budgets, goals & upcoming EMIs in your inbox every week.</p>
        {dg === null ? (
          <div className="skeleton h-32" />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Enable weekly digest</div>
                <div className="text-xs text-slate-400">Sent on {DAYS[Number(dg.digest_day) || 0]} at {String(dg.digest_hour).padStart(2, '0')}:00 (server time)</div>
              </div>
              <Toggle on={dg.digest_enabled} onChange={(v) => setDg((d) => ({ ...d, digest_enabled: v }))} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label">Send to email</label>
                <input className="input" type="email" placeholder={user?.email} value={dg.digest_to} onChange={(e) => setDg((d) => ({ ...d, digest_to: e.target.value }))} />
              </div>
              <div>
                <label className="label">Day</label>
                <select className="input" value={String(dg.digest_day)} onChange={(e) => setDg((d) => ({ ...d, digest_day: e.target.value }))}>
                  {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Time (hour)</label>
                <select className="input" value={String(dg.digest_hour)} onChange={(e) => setDg((d) => ({ ...d, digest_hour: e.target.value }))}>
                  {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </select>
              </div>
            </div>
            <div className="rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-700">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">SMTP (sending account)</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Host</label>
                  <input className="input" placeholder="smtp.gmail.com" value={dg.smtp_host} onChange={(e) => setDg((d) => ({ ...d, smtp_host: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Port</label>
                  <input className="input" type="number" value={dg.smtp_port} onChange={(e) => setDg((d) => ({ ...d, smtp_port: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Username (email)</label>
                  <input className="input" placeholder="you@gmail.com" value={dg.smtp_user} onChange={(e) => setDg((d) => ({ ...d, smtp_user: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Password / App password</label>
                  <input className="input" type="password" value={dg.smtp_pass} onChange={(e) => setDg((d) => ({ ...d, smtp_pass: e.target.value }))} />
                </div>
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" checked={dg.smtp_secure} onChange={(e) => setDg((d) => ({ ...d, smtp_secure: e.target.checked }))} className="rounded" />
                Use SSL (port 465)
              </label>
              <p className="mt-2 text-[11px] text-slate-400">
                💡 <b>Gmail (free):</b> turn on 2-Step Verification, create an <i>App Password</i> at myaccount.google.com/apppasswords, then use host <code>smtp.gmail.com</code>, port <code>587</code>, your email + that app password.
              </p>
            </div>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={saveDigest} disabled={dgBusy === 'save'}>
                {dgBusy === 'save' ? <Spinner className="h-4 w-4 text-white" /> : null} Save digest settings
              </button>
              <button className="btn-outline" onClick={sendTest} disabled={dgBusy === 'test'}>
                {dgBusy === 'test' ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />} Send test email
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mobile app / server URL */}
      <div className="card p-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-bold"><Smartphone className="h-4 w-4 text-violet-500" /> Mobile app (APK)</h3>
        <p className="mb-3 text-xs text-slate-400">
          Running the Android APK? Point it at your PaisaFlow server (e.g. your Render/Railway/VPS URL). Leave empty when using the website directly.
        </p>
        <div className="flex gap-2">
          <input className="input" placeholder="https://your-paisaflow-server.onrender.com" value={serverUrl} onChange={(e) => setServerUrlState(e.target.value)} />
          <button className="btn-primary shrink-0" onClick={saveServerUrl}>Save</button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">The APK is built automatically by GitHub Actions on every push — download it from your repository's <b>Releases</b> page.</p>
      </div>

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

      {/* Password */}
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

      {/* Data */}
      <div className="card p-5">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-bold"><Download className="h-4 w-4 text-emerald-500" /> Your data</h3>
        <div className="flex flex-wrap gap-2">
          <button className="btn-outline" onClick={() => api.download('/data/export.csv')}><Download className="h-4 w-4" /> Export all transactions (CSV)</button>
          <button className="btn-outline" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Import CSV</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Your data lives in a single SQLite file on the server — nothing is sent to third parties, ever (digest emails go through your own SMTP account).</p>
      </div>

      {/* Danger zone */}
      <div className="card border-rose-200 p-5 dark:border-rose-500/30">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-rose-600 dark:text-rose-400"><Trash2 className="h-4 w-4" /> Danger zone</h3>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Permanently delete your account and all data. This cannot be undone.</p>
        <div className="flex gap-2">
          <button className="btn-outline" onClick={logout}><LogOut className="h-4 w-4" /> Sign out</button>
          <button className="btn-danger" onClick={deleteAccount}><Trash2 className="h-4 w-4" /> Delete account</button>
        </div>
      </div>

      <p className="pb-4 text-center text-[11px] text-slate-400">PaisaFlow v1.1 · Made with ❤️ for India · All amounts in ₹ (INR)</p>
    </div>
  );
}

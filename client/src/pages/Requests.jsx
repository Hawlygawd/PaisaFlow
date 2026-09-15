import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { Plus, QrCode, Copy, Check, Download, Share2, Trash2, CheckCircle2, Clock, Ban } from 'lucide-react';
import { api } from '../lib/api.js';
import { inr, dateLabel, todayStr, paiseToRupeeInput, rupeeInputToPaise } from '../lib/format.js';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../components/Layout.jsx';
import { PageHeader, Modal, EmptyState, Spinner } from '../components/ui.jsx';

export function upiLink({ vpa, name, amountPaise, note }) {
  const p = new URLSearchParams({ pa: vpa, pn: name || 'PaisaFlow user', cu: 'INR' });
  if (amountPaise) p.set('am', (amountPaise / 100).toFixed(2));
  if (note) p.set('tn', String(note).slice(0, 50));
  return 'upi://pay?' + p.toString();
}

function QrImage({ link, size = 240 }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(link, {
      margin: 1, width: 512, errorCorrectionLevel: 'M',
      color: { dark: '#0f172aff', light: '#ffffffff' }
    }).then((s) => alive && setSrc(s)).catch(() => {});
    return () => { alive = false; };
  }, [link]);
  return src ? <img src={src} width={size} height={size} alt="UPI QR code" className="rounded-xl" /> : <div className="skeleton" style={{ width: size, height: size }} />;
}

export default function Requests() {
  const { user, toast } = useApp();
  const { confirm } = useUI();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // {mode:'create'} | {mode:'qr', request}
  const [form, setForm] = useState({ amount: '', note: '', fromName: '', dueDate: '' });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');

  const vpa = user?.upiId || '';

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { requests } = await api.get('/requests');
      setRequests(requests);
    } catch (e) { toast('error', e.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const amount = rupeeInputToPaise(form.amount);
    if (!amount) { toast('warning', 'Enter an amount'); return; }
    setBusy(true);
    try {
      await api.post('/requests', { amount: amount / 100, note: form.note, fromName: form.fromName, dueDate: form.dueDate || null });
      toast('success', 'Request created — share the QR!');
      setModal(null);
      setForm({ amount: '', note: '', fromName: '', dueDate: '' });
      load(true);
    } catch (e) { toast('error', e.message); }
    finally { setBusy(false); }
  };

  const markReceived = async (r) => {
    // Optimistic
    setRequests((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: 'received' } : x)));
    try {
      await api.post(`/requests/${r.id}/receive`, {});
      toast('success', 'Marked as received — income transaction added 💰');
      load(true);
    } catch (e) {
      toast('error', e.message);
      load(true);
    }
  };

  const remove = async (r) => {
    const ok = await confirm({ emoji: '🧾', title: 'Delete this request?', message: 'The QR will stop working for tracking (the UPI link itself remains valid until paid).', confirmLabel: 'Delete' });
    if (!ok) return;
    setRequests((prev) => prev.filter((x) => x.id !== r.id));
    try { await api.del(`/requests/${r.id}`); toast('success', 'Request deleted'); }
    catch (e) { toast('error', e.message); load(true); }
  };

  const copyLink = async (link, id) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(id);
      setTimeout(() => setCopied(''), 1500);
    } catch { toast('error', 'Could not copy'); }
  };

  const shareQr = async (r) => {
    const link = upiLink({ vpa: r.upiId || vpa, name: r.payeeName || user?.name, amountPaise: r.amount, note: r.note });
    try {
      const dataUrl = await QRCode.toDataURL(link, { margin: 1, width: 512, color: { dark: '#0f172aff', light: '#ffffffff' } });
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `paisaflow-request-${r.id}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `₹${(r.amount / 100).toFixed(2)} request`,
          text: `Please pay ₹${(r.amount / 100).toFixed(2)}${r.note ? ' for ' + r.note : ''} — scan the QR with any UPI app.`
        });
      } else {
        await navigator.clipboard.writeText(link);
        toast('success', 'Sharing not supported here — UPI link copied instead');
      }
    } catch (e) {
      if (e.name !== 'AbortError') toast('error', 'Could not share');
    }
  };

  const pending = requests.filter((r) => r.status === 'pending');
  const done = requests.filter((r) => r.status !== 'pending');
  const pendingTotal = pending.reduce((s, r) => s + r.amount, 0);

  if (loading) {
    return <div className="space-y-5"><div className="skeleton h-10 w-56" />{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-24" />)}</div>;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Request Money"
        subtitle="UPI QR codes anyone can scan with GPay, PhonePe, Paytm or any UPI app"
        right={<button className="btn-primary" onClick={() => setModal({ mode: 'create' })}><Plus className="h-4 w-4" /> New request</button>}
      />

      {!vpa ? (
        <EmptyState
          emoji="🔑"
          title="Set your UPI ID first"
          subtitle="Add your UPI ID (VPA) — like yourname@okhdfcbank — in Settings. It gets embedded in every QR you share."
          action={<Link to="/settings" className="btn-primary">Go to Settings</Link>}
        />
      ) : requests.length === 0 ? (
        <EmptyState
          emoji="🧾"
          title="No requests yet"
          subtitle="Splitting a bill? Lending a friend money? Create a request, share its QR on WhatsApp — they scan, pay, and you mark it received."
          action={<button className="btn-primary" onClick={() => setModal({ mode: 'create' })}><Plus className="h-4 w-4" /> Create your first request</button>}
        />
      ) : (
        <>
          {pending.length > 0 && (
            <div className="card flex flex-wrap items-center justify-between gap-2 p-4">
              <div className="text-sm text-slate-500 dark:text-slate-400">
                <span className="font-bold text-slate-900 dark:text-slate-100">{pending.length}</span> pending request{pending.length !== 1 ? 's' : ''}
              </div>
              <div className="text-lg font-extrabold text-amber-600 dark:text-amber-400">{inr(pendingTotal, { decimals: 0 })} to collect</div>
            </div>
          )}

          {[...pending, ...done].map((r) => {
            const link = upiLink({ vpa: r.upiId || vpa, name: r.payeeName || user?.name, amountPaise: r.amount, note: r.note });
            const overdue = r.status === 'pending' && r.dueDate && r.dueDate < todayStr();
            return (
              <div key={r.id} className={`card flex flex-wrap items-center gap-3 p-4 ${r.status !== 'pending' ? 'opacity-60' : ''}`}>
                <button
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 transition hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300"
                  onClick={() => setModal({ mode: 'qr', request: r })}
                  title="Show QR"
                >
                  <QrCode className="h-6 w-6" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-extrabold">{inr(r.amount, { decimals: r.amount % 100 === 0 ? 0 : 2 })}</span>
                    {r.status === 'pending' ? (
                      overdue
                        ? <span className="chip bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400"><Clock className="h-3 w-3" /> overdue · {dateLabel(r.dueDate)}</span>
                        : <span className="chip bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">pending{r.dueDate ? ` · due ${dateLabel(r.dueDate)}` : ''}</span>
                    ) : r.status === 'received' ? (
                      <span className="chip bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" /> received</span>
                    ) : (
                      <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"><Ban className="h-3 w-3" /> cancelled</span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-400">
                    {r.note || 'No note'}{r.fromName ? ` · from ${r.fromName}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button className="icon-btn" onClick={() => copyLink(link, r.id)} title="Copy UPI link">
                    {copied === r.id ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  </button>
                  <button className="icon-btn" onClick={() => shareQr(r)} title="Share QR"><Share2 className="h-4 w-4" /></button>
                  {r.status === 'pending' && (
                    <button className="btn-outline btn-sm" onClick={() => markReceived(r)}><CheckCircle2 className="h-3.5 w-3.5" /> Received</button>
                  )}
                  <button className="icon-btn hover:text-rose-500" onClick={() => remove(r)} title="Delete"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Create modal */}
      <Modal open={modal?.mode === 'create'} onClose={() => setModal(null)} title="New money request">
        <div className="space-y-4">
          <div>
            <label className="label">Amount (₹)</label>
            <input className="input text-lg font-bold" type="number" min="1" step="0.01" placeholder="e.g. 750" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} autoFocus />
            <div className="mt-2 flex gap-2">
              {[100, 500, 1000, 2500].map((v) => (
                <button key={v} type="button" className="chip border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" onClick={() => setForm((f) => ({ ...f, amount: String(Number(f.amount || 0) + v) }))}>
                  +₹{v >= 1000 ? v / 1000 + 'K' : v}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Note (shown in UPI apps)</label>
            <input className="input" placeholder="e.g. Dinner split, Rent share" maxLength={50} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Requesting from (optional)</label>
              <input className="input" placeholder="e.g. Rahul" value={form.fromName} onChange={(e) => setForm((f) => ({ ...f, fromName: e.target.value }))} />
            </div>
            <div>
              <label className="label">Due date (optional)</label>
              <input className="input" type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
            </div>
          </div>
          <div className="rounded-xl bg-indigo-50 px-3 py-2.5 text-xs text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
            Paying to: <b>{vpa}</b> ({user?.name}) — change it in Settings.
          </div>
          <button className="btn-primary w-full py-2.5" onClick={create} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4 text-white" /> : <Plus className="h-4 w-4" />} Create request
          </button>
        </div>
      </Modal>

      {/* QR modal */}
      {modal?.mode === 'qr' && (() => {
        const r = modal.request;
        const link = upiLink({ vpa: r.upiId || vpa, name: r.payeeName || user?.name, amountPaise: r.amount, note: r.note });
        return (
          <Modal open onClose={() => setModal(null)} title="Scan to pay">
            <div className="flex flex-col items-center gap-4 py-2">
              <QrImage link={link} size={240} />
              <div className="text-center">
                <div className="text-2xl font-extrabold">{inr(r.amount, { decimals: r.amount % 100 === 0 ? 0 : 2 })}</div>
                <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{r.note || 'Payment request'}</div>
                <div className="mt-1 text-xs text-slate-400">to {r.payeeName || user?.name} · {r.upiId || vpa}</div>
              </div>
              <p className="max-w-xs text-center text-[11px] text-slate-400">
                Works with GPay, PhonePe, Paytm, BHIM and all UPI apps. Screenshot this and send it on WhatsApp!
              </p>
              <div className="flex w-full gap-2">
                <button className="btn-outline flex-1" onClick={() => copyLink(link, 'modal')}>
                  {copied === 'modal' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />} Copy link
                </button>
                <button className="btn-outline flex-1" onClick={() => shareQr(r)}><Share2 className="h-4 w-4" /> Share</button>
                <button
                  className="btn-primary flex-1"
                  onClick={async () => {
                    // Let Android resolve the upi:// intent — GPay / PhonePe / Paytm / BHIM chooser opens.
                    try { window.location.href = link; }
                    catch { toast('info', 'Open any UPI app and scan the QR instead'); }
                  }}
                >
                  <Download className="h-4 w-4" /> Open in UPI app
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

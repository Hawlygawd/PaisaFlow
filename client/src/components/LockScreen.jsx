import React, { useEffect, useRef, useState } from 'react';
import { Delete, ShieldCheck, ShieldOff } from 'lucide-react';
import { verifyPin, setPin, clearPin, wipeLocalData } from '../lib/api.js';

// Reusable 4-digit PIN pad. Used by the lock screen (verify mode) and
// Settings (set / disable modes).
export function PinPad({ title, subtitle, onComplete, errorFlash }) {
  const [digits, setDigits] = useState('');
  const [shake, setShake] = useState(false);

  const press = (d) => {
    if (digits.length >= 4) return;
    const next = digits + d;
    setDigits(next);
    if (next.length === 4) {
      setTimeout(async () => {
        const ok = await onComplete(next);
        if (!ok) {
          setShake(true);
          setTimeout(() => setShake(false), 500);
          setDigits('');
        }
      }, 120);
    }
  };
  const back = () => setDigits((d) => d.slice(0, -1));

  useEffect(() => { if (errorFlash) { setShake(true); const t = setTimeout(() => setShake(false), 500); setDigits(''); return () => clearTimeout(t); } }, [errorFlash]);

  return (
    <div className="flex flex-col items-center">
      <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      <div className={`mt-6 flex gap-3.5 ${shake ? 'animate-shake' : ''}`}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-4 w-4 rounded-full border-2 transition-all ${
              digits.length > i
                ? 'border-indigo-600 bg-indigo-600 dark:border-indigo-400 dark:bg-indigo-400'
                : 'border-slate-300 dark:border-slate-600'
            }`}
          />
        ))}
      </div>
      <div className="mt-8 grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            onClick={() => press(d)}
            className="h-16 w-16 rounded-2xl bg-white text-xl font-bold text-slate-800 shadow-sm ring-1 ring-slate-200 transition active:scale-95 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-700"
          >
            {d}
          </button>
        ))}
        <div />
        <button
          onClick={() => press('0')}
          className="h-16 w-16 rounded-2xl bg-white text-xl font-bold text-slate-800 shadow-sm ring-1 ring-slate-200 transition active:scale-95 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-700"
        >
          0
        </button>
        <button
          onClick={back}
          className="flex h-16 w-16 items-center justify-center rounded-2xl text-slate-400 transition active:scale-95 hover:text-slate-600 dark:hover:text-slate-200"
          aria-label="Backspace"
        >
          <Delete className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}

// Full-screen gate shown at launch while a PIN is set.
export default function LockScreen({ onUnlocked }) {
  const [error, setError] = useState(0);
  const [showForgot, setShowForgot] = useState(false);
  const [cooling, setCooling] = useState(0);
  const fails = useRef(0);

  const onComplete = async (pin) => {
    if (cooling > Date.now()) return false;
    const ok = await verifyPin(pin);
    if (ok) { onUnlocked(); return true; }
    fails.current += 1;
    setError((e) => e + 1);
    if (fails.current % 5 === 0) {
      setCooling(Date.now() + 30000);
      setTimeout(() => setCooling(0), 30000);
    }
    return false;
  };

  const eraseEverything = () => {
    wipeLocalData();
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-indigo-50 via-slate-50 to-slate-100 px-6 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900">
      <div className="mb-8 flex items-center gap-2.5">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-2xl shadow-lg shadow-indigo-600/30">💸</div>
        <div>
          <div className="text-xl font-extrabold">PaisaFlow</div>
          <div className="-mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-indigo-500">your money, sorted</div>
        </div>
      </div>

      {cooling ? (
        <p className="rounded-xl bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
          Too many attempts — wait 30 seconds.
        </p>
      ) : null}

      <PinPad
        key={error}
        title="Enter your PIN"
        subtitle={error ? 'Wrong PIN — try again' : 'Unlock your money'}
        onComplete={onComplete}
      />

      <button
        className="mt-10 text-xs font-medium text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline dark:hover:text-slate-300"
        onClick={() => setShowForgot(true)}
      >
        Forgot PIN?
      </button>

      {showForgot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setShowForgot(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400"><ShieldOff className="h-5 w-5" /><h3 className="font-extrabold">Reset PIN by erasing data?</h3></div>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              The PIN protects data stored only on this phone. To regain access we must erase everything and start fresh.
              Export a CSV backup first if you still have access.
            </p>
            <div className="mt-4 flex gap-2">
              <button className="btn-outline flex-1" onClick={() => setShowForgot(false)}>Keep data</button>
              <button className="btn-danger flex-1" onClick={eraseEverything}>Erase & reset</button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center gap-1.5 text-[11px] text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5" /> Your data never leaves this device
      </div>
    </div>
  );
}

// Modal used in Settings to enable or disable the PIN.
export function PinSetupModal({ mode, onClose }) {
  const [step, setStep] = useState(0); // 0: first entry, 1: confirm
  const [first, setFirst] = useState('');
  const [errorFlash, setErrorFlash] = useState(0);

  const onComplete = async (pin) => {
    if (mode === 'disable') {
      const ok = await clearPin(pin);
      if (!ok) { setErrorFlash((e) => e + 1); return false; }
      onClose(true);
      return true;
    }
    if (step === 0) { setFirst(pin); setStep(1); return true; }
    if (pin !== first) { setErrorFlash((e) => e + 1); setStep(0); setFirst(''); return false; }
    await setPin(pin);
    onClose(true);
    return true;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => onClose(false)}>
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
        <PinPad
          key={`${mode}-${step}-${errorFlash}`}
          title={mode === 'disable' ? 'Enter your PIN' : step === 0 ? 'Choose a 4-digit PIN' : 'Confirm your PIN'}
          subtitle={mode === 'disable' ? 'to turn off the lock' : errorFlash ? "PINs didn't match — start again" : 'Private to this phone'}
          onComplete={onComplete}
          errorFlash={errorFlash}
        />
        <button className="mt-6 w-full text-center text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" onClick={() => onClose(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { rupeeInputToPaise, paiseToRupeeInput } from '../lib/format.js';

const EMOJI_CHOICES = ['🍔','🛒','🛍️','🚗','🏠','💡','📱','🏥','📚','🎬','✈️','💪','🏦','🎁','📺','📦','💼','📈','📊','💻','🪙','💰','🎯','🐾','☕','🍕','⛽','🎮','👕','💊','🧾','🚕','🏫','🎓','🐶','🌴','💸','🧺','🔧','🎉'];
const COLOR_CHOICES = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#ef4444','#f97316','#eab308','#84cc16','#22c55e','#10b981','#14b8a6','#06b6d4','#0ea5e9','#3b82f6','#64748b','#94a3b8'];

export function AmountInput({ value, onChange, autoFocus = true, size = 'lg' }) {
  const [text, setText] = useState(value ? paiseToRupeeInput(value) : '');
  const prevValue = useRef(value);

  // Sync from outside (e.g. quick chips / edit mode switch)
  useEffect(() => {
    if (value !== prevValue.current) {
      prevValue.current = value;
      setText(value ? paiseToRupeeInput(value) : '');
    }
  }, [value]);

  const handle = (v) => {
    const clean = v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    const parts = clean.split('.');
    const limited = parts.length > 1 ? `${parts[0]}.${parts[1].slice(0, 2)}` : clean;
    setText(limited);
    const paise = rupeeInputToPaise(limited);
    prevValue.current = paise;
    onChange(paise);
  };

  const chips = [100, 500, 1000, 2000];
  return (
    <div>
      <div className={`flex items-center justify-center rounded-2xl border-2 border-slate-200 bg-slate-50 px-4 dark:border-slate-700 dark:bg-slate-800/60 ${size === 'lg' ? 'py-3' : 'py-2'}`}>
        <span className={`${size === 'lg' ? 'text-3xl' : 'text-xl'} font-bold text-slate-400`}>₹</span>
        <input
          value={text}
          onChange={(e) => handle(e.target.value)}
          inputMode="decimal"
          placeholder="0"
          autoFocus={autoFocus}
          className={`w-full bg-transparent text-center font-extrabold outline-none placeholder:text-slate-300 dark:placeholder:text-slate-600 ${size === 'lg' ? 'text-3xl' : 'text-xl'}`}
        />
      </div>
      <div className="mt-2 flex justify-center gap-2">
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            className="chip border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            onClick={() => handle(String((rupeeInputToPaise(text) + c * 100) / 100))}
          >
            +{c >= 1000 ? c / 1000 + 'K' : c}
          </button>
        ))}
      </div>
    </div>
  );
}

export function EmojiPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-xl hover:border-indigo-400 dark:border-slate-700 dark:bg-slate-900"
      >
        {value || '📦'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-12 z-20 grid w-56 grid-cols-6 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-800">
            {EMOJI_CHOICES.map((e) => (
              <button
                key={e}
                type="button"
                className={`rounded-lg p-1.5 text-lg hover:bg-slate-100 dark:hover:bg-slate-700 ${value === e ? 'bg-indigo-50 ring-1 ring-indigo-400 dark:bg-indigo-500/20' : ''}`}
                onClick={() => { onChange(e); setOpen(false); }}
              >
                {e}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ColorPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLOR_CHOICES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`h-7 w-7 rounded-full transition ${value === c ? 'ring-2 ring-slate-900 ring-offset-2 dark:ring-white dark:ring-offset-slate-900' : 'hover:scale-110'}`}
          style={{ backgroundColor: c }}
          aria-label={`Color ${c}`}
        />
      ))}
    </div>
  );
}

export function CategoryPicker({ categories, type, value, onChange, onCreate }) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('📦');
  const [newColor, setNewColor] = useState('#6366f1');
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(
    () => categories.filter((c) => c.type === type && c.name.toLowerCase().includes(q.toLowerCase())),
    [categories, type, q]
  );

  const create = async () => {
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      const { category } = await api.post('/categories', { name: newName.trim(), type, emoji: newEmoji, color: newColor });
      onCreate && onCreate(category);
      onChange(category.id);
      setCreating(false); setNewName('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search categories…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" className="btn-outline btn-sm" onClick={() => setCreating((c) => !c)}>
          <Plus className="h-3.5 w-3.5" /> New
        </button>
      </div>

      {creating && (
        <div className="mb-3 space-y-3 rounded-xl border border-dashed border-indigo-300 p-3 dark:border-indigo-500/40">
          <div className="flex items-center gap-3">
            <EmojiPicker value={newEmoji} onChange={setNewEmoji} />
            <input className="input" placeholder="Category name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <ColorPicker value={newColor} onChange={setNewColor} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setCreating(false)}>Cancel</button>
            <button type="button" className="btn-primary btn-sm" onClick={create} disabled={busy || !newName.trim()}>
              {busy ? 'Adding…' : 'Add category'}
            </button>
          </div>
        </div>
      )}

      <div className="grid max-h-44 grid-cols-4 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-5">
        {filtered.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-center transition ${
              value === c.id
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/15'
                : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full text-lg" style={{ backgroundColor: c.color + '22' }}>
              {c.emoji}
            </span>
            <span className="line-clamp-2 text-[10px] font-medium leading-tight text-slate-600 dark:text-slate-300">{c.name}</span>
          </button>
        ))}
        {!filtered.length && (
          <p className="col-span-full py-4 text-center text-xs text-slate-400">No categories match. Create one above.</p>
        )}
      </div>
    </div>
  );
}

export function TagInput({ value = [], onChange, suggestions = [] }) {
  const [text, setText] = useState('');
  const add = (t) => {
    const tag = t.trim().replace(/"/g, '');
    if (tag && !value.includes(tag)) onChange([...value, tag].slice(0, 10));
    setText('');
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900">
        {value.map((t) => (
          <span key={t} className="chip bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
            #{t}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          className="min-w-[7rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
          placeholder={value.length ? '' : 'Add tags (press Enter)…'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add(text); }
            else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
          }}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestions.filter((s) => !value.includes(s)).slice(0, 8).map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="chip bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400">
              #{s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Select({ value, onChange, children, placeholder }) {
  return (
    <select className="input cursor-pointer" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {children}
    </select>
  );
}

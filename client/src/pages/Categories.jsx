import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../context/AppContext.jsx';
import { useUI } from '../components/Layout.jsx';
import { PageHeader, Modal, Segmented, EmptyState, Spinner } from '../components/ui.jsx';
import { EmojiPicker, ColorPicker } from '../components/inputs.jsx';

export default function Categories() {
  const { toast } = useApp();
  const { confirm, refreshShared } = useUI();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('expense');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: '', emoji: '📦', color: '#6366f1', type: 'expense' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { categories } = await api.get('/categories');
      setCategories(categories);
    } catch (e) { toast('error', e.message); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm({ name: '', emoji: tab === 'income' ? '💰' : '📦', color: '#6366f1', type: tab }); setModal({ mode: 'create' }); };
  const openEdit = (c) => { setForm({ name: c.name, emoji: c.emoji, color: c.color, type: c.type }); setModal({ mode: 'edit', category: c }); };

  const save = async () => {
    if (!form.name.trim()) { toast('warning', 'Give the category a name'); return; }
    setBusy(true);
    try {
      if (modal.mode === 'create') {
        await api.post('/categories', { name: form.name.trim(), type: form.type, emoji: form.emoji, color: form.color });
        toast('success', 'Category created');
      } else {
        await api.patch(`/categories/${modal.category.id}`, { name: form.name.trim(), emoji: form.emoji, color: form.color });
        toast('success', 'Category updated');
      }
      setModal(null);
      await load();
      refreshShared();
    } catch (e) { toast('error', e.message); }
    finally { setBusy(false); }
  };

  const remove = async (c) => {
    const ok = await confirm({
      emoji: c.emoji,
      title: `Delete "${c.name}"?`,
      message: 'Transactions using it will become Uncategorized, and its budgets will be removed. This cannot be undone.',
      confirmLabel: 'Delete category'
    });
    if (!ok) return;
    try {
      await api.del(`/categories/${c.id}`);
      toast('success', 'Category deleted');
      await load(); refreshShared();
    } catch (e) { toast('error', e.message); }
  };

  const list = categories.filter((c) => c.type === tab);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Categories"
        subtitle="Organise income and expenses your way"
        right={
          <div className="flex items-center gap-2">
            <Segmented options={[{ value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }]} value={tab} onChange={setTab} />
            <button className="btn-primary" onClick={openCreate}><Plus className="h-4 w-4" /> New</button>
          </div>
        }
      />

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-24" />)}
        </div>
      ) : list.length === 0 ? (
        <EmptyState emoji="🏷️" title={`No ${tab} categories`} subtitle="Create categories to organise your transactions." action={<button className="btn-primary" onClick={openCreate}><Plus className="h-4 w-4" /> Create category</button>} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((c) => (
            <div key={c.id} className="card group relative flex items-center gap-3 p-3.5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl" style={{ backgroundColor: c.color + '1e' }}>{c.emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{c.name}</div>
                {c.isDefault ? <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">default</span> : null}
              </div>
              <div className="flex flex-col gap-0.5 opacity-0 transition group-hover:opacity-100">
                <button className="icon-btn h-7 w-7" onClick={() => openEdit(c)} title="Edit"><Pencil className="h-3 w-3" /></button>
                <button className="icon-btn h-7 w-7 hover:text-rose-500" onClick={() => remove(c)} title="Delete"><Trash2 className="h-3 w-3" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.mode === 'edit' ? 'Edit category' : 'New category'}>
        <div className="space-y-4">
          {modal?.mode === 'create' && (
            <div>
              <label className="label">Type</label>
              <Segmented
                options={[{ value: 'expense', label: '💸 Expense' }, { value: 'income', label: '💰 Income' }]}
                value={form.type}
                onChange={(type) => setForm((f) => ({ ...f, type }))}
              />
            </div>
          )}
          <div>
            <label className="label">Name</label>
            <input className="input" placeholder="e.g. Street food" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="flex items-end gap-4">
            <div>
              <label className="label">Icon</label>
              <EmojiPicker value={form.emoji} onChange={(emoji) => setForm((f) => ({ ...f, emoji }))} />
            </div>
            <div className="flex-1">
              <label className="label">Color</label>
              <ColorPicker value={form.color} onChange={(color) => setForm((f) => ({ ...f, color }))} />
            </div>
          </div>
          <button className="btn-primary w-full py-2.5" onClick={save} disabled={busy}>
            {busy ? <Spinner className="h-4 w-4 text-white" /> : null}{modal?.mode === 'edit' ? 'Save changes' : 'Create category'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

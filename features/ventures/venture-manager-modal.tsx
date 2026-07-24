'use client';

import { useState } from 'react';
import { Loader2, Plus, Save, Archive } from 'lucide-react';
import { ResponsiveModal } from '@/components/ui/responsive-modal';
import { useEntity } from '@/app/providers/entity-provider';
import { useInvalidateFinance, useVentures } from '@/hooks/use-finance-queries';
import {
  archiveVenture,
  insertVenture,
  updateVenture,
} from '@/lib/queries/ventures';

export function VentureManagerModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { entityId } = useEntity();
  const { data: ventures = [] } = useVentures(false);
  const { invalidateVentures } = useInvalidateFinance();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    if (editingId) {
      await updateVenture(editingId, { name, notes: notes || null });
    } else {
      const nextOrder =
        ventures.reduce((max, v) => Math.max(max, v.sort_order), 0) + 10;
      await insertVenture(entityId, {
        name,
        notes: notes || null,
        sort_order: nextOrder,
      });
    }
    setName('');
    setNotes('');
    setEditingId(null);
    await invalidateVentures();
    setSaving(false);
  }

  async function handleArchive(id: number) {
    if (!confirm('Archive this venture? Existing tags stay; it won’t appear in new pickers.')) {
      return;
    }
    await archiveVenture(id);
    await invalidateVentures();
  }

  function startEdit(id: number, currentName: string, currentNotes: string | null) {
    setEditingId(id);
    setName(currentName);
    setNotes(currentNotes || '');
  }

  const active = ventures.filter((v) => v.is_active);
  const archived = ventures.filter((v) => !v.is_active);

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} title="Ventures">
      <div className="space-y-4 pb-2">
        <p className="text-sm text-[var(--text-muted)]">
          Tag Business money by Marrero LLC venture (YouTube, SOUR, Trading, etc.).
          Optional — leave blank for general overhead.
        </p>

        <form onSubmit={handleSave} className="space-y-3 rounded-xl border border-[var(--border)] p-3">
          <input
            required
            placeholder="Venture name"
            className="app-input w-full rounded-xl border border-[var(--border)] p-3 text-sm font-bold outline-none focus:border-[var(--entity-accent)]"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            placeholder="Notes (optional)"
            rows={2}
            className="app-input w-full resize-none rounded-xl border border-[var(--border)] p-3 text-sm font-bold outline-none focus:border-[var(--entity-accent)]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--entity-accent)] py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : editingId ? <Save size={16} /> : <Plus size={16} />}
              {editingId ? 'Save changes' : 'Add venture'}
            </button>
            {editingId && (
              <button
                type="button"
                className="rounded-xl border border-[var(--border)] px-4 text-sm font-bold"
                onClick={() => {
                  setEditingId(null);
                  setName('');
                  setNotes('');
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <ul className="space-y-2">
          {active.map((v) => (
            <li
              key={v.id}
              className="flex items-start justify-between gap-2 rounded-xl border border-[var(--border)] p-3"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => startEdit(v.id, v.name, v.notes)}
              >
                <p className="font-bold text-[var(--text-primary)]">{v.name}</p>
                {v.notes && (
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">{v.notes}</p>
                )}
              </button>
              <button
                type="button"
                aria-label={`Archive ${v.name}`}
                className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
                onClick={() => handleArchive(v.id)}
              >
                <Archive size={16} />
              </button>
            </li>
          ))}
        </ul>

        {archived.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Archived
            </p>
            <ul className="space-y-1 opacity-60">
              {archived.map((v) => (
                <li key={v.id} className="text-sm font-bold">
                  {v.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ResponsiveModal>
  );
}

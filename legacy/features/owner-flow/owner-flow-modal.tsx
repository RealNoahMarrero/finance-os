'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, ArrowRightLeft } from 'lucide-react';
import { ResponsiveModal } from '@/components/ui/responsive-modal';
import { useEntity } from '@/app/providers/entity-provider';
import { useInvalidateFinance } from '@/hooks/use-finance-queries';
import { formatMoney, roundMoney } from '@/lib/money';
import {
  createOwnerFlow,
  fetchAccountsForEntity,
  type OwnerFlowDirection,
} from '@/lib/queries/owner-flow';
import type { Account } from '@/lib/types';

export function OwnerFlowModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { entityId } = useEntity();
  const invalidate = useInvalidateFinance();
  const defaultDirection: OwnerFlowDirection =
    entityId === 'business' ? 'pay_yourself' : 'fund_business';

  const [direction, setDirection] = useState<OwnerFlowDirection>(defaultDirection);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [fromAccounts, setFromAccounts] = useState<Account[]>([]);
  const [toAccounts, setToAccounts] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDirection(entityId === 'business' ? 'pay_yourself' : 'fund_business');
    setAmount('');
    setDate(format(new Date(), 'yyyy-MM-dd'));
    setNotes('');
  }, [open, entityId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingAccounts(true);
    const sourceEntity = direction === 'pay_yourself' ? 'business' : 'personal';
    const destEntity = direction === 'pay_yourself' ? 'personal' : 'business';

    Promise.all([
      fetchAccountsForEntity(sourceEntity),
      fetchAccountsForEntity(destEntity),
    ]).then(([from, to]) => {
      if (cancelled) return;
      const fromList = (from.data || []) as Account[];
      const toList = (to.data || []) as Account[];
      setFromAccounts(fromList);
      setToAccounts(toList);
      setFromAccountId(fromList[0] ? String(fromList[0].id) : '');
      setToAccountId(toList[0] ? String(toList[0].id) : '');
      setLoadingAccounts(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open, direction]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fromAccountId || !toAccountId) {
      alert('Add accounts on both Personal and Business first.');
      return;
    }
    setSaving(true);
    const { error } = await createOwnerFlow({
      direction,
      amount: roundMoney(parseFloat(amount) || 0),
      date,
      fromAccountId: Number(fromAccountId),
      toAccountId: Number(toAccountId),
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      alert(error.message || 'Could not complete owner flow.');
      return;
    }
    await invalidate.invalidateAfterTransaction();
    // Also refresh the other books (owner flows touch both entities)
    await invalidate.invalidateAll();
    onOpenChange(false);
  }

  const title =
    direction === 'pay_yourself' ? 'Pay yourself' : 'Fund business';

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} title={title}>
      <form onSubmit={handleSubmit} className="space-y-4 pb-2">
        <p className="text-sm text-[var(--text-muted)]">
          Creates linked entries on both books (withdrawal on one side, income on the other).
          Money stays Ready to Assign until you assign envelopes.
        </p>

        <div className="flex gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-1">
          <button
            type="button"
            onClick={() => setDirection('pay_yourself')}
            className={`flex-1 rounded-lg py-2 text-xs font-bold ${
              direction === 'pay_yourself'
                ? 'bg-[var(--entity-accent)] text-white'
                : 'text-[var(--text-muted)]'
            }`}
          >
            Pay yourself
          </button>
          <button
            type="button"
            onClick={() => setDirection('fund_business')}
            className={`flex-1 rounded-lg py-2 text-xs font-bold ${
              direction === 'fund_business'
                ? 'bg-[var(--entity-accent)] text-white'
                : 'text-[var(--text-muted)]'
            }`}
          >
            Fund business
          </button>
        </div>

        {loadingAccounts ? (
          <div className="flex justify-center py-8">
            <Loader2 className="animate-spin text-[var(--text-muted)]" />
          </div>
        ) : (
          <>
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                From ({direction === 'pay_yourself' ? 'Business' : 'Personal'})
              </label>
              <select
                required
                className="app-select w-full rounded-xl border border-[var(--border)] p-3 text-sm font-bold"
                value={fromAccountId}
                onChange={(e) => setFromAccountId(e.target.value)}
              >
                {fromAccounts.length === 0 && (
                  <option value="">No accounts yet</option>
                )}
                {fromAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} (${formatMoney(a.balance)})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-center text-[var(--entity-accent)]">
              <ArrowRightLeft size={20} />
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                To ({direction === 'pay_yourself' ? 'Personal' : 'Business'})
              </label>
              <select
                required
                className="app-select w-full rounded-xl border border-[var(--border)] p-3 text-sm font-bold"
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
              >
                {toAccounts.length === 0 && (
                  <option value="">No accounts yet</option>
                )}
                {toAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} (${formatMoney(a.balance)})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Amount
                </label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="app-input w-full rounded-xl border border-[var(--border)] p-3 text-lg font-black"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Date
                </label>
                <input
                  required
                  type="date"
                  className="app-input w-full rounded-xl border border-[var(--border)] p-3 text-sm font-bold"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Notes
              </label>
              <textarea
                rows={2}
                className="app-input w-full resize-none rounded-xl border border-[var(--border)] p-3 text-sm font-bold"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={saving || loadingAccounts || !fromAccountId || !toAccountId}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--entity-accent)] py-4 font-bold text-white disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin" size={18} /> : null}
          {saving ? 'Saving…' : 'Record both sides'}
        </button>
      </form>
    </ResponsiveModal>
  );
}

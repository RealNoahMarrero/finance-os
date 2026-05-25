'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { format, parseISO, isBefore, startOfDay } from 'date-fns';
import { CreditCard, ChevronDown, ChevronRight, FastForward, Loader2 } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import {
  getCreditCardPaymentFundingStatus,
} from '@/lib/credit-cards';
import { advanceCreditCardPaymentCycle } from '@/lib/queries/credit-card-payments';
import type { Account, Category } from '@/lib/types';

export function CreditCardPaymentsPanel({
  accounts,
  categories,
  onUpdated,
}: {
  accounts: Account[];
  categories: Category[];
  onUpdated: () => void;
}) {
  const [advancingId, setAdvancingId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('finance_os_cc_payments_expanded');
    if (saved !== null) setExpanded(saved === 'true');
  }, []);

  function toggleExpanded() {
    setExpanded((prev) => {
      const next = !prev;
      localStorage.setItem('finance_os_cc_payments_expanded', String(next));
      return next;
    });
  }

  const cards = accounts.filter(
    (a) =>
      a.type === 'Credit Card' &&
      a.payment_due_day != null &&
      a.next_payment_due_date
  );

  if (cards.length === 0) return null;

  const today = startOfDay(new Date());

  async function handleMarkPaid(card: Account) {
    setAdvancingId(card.id);
    await advanceCreditCardPaymentCycle(card);
    setAdvancingId(null);
    onUpdated();
  }

  const pastDueCount = cards.filter(
    (c) =>
      c.next_payment_due_date &&
      isBefore(parseISO(c.next_payment_due_date), today)
  ).length;

  return (
    <div className="app-card rounded-2xl border border-[var(--border)] mb-8 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={toggleExpanded}
        className="w-full p-4 md:px-5 md:py-4 flex items-center justify-between gap-3 bg-[var(--surface-subtle)] hover:bg-[var(--surface-hover)] transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[var(--text-muted)] shrink-0">
            {expanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
          </span>
          <h3 className="font-bold text-lg text-[var(--text-primary)] flex items-center gap-2 truncate">
            <CreditCard size={20} className="text-red-500 shrink-0" />
            Credit card payments
          </h3>
        </div>
        <span className="text-xs font-bold text-[var(--text-muted)] shrink-0">
          {cards.length} card{cards.length !== 1 ? 's' : ''}
          {pastDueCount > 0 && (
            <span className="text-red-600 ml-1">· {pastDueCount} past due</span>
          )}
        </span>
      </button>
      {expanded && (
      <div className="p-4 md:p-5 border-t border-[var(--border)] space-y-3">
        {cards.map((card) => {
          const funding = getCreditCardPaymentFundingStatus(card, categories);
          const linked = categories.find((c) => c.id === card.payment_category_id);
          const isPastDue =
            card.next_payment_due_date &&
            isBefore(parseISO(card.next_payment_due_date), today);
          const minPay = Number(card.minimum_payment) || 0;

          return (
            <div
              key={card.id}
              className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center gap-4 ${
                funding === 'funded'
                  ? 'border-amber-400/50 bg-amber-500/5'
                  : isPastDue
                    ? 'border-red-500/30 bg-red-500/5'
                    : 'border-[var(--border)]'
              }`}
            >
              <div className="flex-grow min-w-0">
                <p className="font-bold text-[var(--text-primary)]">{card.name}</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Due{' '}
                  {card.next_payment_due_date
                    ? format(parseISO(card.next_payment_due_date), 'MMM d, yyyy')
                    : '—'}
                  {minPay > 0 && ` · Min $${formatMoney(minPay)}`}
                </p>
                {linked ? (
                  <p className="text-xs font-bold mt-1">
                    <Link
                      href={`/budget?category=${linked.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {linked.emoji} {linked.name}
                    </Link>
                    <span className="text-[var(--text-muted)]">
                      {' '}
                      — ${formatMoney(linked.assigned_amount)} assigned
                    </span>
                    {funding === 'funded' && (
                      <span className="text-emerald-600 ml-1">✓ funded</span>
                    )}
                    {funding === 'underfunded' && (
                      <span className="text-red-600 ml-1">needs funding</span>
                    )}
                  </p>
                ) : (
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">
                    Edit account to link a budget envelope for funding tracking.
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={advancingId === card.id}
                onClick={() => handleMarkPaid(card)}
                className="shrink-0 px-4 py-2.5 bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {advancingId === card.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <FastForward size={14} />
                )}
                Mark paid
              </button>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

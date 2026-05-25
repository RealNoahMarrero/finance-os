'use client';

import { format, parseISO } from 'date-fns';
import Link from 'next/link';
import { CreditCard, Loader2 } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import {
  getCreditCardPaymentFundingStatus,
} from '@/lib/credit-cards';
import type { Account, Category } from '@/lib/types';

export function CreditCardPaymentDetail({
  card,
  categories,
  onMarkPaid,
  markingPaid,
}: {
  card: Account;
  categories: Pick<Category, 'id' | 'name' | 'emoji' | 'assigned_amount'>[];
  onMarkPaid: () => void;
  markingPaid: boolean;
}) {
  const funding = getCreditCardPaymentFundingStatus(card, categories);
  const linked = categories.find((c) => c.id === card.payment_category_id);
  const minPay = Number(card.minimum_payment) || 0;

  return (
    <div className="space-y-4 pb-2">
      <p className="text-2xl font-black text-red-600">
        ${formatMoney(minPay)}
        <span className="text-sm font-bold text-[var(--text-muted)] ml-2">
          minimum due
        </span>
      </p>
      {card.next_payment_due_date && (
        <p className="text-sm text-[var(--text-muted)]">
          Due {format(parseISO(card.next_payment_due_date), 'MMM d, yyyy')}
        </p>
      )}
      {linked ? (
        <p className="text-sm text-[var(--text-primary)]">
          Budget: {linked.emoji} {linked.name} — assigned $
          {formatMoney(linked.assigned_amount)}
          {funding === 'funded' && (
            <span className="text-emerald-600 font-bold"> (funded)</span>
          )}
          {funding === 'underfunded' && (
            <span className="text-red-600 font-bold"> (underfunded)</span>
          )}
        </p>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          Link a budget category in account settings to track funding on the
          calendar.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={markingPaid || !card.payment_due_day}
          onClick={onMarkPaid}
          className="w-full py-3 bg-emerald-500 text-white rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {markingPaid ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <CreditCard size={16} />
          )}
          Mark minimum paid — advance cycle
        </button>
        <Link
          href={`/ledger?account=${card.id}`}
          className="w-full py-3 app-card-subtle border border-[var(--border)] rounded-xl font-bold text-sm text-center text-[var(--text-primary)]"
        >
          Open ledger
        </Link>
        {linked && (
          <Link
            href={`/budget?category=${linked.id}`}
            className="w-full py-3 app-card-subtle border border-[var(--border)] rounded-xl font-bold text-sm text-center text-blue-600"
          >
            Fund in budget
          </Link>
        )}
      </div>
    </div>
  );
}

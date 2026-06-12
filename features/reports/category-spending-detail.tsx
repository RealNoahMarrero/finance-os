'use client';

import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { Calendar, Split, Wallet } from 'lucide-react';
import { formatCategoryChartLabel } from '@/components/charts/category-donut';
import { ResponsiveModal } from '@/components/ui/responsive-modal';
import { formatMoney } from '@/lib/money';
import {
  listCategoryExpenses,
  type CategorySpend,
  type PeriodRange,
} from '@/lib/reports/aggregations';
import type { Account, Transaction } from '@/lib/types';

export function CategorySpendingDetail({
  open,
  onOpenChange,
  category,
  transactions,
  accounts,
  periodRange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: CategorySpend | null;
  transactions: Transaction[];
  accounts: Account[];
  periodRange: PeriodRange;
}) {
  const accountNames = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.name])),
    [accounts]
  );

  const lines = useMemo(() => {
    if (!category?.categoryId) return [];
    return listCategoryExpenses(
      transactions,
      category.categoryId,
      periodRange,
      accountNames
    );
  }, [category, transactions, periodRange, accountNames]);

  if (!category) return null;

  const title = formatCategoryChartLabel(category.emoji, category.name);

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} title={title}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              {periodRange.label}
            </p>
            <p className="text-xs font-bold text-[var(--text-muted)]">
              {lines.length} transaction{lines.length === 1 ? '' : 's'}
            </p>
          </div>
          <p className="text-xl font-black tabular-nums text-[var(--accent-negative)]">
            ${formatMoney(category.total)}
          </p>
        </div>

        {lines.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            No transactions in this period.
          </p>
        ) : (
          <ul className="max-h-[min(60vh,28rem)] space-y-2 overflow-y-auto pr-1">
            {lines.map((line) => (
              <li
                key={`${line.transactionId}-${line.amount}-${line.date}`}
                className="rounded-xl border border-[var(--border)] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-[var(--text-primary)]">
                      {line.payee || 'Expense'}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-[var(--text-muted)]">
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={10} />
                        {format(parseISO(line.date), 'MMM d, yyyy')}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Wallet size={10} />
                        {line.accountName}
                      </span>
                    </p>
                    {line.isSplit && line.transactionTotal != null && (
                      <p className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-violet-600">
                        <Split size={10} />
                        Split line of ${formatMoney(line.transactionTotal)} total
                      </p>
                    )}
                    {line.notes && (
                      <p className="mt-1 text-xs text-[var(--text-muted)] line-clamp-2">
                        {line.notes}
                      </p>
                    )}
                  </div>
                  <p className="shrink-0 font-black tabular-nums text-[var(--accent-negative)]">
                    ${formatMoney(line.amount)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ResponsiveModal>
  );
}

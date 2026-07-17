'use client';

import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { ResponsiveModal } from '@/components/ui/responsive-modal';
import {
  billCalendarChipClass,
  type DaySnapshot,
} from '@/lib/calendar/day-snapshot';
import { formatMoney, MONEY_EPSILON } from '@/lib/money';
import { projectedIncomeChipClass } from '@/lib/projected-income';
import type { ProjectedIncome } from '@/lib/types';
import { cn } from '@/lib/cn';

type DayOverviewSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: Date | null;
  today: Date;
  snapshot: DaySnapshot | null;
  onIncomeClick: (item: ProjectedIncome) => void;
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
      {children}
    </p>
  );
}

export function DayOverviewSheet({
  open,
  onOpenChange,
  day,
  today,
  snapshot,
  onIncomeClick,
}: DayOverviewSheetProps) {
  if (!day || !snapshot) return null;

  const isToday =
    format(day, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd');
  const isPast = !snapshot.showProjection;
  const hasEvents =
    snapshot.income.length > 0 || snapshot.bills.length > 0;

  const netPositive = snapshot.netForDay >= 0;
  const position = snapshot.position;
  const cumulativePosition = snapshot.cumulativePosition;
  const dayLabel = format(parseISO(snapshot.dayIso), 'MMM d');

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={format(day, 'EEEE, MMMM d')}
    >
      <div className="space-y-5 pb-2" data-vaul-no-drag>
        <div className="flex flex-wrap items-center gap-2">
          {isToday && (
            <span className="rounded-lg bg-blue-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-300">
              Today
            </span>
          )}
          {isPast && !isToday && (
            <span className="rounded-lg bg-[var(--surface-subtle)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Past
            </span>
          )}
          {!isToday && !isPast && (
            <span className="rounded-lg bg-violet-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-300">
              Upcoming
            </span>
          )}
        </div>

        <div className="app-card rounded-2xl border border-[var(--border)] p-4">
          <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">
            Net for this day
          </p>
          <p
            className={cn(
              'text-3xl font-black tabular-nums',
              netPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
            )}
          >
            {netPositive ? '+' : '−'}$
            {formatMoney(Math.abs(snapshot.netForDay))}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            ${formatMoney(snapshot.inflowTotal)} in · $
            {formatMoney(snapshot.outflowTotal)} due
          </p>
        </div>

        {!hasEvents && (
          <div className="flex items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] px-4 py-6 text-[var(--text-muted)]">
            <CalendarDays size={20} className="shrink-0 opacity-60" />
            <p className="text-sm font-medium">Nothing scheduled this day</p>
          </div>
        )}

        {snapshot.income.length > 0 && (
          <section>
            <SectionLabel>Money in</SectionLabel>
            <div className="space-y-2">
              {snapshot.income.map((inc) => (
                <button
                  key={inc.id}
                  type="button"
                  onClick={() => onIncomeClick(inc)}
                  className={cn(
                    'w-full min-h-11 rounded-xl border px-3 py-2.5 text-left touch-manipulation transition-all hover:brightness-95 active:scale-[0.99]',
                    projectedIncomeChipClass(inc.certainty)
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <ArrowDownLeft size={14} className="shrink-0 opacity-70" />
                      <span className="font-bold text-sm truncate">{inc.label}</span>
                    </div>
                    <span className="font-black text-sm tabular-nums shrink-0">
                      +${formatMoney(inc.amount)}
                    </span>
                  </div>
                  {inc.accounts?.name && (
                    <p className="text-[10px] font-medium opacity-75 mt-0.5 ml-6">
                      → {inc.accounts.name}
                    </p>
                  )}
                </button>
              ))}
            </div>
            {snapshot.anticipatedInflow > 0 && (
              <p className="text-[10px] font-bold text-[var(--text-muted)] mt-2">
                ${formatMoney(snapshot.guaranteedInflow)} guaranteed · $
                {formatMoney(snapshot.anticipatedInflow)} anticipated
              </p>
            )}
          </section>
        )}

        {snapshot.bills.length > 0 && (
          <section>
            <SectionLabel>Money out</SectionLabel>
            <div className="space-y-2">
              {snapshot.bills.map((bill) => (
                <Link
                  key={bill.id}
                  href={`/budget?category=${bill.id}`}
                  className={cn(
                    'flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 py-2.5 touch-manipulation transition-all hover:brightness-95 active:scale-[0.99]',
                    billCalendarChipClass(bill, today)
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ArrowUpRight size={14} className="shrink-0 opacity-70" />
                    <span>{bill.emoji}</span>
                    <span className="font-bold text-sm truncate">{bill.name}</span>
                  </div>
                  <span className="font-black text-sm tabular-nums shrink-0">
                    ${formatMoney(bill.target_amount)}
                  </span>
                </Link>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-[var(--surface-subtle)] px-2 py-2">
                <p className="text-[9px] font-bold uppercase text-[var(--text-muted)]">
                  Due
                </p>
                <p className="text-sm font-black tabular-nums text-[var(--text-primary)]">
                  ${formatMoney(snapshot.outflowTotal)}
                </p>
              </div>
              <div className="rounded-xl bg-[var(--surface-subtle)] px-2 py-2">
                <p className="text-[9px] font-bold uppercase text-[var(--text-muted)]">
                  Funded
                </p>
                <p className="text-sm font-black tabular-nums text-[var(--text-primary)]">
                  ${formatMoney(snapshot.billFunded)}
                </p>
              </div>
              <div className="rounded-xl bg-[var(--surface-subtle)] px-2 py-2">
                <p className="text-[9px] font-bold uppercase text-[var(--text-muted)]">
                  Shortfall
                </p>
                <p
                  className={cn(
                    'text-sm font-black tabular-nums',
                    snapshot.outflowTotal - snapshot.billFunded > MONEY_EPSILON
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-[var(--text-primary)]'
                  )}
                >
                  $
                  {formatMoney(
                    Math.max(0, snapshot.outflowTotal - snapshot.billFunded)
                  )}
                </p>
              </div>
            </div>
          </section>
        )}

        {position && (
          <section>
            <SectionLabel>If this day&apos;s income arrives</SectionLabel>
            <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">
              Only expected income scheduled for {dayLabel} — not deposits on
              later days. Envelope balances stay as they are until you assign or
              transact.
            </p>

            <div className="app-card rounded-2xl border border-[var(--border)] p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-300 flex items-center justify-center shrink-0">
                  <Wallet size={18} />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Projected liquid
                  </p>
                  <p className="text-xl font-black tabular-nums text-[var(--text-primary)]">
                    ${formatMoney(position.projectedLiquid)}
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    ${formatMoney(position.liquidCash)} now
                    {position.totalInflowOnDay > MONEY_EPSILON ? (
                      <>
                        {' '}
                        + ${formatMoney(position.totalInflowOnDay)} on {dayLabel}
                      </>
                    ) : (
                      <> · no income on this day</>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 pt-2 border-t border-[var(--border)]">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <TrendingUp size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    {position.totalOverspent > MONEY_EPSILON
                      ? 'Projected assignable'
                      : 'Projected ready to assign'}
                  </p>
                  <p className="text-xl font-black tabular-nums text-[var(--text-primary)]">
                    ${formatMoney(position.displayProjectedRta)}
                  </p>
                  {position.anticipatedInflow > 0 && (
                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                      Guaranteed on this day: $
                      {formatMoney(position.displayConservativeRta)}
                    </p>
                  )}
                </div>
              </div>

              {position.totalOverspent > MONEY_EPSILON && (
                <div className="rounded-xl border border-red-300/35 dark:border-red-500/30 bg-red-500/5 dark:bg-red-500/10 px-3 py-2.5 flex items-start gap-2">
                  <AlertTriangle
                    size={14}
                    className="shrink-0 text-red-600 dark:text-red-400 mt-0.5"
                  />
                  <p className="text-xs text-[var(--text-primary)]">
                    <span className="font-black text-red-600 dark:text-red-400">
                      ${formatMoney(position.totalOverspent)}
                    </span>{' '}
                    overspent · ${formatMoney(position.readyToAssign)} RTA
                    before coverage today
                  </p>
                </div>
              )}
            </div>

            {cumulativePosition && (
              <div className="mt-3 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-subtle)] p-4 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Planning · by end of {dayLabel}
                </p>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                  If every expected deposit from now through {dayLabel} lands
                  (${formatMoney(cumulativePosition.totalInflowOnDay)} total
                  income), not money you have today.
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <p className="text-[var(--text-primary)]">
                    <span className="font-bold text-[var(--text-muted)]">
                      Liquid{' '}
                    </span>
                    <span className="font-black tabular-nums">
                      ${formatMoney(cumulativePosition.projectedLiquid)}
                    </span>
                  </p>
                  <p className="text-[var(--text-primary)]">
                    <span className="font-bold text-[var(--text-muted)]">
                      {cumulativePosition.totalOverspent > MONEY_EPSILON
                        ? 'Assignable '
                        : 'RTA '}
                    </span>
                    <span className="font-black tabular-nums">
                      $
                      {formatMoney(cumulativePosition.displayProjectedRta)}
                    </span>
                  </p>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </ResponsiveModal>
  );
}

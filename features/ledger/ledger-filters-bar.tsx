'use client';

import { useEffect, useRef, useState } from 'react';
import { format, addMonths, parseISO } from 'date-fns';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Select } from '@/components/ui/select';
import { ResponsiveModal } from '@/components/ui/responsive-modal';
import { cn } from '@/lib/cn';
import {
  hasActiveLedgerFilters,
  LEDGER_PERIODS,
  resolveLedgerDateRange,
  type LedgerFiltersState,
} from '@/lib/ledger/filters';
import { formatMoney } from '@/lib/money';
import type { ReportPeriod } from '@/lib/reports/aggregations';

function useIsMobileLayout() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return isMobile;
}

function CategoryMultiFilter({
  selected,
  categories,
  onChange,
}: {
  selected: string[];
  categories: { id: number; name: string; emoji: string | null }[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const filtered = categories.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const label =
    selected.length === 0
      ? 'All Categories'
      : selected.length === 1
        ? (() => {
            const c = categories.find((x) => String(x.id) === selected[0]);
            return c ? `${c.emoji ? `${c.emoji} ` : ''}${c.name}` : '1 category';
          })()
        : `${selected.length} categories`;

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  return (
    <div className="relative w-full lg:min-w-[180px] lg:flex-none" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-left text-sm font-bold text-[var(--text-primary)] touch-manipulation',
          selected.length > 0 && 'border-emerald-500/40'
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          size={16}
          className={cn(
            'shrink-0 text-[var(--text-muted)] transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-40 mt-2 max-h-72 overflow-hidden rounded-2xl border border-[var(--border)] app-card shadow-xl sm:min-w-[260px]">
          <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-subtle)] p-2">
            <Search size={14} className="text-[var(--text-muted)]" />
            <input
              autoFocus
              type="text"
              placeholder="Filter categories..."
              className="w-full bg-transparent text-sm font-bold outline-none text-[var(--text-primary)] placeholder-[var(--text-muted)]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {selected.length > 0 && (
              <button
                type="button"
                className="shrink-0 text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                onClick={() => onChange([])}
              >
                Clear
              </button>
            )}
          </div>
          <div className="max-h-56 overflow-y-auto hide-scrollbar py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm font-bold text-[var(--text-muted)]">
                No matches
              </p>
            ) : (
              filtered.map((c) => {
                const id = String(c.id);
                const on = selected.includes(id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(id)}
                    className={cn(
                      'flex w-full min-h-11 items-center gap-2 px-3 text-left text-sm font-bold touch-manipulation',
                      on
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                        on
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-[var(--border)]'
                      )}
                    >
                      {on && <Check size={12} strokeWidth={3} />}
                    </span>
                    {c.emoji && <span>{c.emoji}</span>}
                    <span className="truncate">{c.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LedgerMoreFiltersFields({
  filters,
  onPatch,
  categoryGroups,
  payeeSuggestions,
  showTransferDirection,
  showAccountType,
}: {
  filters: LedgerFiltersState;
  onPatch: (partial: Partial<LedgerFiltersState>) => void;
  accounts: { id: number; name: string }[];
  categories: { id: number; name: string; emoji: string | null; group_id: number }[];
  categoryGroups: { id: number; name: string }[];
  payeeSuggestions: string[];
  showTransferDirection: boolean;
  showAccountType: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-vaul-no-drag>
      <div>
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Category group
        </label>
        <Select
          className="min-h-11 w-full"
          value={filters.filterCategoryGroup}
          onChange={(e) => onPatch({ filterCategoryGroup: e.target.value })}
        >
          <option value="All">All groups</option>
          {categoryGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </div>
      {showAccountType && (
        <div>
          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Account type
          </label>
          <Select
            className="min-h-11 w-full"
            value={filters.accountTypeFilter}
            onChange={(e) =>
              onPatch({
                accountTypeFilter: e.target.value as LedgerFiltersState['accountTypeFilter'],
              })
            }
          >
            <option value="all">All account types</option>
            <option value="liquid">Liquid only</option>
            <option value="credit">Credit cards only</option>
          </Select>
        </div>
      )}
      {showTransferDirection && (
        <div>
          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
            Transfer direction
          </label>
          <Select
            className="min-h-11 w-full"
            value={filters.transferDirection}
            onChange={(e) =>
              onPatch({
                transferDirection: e.target.value as LedgerFiltersState['transferDirection'],
              })
            }
          >
            <option value="all">All activity</option>
            <option value="out">Outflows only</option>
            <option value="in">Inflows only</option>
          </Select>
        </div>
      )}
      <div>
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Payee
        </label>
        <Select
          className="min-h-11 w-full"
          value={filters.filterPayee}
          onChange={(e) => onPatch({ filterPayee: e.target.value })}
        >
          <option value="">Any payee</option>
          {payeeSuggestions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Special
        </label>
        <Select
          className="min-h-11 w-full"
          value={filters.specialFilter}
          onChange={(e) =>
            onPatch({
              specialFilter: e.target.value as LedgerFiltersState['specialFilter'],
            })
          }
        >
          <option value="none">No special filter</option>
          <option value="splits">Splits only</option>
          <option value="uncategorized">Uncategorized only</option>
          <option value="has-notes">Has notes</option>
        </Select>
      </div>
      <div>
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Min amount
        </label>
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Any"
          className="min-h-11 w-full rounded-xl border border-[var(--border)] p-2.5 text-sm font-bold app-input"
          value={filters.amountMin}
          onChange={(e) => onPatch({ amountMin: e.target.value })}
        />
      </div>
      <div>
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
          Max amount
        </label>
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Any"
          className="min-h-11 w-full rounded-xl border border-[var(--border)] p-2.5 text-sm font-bold app-input"
          value={filters.amountMax}
          onChange={(e) => onPatch({ amountMax: e.target.value })}
        />
      </div>
    </div>
  );
}

export function LedgerFiltersBar({
  filters,
  onPatch,
  onReset,
  accounts,
  categories,
  categoryGroups,
  payeeSuggestions,
}: {
  filters: LedgerFiltersState;
  onPatch: (partial: Partial<LedgerFiltersState>) => void;
  onReset: () => void;
  accounts: { id: number; name: string }[];
  categories: { id: number; name: string; emoji: string | null; group_id: number }[];
  categoryGroups: { id: number; name: string }[];
  payeeSuggestions: string[];
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const isMobile = useIsMobileLayout();
  const active = hasActiveLedgerFilters(filters);
  const dateRange = resolveLedgerDateRange(filters);
  const showTransferDirection = filters.filterAccount !== 'All';
  const showAccountType = filters.filterAccount === 'All';

  const moreFieldsActive =
    filters.filterCategoryGroup !== 'All' ||
    filters.accountTypeFilter !== 'all' ||
    filters.transferDirection !== 'all' ||
    filters.filterPayee !== '' ||
    filters.specialFilter !== 'none' ||
    filters.amountMin !== '' ||
    filters.amountMax !== '';

  function shiftMonth(delta: number) {
    const base = parseISO(`${filters.selectedMonth}-01`);
    onPatch({ selectedMonth: format(addMonths(base, delta), 'yyyy-MM') });
  }

  function selectDatePreset(period: ReportPeriod) {
    onPatch({ dateMode: 'preset', period });
  }

  const moreFields = (
    <LedgerMoreFiltersFields
      filters={filters}
      onPatch={onPatch}
      accounts={accounts}
      categories={categories}
      categoryGroups={categoryGroups}
      payeeSuggestions={payeeSuggestions}
      showTransferDirection={showTransferDirection}
      showAccountType={showAccountType}
    />
  );

  return (
    <div className="mb-6 space-y-3">
      <div className="app-card rounded-2xl border border-[var(--border)] p-3 shadow-sm md:p-4">
        <div className="relative mb-3">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            size={16}
          />
          <input
            placeholder="Search payees, notes, categories..."
            className="min-h-11 w-full rounded-xl border border-[var(--border)] py-2.5 pl-9 pr-3 text-base font-bold text-[var(--text-primary)] outline-none transition-all placeholder-[var(--text-muted)] app-input focus:border-blue-300 sm:text-sm"
            value={filters.searchQuery}
            onChange={(e) => onPatch({ searchQuery: e.target.value })}
          />
        </div>

        <div className="-mx-3 mb-3 px-3 md:mx-0 md:px-0">
          <div
            className="flex gap-2 overflow-x-auto hide-scrollbar pb-1 snap-x snap-mandatory"
            role="tablist"
            aria-label="Ledger date range"
          >
            <button
              type="button"
              role="tab"
              aria-selected={filters.dateMode === 'all'}
              onClick={() => onPatch({ dateMode: 'all' })}
              className={cn(
                'min-h-11 shrink-0 snap-start touch-manipulation rounded-xl px-4 text-sm font-bold whitespace-nowrap transition-colors',
                filters.dateMode === 'all'
                  ? 'bg-[var(--text-primary)] text-[var(--canvas)]'
                  : 'glass-card py-2 text-[var(--text-muted)]'
              )}
            >
              <span className="sm:hidden">All</span>
              <span className="hidden sm:inline">All time</span>
            </button>
            {LEDGER_PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={filters.dateMode === 'preset' && filters.period === p.id}
                onClick={() => selectDatePreset(p.id)}
                className={cn(
                  'min-h-11 shrink-0 snap-start touch-manipulation rounded-xl px-4 text-sm font-bold whitespace-nowrap transition-colors',
                  filters.dateMode === 'preset' && filters.period === p.id
                    ? 'bg-[var(--text-primary)] text-[var(--canvas)]'
                    : 'glass-card py-2 text-[var(--text-muted)]'
                )}
              >
                <span className="sm:hidden">{p.shortLabel ?? p.label}</span>
                <span className="hidden sm:inline">{p.label}</span>
              </button>
            ))}
            <button
              type="button"
              role="tab"
              aria-selected={filters.dateMode === 'custom'}
              onClick={() => onPatch({ dateMode: 'custom' })}
              className={cn(
                'min-h-11 shrink-0 snap-start touch-manipulation rounded-xl px-4 text-sm font-bold whitespace-nowrap transition-colors',
                filters.dateMode === 'custom'
                  ? 'bg-[var(--text-primary)] text-[var(--canvas)]'
                  : 'glass-card py-2 text-[var(--text-muted)]'
              )}
            >
              Custom
            </button>
          </div>
        </div>

        {filters.dateMode === 'preset' && filters.period === 'month' && (
          <div className="mb-3 flex items-center justify-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-xl glass-card"
              aria-label="Previous month"
            >
              <ChevronLeft size={20} />
            </button>
            <input
              type="month"
              value={filters.selectedMonth}
              onChange={(e) => onPatch({ selectedMonth: e.target.value })}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold sm:flex-none sm:px-4"
            />
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-xl glass-card"
              aria-label="Next month"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        )}

        {filters.dateMode === 'custom' && (
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <input
              type="date"
              value={filters.customDateStart ?? ''}
              onChange={(e) =>
                onPatch({ customDateStart: e.target.value || null, dateMode: 'custom' })
              }
              className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold"
            />
            <span className="text-center text-sm font-bold text-[var(--text-muted)] sm:px-1">to</span>
            <input
              type="date"
              value={filters.customDateEnd ?? ''}
              onChange={(e) =>
                onPatch({ customDateEnd: e.target.value || null, dateMode: 'custom' })
              }
              className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-bold"
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap">
          <Select
            className="min-h-11 w-full lg:min-w-[140px] lg:flex-none"
            value={filters.filterType}
            onChange={(e) =>
              onPatch({ filterType: e.target.value as LedgerFiltersState['filterType'] })
            }
          >
            <option value="All">All Types</option>
            <option value="Expense">Expenses Only</option>
            <option value="Income">Income Only</option>
            <option value="Transfer">Transfers Only</option>
          </Select>
          <Select
            className="min-h-11 w-full lg:min-w-[140px] lg:flex-none"
            value={filters.filterAccount}
            onChange={(e) =>
              onPatch({
                filterAccount: e.target.value,
                transferDirection: 'all',
              })
            }
          >
            <option value="All">All Accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <CategoryMultiFilter
            selected={filters.filterCategories}
            categories={categories}
            onChange={(filterCategories) => onPatch({ filterCategories })}
          />
          <div className="flex gap-2 sm:col-span-2 lg:col-span-1 lg:contents">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={cn(
                'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 text-sm font-bold transition-colors touch-manipulation lg:flex-none',
                moreOpen || moreFieldsActive
                  ? 'bg-[var(--text-primary)] text-[var(--canvas)]'
                  : 'bg-[var(--surface)] text-[var(--text-muted)]'
              )}
            >
              <SlidersHorizontal size={16} />
              More
              {moreFieldsActive && !moreOpen && (
                <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-black text-white">
                  •
                </span>
              )}
            </button>
            {active && (
              <button
                type="button"
                onClick={onReset}
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-xl border border-[var(--border)] px-3 text-sm font-bold text-[var(--text-muted)] touch-manipulation hover:text-[var(--text-primary)] lg:min-w-0 lg:px-4"
                title="Clear all filters"
              >
                <X size={16} />
                <span className="hidden sm:inline">Clear</span>
              </button>
            )}
          </div>
        </div>

        {filters.filterCategories.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {filters.filterCategories.map((id) => {
              const c = categories.find((x) => String(x.id) === id);
              if (!c) return null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() =>
                    onPatch({
                      filterCategories: filters.filterCategories.filter((x) => x !== id),
                    })
                  }
                  className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-emerald-500/15 px-2 text-xs font-bold text-emerald-700 touch-manipulation dark:text-emerald-400"
                >
                  {c.emoji ? `${c.emoji} ` : ''}
                  {c.name}
                  <X size={12} />
                </button>
              );
            })}
          </div>
        )}

        {moreOpen && !isMobile && (
          <div className="mt-3 border-t border-[var(--border)] pt-3">{moreFields}</div>
        )}
      </div>

      <ResponsiveModal
        open={moreOpen && isMobile}
        onOpenChange={setMoreOpen}
        title="More filters"
      >
        <div className="space-y-4" data-vaul-no-drag>
          {moreFields}
          <button
            type="button"
            onClick={() => setMoreOpen(false)}
            className="min-h-11 w-full rounded-xl bg-[var(--text-primary)] text-sm font-bold text-[var(--canvas)] touch-manipulation"
          >
            Done
          </button>
        </div>
      </ResponsiveModal>

      {dateRange && (
        <p className="px-1 text-xs font-bold text-[var(--text-muted)]">{dateRange.label}</p>
      )}
    </div>
  );
}

export function LedgerSummaryStrip({
  totals,
  totalCount,
  filteredCount,
  active,
}: {
  totals: { income: number; expense: number; net: number };
  totalCount: number;
  filteredCount: number;
  active: boolean;
}) {
  if (!active && filteredCount === totalCount) return null;

  const cards = [
    {
      label: 'Income',
      value: `+$${formatMoney(totals.income)}`,
      className: 'text-emerald-500',
    },
    {
      label: 'Expenses',
      value: `-$${formatMoney(totals.expense)}`,
      className: 'text-red-500',
    },
    {
      label: 'Net',
      value: `${totals.net >= 0 ? '+' : '-'}$${formatMoney(Math.abs(totals.net))}`,
      className: totals.net >= 0 ? 'text-emerald-500' : 'text-red-500',
    },
    {
      label: 'Showing',
      value: (
        <>
          {filteredCount}
          <span className="text-sm font-bold text-[var(--text-muted)]"> / {totalCount}</span>
        </>
      ),
      className: 'text-[var(--text-primary)]',
    },
  ];

  return (
    <div className="-mx-4 mb-4 px-4 md:mx-0 md:px-0">
      <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1 snap-x snap-mandatory md:grid md:grid-cols-4 md:overflow-visible md:pb-0">
        {cards.map((card) => (
          <div
            key={card.label}
            className="min-w-[8.5rem] shrink-0 snap-start app-card-subtle rounded-xl border border-[var(--border)] p-3 md:min-w-0"
          >
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              {card.label}
            </p>
            <p className={cn('text-base font-black tabular-nums sm:text-lg', card.className)}>
              {card.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

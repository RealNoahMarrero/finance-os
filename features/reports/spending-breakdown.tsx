'use client';

import { useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { CategoryDonut, formatCategoryChartLabel } from '@/components/charts/category-donut';
import { GlassCard } from '@/components/ui/glass-card';
import { cn } from '@/lib/cn';
import type { SpendingView } from '@/hooks/use-insights-preferences';
import type { CategorySpend, GroupedSpending } from '@/lib/reports/aggregations';

function SpendBar({ amount, max }: { amount: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (amount / max) * 100) : 0;
  return (
    <div className="h-1.5 flex-1 max-w-[120px] overflow-hidden rounded-full bg-[var(--surface-subtle)]">
      <div
        className="h-full rounded-full bg-red-500/70"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function SpendingBreakdown({
  grouped,
  allCategories,
  periodExpense,
  view,
  onViewChange,
  selectedGroupId,
  onSelectedGroupIdChange,
  expandedGroupIds,
  onToggleGroup,
}: {
  grouped: GroupedSpending[];
  allCategories: CategorySpend[];
  periodExpense: number;
  view: SpendingView;
  onViewChange: (view: SpendingView) => void;
  selectedGroupId: number | 'all';
  onSelectedGroupIdChange: (id: number | 'all') => void;
  expandedGroupIds: number[];
  onToggleGroup: (groupId: number) => void;
}) {
  const expandedSet = useMemo(() => new Set(expandedGroupIds), [expandedGroupIds]);

  const maxCategory = useMemo(
    () => Math.max(...allCategories.map((c) => c.total), 0),
    [allCategories]
  );

  const donutData = useMemo(() => {
    if (selectedGroupId === 'all') return allCategories;
    const group = grouped.find((g) => g.groupId === selectedGroupId);
    return group?.categories ?? allCategories;
  }, [allCategories, grouped, selectedGroupId]);

  const donutTitle =
    selectedGroupId === 'all'
      ? 'By category'
      : grouped.find((g) => g.groupId === selectedGroupId)?.groupName ?? 'By category';

  if (allCategories.length === 0) {
    return (
      <GlassCard>
        <p className="py-12 text-center text-sm text-[var(--text-muted)]">
          No categorized expenses in this period.
        </p>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: 'groups' as const, label: 'By group' },
            { id: 'categories' as const, label: 'By category' },
          ] as const
        ).map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => onViewChange(v.id)}
            className={cn(
              'min-h-10 rounded-xl px-4 text-sm font-bold touch-manipulation transition-colors',
              view === v.id
                ? 'bg-[var(--text-primary)] text-[var(--canvas)]'
                : 'glass-card text-[var(--text-muted)]'
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <GlassCard className="flex h-full flex-col">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold">{donutTitle}</h3>
            {view === 'groups' && grouped.length > 1 && (
              <select
                value={selectedGroupId === 'all' ? 'all' : String(selectedGroupId)}
                onChange={(e) => {
                  const val = e.target.value;
                  onSelectedGroupIdChange(val === 'all' ? 'all' : parseInt(val, 10));
                }}
                className="max-w-[10rem] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs font-bold"
              >
                <option value="all">All categories</option>
                {grouped.map((g) => (
                  <option key={g.groupId} value={g.groupId}>
                    {g.groupName}
                  </option>
                ))}
              </select>
            )}
          </div>
          <CategoryDonut data={donutData} />
        </GlassCard>

        <GlassCard className="flex h-full flex-col">
          <h3 className="mb-4 text-lg font-bold">
            {view === 'groups' ? 'Groups & categories' : 'All categories'}
          </h3>
          {view === 'groups' ? (
            <ul className="space-y-2">
              {grouped.map((g) => {
                const open = expandedSet.has(g.groupId);
                const groupPct =
                  periodExpense > 0 ? Math.round((g.total / periodExpense) * 100) : 0;
                return (
                  <li
                    key={g.groupId}
                    className="rounded-xl border border-[var(--border)] overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => onToggleGroup(g.groupId)}
                      className="flex w-full items-center gap-3 p-3 text-left touch-manipulation hover:bg-[var(--surface-subtle)]"
                    >
                      {open ? (
                        <ChevronDown size={18} className="shrink-0 text-[var(--text-muted)]" />
                      ) : (
                        <ChevronRight size={18} className="shrink-0 text-[var(--text-muted)]" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-bold text-[var(--text-primary)]">
                        {g.groupName}
                      </span>
                      <span className="shrink-0 text-[10px] font-bold text-[var(--text-muted)]">
                        {groupPct}%
                      </span>
                      <span className="shrink-0 font-black text-[var(--accent-negative)] tabular-nums">
                        ${formatMoney(g.total)}
                      </span>
                    </button>
                    {open && (
                      <ul className="border-t border-[var(--border)] bg-[var(--surface-subtle)]/50 px-3 pb-2">
                        {g.categories.map((c) => {
                          const catPct =
                            g.total > 0 ? Math.round((c.total / g.total) * 100) : 0;
                          return (
                            <li
                              key={c.name}
                              className="flex items-center gap-2 py-2 pl-6 text-sm"
                            >
                              <span className="min-w-0 flex-1 truncate font-semibold text-[var(--text-primary)]">
                                {formatCategoryChartLabel(c.emoji, c.name)}
                              </span>
                              <span className="shrink-0 text-[10px] font-bold text-[var(--text-muted)]">
                                {catPct}% of group
                              </span>
                              <span className="shrink-0 font-black text-[var(--accent-negative)] tabular-nums">
                                ${formatMoney(c.total)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="space-y-3">
              {allCategories.map((c) => {
                const pct =
                  periodExpense > 0 ? Math.round((c.total / periodExpense) * 100) : 0;
                return (
                  <li key={c.name} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate font-semibold text-[var(--text-primary)]">
                      {formatCategoryChartLabel(c.emoji, c.name)}
                    </span>
                    <SpendBar amount={c.total} max={maxCategory} />
                    <span className="shrink-0 w-8 text-right text-[10px] font-bold text-[var(--text-muted)]">
                      {pct}%
                    </span>
                    <span className="shrink-0 font-black text-[var(--accent-negative)] tabular-nums">
                      ${formatMoney(c.total)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-4 text-[10px] font-bold text-[var(--text-muted)]">
            Tap a group to expand and see envelopes like Dining Out, Groceries, etc.
          </p>
        </GlassCard>
      </div>
    </div>
  );
}

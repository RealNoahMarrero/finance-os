'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import type { CategorySpend } from '@/lib/reports/aggregations';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/cn';

export const CATEGORY_CHART_PALETTE = [
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#f59e0b',
  '#f43f5e',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
];

export function formatCategoryChartLabel(emoji: string | null | undefined, name: string) {
  const label = name.trim();
  if (emoji?.trim()) return `${emoji.trim()} ${label}`;
  return label;
}

function DonutTooltip({
  active,
  payload,
  valueColor,
}: {
  active?: boolean;
  payload?: { payload?: { name: string; value: number } }[];
  valueColor: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 shadow-lg">
      <p className="text-sm font-bold text-[var(--text-primary)]">{row.name}</p>
      <p className={cn('text-sm font-black tabular-nums', valueColor)}>${formatMoney(row.value)}</p>
    </div>
  );
}

export function CategoryDonut({
  data,
  emptyMessage = 'No categorized spending in this period.',
  valueColor = 'text-[var(--accent-negative)]',
}: {
  data: CategorySpend[];
  emptyMessage?: string;
  valueColor?: string;
}) {
  if (data.length === 0) {
    return (
      <p className="py-12 text-center text-sm font-medium text-[var(--text-muted)]">
        {emptyMessage}
      </p>
    );
  }

  const chartData = data.slice(0, 8).map((d) => ({
    name: formatCategoryChartLabel(d.emoji, d.name),
    value: d.total,
  }));

  const total = data.reduce((s, d) => s + d.total, 0);

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={56}
            outerRadius={80}
            paddingAngle={3}
            dataKey="value"
            nameKey="name"
          >
            {chartData.map((_, i) => (
              <Cell
                key={i}
                fill={CATEGORY_CHART_PALETTE[i % CATEGORY_CHART_PALETTE.length]}
                stroke="transparent"
              />
            ))}
          </Pie>
          <Tooltip content={<DonutTooltip valueColor={valueColor} />} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="mt-4 space-y-2">
        {chartData.map((row, i) => {
          const pct = total > 0 ? Math.round((row.value / total) * 100) : 0;
          return (
            <li key={row.name} className="flex items-center gap-2 text-xs font-bold">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: CATEGORY_CHART_PALETTE[i % CATEGORY_CHART_PALETTE.length] }}
              />
              <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{row.name}</span>
              <span className={`shrink-0 tabular-nums ${valueColor}`}>${formatMoney(row.value)}</span>
              <span className="shrink-0 w-8 text-right text-[var(--text-muted)]">{pct}%</span>
            </li>
          );
        })}
      </ul>
      {data.length > 8 && (
        <p className="mt-2 text-center text-[10px] font-bold text-[var(--text-muted)]">
          Chart shows top 8 — see full list below
        </p>
      )}
    </div>
  );
}

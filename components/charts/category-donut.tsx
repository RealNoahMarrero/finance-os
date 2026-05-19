'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import type { CategorySpend } from '@/lib/reports/aggregations';
import { useChartColors } from '@/components/charts/chart-theme';

const PALETTE = [
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#f59e0b',
  '#f43f5e',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
];

export function CategoryDonut({ data }: { data: CategorySpend[] }) {
  const colors = useChartColors();

  if (data.length === 0) {
    return (
      <p className="py-12 text-center text-sm font-medium text-[var(--text-muted)]">
        No categorized spending in this period.
      </p>
    );
  }

  const chartData = data.slice(0, 8).map((d) => ({
    name: `${d.emoji || ''} ${d.name}`.trim(),
    value: d.total,
  }));

  return (
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
        >
          {chartData.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="transparent" />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            borderRadius: 12,
            border: `1px solid ${colors.grid}`,
            background: 'var(--surface-glass)',
          }}
          formatter={(value) => [`$${Number(value ?? 0).toFixed(2)}`, '']}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

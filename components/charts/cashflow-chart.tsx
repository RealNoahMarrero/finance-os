'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import type { MonthlyCashflow } from '@/lib/reports/aggregations';
import { useChartColors } from '@/components/charts/chart-theme';

export function CashflowChart({ data }: { data: MonthlyCashflow[] }) {
  const colors = useChartColors();
  const chartData = data.map((d) => ({
    ...d,
    label: format(parseISO(`${d.month}-01`), 'MMM'),
  }));

  if (chartData.length === 0) {
    return (
      <p className="py-12 text-center text-sm font-medium text-[var(--text-muted)]">
        No transaction data for this period.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: colors.text, fontSize: 11, fontWeight: 600 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: colors.text, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${v}`}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--surface-glass)',
          }}
          formatter={(value) => [`$${Number(value ?? 0).toFixed(2)}`, '']}
        />
        <Bar dataKey="income" fill={colors.income} radius={[6, 6, 0, 0]} maxBarSize={32} />
        <Bar dataKey="expense" fill={colors.expense} radius={[6, 6, 0, 0]} maxBarSize={32} />
      </BarChart>
    </ResponsiveContainer>
  );
}

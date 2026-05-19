'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { format, addMonths } from 'date-fns';
import type { DebtSimulationResult } from '@/lib/reports/debt-simulator';
import { useChartColors } from '@/components/charts/chart-theme';

export function DebtTimelineChart({
  results,
  totalMonthlyPower,
}: {
  results: DebtSimulationResult[];
  totalMonthlyPower: number;
}) {
  const colors = useChartColors();

  if (results.length === 0 || totalMonthlyPower <= 0) return null;

  const maxMonth = Math.max(...results.map((r) => (r.payoffMonth > 0 ? r.payoffMonth : 0)), 1);
  const points: { month: string; balance: number }[] = [];
  let totalBalance = results.reduce((s, d) => s + Number(d.balance), 0);

  for (let m = 0; m <= maxMonth; m++) {
    points.push({
      month: format(addMonths(new Date(), m), 'MMM yy'),
      balance: Math.max(0, totalBalance),
    });
    const paidOff = results.filter((r) => r.payoffMonth === m + 1);
    paidOff.forEach((r) => {
      totalBalance -= Number(r.balance);
    });
    totalBalance = Math.max(0, totalBalance - totalMonthlyPower * 0.3);
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={points.slice(0, 24)} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="debtGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.expense} stopOpacity={0.4} />
            <stop offset="100%" stopColor={colors.expense} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
        <XAxis dataKey="month" tick={{ fill: colors.text, fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: colors.text, fontSize: 10 }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ borderRadius: 12, background: 'var(--surface-glass)' }}
          formatter={(v) => [`$${Number(v ?? 0).toFixed(0)}`, 'Balance']}
        />
        <Area
          type="monotone"
          dataKey="balance"
          stroke={colors.expense}
          fill="url(#debtGrad)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

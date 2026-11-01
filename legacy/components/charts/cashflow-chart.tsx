'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import type { MonthlyCashflow } from '@/lib/reports/aggregations';
import { formatMoney } from '@/lib/money';
import { useChartColors } from '@/components/charts/chart-theme';
function CashflowTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: {
    dataKey?: string;
    value?: number;
    payload?: { monthLabel?: string };
  }[];
}) {
  if (!active || !payload?.length) return null;
  const monthLabel = payload[0]?.payload?.monthLabel ?? 'Month';
  const income = payload.find((p) => p.dataKey === 'income');
  const expense = payload.find((p) => p.dataKey === 'expense');

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 shadow-lg">
      <p className="mb-1 text-sm font-bold text-[var(--text-primary)]">{monthLabel}</p>
      {income != null && (
        <p className="text-xs font-bold text-[var(--accent-positive)]">
          Income: ${formatMoney(Number(income.value ?? 0))}
        </p>
      )}
      {expense != null && (
        <p className="text-xs font-bold text-[var(--accent-negative)]">
          Expenses: ${formatMoney(Number(expense.value ?? 0))}
        </p>
      )}
    </div>
  );
}

export function CashflowChart({ data }: { data: MonthlyCashflow[] }) {
  const colors = useChartColors();
  const chartData = data.map((d) => ({
    ...d,
    label: format(parseISO(`${d.month}-01`), 'MMM'),
    monthLabel: format(parseISO(`${d.month}-01`), 'MMMM yyyy'),
  }));

  if (chartData.length === 0) {
    return (
      <p className="py-12 text-center text-sm font-medium text-[var(--text-muted)]">
        No transaction data for this period.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
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
          tickFormatter={(v) => `$${formatMoney(Number(v))}`}
        />
        <Tooltip content={<CashflowTooltip />} />
        <Legend
          verticalAlign="bottom"
          height={36}
          formatter={(value) => (
            <span className="text-xs font-bold text-[var(--text-primary)]">{value}</span>
          )}
        />
        <Bar
          dataKey="income"
          name="Income"
          fill={colors.income}
          radius={[6, 6, 0, 0]}
          maxBarSize={32}
        />
        <Bar
          dataKey="expense"
          name="Expenses"
          fill={colors.expense}
          radius={[6, 6, 0, 0]}
          maxBarSize={32}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

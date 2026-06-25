'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import type { CreditScoreEntry } from '@/lib/types';
import { useChartColors } from '@/components/charts/chart-theme';

function ScoreTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { value?: number; payload?: { dateLabel?: string } }[];
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 shadow-lg">
      <p className="text-sm font-bold text-[var(--text-primary)]">
        {point.payload?.dateLabel ?? 'Date'}
      </p>
      <p className="text-xs font-black text-[var(--accent-positive)]">
        Score: {point.value}
      </p>
    </div>
  );
}

export function CreditScoreChart({ entries }: { entries: CreditScoreEntry[] }) {
  const colors = useChartColors();
  const chartData = entries.map((e) => ({
    score: e.score,
    label: format(parseISO(e.recorded_date), 'MMM yy'),
    dateLabel: format(parseISO(e.recorded_date), 'MMM d, yyyy'),
  }));

  if (chartData.length === 0) {
    return (
      <p className="py-8 text-center text-sm font-medium text-[var(--text-muted)]">
        No history yet for this score.
      </p>
    );
  }

  if (chartData.length === 1) {
    return (
      <p className="py-8 text-center text-sm font-medium text-[var(--text-muted)]">
        Add another entry to see a trend line.
      </p>
    );
  }

  return (
    <div className="-mx-1 w-[calc(100%+0.5rem)] sm:mx-0 sm:w-full">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: colors.text, fontSize: 11, fontWeight: 600 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={['dataMin - 10', 'dataMax + 10']}
          tick={{ fill: colors.text, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<ScoreTooltip />} />
        <Line
          type="monotone"
          dataKey="score"
          stroke={colors.income}
          strokeWidth={2.5}
          dot={{ r: 4, fill: colors.income }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
    </div>
  );
}

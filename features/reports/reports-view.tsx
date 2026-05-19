'use client';

import { useEffect, useState, useMemo } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { format, addMonths } from 'date-fns';
import { Snowflake, Flame, Trophy, TrendingDown } from 'lucide-react';
import Link from 'next/link';
import { formatMoney, snapMoney } from '@/lib/money';
import { fetchAccounts } from '@/lib/queries/accounts';
import { fetchCategories, fetchDebtCategories } from '@/lib/queries/categories';
import { fetchTransactions } from '@/lib/queries/transactions';
import {
  aggregateMonthlyCashflow,
  aggregateSpendingByCategory,
  aggregateTopPayees,
  computeLiquidCash,
  computeNetWorth,
  computeReadyToAssign,
  type ReportPeriod,
} from '@/lib/reports/aggregations';
import {
  simulateDebtPayoff,
  categoriesToDebtInput,
  type PayoffStrategy,
} from '@/lib/reports/debt-simulator';
import { PageHeader } from '@/components/layout/page-header';
import { PageSkeleton } from '@/components/ui/skeleton';
import { StatHero } from '@/components/ui/stat-hero';
import { GlassCard } from '@/components/ui/glass-card';
import { CashflowChart } from '@/components/charts/cashflow-chart';
import { CategoryDonut } from '@/components/charts/category-donut';
import { DebtTimelineChart } from '@/components/charts/debt-timeline-chart';
import { cn } from '@/lib/cn';

const PERIODS: { id: ReportPeriod; label: string }[] = [
  { id: '30d', label: '30D' },
  { id: '90d', label: '90D' },
  { id: 'ytd', label: 'YTD' },
  { id: '12mo', label: '12M' },
];

export function ReportsView() {
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<ReportPeriod>('12mo');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [debts, setDebts] = useState<any[]>([]);
  const [extraPayment, setExtraPayment] = useState('');
  const [strategy, setStrategy] = useState<PayoffStrategy>('snowball');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [accs, cats, txns, debtCats] = await Promise.all([
        fetchAccounts(),
        fetchCategories(),
        fetchTransactions(),
        fetchDebtCategories(),
      ]);
      if (accs.data) setAccounts(accs.data);
      if (cats.data) setCategories(cats.data);
      if (txns.data) setTransactions(txns.data);
      if (debtCats.data) setDebts(debtCats.data);
      setLoading(false);
    })();
  }, []);

  const netWorth = useMemo(() => computeNetWorth(accounts), [accounts]);
  const liquidCash = useMemo(() => computeLiquidCash(accounts), [accounts]);
  const readyToAssign = useMemo(
    () => computeReadyToAssign(liquidCash, categories),
    [liquidCash, categories]
  );

  const cashflow = useMemo(
    () => aggregateMonthlyCashflow(transactions, period),
    [transactions, period]
  );
  const spending = useMemo(
    () => aggregateSpendingByCategory(transactions, categories, period),
    [transactions, categories, period]
  );
  const topPayees = useMemo(
    () => aggregateTopPayees(transactions, period),
    [transactions, period]
  );

  const totalMinimums = debts.reduce((s, d) => s + (Number(d.target_amount) || 0), 0);
  const totalMonthlyPower = totalMinimums + (parseFloat(extraPayment) || 0);
  const totalDebt = snapMoney(debts.reduce((s, d) => s + Number(d.balance), 0));
  const simulationResults = simulateDebtPayoff(
    categoriesToDebtInput(debts),
    totalMonthlyPower,
    strategy
  );
  const finalDebt =
    simulationResults.length > 0
      ? simulationResults.reduce((latest, c) =>
          c.payoffMonth > latest.payoffMonth ? c : latest
        )
      : null;
  const debtFreeDate =
    finalDebt && finalDebt.payoffMonth > 0
      ? addMonths(new Date(), finalDebt.payoffMonth)
      : null;

  if (loading) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="Insights"
        subtitle="Reports, trends, and debt payoff planning"
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPeriod(p.id)}
            className={cn(
              'min-h-10 rounded-xl px-4 text-sm font-bold touch-manipulation transition-colors',
              period === p.id
                ? 'bg-[var(--text-primary)] text-[var(--canvas)]'
                : 'glass-card py-2 text-[var(--text-muted)]'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatHero label="Net Worth" value={`$${formatMoney(netWorth)}`} variant="hero" />
        <StatHero label="Liquid Cash" value={`$${formatMoney(liquidCash)}`} />
        <StatHero
          label="Ready to Assign"
          value={`$${formatMoney(readyToAssign)}`}
          variant={readyToAssign < 0 ? 'negative' : 'positive'}
        />
      </div>

      <Tabs.Root defaultValue="overview" className="space-y-6">
        <Tabs.List className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
          {['overview', 'spending', 'debt'].map((tab) => (
            <Tabs.Trigger
              key={tab}
              value={tab}
              className="min-h-10 shrink-0 rounded-xl px-4 text-sm font-bold capitalize text-[var(--text-muted)] data-[state=active]:bg-[var(--text-primary)] data-[state=active]:text-[var(--canvas)] touch-manipulation"
            >
              {tab}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="overview" className="space-y-6">
          <GlassCard>
            <h3 className="mb-4 text-lg font-bold">Cashflow</h3>
            <CashflowChart data={cashflow} />
            <div className="mt-4 flex justify-center gap-6 text-xs font-bold">
              <span className="flex items-center gap-2 text-[var(--accent-positive)]">
                <span className="h-2 w-2 rounded-full bg-[var(--chart-income)]" /> Income
              </span>
              <span className="flex items-center gap-2 text-[var(--accent-negative)]">
                <span className="h-2 w-2 rounded-full bg-[var(--chart-expense)]" /> Expenses
              </span>
            </div>
          </GlassCard>

          <GlassCard>
            <h3 className="mb-4 text-lg font-bold">Account balances</h3>
            <div className="space-y-3">
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-4">
                  <span className="font-semibold text-[var(--text-primary)]">{a.name}</span>
                  <span className="font-black">
                    {snapMoney(a.balance) < 0 ? '-' : ''}${formatMoney(Math.abs(a.balance))}
                  </span>
                </div>
              ))}
            </div>
          </GlassCard>
        </Tabs.Content>

        <Tabs.Content value="spending" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <GlassCard>
              <h3 className="mb-4 text-lg font-bold">By category</h3>
              <CategoryDonut data={spending} />
            </GlassCard>
            <GlassCard>
              <h3 className="mb-4 text-lg font-bold">Top payees</h3>
              {topPayees.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--text-muted)]">No expenses yet.</p>
              ) : (
                <ul className="space-y-3">
                  {topPayees.map((p) => (
                    <li key={p.payee} className="flex justify-between gap-4">
                      <span className="truncate font-semibold">{p.payee}</span>
                      <span className="font-black text-[var(--accent-negative)]">
                        ${formatMoney(p.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>
          </div>
        </Tabs.Content>

        <Tabs.Content value="debt" className="space-y-6">
          {debts.length === 0 ? (
            <GlassCard className="flex flex-col items-center py-16 text-center">
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 text-[var(--accent-positive)]">
                <Trophy size={40} />
              </div>
              <h3 className="text-2xl font-extrabold">You are debt free</h3>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                No categories track an outstanding debt balance.
              </p>
              <Link href="/budget" className="mt-6 text-sm font-bold text-[var(--accent-blue)]">
                Go to Budget
              </Link>
            </GlassCard>
          ) : (
            <>
              <StatHero
                label="Total liabilities"
                value={`$${formatMoney(totalDebt)}`}
                variant="negative"
                sublabel={
                  debtFreeDate
                    ? `Debt-free by ${format(debtFreeDate, 'MMMM yyyy')}`
                    : 'Increase monthly power to see a payoff date'
                }
              />

              <GlassCard>
                <DebtTimelineChart
                  results={simulationResults}
                  totalMonthlyPower={totalMonthlyPower}
                />
              </GlassCard>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <GlassCard className="lg:col-span-2">
                  <div className="mb-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setStrategy('snowball')}
                      className={cn(
                        'flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold touch-manipulation',
                        strategy === 'snowball'
                          ? 'bg-[var(--text-primary)] text-[var(--canvas)]'
                          : 'bg-[var(--border)]'
                      )}
                    >
                      <Snowflake size={16} /> Snowball
                    </button>
                    <button
                      type="button"
                      onClick={() => setStrategy('avalanche')}
                      className={cn(
                        'flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold touch-manipulation',
                        strategy === 'avalanche'
                          ? 'bg-[var(--text-primary)] text-[var(--canvas)]'
                          : 'bg-[var(--border)]'
                      )}
                    >
                      <Flame size={16} /> Avalanche
                    </button>
                  </div>
                  <h3 className="mb-4 flex items-center gap-2 font-bold">
                    <TrendingDown size={18} /> Payoff order
                  </h3>
                  <ul className="space-y-3">
                    {simulationResults.map((d, i) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] p-4"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--border)] font-bold">
                            {i + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-bold">
                              {d.emoji} {d.name}
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                              Min ${formatMoney(d.minPayment)}/mo
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-black">${formatMoney(d.balance)}</p>
                          <p className="text-xs font-bold text-[var(--accent-positive)]">
                            {d.payoffMonth > 0
                              ? format(addMonths(new Date(), d.payoffMonth), 'MMM yyyy')
                              : 'Stagnant'}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </GlassCard>

                <GlassCard>
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Monthly power
                  </p>
                  <p className="mt-1 text-2xl font-black">${formatMoney(totalMonthlyPower)}/mo</p>
                  <p className="mt-4 text-xs text-[var(--text-muted)]">
                    Minimums: ${formatMoney(totalMinimums)}
                  </p>
                  <label className="mt-4 block text-xs font-bold text-[var(--accent-positive)]">
                    Extra payment
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    className="mt-2 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 font-black"
                    value={extraPayment}
                    onChange={(e) => setExtraPayment(e.target.value)}
                  />
                </GlassCard>
              </div>
            </>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </>
  );
}

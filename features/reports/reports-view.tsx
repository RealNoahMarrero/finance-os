'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { format, addMonths, parseISO } from 'date-fns';
import {
  Snowflake,
  Flame,
  Trophy,
  TrendingDown,
  CreditCard,
  Download,
  ChevronLeft,
  ChevronRight,
  ArrowDownRight,
  ArrowUpRight,
  Minus,
} from 'lucide-react';
import Link from 'next/link';
import { formatMoney, snapMoney } from '@/lib/money';
import { fetchAccounts } from '@/lib/queries/accounts';
import {
  fetchCategories,
  fetchCategoryGroups,
  fetchDebtCategories,
} from '@/lib/queries/categories';
import { ExportModal } from '@/features/export/export-modal';
import { fetchTransactions } from '@/lib/queries/transactions';
import {
  aggregateIncomeByCategory,
  aggregateMonthlyCashflow,
  aggregateSpendingByCategory,
  aggregateSpendingByGroup,
  aggregateSpendingGrouped,
  aggregateTopIncomeSources,
  aggregateTopPayees,
  computeLiquidCash,
  computeNetWorth,
  computePeriodTotals,
  computeReadyToAssign,
  getPeriodRange,
  type ReportPeriod,
} from '@/lib/reports/aggregations';
import { simulateDebtPayoff, categoriesToDebtInput } from '@/lib/reports/debt-simulator';
import { PageHeader } from '@/components/layout/page-header';
import { PageSkeleton } from '@/components/ui/skeleton';
import { StatHero } from '@/components/ui/stat-hero';
import { GlassCard } from '@/components/ui/glass-card';
import { CashflowChart } from '@/components/charts/cashflow-chart';
import { CategoryDonut } from '@/components/charts/category-donut';
import { SpendingBreakdown } from '@/features/reports/spending-breakdown';
import { DebtTimelineChart } from '@/components/charts/debt-timeline-chart';
import { cn } from '@/lib/cn';
import {
  computeAggregateCreditUtilization,
  creditUtilizationBarWidth,
  summarizeCreditCards,
} from '@/lib/credit-cards';
import type { Account } from '@/lib/types';
import {
  hasStoredInsightsPreferences,
  useInsightsPreferences,
} from '@/hooks/use-insights-preferences';

const PERIODS: { id: ReportPeriod; label: string }[] = [
  { id: '30d', label: '30D' },
  { id: '90d', label: '90D' },
  { id: 'ytd', label: 'YTD' },
  { id: '12mo', label: '12M' },
  { id: 'month', label: 'Month' },
];

export function ReportsView() {
  const { prefs, patch } = useInsightsPreferences();
  const shouldSeedExpanded = useRef(!hasStoredInsightsPreferences());
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [debts, setDebts] = useState<any[]>([]);
  const [isExportOpen, setIsExportOpen] = useState(false);

  const {
    period,
    selectedMonth,
    activeTab,
    extraPayment,
    strategy,
    spendingView,
    selectedGroupId,
    expandedGroupIds,
  } = prefs;

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [accs, cats, grps, txns, debtCats] = await Promise.all([
        fetchAccounts(),
        fetchCategories(),
        fetchCategoryGroups(),
        fetchTransactions(),
        fetchDebtCategories(),
      ]);
      if (accs.data) setAccounts(accs.data);
      if (cats.data) setCategories(cats.data);
      if (grps.data) setGroups(grps.data);
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

  const periodRange = useMemo(
    () => getPeriodRange(period, selectedMonth),
    [period, selectedMonth]
  );

  const periodTotals = useMemo(
    () => computePeriodTotals(transactions, periodRange),
    [transactions, periodRange]
  );

  const cashflow = useMemo(
    () => aggregateMonthlyCashflow(transactions, periodRange),
    [transactions, periodRange]
  );
  const spending = useMemo(
    () => aggregateSpendingByCategory(transactions, categories, periodRange),
    [transactions, categories, periodRange]
  );
  const incomeByCategory = useMemo(
    () => aggregateIncomeByCategory(transactions, categories, periodRange),
    [transactions, categories, periodRange]
  );
  const spendingByGroup = useMemo(
    () => aggregateSpendingByGroup(transactions, categories, groups, periodRange),
    [transactions, categories, groups, periodRange]
  );
  const spendingGrouped = useMemo(
    () => aggregateSpendingGrouped(transactions, categories, groups, periodRange),
    [transactions, categories, groups, periodRange]
  );
  const topPayees = useMemo(
    () => aggregateTopPayees(transactions, periodRange),
    [transactions, periodRange]
  );
  const topIncomeSources = useMemo(
    () => aggregateTopIncomeSources(transactions, periodRange),
    [transactions, periodRange]
  );

  useEffect(() => {
    if (!shouldSeedExpanded.current || spendingGrouped.length === 0) return;
    patch({ expandedGroupIds: spendingGrouped.map((g) => g.groupId) });
    shouldSeedExpanded.current = false;
  }, [spendingGrouped, patch]);

  function shiftMonth(delta: number) {
    const base = parseISO(`${selectedMonth}-01`);
    patch({ selectedMonth: format(addMonths(base, delta), 'yyyy-MM') });
  }

  function toggleExpandedGroup(groupId: number) {
    const next = expandedGroupIds.includes(groupId)
      ? expandedGroupIds.filter((id) => id !== groupId)
      : [...expandedGroupIds, groupId];
    patch({ expandedGroupIds: next });
  }

  const insightsExportContext = useMemo(
    () => ({
      input: {
        range: periodRange,
        totals: periodTotals,
        cashflow,
        spending,
        income: incomeByCategory,
        groups: spendingByGroup,
        topPayees,
        topIncomeSources,
        netWorth,
        liquidCash,
        readyToAssign,
      },
      periodLabel: periodRange.label,
    }),
    [
      periodRange,
      periodTotals,
      cashflow,
      spending,
      incomeByCategory,
      spendingByGroup,
      topPayees,
      topIncomeSources,
      netWorth,
      liquidCash,
      readyToAssign,
    ]
  );

  const creditSummary = useMemo(
    () => summarizeCreditCards(accounts as Account[]),
    [accounts]
  );
  const aggregateCredit = useMemo(
    () => computeAggregateCreditUtilization(accounts as Account[]),
    [accounts]
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
        action={
          <button
            type="button"
            onClick={() => setIsExportOpen(true)}
            className="flex min-h-10 items-center gap-2 rounded-xl glass-card px-4 text-sm font-bold text-[var(--text-primary)] touch-manipulation"
          >
            <Download size={16} />
            Export
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => patch({ period: p.id })}
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

      {period === 'month' && (
        <div className="mb-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="flex h-10 w-10 items-center justify-center rounded-xl glass-card touch-manipulation"
            aria-label="Previous month"
          >
            <ChevronLeft size={20} />
          </button>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => patch({ selectedMonth: e.target.value })}
            className="min-h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-bold"
          />
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            className="flex h-10 w-10 items-center justify-center rounded-xl glass-card touch-manipulation"
            aria-label="Next month"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}

      <p className="mb-4 text-xs font-bold text-[var(--text-muted)]">{periodRange.label}</p>

      <div className="mb-6 grid grid-cols-3 gap-3 items-stretch">
        <GlassCard className="flex min-h-[5.5rem] flex-col items-center justify-center p-4 text-center">
          <ArrowUpRight size={18} className="mb-1 text-[var(--accent-positive)]" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Income</p>
          <p className="text-lg font-black tabular-nums text-[var(--accent-positive)]">
            ${formatMoney(periodTotals.income)}
          </p>
        </GlassCard>
        <GlassCard className="flex min-h-[5.5rem] flex-col items-center justify-center p-4 text-center">
          <ArrowDownRight size={18} className="mb-1 text-[var(--accent-negative)]" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Expenses</p>
          <p className="text-lg font-black tabular-nums text-[var(--accent-negative)]">
            ${formatMoney(periodTotals.expense)}
          </p>
        </GlassCard>
        <GlassCard className="flex min-h-[5.5rem] flex-col items-center justify-center p-4 text-center">
          <Minus size={18} className="mb-1 text-[var(--text-primary)]" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Net</p>
          <p
            className={cn(
              'text-lg font-black tabular-nums',
              periodTotals.net >= 0 ? 'text-[var(--accent-positive)]' : 'text-[var(--accent-negative)]'
            )}
          >
            {periodTotals.net < 0 ? '-' : ''}${formatMoney(Math.abs(periodTotals.net))}
          </p>
        </GlassCard>
      </div>

      <div
        className={cn(
          'mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 items-stretch',
          creditSummary.length > 0 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
        )}
      >
        <StatHero label="Net Worth" value={`$${formatMoney(netWorth)}`} variant="hero" />
        <StatHero label="Liquid Cash" value={`$${formatMoney(liquidCash)}`} />
        <StatHero
          label="Ready to Assign"
          value={`$${formatMoney(readyToAssign)}`}
          variant={readyToAssign < 0 ? 'negative' : 'positive'}
        />
        {creditSummary.length > 0 && (
          <StatHero
            label="Credit Usage"
            value={
              aggregateCredit ? `${aggregateCredit.utilizationPct}%` : '—'
            }
            sublabel={
              aggregateCredit ? (
                <>
                  ${formatMoney(aggregateCredit.totalOwed)} of $
                  {formatMoney(aggregateCredit.totalLimit)} total limit
                  {aggregateCredit.utilizationPct > 100 && (
                    <span className="block font-bold text-white/90 mt-0.5">
                      Over combined limit
                    </span>
                  )}
                </>
              ) : (
                'Add credit limits on your cards to track usage'
              )
            }
            variant={
              aggregateCredit && aggregateCredit.utilizationPct > 100
                ? 'negative'
                : 'default'
            }
          />
        )}
      </div>

      <Tabs.Root
        value={activeTab}
        onValueChange={(tab) => patch({ activeTab: tab as typeof activeTab })}
        className="space-y-6"
      >
        <Tabs.List className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
          {['overview', 'spending', 'income', 'debt'].map((tab) => (
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
            {cashflow.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs font-bold">
                  <thead>
                    <tr className="text-[var(--text-muted)]">
                      <th className="py-2 text-left">Month</th>
                      <th className="py-2 text-right">Income</th>
                      <th className="py-2 text-right">Expense</th>
                      <th className="py-2 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashflow.map((m) => (
                      <tr key={m.month} className="border-t border-[var(--border)]">
                        <td className="py-2">{m.month}</td>
                        <td className="py-2 text-right text-[var(--accent-positive)]">${formatMoney(m.income)}</td>
                        <td className="py-2 text-right text-[var(--accent-negative)]">${formatMoney(m.expense)}</td>
                        <td
                          className={cn(
                            'py-2 text-right font-black',
                            m.income - m.expense >= 0
                              ? 'text-[var(--accent-positive)]'
                              : 'text-[var(--accent-negative)]'
                          )}
                        >
                          ${formatMoney(m.income - m.expense)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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

          {creditSummary.length > 0 && (
            <GlassCard>
              <h3 className="mb-4 flex items-center gap-2 text-lg font-bold">
                <CreditCard size={20} className="text-red-500" />
                Credit cards
              </h3>
              <div className="space-y-4">
                {creditSummary.map((card) => (
                  <div
                    key={card.id}
                    className="rounded-xl border border-[var(--border)] p-4"
                  >
                    <div className="mb-2 flex items-center justify-between gap-4">
                      <span className="font-bold text-[var(--text-primary)]">{card.name}</span>
                      <span className="font-black text-red-500">${formatMoney(card.owed)}</span>
                    </div>
                    {card.utilizationPct != null && (
                      <>
                        <div className="mb-1 flex justify-between text-xs font-bold text-[var(--text-muted)]">
                          <span>Usage</span>
                          <span
                            className={
                              card.utilizationPct > 100
                                ? 'text-red-700'
                                : 'text-red-600'
                            }
                          >
                            {card.utilizationPct}%
                            {card.utilizationPct > 100 && (
                              <span className="ml-1 text-[10px] uppercase tracking-wide">
                                over limit
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                          <div
                            className={`h-full rounded-full ${
                              card.utilizationPct > 100 ? 'bg-red-700' : 'bg-red-500'
                            }`}
                            style={{
                              width: `${creditUtilizationBarWidth(card.utilizationPct)}%`,
                            }}
                          />
                        </div>
                        <p className="mt-1 text-[10px] font-bold text-[var(--text-muted)]">
                          {card.utilizationPct > 100 ? (
                            <>
                              ${formatMoney(card.owed)} owed · limit $
                              {formatMoney(card.credit_limit)}
                            </>
                          ) : (
                            <>
                              ${formatMoney(card.available)} available of $
                              {formatMoney(card.credit_limit)}
                            </>
                          )}
                        </p>
                      </>
                    )}
                    {(card.minimum_payment > 0 ||
                      card.next_payment_due_date ||
                      card.payment_due_day != null) && (
                      <p className="mt-2 text-xs font-bold text-orange-600">
                        {card.minimum_payment > 0 &&
                          `Min payment $${formatMoney(card.minimum_payment)}`}
                        {card.next_payment_due_date && (
                          <>
                            {card.minimum_payment > 0 && ' · '}
                            Next due {card.next_payment_due_date}
                          </>
                        )}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </Tabs.Content>

        <Tabs.Content value="spending" className="space-y-6">
          <SpendingBreakdown
            grouped={spendingGrouped}
            allCategories={spending}
            periodExpense={periodTotals.expense}
            view={spendingView}
            onViewChange={(view) => patch({ spendingView: view })}
            selectedGroupId={selectedGroupId}
            onSelectedGroupIdChange={(id) => patch({ selectedGroupId: id })}
            expandedGroupIds={expandedGroupIds}
            onToggleGroup={toggleExpandedGroup}
          />
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
        </Tabs.Content>

        <Tabs.Content value="income" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <GlassCard>
              <h3 className="mb-4 text-lg font-bold">By category</h3>
              {incomeByCategory.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--text-muted)]">No income in this period.</p>
              ) : (
                <CategoryDonut
                  data={incomeByCategory}
                  emptyMessage="No income in this period."
                  valueColor="text-[var(--accent-positive)]"
                />
              )}
            </GlassCard>
            <GlassCard>
              <h3 className="mb-4 text-lg font-bold">Top income sources</h3>
              {topIncomeSources.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--text-muted)]">No income yet.</p>
              ) : (
                <ul className="space-y-3">
                  {topIncomeSources.map((p) => (
                    <li key={p.payee} className="flex justify-between gap-4">
                      <span className="truncate font-semibold">{p.payee}</span>
                      <span className="font-black text-[var(--accent-positive)]">
                        ${formatMoney(p.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>
          </div>
          {incomeByCategory.length > 0 && (
            <GlassCard>
              <h3 className="mb-4 text-lg font-bold">Income breakdown</h3>
              <ul className="space-y-3">
                {incomeByCategory.map((c) => (
                  <li key={c.name} className="flex justify-between gap-4">
                    <span className="truncate font-semibold">
                      {c.emoji} {c.name}
                    </span>
                    <span className="font-black text-[var(--accent-positive)]">
                      ${formatMoney(c.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </GlassCard>
          )}
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
                      onClick={() => patch({ strategy: 'snowball' })}
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
                      onClick={() => patch({ strategy: 'avalanche' })}
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
                    onChange={(e) => patch({ extraPayment: e.target.value })}
                  />
                </GlassCard>
              </div>
            </>
          )}
        </Tabs.Content>
      </Tabs.Root>

      <ExportModal
        open={isExportOpen}
        onOpenChange={setIsExportOpen}
        initialPreset="insights"
        insightsContext={insightsExportContext}
        insightsPeriod={{ period, monthKey: selectedMonth }}
        insightsPage
      />
    </>
  );
}

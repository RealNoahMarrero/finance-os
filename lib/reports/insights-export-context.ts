import { fetchAccounts } from '@/lib/queries/accounts';
import { fetchCategories, fetchCategoryGroups } from '@/lib/queries/categories';
import { fetchTransactions } from '@/lib/queries/transactions';
import type { InsightsExportContext } from '@/lib/export/types';
import { loadInsightsPreferences } from '@/hooks/use-insights-preferences';
import type { EntityId } from '@/lib/types';
import {
  aggregateIncomeByCategory,
  aggregateMonthlyCashflow,
  aggregateSpendingByCategory,
  aggregateSpendingByGroup,
  aggregateTopIncomeSources,
  aggregateTopPayees,
  computeLiquidCash,
  computeNetWorth,
  computePeriodTotals,
  computeReadyToAssign,
  getPeriodRange,
  type ReportPeriod,
} from '@/lib/reports/aggregations';

export async function loadInsightsExportContext(
  period?: ReportPeriod,
  monthKey?: string,
  entityId: EntityId = 'personal'
): Promise<InsightsExportContext> {
  const prefs = loadInsightsPreferences();
  const resolvedPeriod = period ?? prefs.period;
  const resolvedMonth = monthKey ?? prefs.selectedMonth;

  const [accs, cats, grps, txns] = await Promise.all([
    fetchAccounts(entityId),
    fetchCategories(entityId),
    fetchCategoryGroups(entityId),
    fetchTransactions(entityId),
  ]);

  const accounts = accs.data || [];
  const categories = cats.data || [];
  const groups = grps.data || [];
  const transactions = txns.data || [];

  const periodRange = getPeriodRange(resolvedPeriod, resolvedMonth);
  const netWorth = computeNetWorth(accounts);
  const liquidCash = computeLiquidCash(accounts);
  const readyToAssign = computeReadyToAssign(liquidCash, categories);

  return {
    input: {
      range: periodRange,
      totals: computePeriodTotals(transactions, periodRange),
      cashflow: aggregateMonthlyCashflow(transactions, periodRange),
      spending: aggregateSpendingByCategory(transactions, categories, periodRange),
      income: aggregateIncomeByCategory(transactions, categories, periodRange),
      groups: aggregateSpendingByGroup(transactions, categories, groups, periodRange),
      topPayees: aggregateTopPayees(transactions, periodRange),
      topIncomeSources: aggregateTopIncomeSources(transactions, periodRange),
      netWorth,
      liquidCash,
      readyToAssign,
    },
    periodLabel: periodRange.label,
  };
}

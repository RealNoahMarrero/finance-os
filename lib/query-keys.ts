export const financeKeys = {
  all: ['finance'] as const,
  accounts: () => [...financeKeys.all, 'accounts'] as const,
  categories: () => [...financeKeys.all, 'categories'] as const,
  categoryGroups: () => [...financeKeys.all, 'categoryGroups'] as const,
  transactions: () => [...financeKeys.all, 'transactions'] as const,
  recentTransactions: (limit: number) =>
    [...financeKeys.all, 'transactions', 'recent', limit] as const,
  monthTransactions: (monthStart: string) =>
    [...financeKeys.all, 'transactions', 'month', monthStart] as const,
  debtCategories: () => [...financeKeys.all, 'debtCategories'] as const,
  calendarBills: () => [...financeKeys.all, 'calendarBills'] as const,
  pendingProjected: () => [...financeKeys.all, 'projected', 'pending'] as const,
  allProjected: () => [...financeKeys.all, 'projected', 'all'] as const,
  projectedMonth: (monthStart: string, monthEnd: string) =>
    [...financeKeys.all, 'projected', 'month', monthStart, monthEnd] as const,
  projected: () => [...financeKeys.all, 'projected'] as const,
};

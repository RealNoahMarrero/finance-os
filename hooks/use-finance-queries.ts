'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { fetchAccounts } from '@/lib/queries/accounts';
import {
  fetchCategories,
  fetchCategoriesForCalendar,
  fetchCategoryGroups,
  fetchDebtCategories,
} from '@/lib/queries/categories';
import {
  fetchAllProjectedIncome,
  fetchPendingProjectedIncome,
  fetchProjectedIncomeForMonth,
} from '@/lib/queries/projected-income';
import {
  attachSplitsToTransactions,
  fetchMonthTransactions,
  fetchTransactions,
} from '@/lib/queries/transactions';
import { roundMoney } from '@/lib/money';
import { financeKeys } from '@/lib/query-keys';
import { supabase } from '@/lib/supabase';
import type { Account, Category, CategoryGroup, Transaction } from '@/lib/types';

const STALE_TIME = 5 * 60 * 1000;
const GC_TIME = 30 * 60 * 1000;

export const financeQueryDefaults = {
  staleTime: STALE_TIME,
  gcTime: GC_TIME,
};

async function loadTransactionsWithSplits() {
  const { data, error } = await fetchTransactions();
  if (error || !data) return { data: [] as Transaction[], error };
  return { data, error: null };
}

async function loadRecentTransactions(limit: number) {
  const { data, error } = await supabase
    .from('transactions')
    .select('*, categories(name, emoji), accounts!account_id(name, type)')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return { data: [] as Transaction[], error };
  const withSplits = await attachSplitsToTransactions(data as Transaction[]);
  return { data: withSplits as Transaction[], error: null };
}

export function useAccounts() {
  return useQuery({
    queryKey: financeKeys.accounts(),
    queryFn: fetchAccounts,
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: financeKeys.categories(),
    queryFn: fetchCategories,
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function useCategoryGroups() {
  return useQuery({
    queryKey: financeKeys.categoryGroups(),
    queryFn: fetchCategoryGroups,
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function useTransactions() {
  return useQuery({
    queryKey: financeKeys.transactions(),
    queryFn: loadTransactionsWithSplits,
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function useRecentTransactions(limit = 10) {
  return useQuery({
    queryKey: financeKeys.recentTransactions(limit),
    queryFn: () => loadRecentTransactions(limit),
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function useMonthTransactionStats(monthStart?: string) {
  const start = monthStart ?? format(new Date(), 'yyyy-MM-01');
  return useQuery({
    queryKey: financeKeys.monthTransactions(start),
    queryFn: () => fetchMonthTransactions(start),
    select: (result) => {
      let income = 0;
      let expense = 0;
      for (const t of result.data ?? []) {
        if (t.type === 'Income') income = roundMoney(income + Number(t.amount));
        if (t.type === 'Expense') expense = roundMoney(expense + Number(t.amount));
      }
      return { income, expense };
    },
    ...financeQueryDefaults,
  });
}

export function useDebtCategories() {
  return useQuery({
    queryKey: financeKeys.debtCategories(),
    queryFn: fetchDebtCategories,
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function useCalendarBillCategories() {
  return useQuery({
    queryKey: financeKeys.calendarBills(),
    queryFn: fetchCategoriesForCalendar,
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function usePendingProjectedIncome() {
  return useQuery({
    queryKey: financeKeys.pendingProjected(),
    queryFn: fetchPendingProjectedIncome,
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function useAllProjectedIncome() {
  return useQuery({
    queryKey: financeKeys.allProjected(),
    queryFn: () => fetchAllProjectedIncome(),
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function useProjectedIncomeForMonth(monthStart: string, monthEnd: string) {
  return useQuery({
    queryKey: financeKeys.projectedMonth(monthStart, monthEnd),
    queryFn: () => fetchProjectedIncomeForMonth(monthStart, monthEnd),
    select: (result) => result.data ?? [],
    enabled: Boolean(monthStart && monthEnd),
    ...financeQueryDefaults,
  });
}

export function useInvalidateFinance() {
  const qc = useQueryClient();

  const patchCategories = (updater: (categories: Category[]) => Category[]) => {
    qc.setQueriesData<Awaited<ReturnType<typeof fetchCategories>>>(
      { queryKey: [...financeKeys.all, 'categories'] },
      (prev) => {
        if (!prev) return prev;
        return {
          data: updater(prev.data ?? []),
          error: prev.error ?? null,
        };
      }
    );
  };

  const patchCategoryGroups = (updater: (groups: CategoryGroup[]) => CategoryGroup[]) => {
    qc.setQueryData(
      financeKeys.categoryGroups(),
      (prev: Awaited<ReturnType<typeof fetchCategoryGroups>> | undefined) => ({
        data: updater(prev?.data ?? []),
        error: prev?.error ?? null,
      })
    );
  };

  return {
    patchCategories,
    patchCategoryGroups,
    invalidateAll: () => qc.invalidateQueries({ queryKey: financeKeys.all }),
    invalidateAccounts: () => qc.invalidateQueries({ queryKey: financeKeys.accounts() }),
    invalidateCategories: () =>
      qc.invalidateQueries({ queryKey: [...financeKeys.all, 'categories'] }),
    invalidateTransactions: () =>
      qc.invalidateQueries({ queryKey: [...financeKeys.all, 'transactions'] }),
    invalidateProjected: () => qc.invalidateQueries({ queryKey: financeKeys.projected() }),
    invalidateAfterTransaction: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: financeKeys.transactions() }),
        qc.invalidateQueries({ queryKey: financeKeys.accounts() }),
        qc.invalidateQueries({ queryKey: [...financeKeys.all, 'categories'] }),
        qc.invalidateQueries({ queryKey: financeKeys.recentTransactions(10) }),
        qc.invalidateQueries({ queryKey: [...financeKeys.all, 'transactions', 'month'] }),
      ]);
    },
    invalidateAfterBudgetChange: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: [...financeKeys.all, 'categories'] }),
        qc.invalidateQueries({ queryKey: financeKeys.accounts() }),
        qc.invalidateQueries({ queryKey: financeKeys.pendingProjected() }),
      ]);
    },
  };
}

/** Warm shared caches as soon as the shell mounts. */
export function prefetchCoreFinanceData(qc: ReturnType<typeof useQueryClient>) {
  void qc.prefetchQuery({
    queryKey: financeKeys.accounts(),
    queryFn: fetchAccounts,
    ...financeQueryDefaults,
  });
  void qc.prefetchQuery({
    queryKey: financeKeys.categories(),
    queryFn: fetchCategories,
    ...financeQueryDefaults,
  });
  void qc.prefetchQuery({
    queryKey: financeKeys.categoryGroups(),
    queryFn: fetchCategoryGroups,
    ...financeQueryDefaults,
  });
  void qc.prefetchQuery({
    queryKey: financeKeys.pendingProjected(),
    queryFn: fetchPendingProjectedIncome,
    ...financeQueryDefaults,
  });
}

export function prefetchRouteData(
  qc: ReturnType<typeof useQueryClient>,
  path: string
) {
  prefetchCoreFinanceData(qc);
  if (path === '/ledger' || path === '/reports') {
    void qc.prefetchQuery({
      queryKey: financeKeys.transactions(),
      queryFn: loadTransactionsWithSplits,
      ...financeQueryDefaults,
    });
  }
  if (path === '/reports') {
    void qc.prefetchQuery({
      queryKey: financeKeys.debtCategories(),
      queryFn: fetchDebtCategories,
      ...financeQueryDefaults,
    });
  }
  if (path === '/calendar') {
    void qc.prefetchQuery({
      queryKey: financeKeys.calendarBills(),
      queryFn: fetchCategoriesForCalendar,
      ...financeQueryDefaults,
    });
  }
}

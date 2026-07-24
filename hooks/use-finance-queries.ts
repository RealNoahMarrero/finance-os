'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useEntity } from '@/app/providers/entity-provider';
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
import { fetchVentures } from '@/lib/queries/ventures';
import { roundMoney } from '@/lib/money';
import { financeKeys } from '@/lib/query-keys';
import { supabase } from '@/lib/supabase';
import type {
  Account,
  Category,
  CategoryGroup,
  EntityId,
  Transaction,
} from '@/lib/types';

const STALE_TIME = 5 * 60 * 1000;
const GC_TIME = 30 * 60 * 1000;

export const financeQueryDefaults = {
  staleTime: STALE_TIME,
  gcTime: GC_TIME,
};

async function loadTransactionsWithSplits(entityId: EntityId) {
  const { data, error } = await fetchTransactions(entityId);
  if (error || !data) return { data: [] as Transaction[], error };
  return { data, error: null };
}

async function loadRecentTransactions(entityId: EntityId, limit: number) {
  const { data, error } = await supabase
    .from('transactions')
    .select(
      '*, categories(name, emoji), accounts!account_id(name, type), ventures(id, name)'
    )
    .eq('entity_id', entityId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return { data: [] as Transaction[], error };
  const withSplits = await attachSplitsToTransactions(data as Transaction[]);
  return { data: withSplits as Transaction[], error: null };
}

export function useAccounts() {
  const { entityId } = useEntity();
  return useQuery({
    queryKey: financeKeys.accounts(entityId),
    queryFn: () => fetchAccounts(entityId),
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function useCategories() {
  const { entityId } = useEntity();
  return useQuery({
    queryKey: financeKeys.categories(entityId),
    queryFn: () => fetchCategories(entityId),
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function useCategoryGroups() {
  const { entityId } = useEntity();
  return useQuery({
    queryKey: financeKeys.categoryGroups(entityId),
    queryFn: () => fetchCategoryGroups(entityId),
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function useVentures(activeOnly = true) {
  const { entityId, isBusiness } = useEntity();
  return useQuery({
    queryKey: [...financeKeys.ventures(entityId), activeOnly ? 'active' : 'all'],
    queryFn: () => fetchVentures(entityId, activeOnly),
    select: (result) => result.data ?? [],
    enabled: isBusiness,
    ...financeQueryDefaults,
  });
}

export function useTransactions() {
  const { entityId } = useEntity();
  return useQuery({
    queryKey: financeKeys.transactions(entityId),
    queryFn: () => loadTransactionsWithSplits(entityId),
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function useRecentTransactions(limit = 10) {
  const { entityId } = useEntity();
  return useQuery({
    queryKey: financeKeys.recentTransactions(entityId, limit),
    queryFn: () => loadRecentTransactions(entityId, limit),
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function useMonthTransactionStats(monthStart?: string) {
  const { entityId } = useEntity();
  const start = monthStart ?? format(new Date(), 'yyyy-MM-01');
  return useQuery({
    queryKey: financeKeys.monthTransactions(entityId, start),
    queryFn: () => fetchMonthTransactions(entityId, start),
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
  const { entityId } = useEntity();
  return useQuery({
    queryKey: financeKeys.debtCategories(entityId),
    queryFn: () => fetchDebtCategories(entityId),
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function useCalendarBillCategories() {
  const { entityId } = useEntity();
  return useQuery({
    queryKey: financeKeys.calendarBills(entityId),
    queryFn: () => fetchCategoriesForCalendar(entityId),
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function usePendingProjectedIncome() {
  const { entityId } = useEntity();
  return useQuery({
    queryKey: financeKeys.pendingProjected(entityId),
    queryFn: () => fetchPendingProjectedIncome(entityId),
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function useAllProjectedIncome() {
  const { entityId } = useEntity();
  return useQuery({
    queryKey: financeKeys.allProjected(entityId),
    queryFn: () => fetchAllProjectedIncome(entityId),
    select: (result) => result.data ?? [],
    ...financeQueryDefaults,
  });
}

export function useProjectedIncomeForMonth(monthStart: string, monthEnd: string) {
  const { entityId } = useEntity();
  return useQuery({
    queryKey: financeKeys.projectedMonth(entityId, monthStart, monthEnd),
    queryFn: () => fetchProjectedIncomeForMonth(entityId, monthStart, monthEnd),
    select: (result) => result.data ?? [],
    enabled: Boolean(monthStart && monthEnd),
    ...financeQueryDefaults,
  });
}

export function useInvalidateFinance() {
  const qc = useQueryClient();
  const { entityId } = useEntity();

  const patchCategories = (updater: (categories: Category[]) => Category[]) => {
    qc.setQueriesData<Awaited<ReturnType<typeof fetchCategories>>>(
      { queryKey: financeKeys.categories(entityId) },
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
      financeKeys.categoryGroups(entityId),
      (prev: Awaited<ReturnType<typeof fetchCategoryGroups>> | undefined) => ({
        data: updater(prev?.data ?? []),
        error: prev?.error ?? null,
      })
    );
  };

  return {
    entityId,
    patchCategories,
    patchCategoryGroups,
    invalidateAll: () => qc.invalidateQueries({ queryKey: financeKeys.all }),
    invalidateEntity: () =>
      qc.invalidateQueries({ queryKey: financeKeys.entity(entityId) }),
    invalidateAccounts: () =>
      qc.invalidateQueries({ queryKey: financeKeys.accounts(entityId) }),
    invalidateCategories: () =>
      qc.invalidateQueries({ queryKey: financeKeys.categories(entityId) }),
    invalidateTransactions: () =>
      qc.invalidateQueries({ queryKey: financeKeys.transactions(entityId) }),
    invalidateProjected: () =>
      qc.invalidateQueries({ queryKey: financeKeys.projected(entityId) }),
    invalidateVentures: () =>
      qc.invalidateQueries({ queryKey: financeKeys.ventures(entityId) }),
    invalidateAfterTransaction: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: financeKeys.transactions(entityId) }),
        qc.invalidateQueries({ queryKey: financeKeys.accounts(entityId) }),
        qc.invalidateQueries({ queryKey: financeKeys.categories(entityId) }),
        qc.invalidateQueries({
          queryKey: financeKeys.recentTransactions(entityId, 10),
        }),
        qc.invalidateQueries({
          queryKey: [...financeKeys.entity(entityId), 'transactions', 'month'],
        }),
        // Owner flows and cross-entity writes may touch the other books
        qc.invalidateQueries({ queryKey: financeKeys.all }),
      ]);
    },
    invalidateAfterBudgetChange: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: financeKeys.categories(entityId) }),
        qc.invalidateQueries({ queryKey: financeKeys.accounts(entityId) }),
        qc.invalidateQueries({ queryKey: financeKeys.pendingProjected(entityId) }),
      ]);
    },
  };
}

/** Warm shared caches as soon as the shell mounts. */
export function prefetchCoreFinanceData(
  qc: ReturnType<typeof useQueryClient>,
  entityId: EntityId
) {
  void qc.prefetchQuery({
    queryKey: financeKeys.accounts(entityId),
    queryFn: () => fetchAccounts(entityId),
    ...financeQueryDefaults,
  });
  void qc.prefetchQuery({
    queryKey: financeKeys.categories(entityId),
    queryFn: () => fetchCategories(entityId),
    ...financeQueryDefaults,
  });
  void qc.prefetchQuery({
    queryKey: financeKeys.categoryGroups(entityId),
    queryFn: () => fetchCategoryGroups(entityId),
    ...financeQueryDefaults,
  });
  void qc.prefetchQuery({
    queryKey: financeKeys.pendingProjected(entityId),
    queryFn: () => fetchPendingProjectedIncome(entityId),
    ...financeQueryDefaults,
  });
  if (entityId === 'business') {
    void qc.prefetchQuery({
      queryKey: [...financeKeys.ventures(entityId), 'active'],
      queryFn: () => fetchVentures(entityId, true),
      ...financeQueryDefaults,
    });
  }
}

export function prefetchRouteData(
  qc: ReturnType<typeof useQueryClient>,
  path: string,
  entityId: EntityId
) {
  prefetchCoreFinanceData(qc, entityId);
  if (path === '/ledger' || path === '/reports') {
    void qc.prefetchQuery({
      queryKey: financeKeys.transactions(entityId),
      queryFn: () => loadTransactionsWithSplits(entityId),
      ...financeQueryDefaults,
    });
  }
  if (path === '/reports') {
    void qc.prefetchQuery({
      queryKey: financeKeys.debtCategories(entityId),
      queryFn: () => fetchDebtCategories(entityId),
      ...financeQueryDefaults,
    });
  }
  if (path === '/calendar') {
    void qc.prefetchQuery({
      queryKey: financeKeys.calendarBills(entityId),
      queryFn: () => fetchCategoriesForCalendar(entityId),
      ...financeQueryDefaults,
    });
  }
}

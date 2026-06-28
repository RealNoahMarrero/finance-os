import { format } from 'date-fns';
import { snapMoney } from '@/lib/money';
import { isLiquidAccount } from '@/lib/constants/account-types';
import { isSplitTransaction } from '@/lib/transaction-splits';
import {
  getPeriodRange,
  type PeriodRange,
  type ReportPeriod,
} from '@/lib/reports/aggregations';
import type { Account, Category, Transaction } from '@/lib/types';

export type LedgerFilterType = 'All' | 'Expense' | 'Income' | 'Transfer';
export type LedgerAccountTypeFilter = 'all' | 'liquid' | 'credit';
export type LedgerTransferDirection = 'all' | 'out' | 'in';
export type LedgerSpecialFilter = 'none' | 'splits' | 'uncategorized' | 'has-notes';
export type LedgerDateMode = 'all' | 'preset' | 'custom';

export interface LedgerFiltersState {
  searchQuery: string;
  filterType: LedgerFilterType;
  filterAccount: string;
  accountTypeFilter: LedgerAccountTypeFilter;
  transferDirection: LedgerTransferDirection;
  dateMode: LedgerDateMode;
  period: ReportPeriod;
  selectedMonth: string;
  customDateStart: string | null;
  customDateEnd: string | null;
  filterCategory: string;
  filterCategoryGroup: string;
  amountMin: string;
  amountMax: string;
  filterPayee: string;
  specialFilter: LedgerSpecialFilter;
}

export const LEDGER_FILTER_STORAGE_KEY = 'finance_os_ledger_filters';

export const DEFAULT_LEDGER_FILTERS: LedgerFiltersState = {
  searchQuery: '',
  filterType: 'All',
  filterAccount: 'All',
  accountTypeFilter: 'all',
  transferDirection: 'all',
  dateMode: 'all',
  period: '30d',
  selectedMonth: format(new Date(), 'yyyy-MM'),
  customDateStart: null,
  customDateEnd: null,
  filterCategory: 'All',
  filterCategoryGroup: 'All',
  amountMin: '',
  amountMax: '',
  filterPayee: '',
  specialFilter: 'none',
};

export const LEDGER_PERIODS: { id: ReportPeriod; label: string; shortLabel?: string }[] = [
  { id: '30d', label: '30D', shortLabel: '30D' },
  { id: '90d', label: '90D', shortLabel: '90D' },
  { id: 'ytd', label: 'YTD', shortLabel: 'YTD' },
  { id: '12mo', label: '12M', shortLabel: '12M' },
  { id: 'month', label: 'Month', shortLabel: 'Mo' },
];

export interface LedgerTotals {
  income: number;
  expense: number;
  net: number;
  count: number;
}

export function transactionMatchesCategory(txn: Transaction, categoryId: number): boolean {
  if (txn.type === 'Transfer') return false;
  const splits = txn.transaction_splits?.filter((s) => s.category_id) ?? [];
  if (splits.length > 0) {
    return splits.some((s) => s.category_id === categoryId);
  }
  return txn.category_id === categoryId;
}

export function transactionMatchesCategoryGroup(
  txn: Transaction,
  groupId: number,
  categories: Pick<Category, 'id' | 'group_id'>[]
): boolean {
  const catsInGroup = new Set(
    categories.filter((c) => c.group_id === groupId).map((c) => c.id)
  );
  if (txn.type === 'Transfer') return false;
  const splits = txn.transaction_splits?.filter((s) => s.category_id) ?? [];
  if (splits.length > 0) {
    return splits.some((s) => catsInGroup.has(s.category_id));
  }
  return txn.category_id != null && catsInGroup.has(txn.category_id);
}

export function isUncategorizedTransaction(txn: Transaction): boolean {
  if (txn.type === 'Transfer') return false;
  return !isSplitTransaction(txn) && txn.category_id == null;
}

export function resolveLedgerDateRange(filters: LedgerFiltersState): PeriodRange | null {
  if (filters.dateMode === 'all') return null;
  if (filters.dateMode === 'custom') {
    const start = filters.customDateStart;
    const end = filters.customDateEnd ?? format(new Date(), 'yyyy-MM-dd');
    if (!start) return null;
    const label =
      start === end
        ? format(new Date(start + 'T12:00:00'), 'MMM d, yyyy')
        : `${format(new Date(start + 'T12:00:00'), 'MMM d, yyyy')} – ${format(new Date(end + 'T12:00:00'), 'MMM d, yyyy')}`;
    return { start, end, label };
  }
  return getPeriodRange(filters.period, filters.selectedMonth);
}

function accountMatchesTypeFilter(
  accountId: number | null | undefined,
  accounts: Pick<Account, 'id' | 'type'>[],
  filter: LedgerAccountTypeFilter
): boolean {
  if (!accountId || filter === 'all') return filter === 'all';
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) return false;
  if (filter === 'liquid') return isLiquidAccount(acc.type);
  if (filter === 'credit') return acc.type === 'Credit Card';
  return true;
}

export function filterLedgerTransactions(
  transactions: Transaction[],
  filters: LedgerFiltersState,
  accounts: Pick<Account, 'id' | 'type'>[],
  categories: Pick<Category, 'id' | 'group_id'>[]
): Transaction[] {
  const dateRange = resolveLedgerDateRange(filters);
  const minAmount = filters.amountMin ? parseFloat(filters.amountMin) : null;
  const maxAmount = filters.amountMax ? parseFloat(filters.amountMax) : null;
  const categoryId =
    filters.filterCategory !== 'All' ? parseInt(filters.filterCategory, 10) : null;
  const groupId =
    filters.filterCategoryGroup !== 'All'
      ? parseInt(filters.filterCategoryGroup, 10)
      : null;

  return transactions.filter((t) => {
    if (dateRange && (t.date < dateRange.start || t.date > dateRange.end)) return false;

    if (filters.filterType !== 'All' && t.type !== filters.filterType) return false;

    if (filters.filterAccount !== 'All') {
      const acctId = filters.filterAccount;
      const isSource = t.account_id?.toString() === acctId;
      const isDest = t.to_account_id?.toString() === acctId;
      if (!isSource && !isDest) return false;
      if (filters.transferDirection === 'out' && !isSource) return false;
      if (filters.transferDirection === 'in' && !isDest) return false;
    } else if (filters.accountTypeFilter !== 'all') {
      const matchesSource = accountMatchesTypeFilter(
        t.account_id,
        accounts,
        filters.accountTypeFilter
      );
      const matchesDest = accountMatchesTypeFilter(
        t.to_account_id,
        accounts,
        filters.accountTypeFilter
      );
      if (!matchesSource && !matchesDest) return false;
    }

    if (categoryId != null && !transactionMatchesCategory(t, categoryId)) return false;

    if (groupId != null && !transactionMatchesCategoryGroup(t, groupId, categories)) {
      return false;
    }

    if (filters.filterPayee) {
      const payee = (t.payee || '').toLowerCase();
      if (payee !== filters.filterPayee.toLowerCase()) return false;
    }

    if (filters.specialFilter === 'splits' && !isSplitTransaction(t)) return false;
    if (filters.specialFilter === 'uncategorized' && !isUncategorizedTransaction(t)) {
      return false;
    }
    if (filters.specialFilter === 'has-notes' && !t.notes?.trim()) return false;

    const amount = Number(t.amount);
    if (minAmount != null && !Number.isNaN(minAmount) && amount < minAmount) return false;
    if (maxAmount != null && !Number.isNaN(maxAmount) && amount > maxAmount) return false;

    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase();
      const splitNames = (t.transaction_splits || [])
        .map((s) => s.categories?.name?.toLowerCase())
        .filter(Boolean)
        .join(' ');
      const matches =
        t.payee?.toLowerCase().includes(q) ||
        t.notes?.toLowerCase().includes(q) ||
        t.categories?.name?.toLowerCase().includes(q) ||
        splitNames.includes(q);
      if (!matches) return false;
    }

    return true;
  });
}

export function computeLedgerTotals(transactions: Transaction[]): LedgerTotals {
  let income = 0;
  let expense = 0;
  transactions.forEach((t) => {
    if (t.type === 'Income') income += Number(t.amount);
    if (t.type === 'Expense') expense += Number(t.amount);
  });
  income = snapMoney(income);
  expense = snapMoney(expense);
  return {
    income,
    expense,
    net: snapMoney(income - expense),
    count: transactions.length,
  };
}

export function hasActiveLedgerFilters(
  filters: LedgerFiltersState,
  defaults: LedgerFiltersState = DEFAULT_LEDGER_FILTERS
): boolean {
  return (
    filters.searchQuery !== defaults.searchQuery ||
    filters.filterType !== defaults.filterType ||
    filters.filterAccount !== defaults.filterAccount ||
    filters.accountTypeFilter !== defaults.accountTypeFilter ||
    filters.transferDirection !== defaults.transferDirection ||
    filters.dateMode !== defaults.dateMode ||
    filters.filterCategory !== defaults.filterCategory ||
    filters.filterCategoryGroup !== defaults.filterCategoryGroup ||
    filters.amountMin !== defaults.amountMin ||
    filters.amountMax !== defaults.amountMax ||
    filters.filterPayee !== defaults.filterPayee ||
    filters.specialFilter !== defaults.specialFilter
  );
}

function isReportPeriod(v: string): v is ReportPeriod {
  return v === '30d' || v === '90d' || v === 'ytd' || v === '12mo' || v === 'month';
}

function isFilterType(v: string): v is LedgerFilterType {
  return v === 'All' || v === 'Expense' || v === 'Income' || v === 'Transfer';
}

export function parseLedgerSearchParams(
  params: URLSearchParams,
  base: LedgerFiltersState = DEFAULT_LEDGER_FILTERS
): Partial<LedgerFiltersState> {
  const partial: Partial<LedgerFiltersState> = {};

  const account = params.get('account');
  if (account) partial.filterAccount = account;

  const type = params.get('type');
  if (type && isFilterType(type)) partial.filterType = type;

  const category = params.get('category');
  if (category) {
    partial.filterCategory = category;
    if (!type) partial.filterType = 'Expense';
  }

  const group = params.get('group');
  if (group) partial.filterCategoryGroup = group;

  const payee = params.get('payee');
  if (payee) partial.filterPayee = payee;

  const from = params.get('from');
  const to = params.get('to');
  const period = params.get('period');
  const month = params.get('month');

  if (from || to) {
    partial.dateMode = 'custom';
    if (from) partial.customDateStart = from;
    if (to) partial.customDateEnd = to;
  } else if (period === 'custom') {
    partial.dateMode = 'custom';
  } else if (period && isReportPeriod(period)) {
    partial.dateMode = 'preset';
    partial.period = period;
    if (month && /^\d{4}-\d{2}$/.test(month)) partial.selectedMonth = month;
  } else if (period === 'all') {
    partial.dateMode = 'all';
  }

  const special = params.get('special');
  if (
    special === 'splits' ||
    special === 'uncategorized' ||
    special === 'has-notes'
  ) {
    partial.specialFilter = special;
  }

  const q = params.get('q');
  if (q) partial.searchQuery = q;

  return partial;
}

export function buildLedgerHref(
  filters: Partial<LedgerFiltersState>,
  options?: { categoryId?: number; periodRange?: PeriodRange }
): string {
  const params = new URLSearchParams();

  if (options?.categoryId != null) {
    params.set('category', String(options.categoryId));
  } else if (filters.filterCategory && filters.filterCategory !== 'All') {
    params.set('category', filters.filterCategory);
  }

  if (filters.filterAccount && filters.filterAccount !== 'All') {
    params.set('account', filters.filterAccount);
  }

  if (filters.filterType && filters.filterType !== 'All') {
    params.set('type', filters.filterType);
  }

  if (options?.periodRange) {
    params.set('from', options.periodRange.start);
    params.set('to', options.periodRange.end);
    params.set('period', 'custom');
  } else if (filters.dateMode === 'preset' && filters.period) {
    params.set('period', filters.period);
    if (filters.period === 'month' && filters.selectedMonth) {
      params.set('month', filters.selectedMonth);
    }
  } else if (filters.dateMode === 'custom') {
    params.set('period', 'custom');
    if (filters.customDateStart) params.set('from', filters.customDateStart);
    if (filters.customDateEnd) params.set('to', filters.customDateEnd);
  } else if (filters.dateMode === 'all') {
    params.set('period', 'all');
  }

  if (filters.filterPayee) params.set('payee', filters.filterPayee);
  if (filters.filterCategoryGroup && filters.filterCategoryGroup !== 'All') {
    params.set('group', filters.filterCategoryGroup);
  }
  if (filters.specialFilter && filters.specialFilter !== 'none') {
    params.set('special', filters.specialFilter);
  }
  if (filters.searchQuery) params.set('q', filters.searchQuery);

  const qs = params.toString();
  return qs ? `/ledger?${qs}` : '/ledger';
}

export function loadLedgerFiltersFromStorage(): LedgerFiltersState {
  if (typeof window === 'undefined') return { ...DEFAULT_LEDGER_FILTERS };
  try {
    const raw = localStorage.getItem(LEDGER_FILTER_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LEDGER_FILTERS };
    const parsed = JSON.parse(raw) as Partial<LedgerFiltersState>;
    return { ...DEFAULT_LEDGER_FILTERS, ...parsed };
  } catch {
    return { ...DEFAULT_LEDGER_FILTERS };
  }
}

export function saveLedgerFiltersToStorage(filters: LedgerFiltersState) {
  try {
    localStorage.setItem(LEDGER_FILTER_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    /* ignore */
  }
}

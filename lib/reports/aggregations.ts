import {
  format,
  subMonths,
  startOfMonth,
  endOfMonth,
  parseISO,
} from 'date-fns';
import { snapMoney } from '@/lib/money';
import type { Account, Category, CategoryGroup, Transaction } from '@/lib/types';
import { isLiquidAccount } from '@/lib/constants/account-types';

export type ReportPeriod = '30d' | '90d' | 'ytd' | '12mo' | 'month';

export interface PeriodRange {
  start: string;
  end: string;
  label: string;
}

export function getPeriodStart(period: Exclude<ReportPeriod, 'month'>): string {
  const now = new Date();
  switch (period) {
    case '30d':
      return format(subMonths(now, 1), 'yyyy-MM-dd');
    case '90d':
      return format(subMonths(now, 3), 'yyyy-MM-dd');
    case 'ytd':
      return format(new Date(now.getFullYear(), 0, 1), 'yyyy-MM-dd');
    case '12mo':
    default:
      return format(subMonths(now, 12), 'yyyy-MM-dd');
  }
}

export function getPeriodRange(
  period: ReportPeriod,
  monthKey?: string
): PeriodRange {
  const today = format(new Date(), 'yyyy-MM-dd');
  if (period === 'month' && monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const start = new Date(y, m - 1, 1);
    return {
      start: format(start, 'yyyy-MM-dd'),
      end: format(endOfMonth(start), 'yyyy-MM-dd'),
      label: format(start, 'MMMM yyyy'),
    };
  }
  const rolling = period === 'month' ? '30d' : period;
  const labels: Record<Exclude<ReportPeriod, 'month'>, string> = {
    '30d': 'Last 30 days',
    '90d': 'Last 90 days',
    ytd: 'Year to date',
    '12mo': 'Last 12 months',
  };
  return {
    start: getPeriodStart(rolling),
    end: today,
    label: labels[rolling],
  };
}

export function filterByPeriod<T extends { date: string }>(
  items: T[],
  range: PeriodRange
): T[] {
  return items.filter((t) => t.date >= range.start && t.date <= range.end);
}

export interface MonthlyCashflow {
  month: string;
  income: number;
  expense: number;
}

export function aggregateMonthlyCashflow(
  transactions: { date: string; amount: number; type: string }[],
  range: PeriodRange
): MonthlyCashflow[] {
  const filtered = filterByPeriod(transactions, range);
  const byMonth = new Map<string, { income: number; expense: number }>();

  filtered.forEach((t) => {
    const month = format(startOfMonth(parseISO(t.date)), 'yyyy-MM');
    const entry = byMonth.get(month) || { income: 0, expense: 0 };
    if (t.type === 'Income') entry.income += Number(t.amount);
    if (t.type === 'Expense') entry.expense += Number(t.amount);
    byMonth.set(month, entry);
  });

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      income: snapMoney(v.income),
      expense: snapMoney(v.expense),
    }));
}

export interface CategorySpend {
  name: string;
  emoji: string | null;
  total: number;
}

export interface PeriodTotals {
  income: number;
  expense: number;
  net: number;
}

export function computePeriodTotals(
  transactions: { date: string; amount: number; type: string }[],
  range: PeriodRange
): PeriodTotals {
  const filtered = filterByPeriod(transactions, range);
  let income = 0;
  let expense = 0;
  filtered.forEach((t) => {
    if (t.type === 'Income') income += Number(t.amount);
    if (t.type === 'Expense') expense += Number(t.amount);
  });
  income = snapMoney(income);
  expense = snapMoney(expense);
  return { income, expense, net: snapMoney(income - expense) };
}

export interface GroupSpend {
  name: string;
  total: number;
}

export interface GroupedSpending {
  groupId: number;
  groupName: string;
  total: number;
  categories: CategorySpend[];
}

export function aggregateSpendingGrouped(
  transactions: {
    date: string;
    amount: number;
    type: string;
    category_id: number | null;
    transaction_splits?: { category_id: number; amount: number }[];
  }[],
  categories: Category[],
  groups: CategoryGroup[],
  range: PeriodRange
): GroupedSpending[] {
  const groupNames = Object.fromEntries(groups.map((g) => [g.id, g.name]));
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const totals = new Map<number, number>();

  filterByPeriod(transactions, range)
    .filter((t) => t.type === 'Expense')
    .forEach((t) => {
      const splits = t.transaction_splits?.filter((s) => s.category_id) ?? [];
      if (splits.length > 0) {
        splits.forEach((s) => {
          totals.set(
            s.category_id,
            (totals.get(s.category_id) || 0) + Number(s.amount)
          );
        });
        return;
      }
      if (!t.category_id) return;
      totals.set(t.category_id, (totals.get(t.category_id) || 0) + Number(t.amount));
    });

  const buckets = new Map<number, GroupedSpending>();
  totals.forEach((amount, categoryId) => {
    const cat = catMap[categoryId];
    if (!cat) return;
    const groupId = cat.group_id;
    const groupName = groupNames[groupId] || 'Other';
    if (!buckets.has(groupId)) {
      buckets.set(groupId, {
        groupId,
        groupName,
        total: 0,
        categories: [],
      });
    }
    const bucket = buckets.get(groupId)!;
    const lineTotal = snapMoney(amount);
    bucket.categories.push({
      name: cat.name,
      emoji: cat.emoji,
      total: lineTotal,
    });
    bucket.total = snapMoney(bucket.total + lineTotal);
  });

  return Array.from(buckets.values())
    .map((g) => ({
      ...g,
      categories: g.categories.sort((a, b) => b.total - a.total),
    }))
    .sort((a, b) => b.total - a.total);
}

export function aggregateSpendingByGroup(
  transactions: {
    date: string;
    amount: number;
    type: string;
    category_id: number | null;
    transaction_splits?: { category_id: number; amount: number }[];
  }[],
  categories: Category[],
  groups: CategoryGroup[],
  range: PeriodRange
): GroupSpend[] {
  return aggregateSpendingGrouped(transactions, categories, groups, range).map((g) => ({
    name: g.groupName,
    total: g.total,
  }));
}

export function aggregateIncomeByCategory(
  transactions: {
    date: string;
    amount: number;
    type: string;
    category_id: number | null;
    transaction_splits?: { category_id: number; amount: number }[];
  }[],
  categories: Category[],
  range: PeriodRange
): CategorySpend[] {
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const totals = new Map<number, number>();

  filterByPeriod(transactions, range)
    .filter((t) => t.type === 'Income')
    .forEach((t) => {
      const splits = t.transaction_splits?.filter((s) => s.category_id) ?? [];
      if (splits.length > 0) {
        splits.forEach((s) => {
          totals.set(
            s.category_id,
            (totals.get(s.category_id) || 0) + Number(s.amount)
          );
        });
        return;
      }
      if (!t.category_id) return;
      totals.set(t.category_id, (totals.get(t.category_id) || 0) + Number(t.amount));
    });

  const results: CategorySpend[] = [];
  totals.forEach((total, id) => {
    const cat = catMap[id];
    if (cat)
      results.push({ name: cat.name, emoji: cat.emoji, total: snapMoney(total) });
  });

  let readyToAssign = 0;
  filterByPeriod(transactions, range)
    .filter((t) => t.type === 'Income')
    .forEach((t) => {
      const splits = t.transaction_splits?.filter((s) => s.category_id) ?? [];
      if (splits.length === 0 && !t.category_id) {
        readyToAssign += Number(t.amount);
      }
    });
  if (readyToAssign > 0) {
    results.push({
      name: 'Ready to Assign',
      emoji: null,
      total: snapMoney(readyToAssign),
    });
  }

  return results.sort((a, b) => b.total - a.total);
}

export function aggregateTopIncomeSources(
  transactions: { date: string; payee: string | null; amount: number; type: string }[],
  range: PeriodRange,
  limit = 8
): PayeeSpend[] {
  const totals = new Map<string, number>();
  filterByPeriod(transactions, range)
    .filter((t) => t.type === 'Income' && t.payee)
    .forEach((t) => {
      const key = t.payee!;
      totals.set(key, (totals.get(key) || 0) + Number(t.amount));
    });
  return Array.from(totals.entries())
    .map(([payee, total]) => ({ payee, total: snapMoney(total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export function aggregateSpendingByCategory(
  transactions: {
    date: string;
    amount: number;
    type: string;
    category_id: number | null;
    transaction_splits?: { category_id: number; amount: number }[];
  }[],
  categories: Category[],
  range: PeriodRange
) {
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const totals = new Map<number, number>();

  filterByPeriod(transactions, range)
    .filter((t) => t.type === 'Expense')
    .forEach((t) => {
      const splits = t.transaction_splits?.filter((s) => s.category_id) ?? [];
      if (splits.length > 0) {
        splits.forEach((s) => {
          totals.set(
            s.category_id,
            (totals.get(s.category_id) || 0) + Number(s.amount)
          );
        });
        return;
      }
      if (!t.category_id) return;
      totals.set(t.category_id, (totals.get(t.category_id) || 0) + Number(t.amount));
    });

  const results: CategorySpend[] = [];
  totals.forEach((total, id) => {
    const cat = catMap[id];
    if (cat)
      results.push({ name: cat.name, emoji: cat.emoji, total: snapMoney(total) });
  });

  return results.sort((a, b) => b.total - a.total);
}

export function computeNetWorth(accounts: Account[]) {
  return snapMoney(
    accounts.reduce(
      (sum, acc) =>
        acc.type === 'Credit Card'
          ? sum - Math.abs(Number(acc.balance))
          : sum + Number(acc.balance),
      0
    )
  );
}

export function computeLiquidCash(accounts: Account[]) {
  return snapMoney(
    accounts
      .filter((a) => isLiquidAccount(a.type))
      .reduce((sum, a) => sum + Number(a.balance), 0)
  );
}

export function computeReadyToAssign(liquidCash: number, categories: Category[]) {
  const assigned = categories
    .filter((c) => !c.is_hidden)
    .reduce((sum, c) => sum + Number(c.assigned_amount || 0), 0);
  return snapMoney(liquidCash - assigned);
}

export interface PayeeSpend {
  payee: string;
  total: number;
}

export function aggregateTopPayees(
  transactions: { date: string; payee: string | null; amount: number; type: string }[],
  range: PeriodRange,
  limit = 8
): PayeeSpend[] {
  const totals = new Map<string, number>();

  filterByPeriod(transactions, range)
    .filter((t) => t.type === 'Expense' && t.payee)
    .forEach((t) => {
      const key = t.payee!;
      totals.set(key, (totals.get(key) || 0) + Number(t.amount));
    });

  return Array.from(totals.entries())
    .map(([payee, total]) => ({ payee, total: snapMoney(total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

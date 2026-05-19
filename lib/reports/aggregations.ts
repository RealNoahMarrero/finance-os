import { format, subMonths, startOfMonth, parseISO } from 'date-fns';
import { snapMoney } from '@/lib/money';
import type { Account, Category, Transaction } from '@/lib/types';
import { isLiquidAccount } from '@/lib/constants/account-types';

export type ReportPeriod = '30d' | '90d' | 'ytd' | '12mo';

export function getPeriodStart(period: ReportPeriod): string {
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

export interface MonthlyCashflow {
  month: string;
  income: number;
  expense: number;
}

export function aggregateMonthlyCashflow(
  transactions: { date: string; amount: number; type: string }[],
  period: ReportPeriod
): MonthlyCashflow[] {
  const start = getPeriodStart(period);
  const filtered = transactions.filter((t) => t.date >= start);
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

export function aggregateSpendingByCategory(
  transactions: {
    date: string;
    amount: number;
    type: string;
    category_id: number | null;
    transaction_splits?: { category_id: number; amount: number }[];
  }[],
  categories: Category[],
  period: ReportPeriod
) {
  const start = getPeriodStart(period);
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const totals = new Map<number, number>();

  transactions
    .filter((t) => t.type === 'Expense' && t.date >= start)
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
  period: ReportPeriod,
  limit = 8
): PayeeSpend[] {
  const start = getPeriodStart(period);
  const totals = new Map<string, number>();

  transactions
    .filter((t) => t.type === 'Expense' && t.date >= start && t.payee)
    .forEach((t) => {
      const key = t.payee!;
      totals.set(key, (totals.get(key) || 0) + Number(t.amount));
    });

  return Array.from(totals.entries())
    .map(([payee, total]) => ({ payee, total: snapMoney(total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

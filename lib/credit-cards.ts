import { snapMoney } from '@/lib/money';
import type { Account } from '@/lib/types';

export function creditCardBalanceOwed(balance: number): number {
  return snapMoney(Math.abs(Number(balance)));
}

export function computeCreditUtilization(balance: number, creditLimit: number): number | null {
  const limit = Number(creditLimit);
  if (limit <= 0) return null;
  const owed = creditCardBalanceOwed(balance);
  return Math.round((owed / limit) * 1000) / 10;
}

/** Bar fill width only — caps at 100% so the track does not overflow. */
export function creditUtilizationBarWidth(utilizationPct: number): number {
  return Math.min(100, utilizationPct);
}

export interface AggregateCreditUtilization {
  utilizationPct: number;
  totalOwed: number;
  totalLimit: number;
}

/** Combined usage across all credit cards (owed ÷ total limits). */
export function computeAggregateCreditUtilization(
  accounts: Account[]
): AggregateCreditUtilization | null {
  const cards = accounts.filter((a) => a.type === 'Credit Card');
  const totalOwed = snapMoney(
    cards.reduce((sum, a) => sum + creditCardBalanceOwed(a.balance), 0)
  );
  const totalLimit = snapMoney(
    cards.reduce((sum, a) => sum + Math.max(0, Number(a.credit_limit) || 0), 0)
  );
  if (totalLimit <= 0) return null;
  return {
    utilizationPct: Math.round((totalOwed / totalLimit) * 1000) / 10,
    totalOwed,
    totalLimit,
  };
}

export function computeCreditAvailable(balance: number, creditLimit: number): number {
  const limit = Number(creditLimit);
  if (limit <= 0) return 0;
  return snapMoney(Math.max(0, limit - creditCardBalanceOwed(balance)));
}

export interface CreditCardSummary {
  id: number;
  name: string;
  balance: number;
  credit_limit: number;
  owed: number;
  available: number;
  utilizationPct: number | null;
}

export function summarizeCreditCards(accounts: Account[]): CreditCardSummary[] {
  return accounts
    .filter((a) => a.type === 'Credit Card')
    .map((a) => ({
      id: a.id,
      name: a.name,
      balance: a.balance,
      credit_limit: a.credit_limit,
      owed: creditCardBalanceOwed(a.balance),
      available: computeCreditAvailable(a.balance, a.credit_limit),
      utilizationPct: computeCreditUtilization(a.balance, a.credit_limit),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

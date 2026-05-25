import {
  addMonths,
  format,
  getDaysInMonth,
  isBefore,
  isSameMonth,
  parseISO,
  setDate,
  startOfDay,
  startOfMonth,
} from 'date-fns';
import { snapMoney } from '@/lib/money';
import type { Account, Category } from '@/lib/types';

/** Resolve due day for a month (e.g. due on 31 → last day of February). */
export function resolvePaymentDueDayInMonth(month: Date, dueDay: number): Date {
  const start = startOfMonth(month);
  const daysInMonth = getDaysInMonth(start);
  const day = Math.min(Math.max(1, dueDay), daysInMonth);
  return setDate(start, day);
}

export function formatCreditCardPaymentDate(month: Date, dueDay: number): string {
  return format(resolvePaymentDueDayInMonth(month, dueDay), 'yyyy-MM-dd');
}

/** Next occurrence of payment_due_day on or after today. */
export function computeInitialNextPaymentDueDate(
  paymentDueDay: number,
  from: Date = new Date()
): string {
  const today = startOfDay(from);
  let candidate = resolvePaymentDueDayInMonth(today, paymentDueDay);
  if (isBefore(candidate, today)) {
    candidate = resolvePaymentDueDayInMonth(
      addMonths(startOfMonth(today), 1),
      paymentDueDay
    );
  }
  return format(candidate, 'yyyy-MM-dd');
}

export function advanceNextPaymentDueDate(
  currentDueDate: string,
  paymentDueDay: number
): string {
  return formatCreditCardPaymentDate(
    addMonths(parseISO(currentDueDate), 1),
    paymentDueDay
  );
}

export type CreditCardPaymentFundingStatus = 'funded' | 'underfunded' | 'unlinked';

export function getCreditCardPaymentFundingStatus(
  account: Account,
  categories: Pick<Category, 'id' | 'assigned_amount'>[]
): CreditCardPaymentFundingStatus {
  if (!account.payment_category_id) return 'unlinked';
  const cat = categories.find((c) => c.id === account.payment_category_id);
  if (!cat) return 'unlinked';
  const min = Number(account.minimum_payment) || 0;
  if (min <= 0) return 'funded';
  return Number(cat.assigned_amount) >= min ? 'funded' : 'underfunded';
}

export function creditCardCalendarChipClass(
  account: Account,
  today: Date,
  categories: Pick<Category, 'id' | 'assigned_amount'>[]
): string {
  const funded = getCreditCardPaymentFundingStatus(account, categories) === 'funded';
  const isPastDue =
    account.next_payment_due_date &&
    isBefore(parseISO(account.next_payment_due_date), startOfDay(today));

  if (funded) {
    return 'bg-gradient-to-br from-yellow-400 to-amber-500 text-white border-amber-500 shadow-sm';
  }
  if (isPastDue) {
    return 'bg-red-500/10 border-red-500/30 text-red-700 shadow-sm';
  }
  return 'bg-red-500/10 border-red-500/30 text-red-800';
}

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
  minimum_payment: number;
  payment_due_day: number | null;
  next_payment_due_date: string | null;
  payment_category_id: number | null;
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
      minimum_payment: Number(a.minimum_payment) || 0,
      payment_due_day: a.payment_due_day ?? null,
      next_payment_due_date: a.next_payment_due_date ?? null,
      payment_category_id: a.payment_category_id ?? null,
      owed: creditCardBalanceOwed(a.balance),
      available: computeCreditAvailable(a.balance, a.credit_limit),
      utilizationPct: computeCreditUtilization(a.balance, a.credit_limit),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function isCreditCardPaymentDueInMonth(
  account: Account,
  month: Date
): boolean {
  if (account.type !== 'Credit Card' || !account.next_payment_due_date) {
    return false;
  }
  return isSameMonth(parseISO(account.next_payment_due_date), month);
}

export function totalCreditMinimumsDueInMonth(
  accounts: Account[],
  month: Date
): number {
  return snapMoney(
    accounts
      .filter((a) => isCreditCardPaymentDueInMonth(a, month))
      .reduce((sum, a) => sum + (Number(a.minimum_payment) || 0), 0)
  );
}

/** Credit cards with next_payment_due_date on this calendar day. */
export function creditCardsDueOnDay(accounts: Account[], dayIso: string): Account[] {
  return accounts.filter(
    (a) =>
      a.type === 'Credit Card' &&
      a.next_payment_due_date === dayIso
  );
}

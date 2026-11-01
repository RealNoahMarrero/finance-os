// Money model + the pure "money math" selectors the UI reads. All amounts are integer cents.
// Nothing here touches the network; db.ts maps database rows into this shape.
import type { CreditState } from './credit';
import { addDays, daysInMonth, diffDays, iso, monthKey, monthShift, parse, sum, todayISO } from './lib';

export type AccountType = 'checking' | 'savings' | 'cash' | 'credit';
export interface Account {
  id: string; name: string; type: AccountType; mask: string; institution: string;
  balance: number; // cents. Credit cards: amount owed (positive).
  limit?: number;
  lastReconciled: string | null;   // latest reconciliation or cutover date; null = never verified
  baseline: string | null;         // cutover date; null = no cutover yet (history not yet anchored)
  openingBalance: number | null;   // the balance the user entered at the cutover date
  derived: number | null;          // balance implied by opening + transactions after cutover
  paymentCategoryId?: string;
  nextPaymentDue?: string; // account-level payment due date (used only when no linked bill exists)
}
export interface Group { id: string; name: string; kind: 'bills' | 'everyday' | 'lifestyle' | 'goals' }
export interface Category {
  id: string; groupId: string; name: string; icon: string; target: number | null;
  priority: 1 | 2 | 3; carry: number;
  assigned: number; // the envelope's Available balance as stored (budgeted minus activity)
  cardAccountId?: string; hidden: boolean; billPaused?: boolean;
  isDebt?: boolean; debtBalance?: number; // a standalone amount owed (cents), independent of envelope funding, bills and credit cards
}
export interface Txn {
  id: string; date: string; payee: string; amount: number; type: 'expense' | 'income' | 'transfer';
  accountId: string; toAccountId?: string; categoryId?: string; splits?: { categoryId: string; amount: number }[];
  notes?: string; adjustment?: boolean; billId?: string; incomeId?: string;
}
export type BillPeriod = 'Monthly' | 'Weekly' | 'Bi-Weekly' | 'Yearly';
export interface Bill {
  id: string; name: string; payee: string; categoryId?: string; amount: number; dueDay: number;
  recurring: boolean; date?: string; // the stored next due date
  period: BillPeriod;
  mode: 'reminder' | 'prepare'; accountId: string; toAccountId?: string;
  paid: Record<string, string>; // due date -> transaction id | 'manual'
  isDebt?: boolean;
  anchor?: string; // the calendar date the schedule is anchored to (day of month / yearly month+day); falls back to `date`
  paused: boolean;
}
export type Repeat = 'none' | 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
export interface Income {
  id: string; label: string; amount: number; date: string; certainty: 'guaranteed' | 'anticipated';
  repeat: Repeat; accountId: string; status: 'pending' | 'received'; who: string;
}
export interface Debt { id: string; name: string; balance: number; payment: number; dueDay: number; startBalance: number; billId?: string }
export interface Planned { id: string; label: string; amount: number; dayOfMonth?: number; date?: string }
export interface Reconciliation { id: string; accountId: string; date: string; recorded: number; actual: number; diff: number; adjustmentTxnId?: string; note?: string }
export interface DataState {
  accounts: Account[]; groups: Group[]; categories: Category[]; txns: Txn[]; bills: Bill[];
  incomes: Income[]; debts: Debt[]; planned: Planned[]; reconciliations: Reconciliation[]; today: string;
  hiddenBusiness: { accounts: number; categories: number; transactions: number };
  credit: CreditState;
}

export function emptyData(): DataState {
  return { accounts: [], groups: [], categories: [], txns: [], bills: [], incomes: [], debts: [], planned: [], reconciliations: [], today: todayISO(), hiddenBusiness: { accounts: 0, categories: 0, transactions: 0 }, credit: { scores: [], meta: {}, reported: [], ready: false } };
}

// ═════════ selectors ═════════
export const isLiquid = (a: Account) => a.type !== 'credit';
export const liquidTotal = (d: DataState) => sum(d.accounts.filter(isLiquid), (a) => a.balance);
export const spendingTotal = (d: DataState) => sum(d.accounts.filter((a) => a.type === 'checking' || a.type === 'cash'), (a) => a.balance);
export const cardsOwed = (d: DataState) => sum(d.accounts.filter((a) => a.type === 'credit'), (a) => a.balance);
export const loansOwed = (d: DataState) => sum(d.debts, (x) => x.balance);
export const netWorth = (d: DataState) => liquidTotal(d) - cardsOwed(d) - loansOwed(d);

export interface Envelope { assigned: number; spent: number; moved: number; avail: number; target: number | null; remaining: number; fundedPct: number }
export function envelope(d: DataState, catId: string, month = monthKey(d.today)): Envelope {
  const k = d.categories.find((x) => x.id === catId);
  if (!k) return { assigned: 0, spent: 0, moved: 0, avail: 0, target: null, remaining: 0, fundedPct: 0 };
  let spent = 0;
  for (const t of d.txns) {
    if (t.adjustment || monthKey(t.date) !== month) continue;
    if (t.type === 'expense') {
      if (t.splits?.length) { for (const s of t.splits) if (s.categoryId === catId) spent += s.amount; }
      else if (t.categoryId === catId) spent += t.amount;
    } else if (t.type === 'transfer' && t.categoryId === catId) spent += t.amount; // payment toward a card / loan from its envelope
  }
  // The stored envelope balance IS what is available now. A target counts as funded once that much is set aside.
  const avail = k.assigned;
  const funded = Math.max(0, avail);
  const remaining = k.target != null && k.target > 0 && !k.billPaused ? Math.max(0, k.target - funded) : 0; // a paused bill asks for no funding
  return { assigned: funded, spent, moved: 0, avail, target: k.target, remaining, fundedPct: k.target ? Math.min(1, funded / k.target) : 0 };
}
export const allEnvelopes = (d: DataState) => d.categories.map((k) => ({ cat: k, env: envelope(d, k.id) }));
export const totalAvail = (d: DataState) => sum(allEnvelopes(d), (e) => e.env.avail);
export const readyToAssign = (d: DataState) => liquidTotal(d) - totalAvail(d);
export function buckets(d: DataState) {
  const by = (kinds: Group['kind'][]) => sum(allEnvelopes(d).filter((e) => !e.cat.hidden && kinds.includes(d.groups.find((g) => g.id === e.cat.groupId)?.kind ?? 'goals')), (e) => e.env.avail);
  const committed = by(['bills', 'goals']);
  const flexible = by(['everyday', 'lifestyle']);
  return { committed, flexible, rta: readyToAssign(d), total: liquidTotal(d) };
}
export const overspent = (d: DataState) => allEnvelopes(d).filter((e) => e.env.avail < 0 && !e.cat.hidden);
export const underfunded = (d: DataState) => allEnvelopes(d).filter((e) => e.env.remaining > 0 && !e.cat.hidden);

// effect of a transaction on account balances (sign = +1 apply, −1 reverse)
export function applyTxnToAccounts(accounts: Account[], t: Txn, sign: 1 | -1): Account[] {
  return accounts.map((a) => {
    let delta = 0;
    const credit = a.type === 'credit';
    if (t.type === 'expense' && a.id === t.accountId) delta = credit ? t.amount : -t.amount;
    if (t.type === 'income' && a.id === t.accountId) delta = credit ? -t.amount : t.amount;
    if (t.type === 'transfer') {
      if (a.id === t.accountId) delta += credit ? t.amount : -t.amount;
      if (a.id === t.toAccountId) delta += credit ? -t.amount : t.amount;
    }
    return delta ? { ...a, balance: a.balance + sign * delta } : a;
  });
}
export const isAdjustmentTxn = (t: Txn) => !!t.adjustment;

// ── bill occurrences ──────────────────────────────────────────
export interface BillOcc { bill: Bill; date: string; key: string; paid: boolean; future: boolean; status: 'overdue' | 'due' | 'upcoming' | 'paid'; funded: number; short: number }
/** Next occurrence after `cur`. Mirrors the database function fos_bill_next exactly: monthly keeps the anchor's day, clamped to the
 *  last valid day of shorter months and returning to it when possible; yearly keeps the anchor's month and day (Feb 29 → Feb 28 in common years). */
export const nextDueDate = (period: BillPeriod, anchor: string, cur: string) => {
  if (period === 'Weekly') return addDays(cur, 7);
  if (period === 'Bi-Weekly') return addDays(cur, 14);
  const day = Number(anchor.slice(8, 10));
  if (period === 'Yearly') { const m = `${Number(cur.slice(0, 4)) + 1}-${anchor.slice(5, 7)}`; return `${m}-${String(Math.min(day, daysInMonth(m))).padStart(2, '0')}`; }
  const m = monthShift(monthKey(cur), 1);
  return `${m}-${String(Math.min(day, daysInMonth(m))).padStart(2, '0')}`;
};
const nextDue = (b: Bill, date: string) => nextDueDate(b.period, b.anchor ?? b.date ?? date, date);
/** The first unpaid due date on or after today (used when resuming a paused bill). One-time bills keep their date. */
export function rollForward(b: Pick<Bill, 'recurring' | 'period' | 'anchor' | 'date' | 'paid'>, from: string, today: string): string {
  let cur = from, guard = 0;
  if (!b.recurring) return cur;
  while ((cur < today || b.paid[cur]) && guard++ < 500) cur = nextDueDate(b.period, b.anchor ?? b.date ?? from, cur);
  return cur;
}
export function billOccurrences(d: DataState, from: string, to: string): BillOcc[] {
  const out: BillOcc[] = [];
  const thisMonth = monthKey(d.today);
  for (const b of d.bills) {
    const dates: { date: string; paid: boolean }[] = [];
    for (const dd of Object.keys(b.paid)) if (dd >= from && dd <= to) dates.push({ date: dd, paid: true });
    if (b.date && !b.paused) { // a paused bill keeps its history (paid dates above) but schedules nothing new
      let cur = b.date, guard = 0;
      // the stored date is the next unpaid one; it stays visible (as overdue) until it is confirmed
      while (cur <= to && guard++ < 60) {
        if (!b.paid[cur] && (cur >= from || (cur < d.today && to >= d.today))) dates.push({ date: cur, paid: false });
        if (!b.recurring) break;
        cur = nextDue(b, cur);
      }
    }
    for (const { date, paid } of dates) {
      const key = date;
      const env = b.categoryId ? envelope(d, b.categoryId, thisMonth) : null;
      const future = monthKey(date) > thisMonth;
      const funded = !env ? b.amount : future ? 0 : Math.max(0, Math.min(b.amount, env.avail));
      const status: BillOcc['status'] = paid ? 'paid' : date < d.today ? 'overdue' : diffDays(date, d.today) <= 3 ? 'due' : 'upcoming';
      out.push({ bill: b, date, key, paid, future, status, funded: paid ? b.amount : funded, short: paid || future ? 0 : Math.max(0, b.amount - funded) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.bill.name.localeCompare(b.bill.name));
}
export const upcomingBills = (d: DataState, days = 21) => {
  const from = addDays(d.today, -14);
  return billOccurrences(d, from, addDays(d.today, days)).filter((o) => !o.paid);
};

// ── income occurrences ────────────────────────────────────────
export interface IncomeOcc { inc: Income; date: string; amount: number }
export function incomeOccurrences(d: DataState, from: string, to: string, certainty: 'all' | 'guaranteed' = 'all'): IncomeOcc[] {
  const out: IncomeOcc[] = [];
  for (const inc of d.incomes) {
    if (inc.status !== 'pending') continue;
    if (certainty === 'guaranteed' && inc.certainty !== 'guaranteed') continue;
    let date = inc.date;
    const push = (dt: string) => { if (dt >= from && dt <= to) out.push({ inc, date: dt, amount: inc.amount }); };
    if (inc.repeat === 'none') { push(date); continue; }
    let guard = 0;
    while (date <= to && guard++ < 400) {
      push(date);
      if (inc.repeat === 'weekly') date = addDays(date, 7);
      else if (inc.repeat === 'biweekly') date = addDays(date, 14);
      else if (inc.repeat === 'monthly') { const m = monthShift(monthKey(date), 1); date = `${m}-${String(Math.min(parse(inc.date).getDate(), daysInMonth(m))).padStart(2, '0')}`; }
      else if (inc.repeat === 'semimonthly') {
        // Pays near the 1st and 16th: next date alternates
        const day = parse(date).getDate();
        const m = monthKey(date);
        if (day < 10) date = `${m}-16`; else date = `${monthShift(m, 1)}-02`;
        const dow = parse(date).getDay();
        if (dow === 0) date = addDays(date, 1); else if (dow === 6) date = addDays(date, -1);
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ── forecast ──────────────────────────────────────────────────
export interface FPoint { date: string; balance: number; low?: boolean }
export interface Forecast { actual: FPoint[]; conservative: FPoint[]; optimistic: FPoint[]; flexDaily: number }

export function flexDailyAverage(d: DataState): number {
  const start = addDays(monthKey(d.today) + '-01', -61);
  const end = monthKey(d.today) + '-01';
  const flexCats = new Set(d.categories.filter((k) => { const g = d.groups.find((x) => x.id === k.groupId); return !!g && (g.kind === 'everyday' || g.kind === 'lifestyle'); }).map((k) => k.id));
  let total = 0;
  for (const t of d.txns) {
    if (t.type !== 'expense' || t.date < start || t.date >= end) continue;
    if (t.splits?.length) total += sum(t.splits.filter((s) => flexCats.has(s.categoryId)), (s) => s.amount);
    else if (t.categoryId && flexCats.has(t.categoryId)) total += t.amount;
  }
  return Math.round(total / diffDays(end, start));
}

export function buildForecast(d: DataState, horizon: number): Forecast {
  const today = d.today;
  const end = addDays(today, horizon);
  const flexDaily = flexDailyAverage(d);
  // Actual history for the last 30 days (spending accounts)
  const spendIds = new Set(d.accounts.filter((a) => a.type === 'checking' || a.type === 'cash').map((a) => a.id));
  const delta = (t: Txn) => {
    let x = 0;
    if (spendIds.has(t.accountId)) x += t.type === 'income' ? t.amount : -t.amount;
    if (t.type === 'transfer' && t.toAccountId && spendIds.has(t.toAccountId)) x += t.amount;
    if (t.type === 'transfer' && spendIds.has(t.accountId)) x += 0; // already counted above as outflow
    return x;
  };
  const cur = spendingTotal(d);
  const actual: FPoint[] = [];
  for (let i = -30; i <= 0; i++) {
    const date = addDays(today, i);
    const after = sum(d.txns.filter((t) => t.date > date), delta);
    actual.push({ date, balance: cur - after });
  }
  const bills = billOccurrences(d, today, end).filter((o) => !o.paid || o.date > today);
  const overdue = billOccurrences(d, addDays(today, -30), addDays(today, -1)).filter((o) => !o.paid);
  const run = (cert: 'all' | 'guaranteed'): FPoint[] => {
    const incomes = incomeOccurrences(d, addDays(today, 1), end, cert);
    const byDate = new Map<string, number>();
    const add = (dt: string, v: number) => byDate.set(dt, (byDate.get(dt) || 0) + v);
    for (const o of bills) if (o.date > today) add(o.date, -o.bill.amount);
    for (const o of overdue) add(addDays(today, 1), -o.bill.amount);
    for (const i of incomes) add(i.date, i.amount);
    for (const p of d.planned) {
      if (p.date) { if (p.date > today && p.date <= end) add(p.date, -p.amount); }
      else if (p.dayOfMonth) {
        let m = monthKey(today);
        while (m <= monthKey(end)) {
          const dt = `${m}-${String(p.dayOfMonth).padStart(2, '0')}`;
          if (dt > today && dt <= end) add(dt, -p.amount);
          m = monthShift(m, 1);
        }
      }
    }
    const pts: FPoint[] = [{ date: today, balance: cur }];
    let bal = cur;
    for (let i = 1; i <= horizon; i++) {
      const date = addDays(today, i);
      bal += (byDate.get(date) || 0) - flexDaily;
      pts.push({ date, balance: bal });
    }
    return pts;
  };
  return { actual, conservative: run('guaranteed'), optimistic: run('all'), flexDaily };
}

export function shortfall(f: Forecast, limit = 90) {
  const pts = f.conservative.slice(0, limit + 1);
  const first = pts.find((p) => p.balance < 0);
  const min = pts.reduce((m, p) => (p.balance < m.balance ? p : m), pts[0]);
  const optMin = f.optimistic.slice(0, limit + 1).reduce((m, p) => (p.balance < m.balance ? p : m), f.optimistic[0]);
  return { first, min, optMin };
}

// ── insights data ─────────────────────────────────────────────
export function monthlyFlow(d: DataState) {
  const cur = monthKey(d.today);
  const out: { key: string; income: number; expense: number; imported?: boolean; partial?: boolean }[] = [];
  for (let i = -5; i <= 0; i++) {
    const k = monthShift(cur, i);
    let income = 0, expense = 0;
    for (const t of d.txns) {
      if (monthKey(t.date) !== k || t.adjustment) continue;
      if (t.type === 'income') income += t.amount;
      if (t.type === 'expense') expense += t.amount; // card payments are transfers, so purchases are not counted twice
    }
    out.push({ key: k, income, expense, partial: k === cur });
  }
  return out;
}
/** Net worth at each month-end, walked backwards from today using real transactions (income minus expenses). */
export function netWorthSeries(d: DataState) {
  const cur = monthKey(d.today);
  let nw = netWorth(d);
  const out: { key: string; value: number }[] = [];
  for (let i = 0; i >= -11; i--) {
    const k = monthShift(cur, i);
    out.unshift({ key: k, value: nw });
    for (const t of d.txns) {
      if (monthKey(t.date) !== k) continue;
      if (t.type === 'income') nw -= t.amount; else if (t.type === 'expense') nw += t.amount;
    }
  }
  return out;
}
export function categorySpend(d: DataState, month = monthKey(d.today)) {
  return d.categories
    .map((k) => ({ cat: k, spent: envelope(d, k.id, month).spent }))
    .filter((x) => x.spent > 0 && !x.cat.cardAccountId && !x.cat.hidden && d.groups.find((g) => g.id === x.cat.groupId)?.kind !== 'bills')
    .sort((a, b) => b.spent - a.spent);
}
export function usualSpend(d: DataState, catId: string) {
  const m1 = monthShift(monthKey(d.today), -1), m2 = monthShift(monthKey(d.today), -2);
  return Math.round((envelope(d, catId, m1).spent + envelope(d, catId, m2).spent) / 2);
}
export function balanceSeries(d: DataState, accountId: string, days = 30) {
  const a = d.accounts.find((x) => x.id === accountId)!;
  const pts: number[] = [];
  for (let i = -days; i <= 0; i++) {
    const date = addDays(d.today, i);
    let bal = a.balance;
    for (const t of d.txns) {
      if (t.date <= date) continue;
      let delta = 0;
      const credit = a.type === 'credit';
      if (t.type === 'expense' && t.accountId === a.id) delta = credit ? t.amount : -t.amount;
      if (t.type === 'income' && t.accountId === a.id) delta = credit ? -t.amount : t.amount;
      if (t.type === 'transfer') {
        if (t.accountId === a.id) delta += credit ? t.amount : -t.amount;
        if (t.toAccountId === a.id) delta += credit ? -t.amount : t.amount;
      }
      bal -= delta;
    }
    pts.push(bal);
  }
  return pts;
}
export const staleness = (a: Account, today: string) => {
  if (!a.lastReconciled) return { days: Infinity, level: 'never' } as const;
  const days = diffDays(today, a.lastReconciled);
  return { days, level: days >= 30 ? 'stale' : days >= 14 ? 'aging' : 'fresh' } as const;
};
export const isVerified = (a: Account) => a.lastReconciled != null;
/** balance implied by opening balance + later transactions, minus the recorded balance */
export const drift = (a: Account) => (a.derived == null ? null : a.derived - a.balance);
export { iso };

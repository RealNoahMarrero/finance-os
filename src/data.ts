// Money model + the pure "money math" selectors the UI reads. All amounts are integer cents.
// Nothing here touches the network; db.ts maps database rows into this shape.
import type { CreditState } from './credit';
import { addDays, daysInMonth, diffDays, iso, monthKey, monthShift, parse, sum, todayISO } from './lib';

export type AccountType = 'checking' | 'savings' | 'cash' | 'credit';
export interface Account {
  id: string; name: string; type: AccountType; mask: string; institution: string;
  balance: number; // cents. Credit cards: amount owed (positive).
  limit?: number;
  archived?: boolean;              // hidden from lists and pickers; history is kept
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
  cardAccountId?: string; hidden: boolean; billPaused?: boolean; billArchived?: boolean;
  isDebt?: boolean; debtBalance?: number; // a standalone amount owed (cents), independent of envelope funding, bills and credit cards
  targetMode?: 'save' | 'keep'; // wording of the funding goal: save toward an amount / keep an amount available
}
export interface Txn {
  id: string; date: string; payee: string; amount: number; type: 'expense' | 'income' | 'transfer';
  accountId: string; toAccountId?: string; categoryId?: string; splits?: { categoryId: string; amount: number }[];
  notes?: string; adjustment?: boolean; billId?: string; billPartial?: boolean; incomeId?: string; scheduled?: boolean; // scheduled = future-dated and not yet posted to balances
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
  anchor?: string; // the original day a monthly income repeats on (so month-end paydays never drift)
}
export interface Debt { id: string; name: string; balance: number; payment: number; dueDay: number; startBalance: number; billId?: string }
export interface Planned { id: string; label: string; amount: number; dayOfMonth?: number; date?: string }
export interface Reconciliation { id: string; accountId: string; date: string; recorded: number; actual: number; diff: number; adjustmentTxnId?: string; note?: string }
/** A transaction explicitly linked as a PARTIAL payment toward one occurrence (due date) of a scheduled item. */
export interface BillPartial { txnId: string; billId: string; due: string; amount: number }
export interface DataState {
  billPartials?: BillPartial[];
  accounts: Account[]; allAccounts: Account[]; groups: Group[]; categories: Category[]; txns: Txn[]; bills: Bill[]; archivedBills: Bill[];
  incomes: Income[]; debts: Debt[]; planned: Planned[]; reconciliations: Reconciliation[]; today: string;
  hiddenBusiness: { accounts: number; categories: number; transactions: number };
  credit: CreditState;
}

export function emptyData(): DataState {
  return { accounts: [], allAccounts: [], groups: [], categories: [], txns: [], bills: [], archivedBills: [], incomes: [], debts: [], planned: [], reconciliations: [], billPartials: [], today: todayISO(), hiddenBusiness: { accounts: 0, categories: 0, transactions: 0 }, credit: { scores: [], meta: {}, reported: [], ready: false } };
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
    if (t.adjustment || t.scheduled || monthKey(t.date) !== month) continue;
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
/** Money sitting in the envelopes you actually budget with. Archived (hidden) envelopes are NOT part of the budget — the original app ignored them
 *  in every total, and several hold old negative balances (overspending from before the redesign) that would otherwise look like free cash. */
export const totalAvail = (d: DataState) => sum(allEnvelopes(d).filter((e) => !e.cat.hidden), (e) => e.env.avail);
export const archivedAvail = (d: DataState) => sum(allEnvelopes(d).filter((e) => e.cat.hidden && Math.abs(e.env.avail) > 0), (e) => e.env.avail);
export const readyToAssign = (d: DataState) => liquidTotal(d) - totalAvail(d);
/** The four numbers that must always tie out: recorded cash = assigned to envelopes + ready to assign (negative = over-assigned).
 *  Expected income is shown beside them but is never part of that equation. */
export function cashCheck(d: DataState) {
  const cash = liquidTotal(d), assigned = totalAvail(d), rta = cash - assigned;
  const exp = incomeOccurrences(d, d.today, addDays(d.today, 30));
  return { cash, assigned, rta, overAssigned: rta < 0 ? -rta : 0, archived: archivedAvail(d), expected30: sum(exp, (o) => o.amount), guaranteed30: sum(exp.filter((o) => o.inc.certainty === 'guaranteed'), (o) => o.amount) };
}
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
    // One envelope pays one bill: its available money is shared out across the unpaid occurrences, oldest first, never counted twice.
    dates.sort((x, y) => x.date.localeCompare(y.date));
    const env = b.categoryId ? envelope(d, b.categoryId, thisMonth) : null;
    let pool = env ? Math.max(0, env.avail) : 0;
    for (const { date, paid } of dates) {
      const key = date;
      const future = monthKey(date) > thisMonth;
      let funded = !env ? b.amount : future ? 0 : Math.min(b.amount, pool);
      if (env && !paid && !future) pool -= funded;
      const status: BillOcc['status'] = paid ? 'paid' : date < d.today ? 'overdue' : diffDays(date, d.today) <= 3 ? 'due' : 'upcoming';
      out.push({ bill: b, date, key, paid, future, status, funded: paid ? b.amount : funded, short: paid || future ? 0 : Math.max(0, b.amount - funded) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.bill.name.localeCompare(b.bill.name));
}
/** One entry per bill for display: its oldest unpaid occurrence, how many are overdue, and the rest. */
export interface BillGroup { bill: Bill; occs: BillOcc[]; next: BillOcc; missed: number; total: number }
export function groupBills(occs: BillOcc[]): BillGroup[] {
  const by = new Map<string, BillOcc[]>();
  for (const o of occs.filter((x) => !x.paid)) { if (!by.has(o.bill.id)) by.set(o.bill.id, []); by.get(o.bill.id)!.push(o); }
  return [...by.values()].map((list) => {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const missed = list.filter((o) => o.status === 'overdue').length;
    return { bill: list[0].bill, occs: list, next: list[0], missed, total: list.reduce((n, o) => n + (o.status === 'overdue' ? o.bill.amount : 0), 0) };
  }).sort((a, b) => a.next.date.localeCompare(b.next.date) || a.bill.name.localeCompare(b.bill.name));
}
export const upcomingBills = (d: DataState, days = 21) => {
  const from = addDays(d.today, -14);
  return billOccurrences(d, from, addDays(d.today, days)).filter((o) => !o.paid);
};

// ── income occurrences ────────────────────────────────────────
/** One expected arrival. `date` is the EFFECTIVE date: an entry whose scheduled date has passed (and is still pending) is shown as arriving today,
 *  and that moves forward by itself each day. The stored date and recurrence are never rewritten; `original` keeps the scheduled date. */
export interface IncomeOcc { inc: Income; date: string; amount: number; overdue: boolean; original?: string }
/** Effective expected date of a pending entry on `today` (display only — the stored date is untouched). */
export const effectiveIncomeDate = (date: string, today: string) => (date < today ? today : date);

/** The next date a repeating income arrives after `date`. Mirrors the database function fos_next_income_date exactly:
 *  monthly keeps the original day (anchor) clamped to the month's end; semimonthly = the 1st and 16th, moved off weekends (Sat → Fri, Sun → Mon). */
export function nextIncomeDate(repeat: Repeat, date: string, anchor?: string): string | null {
  if (repeat === 'weekly') return addDays(date, 7);
  if (repeat === 'biweekly') return addDays(date, 14);
  if (repeat === 'monthly') { const m = monthShift(monthKey(date), 1); return `${m}-${String(Math.min(Number((anchor ?? date).slice(8, 10)), daysInMonth(m))).padStart(2, '0')}`; }
  if (repeat === 'semimonthly') {
    const day = Number(date.slice(8, 10)); const m = monthKey(date);
    const base = day >= 15 && day <= 25 ? `${monthShift(m, 1)}-01` : day >= 26 ? `${monthShift(m, 1)}-16` : `${m}-16`;
    const dow = parse(base).getDay();
    return dow === 6 ? addDays(base, -1) : dow === 0 ? addDays(base, 1) : base;
  }
  return null;
}
/** Pending expected income (received, cancelled and skipped entries are never in d.incomes). Overdue entries are included, dated today.
 *  A repeating entry yields its stored occurrence (overdue or not) and its future ones; occurrences between the stored date and today are
 *  not invented — the database creates the next entry only when the current one is confirmed. */
export function incomeOccurrences(d: DataState, from: string, to: string, certainty: 'all' | 'guaranteed' = 'all'): IncomeOcc[] {
  const out: IncomeOcc[] = [];
  for (const inc of d.incomes) {
    if (inc.status !== 'pending') continue;
    if (certainty === 'guaranteed' && inc.certainty !== 'guaranteed') continue;
    const push = (date: string, first: boolean) => {
      const overdue = first && date < d.today;
      const eff = overdue ? d.today : date;
      if (eff >= from && eff <= to) out.push({ inc, date: eff, amount: inc.amount, overdue, original: overdue ? date : undefined });
    };
    let date = inc.date, first = true, guard = 0;
    if (inc.repeat === 'none') { push(date, true); continue; }
    while (date <= to && guard++ < 400) {
      if (first || date >= d.today) push(date, first);
      first = false;
      const n = nextIncomeDate(inc.repeat, date, inc.anchor ?? inc.date);
      if (!n) break; date = n;
    }
  }
  return out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.date.localeCompare(b.date) || a.inc.label.localeCompare(b.inc.label));
}

/** Money that is EXPECTED, never received. One calculation for Home and Bills: everything pending that arrives within `days` days of today,
 *  overdue entries included (they are simply "arriving today, awaiting confirmation"). Not part of cash or Ready to Assign. */
export interface ExpectedIncomeRow { id: string; label: string; amount: number; date: string; originalDate?: string; certainty: Income['certainty']; overdue: boolean; repeats: boolean }
export function expectedIncomeSummary(d: DataState, days = 30) {
  const rows: ExpectedIncomeRow[] = incomeOccurrences(d, d.today, addDays(d.today, days))
    .map((o) => ({ id: o.inc.id, label: o.inc.label, amount: o.amount, date: o.date, originalDate: o.original, certainty: o.inc.certainty, overdue: o.overdue, repeats: o.inc.repeat !== 'none' }));
  const guaranteed = sum(rows.filter((r) => r.certainty === 'guaranteed'), (r) => r.amount);
  const anticipated = sum(rows.filter((r) => r.certainty === 'anticipated'), (r) => r.amount);
  const overdue = rows.filter((r) => r.overdue);
  return { rows, overdue, upcoming: rows.filter((r) => !r.overdue), guaranteed, anticipated, total: guaranteed + anticipated, overdueTotal: sum(overdue, (r) => r.amount) };
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
    if (t.type !== 'expense' || t.scheduled || t.date < start || t.date >= end) continue;
    if (t.splits?.length) total += sum(t.splits.filter((s) => flexCats.has(s.categoryId)), (s) => s.amount);
    else if (t.categoryId && flexCats.has(t.categoryId)) total += t.amount;
  }
  return Math.round(total / diffDays(end, start));
}

/** Everything that will move cash after today, in one place: unpaid bills (every missed one lands tomorrow), expected income and
 *  scheduled transactions. The forecast chart and the event list both read this, so they can never disagree. */
export interface CashEvent { date: string; label: string; amount: number; kind: 'bill' | 'income-g' | 'income-a' | 'scheduled' }
export function cashEvents(d: DataState, from: string, to: string, spendIds?: Set<string>): CashEvent[] {
  const ev: CashEvent[] = [];
  for (const o of billOccurrences(d, from, to)) if (!o.paid) ev.push({ date: o.date <= d.today ? addDays(d.today, 1) : o.date, label: o.bill.name, amount: -o.bill.amount, kind: 'bill' });
  for (const o of incomeOccurrences(d, d.today < from ? d.today : from, to)) {
    const date = o.date <= d.today ? addDays(d.today, 1) : o.date; // arriving today but unconfirmed: counted from tomorrow, as an overdue bill is
    if (date < from || date > to) continue;
    ev.push({ date, label: o.inc.label, amount: o.amount, kind: o.inc.certainty === 'guaranteed' ? 'income-g' : 'income-a' });
  }
  for (const t of d.txns) {
    if (!t.scheduled || t.date < from || t.date > to || t.adjustment) continue;
    const mine = (id?: string) => !!id && (!spendIds || spendIds.has(id));
    const amount = t.type === 'income' ? (mine(t.accountId) ? t.amount : 0) : t.type === 'expense' ? (mine(t.accountId) ? -t.amount : 0) : (mine(t.toAccountId) ? t.amount : 0) - (mine(t.accountId) ? t.amount : 0);
    if (amount !== 0) ev.push({ date: t.date, label: t.payee, amount, kind: 'scheduled' });
  }
  return ev.sort((a, b) => a.date.localeCompare(b.date));
}

export function buildForecast(d: DataState, horizon: number): Forecast {
  const today = d.today;
  const end = addDays(today, horizon);
  const flexDaily = flexDailyAverage(d);
  // Actual history for the last 30 days (spending accounts); scheduled rows have not touched balances so they are not history
  const spendIds = new Set(d.accounts.filter((a) => a.type === 'checking' || a.type === 'cash').map((a) => a.id));
  const delta = (t: Txn) => {
    if (t.scheduled) return 0;
    let x = 0;
    if (spendIds.has(t.accountId)) x += t.type === 'income' ? t.amount : -t.amount;
    if (t.type === 'transfer' && t.toAccountId && spendIds.has(t.toAccountId)) x += t.amount;
    return x;
  };
  const cur = spendingTotal(d);
  const actual: FPoint[] = [];
  for (let i = -30; i <= 0; i++) {
    const date = addDays(today, i);
    const after = sum(d.txns.filter((t) => t.date > date), delta);
    actual.push({ date, balance: cur - after });
  }
  const run = (cert: 'all' | 'guaranteed'): FPoint[] => {
    const byDate = new Map<string, number>();
    const add = (dt: string, v: number) => byDate.set(dt, (byDate.get(dt) || 0) + v);
    for (const e of cashEvents(d, addDays(today, -400), end, spendIds)) {
      if (e.date <= today) continue;
      if (e.kind === 'income-a' && cert === 'guaranteed') continue;
      add(e.date, e.amount);
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
      if (monthKey(t.date) !== k || t.adjustment || t.scheduled) continue;
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
      if (monthKey(t.date) !== k || t.scheduled) continue;
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
  const a = d.allAccounts.find((x) => x.id === accountId) ?? d.accounts.find((x) => x.id === accountId)!;
  const pts: number[] = [];
  for (let i = -days; i <= 0; i++) {
    const date = addDays(d.today, i);
    let bal = a.balance;
    for (const t of d.txns) {
      if (t.date <= date || t.scheduled) continue;
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

/** How much has been paid toward the CURRENT payment of a scheduled item — only by transactions explicitly linked to it as partial payments
 *  (never by other spending that happens to share the category). Display and matching only: it never clears or advances an obligation. */
export function paidTowardCurrent(d: DataState, bill: Bill): number {
  if (!bill.date) return 0;
  return sum((d.billPartials ?? []).filter((p) => p.billId === bill.id && p.due === bill.date), (p) => p.amount);
}

/** The From/To of the most recently SAVED transfer (highest id = last one recorded, whatever its date). Never read from an unsaved form.
 *  Only usable parts are returned: an archived or missing account is dropped, and the two sides can never be the same account. */
export function lastTransferPair(d: DataState): { from?: string; to?: string } {
  let best: Txn | undefined;
  for (const t of d.txns) if (t.type === 'transfer' && !t.adjustment && t.toAccountId && (!best || Number(t.id) > Number(best.id))) best = t;
  if (!best) return {};
  const live = (id?: string) => (id && d.accounts.some((a) => a.id === id) ? id : undefined);
  const from = live(best.accountId); const to = live(best.toAccountId);
  return { from, to: to && to !== from ? to : undefined };
}

export type PayAskReason = 'partial' | 'large' | 'backlog';
export type PayMatch =
  | { kind: 'none' }
  | { kind: 'auto'; bill: Bill; due: string; paidBefore: number }
  | { kind: 'ask'; bill: Bill; due: string; reason: PayAskReason; paidBefore: number; remaining: number; missed: number };
const EARLY_DAYS: Record<BillPeriod, number> = { Weekly: 3, 'Bi-Weekly': 7, Monthly: 15, Yearly: 45 };
/** Does a transaction that was just recorded look like a payment toward a scheduled item?
 *  auto  = exactly one obligation, right category, a sensible date, and it covers what is still owed → link it.
 *  ask   = plausible but not certain (smaller than what is owed, an unusually large amount, or several missed payments) → the user decides.
 *  none  = anything else, including every transaction in a category with no active schedule → just an ordinary transaction. */
export function matchBillPayment(d: DataState, t: Pick<Txn, 'type' | 'categoryId' | 'amount' | 'date' | 'splits' | 'scheduled' | 'adjustment'>): PayMatch {
  const none: PayMatch = { kind: 'none' };
  if (t.type === 'income' || t.splits?.length || !t.categoryId || t.scheduled || t.adjustment || t.date > d.today || t.amount <= 0) return none;
  const bill = d.bills.find((b) => b.categoryId === t.categoryId);
  if (!bill || bill.paused || !bill.date || bill.paid[bill.date]) return none;
  if (t.date < addDays(bill.date, -(bill.recurring ? EARLY_DAYS[bill.period] : 30))) return none; // too early to be for this occurrence
  const lastPaidDue = Object.keys(bill.paid).sort().pop();
  if (lastPaidDue && t.date <= lastPaidDue) return none; // dated inside a cycle that is already paid
  const paidBefore = paidTowardCurrent(d, bill);
  const remaining = Math.max(0, bill.amount - paidBefore);
  const missed = groupBills(upcomingBills(d, 60)).find((g) => g.bill.id === bill.id)?.missed ?? 0;
  if (missed > 1) return { kind: 'ask', bill, due: bill.date, reason: 'backlog', paidBefore, remaining, missed };
  if (t.amount < remaining) return { kind: 'ask', bill, due: bill.date, reason: 'partial', paidBefore, remaining, missed };
  if (t.amount > bill.amount * 2) return { kind: 'ask', bill, due: bill.date, reason: 'large', paidBefore, remaining, missed };
  return { kind: 'auto', bill, due: bill.date, paidBefore };
}

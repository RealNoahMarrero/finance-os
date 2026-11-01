import { describe, it, expect } from 'vitest';
import { toDataState, type RawData } from '../src/db';
import { readyToAssign, envelope, billOccurrences, buildForecast, incomeOccurrences, netWorth, staleness, drift, monthlyFlow } from '../src/data';

const raw: RawData = {
  accounts: [
    { id: 1, name: 'Checking', type: 'Checking', balance: 1000, credit_limit: 0, entity_id: 'personal' },
    { id: 2, name: 'Card', type: 'Credit Card', balance: 200, credit_limit: 500, payment_category_id: 10, entity_id: 'personal' },
    { id: 9, name: 'Biz', type: 'Checking', balance: 5000, entity_id: 'business' },
  ],
  groups: [{ id: 1, name: 'Bills', sort_order: 0, entity_id: 'personal' }, { id: 2, name: 'Needs', sort_order: 1, entity_id: 'personal' }],
  categories: [
    { id: 10, group_id: 1, name: 'Rent', target_amount: 500, assigned_amount: 300, due_date: '2026-11-03', is_repeating: true, target_period: 'Monthly', entity_id: 'personal', is_hidden: false },
    { id: 11, group_id: 2, name: 'Groceries', target_amount: 0, assigned_amount: 100, entity_id: 'personal', is_hidden: false },
    { id: 12, group_id: 2, name: 'Old', target_amount: 0, assigned_amount: -50, entity_id: 'personal', is_hidden: true },
    { id: 13, group_id: 1, name: 'Loan', target_amount: 50, assigned_amount: 0, is_debt: true, balance: 400, due_date: '2026-10-20', is_repeating: true, target_period: 'Monthly', entity_id: 'personal', is_hidden: false },
  ],
  transactions: [
    { id: 1, date: '2026-10-05', amount: 40, payee: 'Shop', category_id: 11, account_id: 1, type: 'Expense', entity_id: 'personal' },
    { id: 2, date: '2026-10-06', amount: 100, payee: 'Pay card', category_id: null, account_id: 1, to_account_id: 2, type: 'Transfer', entity_id: 'personal' },
    { id: 3, date: '2026-10-07', amount: 500, payee: 'Work', account_id: 1, type: 'Income', entity_id: 'personal' },
    { id: 4, date: '2026-10-08', amount: 99, payee: 'Biz', account_id: 9, type: 'Expense', entity_id: 'business' },
  ],
  splits: [], baselines: [], recons: [], billPayments: [{ category_id: 13, due_date: '2026-09-20', paid_on: '2026-09-20', transaction_id: null }],
  income: [
    { id: 1, label: 'Paycheck', amount: 800, expected_date: '2026-11-06', account_id: 1, status: 'pending', certainty: 'guaranteed', is_repeating: true, repeat_period: 'Biweekly', entity_id: 'personal' },
    { id: 2, label: 'Invoice', amount: 300, expected_date: '2026-11-10', account_id: 1, status: 'pending', certainty: 'anticipated', is_repeating: false, entity_id: 'personal' },
  ],
  audit: [],
};
const d = toDataState(raw, '2026-10-31');

describe('adapter', () => {
  it('hides business records but counts them', () => {
    expect(d.accounts.map((a) => a.name)).toEqual(['Checking', 'Card']);
    expect(d.txns).toHaveLength(3);
    expect(d.hiddenBusiness).toEqual({ accounts: 1, categories: 0, transactions: 1 });
  });
  it('converts to integer cents and keeps unverified accounts unverified', () => {
    expect(d.accounts[0].balance).toBe(100000);
    expect(d.accounts.every((a) => a.lastReconciled === null && a.baseline === null)).toBe(true);
    expect(staleness(d.accounts[0], d.today).level).toBe('never');
  });
  it('links card payment envelope to its card', () => { expect(d.categories.find((c) => c.name === 'Rent')!.cardAccountId).toBe('2'); });
});
describe('budget math', () => {
  it('Ready to Assign = liquid cash minus the visible envelopes (archived ones are excluded, as in the original app)', () => {
    expect(readyToAssign(d)).toBe(100000 - (30000 + 10000 + 0));
  });
  it('envelope available is the stored balance; target remaining is derived', () => {
    const e = envelope(d, '10'); expect(e.avail).toBe(30000); expect(e.remaining).toBe(20000);
    expect(envelope(d, '11').spent).toBe(4000);
  });
  it('net worth subtracts cards and debts', () => { expect(netWorth(d)).toBe(100000 - 20000 - 40000); });
  it('monthly flow counts income/expense once (card payments are transfers)', () => {
    const m = monthlyFlow(d).find((x) => x.key === '2026-10')!; expect(m.income).toBe(50000); expect(m.expense).toBe(4000);
  });
});
describe('bills', () => {
  it('stored due date is the next unpaid occurrence; past ones show overdue', () => {
    const o = billOccurrences(d, '2026-10-17', '2026-12-31');
    const loan = o.filter((x) => x.bill.id === '13');
    expect(loan[0]).toMatchObject({ date: '2026-10-20', status: 'overdue', paid: false });
    expect(loan[1].date).toBe('2026-11-20');
  });
  it('paid occurrences come from bill_payments, never silently inferred', () => {
    const o = billOccurrences(d, '2026-09-01', '2026-09-30').filter((x) => x.bill.id === '13');
    expect(o).toHaveLength(1); expect(o[0].paid).toBe(true);
  });
});
describe('income + forecast', () => {
  it('repeating income projects beyond its one pending row', () => {
    const occ = incomeOccurrences(d, '2026-11-01', '2026-12-31', 'guaranteed'); expect(occ.map((o) => o.date).slice(0, 3)).toEqual(['2026-11-06', '2026-11-20', '2026-12-04']);
  });
  it('conservative forecast counts guaranteed only; optimistic adds anticipated', () => {
    const f = buildForecast(d, 20); const last = (k: 'conservative' | 'optimistic') => f[k][f[k].length - 1].balance;
    expect(last('optimistic') - last('conservative')).toBe(30000);
  });
  it('unverified accounts have no drift info', () => { expect(drift(d.accounts[0])).toBeNull(); });
});

import { nextDueDate, rollForward, upcomingBills } from '../src/data';
describe('bill recurrence anchor (matches the database function fos_bill_next)', () => {
  it('monthly 31st: clamps in short months and returns to the 31st', () => {
    let cur = '2026-01-31'; const seen: string[] = [];
    for (let i = 0; i < 6; i++) { cur = nextDueDate('Monthly', '2026-01-31', cur); seen.push(cur); }
    expect(seen).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31']);
  });
  it('leap years, 29th/30th anchors and December rollover', () => {
    expect(nextDueDate('Monthly', '2027-12-31', '2028-01-31')).toBe('2028-02-29');
    expect(nextDueDate('Monthly', '2026-01-30', '2026-01-30')).toBe('2026-02-28');
    expect(nextDueDate('Monthly', '2026-01-29', '2028-01-29')).toBe('2028-02-29');
    expect(nextDueDate('Monthly', '2026-01-15', '2026-12-15')).toBe('2027-01-15');
  });
  it('yearly keeps month and day (Feb 29 returns in leap years); weekly/bi-weekly unchanged', () => {
    expect(nextDueDate('Yearly', '2028-02-29', '2028-02-29')).toBe('2029-02-28');
    expect(nextDueDate('Yearly', '2028-02-29', '2031-02-28')).toBe('2032-02-29');
    expect(nextDueDate('Weekly', '2026-01-01', '2026-01-01')).toBe('2026-01-08');
    expect(nextDueDate('Bi-Weekly', '2026-01-01', '2026-01-01')).toBe('2026-01-15');
  });
  it('rollForward lands on the first unpaid date on/after today', () => {
    expect(rollForward({ recurring: true, period: 'Monthly', anchor: '2026-01-31', date: '2026-01-31', paid: {} }, '2026-08-31', '2026-10-31')).toBe('2026-10-31');
    expect(rollForward({ recurring: true, period: 'Monthly', anchor: '2026-01-31', date: '2026-01-31', paid: { '2026-10-31': 'manual' } }, '2026-08-31', '2026-10-31')).toBe('2026-11-30');
    expect(rollForward({ recurring: false, period: 'Monthly', date: '2026-01-05', paid: {} }, '2026-01-05', '2026-10-31')).toBe('2026-01-05');
  });
});
describe('paused bills', () => {
  const p = toDataState({ ...raw, categories: raw.categories.map((c) => (c.id === 10 ? { ...c, bill_paused: true } : c)) }, '2026-10-31');
  it('drop out of upcoming bills, overdue alerts and forecasts but keep paid history and funding info', () => {
    expect(upcomingBills(d, 60).some((o) => o.bill.name === 'Rent')).toBe(true);
    expect(upcomingBills(p, 60).some((o) => o.bill.name === 'Rent')).toBe(false);
    expect(billOccurrences(p, '2026-09-01', '2026-12-31').filter((o) => o.bill.name === 'Loan' && o.paid).length).toBe(1);
    expect(envelope(p, '10').remaining).toBe(0);
    expect(envelope(d, '10').remaining).toBeGreaterThan(0);
    const f = (x: typeof d) => buildForecast(x, 60).conservative.at(-1)!.balance;
    expect(f(p)).toBeGreaterThan(f(d));
  });
});

// ── Cash vs budget reconciliation (real October-31 figures; names anonymised) ──
import { cashCheck, readyToAssign, totalAvail, buckets, archivedAvail, emptyData } from '../src/data';
describe('cash vs envelopes', () => {
  const acct = (id: string, type: 'checking' | 'savings' | 'cash' | 'credit', balance: number) => ({ id, name: id, type, mask: '', institution: '', balance, lastReconciled: '2026-10-31', baseline: '2026-10-31', openingBalance: balance, derived: balance });
  const cat = (id: string, groupId: string, assigned: number, hidden: boolean) => ({ id, groupId, name: id, icon: '', target: null, priority: 2 as const, carry: 0, assigned, hidden });
  const d = {
    ...emptyData(), today: '2026-10-31',
    accounts: [acct('daily', 'checking', 6327), acct('fixed', 'checking', 2142), acct('savings', 'savings', 0), acct('cash', 'cash', 0), acct('card1', 'credit', 19854), acct('card2', 'credit', 34469)],
    groups: [{ id: '1', name: 'Bills', kind: 'bills' as const }, { id: '2', name: 'Subscriptions', kind: 'bills' as const }, { id: '3', name: 'Needs', kind: 'everyday' as const }, { id: '4', name: 'Wants', kind: 'lifestyle' as const }],
    categories: [cat('groceries', '3', 699, false), cat('gas', '3', 2000, false), cat('spending', '4', 10000, false),
      cat('arch1', '1', -15998, true), cat('arch2', '1', -14442, true), cat('arch3', '2', -1719, true), cat('arch4', '1', 60, true), cat('arch5', '1', 0, true)],
  };
  it('ready to assign ignores archived envelopes (the original app did too)', () => {
    expect(totalAvail(d)).toBe(12699);
    expect(readyToAssign(d)).toBe(8469 - 12699); // −$42.30: over-assigned, not +$278.69
    expect(archivedAvail(d)).toBe(-15998 - 14442 - 1719 + 60);
  });
  it('the four numbers tie out: cash = assigned + ready to assign', () => {
    const c = cashCheck(d);
    expect(c.cash).toBe(8469); expect(c.assigned).toBe(12699); expect(c.cash).toBe(c.assigned + c.rta);
    expect(c.overAssigned).toBe(4230); expect(buckets(d).rta).toBe(c.rta);
  });
  it('credit cards are not cash; expected income is shown but never counted', () => {
    const c = cashCheck(d);
    expect(c.cash).toBe(8469); // cards (owed) excluded
    const d2 = { ...d, incomes: [{ id: 'i', label: 'Pay', amount: 50000, date: '2026-11-05', certainty: 'guaranteed' as const, repeat: 'none' as const, accountId: 'daily', status: 'pending' as const, who: 'x' }] };
    expect(cashCheck(d2).expected30).toBe(50000); expect(cashCheck(d2).rta).toBe(c.rta);
  });
});

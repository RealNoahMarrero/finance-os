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
  it('Ready to Assign = liquid cash minus ALL envelopes (archived ones included)', () => {
    expect(readyToAssign(d)).toBe(100000 - (30000 + 10000 - 5000 + 0));
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

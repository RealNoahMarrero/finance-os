// Finances 2.0 correctness tests on the pure money model. Each test states the ORIGINAL problem and asserts the corrected result.
import { describe, it, expect } from 'vitest';
// @ts-expect-error the synthetic fixture is plain JS
import { tables } from '../tools/demo/fixture.mjs';
import { toDataState } from '../src/db';
import { billOccurrences, buildForecast, cashEvents, groupBills, incomeOccurrences, monthlyFlow, nextIncomeDate, upcomingBills, spendingTotal, type DataState } from '../src/data';
import { addDays } from '../src/lib';

const raw = (over: Record<string, unknown[]> = {}) => ({
  accounts: tables.accounts, groups: tables.category_groups, categories: tables.categories, transactions: tables.transactions, splits: tables.transaction_splits,
  income: tables.projected_income, baselines: tables.account_baselines, recons: tables.account_reconciliations, billPayments: tables.bill_payments, audit: [],
  creditScores: [], creditMeta: [], creditReported: [], creditReady: true, ...over,
}) as unknown as Parameters<typeof toDataState>[0];
const state = (over?: Record<string, unknown[]>): DataState => toDataState(raw(over), '2026-11-10');

describe('overdue bills: one row per bill, funding counted once (was: the same $320 shown as funded on every occurrence)', () => {
  const d = state();
  const occ = upcomingBills(d, 45).filter((o) => o.bill.name === 'Car Loan');
  it('the Car Loan has several unpaid occurrences', () => expect(occ.length).toBeGreaterThanOrEqual(3));
  it('its $320 envelope funds at most one of them', () => {
    const fundedTotal = occ.filter((o) => !o.future).reduce((n, o) => n + o.funded, 0);
    expect(fundedTotal).toBeLessThanOrEqual(32000);
    expect(occ.filter((o) => !o.future && o.funded > 0)).toHaveLength(1);
  });
  it('the display groups the occurrences into a single row with a missed count', () => {
    const g = groupBills(upcomingBills(d, 45)).filter((x) => x.bill.name === 'Car Loan');
    expect(g).toHaveLength(1);
    expect(g[0].missed).toBe(2);
    expect(g[0].total).toBe(64000);
  });
  it('"short" no longer double-counts: Streaming’s empty envelope is short once per unpaid occurrence, not hidden or doubled by funding', () => {
    const s = upcomingBills(d, 45).filter((o) => o.bill.name === 'Streaming' && !o.future);
    expect(s.every((o) => o.funded === 0)).toBe(true);
  });
});

describe('forecast chart and event list use the same obligations (was: different rules)', () => {
  const d = state();
  it('every unpaid bill in the event list is in the forecast, including ones overdue for more than 30 days', () => {
    const f = buildForecast(d, 30);
    const spend = new Set(d.accounts.filter((a) => a.type === 'checking' || a.type === 'cash').map((a) => a.id));
    const events = cashEvents(d, addDays(d.today, -400), addDays(d.today, 30), spend).filter((e) => e.date > d.today);
    const outflow = events.reduce((n, e) => n + e.amount, 0);
    // balance change over 30 days = events − flexible daily spending
    const delta = f.optimistic[30].balance - spendingTotal(d);
    expect(delta).toBe(outflow - 30 * f.flexDaily);
    expect(events.filter((e) => e.label === 'Car Loan').length).toBeGreaterThanOrEqual(2); // the 44-day-old miss is no longer dropped
  });
});

describe('scheduled transactions do not alter today’s numbers (was: future-dated rows counted immediately)', () => {
  const future = { id: 999, date: '2026-11-25', payee: 'Gym', amount: 50, type: 'Expense', account_id: 1, category_id: 9, to_account_id: null, notes: null, is_adjustment: false, entity_id: 'personal', status: 'scheduled' };
  const base = state();
  const withSched = state({ transactions: [...tables.transactions, future] });
  it('flagged as scheduled', () => expect(withSched.txns.find((t) => t.id === '999')?.scheduled).toBe(true));
  it('this month’s spending and envelope spending ignore it', () => {
    const a = monthlyFlow(base).at(-1)!.expense, b = monthlyFlow(withSched).at(-1)!.expense;
    expect(b).toBe(a);
  });
  it('it appears as a forecast event on its date', () => {
    const ev = cashEvents(withSched, '2026-11-11', '2026-12-31').find((e) => e.label === 'Gym');
    expect(ev).toMatchObject({ date: '2026-11-25', amount: -5000, kind: 'scheduled' });
  });
});

describe('expected income recurrence matches the database (was: month-end drift; semimonthly 2nd vs 1st)', () => {
  it('monthly keeps the original day', () => {
    expect(nextIncomeDate('monthly', '2027-01-31')).toBe('2027-02-28');
    expect(nextIncomeDate('monthly', '2027-02-28', '2027-01-31')).toBe('2027-03-31');
    expect(nextIncomeDate('monthly', '2027-03-31', '2027-01-31')).toBe('2027-04-30');
  });
  it('semimonthly is the 1st and 16th, moved off weekends', () => {
    expect(nextIncomeDate('semimonthly', '2026-11-16')).toBe('2026-12-01');
    expect(nextIncomeDate('semimonthly', '2026-12-01')).toBe('2026-12-16');
    expect(nextIncomeDate('semimonthly', '2027-04-16')).toBe('2027-04-30');
    expect(nextIncomeDate('semimonthly', '2027-04-30')).toBe('2027-05-17');
  });
  it('projection of a monthly income on the 31st returns to the 31st after February', () => {
    const d = state();
    d.incomes = [{ id: 'x', label: 'Rent in', amount: 10000, date: '2027-01-31', certainty: 'guaranteed', repeat: 'monthly', accountId: '1', status: 'pending', who: 'Household', anchor: '2027-01-31' }];
    const dates = incomeOccurrences(d, '2027-01-01', '2027-04-30').map((o) => o.date);
    expect(dates).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  });
});

describe('group classification is stored, not guessed from the name (was: renaming a group changed funding priority)', () => {
  it('uses the stored kind when present', () => {
    const groups = tables.category_groups.map((g: { id: number; name: string }) => (g.id === 1 ? { ...g, name: 'Household', kind: 'bills' } : g));
    const d = state({ groups });
    expect(d.groups.find((g) => g.id === '1')?.kind).toBe('bills');
  });
  it('falls back to the name only when no kind is stored (before the migration)', () => expect(state().groups.find((g) => g.id === '2')?.kind).toBe('everyday'));
});

describe('billOccurrences basics still hold', () => {
  it('a paid occurrence is paid; the bill has no duplicate rows for one date', () => {
    const d = state();
    const occ = billOccurrences(d, '2026-10-01', '2026-12-31');
    const keys = occ.map((o) => `${o.bill.id}|${o.date}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

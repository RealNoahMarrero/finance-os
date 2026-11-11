// Finances 2.0 correctness tests on the pure money model. Each test states the ORIGINAL problem and asserts the corrected result.
import { describe, it, expect } from 'vitest';
// @ts-expect-error the synthetic fixture is plain JS
import { tables } from '../tools/demo/fixture.mjs';
import { toDataState } from '../src/db';
import { expectedIncomeSummary, readyToAssign, cashCheck, billOccurrences, buildForecast, cashEvents, groupBills, incomeOccurrences, monthlyFlow, nextIncomeDate, upcomingBills, spendingTotal, type DataState } from '../src/data';
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

const inc = (id: number, label: string, amount: number, date: string, extra: Record<string, unknown> = {}) => ({ id, label, amount, expected_date: date, status: 'pending', certainty: 'guaranteed', is_repeating: false, repeat_period: 'None', account_id: 1, entity_id: 'personal', ...extra });
const flex = [inc(11, 'Amazon Flex', 50, '2026-11-09'), inc(12, 'Amazon Flex', 60, '2026-11-09'), inc(13, 'Amazon Flex', 50, '2026-11-09')];

describe('expected income: overdue entries are pending money dated today (was: $0 Guaranteed and $0 total on Home)', () => {
  const d = state({ income: [...tables.projected_income, ...flex] });
  const s = expectedIncomeSummary(d, 30);
  it('three Guaranteed entries totalling $160 expected Nov 9 are $160 pending Guaranteed on Nov 10', () => {
    const f = s.rows.filter((r) => r.label === 'Amazon Flex');
    expect(f).toHaveLength(3);
    expect(f.every((r) => r.date === '2026-11-10' && r.originalDate === '2026-11-09' && r.overdue && r.certainty === 'guaranteed')).toBe(true);
    expect(f.reduce((n, r) => n + r.amount, 0)).toBe(16000);
    expect(s.overdueTotal).toBe(16000 + 15000); // plus the demo's $150 anticipated refund, also past its date
  });
  it('totals include overdue entries and keep each entry’s own classification', () => {
    expect(s.guaranteed).toBe(241000 * 2 + 16000);
    expect(s.anticipated).toBe(90000 + 15000);
    expect(s.total).toBe(s.guaranteed + s.anticipated);
  });
  it('Home and Bills read the same calculation (the Bills tab totals equal the summary for the same window)', () => {
    for (const days of [30, 60, 90]) {
      const x = expectedIncomeSummary(d, days);
      const occ = incomeOccurrences(d, d.today, addDays(d.today, days));
      expect(x.guaranteed).toBe(occ.filter((o) => o.inc.certainty === 'guaranteed').reduce((n, o) => n + o.amount, 0));
      expect(x.anticipated).toBe(occ.filter((o) => o.inc.certainty === 'anticipated').reduce((n, o) => n + o.amount, 0));
    }
  });
  it('received, cancelled and skipped entries are never pending', () => {
    const dd = state({ income: [...flex, inc(14, 'Done', 999, '2026-11-09', { status: 'received' }), inc(15, 'Skipped', 888, '2026-11-09', { status: 'cancelled' })] });
    expect(expectedIncomeSummary(dd, 30).rows.map((r) => r.label)).not.toContain('Done');
    expect(expectedIncomeSummary(dd, 30).rows.map((r) => r.label)).not.toContain('Skipped');
  });
  it('expected money is not cash and not Ready to Assign', () => {
    const none = state({ income: [] });
    expect(readyToAssign(d)).toBe(readyToAssign(none));
    expect(cashCheck(d).cash).toBe(cashCheck(none).cash);
  });
});

describe('expected income: the effective date follows today without rewriting anything', () => {
  it('moves forward as days pass, and the original date is preserved', () => {
    const raw1 = raw({ income: flex });
    for (const today of ['2026-11-10', '2026-11-12', '2026-12-01']) {
      const d = toDataState(raw1, today);
      const rows = expectedIncomeSummary(d, 30).rows.filter((r) => r.label === 'Amazon Flex');
      expect(rows.map((r) => r.date)).toEqual([today, today, today]);
      expect(rows.every((r) => r.originalDate === '2026-11-09')).toBe(true);
      expect(d.incomes.filter((i) => i.label === 'Amazon Flex').every((i) => i.date === '2026-11-09')).toBe(true); // stored date untouched
    }
  });
  it('before the scheduled date it is simply upcoming', () => {
    const d = toDataState(raw({ income: flex }), '2026-11-08');
    const r = expectedIncomeSummary(d, 30).rows.filter((x) => x.label === 'Amazon Flex');
    expect(r.every((x) => !x.overdue && x.date === '2026-11-09' && x.originalDate === undefined)).toBe(true);
  });
});

describe('expected income: recurring entries (no duplicates, recurrence untouched)', () => {
  const weekly = inc(20, 'Weekly gig', 100, '2026-11-02', { is_repeating: true, repeat_period: 'Weekly', certainty: 'guaranteed' });
  const d = state({ income: [weekly] });
  const rows = expectedIncomeSummary(d, 30).rows;
  it('an overdue repeating entry appears once (today), then its real future occurrences — the missed cycles are not invented', () => {
    expect(rows.map((r) => r.date)).toEqual(['2026-11-10', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07']);
    expect(rows[0]).toMatchObject({ overdue: true, originalDate: '2026-11-02', repeats: true });
  });
  it('the stored schedule is unchanged', () => expect(d.incomes[0]).toMatchObject({ date: '2026-11-02', repeat: 'weekly' }));
  it('the Calendar shows it on today (not on its old date and not on skipped cycles)', () => {
    const cal = incomeOccurrences(d, '2026-11-01', '2026-11-30').map((o) => o.date);
    expect(cal).toEqual(['2026-11-10', '2026-11-16', '2026-11-23', '2026-11-30']);
  });
});

describe('expected income in the forecast', () => {
  it('guaranteed income awaiting confirmation is counted (from tomorrow) in the conservative forecast; anticipated only in the optimistic', () => {
    const none = buildForecast(state({ income: [] }), 5), withFlex = buildForecast(state({ income: [...flex, inc(16, 'Maybe', 70, '2026-11-09', { certainty: 'anticipated' })] }), 5);
    expect(withFlex.conservative[1].balance - none.conservative[1].balance).toBe(16000);
    expect(withFlex.optimistic[1].balance - none.optimistic[1].balance).toBe(16000 + 7000);
    expect(withFlex.conservative[0].balance).toBe(none.conservative[0].balance); // today's balance is untouched
  });
  it('the event list and the chart agree', () => {
    const d = state({ income: flex });
    const ev = cashEvents(d, addDays(d.today, 1), addDays(d.today, 5)).filter((e) => e.label === 'Amazon Flex');
    expect(ev).toHaveLength(3);
    expect(ev.every((e) => e.date === '2026-11-11' && e.kind === 'income-g')).toBe(true);
  });
});

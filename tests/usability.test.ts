// Pure-logic tests for the transaction/plan usability work: signed money parsing, transfer-pair memory, and bill-payment recognition.
import { describe, it, expect } from 'vitest';
// @ts-expect-error the synthetic fixture is plain JS
import { tables } from '../tools/demo/fixture.mjs';
import { toDataState } from '../src/db';
import { lastTransferPair, matchBillPayment, paidTowardCurrent, type DataState, type Txn } from '../src/data';
import { parseSignedCents, signedInput } from '../src/lib';
import { rankMatch } from '../src/pickers';

const raw = (over: Record<string, unknown[]> = {}) => ({
  accounts: tables.accounts, groups: tables.category_groups, categories: tables.categories, transactions: tables.transactions, splits: tables.transaction_splits,
  income: tables.projected_income, baselines: tables.account_baselines, recons: tables.account_reconciliations, billPayments: tables.bill_payments, audit: [],
  creditScores: [], creditMeta: [], creditReported: [], creditReady: true, ...over,
}) as unknown as Parameters<typeof toDataState>[0];
const state = (over?: Record<string, unknown[]>): DataState => toDataState(raw(over), '2026-11-10');
const cat = (d: DataState, name: string) => d.categories.find((c) => c.name === name)!.id;
const tx = (d: DataState, name: string, amount: number, date = '2026-11-10', extra: Partial<Txn> = {}) => ({ type: 'expense' as const, categoryId: cat(d, name), amount, date, ...extra });

describe('signed money entry', () => {
  it.each([
    ['-128.38', -12838], ['−128.38', -12838], ['$-128.38', -12838], ['-$128.38', -12838], ['(128.38)', -12838],
    ['128.38', 12838], ['1,250.5', 125050], ['-5,000.50', -500050], ['0', 0], ['-0', 0], ['.5', 50], ['  42 ', 4200],
  ])('%s → %i cents', (s, c) => expect(parseSignedCents(s)).toBe(c));
  it.each(['', '-', '.', 'abc', '1.2.3', '--5', '12-3'])('%j is not an amount', (s) => expect(parseSignedCents(s)).toBeNull());
  it('exact to the cent for awkward floats', () => { expect(parseSignedCents('-128.38')).toBe(-12838); expect(parseSignedCents('0.29')).toBe(29); expect(parseSignedCents('1.005')).toBe(101); });
  it('typing keeps a leading minus only, and turns (x) into -x', () => {
    expect(signedInput('-12a.3-4')).toBe('-12.34'); expect(signedInput('12-')).toBe('12'); expect(signedInput('(128.38)')).toBe('-128.38'); expect(signedInput('$-5')).toBe('-5'); expect(signedInput('1.2.3')).toBe('1.23');
  });
});

describe('searchable picker ranking', () => {
  it('prefix beats word-start beats contains; no match is rejected', () => {
    expect(rankMatch('Vacation Fund', 'vac')).toBe(0); expect(rankMatch('Summer Vacation', 'vac')).toBe(1); expect(rankMatch('Renovation', 'vat')).toBe(2); expect(rankMatch('Rent', 'zz')).toBe(-1); expect(rankMatch('Rent', '')).toBe(3);
  });
});

describe('transfer memory: the last SAVED pair', () => {
  const t = (id: string, from: string, to: string): unknown => ({ id: Number(id), date: '2026-11-09', amount: 10, payee: 'x', category_id: null, account_id: Number(from), to_account_id: Number(to), type: 'Transfer', entity_id: 'personal', status: 'posted' });
  const base = tables.transactions as unknown[];
  it('uses the most recently recorded transfer, not the latest date', () => {
    const d = state({ transactions: [...base, { ...(t('9001', '2', '1') as object), date: '2026-01-01' }, { ...(t('9000', '1', '3') as object), date: '2026-11-09' }] });
    expect(lastTransferPair(d)).toEqual({ from: '2', to: '1' });
  });
  it('drops an archived or unknown account, and never returns the same account twice', () => {
    const arch = (tables.accounts as { id: number }[]).map((a) => (a.id === 2 ? { ...a, is_archived: true } : a));
    const d = state({ accounts: arch, transactions: [...base, t('9100', '1', '2')] });
    expect(lastTransferPair(d)).toEqual({ from: '1', to: undefined }); // the archived destination is dropped
    // a transfer FROM an archived account is not even loaded (like every transaction of an archived account), so the previous valid pair is used
    const fromArch = state({ accounts: arch, transactions: [...base, t('9102', '2', '1')] });
    expect(fromArch.txns.some((x) => x.id === '9102')).toBe(false);
    const same = state({ transactions: [...base, t('9101', '1', '1')] });
    expect(lastTransferPair(same).to).toBeUndefined();
  });
  it('returns nothing when no transfer exists', () => expect(lastTransferPair(state({ transactions: (base as { type: string }[]).filter((x) => x.type !== 'Transfer') }))).toEqual({}));
});

describe('payment recognition (auto / ask / none)', () => {
  const d = state();
  it('a full payment in the item category near its due date is recognised automatically', () => {
    expect(matchBillPayment(d, tx(d, 'Phone', 8500)).kind).toBe('auto');
    expect(matchBillPayment(d, tx(d, 'Phone', 9000)).kind).toBe('auto'); // a bit more is still the payment
  });
  it('a smaller amount is a question, never a silent partial', () => {
    const m = matchBillPayment(d, tx(d, 'Electric', 5000)); expect(m.kind).toBe('ask'); if (m.kind === 'ask') { expect(m.reason).toBe('partial'); expect(m.remaining).toBe(11840); }
  });
  it('an unusually large amount is a question', () => { const m = matchBillPayment(d, tx(d, 'Phone', 30000)); expect(m.kind === 'ask' && m.reason).toBe('large'); });
  it('several missed payments is a question (the oldest is paid first)', () => { const m = matchBillPayment(d, tx(d, 'Car Loan', 32000)); expect(m.kind === 'ask' && m.reason).toBe('backlog'); });
  it('anything else is just a transaction', () => {
    expect(matchBillPayment(d, tx(d, 'Groceries', 4000)).kind).toBe('none'); // no schedule
    expect(matchBillPayment(d, tx(d, 'Rent', 150000)).kind).toBe('none'); // next rent is weeks away
    expect(matchBillPayment(d, tx(d, 'Electric', 11840, '2026-09-01')).kind).toBe('none'); // backdated before this cycle
    expect(matchBillPayment(d, tx(d, 'Phone', 8500, '2026-11-20')).kind).toBe('none'); // future-dated
    expect(matchBillPayment(d, { ...tx(d, 'Phone', 8500), type: 'income' }).kind).toBe('none');
    expect(matchBillPayment(d, { ...tx(d, 'Phone', 8500), splits: [{ categoryId: cat(d, 'Phone'), amount: 8500 }] }).kind).toBe('none');
    expect(matchBillPayment(d, { ...tx(d, 'Phone', 8500), scheduled: true }).kind).toBe('none');
    expect(matchBillPayment(d, { ...tx(d, 'Phone', 8500), categoryId: undefined }).kind).toBe('none');
  });
  it('a paused schedule is never matched', () => {
    const cats = (tables.categories as { name: string }[]).map((c) => (c.name === 'Phone' ? { ...c, bill_paused: true } : c));
    const p = state({ categories: cats }); expect(matchBillPayment(p, tx(p, 'Phone', 8500)).kind).toBe('none');
  });
  it('paid-so-far counts only explicitly linked partials, never other spending in the category', () => {
    const e = d.bills.find((b) => b.name === 'Electric')!;
    expect(paidTowardCurrent(d, e)).toBe(0); // the fixture has ordinary spending but nothing is linked
    const linked = { ...d, billPartials: [{ txnId: '1', billId: e.id, due: e.date!, amount: 5000 }, { txnId: '2', billId: e.id, due: '2026-10-14', amount: 9999 }] };
    expect(paidTowardCurrent(linked, e)).toBe(5000); // only this occurrence
    expect(matchBillPayment(linked, tx(d, 'Electric', 6840)).kind).toBe('auto'); // it completes what remains
    expect(matchBillPayment(linked, tx(d, 'Electric', 6000)).kind).toBe('ask');
  });
});

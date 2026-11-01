import { describe, expect, it } from 'vitest';
import { emptyData, type Account, type DataState } from '../src/data';
import { cardDates, cardRows, defaultMeta, latestReported, reportedUtil, scoreRows, scoreSeries, totals, totalsCaveats, utilPct, whatIf, type CreditScore, type CreditState } from '../src/credit';

const acct = (id: string, name: string, balance: number, limit: number | undefined, verified = true, extra: Partial<Account> = {}): Account => ({
  id, name, type: 'credit', mask: '', institution: '', balance, limit, lastReconciled: verified ? '2026-10-20' : null, baseline: null, openingBalance: null, derived: null, ...extra,
});
const mk = (accounts: Account[], credit: Partial<CreditState> = {}): DataState => ({ ...emptyData(), today: '2026-10-31', accounts, credit: { scores: [], meta: {}, reported: [], ready: true, ...credit } });
const sc = (id: string, bureau: CreditScore['bureau'], score: number, model: string, observedOn: string): CreditScore => ({ id, bureau, score, model, observedOn });

describe('utilization math', () => {
  it('rounds to one decimal, handles no limit and credit balances', () => {
    expect(utilPct(19854, 20000)).toBe(99.3);
    expect(utilPct(34469, 30000)).toBe(114.9);
    expect(utilPct(100, 0)).toBeNull();
    expect(utilPct(-5000, 20000)).toBe(0);
    expect(utilPct(1, 100000)).toBe(0);
  });
  it('per-card + overall exclude inactive and limitless cards, and never go negative', () => {
    const d = mk([acct('1', 'A', 5000, 10000), acct('2', 'B', -2000, 10000), acct('3', 'C', 9000, undefined), acct('4', 'D', 7000, 7000)], { meta: { '4': { ...defaultMeta('4'), active: false } } });
    const rows = cardRows(d, d.credit);
    const t = totals(rows);
    expect(rows.find((r) => r.account.id === '2')!.pct).toBe(0);
    expect(rows.find((r) => r.account.id === '2')!.creditBalance).toBe(2000);
    expect(t.eligibleOwed).toBe(5000); expect(t.eligibleLimit).toBe(20000); expect(t.pct).toBe(25);
    expect(t.owed).toBe(5000 + 9000); // active cards incl. the limitless one; the inactive card is excluded
    expect(t.limits).toBe(20000);
    expect(t.available).toBe(5000 + 10000);
    expect(t.excluded.map((r) => r.account.id)).toEqual(['3']);
    expect(totalsCaveats(t).join(' ')).toMatch(/no credit limit/);
  });
  it('over-limit card: utilization above 100, available credit clamps to zero', () => {
    const d = mk([acct('1', 'Over', 34469, 30000, false)]);
    const [r] = cardRows(d, d.credit); const t = totals([r]);
    expect(r.pct).toBe(114.9); expect(r.available).toBe(0); expect(r.overBy).toBe(4469); expect(r.verified).toBe(false);
    expect(t.pct).toBe(114.9); expect(t.available).toBe(0);
    expect(totalsCaveats(t).join(' ')).toMatch(/reconciled/); expect(totalsCaveats(t).join(' ')).toMatch(/over the limit/);
  });
  it('no eligible cards → no utilization, with an explanation', () => {
    const d = mk([acct('1', 'X', 1000, undefined)]);
    const t = totals(cardRows(d, d.credit));
    expect(t.pct).toBeNull(); expect(totalsCaveats(t).join(' ')).toMatch(/can’t be calculated/);
  });
});

describe('reported vs current', () => {
  const d = mk([acct('1', 'A', 8000, 10000), acct('2', 'B', 3000, 10000)]);
  it('estimate when nothing is reported', () => {
    const u = reportedUtil(cardRows(d, d.credit), []);
    expect(u.mode).toBe('estimate'); expect(u.pct).toBe(55);
  });
  it('mixed when only some cards have a reported balance, reported when all do', () => {
    const rows = cardRows(d, d.credit);
    const one = [{ id: '1', accountId: '1', balance: 2000, reportedOn: '2026-10-05' }];
    const m = reportedUtil(rows, one);
    expect(m.mode).toBe('mixed'); expect(m.pct).toBe(25); expect(m.usedCurrent.map((r) => r.account.id)).toEqual(['2']); expect(m.asOf).toBe('2026-10-05');
    const all = [...one, { id: '2', accountId: '2', balance: 1000, reportedOn: '2026-10-09' }];
    const r = reportedUtil(rows, all);
    expect(r.mode).toBe('reported'); expect(r.pct).toBe(15); expect(r.asOf).toBe('2026-10-05');
  });
  it('latest reported picks the newest date, optionally per bureau', () => {
    const list = [
      { id: '1', accountId: '1', balance: 1, reportedOn: '2026-09-01', bureau: 'Experian' as const },
      { id: '2', accountId: '1', balance: 2, reportedOn: '2026-10-01', bureau: 'Equifax' as const },
    ];
    expect(latestReported(list, '1')!.balance).toBe(2);
    expect(latestReported(list, '1', 'Experian')!.balance).toBe(1);
  });
});

describe('what-if', () => {
  const d = mk([acct('1', 'A', 8000, 10000), acct('2', 'B', 3000, 10000), acct('3', 'Nolim', 5000, undefined)]);
  const rows = cardRows(d, d.credit);
  it('applies multi-card payments, caps at balance and reports the change', () => {
    const w = whatIf(rows, { '1': 5000, '2': 99999 });
    expect(w.pctBefore).toBe(55); expect(w.owedAfter).toBe(3000); expect(w.pctAfter).toBe(15); expect(w.pointsChange).toBe(-40);
    expect(w.totalPay).toBe(5000 + 3000); expect(w.cards.find((c) => c.row.account.id === '2')!.capped).toBe(true);
    expect(w.availableAfter).toBe(17000);
    expect(w.cards.some((c) => c.row.account.id === '3')).toBe(false); // limitless card isn't part of the calculation
  });
  it('no payments = no change; negative input ignored; it never mutates the data', () => {
    const before = JSON.stringify(d);
    const w = whatIf(rows, { '1': -500 });
    expect(w.pctAfter).toBe(w.pctBefore); expect(w.totalPay).toBe(0); expect(w.pointsChange).toBe(0);
    expect(JSON.stringify(d)).toBe(before);
  });
  it('reported baseline is used when requested', () => {
    const w = whatIf(rows, { '1': 1000 }, [{ id: '1', accountId: '1', balance: 6000, reportedOn: '2026-10-01' }], true);
    expect(w.usesReported).toBe(true); expect(w.cards[0].baseline).toBe(6000); expect(w.cards[0].after).toBe(5000);
  });
});

describe('score series', () => {
  const s = [
    sc('1', 'Experian', 700, 'FICO 8', '2026-08-01'), sc('2', 'Experian', 715, 'FICO 8', '2026-09-01'),
    sc('3', 'Experian', 690, 'VantageScore 3.0', '2026-09-15'), sc('4', 'Equifax', 705, 'FICO 8', '2026-09-20'),
    sc('5', 'Experian', 712, 'fico 8 ', '2026-10-01'),
  ];
  it('changes compare only the same bureau and model (case/space-insensitive)', () => {
    const rows = scoreRows(s);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by('1').change).toBeNull(); expect(by('2').change).toBe(15);
    expect(by('3').change).toBeNull(); // first Vantage entry: not compared with FICO
    expect(by('4').change).toBeNull(); // first Equifax entry
    expect(by('5').change).toBe(-3);   // vs 715, same series despite spacing/case
    expect(rows[0].id).toBe('5'); // newest first
  });
  it('series group by bureau + model and are ordered by date', () => {
    const ser = scoreSeries(s);
    expect(ser.map((x) => `${x.bureau}|${x.model}|${x.points.length}`)).toEqual(['Experian|FICO 8|3', 'Experian|VantageScore 3.0|1', 'Equifax|FICO 8|1']);
  });
});

describe('statement & payment dates', () => {
  it('rolls a repeating closing date forward, keeping month-end anchors', () => {
    const d = mk([acct('1', 'A', 0, 100)], { meta: { '1': { ...defaultMeta('1'), closingDate: '2026-01-31' } } });
    const [r] = cardRows(d, d.credit);
    expect(cardDates(d, d.credit, r).closing).toBe('2026-10-31');
  });
  it('a one-off past date is flagged, not rolled', () => {
    const d = mk([acct('1', 'A', 0, 100)], { meta: { '1': { ...defaultMeta('1'), closingDate: '2026-10-01', repeats: false } } });
    const c = cardDates(d, d.credit, cardRows(d, d.credit)[0]);
    expect(c.closing).toBe('2026-10-01'); expect(c.closingNote).toMatch(/passed/);
  });
  it('payment due comes from the linked bill, else the account', () => {
    const d = mk([acct('1', 'A', 0, 100, true, { paymentCategoryId: '9', nextPaymentDue: '2026-12-01' }), acct('2', 'B', 0, 100, true, { nextPaymentDue: '2026-12-02' })]);
    d.bills = [{ id: '9', name: 'A pay', payee: 'A', amount: 5000, dueDay: 13, recurring: true, date: '2026-11-13', period: 'Monthly', mode: 'reminder', accountId: '', paid: {}, paused: false }];
    const rows = cardRows(d, d.credit);
    expect(cardDates(d, d.credit, rows[0]).due).toBe('2026-11-13'); expect(cardDates(d, d.credit, rows[0]).dueSource).toBe('bill');
    expect(cardDates(d, d.credit, rows[1]).due).toBe('2026-12-02'); expect(cardDates(d, d.credit, rows[1]).dueSource).toBe('account');
  });
});

// Credit tracker math. Pure functions only: no network, no side effects, integer cents throughout.
// Rules that hold everywhere in this file:
//  - Credit-card balances use the app's convention: money OWED is positive. A negative balance is a credit balance (the issuer owes you).
//  - Utilization is never negative and is never computed from a zero/missing limit.
//  - Scores are never derived, estimated or compared across bureaus or scoring models.
import type { Account, DataState } from './data';
import { isVerified, nextDueDate } from './data';
import { diffDays } from './lib';

export const BUREAUS = ['Experian', 'Equifax', 'TransUnion'] as const;
export type Bureau = (typeof BUREAUS)[number];
export const MODEL_PRESETS = ['FICO 8', 'FICO 9', 'FICO 10', 'FICO Bankcard 8', 'VantageScore 3.0', 'VantageScore 4.0', 'Unknown'] as const;
export const SCORE_MIN = 250, SCORE_MAX = 900;

export interface CreditScore { id: string; bureau: Bureau; score: number; model: string; observedOn: string; source?: string; notes?: string }
export interface CardMeta { accountId: string; active: boolean; closingDate?: string; repeats: boolean; notes?: string }
export interface ReportedBalance { id: string; accountId: string; balance: number; reportedOn: string; bureau?: Bureau; notes?: string }
export interface CreditState { scores: CreditScore[]; meta: Record<string, CardMeta>; reported: ReportedBalance[]; ready: boolean }
export const emptyCredit = (): CreditState => ({ scores: [], meta: {}, reported: [], ready: false });

// ── scores ─────────────────────────────────────────────────
/** "FICO 8" and "fico 8 " are the same model; FICO and VantageScore are never the same. */
export const modelKey = (m: string) => m.trim().replace(/\s+/g, ' ').toLowerCase();
export const modelLabel = (m: string) => m.trim().replace(/\s+/g, ' ') || 'Unknown';
export const seriesKey = (s: Pick<CreditScore, 'bureau' | 'model'>) => `${s.bureau}|${modelKey(s.model)}`;
const byDateAsc = (a: CreditScore, b: CreditScore) => (a.observedOn < b.observedOn ? -1 : a.observedOn > b.observedOn ? 1 : Number(a.id) - Number(b.id));

export interface ScoreRow extends CreditScore { prev?: CreditScore; change: number | null }
/** Every score with its change versus the previous entry of the SAME bureau and SAME model (null when there is none). Newest first. */
export function scoreRows(scores: CreditScore[]): ScoreRow[] {
  const last = new Map<string, CreditScore>();
  const out: ScoreRow[] = [];
  for (const s of [...scores].sort(byDateAsc)) {
    const k = seriesKey(s); const prev = last.get(k);
    out.push({ ...s, prev, change: prev ? s.score - prev.score : null });
    last.set(k, s);
  }
  return out.reverse();
}
export interface Series { key: string; bureau: Bureau; model: string; points: CreditScore[] }
export function scoreSeries(scores: CreditScore[]): Series[] {
  const m = new Map<string, Series>();
  for (const s of [...scores].sort(byDateAsc)) {
    const k = seriesKey(s);
    if (!m.has(k)) m.set(k, { key: k, bureau: s.bureau, model: modelLabel(s.model), points: [] });
    m.get(k)!.points.push(s);
  }
  return [...m.values()].sort((a, b) => BUREAUS.indexOf(a.bureau) - BUREAUS.indexOf(b.bureau) || a.model.localeCompare(b.model));
}
export const latestScore = (rows: ScoreRow[]) => rows[0] ?? null; // rows are newest first
export const latestByBureau = (rows: ScoreRow[]) => BUREAUS.map((b) => ({ bureau: b, row: rows.find((r) => r.bureau === b) ?? null }));
export const models = (scores: CreditScore[]) => [...new Map(scores.map((s) => [modelKey(s.model), modelLabel(s.model)])).values()].sort();

// ── utilization ────────────────────────────────────────────
/** Percent with one decimal. Returns null when there is no usable limit. A credit balance (negative) counts as 0%. */
export function utilPct(owed: number, limit: number): number | null {
  if (!(limit > 0)) return null;
  return Math.round((Math.max(0, owed) * 1000) / limit) / 10;
}
export type UtilLevel = 'none' | 'low' | 'mid' | 'high' | 'over';
/** Colour escalation is deliberately gentle: neutral until 30%, caution to 50%, strong only past 50%/over limit. These are display cues, not score claims. */
export const utilLevel = (pct: number | null): UtilLevel => (pct == null ? 'none' : pct > 100 ? 'over' : pct > 50 ? 'high' : pct > 30 ? 'mid' : 'low');

export interface CardRow {
  account: Account; meta: CardMeta; active: boolean;
  balance: number;       // as stored (owed positive; negative = credit balance)
  owed: number;          // max(0, balance)
  limit: number;         // 0 = missing
  hasLimit: boolean; eligible: boolean;
  pct: number | null; level: UtilLevel;
  available: number;     // never negative
  overBy: number; creditBalance: number;
  verified: boolean; reported?: ReportedBalance;
  notes: string[];
}
export const defaultMeta = (accountId: string): CardMeta => ({ accountId, active: true, repeats: true });

export function cardRows(d: DataState, credit: CreditState): CardRow[] {
  return d.accounts.filter((a) => a.type === 'credit').map((account) => {
    const meta = credit.meta[account.id] ?? defaultMeta(account.id);
    const limit = account.limit && account.limit > 0 ? account.limit : 0;
    const owed = Math.max(0, account.balance);
    const hasLimit = limit > 0, eligible = meta.active && hasLimit;
    const pct = eligible ? utilPct(owed, limit) : null;
    const notes: string[] = [];
    if (!meta.active) notes.push('Marked inactive — left out of totals');
    else if (!hasLimit) notes.push('No credit limit set — utilization can’t be calculated');
    if (account.balance < 0) notes.push('Credit balance (the issuer owes you) — counted as $0 owed');
    if (eligible && owed > limit) notes.push('Over the limit');
    if (!isVerified(account)) notes.push('Balance not yet reconciled');
    const reported = latestReported(credit.reported, account.id);
    return {
      account, meta, active: meta.active, balance: account.balance, owed, limit, hasLimit, eligible, pct, level: utilLevel(pct),
      available: eligible ? Math.max(0, limit - owed) : 0, overBy: eligible ? Math.max(0, owed - limit) : 0, creditBalance: Math.max(0, -account.balance),
      verified: isVerified(account), reported, notes,
    };
  }).sort((a, b) => Number(b.active) - Number(a.active) || a.account.name.localeCompare(b.account.name));
}

export function latestReported(list: ReportedBalance[], accountId: string, bureau?: Bureau | null): ReportedBalance | undefined {
  return list.filter((r) => r.accountId === accountId && (!bureau || r.bureau === bureau))
    .sort((a, b) => (a.reportedOn < b.reportedOn ? 1 : a.reportedOn > b.reportedOn ? -1 : Number(b.id) - Number(a.id)))[0];
}

export interface Totals {
  owed: number;            // total revolving balances on active cards
  limits: number;          // total limits on active cards that have one
  eligibleOwed: number; eligibleLimit: number;
  available: number;       // available revolving credit
  pct: number | null;
  level: UtilLevel;
  activeCards: number; eligibleCards: number; excluded: CardRow[]; unverified: CardRow[]; overLimit: CardRow[];
}
export function totals(rows: CardRow[]): Totals {
  const active = rows.filter((r) => r.active), el = rows.filter((r) => r.eligible);
  const eligibleOwed = el.reduce((s, r) => s + r.owed, 0), eligibleLimit = el.reduce((s, r) => s + r.limit, 0);
  const pct = utilPct(eligibleOwed, eligibleLimit);
  return {
    owed: active.reduce((s, r) => s + r.owed, 0), limits: active.reduce((s, r) => s + r.limit, 0), eligibleOwed, eligibleLimit,
    available: el.reduce((s, r) => s + r.available, 0), pct, level: utilLevel(pct),
    activeCards: active.length, eligibleCards: el.length,
    excluded: active.filter((r) => !r.hasLimit), unverified: active.filter((r) => !r.verified), overLimit: el.filter((r) => r.overBy > 0),
  };
}

/** Plain-English caveats shown with any total. Empty array = nothing to flag. */
export function totalsCaveats(t: Totals): string[] {
  const out: string[] = [];
  if (t.activeCards === 0) out.push('No active credit cards yet.');
  else if (t.eligibleCards === 0) out.push('No active card has a credit limit, so overall utilization can’t be calculated.');
  if (t.excluded.length && t.eligibleCards > 0) out.push(`${t.excluded.map((r) => r.account.name).join(', ')} ${t.excluded.length === 1 ? 'has' : 'have'} no credit limit and ${t.excluded.length === 1 ? 'is' : 'are'} left out of utilization.`);
  if (t.unverified.length) out.push(`${t.unverified.map((r) => r.account.name).join(', ')} ${t.unverified.length === 1 ? 'balance hasn’t' : 'balances haven’t'} been reconciled yet, so ${t.unverified.length === 1 ? 'it' : 'they'} may not match the issuer.`);
  if (t.overLimit.length) out.push(`${t.overLimit.map((r) => r.account.name).join(', ')} ${t.overLimit.length === 1 ? 'is' : 'are'} over the limit.`);
  return out;
}

// ── reported utilization (what a bureau may actually have seen) ───────
export interface ReportedUtil {
  mode: 'none' | 'reported' | 'mixed' | 'estimate';
  pct: number | null; owed: number; limit: number;
  asOf?: string;            // the oldest reported date used
  usedReported: CardRow[]; usedCurrent: CardRow[];
}
/** Uses an explicit reported balance for each eligible card where one exists; any card without one falls back to its current balance, and the
 *  result is labelled "mixed" (partly estimated). With no reported balances at all the figure is labelled an estimate from current balances. */
export function reportedUtil(rows: CardRow[], list: ReportedBalance[], bureau?: Bureau | null): ReportedUtil {
  const el = rows.filter((r) => r.eligible);
  if (!el.length) return { mode: 'none', pct: null, owed: 0, limit: 0, usedReported: [], usedCurrent: [] };
  const usedReported: CardRow[] = [], usedCurrent: CardRow[] = [];
  let owed = 0, limit = 0, asOf: string | undefined;
  for (const r of el) {
    const rep = latestReported(list, r.account.id, bureau);
    limit += r.limit;
    if (rep) { owed += rep.balance; usedReported.push(r); if (!asOf || rep.reportedOn < asOf) asOf = rep.reportedOn; }
    else { owed += r.owed; usedCurrent.push(r); }
  }
  const mode = usedReported.length === 0 ? 'estimate' : usedCurrent.length === 0 ? 'reported' : 'mixed';
  return { mode, pct: utilPct(owed, limit), owed, limit, asOf, usedReported, usedCurrent };
}

// ── what-if calculator ─────────────────────────────────────
export interface WhatIfCard { row: CardRow; baseline: number; pay: number; after: number; pctBefore: number | null; pctAfter: number | null; capped: boolean }
export interface WhatIf {
  cards: WhatIfCard[]; totalPay: number;
  owedBefore: number; owedAfter: number; pctBefore: number | null; pctAfter: number | null; pointsChange: number | null;
  availableBefore: number; availableAfter: number; usesReported: boolean;
}
/** `payments` are hypothetical amounts in cents. A payment is capped at what is owed (you can't "pay" a zero or credit balance into negative).
 *  Baseline is each card's current balance, or — when `useReported` — its latest reported balance where one exists. Nothing is saved. */
export function whatIf(rows: CardRow[], payments: Record<string, number>, list: ReportedBalance[] = [], useReported = false): WhatIf {
  let usesReported = false;
  const cards: WhatIfCard[] = rows.filter((r) => r.eligible).map((row) => {
    let baseline = row.owed;
    if (useReported) { const rep = latestReported(list, row.account.id); if (rep) { baseline = rep.balance; usesReported = true; } }
    const want = Math.max(0, Math.round(payments[row.account.id] ?? 0));
    const pay = Math.min(want, baseline);
    const after = baseline - pay;
    return { row, baseline, pay, after, pctBefore: utilPct(baseline, row.limit), pctAfter: utilPct(after, row.limit), capped: want > baseline };
  });
  const limit = cards.reduce((s, c) => s + c.row.limit, 0);
  const owedBefore = cards.reduce((s, c) => s + c.baseline, 0), owedAfter = cards.reduce((s, c) => s + c.after, 0);
  const pctBefore = utilPct(owedBefore, limit), pctAfter = utilPct(owedAfter, limit);
  return {
    cards, totalPay: cards.reduce((s, c) => s + c.pay, 0), owedBefore, owedAfter, pctBefore, pctAfter,
    pointsChange: pctBefore != null && pctAfter != null ? Math.round((pctAfter - pctBefore) * 10) / 10 : null,
    availableBefore: cards.reduce((s, c) => s + Math.max(0, c.row.limit - c.baseline), 0),
    availableAfter: cards.reduce((s, c) => s + Math.max(0, c.row.limit - c.after), 0), usesReported,
  };
}

// ── statement & payment dates ──────────────────────────────
export interface CardDates {
  closing?: string; closingNote?: string;   // next statement closing date (rolled forward when the schedule repeats)
  due?: string; dueSource?: 'bill' | 'account'; dueBill?: { id: string; period: string; paused: boolean; amount: number };
  lastReported?: string;
}
export function cardDates(d: DataState, credit: CreditState, row: CardRow): CardDates {
  const out: CardDates = {};
  const m = row.meta;
  if (m.closingDate) {
    if (m.repeats) {
      let cur = m.closingDate, guard = 0;
      while (cur < d.today && guard++ < 600) cur = nextDueDate('Monthly', m.closingDate, cur);
      out.closing = cur;
    } else { out.closing = m.closingDate; if (m.closingDate < d.today) out.closingNote = 'This date has passed'; }
  }
  const bill = row.account.paymentCategoryId ? d.bills.find((b) => b.id === row.account.paymentCategoryId) : undefined;
  if (bill && bill.date) { out.due = bill.date; out.dueSource = 'bill'; out.dueBill = { id: bill.id, period: bill.recurring ? bill.period : 'One time', paused: bill.paused, amount: bill.amount }; }
  else if (row.account.nextPaymentDue) { out.due = row.account.nextPaymentDue; out.dueSource = 'account'; }
  out.lastReported = latestReported(credit.reported, row.account.id)?.reportedOn;
  return out;
}
export const daysUntil = (date: string, today: string) => diffDays(date, today);

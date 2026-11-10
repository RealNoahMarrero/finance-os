// Database access: one authenticated Supabase client, full-table loads (paged), mapping into the UI model,
// and thin wrappers over the atomic server-side functions (migration 011). All money is converted to integer cents here.
import { supabase } from './supabase';
import type { Account, AccountType, Bill, BillPeriod, Category, DataState, Debt, Group, Income, Reconciliation, Repeat, Txn } from './data';
import { diffDays, iso, todayISO } from './lib';
import { BUREAUS, type Bureau, type CardMeta, type CreditScore, type CreditState, type ReportedBalance } from './credit';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const cents = (x: unknown) => Math.round(Number(x ?? 0) * 100);
export const dollars = (c: number) => Math.round(c) / 100;
const S = (x: unknown) => String(x);

export class DbError extends Error {}
function ok<T>(r: { data: T; error: { message: string; code?: string } | null }): T {
  if (r.error) {
    const m = r.error.message || 'Something went wrong';
    throw new DbError(r.error.code === '42501' || /not authorized|permission denied|row-level security/i.test(m) ? 'Not authorized — please sign in again.' : m);
  }
  return r.data;
}

async function fetchAll(table: string, select = '*', order = 'id'): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = ok(await supabase.from(table).select(select).order(order, { ascending: true }).range(from, from + 999)) as unknown as Row[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export interface RawData {
  accounts: Row[]; groups: Row[]; categories: Row[]; transactions: Row[]; splits: Row[]; income: Row[];
  baselines: Row[]; recons: Row[]; billPayments: Row[]; audit: Row[];
  creditScores?: Row[]; creditMeta?: Row[]; creditReported?: Row[]; creditReady?: boolean; // optional so older callers/tests still type-check
}
export async function fetchRaw(): Promise<RawData> {
  const [accounts, groups, categories, transactions, splits, income, baselines, recons, billPayments, audit] = await Promise.all([
    fetchAll('accounts'), fetchAll('category_groups'), fetchAll('categories'), fetchAll('transactions'), fetchAll('transaction_splits'),
    fetchAll('projected_income'), fetchAll('account_baselines'), fetchAll('account_reconciliations'), fetchAll('bill_payments'), fetchAll('account_balance_audit', '*', 'account_id'),
  ]);
  // Credit tracker tables (migration 014). Tolerated as absent so the rest of the app keeps working if the migration is not applied yet.
  let creditScores: Row[] = [], creditMeta: Row[] = [], creditReported: Row[] = [], creditReady = true;
  try { [creditScores, creditMeta, creditReported] = await Promise.all([fetchAll('credit_scores'), fetchAll('credit_card_meta', '*', 'account_id'), fetchAll('credit_reported_balances')]); }
  catch { creditReady = false; }
  return { accounts, groups, categories, transactions, splits, income, baselines, recons, billPayments, audit, creditScores, creditMeta, creditReported, creditReady };
}

const ACCT_TYPE: Record<string, AccountType> = { Checking: 'checking', Savings: 'savings', Cash: 'cash', 'Credit Card': 'credit' };
const DB_ACCT_TYPE: Record<AccountType, string> = { checking: 'Checking', savings: 'Savings', cash: 'Cash', credit: 'Credit Card' };
const kindOf = (name: string): Group['kind'] => {
  const n = name.toLowerCase();
  if (n.includes('bill') || n.includes('subscription')) return 'bills';
  if (n.includes('need')) return 'everyday';
  if (n.includes('want')) return 'lifestyle';
  return 'goals';
};
const REPEAT: Record<string, Repeat> = { Weekly: 'weekly', Biweekly: 'biweekly', Monthly: 'monthly', Semimonthly: 'semimonthly' };
export const DB_REPEAT: Record<Repeat, string> = { none: 'None', weekly: 'Weekly', biweekly: 'Biweekly', semimonthly: 'Semimonthly', monthly: 'Monthly' };
const PERIOD = (p: string | null): BillPeriod => (p === 'Weekly' || p === 'Bi-Weekly' || p === 'Yearly' ? p : 'Monthly');

/** Map database rows to the UI model. Business records are loaded but hidden (still stored and exportable). */
export function toDataState(raw: RawData, today = todayISO()): DataState {
  const personal = (r: Row) => (r.entity_id ?? 'personal') === 'personal';
  const baseBy = new Map(raw.baselines.filter((b) => !b.superseded_at).map((b) => [S(b.account_id), b]));
  const auditBy = new Map(raw.audit.map((a) => [S(a.account_id), a]));
  const lastRecon = new Map<string, string>();
  for (const r of raw.recons) { const k = S(r.account_id); if (!lastRecon.has(k) || r.reconciled_on > lastRecon.get(k)!) lastRecon.set(k, r.reconciled_on); }

  const allAccounts: Account[] = raw.accounts.filter(personal).map((a) => {
    const b = baseBy.get(S(a.id)); const au = auditBy.get(S(a.id));
    const rec = lastRecon.get(S(a.id));
    const last = [b?.cutover_date, rec].filter(Boolean).sort().pop() ?? null;
    return {
      id: S(a.id), name: a.name, type: ACCT_TYPE[a.type] ?? 'checking', mask: '', institution: '', balance: cents(a.balance),
      limit: a.type === 'Credit Card' && Number(a.credit_limit) > 0 ? cents(a.credit_limit) : undefined,
      lastReconciled: last, baseline: b?.cutover_date ?? null, openingBalance: b ? cents(b.opening_balance) : null,
      derived: au && au.derived_balance != null ? cents(au.derived_balance) : null,
      paymentCategoryId: a.payment_category_id ? S(a.payment_category_id) : undefined,
      nextPaymentDue: a.next_payment_due_date ?? undefined,
      archived: a.is_archived === true,
    };
  });
  const accounts = allAccounts.filter((a) => !a.archived);
  const acctIds = new Set(accounts.map((a) => a.id));
  const defaultAcct = accounts.find((a) => a.type === 'checking')?.id ?? accounts[0]?.id ?? '';
  const cardOf = new Map(accounts.filter((a) => a.paymentCategoryId).map((a) => [a.paymentCategoryId!, a.id]));

  const groups: Group[] = raw.groups.filter(personal).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map((g) => ({ id: S(g.id), name: g.name, kind: (['bills', 'everyday', 'lifestyle', 'goals'] as const).find((k) => k === g.kind) ?? kindOf(g.name) })); // stored kind (migration 018) wins; the name guess is only a fallback
  const kindById = new Map(groups.map((g) => [g.id, g.kind]));

  const cats = raw.categories.filter(personal).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
  const categories: Category[] = cats.map((c) => {
    const kind = kindById.get(S(c.group_id));
    return {
      id: S(c.id), groupId: S(c.group_id), name: c.name, icon: c.emoji || '', target: Number(c.target_amount) > 0 ? cents(c.target_amount) : null,
      priority: kind === 'bills' ? 1 : kind === 'everyday' ? 2 : 3, carry: 0, assigned: cents(c.assigned_amount),
      cardAccountId: cardOf.get(S(c.id)), hidden: !!c.is_hidden, billPaused: !!c.bill_paused, billArchived: !!c.bill_archived, isDebt: !!c.is_debt, debtBalance: cents(c.balance),
    };
  });

  // Splits + links from bill/income confirmations
  const splitsBy = new Map<string, { categoryId: string; amount: number }[]>();
  for (const s of [...raw.splits].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id)) {
    const k = S(s.transaction_id); if (!splitsBy.has(k)) splitsBy.set(k, []);
    splitsBy.get(k)!.push({ categoryId: S(s.category_id), amount: cents(s.amount) });
  }
  const billOfTxn = new Map(raw.billPayments.filter((p) => p.transaction_id).map((p) => [S(p.transaction_id), S(p.category_id)]));
  const incomeOfTxn = new Map(raw.income.filter((p) => p.transaction_id).map((p) => [S(p.transaction_id), S(p.id)]));
  const txns: Txn[] = raw.transactions.filter((t) => personal(t) && acctIds.has(S(t.account_id)))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id))
    .map((t) => ({
      id: S(t.id), date: t.date, payee: t.payee ?? '', amount: cents(t.amount), type: String(t.type).toLowerCase() as Txn['type'],
      accountId: S(t.account_id), toAccountId: t.to_account_id ? S(t.to_account_id) : undefined,
      categoryId: t.category_id ? S(t.category_id) : undefined, splits: splitsBy.get(S(t.id)), notes: t.notes ?? undefined,
      adjustment: !!t.is_adjustment, billId: billOfTxn.get(S(t.id)), incomeId: incomeOfTxn.get(S(t.id)), scheduled: t.status === 'scheduled',
    }));

  const paidBy = new Map<string, Record<string, string>>();
  for (const p of raw.billPayments) { const k = S(p.category_id); if (!paidBy.has(k)) paidBy.set(k, {}); paidBy.get(k)![p.due_date] = p.transaction_id ? S(p.transaction_id) : 'manual'; }
  const billAmt = (c: Row) => (c.bill_amount != null ? cents(c.bill_amount) : cents(c.target_amount)); // one payment; falls back to the funding target for older bills
  const toBill = (c: Row): Bill => ({
    id: S(c.id), name: c.name, payee: c.name, categoryId: S(c.id), amount: billAmt(c), dueDay: Number(String(c.due_date).slice(8, 10)),
    recurring: !!c.is_repeating, date: c.due_date, period: PERIOD(c.target_period), mode: c.bill_mode === 'prepare' ? 'prepare' : 'reminder',
    accountId: defaultAcct, toAccountId: cardOf.get(S(c.id)), paid: paidBy.get(S(c.id)) ?? {}, isDebt: !!c.is_debt, anchor: c.bill_anchor ?? undefined, paused: !!c.bill_paused,
  });
  // Archived bills leave every active list, reminder and forecast; they are kept (with all history) in archivedBills.
  const bills: Bill[] = cats.filter((c) => !c.is_hidden && !c.bill_archived && c.due_date && billAmt(c) > 0).map(toBill);
  const archivedBills: Bill[] = cats.filter((c) => c.bill_archived && c.due_date).map(toBill);
  const billIds = new Set(bills.map((b) => b.id));
  const debts: Debt[] = cats.filter((c) => c.is_debt && Number(c.balance) > 0).map((c) => ({
    id: S(c.id), name: c.name + (c.is_hidden ? ' (archived)' : ''), balance: cents(c.balance), payment: cents(c.target_amount),
    dueDay: c.due_date ? Number(String(c.due_date).slice(8, 10)) : 0, startBalance: cents(c.balance), billId: billIds.has(S(c.id)) ? S(c.id) : undefined,
  }));

  const incomes: Income[] = raw.income.filter((p) => personal(p) && p.status === 'pending').map((p) => ({
    id: S(p.id), label: p.label, amount: cents(p.amount), date: p.expected_date, certainty: p.certainty === 'guaranteed' ? 'guaranteed' : 'anticipated',
    repeat: p.is_repeating ? REPEAT[p.repeat_period] ?? 'none' : 'none', accountId: p.account_id && acctIds.has(S(p.account_id)) ? S(p.account_id) : defaultAcct,
    status: 'pending', who: 'Household', anchor: p.income_anchor ?? undefined,
  }));

  const reconciliations: Reconciliation[] = raw.recons.map((r) => ({
    id: S(r.id), accountId: S(r.account_id), date: r.reconciled_on, recorded: cents(r.recorded_balance), actual: cents(r.actual_balance), diff: cents(r.difference),
    adjustmentTxnId: r.adjustment_transaction_id ? S(r.adjustment_transaction_id) : undefined, note: r.note ?? undefined,
  })).sort((a, b) => (a.date < b.date ? 1 : -1));

  const bureau = (b: unknown): Bureau | undefined => (BUREAUS as readonly string[]).includes(String(b)) ? (b as Bureau) : undefined;
  const credit: CreditState = {
    ready: raw.creditReady !== false,
    scores: (raw.creditScores ?? []).filter((r) => bureau(r.bureau)).map((r): CreditScore => ({ id: S(r.id), bureau: r.bureau, score: Number(r.score), model: r.model || 'Unknown', observedOn: r.observed_on, source: r.source ?? undefined, notes: r.notes ?? undefined })),
    meta: Object.fromEntries((raw.creditMeta ?? []).filter((m) => acctIds.has(S(m.account_id))).map((m): [string, CardMeta] => [S(m.account_id), { accountId: S(m.account_id), active: m.active !== false, closingDate: m.statement_closing_date ?? undefined, repeats: m.statement_repeats !== false, notes: m.notes ?? undefined }])),
    reported: (raw.creditReported ?? []).filter((r) => acctIds.has(S(r.account_id))).map((r): ReportedBalance => ({ id: S(r.id), accountId: S(r.account_id), balance: cents(r.balance), reportedOn: r.reported_on, bureau: bureau(r.bureau), notes: r.notes ?? undefined })),
  };
  return {
    credit, accounts, allAccounts, groups, categories, txns, bills, archivedBills, incomes, debts, planned: [], reconciliations, today,
    hiddenBusiness: {
      accounts: raw.accounts.filter((a) => !personal(a)).length, categories: raw.categories.filter((c) => !personal(c)).length,
      transactions: raw.transactions.filter((t) => !personal(t)).length,
    },
  };
}

export async function loadAll(): Promise<{ state: DataState; raw: RawData }> {
  const raw = await fetchRaw();
  return { state: toDataState(raw), raw };
}

// ── atomic server-side operations (migration 011) ──────────────────────────
const TYPE_DB = { expense: 'Expense', income: 'Income', transfer: 'Transfer' } as const;
const num = (id: string | undefined) => (id ? Number(id) : null);
export const newRequestId = () => crypto.randomUUID();

function txnPayload(t: Omit<Txn, 'id'>, requestId?: string) {
  return {
    date: t.date, amount: dollars(t.amount), payee: t.payee, type: TYPE_DB[t.type], account_id: num(t.accountId), to_account_id: num(t.toAccountId),
    category_id: t.splits?.length ? null : num(t.categoryId), notes: t.notes ?? null, entity_id: 'personal',
    splits: (t.splits ?? []).map((s) => ({ category_id: Number(s.categoryId), amount: dollars(s.amount) })), client_request_id: requestId ?? null, scheduled: !!t.scheduled,
  };
}
export const createTxn = async (t: Omit<Txn, 'id'>, requestId = newRequestId()) => String(ok(await supabase.rpc('fos_create_transaction', { p: txnPayload(t, requestId) })));
export const updateTxn = async (id: string, t: Omit<Txn, 'id'>) => { ok(await supabase.rpc('fos_update_transaction', { tid: Number(id), p: txnPayload(t) })); };
/** Returns the deleted row so the caller can offer Undo by re-creating it. */
export const deleteTxn = async (id: string): Promise<Omit<Txn, 'id'>> => {
  const r = ok(await supabase.rpc('fos_delete_transaction', { tid: Number(id) })) as Row;
  return {
    date: r.date, payee: r.payee ?? '', amount: cents(r.amount), type: String(r.type).toLowerCase() as Txn['type'], accountId: S(r.account_id),
    toAccountId: r.to_account_id ? S(r.to_account_id) : undefined, categoryId: r.category_id ? S(r.category_id) : undefined, notes: r.notes ?? undefined,
    splits: (r.splits as Row[] | undefined)?.length ? (r.splits as Row[]).map((s) => ({ categoryId: S(s.category_id), amount: cents(s.amount) })) : undefined,
  };
};
export const assignMoney = async (amounts: Record<string, number>) => {
  ok(await supabase.rpc('fos_assign', { assignments: Object.entries(amounts).map(([k, v]) => ({ category_id: Number(k), amount: dollars(v) })) }));
};
export const moveMoney = async (from: string, to: string, amt: number) => { ok(await supabase.rpc('fos_move_money', { from_id: Number(from), to_id: Number(to), amt: dollars(amt) })); };
export const setCutover = async (acct: string, cutover: string, opening: number, note?: string) => cents(ok(await supabase.rpc('fos_set_cutover', { acct: Number(acct), cutover, opening: dollars(opening), note: note ?? null })));
export const reconcileAccount = async (acct: string, actual: number, on: string, requestId = newRequestId(), note?: string) => {
  const r = ok(await supabase.rpc('fos_reconcile', { acct: Number(acct), actual: dollars(actual), on_date: on, request_id: requestId, note: note ?? null })) as Row;
  return { diff: cents(r.difference), adjustmentTxnId: r.adjustment_transaction_id ? S(r.adjustment_transaction_id) : undefined };
};
export const payBill = async (cat: string, due: string, paidOn: string, mode: 'reminder' | 'prepare', txn?: Omit<Txn, 'id'>, requestId = newRequestId()) => {
  const r = ok(await supabase.rpc('fos_pay_bill', { cat: Number(cat), due, paid_on: paidOn, mode, txn: txn ? txnPayload(txn, requestId) : null, advance: true })) as Row;
  return { transactionId: r.transaction_id ? S(r.transaction_id) : undefined };
};
export const receiveIncome = async (pid: string, on: string, amt: number, acct: string, requestId = newRequestId()) =>
  String(ok(await supabase.rpc('fos_receive_income', { pid: Number(pid), received_on: on, amt: dollars(amt), acct: Number(acct), request_id: requestId })));
export const skipIncome = async (pid: string, occ: string): Promise<string | undefined> => { const r = ok(await supabase.rpc('fos_skip_income_occurrence', { pid: Number(pid), occ })) as Row | null; return r?.next_id ? S(r.next_id) : undefined; };

// ── plain row edits (no balance effect) ────────────────────────────────────
export const addIncomeRow = async (i: Omit<Income, 'id' | 'status'>) => {
  ok(await supabase.from('projected_income').insert({
    label: i.label, amount: dollars(i.amount), expected_date: i.date, account_id: num(i.accountId), status: 'pending', certainty: i.certainty,
    is_repeating: i.repeat !== 'none', repeat_period: DB_REPEAT[i.repeat], entity_id: 'personal', source_type: 'manual',
  }));
};
export interface IncomePatch { label: string; amount: number; date: string; certainty: Income['certainty']; repeat: Income['repeat']; accountId: string }
/** Plain edit of a still-pending expected income. Never touches received income or transactions (guarded by status). */
export const updateIncomeRow = async (id: string, p: IncomePatch) => {
  ok(await supabase.from('projected_income').update({
    label: p.label, amount: dollars(p.amount), expected_date: p.date, certainty: p.certainty, account_id: num(p.accountId),
    is_repeating: p.repeat !== 'none', repeat_period: DB_REPEAT[p.repeat],
  }).eq('id', Number(id)).eq('status', 'pending'));
};
/** "Delete" = mark cancelled. The row is kept (history), nothing is removed, and no next occurrence is created. */
export const cancelIncomeRow = async (id: string) => { ok(await supabase.from('projected_income').update({ status: 'cancelled' }).eq('id', Number(id)).eq('status', 'pending')); };
export const restoreIncomeRow = async (id: string) => { ok(await supabase.from('projected_income').update({ status: 'pending' }).eq('id', Number(id)).eq('status', 'cancelled')); };
/** Skip one occurrence of a repeating income: the database cancels it and schedules the next. Returns the id of that next row so it can be undone. */
/** The database reports exactly which occurrence the skip created, so Undo removes that one and nothing else. */
export const skipOccurrence = async (id: string, occ: string) => skipIncome(id, occ);
export const undoSkipOccurrence = async (id: string, occ: string, nextId?: string) => {
  ok(await supabase.rpc('fos_unskip_income_occurrence', { pid: Number(id), occ, next_id: nextId ? Number(nextId) : null }));
};
export const setIncomeCertainty = async (id: string, c: Income['certainty']) => { ok(await supabase.from('projected_income').update({ certainty: c }).eq('id', Number(id))); };
export const setCategoryTarget = async (id: string, target: number | null) => { ok(await supabase.from('categories').update({ target_amount: target == null ? 0 : dollars(target) }).eq('id', Number(id))); };
export const setBillMode = async (id: string, mode: Bill['mode']) => { ok(await supabase.from('categories').update({ bill_mode: mode }).eq('id', Number(id))); };
/** Edits a bill. A bill is a budget category with a due date, so this updates that one row only:
 *  it never creates, changes or deletes a transaction, payment record or budget amount. */
export interface BillPatch { name: string; amount: number; date: string; recurring: boolean; period: BillPeriod; mode: Bill['mode']; groupId: string; paused: boolean; anchor?: string; target?: number | null }
export const updateBill = async (id: string, p: BillPatch) => {
  const clash = ok(await supabase.from('bill_payments').select('id').eq('category_id', Number(id)).eq('due_date', p.date).limit(1)) as Row[];
  if (clash.length) throw new DbError('That due date is already recorded as paid. Choose the next unpaid date.');
  ok(await supabase.from('categories').update({
    name: p.name.trim(), bill_amount: dollars(p.amount), ...(p.target !== undefined ? { target_amount: dollars(p.target ?? 0) } : {}), due_date: p.date, is_repeating: p.recurring, target_period: p.period, bill_mode: p.mode, group_id: Number(p.groupId), bill_paused: p.paused, ...(p.anchor ? { bill_anchor: p.anchor } : {}),
  }).eq('id', Number(id)));
};
/** Debt details live on the category row: is_debt + balance (the amount owed). A plain edit: it never creates a transaction, never touches
 *  account balances, envelope funding, bills or payment history. Turning debt off keeps the stored balance in case it is switched back on. */
export const setDebt = async (id: string, d: { isDebt: boolean; balance: number }) => {
  ok(await supabase.from('categories').update({ is_debt: d.isDebt, balance: dollars(Math.max(0, d.balance)) }).eq('id', Number(id)));
};
export interface ScheduleInput { amount: number; date: string; period: 'once' | BillPeriod; mode: Bill['mode'] }
const scheduleCols = (s: ScheduleInput) => ({ bill_amount: dollars(s.amount), due_date: s.date, bill_anchor: s.date, is_repeating: s.period !== 'once', ...(s.period !== 'once' ? { target_period: s.period } : {}), bill_mode: s.mode, bill_paused: false });
export const addCategoryRow = async (c: { name: string; groupId: string; target: number | null; emoji?: string; schedule?: ScheduleInput }) => {
  ok(await supabase.from('categories').insert({ name: c.name.trim(), group_id: Number(c.groupId), target_amount: c.target ? dollars(c.target) : 0, target_period: 'Monthly', emoji: c.emoji || null, entity_id: 'personal', assigned_amount: 0, ...(c.schedule ? scheduleCols(c.schedule) : {}) }));
};
/** Name, emoji and group only. Never touches funding, transactions, bills or debt fields. */
export const updateCategory = async (id: string, p: { name: string; emoji: string; groupId: string }) => {
  ok(await supabase.from('categories').update({ name: p.name.trim(), emoji: p.emoji.trim() || null, group_id: Number(p.groupId) }).eq('id', Number(id)));
};
/** Adds a payment schedule to an existing category (only its bill columns change). */
export const scheduleBill = async (id: string, s: ScheduleInput) => {
  const clash = ok(await supabase.from('bill_payments').select('id').eq('category_id', Number(id)).eq('due_date', s.date).limit(1)) as Row[];
  if (clash.length) throw new DbError('That due date is already recorded as paid. Choose the next unpaid date.');
  ok(await supabase.from('categories').update(scheduleCols(s)).eq('id', Number(id)));
};
/** Removes the schedule only. The category, its funding target and balance, transactions, payment history and any debt balance stay exactly as they are. */
export const removeBill = async (id: string) => {
  ok(await supabase.from('categories').update({ due_date: null, bill_anchor: null, is_repeating: false, bill_paused: false, bill_amount: null, bill_mode: 'reminder' }).eq('id', Number(id)));
};
/** Retires a bill. Only bill flags change (it is also paused so forecasts/reminders ignore it); the category, its money, transactions and payment history are untouched. */
export const setBillArchived = async (id: string, archived: boolean, resumeDate?: string) => {
  ok(await supabase.from('categories').update(archived
    ? { bill_archived: true, bill_archived_at: new Date().toISOString(), bill_paused: true }
    : { bill_archived: false, bill_archived_at: null, bill_paused: false, ...(resumeDate ? { due_date: resumeDate } : {}) }).eq('id', Number(id)));
};
/** Archive / restore a budget category. History, allocations and transactions are never touched. */
export const setCategoryHidden = async (id: string, hidden: boolean) => { ok(await supabase.from('categories').update({ is_hidden: hidden }).eq('id', Number(id))); };
/** Links an already-recorded transaction to a bill occurrence and moves the bill to its next due date. The unique (bill, due date) record stops a second advance for the same occurrence. */
export const linkBillPayment = async (cat: string, due: string, txnId: string, paidOn: string, amount: number, nextDate: string) => {
  ok(await supabase.from('bill_payments').insert({ category_id: Number(cat), due_date: due, paid_on: paidOn, amount: dollars(amount), transaction_id: Number(txnId), mode: 'prepare' }));
  const r = await supabase.from('categories').update({ due_date: nextDate }).eq('id', Number(cat)).eq('due_date', due);
  if (r.error) { await supabase.from('bill_payments').delete().eq('category_id', Number(cat)).eq('due_date', due); throw new DbError(r.error.message); }
};
export const unlinkBillPayment = async (cat: string, due: string) => {
  ok(await supabase.from('categories').update({ due_date: due }).eq('id', Number(cat)));
  ok(await supabase.from('bill_payments').delete().eq('category_id', Number(cat)).eq('due_date', due));
};
export const addAccountRow = async (a: { name: string; type: AccountType; limit?: number }): Promise<string> => {
  const r = ok(await supabase.from('accounts').insert({ name: a.name, type: DB_ACCT_TYPE[a.type], balance: 0, credit_limit: a.limit ? dollars(a.limit) : 0, entity_id: 'personal' }).select('id').single()) as Row;
  return S(r.id);
};

export const updateAccountRow = async (id: string, a: { name: string; type?: AccountType; limit?: number | null }) => {
  const patch: Row = { name: a.name };
  if (a.type) patch.type = DB_ACCT_TYPE[a.type];
  if (a.limit !== undefined) patch.credit_limit = a.limit ? dollars(a.limit) : 0;
  ok(await supabase.from('accounts').update(patch).eq('id', Number(id)));
};
export const setAccountArchived = async (id: string, archived: boolean) => {
  ok(await supabase.from('accounts').update({ is_archived: archived, archived_at: archived ? new Date().toISOString() : null }).eq('id', Number(id)));
};
/** Server-checked: only succeeds for an account with no history whatsoever. */
export const deleteUnusedAccount = async (id: string) => { ok(await supabase.rpc('fos_delete_unused_account', { acct: Number(id) })); };

// ── Credit tracker (plain owner-only rows; none of these touch balances, transactions or bills) ──
export interface ScoreInput { bureau: Bureau; score: number; model: string; observedOn: string; source?: string; notes?: string }
const scoreRow = (s: ScoreInput) => ({ bureau: s.bureau, score: s.score, model: s.model.trim() || 'Unknown', observed_on: s.observedOn, source: s.source?.trim() || null, notes: s.notes?.trim() || null });
export const addScore = async (s: ScoreInput): Promise<string> => S((ok(await supabase.from('credit_scores').insert(scoreRow(s)).select('id').single()) as Row).id);
export const updateScore = async (id: string, s: ScoreInput) => { ok(await supabase.from('credit_scores').update(scoreRow(s)).eq('id', Number(id))); };
export const deleteScore = async (id: string) => { ok(await supabase.from('credit_scores').delete().eq('id', Number(id))); };
export interface CardMetaInput { active: boolean; closingDate?: string; repeats: boolean; notes?: string }
export const saveCardMeta = async (accountId: string, m: CardMetaInput) => {
  ok(await supabase.from('credit_card_meta').upsert({ account_id: Number(accountId), active: m.active, statement_closing_date: m.closingDate || null, statement_repeats: m.repeats, notes: m.notes?.trim() || null }, { onConflict: 'account_id' }));
};
/** The credit limit lives on the account itself (the one source of truth the Accounts page also uses). 0 = no limit set. */
export const setCreditLimit = async (accountId: string, limit: number) => { ok(await supabase.from('accounts').update({ credit_limit: dollars(Math.max(0, limit)) }).eq('id', Number(accountId))); };
export interface ReportedInput { accountId: string; balance: number; reportedOn: string; bureau?: Bureau; notes?: string }
const repRow = (r: ReportedInput) => ({ account_id: Number(r.accountId), balance: dollars(r.balance), reported_on: r.reportedOn, bureau: r.bureau ?? null, notes: r.notes?.trim() || null });
export const addReported = async (r: ReportedInput): Promise<string> => S((ok(await supabase.from('credit_reported_balances').insert(repRow(r)).select('id').single()) as Row).id);
export const updateReported = async (id: string, r: ReportedInput) => { ok(await supabase.from('credit_reported_balances').update(repRow(r)).eq('id', Number(id))); };
export const deleteReported = async (id: string) => { ok(await supabase.from('credit_reported_balances').delete().eq('id', Number(id))); };

/** Everything, including hidden Business records, as one JSON file the user can keep. */
export async function exportEverything() {
  const raw = await fetchRaw();
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), app: 'Finances', ...raw }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `finances-export-${iso(new Date())}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ── Finances 2.0: atomic server operations (migration 018) ───────────────────
export interface PayInput { billId: string; due: string; mode: 'post' | 'link' | 'external'; paidOn?: string; amount?: number; accountId?: string; transactionId?: string; settle?: boolean; requestId: string }
export interface PayResult { settled: boolean; transactionId?: string; created: boolean; amount: number; nextDue?: string; duplicate: boolean }
export const payBillV2 = async (i: PayInput): Promise<PayResult> => {
  const r = ok(await supabase.rpc('fos_pay_bill_v2', { p: { category_id: Number(i.billId), due: i.due, mode: i.mode, paid_on: i.paidOn ?? todayISO(), amount: i.amount != null ? dollars(i.amount) : null, account_id: num(i.accountId), transaction_id: num(i.transactionId), settle: i.settle ?? true, request_id: i.requestId } })) as Row;
  return { settled: !!r.settled, transactionId: r.transaction_id ? S(r.transaction_id) : undefined, created: !!r.created, amount: cents(r.amount), nextDue: r.next_due ?? undefined, duplicate: !!r.duplicate };
};
export const unpayBill = async (billId: string, due: string, deleteTxn: boolean) => { ok(await supabase.rpc('fos_unpay_bill', { cat: Number(billId), due, delete_txn: deleteTxn })); };
/** Posts scheduled transactions whose date has arrived (idempotent; any signed-in device may call it). Tolerated as absent before migration 018. */
export const postDue = async (today: string): Promise<number> => { const r = await supabase.rpc('fos_post_due', { today }); return r.error ? 0 : Number(r.data ?? 0); };
export const setBillPaused = async (billId: string, paused: boolean, resume?: string) => { ok(await supabase.rpc('fos_set_bill_paused', { cat: Number(billId), paused, resume: resume ?? null })); };
export const addAccountAtomic = async (a: { name: string; type: AccountType; limit?: number; opening: number; cutover: string }): Promise<string> =>
  S(ok(await supabase.rpc('fos_add_account', { p: { name: a.name, type: DB_ACCT_TYPE[a.type], credit_limit: a.limit ? dollars(a.limit) : 0, opening: dollars(a.opening), cutover: a.cutover } })));
export const setCutoversAtomic = async (date: string, items: { accountId: string; opening: number }[]) => { ok(await supabase.rpc('fos_set_cutovers', { cutover: date, items: items.map((x) => ({ account_id: Number(x.accountId), opening: dollars(x.opening) })) })); };
export const archiveBillAtomic = async (billId: string, archived: boolean, alsoCategory: boolean, resume?: string) => { ok(await supabase.rpc('fos_archive_bill', { cat: Number(billId), archived, also_category: alsoCategory, resume: resume ?? null })); };
void diffDays;

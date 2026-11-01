// Database access: one authenticated Supabase client, full-table loads (paged), mapping into the UI model,
// and thin wrappers over the atomic server-side functions (migration 011). All money is converted to integer cents here.
import { supabase } from './supabase';
import type { Account, AccountType, Bill, BillPeriod, Category, DataState, Debt, Group, Income, Reconciliation, Repeat, Txn } from './data';
import { diffDays, iso, todayISO } from './lib';

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
}
export async function fetchRaw(): Promise<RawData> {
  const [accounts, groups, categories, transactions, splits, income, baselines, recons, billPayments, audit] = await Promise.all([
    fetchAll('accounts'), fetchAll('category_groups'), fetchAll('categories'), fetchAll('transactions'), fetchAll('transaction_splits'),
    fetchAll('projected_income'), fetchAll('account_baselines'), fetchAll('account_reconciliations'), fetchAll('bill_payments'), fetchAll('account_balance_audit', '*', 'account_id'),
  ]);
  return { accounts, groups, categories, transactions, splits, income, baselines, recons, billPayments, audit };
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

  const accounts: Account[] = raw.accounts.filter(personal).map((a) => {
    const b = baseBy.get(S(a.id)); const au = auditBy.get(S(a.id));
    const rec = lastRecon.get(S(a.id));
    const last = [b?.cutover_date, rec].filter(Boolean).sort().pop() ?? null;
    return {
      id: S(a.id), name: a.name, type: ACCT_TYPE[a.type] ?? 'checking', mask: '', institution: '', balance: cents(a.balance),
      limit: a.type === 'Credit Card' && Number(a.credit_limit) > 0 ? cents(a.credit_limit) : undefined,
      lastReconciled: last, baseline: b?.cutover_date ?? null, openingBalance: b ? cents(b.opening_balance) : null,
      derived: au && au.derived_balance != null ? cents(au.derived_balance) : null,
      paymentCategoryId: a.payment_category_id ? S(a.payment_category_id) : undefined,
    };
  });
  const acctIds = new Set(accounts.map((a) => a.id));
  const defaultAcct = accounts.find((a) => a.type === 'checking')?.id ?? accounts[0]?.id ?? '';
  const cardOf = new Map(accounts.filter((a) => a.paymentCategoryId).map((a) => [a.paymentCategoryId!, a.id]));

  const groups: Group[] = raw.groups.filter(personal).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map((g) => ({ id: S(g.id), name: g.name, kind: kindOf(g.name) }));
  const kindById = new Map(groups.map((g) => [g.id, g.kind]));

  const cats = raw.categories.filter(personal).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
  const categories: Category[] = cats.map((c) => {
    const kind = kindById.get(S(c.group_id));
    return {
      id: S(c.id), groupId: S(c.group_id), name: c.name, icon: c.emoji || '', target: Number(c.target_amount) > 0 ? cents(c.target_amount) : null,
      priority: kind === 'bills' ? 1 : kind === 'everyday' ? 2 : 3, carry: 0, assigned: cents(c.assigned_amount),
      cardAccountId: cardOf.get(S(c.id)), hidden: !!c.is_hidden,
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
      adjustment: !!t.is_adjustment, billId: billOfTxn.get(S(t.id)), incomeId: incomeOfTxn.get(S(t.id)),
    }));

  const paidBy = new Map<string, Record<string, string>>();
  for (const p of raw.billPayments) { const k = S(p.category_id); if (!paidBy.has(k)) paidBy.set(k, {}); paidBy.get(k)![p.due_date] = p.transaction_id ? S(p.transaction_id) : 'manual'; }
  const bills: Bill[] = cats.filter((c) => !c.is_hidden && c.due_date && Number(c.target_amount) > 0).map((c) => ({
    id: S(c.id), name: c.name, payee: c.name, categoryId: S(c.id), amount: cents(c.target_amount), dueDay: Number(String(c.due_date).slice(8, 10)),
    recurring: !!c.is_repeating, date: c.due_date, period: PERIOD(c.target_period), mode: c.bill_mode === 'prepare' ? 'prepare' : 'reminder',
    accountId: defaultAcct, toAccountId: cardOf.get(S(c.id)), paid: paidBy.get(S(c.id)) ?? {}, isDebt: !!c.is_debt,
  }));
  const billIds = new Set(bills.map((b) => b.id));
  const debts: Debt[] = cats.filter((c) => c.is_debt && Number(c.balance) > 0).map((c) => ({
    id: S(c.id), name: c.name + (c.is_hidden ? ' (archived)' : ''), balance: cents(c.balance), payment: cents(c.target_amount),
    dueDay: c.due_date ? Number(String(c.due_date).slice(8, 10)) : 0, startBalance: cents(c.balance), billId: billIds.has(S(c.id)) ? S(c.id) : undefined,
  }));

  const incomes: Income[] = raw.income.filter((p) => personal(p) && p.status === 'pending').map((p) => ({
    id: S(p.id), label: p.label, amount: cents(p.amount), date: p.expected_date, certainty: p.certainty === 'guaranteed' ? 'guaranteed' : 'anticipated',
    repeat: p.is_repeating ? REPEAT[p.repeat_period] ?? 'none' : 'none', accountId: p.account_id && acctIds.has(S(p.account_id)) ? S(p.account_id) : defaultAcct,
    status: 'pending', who: 'Household',
  }));

  const reconciliations: Reconciliation[] = raw.recons.map((r) => ({
    id: S(r.id), accountId: S(r.account_id), date: r.reconciled_on, recorded: cents(r.recorded_balance), actual: cents(r.actual_balance), diff: cents(r.difference),
    adjustmentTxnId: r.adjustment_transaction_id ? S(r.adjustment_transaction_id) : undefined, note: r.note ?? undefined,
  })).sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    accounts, groups, categories, txns, bills, incomes, debts, planned: [], reconciliations, today,
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
    splits: (t.splits ?? []).map((s) => ({ category_id: Number(s.categoryId), amount: dollars(s.amount) })), client_request_id: requestId ?? null,
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
export const skipIncome = async (pid: string, occ: string) => { ok(await supabase.rpc('fos_skip_income_occurrence', { pid: Number(pid), occ })); };

// ── plain row edits (no balance effect) ────────────────────────────────────
export const addIncomeRow = async (i: Omit<Income, 'id' | 'status'>) => {
  ok(await supabase.from('projected_income').insert({
    label: i.label, amount: dollars(i.amount), expected_date: i.date, account_id: num(i.accountId), status: 'pending', certainty: i.certainty,
    is_repeating: i.repeat !== 'none', repeat_period: DB_REPEAT[i.repeat], entity_id: 'personal', source_type: 'manual',
  }));
};
export const setIncomeCertainty = async (id: string, c: Income['certainty']) => { ok(await supabase.from('projected_income').update({ certainty: c }).eq('id', Number(id))); };
export const setCategoryTarget = async (id: string, target: number | null) => { ok(await supabase.from('categories').update({ target_amount: target == null ? 0 : dollars(target) }).eq('id', Number(id))); };
export const setBillMode = async (id: string, mode: Bill['mode']) => { ok(await supabase.from('categories').update({ bill_mode: mode }).eq('id', Number(id))); };
/** Edits a bill. A bill is a budget category with a due date, so this updates that one row only:
 *  it never creates, changes or deletes a transaction, payment record or budget amount. */
export interface BillPatch { name: string; amount: number; date: string; recurring: boolean; period: BillPeriod; mode: Bill['mode']; groupId: string }
export const updateBill = async (id: string, p: BillPatch) => {
  const clash = ok(await supabase.from('bill_payments').select('id').eq('category_id', Number(id)).eq('due_date', p.date).limit(1)) as Row[];
  if (clash.length) throw new DbError('That due date is already recorded as paid. Choose the next unpaid date.');
  ok(await supabase.from('categories').update({
    name: p.name.trim(), target_amount: dollars(p.amount), due_date: p.date, is_repeating: p.recurring, target_period: p.period, bill_mode: p.mode, group_id: Number(p.groupId),
  }).eq('id', Number(id)));
};
export const addCategoryRow = async (c: { name: string; groupId: string; target: number | null; emoji?: string }) => {
  ok(await supabase.from('categories').insert({ name: c.name, group_id: Number(c.groupId), target_amount: c.target ? dollars(c.target) : 0, target_period: 'Monthly', emoji: c.emoji || null, entity_id: 'personal', assigned_amount: 0 }));
};
export const addAccountRow = async (a: { name: string; type: AccountType; limit?: number }): Promise<string> => {
  const r = ok(await supabase.from('accounts').insert({ name: a.name, type: DB_ACCT_TYPE[a.type], balance: 0, credit_limit: a.limit ? dollars(a.limit) : 0, entity_id: 'personal' }).select('id').single()) as Row;
  return S(r.id);
};

/** Everything, including hidden Business records, as one JSON file the user can keep. */
export async function exportEverything() {
  const raw = await fetchRaw();
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), app: 'Finance OS', ...raw }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `finance-os-export-${iso(new Date())}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
void diffDays;

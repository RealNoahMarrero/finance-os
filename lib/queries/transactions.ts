import { supabase } from '@/lib/supabase';
import type { EntityId, Transaction, TransactionPayload } from '@/lib/types';
import {
  fetchSplitsForTransactions,
  groupSplitsByTransaction,
} from '@/lib/queries/transaction-splits';

const TXN_SELECT =
  '*, categories(name, emoji), accounts!account_id(name, type), ventures(id, name)';

export async function attachSplitsToTransactions<T extends { id: number }>(
  transactions: T[]
): Promise<(T & { transaction_splits?: import('@/lib/types').TransactionSplit[] })[]> {
  if (transactions.length === 0) return transactions;
  const ids = transactions.map((t) => t.id);
  const { data: splits } = await fetchSplitsForTransactions(ids);
  const byTxn = groupSplitsByTransaction(splits || []);
  return transactions.map((t) => ({
    ...t,
    transaction_splits: byTxn.get(t.id) || [],
  }));
}

export async function fetchTransactions(entityId: EntityId, limit?: number) {
  let query = supabase
    .from('transactions')
    .select(TXN_SELECT)
    .eq('entity_id', entityId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  const txns = (data || []) as Transaction[];
  const withSplits = await attachSplitsToTransactions(txns);
  return { data: withSplits as Transaction[], error };
}

export async function fetchMonthTransactions(entityId: EntityId, startDate: string) {
  const { data, error } = await supabase
    .from('transactions')
    .select('amount, type, date, category_id, payee, venture_id')
    .eq('entity_id', entityId)
    .gte('date', startDate);
  return { data: data || [], error };
}

export async function insertTransaction(payload: TransactionPayload) {
  return supabase
    .from('transactions')
    .insert([payload])
    .select(TXN_SELECT)
    .single();
}

export async function updateTransaction(id: number, payload: Partial<TransactionPayload>) {
  return supabase
    .from('transactions')
    .update(payload)
    .eq('id', id)
    .select(TXN_SELECT)
    .single();
}

export async function deleteTransaction(id: number) {
  return supabase.from('transactions').delete().eq('id', id);
}

/** Last txn for this payee within the active entity. */
export async function fetchLastDefaultsForPayee(
  entityId: EntityId,
  payee: string,
  type?: 'Income' | 'Expense'
): Promise<{ categoryId: string; accountId: string; ventureId: string } | null> {
  if (!payee.trim()) return null;

  let query = supabase
    .from('transactions')
    .select('category_id, account_id, venture_id')
    .eq('entity_id', entityId)
    .eq('payee', payee)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);

  if (type) query = query.eq('type', type);

  const { data } = await query;
  const row = data?.[0];
  if (!row?.account_id) return null;

  return {
    categoryId: row.category_id != null ? String(row.category_id) : '',
    accountId: String(row.account_id),
    ventureId: row.venture_id != null ? String(row.venture_id) : '',
  };
}

/** @deprecated Prefer fetchLastDefaultsForPayee */
export async function fetchLastCategoryForPayee(entityId: EntityId, payee: string) {
  const defaults = await fetchLastDefaultsForPayee(entityId, payee);
  return defaults?.categoryId ? parseInt(defaults.categoryId, 10) : null;
}

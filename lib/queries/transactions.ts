import { supabase } from '@/lib/supabase';
import type { Transaction, TransactionPayload } from '@/lib/types';
import {
  fetchSplitsForTransactions,
  groupSplitsByTransaction,
} from '@/lib/queries/transaction-splits';

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

export async function fetchTransactions(limit?: number) {
  let query = supabase
    .from('transactions')
    .select('*, categories(name, emoji), accounts!account_id(name, type)')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  const txns = (data || []) as Transaction[];
  const withSplits = await attachSplitsToTransactions(txns);
  return { data: withSplits as Transaction[], error };
}

export async function fetchMonthTransactions(startDate: string) {
  const { data, error } = await supabase
    .from('transactions')
    .select('amount, type, date, category_id, payee')
    .gte('date', startDate);
  return { data: data || [], error };
}

export async function insertTransaction(payload: TransactionPayload) {
  return supabase
    .from('transactions')
    .insert([payload])
    .select('*, categories(name, emoji), accounts!account_id(name, type)')
    .single();
}

export async function updateTransaction(id: number, payload: TransactionPayload) {
  return supabase
    .from('transactions')
    .update(payload)
    .eq('id', id)
    .select('*, categories(name, emoji), accounts!account_id(name, type)')
    .single();
}

export async function deleteTransaction(id: number) {
  return supabase.from('transactions').delete().eq('id', id);
}

export async function fetchLastCategoryForPayee(payee: string) {
  const { data } = await supabase
    .from('transactions')
    .select('category_id')
    .eq('payee', payee)
    .order('date', { ascending: false })
    .limit(1);
  return data?.[0]?.category_id ?? null;
}

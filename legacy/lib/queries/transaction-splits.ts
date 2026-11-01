import { supabase } from '@/lib/supabase';
import type { TransactionSplit } from '@/lib/types';

const SPLIT_SELECT =
  'id, transaction_id, category_id, amount, sort_order, categories(name, emoji)';

export async function fetchSplitsForTransactions(transactionIds: number[]) {
  if (transactionIds.length === 0) {
    return { data: [] as TransactionSplit[], error: null };
  }
  const { data, error } = await supabase
    .from('transaction_splits')
    .select(SPLIT_SELECT)
    .in('transaction_id', transactionIds)
    .order('sort_order', { ascending: true });
  return { data: (data || []) as unknown as TransactionSplit[], error };
}

export function groupSplitsByTransaction(splits: TransactionSplit[]) {
  const map = new Map<number, TransactionSplit[]>();
  splits.forEach((s) => {
    const tid = s.transaction_id!;
    const list = map.get(tid) || [];
    list.push(s);
    map.set(tid, list);
  });
  return map;
}

export async function replaceTransactionSplits(
  transactionId: number,
  splits: { category_id: number; amount: number; sort_order?: number }[]
) {
  await supabase.from('transaction_splits').delete().eq('transaction_id', transactionId);

  if (splits.length === 0) return { error: null };

  const rows = splits.map((s, i) => ({
    transaction_id: transactionId,
    category_id: s.category_id,
    amount: s.amount,
    sort_order: s.sort_order ?? i,
  }));

  return supabase.from('transaction_splits').insert(rows);
}

export async function deleteSplitsForTransaction(transactionId: number) {
  return supabase.from('transaction_splits').delete().eq('transaction_id', transactionId);
}

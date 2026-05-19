import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { applyBalanceAdjustment } from '@/lib/balance-adjustment';
import { roundMoney } from '@/lib/money';
import { advanceProjectedExpectedDate } from '@/lib/projected-income';
import type { ProjectedIncome, ProjectedIncomePayload } from '@/lib/types';
import { insertTransaction } from '@/lib/queries/transactions';

const SELECT =
  '*, accounts!account_id(id, name, type), categories(name, emoji)';

export async function fetchPendingProjectedIncome() {
  const { data, error } = await supabase
    .from('projected_income')
    .select(SELECT)
    .eq('status', 'pending')
    .order('expected_date', { ascending: true });
  return { data: (data || []) as ProjectedIncome[], error };
}

export async function fetchProjectedIncomeForMonth(monthStart: string, monthEnd: string) {
  const { data, error } = await supabase
    .from('projected_income')
    .select(SELECT)
    .eq('status', 'pending')
    .gte('expected_date', monthStart)
    .lte('expected_date', monthEnd)
    .order('expected_date', { ascending: true });
  return { data: (data || []) as ProjectedIncome[], error };
}

export async function fetchAllProjectedIncome(limit = 100) {
  const { data, error } = await supabase
    .from('projected_income')
    .select(SELECT)
    .order('expected_date', { ascending: false })
    .limit(limit);
  return { data: (data || []) as ProjectedIncome[], error };
}

export async function insertProjectedIncome(payload: ProjectedIncomePayload) {
  return supabase.from('projected_income').insert([payload]).select(SELECT).single();
}

export async function updateProjectedIncome(
  id: number,
  payload: Partial<ProjectedIncomePayload>
) {
  return supabase
    .from('projected_income')
    .update(payload)
    .eq('id', id)
    .select(SELECT)
    .single();
}

export async function cancelProjectedIncome(id: number) {
  return supabase
    .from('projected_income')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .select(SELECT)
    .single();
}

export interface ReceiveProjectedIncomeOptions {
  amount?: number;
  date?: string;
}

export async function receiveProjectedIncome(
  projection: ProjectedIncome,
  options: ReceiveProjectedIncomeOptions = {}
) {
  const amount = roundMoney(options.amount ?? projection.amount);
  const date = options.date ?? format(new Date(), 'yyyy-MM-dd');

  const txnPayload = {
    date,
    amount,
    payee: projection.label,
    category_id: projection.category_id,
    account_id: projection.account_id,
    to_account_id: null as number | null,
    type: 'Income' as const,
    notes: projection.notes,
  };

  const { data: txn, error: txnError } = await insertTransaction(txnPayload);
  if (txnError || !txn) {
    return { data: null, error: txnError };
  }

  await applyBalanceAdjustment(
    {
      amount: txn.amount,
      type: 'Income',
      account_id: txn.account_id,
      category_id: txn.category_id,
    },
    'apply'
  );

  const { data: updated, error: updateError } = await supabase
    .from('projected_income')
    .update({
      status: 'received',
      transaction_id: txn.id,
      received_at: new Date().toISOString(),
    })
    .eq('id', projection.id)
    .select(SELECT)
    .single();

  if (updateError) {
    return { data: null, error: updateError };
  }

  if (
    projection.is_repeating &&
    projection.repeat_period &&
    projection.repeat_period !== 'None'
  ) {
    const nextPayload: ProjectedIncomePayload = {
      label: projection.label,
      amount: projection.amount,
      expected_date: advanceProjectedExpectedDate(
        projection.expected_date,
        projection.repeat_period
      ),
      account_id: projection.account_id,
      category_id: projection.category_id,
      source_type: projection.source_type,
      is_repeating: projection.is_repeating,
      repeat_period: projection.repeat_period,
      notes: projection.notes,
    };
    await insertProjectedIncome(nextPayload);
  }

  return { data: { projection: updated as ProjectedIncome, transaction: txn }, error: null };
}

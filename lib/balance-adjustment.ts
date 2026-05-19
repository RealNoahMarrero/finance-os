import { format, parseISO, addWeeks, addMonths, addYears } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { roundMoney } from '@/lib/money';
import type { TransactionType } from '@/lib/types';

export type BalanceAdjustmentMode = 'apply' | 'reverse';

export interface BalanceAdjustmentTxn {
  amount: number;
  type: TransactionType;
  account_id: number;
  to_account_id?: number | null;
  category_id?: number | null;
}

export async function applyBalanceAdjustment(
  txn: BalanceAdjustmentTxn,
  mode: BalanceAdjustmentMode
) {
  const amount = roundMoney(txn.amount);
  const accountIds = [txn.account_id, txn.to_account_id].filter(Boolean) as number[];

  const { data: accRows } = accountIds.length
    ? await supabase.from('accounts').select('*').in('id', accountIds)
    : { data: [] as { id: number; type: string; balance: number }[] };

  const accById = Object.fromEntries((accRows || []).map((a) => [a.id, a]));
  const sourceAcc = txn.account_id ? accById[txn.account_id] : null;
  const destAcc = txn.to_account_id ? accById[txn.to_account_id] : null;

  let cat: { id: number; assigned_amount: number } | null = null;
  if (txn.category_id) {
    const { data } = await supabase
      .from('categories')
      .select('id, assigned_amount')
      .eq('id', txn.category_id)
      .single();
    cat = data;
  }

  const getAdj = (isStepInflow: boolean) => {
    if (mode === 'reverse') return isStepInflow ? -amount : amount;
    return isStepInflow ? amount : -amount;
  };

  if (sourceAcc) {
    const isCC = sourceAcc.type === 'Credit Card';
    const isInflow = txn.type === 'Income';
    const adjustment = isCC
      ? isInflow
        ? -getAdj(true)
        : -getAdj(false)
      : isInflow
        ? getAdj(true)
        : getAdj(false);
    await supabase
      .from('accounts')
      .update({ balance: roundMoney(Number(sourceAcc.balance) + adjustment) })
      .eq('id', sourceAcc.id);
  }

  if (destAcc) {
    const isCC = destAcc.type === 'Credit Card';
    const adjustment = isCC ? -getAdj(true) : getAdj(true);
    await supabase
      .from('accounts')
      .update({ balance: roundMoney(Number(destAcc.balance) + adjustment) })
      .eq('id', destAcc.id);
  }

  if (cat) {
    const adjustment = txn.type === 'Income' ? getAdj(true) : getAdj(false);
    await supabase
      .from('categories')
      .update({
        assigned_amount: roundMoney(Number(cat.assigned_amount || 0) + adjustment),
      })
      .eq('id', cat.id);
  }
}

export async function applySmartBillPay(category: {
  id: number;
  is_repeating: boolean;
  is_debt: boolean;
  due_date: string | null;
  target_period: string;
  target_amount: number;
  balance: number;
}, options: { advanceCycle: boolean; deductDebt: boolean }) {
  const catPayload: Record<string, unknown> = {};
  if (options.advanceCycle && category.is_repeating && category.due_date) {
    const current = parseISO(category.due_date);
    let nextDate = current;
    if (category.target_period === 'Weekly') nextDate = addWeeks(current, 1);
    else if (category.target_period === 'Bi-Weekly') nextDate = addWeeks(current, 2);
    else if (category.target_period === 'Monthly') nextDate = addMonths(current, 1);
    else if (category.target_period === 'Yearly') nextDate = addYears(current, 1);
    catPayload.due_date = format(nextDate, 'yyyy-MM-dd');
  }

  if (options.deductDebt && category.is_debt) {
    const deduction = Number(category.target_amount || 0);
    catPayload.balance = roundMoney(
      Math.max(0, Number(category.balance || 0) - deduction)
    );
  }

  if (Object.keys(catPayload).length > 0) {
    await supabase.from('categories').update(catPayload).eq('id', category.id);
  }
}

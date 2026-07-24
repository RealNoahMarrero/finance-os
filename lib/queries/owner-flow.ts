import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { applyBalanceAdjustment } from '@/lib/balance-adjustment';
import { roundMoney } from '@/lib/money';
import type { EntityId, OwnerFlow, TransactionPayload } from '@/lib/types';
import { insertTransaction, updateTransaction } from '@/lib/queries/transactions';

export type OwnerFlowDirection = 'pay_yourself' | 'fund_business';

export async function createOwnerFlow(input: {
  direction: OwnerFlowDirection;
  amount: number;
  date: string;
  fromAccountId: number;
  toAccountId: number;
  notes?: string | null;
}) {
  const amount = roundMoney(input.amount);
  if (amount <= 0) {
    return { error: { message: 'Amount must be greater than zero.' } };
  }

  const isDraw = input.direction === 'pay_yourself';
  const ownerFlow: OwnerFlow = isDraw ? 'owner_draw' : 'owner_contribution';

  const sourceEntity: EntityId = isDraw ? 'business' : 'personal';
  const destEntity: EntityId = isDraw ? 'personal' : 'business';

  const sourcePayload: TransactionPayload = {
    date: input.date,
    amount,
    payee: isDraw ? 'Owner draw' : 'Owner contribution',
    category_id: null,
    account_id: input.fromAccountId,
    to_account_id: null,
    type: 'Expense',
    notes: input.notes ?? null,
    entity_id: sourceEntity,
    venture_id: null,
    owner_flow: ownerFlow,
  };

  const destPayload: TransactionPayload = {
    date: input.date,
    amount,
    payee: isDraw ? 'Owner draw from Marrero LLC' : 'Owner contribution to Marrero LLC',
    category_id: null,
    account_id: input.toAccountId,
    to_account_id: null,
    type: 'Income',
    notes: input.notes ?? null,
    entity_id: destEntity,
    venture_id: null,
    owner_flow: ownerFlow,
  };

  const { data: sourceTxn, error: sourceError } = await insertTransaction(sourcePayload);
  if (sourceError || !sourceTxn) {
    return { error: sourceError ?? { message: 'Failed to create source transaction.' } };
  }

  await applyBalanceAdjustment(
    {
      amount: sourceTxn.amount,
      type: 'Expense',
      account_id: sourceTxn.account_id,
      category_id: null,
    },
    'apply'
  );

  const { data: destTxn, error: destError } = await insertTransaction(destPayload);
  if (destError || !destTxn) {
    return { error: destError ?? { message: 'Failed to create destination transaction.' } };
  }

  await applyBalanceAdjustment(
    {
      amount: destTxn.amount,
      type: 'Income',
      account_id: destTxn.account_id,
      category_id: null,
    },
    'apply'
  );

  await Promise.all([
    updateTransaction(sourceTxn.id, { linked_transaction_id: destTxn.id }),
    updateTransaction(destTxn.id, { linked_transaction_id: sourceTxn.id }),
  ]);

  return {
    data: { sourceTxn, destTxn, createdAt: format(new Date(), 'yyyy-MM-dd HH:mm') },
    error: null,
  };
}

/** Fetch accounts for a specific entity (used by owner-flow modal across books). */
export async function fetchAccountsForEntity(entityId: EntityId) {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('entity_id', entityId)
    .order('type')
    .order('name');
  return { data: data || [], error };
}

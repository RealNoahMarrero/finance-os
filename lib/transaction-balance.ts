import { applyBalanceAdjustment, applySplitBalanceAdjustment } from '@/lib/balance-adjustment';
import { isSplitTransaction } from '@/lib/transaction-splits';
import type { Transaction } from '@/lib/types';

export async function applyTransactionBalances(txn: Transaction) {
  if (isSplitTransaction(txn)) {
    await applySplitBalanceAdjustment(
      {
        amount: txn.amount,
        type: txn.type,
        account_id: txn.account_id,
        to_account_id: txn.to_account_id,
      },
      (txn.transaction_splits || []).map((s) => ({
        category_id: s.category_id,
        amount: Number(s.amount),
      })),
      'apply'
    );
  } else {
    await applyBalanceAdjustment(txn, 'apply');
  }
}

export async function reverseTransactionBalances(txn: Transaction) {
  if (isSplitTransaction(txn)) {
    await applySplitBalanceAdjustment(
      {
        amount: txn.amount,
        type: txn.type,
        account_id: txn.account_id,
        to_account_id: txn.to_account_id,
      },
      (txn.transaction_splits || []).map((s) => ({
        category_id: s.category_id,
        amount: Number(s.amount),
      })),
      'reverse'
    );
  } else {
    await applyBalanceAdjustment(txn, 'reverse');
  }
}

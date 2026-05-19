'use client';

import { useCallback } from 'react';
import {
  applyBalanceAdjustment,
  type BalanceAdjustmentMode,
  type BalanceAdjustmentTxn,
} from '@/lib/balance-adjustment';

export function useBalanceAdjustment() {
  const adjust = useCallback(
    (txn: BalanceAdjustmentTxn, mode: BalanceAdjustmentMode) =>
      applyBalanceAdjustment(txn, mode),
    []
  );

  return { adjust };
}

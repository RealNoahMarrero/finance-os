import { useMemo } from 'react';
import {
  computeLiquidCash,
  computeNetWorth,
  computeReadyToAssign,
} from '@/lib/reports/aggregations';
import type { Account, Category } from '@/lib/types';

export function useReadyToAssign(accounts: Account[], categories: Category[]) {
  return useMemo(() => {
    const liquidCash = computeLiquidCash(accounts);
    const netWorth = computeNetWorth(accounts);
    const readyToAssign = computeReadyToAssign(liquidCash, categories);
    return { liquidCash, netWorth, readyToAssign };
  }, [accounts, categories]);
}

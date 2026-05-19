import { useMemo } from 'react';
import {
  computeLiquidCash,
  computeNetWorth,
  computeReadyToAssign,
} from '@/lib/reports/aggregations';
import {
  computePendingProjectedInflow,
  computeProjectedPlanning,
} from '@/lib/projected-income';
import type { Account, Category, ProjectedIncome } from '@/lib/types';

export function useReadyToAssign(
  accounts: Account[],
  categories: Category[],
  pendingProjected: ProjectedIncome[] = []
) {
  return useMemo(() => {
    const liquidCash = computeLiquidCash(accounts);
    const netWorth = computeNetWorth(accounts);
    const readyToAssign = computeReadyToAssign(liquidCash, categories);
    const pendingInflow = computePendingProjectedInflow(pendingProjected, accounts);
    const { projectedLiquid, projectedReadyToAssign } = computeProjectedPlanning(
      liquidCash,
      categories
        .filter((c) => !c.is_hidden)
        .reduce((sum, c) => sum + Number(c.assigned_amount || 0), 0),
      pendingInflow
    );
    return {
      liquidCash,
      netWorth,
      readyToAssign,
      projectedLiquid,
      projectedReadyToAssign,
      pendingInflow,
    };
  }, [accounts, categories, pendingProjected]);
}

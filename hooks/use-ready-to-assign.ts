import { useMemo } from 'react';
import {
  computeLiquidCash,
  computeNetWorth,
  computeReadyToAssign,
  computeTotalAllocated,
} from '@/lib/reports/aggregations';
import {
  computePendingInflowBreakdown,
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
    const inflow = computePendingInflowBreakdown(pendingProjected, accounts);
    const assigned = computeTotalAllocated(categories);
    const { projectedLiquid, projectedReadyToAssign } = computeProjectedPlanning(
      liquidCash,
      assigned,
      inflow.total
    );
    const { projectedReadyToAssign: conservativeProjectedRta } = computeProjectedPlanning(
      liquidCash,
      assigned,
      inflow.guaranteed
    );
    return {
      liquidCash,
      netWorth,
      readyToAssign,
      projectedLiquid,
      projectedReadyToAssign,
      conservativeProjectedRta,
      pendingInflow: inflow.total,
      guaranteedInflow: inflow.guaranteed,
      anticipatedInflow: inflow.anticipated,
    };
  }, [accounts, categories, pendingProjected]);
}

import { useMemo } from 'react';
import { snapMoney } from '@/lib/money';
import {
  computeAssignableReadyToAssign,
  computeLiquidCash,
  computeNetWorth,
  computeReadyToAssign,
  computeTotalAllocated,
  computeTotalOverspent,
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
    const totalOverspent = computeTotalOverspent(categories);
    const assignableReadyToAssign = computeAssignableReadyToAssign(liquidCash, categories);
    const inflow = computePendingInflowBreakdown(pendingProjected, accounts);
    const assigned = computeTotalAllocated(categories);
    const { projectedReadyToAssign } = computeProjectedPlanning(
      liquidCash,
      assigned,
      inflow.total
    );
    const { projectedReadyToAssign: conservativeProjectedRta } = computeProjectedPlanning(
      liquidCash,
      assigned,
      inflow.guaranteed
    );
    const projectedAssignableReadyToAssign = snapMoney(
      assignableReadyToAssign + inflow.total
    );
    const conservativeAssignableRta = snapMoney(
      assignableReadyToAssign + inflow.guaranteed
    );
    return {
      liquidCash,
      netWorth,
      readyToAssign,
      totalOverspent,
      assignableReadyToAssign,
      projectedLiquid: snapMoney(liquidCash + inflow.total),
      projectedReadyToAssign,
      conservativeProjectedRta,
      projectedAssignableReadyToAssign,
      conservativeAssignableRta,
      pendingInflow: inflow.total,
      guaranteedInflow: inflow.guaranteed,
      anticipatedInflow: inflow.anticipated,
    };
  }, [accounts, categories, pendingProjected]);
}

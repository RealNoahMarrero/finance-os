import { addMonths, addWeeks, format, max, parseISO, startOfDay } from 'date-fns';
import { snapMoney } from '@/lib/money';
import { isLiquidAccount } from '@/lib/constants/account-types';
import type {
  Account,
  ProjectedIncome,
  ProjectedIncomeRepeatPeriod,
} from '@/lib/types';

export const PROJECTED_INCOME_SOURCE_LABELS: Record<
  ProjectedIncome['source_type'],
  string
> = {
  paycheck: 'Paycheck',
  gig: 'Gig / app balance',
  invoice: 'Invoice',
  transfer_in: 'Transfer in',
  other: 'Other',
};

export function todayDateString(): string {
  return format(startOfDay(new Date()), 'yyyy-MM-dd');
}

/** Pending expected income must not stay dated before today. */
export function clampProjectedExpectedDateToToday(expectedDate: string): string {
  const today = todayDateString();
  const parsed = parseISO(expectedDate);
  if (Number.isNaN(parsed.getTime())) return today;
  return format(max([parsed, startOfDay(new Date())]), 'yyyy-MM-dd');
}

export function isProjectedExpectedDateStale(expectedDate: string): boolean {
  return expectedDate < todayDateString();
}

export function advanceProjectedExpectedDate(
  expectedDate: string,
  repeatPeriod: ProjectedIncomeRepeatPeriod
): string {
  const current = parseISO(expectedDate);
  let next = current;
  if (repeatPeriod === 'Weekly') next = addWeeks(current, 1);
  else if (repeatPeriod === 'Biweekly') next = addWeeks(current, 2);
  else if (repeatPeriod === 'Monthly') next = addMonths(current, 1);
  return clampProjectedExpectedDateToToday(format(next, 'yyyy-MM-dd'));
}

/** Sum pending projected amounts landing in liquid accounts. */
export function computePendingProjectedInflow(
  pending: ProjectedIncome[],
  accounts: Pick<Account, 'id' | 'type'>[]
): number {
  const liquidIds = new Set(
    accounts.filter((a) => isLiquidAccount(a.type)).map((a) => a.id)
  );
  const total = pending
    .filter((p) => liquidIds.has(p.account_id))
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  return snapMoney(total);
}

export function computeProjectedPlanning(
  liquidCash: number,
  totalAssigned: number,
  pendingInflow: number
) {
  const projectedLiquid = snapMoney(liquidCash + pendingInflow);
  const projectedReadyToAssign = snapMoney(projectedLiquid - totalAssigned);
  return { projectedLiquid, projectedReadyToAssign, pendingInflow };
}

export function sortPendingByDate(pending: ProjectedIncome[]) {
  return [...pending].sort(
    (a, b) =>
      new Date(a.expected_date).getTime() - new Date(b.expected_date).getTime()
  );
}

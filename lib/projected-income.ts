import { addMonths, addWeeks, format, max, parseISO, startOfDay } from 'date-fns';
import { snapMoney } from '@/lib/money';
import { isLiquidAccount } from '@/lib/constants/account-types';
import type {
  Account,
  ProjectedIncome,
  ProjectedIncomeCertainty,
  ProjectedIncomeRepeatPeriod,
  ProjectedIncomeSourceType,
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

export const PROJECTED_INCOME_CERTAINTY_LABELS: Record<
  ProjectedIncomeCertainty,
  string
> = {
  guaranteed: 'Guaranteed',
  anticipated: 'Anticipated',
};

export function defaultCertaintyForSourceType(
  sourceType: ProjectedIncomeSourceType
): ProjectedIncomeCertainty {
  if (sourceType === 'invoice' || sourceType === 'other') return 'anticipated';
  return 'guaranteed';
}

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

export interface PendingInflowBreakdown {
  guaranteed: number;
  anticipated: number;
  total: number;
}

function pendingOnLiquidAccounts(
  pending: ProjectedIncome[],
  accounts: Pick<Account, 'id' | 'type'>[]
) {
  const liquidIds = new Set(
    accounts.filter((a) => isLiquidAccount(a.type)).map((a) => a.id)
  );
  return pending.filter((p) => liquidIds.has(p.account_id));
}

/** Sum pending projected amounts landing in liquid accounts. */
export function computePendingProjectedInflow(
  pending: ProjectedIncome[],
  accounts: Pick<Account, 'id' | 'type'>[]
): number {
  return computePendingInflowBreakdown(pending, accounts).total;
}

export function computePendingInflowBreakdown(
  pending: ProjectedIncome[],
  accounts: Pick<Account, 'id' | 'type'>[]
): PendingInflowBreakdown {
  const rows = pendingOnLiquidAccounts(pending, accounts);
  let guaranteed = 0;
  let anticipated = 0;
  rows.forEach((p) => {
    const amt = Number(p.amount || 0);
    const tier = p.certainty === 'anticipated' ? 'anticipated' : 'guaranteed';
    if (tier === 'anticipated') anticipated += amt;
    else guaranteed += amt;
  });
  guaranteed = snapMoney(guaranteed);
  anticipated = snapMoney(anticipated);
  return { guaranteed, anticipated, total: snapMoney(guaranteed + anticipated) };
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

export function projectedIncomeChipClass(
  certainty?: ProjectedIncomeCertainty | null
): string {
  if (certainty === 'anticipated') {
    return 'bg-amber-500/15 border-amber-500/40 text-amber-900 dark:text-amber-200 border-dashed';
  }
  return 'bg-emerald-500/15 border-emerald-500/40 text-emerald-800 dark:text-emerald-200';
}

export function sortPendingByDate(pending: ProjectedIncome[]) {
  return [...pending].sort(
    (a, b) =>
      new Date(a.expected_date).getTime() - new Date(b.expected_date).getTime()
  );
}

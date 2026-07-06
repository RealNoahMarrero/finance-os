import { format, isBefore, parseISO, startOfDay } from 'date-fns';
import { snapMoney } from '@/lib/money';
import {
  creditCardsDueOnDay,
  getCreditCardPaymentFundingStatus,
} from '@/lib/credit-cards';
import {
  computePendingInflowBreakdown,
  computeProjectedPlanning,
} from '@/lib/projected-income';
import {
  computeAssignableReadyToAssign,
  computeLiquidCash,
  computeReadyToAssign,
  computeTotalAllocated,
  computeTotalOverspent,
} from '@/lib/reports/aggregations';
import { displayReadyToAssign } from '@/components/budget/rta-banner-extras';
import type { Account, Category, ProjectedIncome } from '@/lib/types';

type BillCategory = Pick<
  Category,
  | 'id'
  | 'name'
  | 'emoji'
  | 'due_date'
  | 'target_amount'
  | 'assigned_amount'
  | 'is_asap'
>;

export function billsDueOnDay(categories: BillCategory[], dayIso: string) {
  return categories.filter((c) => c.due_date === dayIso);
}

export function incomeDueOnDay(projected: ProjectedIncome[], dayIso: string) {
  return projected.filter((p) => p.expected_date === dayIso);
}

/** Pending projected income expected on or before the selected day. */
export function pendingIncomeThroughDay(
  pending: ProjectedIncome[],
  dayIso: string
) {
  return pending.filter(
    (p) => p.status === 'pending' && p.expected_date <= dayIso
  );
}

export function billCalendarChipClass(
  bill: BillCategory,
  today: Date
): string {
  const isPastDue =
    bill.due_date && isBefore(parseISO(bill.due_date), startOfDay(today));
  const isFullyFunded =
    Number(bill.assigned_amount) >= Number(bill.target_amount);

  if (bill.is_asap || (isPastDue && !isFullyFunded)) {
    return 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300 shadow-sm';
  }
  if (isFullyFunded && Number(bill.target_amount) > 0) {
    return 'bg-gradient-to-br from-yellow-400 to-amber-500 text-white border-amber-500 shadow-sm';
  }
  return 'bg-[var(--surface-subtle)] border-[var(--border)] text-[var(--text-muted)]';
}

export interface DayPosition {
  liquidCash: number;
  projectedLiquid: number;
  conservativeProjectedLiquid: number;
  readyToAssign: number;
  assignableReadyToAssign: number;
  totalOverspent: number;
  projectedReadyToAssign: number;
  conservativeProjectedRta: number;
  projectedAssignable: number;
  conservativeAssignable: number;
  displayProjectedRta: number;
  displayConservativeRta: number;
  guaranteedInflow: number;
  anticipatedInflow: number;
  totalInflowThroughDay: number;
}

export interface DaySnapshot {
  dayIso: string;
  bills: BillCategory[];
  income: ProjectedIncome[];
  creditCards: Account[];
  inflowTotal: number;
  guaranteedInflow: number;
  anticipatedInflow: number;
  outflowTotal: number;
  billOutflow: number;
  ccOutflow: number;
  billFunded: number;
  ccFundedCount: number;
  netForDay: number;
  showProjection: boolean;
  position: DayPosition | null;
}

export function computeDayPosition(
  accounts: Account[],
  categories: Category[],
  pendingThroughDay: ProjectedIncome[]
): DayPosition {
  const liquidCash = computeLiquidCash(accounts);
  const assigned = computeTotalAllocated(categories);
  const readyToAssign = computeReadyToAssign(liquidCash, categories);
  const assignableReadyToAssign = computeAssignableReadyToAssign(
    liquidCash,
    categories
  );
  const totalOverspent = computeTotalOverspent(categories);
  const inflow = computePendingInflowBreakdown(pendingThroughDay, accounts);
  const { projectedLiquid, projectedReadyToAssign } = computeProjectedPlanning(
    liquidCash,
    assigned,
    inflow.total
  );
  const { projectedLiquid: conservativeProjectedLiquid, projectedReadyToAssign: conservativeProjectedRta } =
    computeProjectedPlanning(liquidCash, assigned, inflow.guaranteed);
  const projectedAssignable = snapMoney(
    assignableReadyToAssign + inflow.total
  );
  const conservativeAssignable = snapMoney(
    assignableReadyToAssign + inflow.guaranteed
  );

  return {
    liquidCash,
    projectedLiquid,
    conservativeProjectedLiquid,
    readyToAssign,
    assignableReadyToAssign,
    totalOverspent,
    projectedReadyToAssign,
    conservativeProjectedRta,
    projectedAssignable,
    conservativeAssignable,
    displayProjectedRta: displayReadyToAssign(
      projectedReadyToAssign,
      projectedAssignable,
      totalOverspent
    ),
    displayConservativeRta: displayReadyToAssign(
      conservativeProjectedRta,
      conservativeAssignable,
      totalOverspent
    ),
    guaranteedInflow: inflow.guaranteed,
    anticipatedInflow: inflow.anticipated,
    totalInflowThroughDay: inflow.total,
  };
}

export function computeDaySnapshot(
  day: Date,
  today: Date,
  categories: BillCategory[],
  monthIncome: ProjectedIncome[],
  allPendingIncome: ProjectedIncome[],
  accounts: Account[],
  allCategories: Category[],
  categoryOptions: Pick<Category, 'id' | 'assigned_amount'>[]
): DaySnapshot {
  const dayIso = format(day, 'yyyy-MM-dd');
  const bills = billsDueOnDay(categories, dayIso);
  const income = incomeDueOnDay(monthIncome, dayIso);
  const creditCards = creditCardsDueOnDay(accounts, dayIso);

  const guaranteedInflow = snapMoney(
    income
      .filter((p) => (p.certainty ?? 'guaranteed') !== 'anticipated')
      .reduce((sum, p) => sum + Number(p.amount), 0)
  );
  const anticipatedInflow = snapMoney(
    income
      .filter((p) => p.certainty === 'anticipated')
      .reduce((sum, p) => sum + Number(p.amount), 0)
  );
  const inflowTotal = snapMoney(guaranteedInflow + anticipatedInflow);

  const billOutflow = snapMoney(
    bills.reduce((sum, b) => sum + Number(b.target_amount), 0)
  );
  const ccOutflow = snapMoney(
    creditCards.reduce((sum, c) => sum + (Number(c.minimum_payment) || 0), 0)
  );
  const outflowTotal = snapMoney(billOutflow + ccOutflow);

  const billFunded = snapMoney(
    bills.reduce((sum, b) => sum + Number(b.assigned_amount), 0)
  );
  const ccFundedCount = creditCards.filter(
    (c) => getCreditCardPaymentFundingStatus(c, categoryOptions) === 'funded'
  ).length;

  const showProjection = !isBefore(startOfDay(day), startOfDay(today));
  const position = showProjection
    ? computeDayPosition(
        accounts,
        allCategories,
        pendingIncomeThroughDay(allPendingIncome, dayIso)
      )
    : null;

  return {
    dayIso,
    bills,
    income,
    creditCards,
    inflowTotal,
    guaranteedInflow,
    anticipatedInflow,
    outflowTotal,
    billOutflow,
    ccOutflow,
    billFunded,
    ccFundedCount,
    netForDay: snapMoney(inflowTotal - outflowTotal),
    showProjection,
    position,
  };
}

import type { Category } from '@/lib/types';

export type PayoffStrategy = 'snowball' | 'avalanche';

export interface DebtSimulationInput {
  id: number;
  name: string;
  emoji: string | null;
  balance: number;
  target_amount: number;
}

export interface DebtSimulationResult extends DebtSimulationInput {
  currentBalance: number;
  minPayment: number;
  payoffMonth: number;
}

export function simulateDebtPayoff(
  debts: DebtSimulationInput[],
  totalMonthlyPower: number,
  strategy: PayoffStrategy,
  maxMonths = 1200
): DebtSimulationResult[] {
  const simulation: DebtSimulationResult[] = debts.map((d) => ({
    ...d,
    currentBalance: Number(d.balance),
    minPayment: Number(d.target_amount) || 0,
    payoffMonth: -1,
  }));

  if (totalMonthlyPower <= 0) return simulation;

  let monthsPassed = 0;
  let activeDebts = simulation.length;

  while (activeDebts > 0 && monthsPassed < maxMonths) {
    monthsPassed++;
    let remaining = simulation.filter((d) => d.currentBalance > 0);

    if (strategy === 'snowball') {
      remaining.sort((a, b) => a.currentBalance - b.currentBalance);
    } else {
      remaining.sort((a, b) => b.currentBalance - a.currentBalance);
    }

    let availablePower = totalMonthlyPower;

    remaining.forEach((d) => {
      if (availablePower <= 0) return;
      const payment = Math.min(d.minPayment, d.currentBalance, availablePower);
      d.currentBalance -= payment;
      availablePower -= payment;
      if (d.currentBalance <= 0 && d.payoffMonth === -1) {
        d.payoffMonth = monthsPassed;
      }
    });

    const priorityRemaining = remaining.filter((d) => d.currentBalance > 0);
    for (let i = 0; i < priorityRemaining.length; i++) {
      if (availablePower <= 0) break;
      const targetDebt = priorityRemaining[i];
      const payment = Math.min(targetDebt.currentBalance, availablePower);
      targetDebt.currentBalance -= payment;
      availablePower -= payment;
      if (targetDebt.currentBalance <= 0 && targetDebt.payoffMonth === -1) {
        targetDebt.payoffMonth = monthsPassed;
      }
    }

    activeDebts = simulation.filter((d) => d.currentBalance > 0).length;
  }

  return simulation.sort((a, b) => {
    if (a.payoffMonth === -1) return 1;
    if (b.payoffMonth === -1) return -1;
    return a.payoffMonth - b.payoffMonth;
  });
}

export function categoriesToDebtInput(categories: Category[]): DebtSimulationInput[] {
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    emoji: c.emoji,
    balance: Number(c.balance),
    target_amount: Number(c.target_amount),
  }));
}

import { MONEY_EPSILON, roundMoney, snapMoney } from '@/lib/money';
import type { TransactionSplit } from '@/lib/types';

export type SplitFormLine = { category_id: string; amount: string };

export function emptySplitLine(): SplitFormLine {
  return { category_id: '', amount: '' };
}

export function sumSplitAmounts(lines: { amount: string | number }[]): number {
  return snapMoney(
    lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
  );
}

export function splitsMatchTotal(
  total: number | string,
  lines: { amount: string | number }[]
): boolean {
  const t = roundMoney(parseFloat(String(total)) || 0);
  const s = sumSplitAmounts(lines);
  return Math.abs(t - s) < MONEY_EPSILON;
}

export function parseSplitLines(
  lines: SplitFormLine[]
): { category_id: number; amount: number; sort_order: number }[] {
  return lines
    .filter((l) => l.category_id && Number(l.amount) > 0)
    .map((l, i) => ({
      category_id: Number(l.category_id),
      amount: roundMoney(parseFloat(l.amount) || 0),
      sort_order: i,
    }));
}

export function isSplitTransaction(txn: {
  category_id: number | null;
  transaction_splits?: TransactionSplit[];
}): boolean {
  return (txn.transaction_splits?.length ?? 0) > 0;
}

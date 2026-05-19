/** Cent-safe rounding and display helpers for currency. */

export const MONEY_EPSILON = 0.01;

export function roundMoney(value: number | string | null | undefined): number {
  const n = Number(value) || 0;
  return Math.round(n * 100) / 100;
}

export function snapMoney(value: number | string | null | undefined): number {
  const rounded = roundMoney(value);
  return Math.abs(rounded) < MONEY_EPSILON ? 0 : rounded;
}

const moneyFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(value: number | string | null | undefined): string {
  return moneyFormatter.format(snapMoney(value));
}

export function formatCurrency(value: number | string | null | undefined): string {
  const n = snapMoney(value);
  const abs = moneyFormatter.format(Math.abs(n));
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

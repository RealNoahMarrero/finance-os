export const LIQUID_ACCOUNT_TYPES = ['Checking', 'Savings', 'Cash'] as const;

export function isLiquidAccount(type: string) {
  return (LIQUID_ACCOUNT_TYPES as readonly string[]).includes(type);
}

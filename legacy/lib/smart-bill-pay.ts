/** Category fields used to decide Smart Bill Pay UI and actions. */
export type SmartBillPayCategory = {
  is_repeating?: boolean;
  is_debt?: boolean;
  due_date?: string | null;
  target_period?: string;
};

/** Advance due date applies only to scheduled bills/subscriptions (calendar due dates). */
export function categorySupportsAdvanceDueDate(
  category: SmartBillPayCategory | null | undefined
): boolean {
  if (!category) return false;
  return Boolean(
    category.due_date &&
      category.is_repeating &&
      category.target_period &&
      category.target_period !== 'None'
  );
}

/** Smart Bill Pay panel: debt payments and/or scheduled bill cycles — not everyday envelopes. */
export function categorySupportsSmartBillPay(
  category: SmartBillPayCategory | null | undefined
): boolean {
  if (!category) return false;
  return Boolean(category.is_debt || categorySupportsAdvanceDueDate(category));
}

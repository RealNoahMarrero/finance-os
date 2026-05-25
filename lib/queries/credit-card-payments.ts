import { supabase } from '@/lib/supabase';
import {
  advanceNextPaymentDueDate,
  computeInitialNextPaymentDueDate,
} from '@/lib/credit-cards';
import type { Account } from '@/lib/types';

/** Set next_payment_due_date from payment_due_day when missing (existing cards). */
export async function backfillAccountPaymentDueDates(
  accounts: Account[]
): Promise<Account[]> {
  const needsBackfill = accounts.filter(
    (a) =>
      a.type === 'Credit Card' &&
      a.payment_due_day != null &&
      a.payment_due_day >= 1 &&
      !a.next_payment_due_date
  );

  if (needsBackfill.length === 0) return accounts;

  await Promise.all(
    needsBackfill.map((a) => {
      const next = computeInitialNextPaymentDueDate(a.payment_due_day!);
      return supabase
        .from('accounts')
        .update({ next_payment_due_date: next })
        .eq('id', a.id);
    })
  );

  return accounts.map((a) => {
    const hit = needsBackfill.find((n) => n.id === a.id);
    if (!hit) return a;
    return {
      ...a,
      next_payment_due_date: computeInitialNextPaymentDueDate(hit.payment_due_day!),
    };
  });
}

export async function advanceCreditCardPaymentCycle(account: Account) {
  if (account.type !== 'Credit Card' || !account.payment_due_day) {
    return { data: null, error: new Error('Credit card payment schedule not configured') };
  }

  const current =
    account.next_payment_due_date ??
    computeInitialNextPaymentDueDate(account.payment_due_day);
  const next = advanceNextPaymentDueDate(current, account.payment_due_day);

  const { data, error } = await supabase
    .from('accounts')
    .update({ next_payment_due_date: next })
    .eq('id', account.id)
    .select('*')
    .single();

  return { data: (data || null) as Account | null, error };
}

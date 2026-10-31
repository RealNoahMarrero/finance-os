-- Remove account-level credit card payment cycle.
-- Due dates and funding live on budget categories (bills / debt) instead.

alter table accounts
  drop column if exists minimum_payment,
  drop column if exists payment_due_day,
  drop column if exists next_payment_due_date,
  drop column if exists payment_category_id;

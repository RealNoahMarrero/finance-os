-- Credit card minimum payment and statement due day (1–31)
alter table accounts
  add column if not exists minimum_payment numeric(12, 2) not null default 0,
  add column if not exists payment_due_day smallint;

alter table accounts
  drop constraint if exists accounts_payment_due_day_check;

alter table accounts
  add constraint accounts_payment_due_day_check
  check (payment_due_day is null or (payment_due_day >= 1 and payment_due_day <= 31));

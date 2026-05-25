-- Active due date for calendar (advances when marked paid) + optional budget envelope
alter table accounts
  add column if not exists next_payment_due_date date,
  add column if not exists payment_category_id bigint references categories(id) on delete set null;

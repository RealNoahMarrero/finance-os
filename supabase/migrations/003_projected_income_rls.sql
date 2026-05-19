-- Run if inserts/selects on projected_income fail after creating the table.
-- Supabase often enables RLS on new tables without policies (blocks the anon key).

alter table projected_income enable row level security;

drop policy if exists "projected_income_all" on projected_income;
create policy "projected_income_all"
  on projected_income
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- Same for transaction_splits if split saves fail
alter table transaction_splits enable row level security;

drop policy if exists "transaction_splits_all" on transaction_splits;
create policy "transaction_splits_all"
  on transaction_splits
  for all
  to anon, authenticated
  using (true)
  with check (true);

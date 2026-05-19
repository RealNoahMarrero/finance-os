-- Run in Supabase SQL editor if not using migration tooling
create table if not exists projected_income (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  label text not null,
  amount numeric(12,2) not null check (amount > 0),
  expected_date date not null,
  account_id bigint not null references accounts(id),
  category_id bigint references categories(id),
  status text not null default 'pending'
    check (status in ('pending', 'received', 'cancelled')),
  source_type text default 'other'
    check (source_type in ('paycheck', 'gig', 'invoice', 'transfer_in', 'other')),
  is_repeating boolean default false,
  repeat_period text default 'None'
    check (repeat_period in ('None', 'Weekly', 'Biweekly', 'Monthly')),
  notes text,
  transaction_id bigint references transactions(id),
  received_at timestamptz
);

create index if not exists projected_income_status_date_idx
  on projected_income (status, expected_date);

create index if not exists projected_income_expected_date_idx
  on projected_income (expected_date);

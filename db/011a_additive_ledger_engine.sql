-- 011a: ADDITIVE half. Safe to apply while the old app is still live (it does not touch the legacy tables).
-- Private access + atomic ledger engine + cutover/reconciliation + bill & income confirmation.
-- Additive and non-destructive: no rows are deleted or rewritten. Existing columns keep their meaning:
--   accounts.balance        = current recorded balance (credit cards: amount owed)
--   categories.assigned_amount = envelope Available (budgeted minus activity)
-- Everything below is idempotent (safe to re-run).

-- ── 1. Owner allow-list ────────────────────────────────────────────────────────
create table if not exists public.app_owner (
  user_id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);
alter table public.app_owner enable row level security;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_owner where user_id = auth.uid());
$$;
revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated;

-- ── 2. New tables ─────────────────────────────────────────────────────────────
alter table public.transactions
  add column if not exists client_request_id uuid,
  add column if not exists is_adjustment boolean not null default false;
create unique index if not exists transactions_client_request_id_key
  on public.transactions (client_request_id) where client_request_id is not null;

alter table public.categories
  add column if not exists bill_mode text not null default 'reminder';
do $$ begin
  alter table public.categories add constraint categories_bill_mode_check check (bill_mode in ('reminder','prepare'));
exception when duplicate_object then null; end $$;

create table if not exists public.account_baselines (
  id bigint generated always as identity primary key,
  account_id bigint not null references public.accounts(id),
  cutover_date date not null,
  opening_balance numeric(14,2) not null,
  note text,
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists account_baselines_active_key
  on public.account_baselines (account_id) where superseded_at is null;

create table if not exists public.account_reconciliations (
  id bigint generated always as identity primary key,
  account_id bigint not null references public.accounts(id),
  reconciled_on date not null,
  recorded_balance numeric(14,2) not null,
  actual_balance numeric(14,2) not null,
  difference numeric(14,2) not null,
  adjustment_transaction_id bigint references public.transactions(id),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.bill_payments (
  id bigint generated always as identity primary key,
  category_id bigint not null references public.categories(id),
  due_date date not null,
  paid_on date not null,
  amount numeric(14,2) not null check (amount >= 0),
  transaction_id bigint references public.transactions(id),
  mode text not null check (mode in ('reminder','prepare')),
  created_at timestamptz not null default now(),
  unique (category_id, due_date)
);

create table if not exists public.expected_income_skips (
  id bigint generated always as identity primary key,
  projected_income_id bigint not null references public.projected_income(id),
  occurrence_date date not null,
  created_at timestamptz not null default now(),
  unique (projected_income_id, occurrence_date)
);

-- ── 3. Row-level security on the NEW tables only (legacy tables untouched until 011b) ──
do $$
declare t text; p record;
begin
  foreach t in array array['account_baselines','account_reconciliations','bill_payments','expected_income_skips'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy owner_all on public.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ── 4. Ledger helpers ─────────────────────────────────────────────────────────
create or replace function public.fos_acct_delta(acct_type text, txn_type text, is_dest boolean, amt numeric)
returns numeric language sql immutable as $$
  select case when acct_type = 'Credit Card' then -1 else 1 end *
         case when is_dest then amt
              when txn_type = 'Income' then amt
              else -amt end;
$$;

-- sign = +1 apply, -1 reverse.  Locks accounts/categories in id order to avoid deadlocks.
create or replace function public.fos_apply_effect(t public.transactions, sign int, line_splits jsonb)
returns void language plpgsql set search_path = public as $$
declare a record; s jsonb; cat_adj numeric;
begin
  perform fos_check_owner();
  if t.is_adjustment is true then
    perform 1 from accounts where id = t.account_id for update;
  else
    perform 1 from accounts where id in (t.account_id, coalesce(t.to_account_id, t.account_id)) order by id for update;
  end if;
  update accounts set balance = round(balance + sign * fos_acct_delta(type, t.type, false, t.amount), 2) where id = t.account_id;
  if t.to_account_id is not null and t.type = 'Transfer' then
    update accounts set balance = round(balance + sign * fos_acct_delta(type, t.type, true, t.amount), 2) where id = t.to_account_id;
  end if;
  if t.is_adjustment is true then return; end if;
  cat_adj := case when t.type = 'Income' then 1 else -1 end * sign;
  if line_splits is not null and jsonb_array_length(line_splits) > 0 then
    for s in select * from jsonb_array_elements(line_splits) loop
      update categories set assigned_amount = round(assigned_amount + cat_adj * (s->>'amount')::numeric, 2) where id = (s->>'category_id')::bigint;
    end loop;
  elsif t.category_id is not null then
    update categories set assigned_amount = round(assigned_amount + cat_adj * t.amount, 2) where id = t.category_id;
  end if;
end $$;

create or replace function public.fos_check_owner() returns void language plpgsql as $$
begin if not public.is_owner() then raise exception 'not authorized' using errcode = '42501'; end if; end $$;

create or replace function public.fos_validate_txn(p jsonb) returns void language plpgsql set search_path = public as $$
declare amt numeric := (p->>'amount')::numeric; sp numeric; ty text := p->>'type';
begin
  if ty not in ('Income','Expense','Transfer') then raise exception 'invalid type'; end if;
  if amt is null or amt <= 0 then raise exception 'amount must be positive'; end if;
  if (p->>'account_id') is null or not exists (select 1 from accounts where id = (p->>'account_id')::bigint) then raise exception 'account not found'; end if;
  if ty = 'Transfer' then
    if (p->>'to_account_id') is null or (p->>'to_account_id') = (p->>'account_id') then raise exception 'transfer needs two different accounts'; end if;
    if not exists (select 1 from accounts where id = (p->>'to_account_id')::bigint) then raise exception 'destination account not found'; end if;
  end if;
  if p ? 'splits' and jsonb_typeof(p->'splits') = 'array' and jsonb_array_length(p->'splits') > 0 then
    if ty = 'Transfer' then raise exception 'transfers cannot be split'; end if;
    select coalesce(sum((x->>'amount')::numeric),0) into sp from jsonb_array_elements(p->'splits') x;
    if round(sp,2) <> round(amt,2) then raise exception 'split lines (%) must add up to the amount (%)', sp, amt; end if;
  end if;
end $$;

create or replace function public.fos_create_transaction(p jsonb) returns bigint
language plpgsql set search_path = public as $$
declare t public.transactions; sp jsonb := coalesce(p->'splits','[]'::jsonb); rid uuid := nullif(p->>'client_request_id','')::uuid; x jsonb; i int := 0;
begin
  perform fos_check_owner();
  if rid is not null then select * into t from transactions where client_request_id = rid; if found then return t.id; end if; end if;
  perform fos_validate_txn(p);
  insert into transactions (date, amount, payee, category_id, account_id, to_account_id, type, notes, entity_id, venture_id, linked_transaction_id, owner_flow, client_request_id, is_adjustment)
  values ((p->>'date')::date, round((p->>'amount')::numeric,2), nullif(p->>'payee',''),
    case when jsonb_array_length(sp) > 0 then null else nullif(p->>'category_id','')::bigint end,
    (p->>'account_id')::bigint, nullif(p->>'to_account_id','')::bigint, p->>'type', nullif(p->>'notes',''),
    coalesce(p->>'entity_id','personal'), nullif(p->>'venture_id','')::bigint, nullif(p->>'linked_transaction_id','')::bigint,
    nullif(p->>'owner_flow',''), rid, coalesce((p->>'is_adjustment')::boolean,false))
  returning * into t;
  for x in select * from jsonb_array_elements(sp) loop
    i := i + 1; insert into transaction_splits (transaction_id, category_id, amount, sort_order) values (t.id, (x->>'category_id')::bigint, (x->>'amount')::numeric, i);
  end loop;
  perform fos_apply_effect(t, 1, sp);
  return t.id;
end $$;

create or replace function public.fos_update_transaction(tid bigint, p jsonb) returns bigint
language plpgsql set search_path = public as $$
declare old public.transactions; oldsp jsonb; sp jsonb := coalesce(p->'splits','[]'::jsonb); t public.transactions; x jsonb; i int := 0;
begin
  perform fos_check_owner();
  select * into old from transactions where id = tid for update;
  if not found then raise exception 'transaction not found'; end if;
  if old.is_adjustment then raise exception 'reconciliation adjustments cannot be edited'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('category_id', category_id, 'amount', amount)), '[]') into oldsp from transaction_splits where transaction_id = tid;
  perform fos_validate_txn(p);
  perform fos_apply_effect(old, -1, oldsp);
  delete from transaction_splits where transaction_id = tid;
  update transactions set date = (p->>'date')::date, amount = round((p->>'amount')::numeric,2), payee = nullif(p->>'payee',''),
    category_id = case when jsonb_array_length(sp) > 0 then null else nullif(p->>'category_id','')::bigint end,
    account_id = (p->>'account_id')::bigint, to_account_id = nullif(p->>'to_account_id','')::bigint, type = p->>'type', notes = nullif(p->>'notes',''),
    venture_id = nullif(p->>'venture_id','')::bigint
  where id = tid returning * into t;
  for x in select * from jsonb_array_elements(sp) loop
    i := i + 1; insert into transaction_splits (transaction_id, category_id, amount, sort_order) values (tid, (x->>'category_id')::bigint, (x->>'amount')::numeric, i);
  end loop;
  perform fos_apply_effect(t, 1, sp);
  return tid;
end $$;

-- Deleting returns the removed row (as JSON) so the UI can offer Undo by re-creating it.
create or replace function public.fos_delete_transaction(tid bigint) returns jsonb
language plpgsql set search_path = public as $$
declare old public.transactions; oldsp jsonb; res jsonb;
begin
  perform fos_check_owner();
  select * into old from transactions where id = tid for update;
  if not found then raise exception 'transaction not found'; end if;
  if old.is_adjustment then raise exception 'reconciliation adjustments cannot be deleted'; end if;
  if exists (select 1 from bill_payments where transaction_id = tid) or exists (select 1 from projected_income where transaction_id = tid and status = 'received') then
    raise exception 'this transaction confirms a bill payment or received income; undo that first';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('category_id', category_id, 'amount', amount)), '[]') into oldsp from transaction_splits where transaction_id = tid;
  perform fos_apply_effect(old, -1, oldsp);
  delete from transaction_splits where transaction_id = tid;
  delete from transactions where id = tid;
  res := to_jsonb(old) || jsonb_build_object('splits', oldsp);
  return res;
end $$;

-- ── 5. Budget: assign / move (atomic, positive amounts only) ──────────────────
create or replace function public.fos_assign(assignments jsonb) returns void
language plpgsql set search_path = public as $$
declare x jsonb;
begin
  perform fos_check_owner();
  for x in select * from jsonb_array_elements(assignments) order by (value->>'category_id')::bigint loop
    if (x->>'amount')::numeric = 0 then continue; end if;
    update categories set assigned_amount = round(assigned_amount + (x->>'amount')::numeric, 2), budgeted_amount = round(coalesce(budgeted_amount,0) + (x->>'amount')::numeric, 2)
      where id = (x->>'category_id')::bigint;
    if not found then raise exception 'category not found'; end if;
  end loop;
end $$;

create or replace function public.fos_move_money(from_id bigint, to_id bigint, amt numeric) returns void
language plpgsql set search_path = public as $$
begin
  perform fos_check_owner();
  if amt is null or amt <= 0 then raise exception 'amount must be positive'; end if;
  if from_id = to_id then raise exception 'choose two different categories'; end if;
  perform 1 from categories where id in (from_id, to_id) order by id for update;
  update categories set assigned_amount = round(assigned_amount - amt, 2) where id = from_id;
  update categories set assigned_amount = round(assigned_amount + amt, 2) where id = to_id;
end $$;

-- ── 6. Opening balances (cutover) ─────────────────────────────────────────────
-- A transaction counts toward the derived balance when its date is AFTER the cutover date.
create or replace function public.fos_derived_balance(acct bigint) returns numeric
language plpgsql stable set search_path = public as $$
declare b public.account_baselines; ty text; d numeric;
begin
  select * into b from account_baselines where account_id = acct and superseded_at is null;
  if not found then return null; end if;
  select type into ty from accounts where id = acct;
  select coalesce(sum(
      case when t.account_id = acct then fos_acct_delta(ty, t.type, false, t.amount) else 0 end
    + case when t.to_account_id = acct and t.type = 'Transfer' then fos_acct_delta(ty, t.type, true, t.amount) else 0 end), 0)
    into d from transactions t where (t.account_id = acct or t.to_account_id = acct) and t.date > b.cutover_date;
  return round(b.opening_balance + d, 2);
end $$;

create or replace function public.fos_set_cutover(acct bigint, cutover date, opening numeric, note text default null) returns numeric
language plpgsql set search_path = public as $$
declare nb numeric;
begin
  perform fos_check_owner();
  perform 1 from accounts where id = acct for update;
  if not found then raise exception 'account not found'; end if;
  update account_baselines set superseded_at = now() where account_id = acct and superseded_at is null;
  insert into account_baselines (account_id, cutover_date, opening_balance, note) values (acct, cutover, round(opening,2), note);
  nb := fos_derived_balance(acct);
  update accounts set balance = nb where id = acct;
  return nb;
end $$;

create or replace view public.account_balance_audit with (security_invoker = true) as
  select a.id as account_id, a.name, a.type, a.entity_id, a.balance as recorded_balance, public.fos_derived_balance(a.id) as derived_balance,
         b.cutover_date, b.opening_balance,
         (select max(reconciled_on) from account_reconciliations r where r.account_id = a.id) as last_reconciled_on
  from public.accounts a left join public.account_baselines b on b.account_id = a.id and b.superseded_at is null;

-- ── 7. Reconciliation ─────────────────────────────────────────────────────────
create or replace function public.fos_reconcile(acct bigint, actual numeric, on_date date, request_id uuid default null, note text default null) returns jsonb
language plpgsql set search_path = public as $$
declare a public.accounts; diff numeric; tid bigint; rid bigint; ty text;
begin
  perform fos_check_owner();
  select * into a from accounts where id = acct for update;
  if not found then raise exception 'account not found'; end if;
  diff := round(actual - a.balance, 2);
  if diff <> 0 then
    -- positive diff means "more money than recorded" (for cards: more owed)
    ty := case when (diff > 0) = (a.type <> 'Credit Card') then 'Income' else 'Expense' end;
    tid := fos_create_transaction(jsonb_build_object('date', on_date, 'amount', abs(diff), 'payee', 'Reconciliation adjustment', 'type', ty,
      'account_id', acct, 'entity_id', a.entity_id, 'notes', coalesce(note,'Balance reconciled to actual'), 'is_adjustment', true, 'client_request_id', request_id));
  end if;
  insert into account_reconciliations (account_id, reconciled_on, recorded_balance, actual_balance, difference, adjustment_transaction_id, note)
    values (acct, on_date, a.balance, round(actual,2), diff, tid, note) returning id into rid;
  return jsonb_build_object('reconciliation_id', rid, 'difference', diff, 'adjustment_transaction_id', tid);
end $$;

-- ── 8. Bills: confirm payment (never silent) ──────────────────────────────────
create or replace function public.fos_pay_bill(cat bigint, due date, paid_on date, mode text, txn jsonb default null, advance boolean default true) returns jsonb
language plpgsql set search_path = public as $$
declare c public.categories; tid bigint; paid_amt numeric; nxt date;
begin
  perform fos_check_owner();
  select * into c from categories where id = cat for update;
  if not found then raise exception 'bill not found'; end if;
  if exists (select 1 from bill_payments where category_id = cat and due_date = due) then raise exception 'this bill occurrence is already recorded as paid'; end if;
  if mode = 'prepare' then
    if txn is null then raise exception 'a confirmed transaction is required'; end if;
    tid := fos_create_transaction(txn || jsonb_build_object('category_id', cat));
    select amount into paid_amt from transactions where id = tid;
  else
    paid_amt := coalesce(nullif(txn->>'amount','')::numeric, c.target_amount);
  end if;
  insert into bill_payments (category_id, due_date, paid_on, amount, transaction_id, mode) values (cat, due, paid_on, paid_amt, tid, mode);
  if c.is_debt and mode = 'prepare' then
    update categories set balance = round(greatest(0, coalesce(balance,0) - paid_amt), 2) where id = cat;
  end if;
  if advance and c.is_repeating and c.due_date is not null and c.due_date = due then
    nxt := case c.target_period when 'Weekly' then due + 7 when 'Bi-Weekly' then due + 14 when 'Yearly' then (due + interval '1 year')::date else (due + interval '1 month')::date end;
    update categories set due_date = nxt where id = cat;
  end if;
  return jsonb_build_object('transaction_id', tid, 'amount', paid_amt);
end $$;

-- ── 9. Expected income: confirm receipt / skip ────────────────────────────────
create or replace function public.fos_next_income_date(d date, period text) returns date
language sql immutable as $$
  select case period
    when 'Weekly' then d + 7
    when 'Biweekly' then d + 14
    when 'Monthly' then (d + interval '1 month')::date
    when 'Semimonthly' then case when extract(day from d) < 16 then (date_trunc('month', d) + interval '15 days')::date
                                 else (date_trunc('month', d) + interval '1 month')::date end
    else null end;
$$;

-- A repeating expected income spawns its next pending occurrence in the same transaction.
create or replace function public.fos_spawn_next_income(pi public.projected_income) returns void
language plpgsql set search_path = public as $$
declare nd date := fos_next_income_date(pi.expected_date, pi.repeat_period);
begin
  if nd is null or coalesce(pi.is_repeating,false) = false then return; end if;
  insert into projected_income (label, amount, expected_date, account_id, category_id, status, source_type, is_repeating, repeat_period, notes, certainty, entity_id, venture_id)
  values (pi.label, pi.amount, nd, pi.account_id, pi.category_id, 'pending', pi.source_type, true, pi.repeat_period, pi.notes, pi.certainty, pi.entity_id, pi.venture_id);
end $$;

create or replace function public.fos_receive_income(pid bigint, received_on date, amt numeric, acct bigint, request_id uuid default null) returns bigint
language plpgsql set search_path = public as $$
declare pi public.projected_income; tid bigint;
begin
  perform fos_check_owner();
  select * into pi from projected_income where id = pid for update;
  if not found then raise exception 'expected income not found'; end if;
  if pi.status <> 'pending' then raise exception 'this income is already %', pi.status; end if;
  tid := fos_create_transaction(jsonb_build_object('date', received_on, 'amount', amt, 'payee', pi.label, 'type', 'Income',
    'account_id', acct, 'category_id', pi.category_id, 'entity_id', pi.entity_id, 'client_request_id', request_id));
  update projected_income set status = 'received', transaction_id = tid, received_at = now() where id = pid;
  perform fos_spawn_next_income(pi);
  return tid;
end $$;

-- Skipping one occurrence cancels it (history kept) and, for a repeating income, schedules the next one.
create or replace function public.fos_skip_income_occurrence(pid bigint, occ date) returns void
language plpgsql set search_path = public as $$
declare pi public.projected_income;
begin
  perform fos_check_owner();
  select * into pi from projected_income where id = pid for update;
  if not found then raise exception 'expected income not found'; end if;
  if pi.status <> 'pending' then raise exception 'this income is already %', pi.status; end if;
  insert into expected_income_skips (projected_income_id, occurrence_date) values (pid, coalesce(occ, pi.expected_date)) on conflict do nothing;
  update projected_income set status = 'cancelled' where id = pid;
  perform fos_spawn_next_income(pi);
end $$;

grant execute on function public.fos_create_transaction(jsonb), public.fos_update_transaction(bigint, jsonb), public.fos_delete_transaction(bigint),
  public.fos_assign(jsonb), public.fos_move_money(bigint, bigint, numeric), public.fos_set_cutover(bigint, date, numeric, text),
  public.fos_reconcile(bigint, numeric, date, uuid, text), public.fos_pay_bill(bigint, date, date, text, jsonb, boolean),
  public.fos_receive_income(bigint, date, numeric, bigint, uuid), public.fos_skip_income_occurrence(bigint, date), public.fos_derived_balance(bigint) to authenticated;
revoke execute on function public.fos_spawn_next_income(public.projected_income) from public, anon;
grant execute on function public.fos_spawn_next_income(public.projected_income), public.fos_next_income_date(date, text) to authenticated;
revoke execute on function public.fos_apply_effect(public.transactions, int, jsonb), public.fos_check_owner(), public.fos_validate_txn(jsonb) from public, anon;
grant execute on function public.fos_apply_effect(public.transactions, int, jsonb), public.fos_check_owner(), public.fos_validate_txn(jsonb), public.fos_acct_delta(text,text,boolean,numeric) to authenticated;

grant select, insert, update, delete on public.account_baselines, public.account_reconciliations, public.bill_payments, public.expected_income_skips to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on public.account_balance_audit to authenticated;

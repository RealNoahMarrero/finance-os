-- 018: Finances 2.0 correctness. ADDITIVE for data: new columns only; no existing row is changed except the new `category_groups.kind`
-- column being filled from the group's current name (so behaviour is identical on day one). Finance objects only (shared Supabase project).
-- NOT applied to production. Apply only after a verified fresh backup and explicit approval:
--   node tools/supabase-admin.mjs backup  ->  migrate db/018_payments_scheduling_recurrence.sql --dry  ->  migrate ...  ->  verify
-- Order of release: apply this migration FIRST, then deploy the new app. The previous app keeps working after this migration
-- (old call signatures still behave the same; payloads without "scheduled" post immediately as before).
-- Safe to re-run.
--
-- ROLLBACK (structure only; no financial data is changed by this file):
--   alter table public.transactions drop column if exists status;
--   alter table public.projected_income drop column if exists income_anchor;
--   alter table public.category_groups drop column if exists kind;
--   drop function if exists public.fos_pay_bill_v2(jsonb), public.fos_unpay_bill(bigint, date, boolean), public.fos_post_due(date),
--     public.fos_set_bill_paused(bigint, boolean, date), public.fos_add_account(jsonb), public.fos_set_cutovers(date, jsonb),
--     public.fos_archive_bill(bigint, boolean, boolean, date);
--   then re-run 011a (restores the original ledger functions) and 013/015.

-- ── 1. Columns ────────────────────────────────────────────────────────────────
-- status: 'posted' (counts in balances, as every existing row does) | 'scheduled' (future-dated, not yet counted).
alter table public.transactions add column if not exists status text not null default 'posted';
do $$ begin alter table public.transactions add constraint transactions_status_check check (status in ('posted','scheduled'));
exception when duplicate_object then null; end $$;
alter table public.projected_income add column if not exists income_anchor date;
alter table public.category_groups add column if not exists kind text;
update public.category_groups set kind = case
    when lower(name) like '%bill%' or lower(name) like '%subscription%' then 'bills'
    when lower(name) like '%need%' then 'everyday'
    when lower(name) like '%want%' then 'lifestyle'
    else 'goals' end
  where kind is null;

-- ── 2. Transactions: scheduled vs posted ─────────────────────────────────────
-- A scheduled transaction has NO effect on balances or envelopes until fos_post_due() posts it on/after its date.
create or replace function public.fos_create_transaction(p jsonb) returns bigint
language plpgsql set search_path = public as $$
declare t public.transactions; sp jsonb := coalesce(p->'splits','[]'::jsonb); rid uuid := nullif(p->>'client_request_id','')::uuid; x jsonb; i int := 0;
  sched boolean := coalesce((p->>'scheduled')::boolean, false) and not coalesce((p->>'is_adjustment')::boolean, false);
begin
  perform fos_check_owner();
  if rid is not null then select * into t from transactions where client_request_id = rid; if found then return t.id; end if; end if;
  perform fos_validate_txn(p);
  insert into transactions (date, amount, payee, category_id, account_id, to_account_id, type, notes, entity_id, venture_id, linked_transaction_id, owner_flow, client_request_id, is_adjustment, status)
  values ((p->>'date')::date, round((p->>'amount')::numeric,2), nullif(p->>'payee',''),
    case when jsonb_array_length(sp) > 0 then null else nullif(p->>'category_id','')::bigint end,
    (p->>'account_id')::bigint, nullif(p->>'to_account_id','')::bigint, p->>'type', nullif(p->>'notes',''),
    coalesce(p->>'entity_id','personal'), nullif(p->>'venture_id','')::bigint, nullif(p->>'linked_transaction_id','')::bigint,
    nullif(p->>'owner_flow',''), rid, coalesce((p->>'is_adjustment')::boolean,false), case when sched then 'scheduled' else 'posted' end)
  returning * into t;
  for x in select * from jsonb_array_elements(sp) loop
    i := i + 1; insert into transaction_splits (transaction_id, category_id, amount, sort_order) values (t.id, (x->>'category_id')::bigint, (x->>'amount')::numeric, i);
  end loop;
  if not sched then perform fos_apply_effect(t, 1, sp); end if;
  return t.id;
end $$;

create or replace function public.fos_update_transaction(tid bigint, p jsonb) returns bigint
language plpgsql set search_path = public as $$
declare old public.transactions; oldsp jsonb; sp jsonb := coalesce(p->'splits','[]'::jsonb); t public.transactions; x jsonb; i int := 0;
  sched boolean := coalesce((p->>'scheduled')::boolean, false);
begin
  perform fos_check_owner();
  select * into old from transactions where id = tid for update;
  if not found then raise exception 'transaction not found'; end if;
  if old.is_adjustment then raise exception 'reconciliation adjustments cannot be edited'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('category_id', category_id, 'amount', amount)), '[]') into oldsp from transaction_splits where transaction_id = tid;
  perform fos_validate_txn(p);
  if old.status = 'posted' then perform fos_apply_effect(old, -1, oldsp); end if;
  delete from transaction_splits where transaction_id = tid;
  update transactions set date = (p->>'date')::date, amount = round((p->>'amount')::numeric,2), payee = nullif(p->>'payee',''),
    category_id = case when jsonb_array_length(sp) > 0 then null else nullif(p->>'category_id','')::bigint end,
    account_id = (p->>'account_id')::bigint, to_account_id = nullif(p->>'to_account_id','')::bigint, type = p->>'type', notes = nullif(p->>'notes',''),
    venture_id = nullif(p->>'venture_id','')::bigint, status = case when sched then 'scheduled' else 'posted' end
  where id = tid returning * into t;
  for x in select * from jsonb_array_elements(sp) loop
    i := i + 1; insert into transaction_splits (transaction_id, category_id, amount, sort_order) values (tid, (x->>'category_id')::bigint, (x->>'amount')::numeric, i);
  end loop;
  if not sched then perform fos_apply_effect(t, 1, sp); end if;
  return tid;
end $$;

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
  if old.status = 'posted' then perform fos_apply_effect(old, -1, oldsp); end if;
  delete from transaction_splits where transaction_id = tid;
  delete from transactions where id = tid;
  res := to_jsonb(old) || jsonb_build_object('splits', oldsp);
  return res;
end $$;

-- Posts every scheduled transaction dated on or before `today` (the caller's local date). Idempotent: a posted row is never posted twice.
create or replace function public.fos_post_due(today date) returns int
language plpgsql set search_path = public as $$
declare t public.transactions; sp jsonb; n int := 0;
begin
  perform fos_check_owner();
  for t in select * from transactions where status = 'scheduled' and date <= today order by date, id for update loop
    select coalesce(jsonb_agg(jsonb_build_object('category_id', category_id, 'amount', amount)), '[]') into sp from transaction_splits where transaction_id = t.id;
    update transactions set status = 'posted' where id = t.id returning * into t;
    perform fos_apply_effect(t, 1, sp);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Opening-balance maths must ignore scheduled rows.
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
    into d from transactions t where (t.account_id = acct or t.to_account_id = acct) and t.date > b.cutover_date and t.status = 'posted';
  return round(b.opening_balance + d, 2);
end $$;

-- ── 3. Budget movement: the server enforces what the screen shows ────────────
create or replace function public.fos_move_money(from_id bigint, to_id bigint, amt numeric) returns void
language plpgsql set search_path = public as $$
declare have numeric;
begin
  perform fos_check_owner();
  if amt is null or amt <= 0 then raise exception 'amount must be positive'; end if;
  if from_id = to_id then raise exception 'choose two different categories'; end if;
  perform 1 from categories where id in (from_id, to_id) order by id for update;
  select assigned_amount into have from categories where id = from_id;
  if have is null then raise exception 'category not found'; end if;
  if have < amt then raise exception 'not enough available in the source category (% available)', have; end if;
  update categories set assigned_amount = round(assigned_amount - amt, 2) where id = from_id;
  update categories set assigned_amount = round(assigned_amount + amt, 2) where id = to_id;
end $$;

create or replace function public.fos_assign(assignments jsonb) returns void
language plpgsql set search_path = public as $$
declare x jsonb; net numeric := 0; rta numeric; after_amt numeric;
begin
  perform fos_check_owner();
  for x in select * from jsonb_array_elements(assignments) order by (value->>'category_id')::bigint loop
    if (x->>'amount')::numeric = 0 then continue; end if;
    update categories set assigned_amount = round(assigned_amount + (x->>'amount')::numeric, 2), budgeted_amount = round(coalesce(budgeted_amount,0) + (x->>'amount')::numeric, 2)
      where id = (x->>'category_id')::bigint returning assigned_amount into after_amt;
    if not found then raise exception 'category not found'; end if;
    if (x->>'amount')::numeric < 0 and after_amt < 0 then raise exception 'that would leave a category below $0 (it only has % available)', after_amt + abs((x->>'amount')::numeric); end if;
    net := net + (x->>'amount')::numeric;
  end loop;
  if net > 0 then
    select coalesce((select sum(balance) from accounts where type <> 'Credit Card' and entity_id = 'personal' and not coalesce(is_archived, false)), 0)
         - coalesce((select sum(assigned_amount) from categories where entity_id = 'personal' and not is_hidden), 0) into rta;
    if rta < 0 then raise exception 'not enough Ready to Assign for that'; end if;
  end if;
end $$;

-- ── 4. Bill payments: one atomic, idempotent path for every entry point ─────
-- mode 'post'     record a new transaction (expense, or a transfer when the bill is a card payment) and mark the occurrence paid
-- mode 'link'     mark paid with an ALREADY recorded transaction (never creates a duplicate)
-- mode 'external' paid outside tracked accounts: mark paid, no transaction
-- Partial payment (amount below the bill, settle=false): the transaction is recorded and any debt is reduced, but the occurrence stays due.
create or replace function public.fos_pay_bill_v2(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare cat bigint := (p->>'category_id')::bigint; due date := (p->>'due')::date; paid_on date := coalesce((p->>'paid_on')::date, current_date);
  mode text := coalesce(p->>'mode', 'post'); amt numeric := nullif(p->>'amount','')::numeric; settle boolean := coalesce((p->>'settle')::boolean, true);
  rid uuid := nullif(p->>'request_id','')::uuid; acct bigint := nullif(p->>'account_id','')::bigint; tid bigint := nullif(p->>'transaction_id','')::bigint;
  c public.categories; t public.transactions; card public.accounts; full_amt numeric; created boolean := false; settled boolean; nxt date; ex public.transactions;
begin
  perform fos_check_owner();
  if mode not in ('post','link','external') then raise exception 'unknown payment mode'; end if;
  if rid is not null then
    select * into ex from transactions where client_request_id = rid;
    if found then return jsonb_build_object('duplicate', true, 'transaction_id', ex.id, 'amount', ex.amount, 'settled', exists (select 1 from bill_payments where category_id = cat and due_date = due)); end if;
  end if;
  select * into c from categories where id = cat for update;
  if not found then raise exception 'bill not found'; end if;
  if c.bill_archived then raise exception 'this bill is archived; restore it first'; end if;
  if c.due_date is null then raise exception 'this category has no scheduled bill'; end if;
  if exists (select 1 from bill_payments where category_id = cat and due_date = due) then raise exception 'this bill occurrence is already recorded as paid'; end if;
  if c.due_date is distinct from due then raise exception 'pay the oldest unpaid due date first (%)', c.due_date; end if;
  full_amt := coalesce(c.bill_amount, c.target_amount);

  if mode = 'post' then
    amt := coalesce(amt, full_amt);
    if amt is null or amt <= 0 then raise exception 'enter a payment amount'; end if;
    if acct is null then raise exception 'choose the account the payment came from'; end if;
    select * into card from accounts where payment_category_id = cat limit 1;
    tid := fos_create_transaction(jsonb_build_object('date', paid_on, 'amount', amt,
      'payee', case when card.id is not null then 'Payment to ' || card.name else c.name end,
      'type', case when card.id is not null then 'Transfer' else 'Expense' end,
      'account_id', acct, 'to_account_id', card.id, 'category_id', cat, 'entity_id', coalesce(c.entity_id, 'personal'), 'client_request_id', rid));
    created := true;
  elsif mode = 'link' then
    if tid is null then raise exception 'choose the transaction to link'; end if;
    select * into t from transactions where id = tid for update;
    if not found then raise exception 'transaction not found'; end if;
    if t.status <> 'posted' or t.is_adjustment then raise exception 'only a posted, ordinary transaction can be linked'; end if;
    if t.type not in ('Expense','Transfer') then raise exception 'income cannot pay a bill'; end if;
    if exists (select 1 from bill_payments where transaction_id = tid) or exists (select 1 from projected_income where transaction_id = tid) then raise exception 'that transaction is already linked to something else'; end if;
    if t.category_id is distinct from cat then raise exception 'that transaction is in a different category; change its category first'; end if;
    amt := t.amount; paid_on := t.date;
  else
    amt := coalesce(amt, full_amt);
  end if;
  if amt is null or amt < 0 then raise exception 'invalid payment amount'; end if;

  settled := settle or amt >= coalesce(full_amt, 0);
  if c.is_debt and amt > 0 then update categories set balance = round(greatest(0, coalesce(balance, 0) - amt), 2) where id = cat; end if;
  if settled then
    insert into bill_payments (category_id, due_date, paid_on, amount, transaction_id, mode) values (cat, due, paid_on, amt, tid, case when mode = 'external' then 'reminder' else 'prepare' end);
    if c.is_repeating then
      nxt := public.fos_bill_next(coalesce(c.bill_anchor, c.due_date), due, c.target_period);
      update categories set due_date = nxt, bill_anchor = coalesce(bill_anchor, c.due_date) where id = cat;
    end if;
  end if;
  return jsonb_build_object('settled', settled, 'transaction_id', tid, 'created', created, 'amount', amt, 'next_due', nxt, 'duplicate', false);
end $$;

-- Undo the most recent payment of a bill: puts the due date back, restores any debt reduction, optionally removes the transaction this payment created.
create or replace function public.fos_unpay_bill(cat bigint, due date, delete_txn boolean default false) returns jsonb
language plpgsql set search_path = public as $$
declare c public.categories; bp public.bill_payments;
begin
  perform fos_check_owner();
  select * into c from categories where id = cat for update;
  if not found then raise exception 'bill not found'; end if;
  select * into bp from bill_payments where category_id = cat and due_date = due;
  if not found then raise exception 'no payment is recorded for that due date'; end if;
  if exists (select 1 from bill_payments where category_id = cat and due_date > due) then raise exception 'undo the most recent payment first'; end if;
  delete from bill_payments where id = bp.id;
  update categories set due_date = due where id = cat;
  if c.is_debt and bp.amount > 0 then update categories set balance = round(coalesce(balance, 0) + bp.amount, 2) where id = cat; end if;
  if delete_txn and bp.transaction_id is not null then perform fos_delete_transaction(bp.transaction_id); end if;
  return jsonb_build_object('transaction_id', bp.transaction_id, 'amount', bp.amount);
end $$;

-- Pause / resume touches only those two columns (a stale screen can no longer overwrite the rest of the bill).
create or replace function public.fos_set_bill_paused(cat bigint, paused boolean, resume date default null) returns void
language plpgsql set search_path = public as $$
begin
  perform fos_check_owner();
  update categories set bill_paused = paused, due_date = case when not paused and resume is not null then resume else due_date end where id = cat;
  if not found then raise exception 'bill not found'; end if;
end $$;

-- ── 5. Multi-step client writes become single atomic calls ──────────────────
create or replace function public.fos_add_account(p jsonb) returns bigint
language plpgsql set search_path = public as $$
declare id bigint;
begin
  perform fos_check_owner();
  insert into accounts (name, type, balance, credit_limit, entity_id)
    values (p->>'name', p->>'type', 0, coalesce(nullif(p->>'credit_limit','')::numeric, 0), 'personal') returning accounts.id into id;
  perform fos_set_cutover(id, (p->>'cutover')::date, (p->>'opening')::numeric);
  return id;
end $$;

create or replace function public.fos_set_cutovers(cutover date, items jsonb) returns void
language plpgsql set search_path = public as $$
declare x jsonb;
begin
  perform fos_check_owner();
  for x in select * from jsonb_array_elements(items) order by (value->>'account_id')::bigint loop
    perform fos_set_cutover((x->>'account_id')::bigint, cutover, (x->>'opening')::numeric);
  end loop;
end $$;

create or replace function public.fos_archive_bill(cat bigint, archived boolean, also_category boolean default false, resume date default null) returns void
language plpgsql set search_path = public as $$
begin
  perform fos_check_owner();
  if archived then
    update categories set bill_archived = true, bill_archived_at = now(), bill_paused = true, is_hidden = (is_hidden or coalesce(also_category, false)) where id = cat;
  else
    update categories set bill_archived = false, bill_archived_at = null, bill_paused = false, is_hidden = case when coalesce(also_category, false) then false else is_hidden end,
      due_date = coalesce(resume, due_date) where id = cat;
  end if;
  if not found then raise exception 'bill not found'; end if;
end $$;

-- ── 6. Expected income recurrence: same rules as the app ────────────────────
-- Monthly keeps the ORIGINAL day (income_anchor, else the row's own date) clamped to the month's last day (no drift: Jan 31 -> Feb 28 -> Mar 31).
-- Semimonthly = the 1st and the 16th, moved off weekends (Saturday -> Friday, Sunday -> Monday).
drop function if exists public.fos_next_income_date(date, text);
create or replace function public.fos_next_income_date(d date, period text, anchor date default null) returns date
language sql immutable as $$
  select case period
    when 'Weekly' then d + 7
    when 'Biweekly' then d + 14
    when 'Monthly' then (date_trunc('month', d)::date + interval '1 month')::date
        + (least(extract(day from coalesce(anchor, d))::int, extract(day from ((date_trunc('month', d)::date + interval '2 month') - interval '1 day'))::int) - 1)
    when 'Semimonthly' then (
      select case extract(dow from b)::int when 6 then b - 1 when 0 then b + 1 else b end from (
        select case when extract(day from d) between 15 and 25 then (date_trunc('month', d)::date + interval '1 month')::date
                    when extract(day from d) >= 26 then (date_trunc('month', d)::date + interval '1 month')::date + 15
                    else date_trunc('month', d)::date + 15 end as b) s)
    else null end;
$$;
grant execute on function public.fos_next_income_date(date, text, date) to authenticated;

drop function if exists public.fos_spawn_next_income(public.projected_income);
create or replace function public.fos_spawn_next_income(pi public.projected_income) returns bigint
language plpgsql set search_path = public as $$
declare nd date := fos_next_income_date(pi.expected_date, pi.repeat_period, pi.income_anchor); nid bigint;
begin
  if nd is null or coalesce(pi.is_repeating,false) = false then return null; end if;
  insert into projected_income (label, amount, expected_date, account_id, category_id, status, source_type, is_repeating, repeat_period, notes, certainty, entity_id, venture_id, income_anchor)
  values (pi.label, pi.amount, nd, pi.account_id, pi.category_id, 'pending', pi.source_type, true, pi.repeat_period, pi.notes, pi.certainty, pi.entity_id, pi.venture_id, coalesce(pi.income_anchor, pi.expected_date))
  returning id into nid;
  return nid;
end $$;
revoke execute on function public.fos_spawn_next_income(public.projected_income) from public, anon;
grant execute on function public.fos_spawn_next_income(public.projected_income) to authenticated;

-- Skipping returns the id of the occurrence it created, so an Undo never has to guess which row is which.
drop function if exists public.fos_skip_income_occurrence(bigint, date);
create or replace function public.fos_skip_income_occurrence(pid bigint, occ date) returns jsonb
language plpgsql set search_path = public as $$
declare pi public.projected_income; nid bigint;
begin
  perform fos_check_owner();
  select * into pi from projected_income where id = pid for update;
  if not found then raise exception 'expected income not found'; end if;
  if pi.status <> 'pending' then raise exception 'this income is already %', pi.status; end if;
  insert into expected_income_skips (projected_income_id, occurrence_date) values (pid, coalesce(occ, pi.expected_date)) on conflict do nothing;
  update projected_income set status = 'cancelled' where id = pid;
  nid := fos_spawn_next_income(pi);
  return jsonb_build_object('next_id', nid);
end $$;

-- Undo of a skip: removes exactly the occurrence that skip created (only if still pending) and restores the original.
create or replace function public.fos_unskip_income_occurrence(pid bigint, occ date, next_id bigint default null) returns void
language plpgsql set search_path = public as $$
begin
  perform fos_check_owner();
  if next_id is not null then delete from projected_income where id = next_id and status = 'pending' and label = (select label from projected_income where id = pid); end if;
  delete from expected_income_skips where projected_income_id = pid and occurrence_date = occ;
  update projected_income set status = 'pending' where id = pid and status = 'cancelled';
end $$;

grant execute on function public.fos_pay_bill_v2(jsonb), public.fos_unpay_bill(bigint, date, boolean), public.fos_post_due(date),
  public.fos_set_bill_paused(bigint, boolean, date), public.fos_add_account(jsonb), public.fos_set_cutovers(date, jsonb),
  public.fos_archive_bill(bigint, boolean, boolean, date), public.fos_skip_income_occurrence(bigint, date), public.fos_unskip_income_occurrence(bigint, date, bigint) to authenticated;
revoke execute on function public.fos_pay_bill_v2(jsonb), public.fos_unpay_bill(bigint, date, boolean), public.fos_post_due(date),
  public.fos_set_bill_paused(bigint, boolean, date), public.fos_add_account(jsonb), public.fos_set_cutovers(date, jsonb),
  public.fos_archive_bill(bigint, boolean, boolean, date), public.fos_skip_income_occurrence(bigint, date), public.fos_unskip_income_occurrence(bigint, date, bigint) from public, anon;

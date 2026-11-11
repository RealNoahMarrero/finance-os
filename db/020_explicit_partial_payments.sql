-- 020: transaction-first bill payments. ADDITIVE: one new table + three replaced functions. No existing row is read, changed or deleted.
-- Why: recording a transaction is now the normal way to pay a scheduled item. A full payment is linked through bill_payments (as before).
-- A PARTIAL payment (smaller than what is still owed) is now linked explicitly too, in bill_partials, so "paid so far" and "remaining" are
-- derived from transactions the user actually linked -- never from unrelated spending that happens to share the category.
-- Finance objects only (the Supabase project is shared with other apps). Safe to re-run.
-- Order of release: apply this migration FIRST, then deploy the app. The previous app keeps working (it never reads bill_partials; its
-- unsettled payments simply start being recorded as explicit partials).
--
-- ROLLBACK (structure only; transactions, balances and allocations are untouched by this file):
--   drop function if exists public.fos_unpay_partial(bigint, boolean);
--   drop table if exists public.bill_partials;
--   then re-run 018 (restores fos_pay_bill_v2 and fos_delete_transaction as they were).

create table if not exists public.bill_partials (
  transaction_id bigint primary key references public.transactions(id),
  category_id bigint not null references public.categories(id),
  due_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  debt_applied numeric(14,2) not null default 0 check (debt_applied >= 0),
  created_at timestamptz not null default now()
);
create index if not exists bill_partials_category_due_idx on public.bill_partials (category_id, due_date);
alter table public.bill_partials enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bill_partials' and policyname = 'owner_all') then
    create policy owner_all on public.bill_partials for all to authenticated using (public.is_owner()) with check (public.is_owner());
  end if;
end $$;
revoke all on public.bill_partials from anon, public;
grant select, insert, update, delete on public.bill_partials to authenticated;

-- ── Payments: one atomic, idempotent path (018's function, plus explicit partials) ──
-- mode 'post'     record a new transaction and mark the occurrence paid
-- mode 'link'     count an ALREADY recorded transaction (never creates a duplicate)
-- mode 'external' paid outside tracked accounts
-- A payment that, together with the partial payments already linked to this occurrence, still falls short of the amount due (and was not
-- explicitly settled) is recorded as a PARTIAL: the transaction is linked in bill_partials, any debt is reduced, and the occurrence stays due.
create or replace function public.fos_pay_bill_v2(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare cat bigint := (p->>'category_id')::bigint; due date := (p->>'due')::date; paid_on date := coalesce((p->>'paid_on')::date, current_date);
  mode text := coalesce(p->>'mode', 'post'); amt numeric := nullif(p->>'amount','')::numeric; settle boolean := coalesce((p->>'settle')::boolean, true);
  rid uuid := nullif(p->>'request_id','')::uuid; acct bigint := nullif(p->>'account_id','')::bigint; tid bigint := nullif(p->>'transaction_id','')::bigint;
  c public.categories; t public.transactions; card public.accounts; full_amt numeric; created boolean := false; settled boolean; nxt date; ex public.transactions; applied numeric := 0;
  prior numeric := 0;
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
  select coalesce(sum(amount), 0) into prior from bill_partials where category_id = cat and due_date = due;

  if mode = 'post' then
    amt := coalesce(amt, full_amt - prior);
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
    if exists (select 1 from bill_payments where transaction_id = tid) or exists (select 1 from bill_partials where transaction_id = tid)
       or exists (select 1 from projected_income where transaction_id = tid) then raise exception 'that transaction is already linked to something else'; end if;
    if t.category_id is distinct from cat then raise exception 'that transaction is in a different category; change its category first'; end if;
    amt := t.amount; paid_on := t.date;
  else
    amt := coalesce(amt, full_amt - prior);
  end if;
  if amt is null or amt < 0 then raise exception 'invalid payment amount'; end if;

  settled := settle or prior + amt >= coalesce(full_amt, 0);
  if c.is_debt and amt > 0 then
    applied := least(coalesce(c.balance, 0), amt);
    update categories set balance = round(coalesce(balance, 0) - applied, 2) where id = cat;
  end if;
  if settled then
    insert into bill_payments (category_id, due_date, paid_on, amount, transaction_id, mode, debt_applied) values (cat, due, paid_on, amt, tid, case when mode = 'external' then 'reminder' else 'prepare' end, applied);
    if c.is_repeating then
      nxt := public.fos_bill_next(coalesce(c.bill_anchor, c.due_date), due, c.target_period);
      update categories set due_date = nxt, bill_anchor = coalesce(bill_anchor, c.due_date) where id = cat;
    end if;
  elsif tid is not null then
    insert into bill_partials (transaction_id, category_id, due_date, amount, debt_applied) values (tid, cat, due, amt, applied);
  end if;
  return jsonb_build_object('settled', settled, 'transaction_id', tid, 'created', created, 'amount', amt, 'next_due', nxt, 'duplicate', false, 'debt_applied', applied, 'paid_before', prior);
end $$;

-- Undo ONE partial payment: restores exactly the debt it removed and unlinks it (optionally deleting the transaction it created).
-- Refused once its occurrence has been completed: undo the completed payment first, so the history is always undone newest-first.
create or replace function public.fos_unpay_partial(txn_id bigint, delete_txn boolean default false) returns jsonb
language plpgsql set search_path = public as $$
declare bp public.bill_partials; c public.categories;
begin
  perform fos_check_owner();
  select * into bp from bill_partials where transaction_id = txn_id for update;
  if not found then raise exception 'no partial payment is recorded for that transaction'; end if;
  select * into c from categories where id = bp.category_id for update;
  if exists (select 1 from bill_payments where category_id = bp.category_id and due_date = bp.due_date) then
    raise exception 'that occurrence has since been completed; undo the completed payment first';
  end if;
  if c.is_debt and bp.debt_applied > 0 then update categories set balance = round(coalesce(balance, 0) + bp.debt_applied, 2) where id = bp.category_id; end if;
  delete from bill_partials where transaction_id = txn_id;
  if delete_txn then perform fos_delete_transaction(txn_id); end if;
  return jsonb_build_object('transaction_id', txn_id, 'amount', bp.amount, 'category_id', bp.category_id);
end $$;

-- 018's undo, plus: a partial that is explicitly linked is undone through fos_unpay_partial (the server knows exactly what it removed from a debt;
-- the client-supplied debt_restore is only used for older partials that were recorded before this migration and have no link).
create or replace function public.fos_unpay_bill(cat bigint, due date, delete_txn boolean default false, txn_id bigint default null, debt_restore numeric default 0) returns jsonb
language plpgsql set search_path = public as $$
declare c public.categories; bp public.bill_payments; restore numeric;
begin
  perform fos_check_owner();
  select * into c from categories where id = cat for update;
  if not found then raise exception 'bill not found'; end if;
  select * into bp from bill_payments where category_id = cat and due_date = due;
  if not found then
    if txn_id is null then raise exception 'no payment is recorded for that due date'; end if;
    if exists (select 1 from bill_partials where transaction_id = txn_id) then return fos_unpay_partial(txn_id, delete_txn); end if;
    if c.is_debt and coalesce(debt_restore, 0) > 0 then update categories set balance = round(coalesce(balance, 0) + debt_restore, 2) where id = cat; end if;
    if delete_txn then perform fos_delete_transaction(txn_id); end if;
    return jsonb_build_object('transaction_id', txn_id, 'amount', 0);
  end if;
  if exists (select 1 from bill_payments where category_id = cat and due_date > due) then raise exception 'undo the most recent payment first'; end if;
  delete from bill_payments where id = bp.id;
  update categories set due_date = due where id = cat;
  restore := coalesce(bp.debt_applied, case when bp.mode = 'prepare' then bp.amount else 0 end);
  if c.is_debt and restore > 0 then update categories set balance = round(coalesce(balance, 0) + restore, 2) where id = cat; end if;
  if delete_txn and bp.transaction_id is not null then perform fos_delete_transaction(bp.transaction_id); end if;
  return jsonb_build_object('transaction_id', bp.transaction_id, 'amount', bp.amount);
end $$;

-- A transaction that confirms any payment (full or partial) or received income cannot be deleted from under it.
create or replace function public.fos_delete_transaction(tid bigint) returns jsonb
language plpgsql set search_path = public as $$
declare old public.transactions; oldsp jsonb; res jsonb;
begin
  perform fos_check_owner();
  select * into old from transactions where id = tid for update;
  if not found then raise exception 'transaction not found'; end if;
  if old.is_adjustment then raise exception 'reconciliation adjustments cannot be deleted'; end if;
  if exists (select 1 from bill_payments where transaction_id = tid) or exists (select 1 from bill_partials where transaction_id = tid)
     or exists (select 1 from projected_income where transaction_id = tid and status = 'received') then
    raise exception 'this transaction confirms a bill payment or received income; undo that first';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('category_id', category_id, 'amount', amount)), '[]') into oldsp from transaction_splits where transaction_id = tid;
  if old.status = 'posted' then perform fos_apply_effect(old, -1, oldsp); end if;
  delete from transaction_splits where transaction_id = tid;
  delete from transactions where id = tid;
  res := to_jsonb(old) || jsonb_build_object('splits', oldsp);
  return res;
end $$;

grant execute on function public.fos_pay_bill_v2(jsonb), public.fos_unpay_partial(bigint, boolean), public.fos_delete_transaction(bigint), public.fos_unpay_bill(bigint, date, boolean, bigint, numeric) to authenticated;
revoke execute on function public.fos_pay_bill_v2(jsonb), public.fos_unpay_partial(bigint, boolean), public.fos_delete_transaction(bigint), public.fos_unpay_bill(bigint, date, boolean, bigint, numeric) from public, anon;

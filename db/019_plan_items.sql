-- 019: Finances "Plan" — one financial item (category + optional schedule) managed, saved and archived as a single atomic operation.
-- ADDITIVE: one new nullable column. No existing row is changed. Finance objects only (shared Supabase project).
-- Apply only after a verified fresh backup:  node tools/supabase-admin.mjs backup -> migrate db/019_plan_items.sql --dry -> migrate ... -> verify
-- Release order: apply this FIRST, then deploy the app. The previous app keeps working afterwards (nothing it uses changes).
-- Safe to re-run.
--
-- ROLLBACK (no financial data is changed by this file):
--   alter table public.categories drop column if exists target_mode;
--   drop function if exists public.fos_save_item(jsonb), public.fos_archive_item(bigint, date), public.fos_restore_item(bigint, numeric, date);

-- How the funding goal is meant: 'save' = build up toward an amount; 'keep' = keep an amount available. NULL = not chosen yet (shown as 'keep').
-- The maths is the same either way (target_amount); only the wording differs.
alter table public.categories add column if not exists target_mode text;
do $$ begin alter table public.categories add constraint categories_target_mode_check check (target_mode is null or target_mode in ('save','keep'));
exception when duplicate_object then null; end $$;

-- Create or update one item in a single transaction: name/icon/group, funding goal, optional schedule (set, change or remove), pause, debt.
-- p keys (all optional on update): id, name, emoji, group_id, target_amount (null = none), target_mode,
--   schedule: {amount, date, period: 'once'|'Weekly'|'Bi-Weekly'|'Monthly'|'Yearly'} or null to remove it, paused, is_debt, debt_balance
create or replace function public.fos_save_item(p jsonb) returns bigint
language plpgsql set search_path = public as $$
declare cid bigint := nullif(p->>'id','')::bigint; c public.categories; nm text; sch jsonb; per text; d date; sp numeric;
begin
  perform fos_check_owner();
  if cid is not null then
    select * into c from categories where id = cid for update;
    if not found then raise exception 'item not found'; end if;
  end if;
  nm := case when p ? 'name' then btrim(p->>'name') else c.name end;
  if nm is null or nm = '' then raise exception 'give the item a name'; end if;
  if exists (select 1 from categories x where lower(btrim(x.name)) = lower(nm) and x.entity_id = coalesce(c.entity_id, 'personal') and (cid is null or x.id <> cid)) then
    raise exception 'another item is already called %', nm;
  end if;
  if cid is null then
    if nullif(p->>'group_id','') is null then raise exception 'choose a group'; end if;
    insert into categories (name, group_id, entity_id, assigned_amount, target_period, target_amount)
      values (nm, (p->>'group_id')::bigint, 'personal', 0, 'Monthly', 0) returning id into cid;
    select * into c from categories where id = cid;
  end if;
  update categories set name = nm where id = cid;
  if p ? 'emoji' then update categories set emoji = nullif(btrim(p->>'emoji'), '') where id = cid; end if;
  if p ? 'group_id' and nullif(p->>'group_id','') is not null then update categories set group_id = (p->>'group_id')::bigint where id = cid; end if;
  if p ? 'target_amount' then
    sp := coalesce(nullif(p->>'target_amount','')::numeric, 0);
    if sp < 0 then raise exception 'the funding goal cannot be negative'; end if;
    update categories set target_amount = sp where id = cid;
  end if;
  if p ? 'target_mode' then update categories set target_mode = nullif(p->>'target_mode','') where id = cid; end if;
  if p ? 'is_debt' then update categories set is_debt = coalesce((p->>'is_debt')::boolean, false), balance = case when coalesce((p->>'is_debt')::boolean, false) then round(greatest(0, coalesce(nullif(p->>'debt_balance','')::numeric, balance, 0)), 2) else balance end where id = cid; end if;
  if p ? 'schedule' then
    sch := p->'schedule';
    if jsonb_typeof(sch) = 'null' then
      update categories set due_date = null, bill_anchor = null, is_repeating = false, bill_paused = false, bill_amount = null, bill_mode = 'reminder' where id = cid;
    else
      per := coalesce(sch->>'period', 'Monthly'); d := (sch->>'date')::date;
      if d is null then raise exception 'choose the next due date'; end if;
      if coalesce((sch->>'amount')::numeric, 0) <= 0 then raise exception 'enter the payment amount'; end if;
      if exists (select 1 from bill_payments where category_id = cid and due_date = d) then raise exception 'that due date is already recorded as paid; choose the next unpaid date'; end if;
      update categories set bill_amount = round((sch->>'amount')::numeric, 2), due_date = d, is_repeating = (per <> 'once'),
        target_period = case when per <> 'once' then per else target_period end,
        bill_anchor = case when c.due_date is distinct from d or bill_anchor is null then d else bill_anchor end,
        bill_paused = coalesce((p->>'paused')::boolean, bill_paused, false) where id = cid;
    end if;
  elsif p ? 'paused' then
    update categories set bill_paused = coalesce((p->>'paused')::boolean, false) where id = cid and due_date is not null;
  end if;
  return cid;
end $$;

-- Archive one item. Atomic: its available money goes back to Ready to Assign (Ready to Assign is simply cash minus what the items hold,
-- so returning it means emptying the item), its schedule stops, and it leaves the active Plan. Every transaction, payment and history row is kept.
-- Refused (with the reason) when archiving would hide something unfinished: debt still owed, overdue unpaid payments, overspending, a linked credit card.
create or replace function public.fos_archive_item(cat bigint, today date) returns jsonb
language plpgsql set search_path = public as $$
declare c public.categories; returned numeric; late int;
begin
  perform fos_check_owner();
  select * into c from categories where id = cat for update;
  if not found then raise exception 'item not found'; end if;
  if c.is_hidden then raise exception 'this item is already archived'; end if;
  if exists (select 1 from accounts where payment_category_id = cat) then raise exception '% is linked to a credit card, so it stays', c.name; end if;
  if coalesce(c.is_debt, false) and coalesce(c.balance, 0) > 0 then raise exception '% still owes $%; it stays until the debt is paid or corrected', c.name, to_char(c.balance, 'FM999G999G990D00'); end if;
  if c.assigned_amount < 0 then raise exception '% is overspent by $%; cover it first so nothing is hidden', c.name, to_char(-c.assigned_amount, 'FM999G999G990D00'); end if;
  if c.due_date is not null and not coalesce(c.bill_paused, false) and c.due_date < today then
    late := 1;
    raise exception '% has an unpaid payment due %; record it, or edit the schedule, before archiving', c.name, to_char(c.due_date, 'Mon FMDD');
  end if;
  returned := round(greatest(c.assigned_amount, 0), 2);
  update categories set assigned_amount = case when c.assigned_amount > 0 then 0 else assigned_amount end, is_hidden = true,
    bill_archived = (c.due_date is not null), bill_archived_at = case when c.due_date is not null then now() else bill_archived_at end,
    bill_paused = (bill_paused or c.due_date is not null) where id = cat;
  return jsonb_build_object('returned', returned, 'name', c.name);
end $$;

-- Restore an archived item. It comes back EMPTY: history is never re-funded automatically. `reassign` (>0) is an explicit user choice
-- (used by Undo right after archiving) and is checked against Ready to Assign.
create or replace function public.fos_restore_item(cat bigint, reassign numeric default 0, resume date default null) returns void
language plpgsql set search_path = public as $$
declare c public.categories;
begin
  perform fos_check_owner();
  select * into c from categories where id = cat for update;
  if not found then raise exception 'item not found'; end if;
  update categories set is_hidden = false, bill_archived = false, bill_archived_at = null,
    bill_paused = case when due_date is not null then false else bill_paused end,
    due_date = case when due_date is not null and resume is not null then resume else due_date end where id = cat;
  if coalesce(reassign, 0) > 0 then perform fos_assign(jsonb_build_array(jsonb_build_object('category_id', cat, 'amount', reassign))); end if;
end $$;

grant execute on function public.fos_save_item(jsonb), public.fos_archive_item(bigint, date), public.fos_restore_item(bigint, numeric, date) to authenticated;
revoke execute on function public.fos_save_item(jsonb), public.fos_archive_item(bigint, date), public.fos_restore_item(bigint, numeric, date) from public, anon;

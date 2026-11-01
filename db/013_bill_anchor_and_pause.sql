-- 013: Bill recurrence anchor (no more month-end drift) + pause/resume. ADDITIVE, Finance table `categories` only.
-- No rows are deleted or rewritten; no policies or grants on any table change. Safe to re-run.
--   bill_anchor : the calendar date a bill is anchored to (its day of month / yearly month+day). NULL = use the stored due date.
--   bill_paused : true = excluded from upcoming obligations, overdue alerts and forecasts; history is untouched.
alter table public.categories add column if not exists bill_anchor date;
alter table public.categories add column if not exists bill_paused boolean not null default false;

-- Next occurrence after `cur`. Monthly keeps the anchor's day, clamped to the last valid day of shorter months, and returns to it
-- when the month allows (31st: Jan 31 -> Feb 28/29 -> Mar 31). Yearly keeps the anchor's month and day (Feb 29 -> Feb 28 in common years).
create or replace function public.fos_bill_next(anchor date, cur date, period text) returns date
language sql immutable set search_path = public as $$
  select case period
    when 'Weekly' then cur + 7
    when 'Bi-Weekly' then cur + 14
    when 'Yearly' then (make_date(extract(year from cur)::int + 1, extract(month from anchor)::int, 1)
        + (least(extract(day from anchor)::int, extract(day from (make_date(extract(year from cur)::int + 1, extract(month from anchor)::int, 1) + interval '1 month - 1 day'))::int) - 1))::date
    else (date_trunc('month', cur)::date + interval '1 month')::date
        + (least(extract(day from anchor)::int, extract(day from ((date_trunc('month', cur)::date + interval '2 month') - interval '1 day'))::int) - 1)
  end
$$;
revoke all on function public.fos_bill_next(date, date, text) from public, anon;
grant execute on function public.fos_bill_next(date, date, text) to authenticated;

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
    nxt := public.fos_bill_next(coalesce(c.bill_anchor, c.due_date), due, c.target_period);
    update categories set due_date = nxt, bill_anchor = coalesce(bill_anchor, c.due_date) where id = cat;
  end if;
  return jsonb_build_object('transaction_id', tid, 'amount', paid_amt);
end $$;


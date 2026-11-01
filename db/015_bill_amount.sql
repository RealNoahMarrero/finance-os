-- 015: Bill payment amount independent of the monthly funding target. ADDITIVE, Finance table `categories` only.
--   bill_amount : what one scheduled payment costs. NULL = same as target_amount (every existing bill keeps working unchanged).
-- target_amount stays the envelope's funding target. No rows are rewritten; no policy or grant changes. Safe to re-run.
alter table public.categories add column if not exists bill_amount numeric(14,2) check (bill_amount is null or bill_amount >= 0);

-- Only change vs 013: an un-itemised ("reminder") payment records bill_amount when set, otherwise target_amount, as before.
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
    paid_amt := coalesce(nullif(txn->>'amount','')::numeric, coalesce(c.bill_amount, c.target_amount));
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

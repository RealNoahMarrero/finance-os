-- 016: account management. Additive only: an archive flag and one guarded delete function.
-- Nothing existing is modified or removed. Finance tables only.
alter table public.accounts add column if not exists is_archived boolean not null default false;
alter table public.accounts add column if not exists archived_at timestamptz;

-- Permanently deletes an account ONLY if it has no financial history at all. Atomic; owner only.
-- (Accounts with history are archived instead, from the app.)
create or replace function public.fos_delete_unused_account(acct bigint) returns void
language plpgsql set search_path = public as $$
declare a public.accounts;
begin
  perform fos_check_owner();
  select * into a from accounts where id = acct for update;
  if not found then raise exception 'account not found'; end if;
  if coalesce(a.balance, 0) <> 0 then raise exception 'this account still has a balance — archive it instead'; end if;
  if exists (select 1 from transactions where account_id = acct or to_account_id = acct) then raise exception 'this account has transactions — archive it instead'; end if;
  if exists (select 1 from account_reconciliations where account_id = acct) then raise exception 'this account has reconciliations — archive it instead'; end if;
  if exists (select 1 from projected_income where account_id = acct) then raise exception 'expected income is linked to this account — archive it instead'; end if;
  if exists (select 1 from credit_card_meta where account_id = acct) or exists (select 1 from credit_reported_balances where account_id = acct) then raise exception 'credit information is linked to this account — archive it instead'; end if;
  if a.payment_category_id is not null then raise exception 'a bill is linked to this account — archive it instead'; end if;
  delete from account_baselines where account_id = acct;
  delete from accounts where id = acct;
end $$;
revoke all on function public.fos_delete_unused_account(bigint) from public, anon;
grant execute on function public.fos_delete_unused_account(bigint) to authenticated;

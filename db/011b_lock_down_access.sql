-- 011b: LOCK-DOWN half. Apply at cutover, right after the V2 site is live.
-- Turns on owner-only row security for the original tables and removes all anonymous access.
-- After this the old public app stops working (by design). Rollback script restores the previous policies/grants.
-- Idempotent.
-- Row-level security: owner only, nothing for anon ───────────────────────
do $$
declare t text; p record;
begin
  foreach t in array array['accounts','category_groups','categories','transactions','transaction_splits',
    'projected_income','entities','ventures','transaction_attachments','account_baselines',
    'account_reconciliations','bill_payments','expected_income_skips'] loop
    if to_regclass('public.'||t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy owner_all on public.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;


-- the whole public schema: anon gets nothing (functions included)
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;

-- keep the Sheets sync endpoint reachable by its token (it validates the token itself; read-only, one book per token)
do $$ begin
  if to_regprocedure('public.fos_sheets_data(text,text,int,int)') is not null then
    grant execute on function public.fos_sheets_data(text,text,int,int) to anon;
  end if;
end $$;

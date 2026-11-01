-- 014: Credit Score & Utilization tracker. ADDITIVE, Finance tables only (the Supabase project is shared with other apps).
-- No existing row, column, policy or grant is changed. Safe to re-run.
--   credit_scores            manually entered scores (bureau + scoring model + date)
--   credit_card_meta         per-card extras for the Credit page (active flag, statement closing date). Limits stay in accounts.credit_limit;
--                            payment due dates stay with the linked bill (categories.due_date) -- nothing is duplicated.
--   credit_reported_balances manually entered "balance reported to a bureau" snapshots, separate from the live balance.
-- Access: owner only (same owner_all policy as every other Finance table); anon gets nothing.
create or replace function public.fos_credit_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

create table if not exists public.credit_scores (
  id bigint generated always as identity primary key,
  bureau text not null check (bureau in ('Experian','Equifax','TransUnion')),
  score smallint not null check (score between 250 and 900),
  model text not null default 'Unknown' check (char_length(btrim(model)) between 1 and 40),
  observed_on date not null,
  source text check (source is null or char_length(source) <= 120),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists credit_scores_series_idx on public.credit_scores (bureau, model, observed_on);

create table if not exists public.credit_card_meta (
  account_id bigint primary key references public.accounts(id) on delete cascade,
  active boolean not null default true,
  statement_closing_date date,
  statement_repeats boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 1000),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_reported_balances (
  id bigint generated always as identity primary key,
  account_id bigint not null references public.accounts(id) on delete cascade,
  balance numeric(14,2) not null check (balance >= 0),
  reported_on date not null,
  bureau text check (bureau is null or bureau in ('Experian','Equifax','TransUnion')),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists credit_reported_balances_idx on public.credit_reported_balances (account_id, reported_on);

do $$
declare t text;
begin
  foreach t in array array['credit_scores','credit_card_meta','credit_reported_balances'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.fos_credit_touch()', t || '_touch', t);
  end loop;
end $$;
revoke all on function public.fos_credit_touch() from public, anon;

-- Google Sheets sync: two new read-only resources (personal book only). Everything else in the function is unchanged from 012.
create or replace function public.fos_sheets_data(tok text, resource text, off int default 0, lim int default 1000)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.sync_tokens; e text; o int := greatest(coalesce(off,0),0); l int := least(greatest(coalesce(lim,1000),1),1000); r jsonb;
begin
  select * into t from public.sync_tokens where token_hash = encode(sha256(convert_to(coalesce(tok,''),'UTF8')),'hex') and revoked_at is null;
  if not found then raise exception 'invalid or revoked sync token' using errcode = '28000'; end if;
  e := t.entity_id;
  update public.sync_tokens set last_used_at = now() where id = t.id and (last_used_at is null or last_used_at < now() - interval '1 minute');

  if resource = 'summary_accounts' then
    select coalesce(jsonb_agg(jsonb_build_object('type',a.type,'balance',a.balance) order by a.id),'[]') into r from (select * from accounts where entity_id=e order by id offset o limit l) a;
  elsif resource = 'summary_categories' then
    select coalesce(jsonb_agg(jsonb_build_object('assigned_amount',c.assigned_amount) order by c.id),'[]') into r from (select * from categories where entity_id=e and not is_hidden order by id offset o limit l) c;
  elsif resource = 'summary_pending' then
    select coalesce(jsonb_agg(jsonb_build_object('amount',p.amount,'certainty',p.certainty,'accounts',case when a.id is null then null else jsonb_build_object('type',a.type) end) order by p.id),'[]') into r
      from (select * from projected_income where entity_id=e and status='pending' order by id offset o limit l) p left join accounts a on a.id=p.account_id;
  elsif resource = 'accounts' then
    select coalesce(jsonb_agg(jsonb_build_object('name',a.name,'type',a.type,'balance',a.balance,'credit_limit',a.credit_limit) order by a.type,a.name,a.id),'[]') into r
      from (select * from accounts where entity_id=e order by type,name,id offset o limit l) a;
  elsif resource = 'categories' then
    select coalesce(jsonb_agg(jsonb_build_object('name',c.name,'target_amount',c.target_amount,'assigned_amount',c.assigned_amount,'is_debt',c.is_debt,'balance',c.balance,'due_date',c.due_date,
        'is_repeating',c.is_repeating,'target_period',c.target_period,'notes',c.notes,'venture_id',c.venture_id,'ventures',case when v.id is null then null else jsonb_build_object('name',v.name) end) order by c.name,c.id),'[]') into r
      from (select * from categories where entity_id=e and not is_hidden order by name,id offset o limit l) c left join ventures v on v.id=c.venture_id;
  elsif resource = 'transactions' then
    select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'date',x.date,'type',x.type,'amount',x.amount,'payee',x.payee,'notes',x.notes,'category_id',x.category_id,'owner_flow',x.owner_flow,
        'accounts',case when a.id is null then null else jsonb_build_object('name',a.name) end,
        'categories',case when c.id is null then null else jsonb_build_object('name',c.name) end,
        'ventures',case when v.id is null then null else jsonb_build_object('name',v.name) end,
        'transaction_splits',coalesce((select jsonb_agg(jsonb_build_object('amount',s.amount,'categories',case when sc.id is null then null else jsonb_build_object('name',sc.name) end) order by s.sort_order,s.id)
            from transaction_splits s left join categories sc on sc.id=s.category_id where s.transaction_id=x.id),'[]'::jsonb)) order by x.date desc, x.id),'[]') into r
      from (select * from transactions where entity_id=e order by date desc, id offset o limit l) x
      left join accounts a on a.id=x.account_id left join categories c on c.id=x.category_id left join ventures v on v.id=x.venture_id;
  elsif resource = 'transaction_splits' then
    select coalesce(jsonb_agg(jsonb_build_object('transaction_id',s.transaction_id,'amount',s.amount,'sort_order',s.sort_order,
        'categories',case when c.id is null then null else jsonb_build_object('name',c.name) end,
        'transactions',jsonb_build_object('date',x.date,'payee',x.payee,'type',x.type,'amount',x.amount,'entity_id',x.entity_id)) order by s.transaction_id desc, s.id),'[]') into r
      from (select s0.* from transaction_splits s0 join transactions x0 on x0.id=s0.transaction_id where x0.entity_id=e order by s0.transaction_id desc, s0.id offset o limit l) s
      join transactions x on x.id=s.transaction_id left join categories c on c.id=s.category_id;
  elsif resource = 'projected_income' then
    select coalesce(jsonb_agg(jsonb_build_object('label',p.label,'amount',p.amount,'expected_date',p.expected_date,'source_type',p.source_type,'certainty',p.certainty,'is_repeating',p.is_repeating,'repeat_period',p.repeat_period,'notes',p.notes,
        'accounts',case when a.id is null then null else jsonb_build_object('name',a.name) end,
        'categories',case when c.id is null then null else jsonb_build_object('name',c.name) end,
        'ventures',case when v.id is null then null else jsonb_build_object('name',v.name) end) order by p.expected_date,p.id),'[]') into r
      from (select * from projected_income where entity_id=e and status='pending' order by expected_date,id offset o limit l) p
      left join accounts a on a.id=p.account_id left join categories c on c.id=p.category_id left join ventures v on v.id=p.venture_id;
  elsif resource = 'ventures' then
    select coalesce(jsonb_agg(jsonb_build_object('name',v.name,'notes',v.notes,'is_active',v.is_active,'sort_order',v.sort_order) order by v.sort_order,v.name,v.id),'[]') into r
      from (select * from ventures where entity_id=e order by sort_order,name,id offset o limit l) v;
  elsif resource = 'credit_scores' then
    if e <> 'personal' then r := '[]'::jsonb; else
    select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'observed_on',s.observed_on,'bureau',s.bureau,'score',s.score,'model',s.model,'source',s.source,'notes',s.notes) order by s.observed_on desc, s.id desc),'[]') into r
      from (select * from credit_scores order by observed_on desc, id desc offset o limit l) s; end if;
  elsif resource = 'credit_cards' then
    if e <> 'personal' then r := '[]'::jsonb; else
    select coalesce(jsonb_agg(jsonb_build_object('name',a.name,'balance',a.balance,'credit_limit',a.credit_limit,'active',coalesce(m.active,true),
        'statement_closing_date',m.statement_closing_date,'statement_repeats',coalesce(m.statement_repeats,true),
        'payment_due_date',case when c.id is not null and c.due_date is not null and not c.bill_paused then c.due_date else a.next_payment_due_date end,
        'reported_balance',rb.balance,'reported_on',rb.reported_on,'reported_bureau',rb.bureau,'notes',m.notes) order by a.name,a.id),'[]') into r
      from (select * from accounts where entity_id='personal' and type='Credit Card' order by name,id offset o limit l) a
      left join credit_card_meta m on m.account_id=a.id
      left join categories c on c.id=a.payment_category_id
      left join lateral (select * from credit_reported_balances b where b.account_id=a.id order by b.reported_on desc, b.id desc limit 1) rb on true; end if;
  else
    raise exception 'unknown resource %', resource;
  end if;
  return r;
end $$;
revoke all on function public.fos_sheets_data(text,text,int,int) from public;
grant execute on function public.fos_sheets_data(text,text,int,int) to anon, authenticated;

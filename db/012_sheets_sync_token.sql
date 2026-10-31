-- 012: Narrow, revocable credential for the Google Sheets sync.
-- The Apps Script holds a long random token (never your login password). The database stores only its SHA-256 hash.
-- A token is limited to ONE book (personal or business), is read-only, and is revoked by setting revoked_at (or deleting the row).
-- Additive; safe to apply before cutover. Idempotent.
create table if not exists public.sync_tokens (
  id bigint generated always as identity primary key,
  label text not null,
  entity_id text not null check (entity_id in ('personal','business')),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.sync_tokens enable row level security;
revoke all on public.sync_tokens from anon, authenticated, public;

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
  else
    raise exception 'unknown resource %', resource;
  end if;
  return r;
end $$;
revoke all on function public.fos_sheets_data(text,text,int,int) from public;
grant execute on function public.fos_sheets_data(text,text,int,int) to anon, authenticated;

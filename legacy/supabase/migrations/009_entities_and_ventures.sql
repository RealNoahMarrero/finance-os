-- Personal vs Business books + ventures (QuickBooks-style classes under the LLC).
-- Existing rows become Personal. Business starts empty until you add Relay accounts.

-- ---------------------------------------------------------------------------
-- Entities (Personal / Business)
-- ---------------------------------------------------------------------------
create table if not exists entities (
  id text primary key,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into entities (id, name, sort_order) values
  ('personal', 'Personal', 1),
  ('business', 'Business', 2)
on conflict (id) do nothing;

alter table entities enable row level security;
drop policy if exists "entities_all" on entities;
create policy "entities_all"
  on entities for all to anon, authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Ventures (under Business / Marrero LLC umbrella)
-- ---------------------------------------------------------------------------
create table if not exists ventures (
  id bigint generated always as identity primary key,
  entity_id text not null default 'business' references entities (id) on delete cascade,
  name text not null,
  notes text,
  color text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists ventures_entity_id_idx on ventures (entity_id);

alter table ventures enable row level security;
drop policy if exists "ventures_all" on ventures;
create policy "ventures_all"
  on ventures for all to anon, authenticated
  using (true) with check (true);

-- Seed starter Marrero LLC ventures (edit/rename/add in-app anytime)
insert into ventures (entity_id, name, notes, sort_order)
select v.entity_id, v.name, v.notes, v.sort_order
from (
  values
    ('business', 'Trading Treasury', 'MARRERO market trading capital engine', 10),
    ('business', 'Noah Marrero (YouTube)', 'YouTube channel', 20),
    ('business', 'Not Noah Marrero (YouTube)', 'YouTube channel', 30),
    ('business', 'The Unlikely Vegan (YouTube)', 'YouTube channel', 40),
    ('business', 'Marrero Gaming (YouTube)', 'YouTube channel', 50),
    ('business', 'SOUR by MARRERO', 'Multimedia / internal production', 60),
    ('business', 'Ora by MARRERO', 'Permanent jewelry (future)', 70),
    ('business', 'General / Overhead', 'Shared LLC overhead — optional tag; null venture also = overhead', 100)
) as v(entity_id, name, notes, sort_order)
where not exists (
  select 1 from ventures existing
  where existing.entity_id = v.entity_id and existing.name = v.name
);

-- ---------------------------------------------------------------------------
-- Scope core tables by entity
-- ---------------------------------------------------------------------------
alter table accounts
  add column if not exists entity_id text references entities (id);

alter table category_groups
  add column if not exists entity_id text references entities (id);

alter table categories
  add column if not exists entity_id text references entities (id);

alter table categories
  add column if not exists venture_id bigint references ventures (id) on delete set null;

alter table transactions
  add column if not exists entity_id text references entities (id);

alter table transactions
  add column if not exists venture_id bigint references ventures (id) on delete set null;

-- Link owner draw / contribution pairs across entities (optional)
alter table transactions
  add column if not exists linked_transaction_id bigint references transactions (id) on delete set null;

alter table transactions
  add column if not exists owner_flow text
    check (owner_flow is null or owner_flow in ('owner_draw', 'owner_contribution'));

alter table projected_income
  add column if not exists entity_id text references entities (id);

alter table projected_income
  add column if not exists venture_id bigint references ventures (id) on delete set null;

-- Backfill: everything existing is Personal
update accounts set entity_id = 'personal' where entity_id is null;
update category_groups set entity_id = 'personal' where entity_id is null;
update categories set entity_id = 'personal' where entity_id is null;
update transactions set entity_id = 'personal' where entity_id is null;
update projected_income set entity_id = 'personal' where entity_id is null;

alter table accounts alter column entity_id set default 'personal';
alter table category_groups alter column entity_id set default 'personal';
alter table categories alter column entity_id set default 'personal';
alter table transactions alter column entity_id set default 'personal';
alter table projected_income alter column entity_id set default 'personal';

alter table accounts alter column entity_id set not null;
alter table category_groups alter column entity_id set not null;
alter table categories alter column entity_id set not null;
alter table transactions alter column entity_id set not null;
alter table projected_income alter column entity_id set not null;

create index if not exists accounts_entity_id_idx on accounts (entity_id);
create index if not exists category_groups_entity_id_idx on category_groups (entity_id);
create index if not exists categories_entity_id_idx on categories (entity_id);
create index if not exists categories_venture_id_idx on categories (venture_id);
create index if not exists transactions_entity_id_idx on transactions (entity_id);
create index if not exists transactions_venture_id_idx on transactions (venture_id);
create index if not exists projected_income_entity_id_idx on projected_income (entity_id);
create index if not exists projected_income_venture_id_idx on projected_income (venture_id);

-- ---------------------------------------------------------------------------
-- Receipt / file attachments (photos + files)
-- ---------------------------------------------------------------------------
create table if not exists transaction_attachments (
  id bigint generated always as identity primary key,
  transaction_id bigint not null references transactions (id) on delete cascade,
  entity_id text not null references entities (id),
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size integer,
  created_at timestamptz not null default now()
);

create index if not exists transaction_attachments_txn_idx
  on transaction_attachments (transaction_id);

alter table transaction_attachments enable row level security;
drop policy if exists "transaction_attachments_all" on transaction_attachments;
create policy "transaction_attachments_all"
  on transaction_attachments for all to anon, authenticated
  using (true) with check (true);

-- Storage bucket for receipts (no-op if storage schema is unavailable)
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('receipts', 'receipts', false)
  on conflict (id) do nothing;

  drop policy if exists "receipts_select" on storage.objects;
  drop policy if exists "receipts_insert" on storage.objects;
  drop policy if exists "receipts_update" on storage.objects;
  drop policy if exists "receipts_delete" on storage.objects;

  create policy "receipts_select"
    on storage.objects for select to anon, authenticated
    using (bucket_id = 'receipts');

  create policy "receipts_insert"
    on storage.objects for insert to anon, authenticated
    with check (bucket_id = 'receipts');

  create policy "receipts_update"
    on storage.objects for update to anon, authenticated
    using (bucket_id = 'receipts')
    with check (bucket_id = 'receipts');

  create policy "receipts_delete"
    on storage.objects for delete to anon, authenticated
    using (bucket_id = 'receipts');
exception
  when undefined_table then
    raise notice 'storage schema not available — create receipts bucket in Supabase Dashboard';
  when insufficient_privilege then
    raise notice 'insufficient privilege for storage — create receipts bucket in Supabase Dashboard';
end $$;
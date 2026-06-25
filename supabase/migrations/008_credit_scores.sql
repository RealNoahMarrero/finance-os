-- Manual credit score history (per person, provider, and variant).
create table if not exists credit_score_entries (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  person text not null check (person in ('me', 'teria')),
  provider text not null
    check (provider in ('experian', 'credit_karma', 'chase', 'capital_one')),
  variant text,
  score int not null check (score >= 300 and score <= 850),
  recorded_date date not null,
  notes text,
  check (
    (provider = 'experian' and variant in ('1', '2', '3'))
    or (provider = 'credit_karma' and variant in ('transunion', 'equifax'))
    or (provider in ('chase', 'capital_one') and variant is null)
  ),
  check (person != 'teria' or provider != 'capital_one')
);

create index if not exists credit_score_entries_person_date_idx
  on credit_score_entries (person, recorded_date desc);

create index if not exists credit_score_entries_slot_idx
  on credit_score_entries (person, provider, variant, recorded_date desc);

alter table credit_score_entries enable row level security;

drop policy if exists "credit_score_entries_all" on credit_score_entries;
create policy "credit_score_entries_all"
  on credit_score_entries
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- Guaranteed vs anticipated expected income (planning confidence)
alter table projected_income
  add column if not exists certainty text not null default 'guaranteed'
  check (certainty in ('guaranteed', 'anticipated'));

-- Backfill: informal sources default to anticipated
update projected_income
set certainty = 'anticipated'
where source_type in ('invoice', 'other')
  and certainty = 'guaranteed';

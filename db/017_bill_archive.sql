-- 017: archive a bill without losing anything.
--   bill_archived    : true = the bill is retired. It leaves active lists; every historical payment, transaction and label stays.
--   bill_archived_at : when it was archived.
-- Archiving also sets bill_paused (done by the app), so every existing consumer of bill_paused — forecasts, reminders, overdue alerts,
-- the credit tracker — already ignores an archived bill. Purely additive: no existing row or column changes.
alter table public.categories add column if not exists bill_archived boolean not null default false;
alter table public.categories add column if not exists bill_archived_at timestamptz;

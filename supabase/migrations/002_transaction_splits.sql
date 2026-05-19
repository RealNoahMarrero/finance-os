-- Split transactions: one parent row (account movement) + line items per category
create table if not exists transaction_splits (
  id bigint generated always as identity primary key,
  transaction_id bigint not null references transactions(id) on delete cascade,
  category_id bigint not null references categories(id),
  amount numeric(12,2) not null check (amount > 0),
  sort_order int not null default 0
);

create index if not exists transaction_splits_transaction_id_idx
  on transaction_splits (transaction_id);

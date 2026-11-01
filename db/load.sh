set -e
D=/mnt/user-data/uploads/Finance/backups/db-rest-snapshot-20261031
psql -h /tmp/pg -p 5433 -U postgres -q -c "drop database if exists fos_test" -c "create database fos_test"
P="psql -h /tmp/pg -p 5433 -U postgres -d fos_test -v ON_ERROR_STOP=1 -q"
$P -f 000_supabase_stubs_and_base.sql
for t in entities ventures accounts category_groups categories transactions transaction_splits projected_income; do
cat > /tmp/load_$t.sql <<SQL
\set j \`cat $D/$t.json\`
insert into $t overriding system value select * from jsonb_populate_recordset(null::$t, :'j'::jsonb);
SQL
$P -f /tmp/load_$t.sql
done
$P -c "select setval(pg_get_serial_sequence('transactions','id'), (select max(id) from transactions))" -c "select setval(pg_get_serial_sequence('transaction_splits','id'), (select max(id) from transaction_splits))" -c "select setval(pg_get_serial_sequence('projected_income','id'), (select max(id) from projected_income))" >/dev/null
$P -c "select setval(pg_get_serial_sequence('accounts','id'), (select max(id) from accounts))" -c "select setval(pg_get_serial_sequence('categories','id'), (select max(id) from categories))" -c "select setval(pg_get_serial_sequence('category_groups','id'), (select max(id) from category_groups))" >/dev/null
$P -At -c "select 'transactions',count(*) from transactions union all select 'splits',count(*) from transaction_splits union all select 'accounts',count(*) from accounts"

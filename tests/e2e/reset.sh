#!/bin/bash
# Rebuild the isolated test DB from the verified snapshot, apply 011, create the test owner, restart PostgREST.
set -e
pkill postgrest || true; sleep 1
cd /home/claude/fos-db && bash load.sh >/dev/null
P="psql -h /tmp/pg -p 5433 -U postgres -d fos_test -v ON_ERROR_STOP=1 -q"
$P -f 011_security_and_ledger_engine.sql 2>&1 | grep -v NOTICE || true
$P -c "insert into app_owner(user_id,email) values ('11111111-1111-1111-1111-111111111111','owner@test.local')"
cd /home/claude/pgrst && (nohup ./postgrest pgrst.conf >pgrst.log 2>&1 &) ; sleep 2
curl -s -o /dev/null -w "pgrst %{http_code}\n" localhost:3000/

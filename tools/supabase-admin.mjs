#!/usr/bin/env node
// Finance OS go-live helper. Uses a Supabase access token from ./.env.admin (git-ignored) — never printed, never committed.
//   backup                  full backup (every table's rows + checksums + complete structure) and restore/rollback scripts, verified
//   verify-restore DIR      checks the connected database against a backup's checksums (used to prove a restore worked)
//   preflight               applies 011a + 012 + 011b inside a transaction that is always rolled back; reports what it saw
//   apply-a EMAIL           EARLY STEP: applies 011a + 012 (additive, old site keeps working), registers EMAIL as owner, turns off sign-ups
//   lockdown                CUTOVER STEP: applies 011b (removes all anonymous access). Run right after the V2 site is live
//   rollback DIR            EMERGENCY: undoes the lock-down using DIR/rollback.sql (old public access returns)
//   restore-data DIR --yes  EMERGENCY: replaces the current rows with the backup's rows (structure must exist)
//   sync-token ENTITY       creates a Sheets sync token for personal|business (shown once). `sync-token revoke ENTITY` revokes it
//   verify                  confirms the public (anonymous) key can no longer read the private tables
// Test mode: set FOS_LOCAL_PG to a postgres connection string to run everything against a local database instead of Supabase.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url'; import { execFileSync } from 'node:child_process';
import { tablesSql, rowsSql, countSql, md5Sql, ddlSql, preflightSql } from './admin.sql.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(here, '..');
const LOCAL = process.env.FOS_LOCAL_PG;
const envFile = path.join(root, '.env.admin');
const env = fs.existsSync(envFile) ? Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')])) : {};
const TOKEN = env.SUPABASE_ACCESS_TOKEN; const URL_ = env.NEXT_PUBLIC_SUPABASE_URL; const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!LOCAL && (!TOKEN || !URL_)) { console.error('.env.admin needs SUPABASE_ACCESS_TOKEN and NEXT_PUBLIC_SUPABASE_URL'); process.exit(1); }
const ref = URL_ ? new globalThis.URL(URL_).hostname.split('.')[0] : 'local';
const api = (p, o = {}) => fetch(`https://api.supabase.com/v1/projects/${ref}${p}`, { ...o, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(o.headers || {}) } });

async function sql(query) {
  if (LOCAL) {
    const q = query.trim().replace(/;\s*$/, ''); const isSelect = /^(select|with)\b/i.test(q);
    try {
      if (isSelect) { const out = execFileSync('psql', [LOCAL, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', `copy (select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) from (${q}) q) to stdout`], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }); return JSON.parse(out.replace(/\\\\/g, '\\')); }
      execFileSync('psql', [LOCAL, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] }); return [];
    } catch (e) { throw new Error(String(e.stderr || e.message)); }
  }
  const r = await api('/database/query', { method: 'POST', body: JSON.stringify({ query }) });
  const text = await r.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) { const e = new Error(typeof body === 'object' ? body.message ?? text : text); e.status = r.status; throw e; }
  return body;
}
const mig = (f) => fs.readFileSync(path.join(root, 'db', f), 'utf8');
const A = () => mig('011a_additive_ledger_engine.sql') + '\n' + mig('012_sheets_sync_token.sql'); const B = () => mig('011b_lock_down_access.sql');
const backups = path.resolve(root, '..', 'backups');
const latestBackup = () => fs.existsSync(backups) ? fs.readdirSync(backups).filter((d) => d.startsWith('db-full-') && fs.existsSync(path.join(backups, d, '_manifest.json'))).sort().pop() : undefined;
const sections = (rows) => { const m = {}; for (const r of rows) (m[r.sec] ||= []).push(r.stmt); return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { count: v.length, md5: crypto.createHash('md5').update(v.join('|')).digest('hex') }])); };
const dollar = (s) => { let tag = 'fosj'; while (s.includes(`$${tag}$`)) tag += 'x'; return `$${tag}$${s}$${tag}$`; };
const cmd = process.argv[2];

// Statements that put the original (pre-lock-down) access rules back. Generated from the live catalog at backup time.
const rollbackSql = `with t as (select c.oid, c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p'))
select stmt from (
  select 1 o, format('drop policy if exists owner_all on public.%I;', relname) stmt from t
  union all select 2, format('drop policy if exists %I on public.%I;', policyname, tablename) from pg_policies where schemaname='public'
  union all select 3, format('create policy %I on public.%I as %s for %s to %s%s%s;', policyname, tablename, lower(permissive), cmd, array_to_string(roles, ', '),
      case when qual is not null then ' using (' || qual || ')' else '' end, case when with_check is not null then ' with check (' || with_check || ')' else '' end) from pg_policies where schemaname='public'
  union all select 4, format('alter table public.%I %s row level security;', relname, case when relrowsecurity then 'enable' else 'disable' end) from t
) x order by o, stmt`;

if (cmd === 'backup') {
  const dir = path.join(backups, `db-full-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`); fs.mkdirSync(dir, { recursive: true });
  let tables = (await sql(tablesSql)).map((r) => r.name);
  const fks = await sql(`select cl.relname as child, fr.relname as parent from pg_constraint co join pg_class cl on cl.oid=co.conrelid join pg_class fr on fr.oid=co.confrelid join pg_namespace n on n.oid=cl.relnamespace where co.contype='f' and n.nspname='public' and fr.relnamespace=n.oid and cl.oid<>fr.oid`);
  const ordered = []; const seen = new Set(); const visit = (t, stack = []) => { if (seen.has(t) || stack.includes(t)) return; for (const f of fks.filter((x) => x.child === t)) visit(f.parent, [...stack, t]); seen.add(t); ordered.push(t); };
  tables.forEach((t) => visit(t)); tables = ordered; const manifest = { created: new Date().toISOString(), tables: {}, ddl: {} }; const data = {}; const bad = [];
  for (const t of tables) {
    const rows = (await sql(rowsSql(t)))[0].rows; const n = (await sql(countSql(t)))[0].n; const md5 = (await sql(md5Sql(t)))[0].md5;
    fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(rows)); data[t] = rows; manifest.tables[t] = { rows: rows.length, md5 };
    if (rows.length !== n) bad.push(`${t}: saved ${rows.length}, database says ${n}`);
    console.log(`${t.padEnd(26)} ${String(rows.length).padStart(6)} rows`);
  }
  const ddl = await sql(ddlSql); manifest.ddl = sections(ddl);
  const ddlText = (lo, hi) => ddl.filter((r) => r.sec >= lo && r.sec <= hi).map((r) => r.stmt).join('\n');
  fs.writeFileSync(path.join(dir, 'schema.sql'), ddl.map((r) => r.stmt).join('\n') + '\n');
  const preamble = `-- Restore into an EMPTY database (a new Supabase project's SQL editor, or an isolated Postgres). Rebuilds structure, rows, policies and functions.
-- Login accounts (Supabase Auth) are not part of this backup: after restoring into a new project, create your login again and run: insert into app_owner (user_id,email) select id,email from auth.users where email='YOU';
do $r$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $r$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
do $r2$ begin if to_regprocedure('auth.uid()') is null then
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
end if; end $r2$;
`;
  const load = (t) => data[t].length ? `insert into public."${t}" overriding system value select * from jsonb_populate_recordset(null::public."${t}", ${dollar(JSON.stringify(data[t]))}::jsonb);\n` : '';
  const stubUsers = data.app_owner?.length ? `insert into auth.users (id,email) select user_id,email from public.app_owner on conflict do nothing;\n` : '';
  fs.writeFileSync(path.join(dir, 'restore.sql'), `${preamble}begin;\n${ddlText(10, 20)}\n${tables.map(load).join('')}${stubUsers}${ddlText(40, 101)}\n${ddlText(110, 110)}\ncommit;\n`);
  fs.writeFileSync(path.join(dir, 'restore-data.sql'), `-- Puts the saved ROWS back into the existing tables of THIS project (structure must already exist). Replaces current rows.\nbegin;\ntruncate ${tables.map((t) => `public."${t}"`).join(', ')} restart identity cascade;\n${tables.map(load).join('')}${ddlText(110, 110)}\ncommit;\n`);
  const rb = (await sql(rollbackSql)).map((r) => r.stmt);
  fs.writeFileSync(path.join(dir, 'rollback.sql'), `-- EMERGENCY: undoes the lock-down (011b). Restores the original row-security rules and public access that existed when this backup was taken.\n-- This re-opens the old public access. Use only if V2 cannot be made to work and you are reverting to the previous site.\nbegin;\n${rb.join('\n')}\n${ddlText(100, 101)}\ncommit;\n`);
  fs.writeFileSync(path.join(dir, '_manifest.json'), JSON.stringify(manifest, null, 1));
  if (bad.length) { console.error('BACKUP MISMATCH', bad); process.exit(2); }
  console.log(`\nBackup verified (rows saved = rows in database, checksums recorded): ${dir}\nFiles: <table>.json, schema.sql, restore.sql, restore-data.sql, rollback.sql, _manifest.json`);
} else if (cmd === 'verify-restore') {
  const dir = path.resolve(process.argv[3] || ''); const manifest = JSON.parse(fs.readFileSync(path.join(dir, '_manifest.json'), 'utf8')); let fail = 0;
  for (const [t, m] of Object.entries(manifest.tables)) {
    const n = (await sql(countSql(t)))[0].n; const md5 = (await sql(md5Sql(t)))[0].md5; const ok = n === m.rows && md5 === m.md5; if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${t.padEnd(26)} rows ${n}/${m.rows}  contents ${md5 === m.md5 ? 'identical' : 'DIFFERENT'}`);
  }
  const now = sections(await sql(ddlSql)); const names = { 10: 'sequences', 20: 'tables+columns', 50: 'keys/checks', 60: 'foreign keys', 70: 'indexes', 80: 'row security on', 81: 'row security forced', 82: 'policies', 40: 'functions', 91: 'views', 92: 'triggers', 100: 'table grants', 101: 'function grants', 110: 'id counters' };
  for (const [sec, m] of Object.entries(manifest.ddl)) { const ok = now[sec]?.md5 === m.md5; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  structure ${(names[sec] || sec).padEnd(20)} ${now[sec]?.count ?? 0}/${m.count} items`); }
  console.log(fail ? `\n${fail} check(s) FAILED` : '\nRestore verified: every table, row, policy, function and index matches the backup.'); process.exit(fail ? 5 : 0);
} else if (cmd === 'preflight') {
  try { await sql(preflightSql(A() + '\n' + B())); console.log('Unexpected: preflight did not raise'); }
  catch (e) { const ok = /PREFLIGHT_OK/.test(e.message); console.log(ok ? `Preflight passed (nothing was changed): ${e.message.match(/PREFLIGHT_OK.*/)[0]}` : `Preflight FAILED — nothing was changed:\n${e.message}`); process.exit(ok ? 0 : 3); }
} else if (cmd === 'apply-a') {
  const email = (process.argv[3] || '').replace(/'/g, '');
  if (!email.includes('@')) { console.error('usage: apply-a you@example.com'); process.exit(1); }
  const b = latestBackup(); if (!b) { console.error('No verified backup found. Run: node tools/supabase-admin.mjs backup'); process.exit(6); }
  const man = JSON.parse(fs.readFileSync(path.join(backups, b, '_manifest.json'), 'utf8')); const stale = [];
  for (const [t, m] of Object.entries(man.tables)) { const n = (await sql(countSql(t)))[0].n; if (n !== m.rows) stale.push(`${t}: backup ${m.rows}, now ${n}`); }
  if (stale.length) { console.error(`The latest backup (${b}) is out of date:\n${stale.join('\n')}\nRun backup again first.`); process.exit(6); }
  const found = LOCAL ? [{}] : await sql(`select id from auth.users where lower(email)=lower('${email}')`);
  if (found.length !== 1) { console.error(`No Supabase login found for ${email}. Create it first (Authentication → Users → Add user).`); process.exit(4); }
  await sql(`begin;\n${A()}\ninsert into public.app_owner (user_id, email) select id, email from auth.users where lower(email)=lower('${email}') on conflict (user_id) do nothing;\ncommit;`);
  console.log(`Early step applied (backup ${b} matched). Old site is unaffected. Owner registered:`, JSON.stringify(await sql('select email from public.app_owner')));
  if (!LOCAL) { const r = await api('/config/auth', { method: 'PATCH', body: JSON.stringify({ disable_signup: true }) }); console.log(r.ok ? 'Public sign-ups turned off.' : `Could not turn off sign-ups automatically (${r.status}) — do it in Authentication → Sign In / Providers.`); }
} else if (cmd === 'lockdown') {
  const b = latestBackup(); if (!b) { console.error('No verified backup found. Run backup first.'); process.exit(6); }
  const has = await sql(`select to_regclass('public.app_owner') is not null as ok, (select count(*) from public.app_owner)::int as n`).catch(() => [{ ok: false }]);
  if (!has[0].ok || !has[0].n) { console.error('Run apply-a first (the owner must be registered before access is locked).'); process.exit(7); }
  await sql(`begin;\n${B()}\ncommit;`);
  console.log(`Lock-down applied. Undo (emergency only): node tools/supabase-admin.mjs rollback ${path.join(backups, b)}`);
  if (!LOCAL) { for (const t of ['accounts', 'transactions']) { const r = await fetch(`${URL_}/rest/v1/${t}?select=id&limit=1`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }); const body = await r.text(); console.log(`${t}: anonymous read -> HTTP ${r.status} ${r.status === 200 && body !== '[]' ? 'STILL READABLE (problem!)' : 'blocked (good)'}`); } }
} else if (cmd === 'rollback') {
  const dir = path.resolve(process.argv[3] || ''); await sql(fs.readFileSync(path.join(dir, 'rollback.sql'), 'utf8')); console.log('Lock-down undone: original access rules restored from', dir);
} else if (cmd === 'restore-data') {
  const dir = path.resolve(process.argv[3] || ''); if (process.argv[4] !== '--yes') { console.error('This REPLACES all current rows with the backup in ' + dir + '. Re-run with --yes to confirm.'); process.exit(1); }
  await sql(fs.readFileSync(path.join(dir, 'restore-data.sql'), 'utf8')); console.log('Rows restored from', dir, '— now run: node tools/supabase-admin.mjs verify-restore', dir);
} else if (cmd === 'sync-token') {
  const revoke = process.argv[3] === 'revoke'; const ent = revoke ? process.argv[4] : process.argv[3];
  if (!['personal', 'business'].includes(ent)) { console.error('usage: sync-token personal|business   or   sync-token revoke personal|business'); process.exit(1); }
  if (revoke) { await sql(`update public.sync_tokens set revoked_at = now() where entity_id='${ent}' and revoked_at is null`); console.log(`All ${ent} sync tokens revoked.`); }
  else {
    await sql(`update public.sync_tokens set revoked_at = now() where entity_id='${ent}' and revoked_at is null`);
    const tok = crypto.randomBytes(32).toString('hex'); const hash = crypto.createHash('sha256').update(tok).digest('hex');
    await sql(`insert into public.sync_tokens (label, entity_id, token_hash) values ('Google Sheets (${ent})', '${ent}', '${hash}')`);
    console.log(`Sync token for the ${ent} sheet (shown ONCE — paste it into Apps Script → Script properties → SYNC_TOKEN; older ${ent} tokens are now revoked):\n\n${tok}\n`);
  }
} else if (cmd === 'verify') {
  for (const t of ['accounts', 'transactions']) {
    const r = await fetch(`${URL_}/rest/v1/${t}?select=id&limit=1`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
    const body = await r.text(); console.log(`${t}: anonymous read -> HTTP ${r.status} ${r.status === 200 && body !== '[]' ? 'STILL READABLE (problem!)' : 'blocked / empty (good)'}`);
  }
} else { console.log('commands: backup | verify-restore DIR | preflight | apply-a EMAIL | lockdown | rollback DIR | restore-data DIR --yes | sync-token [revoke] personal|business | verify'); }

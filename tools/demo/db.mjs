// In-process Postgres (PGlite, WASM — no Docker, no network) loaded with the REAL migrations in db/ and the synthetic fixture.
// Used by the live demo server and by SQL tests. Nothing here ever touches Supabase or production data.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tables } from './fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEMO_UID = '00000000-0000-0000-0000-0000000000d1';
export const MIGRATIONS = ['000_supabase_stubs_and_base', '011a_additive_ledger_engine', '011b_lock_down_access', '012_sheets_sync_token', '013_bill_anchor_and_pause', '014_credit_tracker', '015_bill_amount', '016_account_management', '017_bill_archive'];
const EXTRA = (process.env.DEMO_EXTRA_MIGRATIONS || '').split(',').filter(Boolean);

const q = (id) => { if (!/^[a-z_][a-z0-9_]*$/i.test(id)) throw new Error(`bad identifier ${id}`); return `"${id}"`; };

export async function createDb({ seed = true } = {}) {
  const db = new PGlite();
  for (const f of [...MIGRATIONS, ...EXTRA]) await db.exec(fs.readFileSync(path.join(root, 'db', `${f}.sql`), 'utf8'));
  if (seed) await seedDemo(db);
  return db;
}

export async function seedDemo(db) {
  await db.exec(`insert into entities (id, name) values ('personal', 'Personal') on conflict do nothing; insert into app_owner (user_id, email) values ('${DEMO_UID}', 'demo@example.test') on conflict do nothing;`);
  const order = ['accounts', 'category_groups', 'categories', 'transactions', 'transaction_splits', 'projected_income', 'account_baselines', 'account_reconciliations', 'bill_payments', 'credit_scores', 'credit_card_meta', 'credit_reported_balances'];
  for (const t of order) {
    for (const row of tables[t] ?? []) {
      const cols = Object.keys(row).filter((c) => row[c] !== undefined);
      await db.query(`insert into ${q(t)} (${cols.map(q).join(',')}) overriding system value select ${cols.map(q).join(',')} from json_populate_record(null::${q(t)}, $1::json)`, [JSON.stringify(row)]);
    }
  }
  for (const [t] of [['accounts'], ['category_groups'], ['categories'], ['transactions'], ['transaction_splits'], ['projected_income'], ['account_baselines'], ['account_reconciliations'], ['bill_payments'], ['credit_scores'], ['credit_reported_balances']]) {
    await db.query(`select setval(pg_get_serial_sequence('${t}', 'id'), coalesce((select max(id) from ${q(t)}), 1))`);
  }
  // make each opening balance agree with the recorded balance so the demo starts reconciled (no drift banners unless a test creates one)
  await db.exec(`update account_baselines b set opening_balance = round(a.balance - (fos_derived_balance(a.id) - b.opening_balance), 2) from accounts a where a.id = b.account_id`);
}

/** Run fn inside a transaction as the signed-in owner (role "authenticated", JWT sub = demo user). */
export async function asOwner(db, fn, uid = DEMO_UID) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role authenticated`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    return fn(tx);
  });
}

// ── a small PostgREST-compatible surface: just what supabase-js calls in this app ──
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
function where(params, args) {
  const parts = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const m = /^(\w+)\.(.*)$/.exec(v); if (!m) continue;
    const [, op, val] = m;
    if (op === 'is') parts.push(`${q(k)} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`);
    else if (op === 'in') { const items = val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')); args.push(items); parts.push(`${q(k)}::text = any($${args.length}::text[])`); }
    else if (OPS[op]) { args.push(val); parts.push(`${q(k)}::text ${op === 'eq' || op === 'neq' ? OPS[op] : OPS[op]} $${args.length}`.replace(/::text (>|>=|<|<=)/, ' $1').replace(/ (>|>=|<|<=) \$(\d+)$/, ' $1 $$$2::' + 'numeric')); }
  }
  return parts.length ? ` where ${parts.join(' and ')}` : '';
}
const fnCache = new Map();
async function fnArgs(tx, name) {
  if (!fnCache.has(name)) {
    const r = await tx.query(`select proargnames, proargtypes::oid[]::int[] as t from pg_proc where pronamespace = 'public'::regnamespace and proname = $1 limit 1`, [name]);
    if (!r.rows.length) throw Object.assign(new Error(`function ${name} not found`), { code: 'PGRST202' });
    const types = []; for (const oid of r.rows[0].t) types.push((await tx.query(`select format_type($1::oid, null) as n`, [oid])).rows[0].n);
    fnCache.set(name, { names: r.rows[0].proargnames ?? [], types });
  }
  return fnCache.get(name);
}

/** Handle one REST call; returns { status, body }. */
export async function rest(db, { method, table, rpc, params, body, prefer = '', single = false }) {
  try {
    return await asOwner(db, async (tx) => {
      if (rpc) {
        const { names, types } = await fnArgs(tx, rpc);
        const args = []; const named = [];
        names.forEach((n, i) => { if (body && n in body) { const v = body[n]; args.push(types[i] === 'jsonb' || types[i] === 'json' ? JSON.stringify(v) : v === null ? null : String(v)); named.push(`${q(n)} => $${args.length}::${types[i]}`); } });
        const r = await tx.query(`select to_jsonb(public.${q(rpc)}(${named.join(', ')})) as r`, args);
        return { status: 200, body: r.rows[0].r };
      }
      const args = [];
      const w = where(params, args);
      const sel = params.get('select');
      const cols = !sel || sel === '*' ? '*' : sel.split(',').map(q).join(', ');
      const ret = (alias = 'x') => `select coalesce(jsonb_agg(to_jsonb(${alias})), '[]'::jsonb) as r from `;
      const wantRows = prefer.includes('return=representation');
      if (method === 'GET') {
        let ord = ''; const o = params.get('order'); if (o) ord = ' order by ' + o.split(',').map((p) => { const [c, d] = p.split('.'); return `${q(c)} ${d === 'desc' ? 'desc' : 'asc'}`; }).join(', ');
        const lim = params.get('limit') ? ` limit ${Number(params.get('limit'))}` : ''; const off = params.get('offset') ? ` offset ${Number(params.get('offset'))}` : '';
        const r = await tx.query(`${ret('x')}(select ${cols} from ${q(table)}${w}${ord}${lim}${off}) x`, args);
        const rows = r.rows[0].r; return { status: 200, body: single ? rows[0] ?? null : rows };
      }
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body]; const out = [];
        for (const row of rows) {
          const keys = Object.keys(row); const a = [JSON.stringify(row)];
          let sql = `insert into ${q(table)} (${keys.map(q).join(',')}) select ${keys.map(q).join(',')} from json_populate_record(null::${q(table)}, $1::json)`;
          const oc = params.get('on_conflict');
          if (oc && prefer.includes('merge-duplicates')) sql += ` on conflict (${oc.split(',').map(q).join(',')}) do update set ${keys.filter((k) => !oc.split(',').includes(k)).map((k) => `${q(k)} = excluded.${q(k)}`).join(', ')}`;
          const r = await tx.query(`with x as (${sql} returning ${cols}) select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as r from x`, a);
          out.push(...r.rows[0].r);
        }
        return wantRows ? { status: 201, body: single ? out[0] : out } : { status: 201, body: null };
      }
      if (method === 'PATCH') {
        const keys = Object.keys(body); args.unshift(JSON.stringify(body));
        const wr = where(params, []); // rebuild with shifted placeholders
        const a2 = [JSON.stringify(body)]; const w2 = where(params, a2);
        const r = await tx.query(`with x as (update ${q(table)} set ${keys.map((k) => `${q(k)} = (json_populate_record(null::${q(table)}, $1::json)).${q(k)}`).join(', ')}${w2} returning ${cols}) select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as r from x`, a2);
        void wr; return wantRows ? { status: 200, body: single ? r.rows[0].r[0] : r.rows[0].r } : { status: 204, body: null };
      }
      if (method === 'DELETE') {
        const r = await tx.query(`with x as (delete from ${q(table)}${w} returning ${cols}) select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as r from x`, args);
        return wantRows ? { status: 200, body: r.rows[0].r } : { status: 204, body: null };
      }
      return { status: 405, body: { message: 'method not allowed' } };
    });
  } catch (e) {
    const code = e.code && /^[0-9A-Z]{5}$/.test(e.code) ? e.code : 'P0001';
    return { status: e.code === 'PGRST202' ? 404 : code === '42501' ? 403 : 400, body: { code, message: String(e.message), details: null, hint: null } };
  }
}

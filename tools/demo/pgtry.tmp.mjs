import { PGlite } from '@electric-sql/pglite'; import fs from 'node:fs';
const db = new PGlite();
for (const f of ['000_supabase_stubs_and_base', '011a_additive_ledger_engine', '011b_lock_down_access', '013_bill_anchor_and_pause', '014_credit_tracker', '015_bill_amount', '016_account_management', '017_bill_archive']) {
  try { await db.exec(fs.readFileSync(`db/${f}.sql`, 'utf8')); console.log('ok', f); } catch (e) { console.log('FAIL', f, String(e.message).slice(0, 200)); }
}
console.log((await db.query('select count(*) from pg_proc where proname like $1', ['fos_%'])).rows);

# Finances 2.0 — release readiness (local `finances-2.0`; nothing deployed)

## Verification (synthetic data, real SQL on PGlite)
| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` — 49 original calculation tests + 14 new model tests (`tests/pass2.test.ts`) + 28 real-SQL tests (`tests/sql.test.mjs`) | 91/91 pass |
| `npm run test:browser` — 20 routes × desktop/phone × light/dark-capable, errors/overflow/empty/zero writes | 0 failures |
| `npm run test:flows` — 14 click-through workflows against the live synthetic backend | 14/14 pass |
| `npm run build` | pass; main bundle 698 KB (was 756 KB), Insights/Accounts/Settings load on demand |

## What changed functionally (all covered by the tests above)
- **One payment path** (`fos_pay_bill_v2`, atomic, idempotent by request id): record a payment, link an already-recorded transaction (never duplicates), or mark paid elsewhere (no transaction). Applies the account, envelope and debt effects together and advances the schedule. Partial payments keep the bill due; overpayments settle it; backdated payments keep their date; missed payments are paid oldest-first; undo restores due date, debt and (when it created one) the transaction. Debts now reduce from every entry point, including Add transaction.
- **Missed bills**: one row with a count; envelope money is counted once across occurrences. Forecast chart and event list read one shared obligations function (a 44-day-old miss is no longer dropped).
- **Scheduled transactions** (`status='scheduled'`): no balance/envelope effect until `fos_post_due(today)` posts them (called on every app load; idempotent). Edit/delete/convert are safe. Existing rows, including any already future-dated, stay `posted`, exactly as recorded.
- **Recurring income**: monthly keeps the original day (anchor); semimonthly is the 1st and 16th moved off weekends — identical in SQL and the app.
- **Server-enforced budget rules**: move cannot exceed what the source holds; assign cannot exceed Ready to Assign or take a category below $0.
- **Atomic operations**: add account + opening balance, set opening balances, archive/restore bill (+category), pause/resume (touches only those columns), skip/unskip income (returns the exact row — no guessing). Edit-one-occurrence of income rolls back the skip if the replacement fails.
- **Stored group kind** (backfilled from today's names, so behaviour is unchanged on day one).
- Removed from the UI: Reminder-vs-Prepare, "Pays from" (was not a real setting), the always-empty planned-items card, hard-coded forecast text, "Infinity" runway.

## Release procedure (needs your explicit approval at each production step)
1. `db/inventory_future_dated.sql` — read-only; keep its output.
2. Fresh backup: `node tools/supabase-admin.mjs backup` (foreground, ~3 min); confirm it verifies.
3. `node tools/supabase-admin.mjs migrate db/018_payments_scheduling_recurrence.sql --dry`, then without `--dry`, then `verify`; re-run the reference counts in the inventory file (must be identical).
4. Merge `finances-2.0` → `main` (Netlify deploys). Order matters: **migration first, app second.** The current production app keeps working after 018.
5. Rollback: Netlify "Publish previous deploy" for the app; 018's header lists the exact statements to drop its additions (no financial data is changed by it).

## Known limits / deferred (honest list)
- **Existing future-dated rows** are not converted to scheduled (cannot be proven safe automatically); they show under "Future-dated · already counted". New ones schedule correctly.
- **Existing monthly incomes that already drifted** (e.g. now on the 28th) are not rewritten; only new occurrences use the anchor. Edit the date once to re-anchor.
- **Stale tabs**: pause/resume can no longer overwrite other fields, but general edits (e.g. Edit bill) are still last-write-wins; no version column was added. Reload-on-focus after 90 s is unchanged.
- **Audit trail** for non-ledger edits (targets, bill edits, debt balance edits) was not added.
- **Every write still reloads all tables** (correctness over speed); only the bundle was split.
- Partial payments are not itemised (no running "paid so far" on the bill row); the transaction and debt reduction are recorded.
- Not verified: real production data, the Apps Script trigger, Netlify, MFA/CSP/token rotation (decisions left to you).
- No real backup was restored into the local database; SQL tests use the synthetic fixture only.

---

## Release preparation status (2026-11-10)

**Blocked: the Supabase access token in `.env.admin` is rejected by Supabase ("Invalid access token").** The production inventory, the fresh backup, `verify-restore` and `migrate` all go through that token, so none could be run. No production query, backup or change was made. To unblock: create a new token (Supabase → Account → Access Tokens), paste it into `.env.admin` (`SUPABASE_ACCESS_TOKEN=`), then run the steps in the procedure above. (Nothing else in the app or deploy depends on it.)

Done instead, without touching production:
- **Compatibility of 018 with real records** — the newest existing local backup (`backups\db-full-2026-11-06T21-42-52`: 8 accounts, 69 categories, 2,118 transactions, 281 expected incomes, 18 debts, 1 payment) was loaded into an in-memory Postgres, migrations through 017 applied, then 018. Every record is identical before and after (counts, account balances, envelope and debt sums, and content hashes of accounts, categories, transactions, income and payments); all 2,118 transactions stay `posted`; all 18 groups get a kind matching today's names. A pay→undo round trip on all 33 real scheduled bills restores everything exactly. This test found and fixed one real bug (undo over-restored a debt when a payment exceeded the balance; 018 now records the amount actually applied).
- **Read-only preview of real data** (below).
- Local tests: 93 unit/SQL tests, 14 workflow flows, 20-route browser check, 4 read-only guard checks — all pass.

## Read-only preview with your real data (no migration, no production writes)
1. Create `.env.realpreview.local` in the repo root (git-ignored) with the same two public values Netlify uses, plus the flag:
```
NEXT_PUBLIC_SUPABASE_URL=<your project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your public anon key>
VITE_READONLY=1
```
2. `npm run preview:real` → http://localhost:5181, sign in with your normal password.
The app shows a "Read-only preview" banner. Every request that could change data is refused inside the browser before it is sent (only reads, the owner check and sign-in are allowed); `npm run test:readonly` proves this against a backend that would otherwise accept the writes. It uses the current production schema, so Pay, scheduling and the other 018-dependent actions show an error instead of saving; everything is browsable.

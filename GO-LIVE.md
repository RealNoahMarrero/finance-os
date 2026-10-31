# Finance OS v2 — go-live runbook
Site: https://marrero-finance.netlify.app/ (existing Netlify site and GitHub repo are kept). All commands run from this folder.

## What is already proven (isolated test copy of your real data)
- Database logic: 37/37 checks. Calculations: 12/12. Browser flows and mobile layout: pass. Google Sheets script: 1,990 personal + 61 business transactions read correctly through the new token.
- **Backup is restorable.** `backup` writes every table's rows + checksums + the full structure (tables, keys, indexes, policies, functions, views, grants). It was restored into an empty database: every table, row, policy and function matched (`verify-restore` = all PASS), and the 37 ledger checks passed on the restored copy.
- **Rollback works.** After lock-down, `rollback` put the original access rules back exactly (policies and row-security flags identical to before).
- `restore-data` repairs deleted/damaged rows from the backup (tested).

## Why downtime is near zero
The security migration is split in two:
- **011a + 012 (early, additive):** new tables, functions, owner list, sync-token endpoint. The old site doesn't use any of it, so it keeps working. V2 preview can already log in against real data.
- **011b (at cutover, ~1 second):** turns on owner-only access for the original tables and blocks anonymous access. Run it the moment V2 is live.
Order at cutover: merge the PR → Netlify shows "Published" (V2 live, ~2 min) → run 011b. The old site keeps working until V2 is live, and V2 is already working before 011b runs, so there is no moment where neither site works.

## Steps (Claude runs the commands; you do the account-only parts — see the checklist in chat)
1. Supabase: create your login (Authentication → Users → Add user), turn off public sign-ups.
2. `node tools/supabase-admin.mjs backup` → note the folder name. Keep it: its `rollback.sql` is the undo for step 6.
3. `node tools/supabase-admin.mjs preflight` (dry run, changes nothing) then `apply-a you@email`.
4. Open the Netlify deploy preview of the PR; log in; check Overview/Budget/Transactions show your data.
5. `sync-token personal` and `sync-token business` → paste each token into the matching Apps Script (script properties SYNC_TOKEN), run `testSupabaseAuth`, then Sync Latest Data.
6. Cutover: merge the PR → wait for Netlify "Published" → `node tools/supabase-admin.mjs lockdown` → `verify` (anonymous read must be blocked).
7. Enter opening balances on each account's reconciliation screen.

## If something goes wrong
- V2 problem after merge: Netlify → Deploys → pick the previous deploy → "Publish deploy" (instant). Then, only if you want the old public access back: `node tools/supabase-admin.mjs rollback <backup folder>`.
- Rows damaged: `node tools/supabase-admin.mjs restore-data <backup folder> --yes`, then `verify-restore <backup folder>`.
- Whole project lost: run `restore.sql` from the backup folder in an empty Supabase project (re-create your login, then register it with the one-line note at the top of that file).
- Revoke a Sheets token any time: `node tools/supabase-admin.mjs sync-token revoke personal` (or business).
Nothing in the migrations deletes or rewrites existing rows.

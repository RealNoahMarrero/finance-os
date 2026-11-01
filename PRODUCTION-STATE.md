# Finance OS V2 — production state (2026-10-31)

Site: https://marrero-finance.netlify.app/ (existing Netlify site; GitHub repo RealNoahMarrero/finance-os, V2 merged to `main` via PR #1; previous app kept in `legacy/`).

## Security state (verified after cutover)
- Finance tables (accounts, category_groups, categories, transactions, transaction_splits, projected_income, entities, ventures, transaction_attachments, account_baselines, account_reconciliations, bill_payments, expected_income_skips, app_owner, sync_tokens): row security on, single policy `owner_all` for the registered owner only; no access for the public (anon) key.
- Owner: realnoahmarrero@gmail.com (table `app_owner`). Other Supabase logins see no Finance data. Public sign-ups left enabled because the project is shared with other apps.
- Ledger functions (`fos_*`): executable by signed-in users only (and each checks the owner). Exception: `fos_sheets_data`, which is read-only and answers only to a valid sync token.
- Google Sheets: one revocable read-only token per book (`personal`, `business`), stored only as a SHA-256 hash in `sync_tokens`. Revoke/rotate: `node tools/supabase-admin.mjs sync-token [revoke] personal|business`. Current tokens are in the git-ignored local file `sync-tokens.local`.
- Other apps in the shared project (media, savings, shopping, recipes, wardrobe, …): untouched. Their 381 table/function grants and their policies were compared before and after the lock-down and are identical.

## Data
- 2,051 transactions preserved (1,990 Personal + 61 Business); contents identical to the pre-lock-down backup. Migrations never delete or rewrite rows.

## Backups and recovery (kept)
- `Projects\Finance\backups\db-full-2026-10-31T23-47-51` — full project backup taken right before cutover, checksummed and proven restorable in an empty database. Keep it. Contains `restore.sql` (empty database), `restore-data.sql` (replace rows), `rollback.sql` (undo the lock-down), `_manifest.json`.
- Earlier safety copies: `db-rest-snapshot-20261031`, `db-full-2026-10-31T23-28-04`, code snapshot + uncommitted-changes patch.
- Recover: bad site deploy → Netlify "Publish previous deploy"; damaged rows → `restore-data <folder> --yes` then `verify-restore <folder>`; emergency undo of lock-down → `rollback <folder>` (reopens old public access — only if reverting to the old site).

## Open items
- Owner to confirm production login and Personal Sheets sync; business sheet setup; enter opening balances in the reconciliation screen.

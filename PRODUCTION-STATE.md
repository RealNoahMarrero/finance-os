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

## Update — bill editing, month-end anchor, pause (applied 2026-11-01)
- Migration `db/013_bill_anchor_and_pause.sql` applied to production (additive; Finance table `categories` only): new columns `bill_anchor`, `bill_paused`; new function `fos_bill_next` (authenticated only); `fos_pay_bill` now advances recurring dates from the anchor (31st → Feb 28/29 → Mar 31; yearly Feb 29 handled). No policies or other apps touched; 2,051 transactions unchanged. Pre-migration backup: `backups\db-full-2026-11-01T00-28-24`.
- App: Edit bill sheet, All bills list, Active/Paused (paused bills leave upcoming bills, overdue alerts, forecasts and funding prompts; history kept).

## Credit Score & Utilization tracker (migration 014)
- Applied to production 2026-11-01 after a verified backup (db-full-2026-11-01T00-51-21). Additive only: new tables `credit_scores`, `credit_card_meta`, `credit_reported_balances` (owner-only RLS `owner_all`, anon revoked, verified HTTP 401) and `fos_sheets_data` extended with `credit_scores` / `credit_cards` (personal token only). No existing grant, policy or row changed; 2,051 transactions intact.
- Credit limits stay in `accounts.credit_limit`; payment due dates come from the linked bill (`categories.due_date`) — nothing duplicated.
- Google Sheets: paste the updated `scripts/google-sheets-sync.gs` into the Personal sheet's Apps Script; it adds `CreditScores` and `CreditCards` tabs. Hourly trigger unchanged.
- App: Credit page (`#/credit`), sidebar entry; mobile via the More sheet.

## Debt categories restored (no database change)
- Cause: V2's category sheet and Budget list never read the `is_debt` / `balance` columns, so debts looked like empty envelopes. The data itself was never touched: all 18 `is_debt` rows are byte-identical in the earliest pre-redesign backup and in production (e.g. AfterPay $223.86). Bill editing / migration 013 did not change them.
- Dave - Teria was never flagged as a debt (is_debt=false, balance 0 in the original data) — it is a plain bill; it can now be switched on with "Track as debt".
- Fix is UI-only: debt section on the category sheet, "Owes $X" pill in Budget, Edit debt (plain update of `categories.is_debt/balance`; no transactions, accounts, funding or bills touched), Edit buttons on the Accounts loans list.

## Unified category + bill creation (migration 015)
- Applied 2026-11-01 after verified backup db-full-2026-11-01T01-47-02. Adds nullable `categories.bill_amount` (payment amount, separate from the `target_amount` funding target; NULL = same as target, so every existing bill is unchanged) and updates `fos_pay_bill` to use it. No policy/grant changes; 2,051 transactions and 18 debts intact; anon still blocked.
- App: New category form (Bills groups: scheduled bill vs funding only), Edit category (name/emoji/group), scheduled-bill section on the category sheet (add/edit/pause/resume/remove with confirmation), mobile entry via More → New category or bill.

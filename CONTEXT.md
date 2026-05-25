# FINANCE OS - PROJECT CONTEXT



**Tech Stack:** Next.js 16 (App Router), Tailwind CSS v4, Supabase, Framer Motion, Recharts, Radix UI, Vaul (sheets), next-themes.



**Styling:** Premium Apple Card / Monzo-inspired UI — adaptive light/dark via CSS variables and `next-themes`, glass cards (`.app-card`, `.app-card-subtle`), theme-aware inputs (`.app-input`, `.app-select`), large typography (Plus Jakarta Sans), emerald/red semantic accents. Mobile-first with bottom navigation (Android-primary) and desktop top bar. Centered content uses `max-w-6xl mx-auto` in AppShell (intentional on wide screens).



## 1. CORE PHILOSOPHY



Finance OS is a custom, manual-entry financial platform designed to replace YNAB. Zero-Based Budgeting ("Ready to Assign") with future forecasting and dynamic subscription/debt tracking.



## 2. DATABASE SCHEMA (Supabase)



Core tables: `accounts`, `category_groups`, `categories`, `transactions`, **`projected_income`**, **`transaction_splits`**.



| Migration | Purpose |

|-----------|---------|

| [`supabase/migrations/001_projected_income.sql`](supabase/migrations/001_projected_income.sql) | Expected inflows before they hit the bank |

| [`supabase/migrations/002_transaction_splits.sql`](supabase/migrations/002_transaction_splits.sql) | Multi-category lines for one expense/income |

| [`supabase/migrations/003_projected_income_rls.sql`](supabase/migrations/003_projected_income_rls.sql) | RLS policies for `projected_income` and `transaction_splits` (required if saves fail with permission errors) |
| [`supabase/migrations/004_credit_card_payments.sql`](supabase/migrations/004_credit_card_payments.sql) | `accounts.minimum_payment`, `accounts.payment_due_day` for CC calendar + insights |
| [`supabase/migrations/005_credit_card_payment_cycle.sql`](supabase/migrations/005_credit_card_payment_cycle.sql) | `next_payment_due_date`, `payment_category_id` — mark paid advances cycle; budget funding colors |



### `projected_income`



Label, amount, `expected_date`, `account_id` (deposit target), optional `category_id`, `status` (`pending` \| `received` \| `cancelled`), `source_type`, optional recurrence. Does not change balances until **Mark received** creates an `Income` transaction via `lib/queries/projected-income.ts` → `applyBalanceAdjustment`.



### `transaction_splits`



Child rows: `transaction_id`, `category_id`, `amount`, `sort_order`. Parent `transactions` row holds the full amount and `category_id = null` when split. One account movement; envelope math per line.



### Balance rules



* **Actual RTA** = liquid cash − assigned (unchanged by projected income).

* **Planning RTA** = liquid + pending projected inflows to liquid accounts − assigned (`hooks/use-ready-to-assign.ts`, `lib/projected-income.ts`).
* **Credit cards** — `minimum_payment`, `payment_due_day`, active `next_payment_due_date`, optional `payment_category_id` for envelope funding; **Mark paid** advances due date +1 month; calendar gold when funded (`lib/credit-cards.ts`, `features/credit-cards/`).
* **Expected income dates** — pending rows cannot stay before today; auto-bumped on fetch and clamped on save (`lib/queries/projected-income.ts`).



## 3. KEY FILE STRUCTURE



### Routes (thin wrappers)



| Route | Feature view |

|-------|----------------|

| `/` | `features/dashboard/dashboard-view.tsx` |

| `/budget` | `features/budget/budget-view.tsx` (wrapped in `Suspense` for `useSearchParams`) |

| `/ledger` | `features/ledger/ledger-view.tsx` (wrapped in `Suspense`) |

| `/calendar` | `features/calendar/calendar-view.tsx` |

| `/reports` | `features/reports/reports-view.tsx` |



`/debt` redirects permanently to `/reports` (`next.config.ts`).



### Layout & design system



* `app/layout.tsx` — fonts, ThemeProvider, AppShell

* `components/layout/` — `app-shell`, `bottom-nav`, `top-bar`, `fab`, `page-header`

* `components/ui/` — Button, GlassCard, Sheet, Dialog, ResponsiveModal, StatHero, Skeleton, **Select** (`app-select` + dark `option` styling)

* `components/charts/` — CashflowChart, CategoryDonut, DebtTimelineChart

* `app/globals.css` — design tokens (`--canvas`, `--surface-elevated`, `--text-primary`, etc.), utilities (`.app-card`, `.app-input`, `.app-select`), `color-scheme: dark` on `html.dark` for native controls



### Shared logic



* `lib/supabase.ts`, `lib/money.ts` — `roundMoney`, `snapMoney`, `formatMoney`, `MONEY_EPSILON`

* `lib/balance-adjustment.ts` — txn → balance sync; `applySplitBalanceAdjustment` for splits (`accountsOnly` / `categoryOnly` flags)

* `lib/transaction-balance.ts` — `applyTransactionBalances` / `reverseTransactionBalances` (single or split)

* `lib/transaction-splits.ts` — split form helpers, `splitsMatchTotal`, `parseSplitLines`

* `lib/projected-income.ts` — planning RTA math

* `lib/queries/` — `transactions`, `transaction-splits`, `projected-income`, accounts, categories

* `lib/export/build-finance-export.ts` — full `.txt` report builder + `downloadTextFile`

* `lib/reports/` — aggregations (spending respects split lines) + debt simulator

* `hooks/use-ready-to-assign.ts`, `hooks/use-balance-adjustment.ts`

* `scripts/google-sheets-sync.gs` — Apps Script for Google Sheets ↔ Supabase REST sync (placeholders for URL/key; do not commit secrets)



### Feature modules



* `features/projected-income/projected-income-modals.tsx` — add/edit/receive/list expected income

* `features/ledger/split-transaction-fields.tsx` — split line UI in ledger modal



## 4. REPORTS & INSIGHTS (`/reports`)



Tabs: Overview (cashflow chart, account list), Spending (category donut, top payees), Debt (payoff simulator + timeline chart). Period selector: 30D / 90D / YTD / 12M. Category spending aggregates from **split lines** when present.



## 5. CALENDAR (`/calendar`)



* Month grid of bill due dates (funding colors), **credit card chips on `next_payment_due_date`** (gold when linked category is funded; tap → mark paid), and emerald chips for expected income (`projected_income`).

* Header stats: bills due, funded, expected income this month.

* Bill chips deep-link to `/budget?category={id}`.



## 6. PROJECTED INCOME (Dashboard + Budget + Calendar)



* **Dashboard** — Net worth + Ready to Assign hero row, then a spaced **Expected income** card below (`mt-6` / `md:mt-8`, not in the hero grid). Projected RTA subtitle on the RTA tile; full list modal.

* **Budget** — Projected RTA subtitle on RTA banner.

* **Calendar** — Income chips + month stat; tap for receive/edit.



## 7. SPLIT TRANSACTIONS (Ledger)



* Toggle **Split across categories** on Expense/Income (not Transfer).

* Multiple envelope lines must sum to transaction total (`splitsMatchTotal`).

* Ledger list shows violet **Split · N categories** badge.

* Smart Bill Pay disabled when splitting.

* Edit/delete reverses parent account + all split category adjustments.



## 8. EXPORTS & GOOGLE SHEETS



### In-app (`.txt` downloads)



| Location | Action | Contents |

|----------|--------|----------|

| **Dashboard** | Export Full Report | Summary (net worth, liquid, RTA, projected RTA), accounts, expected income, all transactions (split-aware), split detail lines, categories |

| **Budget** | Export | RTA, projected RTA if pending income exists, goals total, envelopes by group |



Dashboard export fetches live data via `fetchTransactions()` (with splits), `fetchAllProjectedIncome()`, and full categories.



### Google Sheets (`scripts/google-sheets-sync.gs`)



Paste into **Extensions → Apps Script**, set `SUPABASE_URL` and `SUPABASE_KEY`, reload spreadsheet. Menu: **Finance OS → Sync Latest Data**.



| Sheet | Supabase source |

|-------|-----------------|

| Accounts | `accounts` |

| Categories | `categories` (non-hidden) |

| Transactions | `transactions` + nested `transaction_splits` (`Is Split`, `Split Detail` columns) |

| ExpectedIncome | `projected_income` (pending only; received/cancelled omitted) |

| TransactionSplits | `transaction_splits` (one row per split line) |



Requires RLS read access on new tables (`003_projected_income_rls.sql`). Use publishable/anon key only in Sheets — never commit real keys to git.



## 9. DESIGN & LOGIC RULES



* **Zero-Based Math:** RTA = liquid cash − assigned envelopes; `snapMoney` / `roundMoney` in `lib/money.ts`

* **Balance sync:** All transaction writes use `lib/balance-adjustment.ts` (ledger-grade, fresh DB reads)

* **Smart Bill Pay:** Shared `applySmartBillPay` on dashboard quick entry and ledger (non-split only)

* **Mobile:** Bottom nav, FAB quick entry on home, bottom sheets on mobile / dialog on desktop

* **Motion:** Framer Motion on budget group expand, calendar month transitions



## 10. RECENT CHANGE LOG (high level)



1. **Money precision** — centralized formatting/rounding.

2. **UI revamp** — feature-based architecture, AppShell, Reports, theme tokens.

3. **Projected income** — `projected_income` table, planning RTA, Dashboard/Budget/Calendar UX, mark-received → Income txn.

4. **Split transactions** — `transaction_splits` table, ledger split UI, reports category aggregation from splits.

5. **Exports** — Dashboard “Export Full Report” (`lib/export/build-finance-export.ts`): summary, accounts, expected income, transactions (split-aware), split detail, categories. Google Sheets sync: `scripts/google-sheets-sync.gs` (Accounts, Categories, Transactions, ExpectedIncome, TransactionSplits).
6. **Credit cards & stale income** — payment cycle with mark-paid advance; budget envelope link; utilization on Insights (true %, including over limit); pending expected income auto-advances to today when overdue.


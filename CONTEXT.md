# FINANCE OS - PROJECT CONTEXT



**Tech Stack:** Next.js 16 (App Router), Tailwind CSS v4, Supabase, Framer Motion, Recharts, Radix UI, Vaul (sheets), next-themes.



**Styling:** Premium Apple Card / Monzo-inspired UI — adaptive light/dark via CSS variables and `next-themes`, glass cards (`.app-card`, `.app-card-subtle`), theme-aware inputs (`.app-input`, `.app-select`), large typography (Plus Jakarta Sans), emerald/red semantic accents. Mobile-first with bottom navigation (Android-primary) and desktop top bar. Centered content uses `max-w-6xl mx-auto` in AppShell (intentional on wide screens).



## 1. CORE PHILOSOPHY



Finance OS is a custom, manual-entry financial platform designed to replace YNAB. Zero-Based Budgeting ("Ready to Assign") with future forecasting and dynamic subscription/debt tracking.

**Scope today:** Personal finances only — all accounts, categories, transactions, and reports represent personal money.

**Next major initiative:** **Business toggle** — a global switch (personal ↔ business) that re-scopes the entire app (accounts, budget, ledger, calendar, insights, exports) to business finances. Not implemented yet; schema and UI will need entity separation or tagging when built.



## 2. DATABASE SCHEMA (Supabase)



Core tables: `accounts`, `category_groups`, `categories`, `transactions`, **`projected_income`**, **`transaction_splits`**.



| Migration | Purpose |

|-----------|---------|

| [`supabase/migrations/001_projected_income.sql`](supabase/migrations/001_projected_income.sql) | Expected inflows before they hit the bank |

| [`supabase/migrations/002_transaction_splits.sql`](supabase/migrations/002_transaction_splits.sql) | Multi-category lines for one expense/income |

| [`supabase/migrations/003_projected_income_rls.sql`](supabase/migrations/003_projected_income_rls.sql) | RLS policies for `projected_income` and `transaction_splits` (required if saves fail with permission errors) |
| [`supabase/migrations/004_credit_card_payments.sql`](supabase/migrations/004_credit_card_payments.sql) | `accounts.minimum_payment`, `accounts.payment_due_day` for CC calendar + insights |
| [`supabase/migrations/005_credit_card_payment_cycle.sql`](supabase/migrations/005_credit_card_payment_cycle.sql) | `next_payment_due_date`, `payment_category_id` — mark paid advances cycle; budget funding colors |
| [`supabase/migrations/006_projected_income_certainty.sql`](supabase/migrations/006_projected_income_certainty.sql) | `certainty` (`guaranteed` \| `anticipated`) on expected income for conservative vs full projected RTA |
| [`supabase/migrations/007_budgeted_amount.sql`](supabase/migrations/007_budgeted_amount.sql) | Optional `budgeted_amount` column (legacy; **RTA does not use it**) |



### `projected_income`



Label, amount, `expected_date`, `account_id` (deposit target), optional `category_id`, `status` (`pending` \| `received` \| `cancelled`), `source_type`, `certainty` (`guaranteed` \| `anticipated`), optional recurrence. Does not change balances until **Mark received** creates an `Income` transaction via `lib/queries/projected-income.ts` → `applyBalanceAdjustment`. **Planning RTA** uses guaranteed-only for conservative subtitle; all pending for optimistic total (`lib/projected-income.ts`, `hooks/use-ready-to-assign.ts`).



### `transaction_splits`



Child rows: `transaction_id`, `category_id`, `amount`, `sort_order`. Parent `transactions` row holds the full amount and `category_id = null` when split. One account movement; envelope math per line.



### Balance rules



* **Actual RTA** = liquid cash − sum of **all** envelope Available balances, including overspent negatives (YNAB-style; `computeReadyToAssign` in `lib/reports/aggregations.ts`).

* **Assignable RTA** = liquid cash − **positive** envelope Available only (`computeAssignableReadyToAssign`). Shown as the **primary** RTA figure on Dashboard/Budget/Insights when any category is overspent; subtitle shows overspent total and RTA before coverage. Move Money transfers **from RTA** cap at assignable, not the inflated pre-coverage number.

* **Planning RTA** = assignable (or RTA when none overspent) + pending projected inflows to liquid accounts. **Conservative** subtitle uses **guaranteed** pending only; **optimistic** uses all pending (`lib/projected-income.ts`, `hooks/use-ready-to-assign.ts`). Banner shows overspent and expected-income in separate labeled cards (`components/budget/rta-banner-extras.tsx`).

* **Expected income certainty** — `guaranteed` = reliable (paycheck, salary); counts toward conservative projected RTA. `anticipated` = uncertain (invoice, gig, other); optimistic projected RTA only.

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

* `components/layout/` — `app-shell`, `bottom-nav`, `top-bar` (desktop logo + nav + theme), `fab`, `page-header`

* `components/ui/` — Button, GlassCard, Sheet, Dialog, ResponsiveModal, StatHero, Skeleton, **Select** (`app-select` + dark `option` styling)

* `components/charts/` — CashflowChart, CategoryDonut, DebtTimelineChart

* `components/budget/rta-banner-extras.tsx` — Assignable RTA banner subtitles; separate **Overspent envelopes** vs **Expected income** cards

* `app/globals.css` — design tokens (`--canvas`, `--surface-elevated`, `--text-primary`, etc.), utilities (`.app-card`, `.app-input`, `.app-select`), `color-scheme: dark` on `html.dark` for native controls



### Shared logic



* `lib/supabase.ts`, `lib/money.ts` — `roundMoney`, `snapMoney`, `formatMoney`, `formatMoneyInput` (plain decimals for number inputs), `MONEY_EPSILON`

* `lib/balance-adjustment.ts` — txn → balance sync; `applySplitBalanceAdjustment` for splits (`accountsOnly` / `categoryOnly` flags)

* `lib/transaction-balance.ts` — `applyTransactionBalances` / `reverseTransactionBalances` (single or split)

* `lib/transaction-splits.ts` — split form helpers, `splitsMatchTotal`, `parseSplitLines`

* `lib/projected-income.ts` — planning RTA math

* `lib/queries/` — `transactions`, `transaction-splits`, `projected-income`, accounts, categories

* `lib/export/build-finance-export.ts` — full `.txt` report builder + `downloadTextFile`

* `lib/reports/` — aggregations (spending respects split lines; `listCategoryExpenses` for per-category txn drill-down) + debt simulator

* `hooks/use-ready-to-assign.ts`, `hooks/use-balance-adjustment.ts`

* `scripts/google-sheets-sync.gs` — Apps Script for Google Sheets ↔ Supabase REST sync (placeholders for URL/key; do not commit secrets)



### Feature modules



* `features/projected-income/projected-income-modals.tsx` — add/edit/receive/list expected income

* `features/ledger/split-transaction-fields.tsx` — split line UI in ledger modal

* `features/reports/spending-breakdown.tsx` — Spending tab donut + by-group / by-category lists

* `features/reports/category-spending-detail.tsx` — tap a category → transaction list modal for the current Insights period



## 4. REPORTS & INSIGHTS (`/reports`)



Tabs: Overview (cashflow chart + monthly table, account list), Spending (category donut, by group, top payees), Income (by category, top sources), Debt (payoff simulator + timeline chart). Period selector: 30D / 90D / YTD / 12M / **Month** (picker). Period income/expense/net summary. **Export** (Insights report preset, TXT/CSV) uses the **current on-screen period** (not just saved prefs). UI prefs persist in `localStorage` (`hooks/use-insights-preferences.ts`): period, month, tab, spending view, expanded groups, debt simulator inputs. Category spending aggregates from **split lines** when present. **Spending drill-down:** tap any category (in **By category** or inside an expanded group) to open a modal listing every expense in that envelope for the selected period — split-aware (shows only the line amount attributed to that category).



## 5. CALENDAR (`/calendar`)



* Month grid of bill due dates (funding colors), **credit card chips on `next_payment_due_date`** (gold when linked category is funded; tap → mark paid), and emerald chips for expected income (`projected_income`).

* **Event filters** — pill bar: All / Bills / Credit cards / Income. Filters grid chips and adapts header stats (due, funded, expected income, or CC funded count). Preference persists in `localStorage` (`finance_os_calendar_filter`). Mobile: horizontal scroll strip with short labels (“Cards”), 44px touch targets, edge-to-edge scroll for filters and stat cards.

* Header stats: bills due, funded, expected income this month (scoped to active filter).

* Bill chips deep-link to `/budget?category={id}`.



## 6. PROJECTED INCOME (Dashboard + Budget + Calendar)



* **Dashboard** — **Finance OS** logo in desktop top bar only (no duplicate page title). Net worth + **Assignable** / Ready to Assign hero tile with separate **Overspent envelopes** and **Expected income** cards when applicable; spaced **Expected income** list card below. Export top-right above hero.

* **Budget** — RTA banner matches Dashboard (**Assignable** when overspent; labeled overspent vs expected-income cards). **Assign Money** opens Move Money; category ↔ category may go negative; transfers **from RTA** cap at **Assignable**. Overspent Available click prefills cover amount. Move Money: network-error guidance, submit guard, partial rollback on failure.

* **Calendar** — Income chips + month stat; tap for receive/edit. Event filter bar (All / Bills / Credit cards / Income) with filter-aware stats.



## 7. SPLIT TRANSACTIONS (Ledger)



* Toggle **Split across categories** on Expense/Income (not Transfer). Same split UI on **Dashboard quick entry** and Ledger.

* Multiple envelope lines must sum to transaction total (`splitsMatchTotal`).

* Ledger list shows violet **Split · N categories** badge.

* Smart Bill Pay disabled when splitting.

* Edit/delete reverses parent account + all split category adjustments.



## 8. EXPORTS & GOOGLE SHEETS



### In-app export modal (`features/export/export-modal.tsx`, `lib/export/run-export.ts`)



Shared **Export** modal on **Dashboard**, **Budget**, and **Insights**. Formats: **TXT** or **CSV**. Presets: Full backup, Insights report, Budget snapshot, Transactions. Toggles (non-insights presets): summary, accounts, categories, transactions, split lines, expected income; date range; guaranteed/anticipated filter; hidden categories.

**Insights report:** From **Insights**, export matches the period/filters on that page (live data). From **Dashboard**, the same preset uses saved Insights prefs (`localStorage`) via `lib/reports/insights-export-context.ts`.



| Location | Default preset |

|----------|----------------|

| **Dashboard** | Full backup |

| **Budget** | Budget snapshot |

| **Insights** | Insights report (on-screen period & filters) |



Dashboard export fetches live data via `fetchTransactions()` (with splits), `fetchAllProjectedIncome()`, and full categories.



### Google Sheets (`scripts/google-sheets-sync.gs`)



Paste into **Extensions → Apps Script**, set `SUPABASE_URL` and `SUPABASE_KEY`, reload spreadsheet. Menu: **Finance OS → Sync Latest Data**. Designed compact for AI: read **Summary** first (headline metrics + definitions), then detail sheets as needed.



| Sheet | Supabase source | Notes |

|-------|-----------------|-------|

| **Summary** | Computed from accounts, categories, pending `projected_income` | Net worth, liquid, net envelopes, overspent total, RTA before coverage, **Assignable**, pending guaranteed/anticipated, projected RTA + projected Assignable, plain-language definitions |

| Accounts | `accounts` | Includes CC min payment, due day, next due date, linked budget envelope |

| Categories | `categories` (non-hidden) | `Available` = envelope balance; `Overspent?` when negative |

| Transactions | `transactions` + nested splits | `Is Split` / `Split Detail` columns |

| ExpectedIncome | `projected_income` **pending only** | `Certainty` (Guaranteed / Anticipated); received → Transactions |

| TransactionSplits | `transaction_splits` | Optional detail; Transactions already has split summary |



Requires RLS read access on new tables (`003_projected_income_rls.sql`). Use publishable/anon key only in Sheets — never commit real keys to git.



## 9. DESIGN & LOGIC RULES



* **Ready to Assign:** RTA (YNAB) = liquid − net envelope Available; **Assignable** = liquid − positive envelopes only — primary display when overspent; `computeReadyToAssign` / `computeAssignableReadyToAssign` in `lib/reports/aggregations.ts`; `snapMoney` / `roundMoney` in `lib/money.ts`

* **Balance sync:** All transaction writes use `lib/balance-adjustment.ts` (ledger-grade, fresh DB reads)

* **Smart Bill Pay:** Shared `applySmartBillPay` on dashboard quick entry and ledger (non-split only). UI only for **debt** or **scheduled bills** (`due_date` + repeating cycle) — not everyday envelopes like gas/groceries (`lib/smart-bill-pay.ts`).

* **Mobile:** Bottom nav, FAB quick entry on home, bottom sheets on mobile / dialog on desktop. Mobile sheets (`components/ui/sheet.tsx` via `ResponsiveModal`) use Vaul `handleOnly` + `data-vaul-no-drag` on scroll content so form scrolling (e.g. expected income, export) does not swipe-dismiss the popup — close via X or the top handle only.

* **Motion:** Framer Motion on budget group expand, calendar month transitions



## 10. RECENT CHANGE LOG (high level)



1. **Money precision** — centralized formatting/rounding.

2. **UI revamp** — feature-based architecture, AppShell, Reports, theme tokens.

3. **Projected income** — `projected_income` table, planning RTA, Dashboard/Budget/Calendar UX, mark-received → Income txn.

4. **Split transactions** — `transaction_splits` table, ledger split UI, reports category aggregation from splits.

5. **Exports** — Dashboard “Export Full Report” (`lib/export/build-finance-export.ts`): summary, accounts, expected income, transactions (split-aware), split detail, categories. Google Sheets sync: `scripts/google-sheets-sync.gs` (Accounts, Categories, Transactions, ExpectedIncome, TransactionSplits).
6. **Credit cards & stale income** — payment cycle with mark-paid advance; budget envelope link; utilization on Insights (true %, including over limit); pending expected income auto-advances to today when overdue.
7. **Unified export modal** — presets (full, insights, budget, transactions), TXT/CSV, expected-income certainty in exports; Insights page export restored with live period binding.
8. **RTA formula fix** — RTA = liquid minus positive envelopes only; overspent categories no longer inflate RTA.
9. **Google Sheets sync audit** — Summary sheet with app-matching RTA/projected RTA math, income certainty column, CC payment fields, overspent flag; pending-only expected income; inline definitions for AI.
10. **Budget RTA assign** — Assign Money button on the RTA banner opens envelope transfers from RTA (mobile + dark-mode friendly); duplicate actionable RTA card removed.
11. **Move Money fix** — Removed HTML `max`/`min` that silently blocked submit; `formatMoneyInput` for transfer amounts; clearer validation alerts and Supabase error surfacing.
12. **Overspent transfer prefill** — Clicking negative Available prefills the full deficit amount and defaults source to another funded envelope (not RTA-capped).
13. **Move Money resilience** — Network-error messaging for failed Supabase fetches, submit guard while transferring, rollback on partial category-to-category failure.
14. **Insights category drill-down** — Tap a spending category to view all transactions in that envelope for the current period (`listCategoryExpenses`, split-line aware); `category-spending-detail` modal.
15. **Mobile sheet scroll fix** — Vaul bottom sheets only dismiss from the top handle (`handleOnly`); scrollable content marked `data-vaul-no-drag` so add/edit expected income and other `ResponsiveModal` popups stay open while scrolling with the keyboard up.
16. **Calendar event filters** — All / Bills / Credit cards / Income filter bar on `/calendar`; grid chips and header stats adapt to selection; preference in `localStorage`; mobile-optimized horizontal scroll and compact stat labels.
17. **Dashboard header cleanup** — Removed duplicate Finance OS title on home; branding stays in desktop top bar only.
18. **RTA formula (YNAB-style)** — Ready to Assign uses net envelope Available (overspent negatives count); Move Money and covering overspent categories behave intuitively vs liquid cash.
19. **Move Money (negative envelopes)** — Category-to-category transfers no longer require positive source Available; envelopes may go negative when reallocating (e.g. shift spend between categories). RTA source still limited to actual Ready to Assign.
20. **Assignable RTA display** — When categories are overspent, Dashboard/Budget/Insights show **Assignable** (liquid minus positive envelopes) as the headline figure, with overspent total and pre-coverage RTA as context; RTA transfers cap at assignable.
21. **RTA banner cards** — Overspent vs expected-income subtitles use separate labeled cards on Dashboard/Budget RTA banners (`rta-banner-extras.tsx`); Google Sheets Summary sync matches assignable/overspent metrics.


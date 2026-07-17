# FINANCE OS - PROJECT CONTEXT



**Tech Stack:** Next.js 16 (App Router), Tailwind CSS v4, Supabase, TanStack Query, Framer Motion, Recharts, Radix UI, Vaul (sheets), next-themes.



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
| [`supabase/migrations/004_credit_card_payments.sql`](supabase/migrations/004_credit_card_payments.sql) | Legacy: added `minimum_payment` / `payment_due_day` (removed in 008) |
| [`supabase/migrations/005_credit_card_payment_cycle.sql`](supabase/migrations/005_credit_card_payment_cycle.sql) | Legacy: payment cycle columns (removed in 008) |
| [`supabase/migrations/006_projected_income_certainty.sql`](supabase/migrations/006_projected_income_certainty.sql) | `certainty` (`guaranteed` \| `anticipated`) on expected income for conservative vs full projected RTA |
| [`supabase/migrations/007_budgeted_amount.sql`](supabase/migrations/007_budgeted_amount.sql) | Optional `budgeted_amount` column (legacy; **RTA does not use it**) |
| [`supabase/migrations/008_drop_credit_card_payment_cycle.sql`](supabase/migrations/008_drop_credit_card_payment_cycle.sql) | Drop account-level CC payment cycle; due dates/funding live on categories |


### `projected_income`



Label, amount, `expected_date`, `account_id` (deposit target), optional `category_id`, `status` (`pending` \| `received` \| `cancelled`), `source_type`, `certainty` (`guaranteed` \| `anticipated`), optional recurrence. Does not change balances until **Mark received** creates an `Income` transaction via `lib/queries/projected-income.ts` → `applyBalanceAdjustment`. **Planning RTA** uses guaranteed-only for conservative subtitle; all pending for optimistic total (`lib/projected-income.ts`, `hooks/use-ready-to-assign.ts`).



### `transaction_splits`



Child rows: `transaction_id`, `category_id`, `amount`, `sort_order`. Parent `transactions` row holds the full amount and `category_id = null` when split. One account movement; envelope math per line.



### Balance rules



* **Actual RTA** = liquid cash − sum of **all** envelope Available balances, including overspent negatives (YNAB-style; `computeReadyToAssign` in `lib/reports/aggregations.ts`).

* **Assignable RTA** = liquid cash − **positive** envelope Available only (`computeAssignableReadyToAssign`). Shown as the **primary** RTA figure on Dashboard/Budget/Insights when any category is overspent; subtitle shows overspent total and RTA before coverage. Display-only — Move Money never blocks on RTA or envelope balance.

* **Planning RTA** = assignable (or RTA when none overspent) + pending projected inflows to liquid accounts. **Conservative** subtitle uses **guaranteed** pending only; **optimistic** uses all pending (`lib/projected-income.ts`, `hooks/use-ready-to-assign.ts`). Banner shows overspent and expected-income in separate labeled cards (`components/budget/rta-banner-extras.tsx`).

* **Expected income certainty** — `guaranteed` = reliable (paycheck, salary); counts toward conservative projected RTA. `anticipated` = uncertain (invoice, gig, other); optimistic projected RTA only.

* **Credit cards** — account stores balance + `credit_limit` for utilization on Insights (`lib/credit-cards.ts`). Payment due dates and funding live on **budget categories** (bills/debt + Smart Bill Pay), not on the account.
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



* `app/layout.tsx` — fonts, ThemeProvider, QueryProvider, AppShell

* `app/providers/query-provider.tsx` — TanStack Query client (5 min stale time, shared cache across tabs)

* `components/layout/prefetch-on-nav.tsx` — warms accounts/categories/groups/projected-income cache on app mount; nav links prefetch route-specific data on hover/focus/touch

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

* `lib/ledger/filters.ts` — ledger filter logic, multi-category + split-aware matching, URL helpers (`buildLedgerHref`, `parseLedgerSearchParams`)

* `lib/transaction-defaults.ts` — last payee category/account recall, last transfer pair, last used account (`localStorage`)

* `lib/reports/` — aggregations (spending respects split lines; `listCategoryExpenses` for per-category txn drill-down) + debt simulator

* `hooks/use-ready-to-assign.ts`, `hooks/use-balance-adjustment.ts`, `hooks/use-ledger-filters.ts` — ledger filter state + `localStorage` persistence

* `hooks/use-finance-queries.ts`, `lib/query-keys.ts` — shared Supabase data cache (accounts, categories, transactions, projected income); one `categories` query shared by Dashboard, Budget, Ledger, and Insights; `useInvalidateFinance()` for post-mutation refresh; `patchCategories` / `patchCategoryGroups` update all category caches immediately after Move Money and envelope edits; Ledger + Insights share one `transactions` query

* `scripts/google-sheets-sync.gs` — Apps Script for Google Sheets ↔ Supabase REST sync (placeholders for URL/key; do not commit secrets)



### Feature modules



* `features/projected-income/projected-income-modals.tsx` — add/edit/receive/list expected income; label recall for account + category

* `features/ledger/ledger-view.tsx` — master ledger list, add/edit modal, advanced filters

* `features/ledger/ledger-filters-bar.tsx` — date presets, type/account/multi-category filters, “More” panel, filtered summary strip

* `features/ledger/split-transaction-fields.tsx` — split line UI in ledger modal

* `features/reports/spending-breakdown.tsx` — Spending tab donut + by-group / by-category lists

* `features/reports/category-spending-detail.tsx` — tap a category → transaction list modal for the current Insights period; **Open in Ledger** deep link

* `features/calendar/calendar-view.tsx` — month grid, event filters, day tap → overview sheet

* `features/calendar/day-overview-sheet.tsx` — daily snapshot modal (in/out, projected RTA through day)

* `lib/calendar/day-snapshot.ts` — day event aggregation, bill chip classes, projected position math



## 4. REPORTS & INSIGHTS (`/reports`)



Tabs: Overview (cashflow chart + monthly table, account list), Spending (category donut, by group, top payees), Income (by category, top sources), Debt (payoff simulator + timeline chart). Period selector: 30D / 90D / YTD / 12M / **Month** (picker). Period income/expense/net summary. **Export** (Insights report preset, TXT/CSV) uses the **current on-screen period** (not just saved prefs). UI prefs persist in `localStorage` (`hooks/use-insights-preferences.ts`): period, month, tab, spending view, expanded groups, debt simulator inputs. Category spending aggregates from **split lines** when present. **Spending drill-down:** tap any category (in **By category** or inside an expanded group) to open a modal listing every expense in that envelope for the selected period — split-aware (shows only the line amount attributed to that category).



## 5. CALENDAR (`/calendar`)



* Month grid of bill due dates (funding colors) and emerald chips for expected income (`projected_income`).

* **Event filters** — pill bar: All / Bills / Income. Filters grid chips and adapts header stats (due, funded, expected income). Preference persists in `localStorage` (`finance_os_calendar_filter`). Mobile: horizontal scroll strip, 44px touch targets, edge-to-edge scroll for filters and stat cards.

* Header stats: bills due, funded, expected income this month (scoped to active filter).

* Bill chips deep-link to `/budget?category={id}`.

* **Day overview** — tap any day cell to open a `ResponsiveModal` sheet (bottom sheet on mobile, dialog on desktop). Shows **net for the day** (income minus bills), **Money in** / **Money out** lists with due · funded · shortfall, and **If this day's income arrives** for today and future dates: projected liquid + projected RTA/Assignable using **only** pending income on that calendar day (not later deposits). Optional **Planning · by end of [date]** sub-card when earlier pending income exists through that day (cumulative runway, clearly labeled as not money today). Past days show events only. Individual chips still work (`stopPropagation`) for budget and receive/edit. Logic in `lib/calendar/day-snapshot.ts`; UI in `features/calendar/day-overview-sheet.tsx`.



## 6. PROJECTED INCOME (Dashboard + Budget + Calendar)



* **Dashboard** — **Finance OS** logo in desktop top bar only (no duplicate page title). Net worth + **Assignable** / Ready to Assign hero tile with separate **Overspent envelopes** and **Expected income** cards when applicable; spaced **Expected income** list card below (soonest date first). **View all expected income** modal matches that order for pending rows; history tab is newest-first. Export top-right above hero.

* **Budget** — RTA banner matches Dashboard (**Assignable** when overspent; labeled overspent vs expected-income cards). **Assign Money** opens Move Money with **no balance caps** — any amount, any source (RTA or category), envelopes and displayed RTA may go negative for planning. Move Money: network-error guidance, submit guard, partial rollback on failure.

* **Calendar** — Income chips + month stat; tap day for overview sheet or tap chip for receive/edit / budget. Event filter bar (All / Bills / Income) with filter-aware stats.



## 7. LEDGER (`/ledger`)



### Advanced filters (`lib/ledger/filters.ts`, `features/ledger/ledger-filters-bar.tsx`)



* **Date** — 90D (default), All time, Insights-aligned presets (30D / 90D / YTD / 12M / Month + picker), or custom start/end range. Reuses `getPeriodRange` from `lib/reports/aggregations.ts`.

* **Core** — text search (payee, notes, parent + split categories), type, account, **multi-category** (OR match; split-aware via `transactionMatchesAnyCategory`). Category control is a searchable checkbox dropdown; removable chips when more than one is selected.

* **More** — category group, account type (liquid / credit cards), transfer direction (when account selected), exact payee, special (splits / uncategorized / has notes), min/max amount. On mobile, **More** opens a bottom sheet (`ResponsiveModal`); on desktop, inline expand.

* **Summary strip** — filtered income, expenses, net, and showing count when any filter is active.

* **Persistence** — `localStorage` (`finance_os_ledger_filters`; migrates legacy single `filterCategory`). URL params for deep links: `account`, `category` (comma-separated ids), `type`, `from`, `to`, `period`, `month`, `payee`, `group`, `special`, `q`. Insights category drill-down links to ledger with category + period pre-applied.

* **Mobile** — edge-to-edge horizontal scroll for date pills and summary cards; short pill labels (“All”, “Mo”); 44px touch targets; full-width stacked selects; compact header balance chip.

* **List performance** — renders `LEDGER_VISIBLE_BATCH` (50) rows initially; **Show more** loads 50 at a time. Resets when filters change. Summary strip and totals use the full filtered set, not just visible rows.



### Transaction defaults (Ledger + Dashboard quick entry + Expected income)



* **Payee / label memory** — on payee change (new txns only), `fetchLastDefaultsForPayee` loads the latest same-type txn for that payee (`date` then `created_at`). Prefills **category** (including null = Ready to Assign / uncategorized) and **account**. Shared by Ledger modal and Dashboard FAB. Expected income uses the same pattern on **label** change via `fetchLastDefaultsForProjectedLabel` (latest `projected_income` row for that label, else matching Income txn payee).

* **Transfer pair** — switching type to Transfer keeps the current/clicked account as **Pay From**; only the destination is filled from the last transfer pair (`lib/transaction-defaults.ts` / `localStorage`). Successful transfer saves the pair for next time. Swap button (like Move Money) flips from ↔ to.

* **Last account** — new expense/income and expected-income forms prefer the last account used when no filter/account override applies.



### Split transactions



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

| Accounts | `accounts` | Includes credit limit; CC payment due dates live on categories |

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

* **Motion:** Framer Motion on budget group expand, calendar month transitions (page-level route fade removed from AppShell for snappier tab switches)

* **Performance:** TanStack Query caches finance data across tab navigation; Export modal and Insights charts lazy-loaded via `next/dynamic`; nav prefetch on hover/focus



## 10. RECENT CHANGE LOG (high level)



1. **Money precision** — centralized formatting/rounding.

2. **UI revamp** — feature-based architecture, AppShell, Reports, theme tokens.

3. **Projected income** — `projected_income` table, planning RTA, Dashboard/Budget/Calendar UX, mark-received → Income txn.

4. **Split transactions** — `transaction_splits` table, ledger split UI, reports category aggregation from splits.

5. **Exports** — Dashboard “Export Full Report” (`lib/export/build-finance-export.ts`): summary, accounts, expected income, transactions (split-aware), split detail, categories. Google Sheets sync: `scripts/google-sheets-sync.gs` (Accounts, Categories, Transactions, ExpectedIncome, TransactionSplits).
6. **Credit cards & stale income** — CC accounts keep balance + credit limit (utilization on Insights); payment due dates/funding use budget categories. Pending expected income auto-advances to today when overdue.
7. **Unified export modal** — presets (full, insights, budget, transactions), TXT/CSV, expected-income certainty in exports; Insights page export restored with live period binding.
8. **RTA formula fix** — RTA = liquid minus positive envelopes only; overspent categories no longer inflate RTA.
9. **Google Sheets sync audit** — Summary sheet with app-matching RTA/projected RTA math, income certainty column, credit limit, overspent flag; pending-only expected income; inline definitions for AI.
10. **Budget RTA assign** — Assign Money button on the RTA banner opens envelope transfers from RTA (mobile + dark-mode friendly); duplicate actionable RTA card removed.
11. **Move Money fix** — Removed HTML `max`/`min` that silently blocked submit; `formatMoneyInput` for transfer amounts; clearer validation alerts and Supabase error surfacing.
12. **Overspent transfer prefill** — Clicking negative Available prefills the full deficit amount and defaults source to another funded envelope (not RTA-capped).
13. **Move Money resilience** — Network-error messaging for failed Supabase fetches, submit guard while transferring, rollback on partial category-to-category failure.
14. **Insights category drill-down** — Tap a spending category to view all transactions in that envelope for the current period (`listCategoryExpenses`, split-line aware); `category-spending-detail` modal.
15. **Mobile sheet scroll fix** — Vaul bottom sheets only dismiss from the top handle (`handleOnly`); scrollable content marked `data-vaul-no-drag` so add/edit expected income and other `ResponsiveModal` popups stay open while scrolling with the keyboard up.
16. **Calendar event filters** — All / Bills / Income filter bar on `/calendar`; grid chips and header stats adapt to selection; preference in `localStorage`; mobile-optimized horizontal scroll and compact stat labels.
17. **Dashboard header cleanup** — Removed duplicate Finance OS title on home; branding stays in desktop top bar only.
18. **RTA formula (YNAB-style)** — Ready to Assign uses net envelope Available (overspent negatives count); Move Money and covering overspent categories behave intuitively vs liquid cash.
19. **Move Money (negative envelopes)** — Category-to-category transfers no longer require positive source Available; envelopes may go negative when reallocating. RTA-from transfers uncapped — assign any amount for planning.
20. **Assignable RTA display** — When categories are overspent, Dashboard/Budget/Insights show **Assignable** (liquid minus positive envelopes) as the headline figure, with overspent total and pre-coverage RTA as context (display only).
21. **RTA banner cards** — Overspent vs expected-income subtitles use separate labeled cards on Dashboard/Budget RTA banners (`rta-banner-extras.tsx`); Google Sheets Summary sync matches assignable/overspent metrics.
22. **Ledger advanced filters** — Date presets + custom range, split-aware category filter, summary strip, URL deep links from Insights, `localStorage` persistence; mobile-optimized scroll strips, bottom sheet for More filters, 44px touch targets (`lib/ledger/filters.ts`, `ledger-filters-bar.tsx`).
23. **Calendar day overview** — Tap a day for net cashflow, money in/out lists, and projected liquid/RTA for **that day's income only**; optional cumulative planning card when earlier pending income applies; `lib/calendar/day-snapshot.ts`, `features/calendar/day-overview-sheet.tsx`.
24. **Expected income list sort** — View-all modal pending tab uses `sortPendingByDate` (soonest first) to match the Dashboard preview; history tab sorts newest-first (`features/projected-income/projected-income-modals.tsx`).
25. **Performance / responsiveness** — TanStack Query shared cache (`hooks/use-finance-queries.ts`) so revisiting tabs shows cached data instantly; removed AppShell page fade; nav prefetch; lazy-loaded Export modal + Insights charts; all feature views refactored off per-mount `useEffect` fetches.
26. **Budget cache mutation fix** — Budget reads categories/groups directly from the query cache (no duplicate local state); Move Money and envelope edits use `patchCategories` / `patchCategoryGroups` so changes show immediately instead of being overwritten by stale cache.
27. **Dashboard RTA cache fix** — Removed separate `useDashboardCategories` cache; Dashboard uses the same `useCategories()` query as Budget so Ready to Assign updates when switching tabs after Move Money or ledger changes.
28. **Ledger list performance** — Default date filter is 90D (was All time). Transaction list shows 50 rows initially with **Show more** (+50 per tap); header reflects visible vs filtered count; totals still cover the full filtered set (`LEDGER_VISIBLE_BATCH` in `lib/ledger/filters.ts`).
29. **Transaction defaults** — Payee recall fills category (including Ready to Assign / null) + account by latest same-type txn; Transfer keeps clicked/current account as Pay From and recalls destination only; swap button flips from↔to; last used account for new forms (`lib/transaction-defaults.ts`, `fetchLastDefaultsForPayee`).
30. **Multi-category ledger filter** — Select multiple envelopes (OR); searchable checkbox UI + chips; URL `category=1,2,3`; migrates legacy single-category `localStorage`.
31. **Expected income defaults** — Label recall prefills deposit account + category (including Ready to Assign) from last expected-income row, falling back to Income txn with the same payee; new forms use last deposit account (`fetchLastDefaultsForProjectedLabel`).
32. **Transfer Pay From fix** — Quick entry / ledger Transfer no longer overwrites the account you opened with; destination still remembers last transfer target; stacked from/to UI with swap.
33. **Remove CC payment cycle** — Dropped account-level min payment / due day / mark paid / calendar CC chips; categories own due dates and funding. Kept credit limit + utilization. Migration `008_drop_credit_card_payment_cycle.sql`.


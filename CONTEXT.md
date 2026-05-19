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



### `projected_income`



Label, amount, `expected_date`, `account_id` (deposit target), optional `category_id`, `status` (`pending` \| `received` \| `cancelled`), `source_type`, optional recurrence. Does not change balances until **Mark received** creates an `Income` transaction via `lib/queries/projected-income.ts` → `applyBalanceAdjustment`.



### `transaction_splits`



Child rows: `transaction_id`, `category_id`, `amount`, `sort_order`. Parent `transactions` row holds the full amount and `category_id = null` when split. One account movement; envelope math per line.



### Balance rules



* **Actual RTA** = liquid cash − assigned (unchanged by projected income).

* **Planning RTA** = liquid + pending projected inflows to liquid accounts − assigned (`hooks/use-ready-to-assign.ts`, `lib/projected-income.ts`).



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

* `lib/reports/` — aggregations (spending respects split lines) + debt simulator

* `hooks/use-ready-to-assign.ts`, `hooks/use-balance-adjustment.ts`



### Feature modules



* `features/projected-income/projected-income-modals.tsx` — add/edit/receive/list expected income

* `features/ledger/split-transaction-fields.tsx` — split line UI in ledger modal



## 4. REPORTS & INSIGHTS (`/reports`)



Tabs: Overview (cashflow chart, account list), Spending (category donut, top payees), Debt (payoff simulator + timeline chart). Period selector: 30D / 90D / YTD / 12M. Category spending aggregates from **split lines** when present.



## 5. CALENDAR (`/calendar`)



* Month grid of bill due dates (funding colors) **and** emerald chips for expected income (`projected_income`).

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



## 8. DESIGN & LOGIC RULES



* **Zero-Based Math:** RTA = liquid cash − assigned envelopes; `snapMoney` / `roundMoney` in `lib/money.ts`

* **Balance sync:** All transaction writes use `lib/balance-adjustment.ts` (ledger-grade, fresh DB reads)

* **Smart Bill Pay:** Shared `applySmartBillPay` on dashboard quick entry and ledger (non-split only)

* **Mobile:** Bottom nav, FAB quick entry on home, bottom sheets on mobile / dialog on desktop

* **Motion:** Framer Motion on budget group expand, calendar month transitions



## 9. RECENT CHANGE LOG (high level)



1. **Money precision** — centralized formatting/rounding.

2. **UI revamp** — feature-based architecture, AppShell, Reports, theme tokens.

3. **Projected income** — `projected_income` table, planning RTA, Dashboard/Budget/Calendar UX, mark-received → Income txn.

4. **Split transactions** — `transaction_splits` table, ledger split UI, reports category aggregation from splits.


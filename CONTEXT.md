# FINANCE OS - PROJECT CONTEXT

**Tech Stack:** Next.js 16 (App Router), Tailwind CSS v4, Supabase, Framer Motion, Recharts, Radix UI, Vaul (sheets), next-themes.

**Styling:** Premium Apple Card / Monzo-inspired UI — adaptive light/dark via CSS variables and `next-themes`, glass cards (`.app-card`, `.app-card-subtle`), theme-aware inputs (`.app-input`, `.app-select`), large typography (Plus Jakarta Sans), emerald/red semantic accents. Mobile-first with bottom navigation (Android-primary) and desktop top bar. Centered content uses `max-w-6xl mx-auto` in AppShell (intentional on wide screens).

## 1. CORE PHILOSOPHY

Finance OS is a custom, manual-entry financial platform designed to replace YNAB. Zero-Based Budgeting ("Ready to Assign") with future forecasting and dynamic subscription/debt tracking.

## 2. DATABASE SCHEMA (Supabase)

Unchanged — `accounts`, `category_groups`, `categories`, `transactions`. See prior field definitions in git history.

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

* `lib/supabase.ts`, `lib/money.ts` — `roundMoney`, `snapMoney`, `formatMoney`, `MONEY_EPSILON` (two-decimal display and write rounding)
* `lib/balance-adjustment.ts` — canonical txn → balance sync (DB re-read on each step)
* `lib/queries/` — Supabase fetch helpers
* `lib/reports/` — aggregations + debt simulator (snowball/avalanche)
* `hooks/use-ready-to-assign.ts`, `hooks/use-balance-adjustment.ts`

## 4. REPORTS & INSIGHTS (`/reports`)

Replaces the old Debt page. Tabs: Overview (cashflow chart, account list), Spending (category donut, top payees), Debt (payoff simulator + timeline chart). Period selector: 30D / 90D / YTD / 12M. This page was the reference for dark-mode token usage during the UI revamp.

## 5. CALENDAR (`/calendar`)

* Nav label: **Calendar** (not "Bills") in bottom nav and top bar.
* Page title: **Calendar** — month grid of bill due dates with funding status colors (default / gold funded / red ASAP or past-due).
* **Deep link:** tapping a bill chip navigates to `/budget?category={id}`; Budget opens that category’s edit modal and expands its group.

## 6. BUDGET & LEDGER FILTERS (dark mode)

* Budget sort/view controls use `Select` inside `app-card-subtle` chips (no white `divide-slate-100` bar).
* Ledger type/account filters use themed `Select` (`app-select`) instead of raw white-styled `<select>`.
* Native dropdowns respect dark theme via `.app-select option` and `color-scheme`.

## 7. DESIGN & LOGIC RULES

* **Zero-Based Math:** RTA = liquid cash − assigned envelopes; `snapMoney` / `roundMoney` in `lib/money.ts`
* **Balance sync:** All transaction writes use `lib/balance-adjustment.ts` (ledger-grade, fresh DB reads)
* **Smart Bill Pay:** Shared `applySmartBillPay` on dashboard quick entry and ledger
* **Mobile:** Bottom nav, FAB quick entry on home, bottom sheets on mobile / dialog on desktop, always-visible ledger row actions, calendar bill names on small screens, safe-area padding
* **Motion:** Framer Motion on budget group expand, calendar month transitions; respect `prefers-reduced-motion` where applied

## 8. RECENT CHANGE LOG (high level)

1. **Money precision** — centralized formatting/rounding; balances and amounts show at most two decimals.
2. **UI revamp** — feature-based architecture, AppShell, Reports page with charts, Debt page removed/redirected, theme tokens and dark/light parity pass across feature views.
3. **Dark mode fixes** — semantic surfaces instead of hardcoded `bg-white` / `text-slate-*`; filter controls on Budget/Ledger use `app-select`.
4. **Calendar UX** — renamed to Calendar; bills link to Budget category editor via query param.

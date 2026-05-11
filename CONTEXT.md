# 💵 FINANCE OS - PROJECT CONTEXT
**Tech Stack:** Next.js 16 (App Router), Tailwind CSS v4, Supabase, Lucide React.
**Styling:** Modern Clean x Brutalist. (Slate-50 background, rounded-2xl cards, shadow-sm, Emerald/Blue/Red semantic accents).

## 1. CORE PHILOSOPHY
Finance OS is a custom, manual-entry financial platform designed to replace YNAB. It utilizes a Zero-Based Budgeting philosophy ("Ready to Assign") but breaks the "monthly wall" by allowing for future forecasting and dynamic subscription/debt tracking.

## 2. DATABASE SCHEMA (Supabase)
* **`accounts`**: `id`, `created_at`, `name`, `type` ('Checking', 'Savings', 'Credit Card', 'Cash'), `balance`, `credit_limit`. 
    * **Floating Point Failsafe:** Rounds input to 2 decimal places to prevent microscopic floating-point remainders from breaking UI and math.
    * **Actionable Filter:** Added "View: Actionable" filter to show only categories with non-zero balances.
    * **Advanced Transfers:** Transfer modal pre-fills amount and defaults direction based on balance (Transfer Out for positive, Transfer In for negative). Includes a quick reference list of other funded/overspent envelopes for easier movement.
    * **Smart Bill Pay:** (Integrated with Ledger/Quick Entry) Automatically advances `due_date` and deducts `target_amount` from debt `balance` for repeating/debt categories.
    * **Searchable Dropdowns:** Replaced standard category selects with searchable dropdown components.
    * **Payee Memory:** Remembers the last category used for a specific payee and autofills it.
    * **Ledger Enhancements:** Displays current account balance when filtered. Expenses are color-coded Red. Transfers are contextual (Red for leaving account, Emerald for entering).
    * **Calendar Gamification:** Fully funded categories now use a glowing gold gradient.
    * **Dashboard Organization:** Accounts are grouped into "Liquid Accounts" and "Credit Cards", sorted alphabetically.
* **`category_groups`**: `id`, `name`, `sort_order`. (The macro folders, e.g., 'Living Expenses', 'Debt').
* **`categories`**: `id`, `group_id` (FK), `name`, `emoji`, `target_type` ('Set Aside', 'Fill Up To', 'Have Balance'), `target_amount`, `target_period` ('Weekly', 'Monthly', 'Yearly', 'None'), `due_date`, `is_repeating`, `end_date`, `notes`, `is_debt` (boolean), `balance` (outstanding debt owed), `is_asap` (boolean urgency flag), `assigned_amount` (current liquid cash inside the envelope), `sort_order`, `is_hidden` (archived: hidden from active budget grid and bill calendar; ledger history unchanged). Toggle when editing a category, or restore from the **Archived categories** section on the budget page. Repeating categories past `end_date` are still auto-hidden via Fast-Forward.
* **`transactions`**: `id`, `created_at`, `date`, `amount`, `payee`, `category_id` (FK), `account_id` (FK), `to_account_id` (FK - for transfers), `type` ('Income', 'Expense', 'Transfer'), `notes`.

## 3. KEY FILE STRUCTURE
* `app/layout.tsx` & `app/ui/Nav.tsx` -> **Global Architecture**. Wraps the entire application in a consistent layout and navigation bar, removing redundant UI code.
* `app/page.tsx` -> **Dashboard**. Features: Total Net Worth, Liquid Cash calculation, Monthly Cashflow (Income vs Expense), Account Management (with Manual vs Silent balance adjustments), Account Exports, a Recent Ledger feed, and an **Inline Quick Entry Modal** to log transactions without leaving the page.
* `app/budget/page.tsx` -> **Budget Engine**. Features: Zero-based "Ready to Assign" banner, Category Group creation, Category envelope management, View Filters (Underfunded/Available/Overspent), omnidirectional envelope transfers, Budget Exporting, **manual archive** (`is_hidden`) on category edit, and a collapsible **Archived categories** list with one-click restore.
* `app/ledger/page.tsx` -> **Master Ledger**. Features: Transaction logging with automatic balance/envelope sync (each adjustment reads current account and envelope balances from the DB so edit/delete reverse-then-apply chains stay accurate), autofill payees, filter-based account auto-selection, and URL parameter listening (`?account=id&new=true`) for deep-linking.
* `app/calendar/page.tsx` -> **Bill Calendar**. Features: Dynamic CSS grid calendar utilizing `date-fns` to map categories visually based on their `due_date`, accompanied by monthly "Total Due" vs "Funded" stats.
* `app/debt/page.tsx` -> **Debt Engine**. Features: Custom mathematical simulation that isolates `is_debt` categories, assumes `target_amount` is the minimum payment, and calculates future payoff dates utilizing both Snowball and Avalanche strategies based on total monthly power.

## 4. DESIGN & LOGIC RULES
* **Zero-Based Math:** `Ready to Assign` = Total Liquid Cash (Checking + Savings + Cash) minus total funds explicitly assigned to envelopes. The system uses a strict "snap to zero" rounding failsafe (`Math.abs(val) < 0.01`) on both the global RTA banner and individual category balances. This prevents JavaScript floating-point microscopic decimal bugs from throwing false negative warnings or causing "ghost" envelopes to appear in active filters.
* **Inline Math Evaluation:** The "Assigned" input accepts basic math operators (e.g., `+50`, `100-20`) to dynamically update assigned values.
* **Math Reversal Sync:** Deleting or editing a transaction automatically reverses the old math impact on accounts and envelopes before applying new changes, ensuring the ledger and balances stay synced. On the **Master Ledger**, each reversal or apply step loads fresh balances from Supabase before writing (avoids stale in-memory totals between reverse and apply on edits). If a row update fails after a reverse, the prior transaction is re-applied to roll back.
* **Manual Adjustments vs Silent Updates:** When editing an account balance directly, the user can choose to let the system auto-calculate the difference and log a transaction ("Manual Adjustment") or bypass the ledger entirely ("Silent Update").
* **Account Display Math & Credit Cards:** Outflow (Expenses) on Credit Card accounts INCREASES the balance (debt), while Inflow (Income/Payments) DECREASES the balance. To ensure proper UI formatting without swallowing negatives, overdrawn standard accounts (Checking/Savings) manually conditionally render their minus signs alongside absolute values (e.g., `-$50.00`).
* **Persistent Preferences:** Category sorting preferences, view filters, and expanded/collapsed group states are stored in `localStorage` to persist across sessions seamlessly.
* **Visual Urgency & Gamification:** Categories past their `due_date` auto-flag as "Late". `is_asap` overrides render red emergency backgrounds. **Overspent categories** (negative available balance) turn red and trigger a global warning banner at the top of the budget. **Fully funded categories** (Available >= Target) render with a glowing gold gradient to gamify goal completion.
* **Savings Breakdown:** Categories with targets and due dates dynamically calculate daily, weekly, and monthly funding requirements to meet goals on time.
* **Cycle Advancement:** Repeating categories feature a "Fast-Forward" action to advance the due date based on frequency. If the new date exceeds the `end_date`, the category is auto-hidden.
* **Transfers:** Handled natively by supplying both an `account_id` (From) and `to_account_id` (To) on a single transaction record, keeping Net Worth flat. Budget envelope transfers feature an omnidirectional swap toggle with text truncation to preserve flexbox layouts.
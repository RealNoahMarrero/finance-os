# 💵 FINANCE OS - PROJECT CONTEXT
**Tech Stack:** Next.js 16 (App Router), Tailwind CSS v4, Supabase, Lucide React.
**Styling:** Modern Clean x Brutalist. (Slate-50 background, rounded-2xl cards, shadow-sm, Emerald/Blue/Red semantic accents).

## 1. CORE PHILOSOPHY
Finance OS is a custom, manual-entry financial platform designed to replace YNAB. It utilizes a Zero-Based Budgeting philosophy ("Ready to Assign") but breaks the "monthly wall" by allowing for future forecasting and dynamic subscription/debt tracking.

## 2. DATABASE SCHEMA (Supabase)
* **`accounts`**: `id`, `created_at`, `name`, `type` ('Checking', 'Savings', 'Credit Card', 'Cash'), `balance`, `credit_limit`. 
    * *Logic:* Credit cards are tracked as positive balance inputs in the UI, but the system dynamically subtracts them from the Total Net Worth calculation. Available credit is auto-calculated.
* **`category_groups`**: `id`, `name`, `sort_order`. (The macro folders, e.g., 'Living Expenses', 'Debt').
* **`categories`**: `id`, `group_id` (FK), `name`, `emoji`, `target_type` ('Set Aside', 'Fill Up To', 'Have Balance'), `target_amount`, `target_period` ('Weekly', 'Monthly', 'Yearly', 'None'), `due_date`, `is_repeating`, `end_date`, `notes`, `is_debt` (boolean), `balance` (outstanding debt owed), `is_asap` (boolean urgency flag), `assigned_amount` (current liquid cash inside the envelope), `sort_order`, `is_hidden` (for archived goals).
* **`transactions`**: `id`, `created_at`, `date`, `amount`, `payee`, `category_id` (FK), `account_id` (FK), `to_account_id` (FK - for transfers), `type` ('Income', 'Expense', 'Transfer'), `notes`.

## 3. KEY FILE STRUCTURE
* `app/layout.tsx` & `app/ui/Nav.tsx` -> **Global Architecture**. Wraps the entire application in a consistent layout and navigation bar, removing redundant UI code.
* `app/page.tsx` -> **Dashboard**. Features: Total Net Worth, Liquid Cash calculation, Monthly Cashflow (Income vs Expense), Account Management (with Manual vs Silent balance adjustments), Account Exports, a Recent Ledger feed, and an **Inline Quick Entry Modal** to log transactions without leaving the page.
* `app/budget/page.tsx` -> **Budget Engine**. Features: Zero-based "Ready to Assign" banner, Category Group creation, Category envelope management, View Filters (Underfunded/Available/Overspent), omnidirectional envelope transfers, and Budget Exporting.
* `app/ledger/page.tsx` -> **Master Ledger**. Features: Transaction logging with automatic balance/envelope sync, autofill payees, filter-based account auto-selection, and URL parameter listening (`?account=id&new=true`) for deep-linking.
* `app/calendar/page.tsx` -> **Bill Calendar**. Features: Dynamic CSS grid calendar utilizing `date-fns` to map categories visually based on their `due_date`, accompanied by monthly "Total Due" vs "Funded" stats.
* `app/debt/page.tsx` -> **Debt Engine**. Features: Custom mathematical simulation that isolates `is_debt` categories, assumes `target_amount` is the minimum payment, and calculates future payoff dates utilizing both Snowball and Avalanche strategies based on total monthly power.

## 4. DESIGN & LOGIC RULES
* **Zero-Based Math:** `Ready to Assign` = Total Liquid Cash (Checking + Savings + Cash) minus total funds explicitly assigned to envelopes. The system uses a strict "snap to zero" rounding failsafe (`Math.abs(val) < 0.01`) on both the global RTA banner and individual category balances. This prevents JavaScript floating-point microscopic decimal bugs from throwing false negative warnings or causing "ghost" envelopes to appear in active filters.
* **Inline Math Evaluation:** The "Assigned" input accepts basic math operators (e.g., `+50`, `100-20`) to dynamically update assigned values.
* **Math Reversal Sync:** Deleting or editing a transaction automatically reverses the old math impact on accounts and envelopes before applying new changes, ensuring the ledger and balances are always perfectly synced.
* **Manual Adjustments vs Silent Updates:** When editing an account balance directly, the user can choose to let the system auto-calculate the difference and log a transaction ("Manual Adjustment") or bypass the ledger entirely ("Silent Update").
* **Credit Card Math Inversion:** Outflow (Expenses) on Credit Card accounts INCREASES the balance (debt), while Inflow (Income/Payments) DECREASES the balance.
* **Persistent Preferences:** Category sorting preferences, view filters, and expanded/collapsed group states are stored in `localStorage` to persist across sessions seamlessly.
* **Visual Urgency & Gamification:** Categories past their `due_date` auto-flag as "Late". `is_asap` overrides render red emergency backgrounds. **Overspent categories** (negative available balance) turn red and trigger a global warning banner at the top of the budget. **Fully funded categories** (Available >= Target) render with a glowing gold gradient to gamify goal completion.
* **Savings Breakdown:** Categories with targets and due dates dynamically calculate daily, weekly, and monthly funding requirements to meet goals on time.
* **Cycle Advancement:** Repeating categories feature a "Fast-Forward" action to advance the due date based on frequency. If the new date exceeds the `end_date`, the category is auto-hidden.
* **Transfers:** Handled natively by supplying both an `account_id` (From) and `to_account_id` (To) on a single transaction record, keeping Net Worth flat. Budget envelope transfers feature an omnidirectional swap toggle with text truncation to preserve flexbox layouts.
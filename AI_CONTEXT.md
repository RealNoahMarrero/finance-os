# 💵 FINANCE OS - PROJECT CONTEXT
**Tech Stack:** Next.js 16 (App Router), Tailwind CSS v4, Supabase, Lucide React.
**Styling:** Modern Clean x Brutalist. (Slate-50 background, rounded-2xl cards, shadow-sm, Emerald/Blue/Red semantic accents).

## 1. CORE PHILOSOPHY
Finance OS is a custom, manual-entry financial platform designed to replace YNAB. It utilizes a Zero-Based Budgeting philosophy ("Ready to Assign") but breaks the "monthly wall" by allowing for future forecasting, dynamic subscription tracking, and behavioral purchase ratings.

## 2. DATABASE SCHEMA (Supabase)
* **`accounts`**: `id`, `created_at`, `name`, `type` ('Checking', 'Savings', 'Credit Card', 'Cash'), `balance`, `credit_limit`. 
    * *Logic:* Credit cards are tracked as positive balance inputs in the UI, but the system dynamically subtracts them from the Total Net Worth calculation. Available credit is auto-calculated.
* **`category_groups`**: `id`, `name`, `sort_order`. (The macro folders, e.g., 'Living Expenses', 'Debt').
* **`categories`**: `id`, `group_id` (FK), `name`, `emoji`, `target_type` ('Set Aside', 'Fill Up To', 'Have Balance'), `target_amount`, `target_period` ('Weekly', 'Monthly', 'Yearly', 'None'), `due_date`, `is_repeating`, `end_date`, `notes`, `is_debt` (boolean), `balance` (outstanding debt owed), `is_asap` (boolean urgency flag), `assigned_amount` (current liquid cash inside the envelope), `sort_order`, `is_hidden` (for archived goals).
* **`transactions`**: `id`, `created_at`, `date`, `amount`, `payee`, `category_id` (FK), `account_id` (FK), `to_account_id` (FK - for transfers), `type` ('Income', 'Expense', 'Transfer'), `purchase_rating` ('Good', 'Neutral', 'Regret'), `notes`.

## 3. KEY FILE STRUCTURE
* `app/page.tsx` -> **Dashboard**. Features: Total Net Worth, Liquid Cash calculation, Account Management (CRUD with dynamic credit limit tracking), and a 10-item Recent Ledger feed. Includes 3-way Navigation.
* `app/budget/page.tsx` -> **Budget Engine**. Features: Zero-based "Ready to Assign" banner, Category Group creation, Category envelope management (with advanced targets, due dates, debt tracking, and savings breakdown math).
* `app/ledger/page.tsx` -> **Master Ledger**. Features: Transaction logging with automatic balance/envelope sync, purchase rating, and autofill payee suggestions.

## 4. DESIGN & LOGIC RULES
* **Zero-Based Math:** `Ready to Assign` = Total Liquid Cash (Checking + Savings + Cash) minus total funds explicitly assigned to envelopes.
* **Inline Math Evaluation:** The "Assigned" input accepts basic math operators (e.g., `+50`, `100-20`) to dynamically update assigned values.
* **Liquid Transfers:** Clicking the "Available" bubble opens a transfer modal, allowing users to shift liquid cash between envelopes or back to "Ready to Assign".
* **Math Reversal Sync:** Deleting or editing a transaction automatically reverses the old math impact on accounts and envelopes before applying new changes, ensuring the ledger and balances are always perfectly synced.
* **Credit Card Math Inversion:** Outflow (Expenses) on Credit Card accounts INCREASES the balance (debt), while Inflow (Income/Payments) DECREASES the balance.
* **Persistent Preferences:** Category sorting preferences (Name, Goal, Assigned, Due Date) are stored in `localStorage` (`finance_os_sort`) to persist across sessions.
* **Visual Urgency:** Categories past their `due_date` auto-flag as "Late". `is_asap` overrides render red emergency backgrounds.
* **Savings Breakdown:** Categories with targets and due dates dynamically calculate daily, weekly, and monthly funding requirements to meet goals on time.
* **Cycle Advancement:** Repeating categories feature a "Fast-Forward" action to advance the due date based on frequency. If the new date exceeds the `end_date`, the category is auto-hidden.
* **Behavioral Ratings:** Transactions include a Wallet-style `purchase_rating` (Good, Neutral, Regret) to track the emotional ROI of spending.
* **Transfers:** Handled natively by supplying both an `account_id` (From) and `to_account_id` (To) on a single transaction record.
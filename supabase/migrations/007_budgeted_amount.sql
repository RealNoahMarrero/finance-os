-- Separate budgeted (YNAB "assigned") from available (assigned_amount after activity).
-- RTA = liquid cash - sum(budgeted_amount); spending only reduces assigned_amount.

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS budgeted_amount numeric NOT NULL DEFAULT 0;

-- Backfill budgeted from current positive available balances.
-- Finance OS stored available (not YNAB budgeted) in assigned_amount; do not add
-- lifetime transaction totals or spending is double-counted against RTA.
UPDATE categories c
SET budgeted_amount = GREATEST(
  0,
  ROUND(COALESCE(c.assigned_amount, 0), 2)
);

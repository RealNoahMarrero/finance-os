-- =============================================================================
-- Marrero LLC — one-time historical import (Chase business checking ledger)
-- =============================================================================
-- Prerequisites:
--   1. Run 009_entities_and_ventures.sql first
--   2. Prefer running once. Re-run is blocked if this account already exists.
--
-- Notes:
--   • entity_id = business
--   • Ledger only: category envelopes stay at $0 (assign fresh in Budget if you want)
--   • Account ends at $0 (matches closure write-off)
--   • Date fixes applied:
--       3/17/2027  → 2026-03-17
--       Lockdown cluster dated 12/31/2026 → 2026-02-01
--         (sits between 1/31 and 2/16 in your running balance)
-- =============================================================================

do $$
declare
  v_acct_id bigint;
  v_group_income bigint;
  v_group_ops bigint;
  v_group_owner bigint;

  v_cat_owners_equity bigint;
  v_cat_sales bigint;
  v_cat_content bigint;
  v_cat_freelance bigint;
  v_cat_bank_fees bigint;
  v_cat_equipment bigint;
  v_cat_software bigint;
  v_cat_rent bigint;
  v_cat_prizes bigint;
  v_cat_owners_draw bigint;

  v_venture_overhead bigint;
  v_venture_gaming bigint;
  v_venture_not_noah bigint;
  v_venture_sour bigint;
begin
  if exists (
    select 1 from accounts
    where entity_id = 'business'
      and name = 'Chase Business Checking'
  ) then
    raise exception 'Import already applied (Chase Business Checking exists). Delete that business account (and its txns) first if you need a clean re-import.';
  end if;

  -- ---------------------------------------------------------------------------
  -- Ventures (use seeded names from 009; create if missing)
  -- ---------------------------------------------------------------------------
  select id into v_venture_overhead from ventures
  where entity_id = 'business' and name = 'General / Overhead' limit 1;
  if v_venture_overhead is null then
    insert into ventures (entity_id, name, notes, sort_order)
    values ('business', 'General / Overhead', 'Shared LLC overhead', 100)
    returning id into v_venture_overhead;
  end if;

  select id into v_venture_gaming from ventures
  where entity_id = 'business' and name = 'Marrero Gaming (YouTube)' limit 1;
  if v_venture_gaming is null then
    insert into ventures (entity_id, name, notes, sort_order)
    values ('business', 'Marrero Gaming (YouTube)', 'YouTube channel', 50)
    returning id into v_venture_gaming;
  end if;

  select id into v_venture_not_noah from ventures
  where entity_id = 'business' and name = 'Not Noah Marrero (YouTube)' limit 1;
  if v_venture_not_noah is null then
    insert into ventures (entity_id, name, notes, sort_order)
    values ('business', 'Not Noah Marrero (YouTube)', 'YouTube channel', 30)
    returning id into v_venture_not_noah;
  end if;

  select id into v_venture_sour from ventures
  where entity_id = 'business' and name = 'SOUR by MARRERO' limit 1;
  if v_venture_sour is null then
    insert into ventures (entity_id, name, notes, sort_order)
    values ('business', 'SOUR by MARRERO', 'Multimedia / production', 60)
    returning id into v_venture_sour;
  end if;

  -- ---------------------------------------------------------------------------
  -- Category groups
  -- ---------------------------------------------------------------------------
  insert into category_groups (name, sort_order, entity_id)
  values ('Income', 0, 'business')
  returning id into v_group_income;

  insert into category_groups (name, sort_order, entity_id)
  values ('Operating Expenses', 1, 'business')
  returning id into v_group_ops;

  insert into category_groups (name, sort_order, entity_id)
  values ('Owner', 2, 'business')
  returning id into v_group_owner;

  -- ---------------------------------------------------------------------------
  -- Categories (envelopes start at 0 — history lives on the ledger)
  -- ---------------------------------------------------------------------------
  insert into categories (
    group_id, name, emoji, target_type, target_amount, target_period,
    is_repeating, is_debt, balance, is_asap, is_hidden,
    assigned_amount, budgeted_amount, sort_order, entity_id, venture_id
  ) values
    (v_group_income, 'Owner''s Equity', null, 'Set Aside', 0, 'Monthly', false, false, 0, false, false, 0, 0, 0, 'business', null)
  returning id into v_cat_owners_equity;

  insert into categories (
    group_id, name, emoji, target_type, target_amount, target_period,
    is_repeating, is_debt, balance, is_asap, is_hidden,
    assigned_amount, budgeted_amount, sort_order, entity_id, venture_id
  ) values
    (v_group_income, 'Sales Income', null, 'Set Aside', 0, 'Monthly', false, false, 0, false, false, 0, 0, 1, 'business', null)
  returning id into v_cat_sales;

  insert into categories (
    group_id, name, emoji, target_type, target_amount, target_period,
    is_repeating, is_debt, balance, is_asap, is_hidden,
    assigned_amount, budgeted_amount, sort_order, entity_id, venture_id
  ) values
    (v_group_income, 'Content Revenue', null, 'Set Aside', 0, 'Monthly', false, false, 0, false, false, 0, 0, 2, 'business', null)
  returning id into v_cat_content;

  insert into categories (
    group_id, name, emoji, target_type, target_amount, target_period,
    is_repeating, is_debt, balance, is_asap, is_hidden,
    assigned_amount, budgeted_amount, sort_order, entity_id, venture_id
  ) values
    (v_group_ops, 'Freelance Services', null, 'Set Aside', 0, 'Monthly', false, false, 0, false, false, 0, 0, 0, 'business', null)
  returning id into v_cat_freelance;

  insert into categories (
    group_id, name, emoji, target_type, target_amount, target_period,
    is_repeating, is_debt, balance, is_asap, is_hidden,
    assigned_amount, budgeted_amount, sort_order, entity_id, venture_id
  ) values
    (v_group_ops, 'Bank Fees', null, 'Set Aside', 0, 'Monthly', false, false, 0, false, false, 0, 0, 1, 'business', null)
  returning id into v_cat_bank_fees;

  insert into categories (
    group_id, name, emoji, target_type, target_amount, target_period,
    is_repeating, is_debt, balance, is_asap, is_hidden,
    assigned_amount, budgeted_amount, sort_order, entity_id, venture_id
  ) values
    (v_group_ops, 'Equipment', null, 'Set Aside', 0, 'Monthly', false, false, 0, false, false, 0, 0, 2, 'business', null)
  returning id into v_cat_equipment;

  insert into categories (
    group_id, name, emoji, target_type, target_amount, target_period,
    is_repeating, is_debt, balance, is_asap, is_hidden,
    assigned_amount, budgeted_amount, sort_order, entity_id, venture_id
  ) values
    (v_group_ops, 'Software & Subscriptions', null, 'Set Aside', 0, 'Monthly', false, false, 0, false, false, 0, 0, 3, 'business', null)
  returning id into v_cat_software;

  insert into categories (
    group_id, name, emoji, target_type, target_amount, target_period,
    is_repeating, is_debt, balance, is_asap, is_hidden,
    assigned_amount, budgeted_amount, sort_order, entity_id, venture_id
  ) values
    (v_group_ops, 'Rent & Lease', null, 'Set Aside', 0, 'Monthly', false, false, 0, false, false, 0, 0, 4, 'business', null)
  returning id into v_cat_rent;

  insert into categories (
    group_id, name, emoji, target_type, target_amount, target_period,
    is_repeating, is_debt, balance, is_asap, is_hidden,
    assigned_amount, budgeted_amount, sort_order, entity_id, venture_id
  ) values
    (v_group_ops, 'Prizes & Awards', null, 'Set Aside', 0, 'Monthly', false, false, 0, false, false, 0, 0, 5, 'business', null)
  returning id into v_cat_prizes;

  insert into categories (
    group_id, name, emoji, target_type, target_amount, target_period,
    is_repeating, is_debt, balance, is_asap, is_hidden,
    assigned_amount, budgeted_amount, sort_order, entity_id, venture_id
  ) values
    (v_group_owner, 'Owner''s Draw', null, 'Set Aside', 0, 'Monthly', false, false, 0, false, false, 0, 0, 0, 'business', null)
  returning id into v_cat_owners_draw;

  -- ---------------------------------------------------------------------------
  -- Account (closed Chase business checking — final balance $0)
  -- ---------------------------------------------------------------------------
  insert into accounts (name, type, balance, credit_limit, entity_id)
  values ('Chase Business Checking', 'Checking', 0, 0, 'business')
  returning id into v_acct_id;

  -- ---------------------------------------------------------------------------
  -- Transactions
  -- ---------------------------------------------------------------------------
  insert into transactions (
    date, type, amount, payee, notes, account_id, to_account_id, category_id,
    entity_id, venture_id, owner_flow, linked_transaction_id
  ) values
  -- 2025-07
  ('2025-07-28', 'Income', 43.14, 'Noah Marrero', 'Transfer from personal account - Owner''s contribution.', v_acct_id, null, v_cat_owners_equity, 'business', v_venture_overhead, 'owner_contribution', null),
  ('2025-07-28', 'Expense', 43.14, 'Upwork', 'Freelance Services / Upwork', v_acct_id, null, v_cat_freelance, 'business', v_venture_gaming, null, null),
  -- 2025-08
  ('2025-08-13', 'Income', 47.14, 'Noah Marrero', 'Transfer from personal account - Owner''s contribution.', v_acct_id, null, v_cat_owners_equity, 'business', v_venture_overhead, 'owner_contribution', null),
  ('2025-08-13', 'Expense', 47.14, 'Upwork', 'Freelance Services / Upwork', v_acct_id, null, v_cat_freelance, 'business', v_venture_gaming, null, null),
  ('2025-08-22', 'Income', 42.15, 'Noah Marrero', 'Transfer from personal account - Owner''s contribution.', v_acct_id, null, v_cat_owners_equity, 'business', v_venture_overhead, 'owner_contribution', null),
  ('2025-08-22', 'Expense', 42.15, 'Upwork', 'Freelance Services / Upwork', v_acct_id, null, v_cat_freelance, 'business', v_venture_gaming, null, null),
  ('2025-08-29', 'Expense', 15.00, 'Chase', 'Chase Monthly Service Fee', v_acct_id, null, v_cat_bank_fees, 'business', v_venture_overhead, null, null),
  -- 2025-09
  ('2025-09-02', 'Income', 62.42, 'Noah Marrero', 'Transfer from personal account - Owner''s contribution.', v_acct_id, null, v_cat_owners_equity, 'business', v_venture_overhead, 'owner_contribution', null),
  ('2025-09-02', 'Expense', 47.42, 'Upwork', 'Freelance Services / Upwork', v_acct_id, null, v_cat_freelance, 'business', v_venture_gaming, null, null),
  ('2025-09-04', 'Income', 40.00, 'Noah Marrero', 'Transfer from personal account - Owner''s contribution.', v_acct_id, null, v_cat_owners_equity, 'business', v_venture_overhead, 'owner_contribution', null),
  ('2025-09-04', 'Income', 2.15, 'Noah Marrero', 'Transfer from personal account - Owner''s contribution.', v_acct_id, null, v_cat_owners_equity, 'business', v_venture_overhead, 'owner_contribution', null),
  ('2025-09-05', 'Expense', 42.15, 'Upwork', 'Freelance Services / Upwork', v_acct_id, null, v_cat_freelance, 'business', v_venture_gaming, null, null),
  ('2025-09-15', 'Income', 16.10, 'Noah Marrero', 'Transfer from personal account - Owner''s contribution.', v_acct_id, null, v_cat_owners_equity, 'business', v_venture_overhead, 'owner_contribution', null),
  ('2025-09-15', 'Income', 9.37, 'Noah Marrero', 'Transfer from personal account - Owner''s contribution.', v_acct_id, null, v_cat_owners_equity, 'business', v_venture_overhead, 'owner_contribution', null),
  ('2025-09-15', 'Expense', 16.10, 'Amazon', 'Mono to Stereo Adapter & Phone Tripod Mount', v_acct_id, null, v_cat_equipment, 'business', v_venture_not_noah, null, null),
  ('2025-09-15', 'Expense', 9.37, 'Amazon', 'TRS to TRSS Microphone Patch Cable', v_acct_id, null, v_cat_equipment, 'business', v_venture_not_noah, null, null),
  ('2025-09-30', 'Expense', 15.00, 'Chase', 'Chase Monthly Service Fee', v_acct_id, null, v_cat_bank_fees, 'business', v_venture_overhead, null, null),
  -- 2025-10 / 11 / 12
  ('2025-10-31', 'Expense', 15.00, 'Chase', 'Chase Monthly Service Fee', v_acct_id, null, v_cat_bank_fees, 'business', v_venture_overhead, null, null),
  ('2025-11-07', 'Income', 50.00, 'Cole Saunier (Sanye)', 'Revenue Correction - Sanye Music Video Edit (11/4)', v_acct_id, null, v_cat_sales, 'business', v_venture_sour, null, null),
  ('2025-11-28', 'Expense', 15.00, 'Chase', 'Chase Monthly Service Fee', v_acct_id, null, v_cat_bank_fees, 'business', v_venture_overhead, null, null),
  ('2025-12-11', 'Income', 79.82, 'Twitch', 'Twitch Payout - November 2025', v_acct_id, null, v_cat_content, 'business', v_venture_not_noah, null, null),
  ('2025-12-19', 'Income', 108.08, 'Noah Marrero', 'Transfer from personal account - Owner''s contribution.', v_acct_id, null, v_cat_owners_equity, 'business', v_venture_overhead, 'owner_contribution', null),
  ('2025-12-28', 'Expense', 75.24, 'Adobe', 'Adobe Creative Cloud Pro Subscription', v_acct_id, null, v_cat_software, 'business', v_venture_sour, null, null),
  ('2025-12-31', 'Expense', 15.00, 'Chase', 'Chase Monthly Service Fee', v_acct_id, null, v_cat_bank_fees, 'business', v_venture_overhead, null, null),
  -- 2026-01
  ('2026-01-11', 'Income', 15.00, 'Cole Saunier (Sanye)', 'Design Tip: Cole Saunier (Gross)', v_acct_id, null, v_cat_sales, 'business', v_venture_sour, null, null),
  ('2026-01-11', 'Expense', 0.26, 'Venmo', 'Venmo Instant Transfer Fee', v_acct_id, null, v_cat_bank_fees, 'business', v_venture_sour, null, null),
  ('2026-01-15', 'Income', 59.68, 'Twitch', 'Twitch Payout - December 2025', v_acct_id, null, v_cat_content, 'business', v_venture_not_noah, null, null),
  ('2026-01-28', 'Expense', 75.24, 'Adobe', 'Adobe Creative Cloud Pro Subscription', v_acct_id, null, v_cat_software, 'business', v_venture_sour, null, null),
  ('2026-01-31', 'Expense', 15.00, 'Chase', 'Chase Monthly Service Fee', v_acct_id, null, v_cat_bank_fees, 'business', v_venture_overhead, null, null),
  -- Lockdown 3.0 (date corrected from 12/31/2026 → 2026-02-01)
  ('2026-02-01', 'Income', 214.85, 'Noah Marrero', 'Owner Contribution for Lockdown 3.0', v_acct_id, null, v_cat_owners_equity, 'business', v_venture_overhead, 'owner_contribution', null),
  ('2026-02-01', 'Income', 27.68, 'Noah Marrero', 'Owner Contribution for Lockdown 3.0', v_acct_id, null, v_cat_owners_equity, 'business', v_venture_overhead, 'owner_contribution', null),
  ('2026-02-01', 'Expense', 220.00, 'Bales Arena', 'Venue Rental - Bales Arena (Cash Withdrawal)', v_acct_id, null, v_cat_rent, 'business', v_venture_sour, null, null),
  ('2026-02-01', 'Expense', 100.00, 'Winning Team', 'Winning Team Prize Payout (Cash Withdrawal)', v_acct_id, null, v_cat_prizes, 'business', v_venture_sour, null, null),
  ('2026-02-01', 'Income', 145.00, 'Various Players', 'Event Revenue: Lockdown 3.0 (CashApp + Cash)', v_acct_id, null, v_cat_sales, 'business', v_venture_sour, null, null),
  ('2026-02-01', 'Expense', 145.00, 'Noah Marrero', 'Transfer to Personal (Revenue Retained by Owner)', v_acct_id, null, v_cat_owners_draw, 'business', v_venture_overhead, 'owner_draw', null),
  -- 2026-02
  ('2026-02-16', 'Income', 51.00, 'Cole Saunier (Sanye)', 'Sanye Music Video - Gross', v_acct_id, null, v_cat_sales, 'business', v_venture_sour, null, null),
  ('2026-02-17', 'Expense', 0.89, 'Venmo', 'Venmo Instant Transfer Fee ($0.89)', v_acct_id, null, v_cat_bank_fees, 'business', v_venture_sour, null, null),
  ('2026-02-27', 'Expense', 15.00, 'Chase', 'Chase Monthly Service Fee', v_acct_id, null, v_cat_bank_fees, 'business', v_venture_overhead, null, null),
  ('2026-02-28', 'Expense', 75.24, 'Adobe', 'Adobe Creative Cloud Pro Subscription', v_acct_id, null, v_cat_software, 'business', v_venture_sour, null, null),
  -- 2026-03
  ('2026-03-07', 'Income', 40.00, 'Zion Jones', 'Flyer Design: Zion Jones', v_acct_id, null, v_cat_sales, 'business', v_venture_sour, null, null),
  ('2026-03-09', 'Expense', 39.30, 'Noah Marrero', 'Personal Distribution (Venmo Direct)', v_acct_id, null, v_cat_owners_draw, 'business', v_venture_overhead, 'owner_draw', null),
  ('2026-03-09', 'Expense', 0.70, 'Venmo', 'Venmo Instant Transfer Fee (Flyer Job)', v_acct_id, null, v_cat_bank_fees, 'business', v_venture_sour, null, null),
  ('2026-03-12', 'Income', 68.05, 'Twitch', 'Twitch Payout - February 2026', v_acct_id, null, v_cat_content, 'business', v_venture_not_noah, null, null),
  ('2026-03-17', 'Expense', 37.29, 'Noah Marrero', 'Transfer to Savings', v_acct_id, null, v_cat_owners_draw, 'business', v_venture_overhead, 'owner_draw', null),
  ('2026-03-31', 'Expense', 15.00, 'Chase', 'Chase Monthly Service Fee', v_acct_id, null, v_cat_bank_fees, 'business', v_venture_overhead, null, null),
  -- 2026-04
  ('2026-04-16', 'Expense', 75.24, 'Adobe', 'Adobe Creative Cloud Pro Subscription', v_acct_id, null, v_cat_software, 'business', v_venture_sour, null, null),
  ('2026-04-17', 'Expense', 34.00, 'Chase', 'Overdraft Fee', v_acct_id, null, v_cat_bank_fees, 'business', v_venture_overhead, null, null),
  ('2026-04-29', 'Expense', 75.24, 'Adobe', 'Adobe Creative Cloud Pro Subscription', v_acct_id, null, v_cat_software, 'business', v_venture_sour, null, null),
  ('2026-04-30', 'Expense', 15.00, 'Chase', 'Chase Monthly Service Fee', v_acct_id, null, v_cat_bank_fees, 'business', v_venture_overhead, null, null),
  ('2026-04-30', 'Expense', 34.00, 'Chase', 'Overdraft Fee', v_acct_id, null, v_cat_bank_fees, 'business', v_venture_overhead, null, null),
  -- 2026-05 / 06
  ('2026-05-29', 'Expense', 15.00, 'Chase', 'Chase Monthly Service Fee', v_acct_id, null, v_cat_bank_fees, 'business', v_venture_overhead, null, null),
  ('2026-06-06', 'Income', 50.00, 'Zion Jones', 'Flyer Design: Zion Jones', v_acct_id, null, v_cat_sales, 'business', v_venture_overhead, null, null),
  ('2026-06-07', 'Expense', 0.87, 'Venmo', 'Venmo Instant Transfer Fee', v_acct_id, null, v_cat_bank_fees, 'business', v_venture_sour, null, null),
  ('2026-06-08', 'Expense', 49.13, 'Noah Marrero', 'Transfer to Personal (Revenue Retained by Owner)', v_acct_id, null, v_cat_owners_draw, 'business', v_venture_overhead, 'owner_draw', null),
  ('2026-06-10', 'Income', 263.48, 'Chase', 'Account Closure Write-off / Clear Negative Balance', v_acct_id, null, v_cat_bank_fees, 'business', v_venture_overhead, null, null);

  raise notice 'Marrero LLC import complete. Account id=% (Chase Business Checking, balance $0).', v_acct_id;
end $$;

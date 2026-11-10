-- READ-ONLY. Run in the Supabase SQL editor BEFORE applying 018 (it changes nothing).
-- Lists transactions dated in the future that were entered under the old rule (they ALREADY changed balances/envelopes).
-- Migration 018 leaves every one of them exactly as it is ('posted'); only transactions created after the new app is live can be 'scheduled'.
select t.id, t.date, t.type, t.payee, t.amount, a.name as account, c.name as category
from public.transactions t
left join public.accounts a on a.id = t.account_id
left join public.categories c on c.id = t.category_id
where t.date > current_date and coalesce(t.is_adjustment, false) = false
order by t.date, t.id;

-- Reference counts to compare before and after the migration (must be identical afterwards):
select (select count(*) from public.transactions) as transactions,
       (select count(*) from public.categories where is_debt) as debts,
       (select round(sum(balance), 2) from public.accounts) as sum_account_balances,
       (select round(sum(assigned_amount), 2) from public.categories) as sum_envelopes;

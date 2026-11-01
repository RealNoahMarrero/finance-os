\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
create table public._results(name text, ok boolean, detail text);
create or replace function public.t_check(n text, cond boolean, d text default '') returns void language plpgsql security definer as $$ begin insert into public._results values (n, coalesce(cond,false), d); end $$;
grant execute on function public.t_check(text,boolean,text) to anon, authenticated;

-- fixtures (as superuser): owner + tiny isolated accounts/categories so assertions are exact
insert into app_owner(user_id,email) values ('11111111-1111-1111-1111-111111111111','owner@test');
insert into accounts(id,name,type,balance,entity_id) values (9001,'T Checking','Checking',1000,'personal'),(9002,'T Savings','Savings',500,'personal'),(9003,'T Card','Credit Card',200,'personal');
insert into category_groups(id,name,sort_order,entity_id) values (9001,'T group',1,'personal');
insert into categories(id,group_id,name,assigned_amount,entity_id,target_amount,is_debt,balance,is_repeating,due_date,target_period) values
 (9001,9001,'T Groceries',300,'personal',0,false,0,false,null,null),(9002,9001,'T Fun',100,'personal',0,false,0,false,null,null),(9003,9001,'T Card pay',0,'personal',0,false,0,false,null,null),
 (9004,9001,'T Loan',0,'personal',250,true,5000,true,'2026-11-15','Monthly');

-- ── security ──
set role anon;
do $$ begin begin perform count(*) from transactions; perform public.t_check('anon cannot read transactions', false); exception when insufficient_privilege then perform public.t_check('anon cannot read transactions', true); end; end $$;
do $$ begin begin insert into transactions(date,amount,type,account_id,entity_id) values ('2026-11-01',1,'Expense',9001,'personal'); perform public.t_check('anon cannot insert', false); exception when others then perform public.t_check('anon cannot insert', true); end; end $$;
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.t_check('non-owner sees no accounts', (select count(*) from accounts)=0);
do $$ begin begin perform fos_create_transaction('{"date":"2026-11-01","amount":5,"type":"Expense","account_id":9001}'); perform public.t_check('non-owner cannot mutate', false); exception when others then perform public.t_check('non-owner cannot mutate', true); end; end $$;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.t_check('owner sees accounts', (select count(*) from accounts)>=8);

-- ── expense / income / transfer ──
select fos_create_transaction('{"date":"2026-11-02","amount":40.25,"payee":"Shop","type":"Expense","account_id":9001,"category_id":9001,"client_request_id":"aaaaaaaa-0000-0000-0000-000000000001"}') as e1 \gset
select public.t_check('expense lowers checking', (select balance from accounts where id=9001)=959.75);
select public.t_check('expense lowers envelope', (select assigned_amount from categories where id=9001)=259.75);
select fos_create_transaction('{"date":"2026-11-02","amount":40.25,"payee":"Shop","type":"Expense","account_id":9001,"category_id":9001,"client_request_id":"aaaaaaaa-0000-0000-0000-000000000001"}') as e1b \gset
select public.t_check('duplicate submit is idempotent', :e1 = :e1b and (select balance from accounts where id=9001)=959.75 and (select count(*) from transactions where client_request_id='aaaaaaaa-0000-0000-0000-000000000001')=1);
select fos_create_transaction('{"date":"2026-11-03","amount":100,"payee":"Pay","type":"Income","account_id":9001}') as i1 \gset
select public.t_check('income raises checking, no envelope change', (select balance from accounts where id=9001)=1059.75 and (select assigned_amount from categories where id=9001)=259.75);
select fos_create_transaction('{"date":"2026-11-03","amount":50,"type":"Transfer","account_id":9001,"to_account_id":9002}') as t1 \gset
select public.t_check('transfer moves money, not income/expense', (select balance from accounts where id=9001)=1009.75 and (select balance from accounts where id=9002)=550);
-- credit card
select fos_create_transaction('{"date":"2026-11-04","amount":30,"payee":"Card buy","type":"Expense","account_id":9003,"category_id":9002}') as c1 \gset
select public.t_check('card purchase raises owed', (select balance from accounts where id=9003)=230);
select fos_create_transaction('{"date":"2026-11-05","amount":80,"type":"Transfer","account_id":9001,"to_account_id":9003,"category_id":9003}') as c2 \gset
select public.t_check('card payment lowers owed and checking', (select balance from accounts where id=9003)=150 and (select balance from accounts where id=9001)=929.75);

-- ── split ──
select fos_create_transaction('{"date":"2026-11-06","amount":60,"payee":"Market","type":"Expense","account_id":9001,"splits":[{"category_id":9001,"amount":45},{"category_id":9002,"amount":15}]}') as s1 \gset
select public.t_check('split: one account movement, per-category envelopes', (select balance from accounts where id=9001)=869.75 and (select assigned_amount from categories where id=9001)=214.75 and (select assigned_amount from categories where id=9002)=55
  and (select category_id from transactions where id=:s1) is null and (select count(*) from transaction_splits where transaction_id=:s1)=2);
do $$ begin begin perform fos_create_transaction('{"date":"2026-11-06","amount":60,"type":"Expense","account_id":9001,"splits":[{"category_id":9001,"amount":10}]}'); perform public.t_check('bad split sum rejected', false); exception when others then perform public.t_check('bad split sum rejected', true); end; end $$;
-- ── edit: reverse + reapply, split stays split ──
select fos_update_transaction(:s1, '{"date":"2026-11-06","amount":70,"payee":"Market","type":"Expense","account_id":9001,"splits":[{"category_id":9001,"amount":50},{"category_id":9002,"amount":20}]}');
select public.t_check('edit split reapplies exactly', (select balance from accounts where id=9001)=859.75 and (select assigned_amount from categories where id=9001)=209.75 and (select assigned_amount from categories where id=9002)=50);
select fos_update_transaction(:e1, '{"date":"2026-11-02","amount":40.25,"payee":"Shop","type":"Expense","account_id":9002,"category_id":9002}');
select public.t_check('edit moves effect between accounts/envelopes', (select balance from accounts where id=9002)=509.75 and (select assigned_amount from categories where id=9001)=250 and (select assigned_amount from categories where id=9002)=9.75);
-- ── delete reverses ──
select fos_delete_transaction(:s1);
select public.t_check('delete reverses split effects', (select balance from accounts where id=9001)=970 and (select assigned_amount from categories where id=9001)=300 and (select assigned_amount from categories where id=9002)=29.75 and (select count(*) from transaction_splits where transaction_id=:s1)=0);
-- ── failed mutation leaves nothing behind (atomic) ──
do $$ declare b numeric; begin select balance into b from accounts where id=9001;
  begin perform fos_create_transaction('{"date":"2026-11-07","amount":10,"type":"Expense","account_id":9001,"category_id":9001,"to_account_id":null,"splits":[{"category_id":99999999,"amount":10}]}'); exception when others then null; end;
  perform public.t_check('failed create is fully rolled back', (select balance from accounts where id=9001)=b and (select count(*) from transactions where date='2026-11-07' and account_id=9001)=0); end $$;

-- ── budget moves ──
select fos_assign('[{"category_id":9001,"amount":25},{"category_id":9002,"amount":-5}]');
select public.t_check('assign adjusts envelopes', (select assigned_amount from categories where id=9001)=325 and (select assigned_amount from categories where id=9002)=24.75);
select fos_move_money(9001, 9002, 34.75);
select public.t_check('move conserves total', (select assigned_amount from categories where id=9001)=290.25 and (select assigned_amount from categories where id=9002)=59.5);

-- ── cutover + derived balance ──
select fos_set_cutover(9001, '2026-11-04', 800, 'test baseline') as cb \gset
-- txns after 11-04 on 9001: card payment -80 (transfer from checking)
select public.t_check('cutover derives balance = opening + post-cutover activity only', :cb = 720 and (select balance from accounts where id=9001)=720);
select public.t_check('pre-cutover txns untouched/preserved', (select count(*) from transactions where account_id=9001 and date<='2026-11-04')>=2);
select fos_create_transaction('{"date":"2026-11-08","amount":20,"payee":"Post","type":"Expense","account_id":9001,"category_id":9001}');
select public.t_check('post-cutover txn keeps recorded = derived', (select balance from accounts where id=9001)=(select fos_derived_balance(9001)) and (select balance from accounts where id=9001)=700);
-- ── reconciliation ──
select fos_reconcile(9001, 690.50, '2026-11-09') as r \gset
select public.t_check('reconcile records adjustment and event', (select balance from accounts where id=9001)=690.50 and (select count(*) from account_reconciliations where account_id=9001)=1 and (select is_adjustment from transactions where payee='Reconciliation adjustment' and account_id=9001 limit 1) and (select type from transactions where payee='Reconciliation adjustment' and account_id=9001 limit 1)='Expense');
select public.t_check('adjustment does not touch envelopes', (select assigned_amount from categories where id=9001)=270.25);
select public.t_check('derived still matches after adjustment', (select fos_derived_balance(9001))=690.50);
do $$ begin begin perform fos_delete_transaction((select id from transactions where payee='Reconciliation adjustment' and account_id=9001 limit 1)); perform public.t_check('adjustment cannot be deleted', false); exception when others then perform public.t_check('adjustment cannot be deleted', true); end; end $$;
select fos_reconcile(9003, 175, '2026-11-09');
select public.t_check('card reconcile: more owed => Expense adjustment', (select balance from accounts where id=9003)=175);

-- ── bills ──
select fos_pay_bill(9004, '2026-11-15', '2026-11-14', 'prepare', '{"date":"2026-11-14","amount":260,"payee":"Lender","type":"Expense","account_id":9001}') ;
select public.t_check('prepared bill posts one txn, advances due date, debt uses ACTUAL amount', (select due_date from categories where id=9004)='2026-12-15' and (select balance from categories where id=9004)=4740 and (select count(*) from bill_payments where category_id=9004)=1 and (select balance from accounts where id=9001)=430.50);
do $$ begin begin perform fos_pay_bill(9004, '2026-11-15', '2026-11-14', 'reminder'); perform public.t_check('duplicate bill payment blocked', false); exception when others then perform public.t_check('duplicate bill payment blocked', true); end; end $$;
select fos_pay_bill(9004, '2026-12-15', '2026-12-15', 'reminder');
select public.t_check('reminder-only creates no transaction, no debt change', (select count(*) from bill_payments where category_id=9004 and mode='reminder')=1 and (select balance from categories where id=9004)=4740 and (select balance from accounts where id=9001)=430.50);

-- ── expected income ──
insert into projected_income(id,label,amount,expected_date,account_id,status,certainty,entity_id) overriding system value values (9001,'T paycheck',500,'2026-11-20',9001,'pending','guaranteed','personal');
select public.t_check('pending income not in balance', (select balance from accounts where id=9001)=430.50);
select fos_receive_income(9001,'2026-11-20',510,9001) as ri \gset
select public.t_check('receipt posts once at confirmed amount', (select balance from accounts where id=9001)=940.50 and (select status from projected_income where id=9001)='received' and (select transaction_id from projected_income where id=9001)=:ri);
do $$ begin begin perform fos_receive_income(9001,'2026-11-20',510,9001); perform public.t_check('double receipt blocked', false); exception when others then perform public.t_check('double receipt blocked', true); end; end $$;

-- repeating income spawns the next occurrence atomically; skip cancels + spawns, no money moves
insert into projected_income(id,label,amount,expected_date,account_id,status,certainty,entity_id,is_repeating,repeat_period) overriding system value values (9002,'T biweekly',700,'2026-11-21',9001,'pending','guaranteed','personal',true,'Biweekly');
select fos_receive_income(9002,'2026-11-21',700,9001);
select public.t_check('repeating income spawns next pending occurrence', (select count(*) from projected_income where label='T biweekly' and status='pending' and expected_date='2026-12-05')=1 and (select balance from accounts where id=9001)=1640.50);
select fos_skip_income_occurrence((select id from projected_income where label='T biweekly' and status='pending'), '2026-12-05');
select public.t_check('skip cancels one occurrence, schedules next, no balance change', (select count(*) from projected_income where label='T biweekly' and status='cancelled')=1 and (select count(*) from projected_income where label='T biweekly' and status='pending' and expected_date='2026-12-19')=1 and (select balance from accounts where id=9001)=1640.50);
select public.t_check('semimonthly next dates', fos_next_income_date('2026-11-01','Semimonthly')='2026-11-16' and fos_next_income_date('2026-11-16','Semimonthly')='2026-12-01');

reset role;
select case when ok then 'PASS ' else 'FAIL ' end || name || case when ok then '' else '  -> '||detail end from _results order by ok, name;
select '--- ' || count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from _results;

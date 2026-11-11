// Real-SQL tests: the actual migrations (db/*.sql, including 018) run on an in-memory Postgres (PGlite) with the SYNTHETIC fixture.
// Every test runs inside a transaction that is rolled back, so tests are independent. Never touches Supabase or real data.
import { describe, it, expect, beforeAll } from 'vitest';
import { createDb, asOwner } from '../tools/demo/db.mjs';

let db;
beforeAll(async () => { db = await createDb(); }, 60000);

const ROLLBACK = Symbol('rollback');
async function sandbox(fn) {
  try { await asOwner(db, async (tx) => { await fn(tx); throw ROLLBACK; }); } catch (e) { if (e !== ROLLBACK) throw e; }
}
const rows = async (tx, sql, args = []) => (await tx.query(sql, args)).rows;
const one = async (tx, sql, args = []) => (await rows(tx, sql, args))[0];
const num = async (tx, sql, args = []) => Number(Object.values(await one(tx, sql, args))[0]);
const rpc = async (tx, fn, obj) => (await one(tx, `select to_jsonb(public.${fn}($1::jsonb)) as r`, [JSON.stringify(obj)])).r;
const bal = (tx, id) => num(tx, 'select balance from accounts where id=$1', [id]);
const avail = (tx, id) => num(tx, 'select assigned_amount from categories where id=$1', [id]);
const owed = (tx, id) => num(tx, 'select balance from categories where id=$1', [id]);
const due = async (tx, id) => String((await one(tx, 'select due_date::text as d from categories where id=$1', [id])).d);
async function fails(tx, sql, args = [], re) {
  await tx.query('savepoint s1');
  let msg = '';
  try { await tx.query(sql, args); } catch (e) { msg = String(e.message); }
  await tx.query('rollback to savepoint s1');
  expect(msg, 'expected the statement to be rejected').not.toBe('');
  if (re) expect(msg).toMatch(re);
}
const pay = (tx, o) => rpc(tx, 'fos_pay_bill_v2', { paid_on: '2026-11-10', ...o });
const rtaOf = (tx) => num(tx, `select coalesce((select sum(balance) from accounts where type <> 'Credit Card' and entity_id='personal' and not coalesce(is_archived,false)),0) - coalesce((select sum(assigned_amount) from categories where entity_id='personal' and not is_hidden),0)`);

// fixture: acct 1 Checking 4820.15 · acct 4 Rewards Visa (card, owed 1240.50, payment envelope = category 6)
// cat 2 Electric (monthly, due 2026-11-14, $118.40, holds $80) · cat 5 Car Loan (debt $8,400, $320/mo, due 2026-09-27 = two missed payments)

describe('bill payments (one atomic path)', () => {
  it('post: records the transaction, spends from the envelope, marks paid and advances the due date — together', () => sandbox(async (tx) => {
    const r = await pay(tx, { category_id: 2, due: '2026-11-14', mode: 'post', account_id: 1, amount: 118.4 });
    expect(r.settled).toBe(true);
    expect(await bal(tx, 1)).toBeCloseTo(4820.15 - 118.4, 2);
    expect(await avail(tx, 2)).toBeCloseTo(80 - 118.4, 2);
    expect(await due(tx, 2)).toBe('2026-12-14');
    expect(await num(tx, 'select count(*) from bill_payments where category_id=2')).toBe(1);
  }));

  it('a duplicate submission (same request id) changes nothing the second time', () => sandbox(async (tx) => {
    const o = { category_id: 2, due: '2026-11-14', mode: 'post', account_id: 1, amount: 118.4, request_id: '11111111-1111-1111-1111-111111111111' };
    await pay(tx, o); const second = await pay(tx, o);
    expect(second.duplicate).toBe(true);
    expect(await bal(tx, 1)).toBeCloseTo(4820.15 - 118.4, 2);
    expect(await num(tx, `select count(*) from transactions where client_request_id='11111111-1111-1111-1111-111111111111'`)).toBe(1);
  }));

  it('paying the same occurrence twice with different request ids is refused', () => sandbox(async (tx) => {
    await pay(tx, { category_id: 2, due: '2026-11-14', mode: 'post', account_id: 1, amount: 118.4 });
    await fails(tx, `select fos_pay_bill_v2($1::jsonb)`, [JSON.stringify({ category_id: 2, due: '2026-11-14', mode: 'post', account_id: 1, amount: 118.4 })], /already recorded as paid|oldest unpaid/);
  }));

  it('a card-payment bill is a transfer: checking down, card owed down, envelope spent once', () => sandbox(async (tx) => {
    await tx.query(`update categories set due_date='2026-11-20', bill_amount=600, is_repeating=true, target_period='Monthly' where id=6`);
    await pay(tx, { category_id: 6, due: '2026-11-20', mode: 'post', account_id: 1, amount: 600 });
    expect(await bal(tx, 1)).toBeCloseTo(4820.15 - 600, 2);
    expect(await bal(tx, 4)).toBeCloseTo(1240.5 - 600, 2);
    expect(await avail(tx, 6)).toBeCloseTo(0, 2);
  }));

  it('debt: paying through any path reduces what is owed; two missed payments are paid oldest first', () => sandbox(async (tx) => {
    await pay(tx, { category_id: 5, due: '2026-09-27', mode: 'post', account_id: 1, amount: 320 });
    expect(await owed(tx, 5)).toBe(8080);
    expect(await due(tx, 5)).toBe('2026-10-27');
    await fails(tx, `select fos_pay_bill_v2($1::jsonb)`, [JSON.stringify({ category_id: 5, due: '2026-11-27', mode: 'post', account_id: 1 })], /oldest unpaid/);
    await pay(tx, { category_id: 5, due: '2026-10-27', mode: 'post', account_id: 1, amount: 320 });
    expect(await owed(tx, 5)).toBe(7760);
    expect(await due(tx, 5)).toBe('2026-11-27');
  }));

  it('link: counts an already-recorded transaction, creates no second one, and cannot be linked twice', () => sandbox(async (tx) => {
    const tid = await num(tx, `select fos_create_transaction($1::jsonb)`, [JSON.stringify({ date: '2026-09-28', amount: 320, payee: 'Loan Co', type: 'Expense', account_id: 1, category_id: 5 })]);
    const before = await num(tx, 'select count(*) from transactions'); const checking = await bal(tx, 1);
    const r = await pay(tx, { category_id: 5, due: '2026-09-27', mode: 'link', transaction_id: tid });
    expect(r.created).toBe(false);
    expect(await num(tx, 'select count(*) from transactions')).toBe(before);
    expect(await bal(tx, 1)).toBe(checking);
    expect(await owed(tx, 5)).toBe(8080);
    await fails(tx, `select fos_pay_bill_v2($1::jsonb)`, [JSON.stringify({ category_id: 5, due: '2026-10-27', mode: 'link', transaction_id: tid })], /already linked/);
  }));

  it('link refuses a transaction from a different category or an income', () => sandbox(async (tx) => {
    const wrong = await num(tx, `select fos_create_transaction($1::jsonb)`, [JSON.stringify({ date: '2026-09-28', amount: 320, payee: 'X', type: 'Expense', account_id: 1, category_id: 7 })]);
    await fails(tx, `select fos_pay_bill_v2($1::jsonb)`, [JSON.stringify({ category_id: 5, due: '2026-09-27', mode: 'link', transaction_id: wrong })], /different category/);
  }));

  it('external (paid outside tracked accounts): marks paid, creates no transaction, still reduces the debt', () => sandbox(async (tx) => {
    const before = await num(tx, 'select count(*) from transactions'); const checking = await bal(tx, 1);
    await pay(tx, { category_id: 5, due: '2026-09-27', mode: 'external', amount: 320 });
    expect(await num(tx, 'select count(*) from transactions')).toBe(before);
    expect(await bal(tx, 1)).toBe(checking);
    expect(await owed(tx, 5)).toBe(8080);
    expect(await due(tx, 5)).toBe('2026-10-27');
  }));

  it('partial payment: recorded and applied, but the occurrence stays due', () => sandbox(async (tx) => {
    const r = await pay(tx, { category_id: 5, due: '2026-09-27', mode: 'post', account_id: 1, amount: 100, settle: false });
    expect(r.settled).toBe(false);
    expect(await due(tx, 5)).toBe('2026-09-27');
    expect(await owed(tx, 5)).toBe(8300);
    expect(await num(tx, 'select count(*) from bill_payments where category_id=5')).toBe(0);
  }));

  it('overpayment settles the occurrence and reduces the debt by the full amount paid', () => sandbox(async (tx) => {
    await pay(tx, { category_id: 5, due: '2026-09-27', mode: 'post', account_id: 1, amount: 400 });
    expect(await owed(tx, 5)).toBe(8000);
    expect(await due(tx, 5)).toBe('2026-10-27');
  }));

  it('backdated payment keeps its date', () => sandbox(async (tx) => {
    await pay(tx, { category_id: 2, due: '2026-11-14', mode: 'post', account_id: 1, amount: 118.4, paid_on: '2026-11-03' });
    expect(String((await one(tx, `select date::text as d from transactions where category_id=2 order by id desc limit 1`)).d)).toBe('2026-11-03');
  }));

  it('undo restores the due date, the debt and (when it created one) removes the transaction', () => sandbox(async (tx) => {
    const checking = await bal(tx, 1); const env = await avail(tx, 5);
    await pay(tx, { category_id: 5, due: '2026-09-27', mode: 'post', account_id: 1, amount: 320 });
    await tx.query(`select fos_unpay_bill(5, '2026-09-27', true)`);
    expect(await due(tx, 5)).toBe('2026-09-27'); expect(await owed(tx, 5)).toBe(8400);
    expect(await bal(tx, 1)).toBeCloseTo(checking, 2); expect(await avail(tx, 5)).toBeCloseTo(env, 2);
    expect(await num(tx, 'select count(*) from bill_payments where category_id=5')).toBe(0);
  }));

  it('a payment larger than the debt only removes what is owed, and undo restores exactly that (was: undo over-restored)', () => sandbox(async (tx) => {
    await tx.query(`update categories set balance = 100 where id = 5`);
    await pay(tx, { category_id: 5, due: '2026-09-27', mode: 'external', amount: 320 });
    expect(await owed(tx, 5)).toBe(0);
    await tx.query(`select fos_unpay_bill(5, '2026-09-27', false)`);
    expect(await owed(tx, 5)).toBe(100);
  }));

  it('a partial payment can be undone: transaction removed, debt restored', () => sandbox(async (tx) => {
    const checking = await bal(tx, 1);
    const r = await pay(tx, { category_id: 5, due: '2026-09-27', mode: 'post', account_id: 1, amount: 100, settle: false });
    await tx.query(`select fos_unpay_bill(5, '2026-09-27', true, $1, $2)`, [r.transaction_id, r.debt_applied]);
    expect(await owed(tx, 5)).toBe(8400); expect(await bal(tx, 1)).toBeCloseTo(checking, 2);
  }));

  it('undo only the most recent payment', () => sandbox(async (tx) => {
    await pay(tx, { category_id: 5, due: '2026-09-27', mode: 'external', amount: 320 });
    await pay(tx, { category_id: 5, due: '2026-10-27', mode: 'external', amount: 320 });
    await fails(tx, `select fos_unpay_bill(5, '2026-09-27', false)`, [], /most recent/);
  }));

  it('an archived bill cannot be paid', () => sandbox(async (tx) => {
    await tx.query(`select fos_archive_bill(2, true, false, null)`);
    await fails(tx, `select fos_pay_bill_v2($1::jsonb)`, [JSON.stringify({ category_id: 2, due: '2026-11-14', mode: 'external' })], /archived/);
  }));
});

describe('scheduled (future-dated) transactions', () => {
  const sched = { date: '2026-11-20', amount: 50, payee: 'Gym', type: 'Expense', account_id: 1, category_id: 9, scheduled: true };
  it('a scheduled transaction changes no balance and no envelope', () => sandbox(async (tx) => {
    const b = await bal(tx, 1), e = await avail(tx, 9), d = await num(tx, 'select fos_derived_balance(1)');
    const id = await num(tx, `select fos_create_transaction($1::jsonb)`, [JSON.stringify(sched)]);
    expect(await bal(tx, 1)).toBe(b); expect(await avail(tx, 9)).toBe(e); expect(await num(tx, 'select fos_derived_balance(1)')).toBe(d);
    expect((await one(tx, 'select status from transactions where id=$1', [id])).status).toBe('scheduled');
  }));
  it('posting applies it exactly once, only on or after its date', () => sandbox(async (tx) => {
    await tx.query(`select fos_create_transaction($1::jsonb)`, [JSON.stringify(sched)]);
    const b = await bal(tx, 1);
    expect(await num(tx, `select fos_post_due('2026-11-19')`)).toBe(0); expect(await bal(tx, 1)).toBe(b);
    expect(await num(tx, `select fos_post_due('2026-11-20')`)).toBe(1); expect(await bal(tx, 1)).toBeCloseTo(b - 50, 2); expect(await avail(tx, 9)).toBeCloseTo(55 - 50, 2);
    expect(await num(tx, `select fos_post_due('2026-11-25')`)).toBe(0); expect(await bal(tx, 1)).toBeCloseTo(b - 50, 2);
  }));
  it('editing or deleting a scheduled transaction never touches balances; moving it to a posted state applies it once', () => sandbox(async (tx) => {
    const id = await num(tx, `select fos_create_transaction($1::jsonb)`, [JSON.stringify(sched)]);
    const b = await bal(tx, 1);
    await tx.query(`select fos_update_transaction($1, $2::jsonb)`, [id, JSON.stringify({ ...sched, amount: 70 })]);
    expect(await bal(tx, 1)).toBe(b);
    await tx.query(`select fos_update_transaction($1, $2::jsonb)`, [id, JSON.stringify({ ...sched, amount: 70, scheduled: false })]);
    expect(await bal(tx, 1)).toBeCloseTo(b - 70, 2);
    await tx.query(`select fos_delete_transaction($1)`, [id]);
    expect(await bal(tx, 1)).toBeCloseTo(b, 2);
    const id2 = await num(tx, `select fos_create_transaction($1::jsonb)`, [JSON.stringify(sched)]);
    await tx.query(`select fos_delete_transaction($1)`, [id2]); expect(await bal(tx, 1)).toBeCloseTo(b, 2);
  }));
  it('compatibility: a payload without "scheduled" still posts immediately, even with a future date (the old rule)', () => sandbox(async (tx) => {
    const b = await bal(tx, 1);
    await tx.query(`select fos_create_transaction($1::jsonb)`, [JSON.stringify({ ...sched, scheduled: undefined })]);
    expect(await bal(tx, 1)).toBeCloseTo(b - 50, 2);
  }));
});

describe('expected income recurrence (SQL = app)', () => {
  const next = (d, p, a = null) => num(tx0, 'select 1').then(() => null) && null; void next;
  let tx0;
  const nx = async (tx, d, p, a = null) => String((await one(tx, `select public.fos_next_income_date($1::date, $2, $3::date)::text as n`, [d, p, a])).n);
  it('monthly keeps the original day: no drift after a short month', () => sandbox(async (tx) => {
    expect(await nx(tx, '2027-01-31', 'Monthly')).toBe('2027-02-28');
    expect(await nx(tx, '2027-02-28', 'Monthly', '2027-01-31')).toBe('2027-03-31');
    expect(await nx(tx, '2027-03-31', 'Monthly', '2027-01-31')).toBe('2027-04-30');
  }));
  it('semimonthly = 1st and 16th, off weekends', () => sandbox(async (tx) => {
    expect(await nx(tx, '2026-11-16', 'Semimonthly')).toBe('2026-12-01');
    expect(await nx(tx, '2026-12-01', 'Semimonthly')).toBe('2026-12-16');
    expect(await nx(tx, '2027-04-16', 'Semimonthly')).toBe('2027-04-30'); // May 1 is a Saturday -> Friday
    expect(await nx(tx, '2027-04-30', 'Semimonthly')).toBe('2027-05-17'); // May 16 is a Sunday -> Monday
  }));
  it('receiving a repeating income schedules the next one with the anchor carried forward', () => sandbox(async (tx) => {
    await tx.query(`insert into projected_income (label, amount, expected_date, status, certainty, is_repeating, repeat_period, account_id, entity_id) values ('Rent in', 100, '2027-01-31', 'pending', 'guaranteed', true, 'Monthly', 1, 'personal')`);
    const id = await num(tx, `select max(id) from projected_income`);
    await tx.query(`select fos_receive_income($1, '2027-01-31', 100, 1, null)`, [id]);
    const n1 = await one(tx, `select id, expected_date::text as d, income_anchor::text as a from projected_income where status='pending' and label='Rent in'`);
    expect(n1.d).toBe('2027-02-28'); expect(n1.a).toBe('2027-01-31');
    await tx.query(`select fos_receive_income($1, '2027-02-28', 100, 1, null)`, [n1.id]);
    expect((await one(tx, `select expected_date::text as d from projected_income where status='pending' and label='Rent in'`)).d).toBe('2027-03-31');
  }));
  it('skip returns the occurrence it created; unskip removes exactly that one', () => sandbox(async (tx) => {
    const before = await num(tx, `select count(*) from projected_income where status='pending'`);
    const r = await one(tx, `select to_jsonb(fos_skip_income_occurrence(1, null)) as r`);
    expect(r.r.next_id).toBeTruthy();
    await tx.query(`select fos_unskip_income_occurrence(1, (select expected_date from projected_income where id=1), $1)`, [r.r.next_id]);
    expect(await num(tx, `select count(*) from projected_income where status='pending'`)).toBe(before);
  }));
});

describe('confirming overdue expected income', () => {
  it('receiving an overdue entry credits the account and Ready to Assign once, keeps the stored date, and schedules the next from the ORIGINAL date', () => sandbox(async (tx) => {
    await tx.query(`insert into projected_income (label, amount, expected_date, status, certainty, is_repeating, repeat_period, account_id, entity_id) values ('Weekly gig', 100, '2026-11-02', 'pending', 'guaranteed', true, 'Weekly', 1, 'personal')`);
    const id = await num(tx, `select max(id) from projected_income`);
    const checking = await bal(tx, 1), rta = await rtaOf(tx);
    await tx.query(`select fos_receive_income($1, '2026-11-10', 100, 1, '22222222-2222-2222-2222-222222222222')`, [id]);
    await fails(tx, `select fos_receive_income($1, '2026-11-10', 100, 1, null)`, [id], /already received/); // a second confirmation is refused
    expect(await bal(tx, 1)).toBeCloseTo(checking + 100, 2);
    expect(await rtaOf(tx)).toBeCloseTo(rta + 100, 2);
    const r = await one(tx, `select status, expected_date::text as d from projected_income where id=$1`, [id]);
    expect(r).toMatchObject({ status: 'received', d: '2026-11-02' });
    const next = await rows(tx, `select expected_date::text as d from projected_income where status='pending' and label='Weekly gig'`);
    expect(next.map((x) => x.d)).toEqual(['2026-11-09']); // exactly one follow-up, on the original schedule
  }));
  it('marking an overdue entry "not coming" (skip) creates no transaction and changes no balance', () => sandbox(async (tx) => {
    await tx.query(`insert into projected_income (label, amount, expected_date, status, certainty, is_repeating, repeat_period, account_id, entity_id) values ('One-off', 80, '2026-11-09', 'pending', 'guaranteed', false, 'None', 1, 'personal')`);
    const id = await num(tx, `select max(id) from projected_income`); const checking = await bal(tx, 1), n = await num(tx, 'select count(*) from transactions');
    await tx.query(`select fos_skip_income_occurrence($1, null)`, [id]);
    expect(await bal(tx, 1)).toBe(checking); expect(await num(tx, 'select count(*) from transactions')).toBe(n);
    expect((await one(tx, `select status from projected_income where id=$1`, [id])).status).toBe('cancelled');
  }));
});

describe('budget rules enforced by the server', () => {
  it('moving more than a category holds is refused; a valid move changes no bank balance and keeps Ready to Assign', () => sandbox(async (tx) => {
    await fails(tx, `select fos_move_money(9, 7, 500)`, [], /not enough available/);
    const rta = await rtaOf(tx), banks = await num(tx, 'select sum(balance) from accounts');
    await tx.query(`select fos_move_money(7, 9, 50)`);
    expect(await avail(tx, 9)).toBe(105); expect(await avail(tx, 7)).toBe(160);
    expect(await rtaOf(tx)).toBeCloseTo(rta, 2); expect(await num(tx, 'select sum(balance) from accounts')).toBeCloseTo(banks, 2);
  }));
  it('assigning more than Ready to Assign is refused; taking a category below $0 is refused', () => sandbox(async (tx) => {
    const rta = await rtaOf(tx);
    await fails(tx, `select fos_assign($1::jsonb)`, [JSON.stringify([{ category_id: 9, amount: rta + 1 }])], /Ready to Assign/);
    await fails(tx, `select fos_assign($1::jsonb)`, [JSON.stringify([{ category_id: 9, amount: -9999 }])], /below \$0/);
    await tx.query(`select fos_assign($1::jsonb)`, [JSON.stringify([{ category_id: 9, amount: 100 }])]);
    expect(await rtaOf(tx)).toBeCloseTo(rta - 100, 2);
  }));
});

describe('atomic multi-step operations', () => {
  it('add account: the account and its opening balance are created together, or not at all', () => sandbox(async (tx) => {
    const n = await num(tx, 'select count(*) from accounts');
    await fails(tx, `select fos_add_account($1::jsonb)`, [JSON.stringify({ name: 'Bad', type: 'Checking', opening: 10, cutover: 'not-a-date' })]);
    expect(await num(tx, 'select count(*) from accounts')).toBe(n);
    const id = await num(tx, `select fos_add_account($1::jsonb)`, [JSON.stringify({ name: 'New', type: 'Savings', opening: 250, cutover: '2026-11-09' })]);
    expect(await bal(tx, id)).toBe(250);
    expect(await num(tx, 'select count(*) from account_baselines where account_id=$1', [id])).toBe(1);
  }));
  it('archive/restore a bill (and its category) in one step, history kept', () => sandbox(async (tx) => {
    await tx.query(`select fos_archive_bill(3, true, true, null)`);
    const a = await one(tx, 'select bill_archived, bill_paused, is_hidden from categories where id=3');
    expect(a).toMatchObject({ bill_archived: true, bill_paused: true, is_hidden: true });
    await tx.query(`select fos_archive_bill(3, false, true, '2026-11-22')`);
    const r = await one(tx, 'select bill_archived, bill_paused, is_hidden, due_date::text as d from categories where id=3');
    expect(r).toMatchObject({ bill_archived: false, bill_paused: false, is_hidden: false, d: '2026-11-22' });
  }));
  it('pause/resume changes only the paused flag (and the resume date)', () => sandbox(async (tx) => {
    const before = await one(tx, 'select name, bill_amount, target_amount from categories where id=2');
    await tx.query(`select fos_set_bill_paused(2, true, null)`);
    expect(await one(tx, 'select name, bill_amount, target_amount from categories where id=2')).toEqual(before);
  }));
  it('group kind is stored (not inferred from the name) and matches today’s behaviour', () => sandbox(async (tx) => {
    const g = await rows(tx, 'select name, kind from category_groups order by id');
    expect(g.map((x) => x.kind)).toEqual(['bills', 'everyday', 'lifestyle', 'goals']);
  }));
});


describe('Plan items: one save, one archive (migration 019)', () => {
  const archive = (tx, id) => one(tx, `select to_jsonb(fos_archive_item($1, '2026-11-10')) as r`, [id]).then((x) => x.r);
  it('archiving returns the available money to Ready to Assign, hides the item, and keeps every transaction', () => sandbox(async (tx) => {
    const rta = await rtaOf(tx), banks = await num(tx, 'select sum(balance) from accounts'), txns = await num(tx, 'select count(*) from transactions');
    const r = await archive(tx, 10); // Vacation Fund holds $900
    expect(r.returned).toBe(900);
    expect(await rtaOf(tx)).toBeCloseTo(rta + 900, 2);
    expect(await avail(tx, 10)).toBe(0);
    expect((await one(tx, 'select is_hidden from categories where id=10')).is_hidden).toBe(true);
    expect(await num(tx, 'select sum(balance) from accounts')).toBeCloseTo(banks, 2); // a budget action, never a bank movement
    expect(await num(tx, 'select count(*) from transactions')).toBe(txns);
  }));
  it('archiving a scheduled item stops its schedule and keeps its payment history', () => sandbox(async (tx) => {
    await pay(tx, { category_id: 2, due: '2026-11-14', mode: 'external', amount: 118.4 }); // Electric now has history
    const hist = await num(tx, 'select count(*) from bill_payments where category_id=2');
    const rta = await rtaOf(tx), held = await avail(tx, 2);
    const r = await archive(tx, 2);
    expect(r.returned).toBeCloseTo(Math.max(held, 0), 2);
    expect(await rtaOf(tx)).toBeCloseTo(rta + Math.max(held, 0), 2);
    expect(await one(tx, 'select bill_archived, bill_paused, is_hidden from categories where id=2')).toMatchObject({ bill_archived: true, bill_paused: true, is_hidden: true });
    expect(await num(tx, 'select count(*) from bill_payments where category_id=2')).toBe(hist);
  }));
  it('refuses, with the reason and without changing anything: debt still owed, overspending, overdue payment, linked card', () => sandbox(async (tx) => {
    const before = JSON.stringify(await rows(tx, 'select id, assigned_amount, is_hidden, bill_archived from categories order by id'));
    await fails(tx, `select fos_archive_item(5, '2026-11-10')`, [], /still owes/);
    await fails(tx, `select fos_archive_item(8, '2026-11-10')`, [], /overspent/);
    await fails(tx, `select fos_archive_item(4, '2026-11-10')`, [], /unpaid payment due/);
    await fails(tx, `select fos_archive_item(6, '2026-11-10')`, [], /credit card/);
    expect(JSON.stringify(await rows(tx, 'select id, assigned_amount, is_hidden, bill_archived from categories order by id'))).toBe(before);
  }));
  it('restore brings the item back EMPTY and resumes its schedule; nothing is re-funded unless the user asks', () => sandbox(async (tx) => {
    await archive(tx, 3);
    const rta = await rtaOf(tx);
    await tx.query(`select fos_restore_item(3, 0, '2026-11-22')`);
    expect(await avail(tx, 3)).toBe(0);
    expect(await rtaOf(tx)).toBeCloseTo(rta, 2);
    expect(await one(tx, 'select is_hidden, bill_archived, bill_paused, due_date::text as d from categories where id=3')).toMatchObject({ is_hidden: false, bill_archived: false, bill_paused: false, d: '2026-11-22' });
  }));
  it('undo = restore with the same amount re-assigned, checked against Ready to Assign', () => sandbox(async (tx) => {
    const r = await archive(tx, 10);
    const rta = await rtaOf(tx);
    await tx.query(`select fos_restore_item(10, $1, null)`, [r.returned]);
    expect(await avail(tx, 10)).toBe(900); expect(await rtaOf(tx)).toBeCloseTo(rta - 900, 2);
    await archive(tx, 10);
    await fails(tx, `select fos_restore_item(10, $1, null)`, [(await rtaOf(tx)) + 1], /Ready to Assign/);
  }));

  const save = (tx, o) => num(tx, `select fos_save_item($1::jsonb)`, [JSON.stringify(o)]);
  it('creates an item with a goal and a schedule in one step; a duplicate name creates nothing', () => sandbox(async (tx) => {
    const n = await num(tx, 'select count(*) from categories');
    const id = await save(tx, { name: 'Car Insurance', group_id: 1, emoji: '🚗', target_amount: 120, target_mode: 'keep', schedule: { amount: 118, date: '2026-12-05', period: 'Monthly' } });
    expect(await one(tx, `select name, bill_amount::float as ba, target_amount::float as ta, target_mode, due_date::text as d, is_repeating, assigned_amount::float as a from categories where id=$1`, [id]))
      .toMatchObject({ name: 'Car Insurance', ba: 118, ta: 120, target_mode: 'keep', d: '2026-12-05', is_repeating: true, a: 0 });
    await fails(tx, `select fos_save_item($1::jsonb)`, [JSON.stringify({ name: 'car insurance', group_id: 1 })], /already called/);
    expect(await num(tx, 'select count(*) from categories')).toBe(n + 1);
  }));
  it('creates a plain item with no schedule; sets, changes and removes a schedule without touching the money', () => sandbox(async (tx) => {
    const id = await save(tx, { name: 'Gifts', group_id: 4, target_amount: 300, target_mode: 'save' });
    expect(await one(tx, 'select due_date, target_mode from categories where id=$1', [id])).toMatchObject({ due_date: null, target_mode: 'save' });
    await save(tx, { id, schedule: { amount: 50, date: '2026-12-20', period: 'Yearly' } });
    expect(await one(tx, `select due_date::text as d, bill_amount::float as ba, target_period from categories where id=$1`, [id])).toMatchObject({ d: '2026-12-20', ba: 50, target_period: 'Yearly' });
    const before = await avail(tx, id);
    await save(tx, { id, schedule: null });
    expect(await one(tx, 'select due_date, bill_amount from categories where id=$1', [id])).toMatchObject({ due_date: null, bill_amount: null });
    expect(await avail(tx, id)).toBe(before);
  }));
  it('refuses a schedule date that is already recorded as paid; pause touches only the paused flag', () => sandbox(async (tx) => {
    await fails(tx, `select fos_save_item($1::jsonb)`, [JSON.stringify({ id: 1, schedule: { amount: 1500, date: '2026-11-01', period: 'Monthly' } })], /already recorded as paid/);
    const b = await one(tx, 'select name, bill_amount, due_date from categories where id=2');
    await save(tx, { id: 2, paused: true });
    expect(await one(tx, 'select name, bill_amount, due_date from categories where id=2')).toEqual(b);
    expect((await one(tx, 'select bill_paused from categories where id=2')).bill_paused).toBe(true);
  }));
});

// ── migration 020: transaction-first payments. A partial payment is linked explicitly (bill_partials); unrelated category spending never counts. ──
describe('explicit partial payments (migration 020)', () => {
  const mk = async (tx, o) => num(tx, `select fos_create_transaction($1::jsonb)`, [JSON.stringify({ date: '2026-11-10', amount: 50, payee: 'Power Co', type: 'Expense', account_id: 1, category_id: 2, ...o })]);
  const link = (tx, id, o = {}) => pay(tx, { category_id: 2, due: '2026-11-14', mode: 'link', transaction_id: id, ...o });

  it('linking a smaller transaction records an explicit partial; the bill stays due and nothing else moves', () => sandbox(async (tx) => {
    const b = await bal(tx, 1), e = await avail(tx, 2);
    const id = await mk(tx, { amount: 50 });
    const afterTxn = [await bal(tx, 1), await avail(tx, 2)];
    const r = await link(tx, id, { settle: false });
    expect(r.settled).toBe(false); expect(r.paid_before).toBe(0);
    expect(await due(tx, 2)).toBe('2026-11-14');
    expect(await num(tx, 'select count(*) from bill_partials where category_id=2')).toBe(1);
    expect(await num(tx, 'select count(*) from bill_payments where category_id=2')).toBe(0);
    expect([await bal(tx, 1), await avail(tx, 2)]).toEqual(afterTxn); // linking is bookkeeping only
    expect(b - afterTxn[0]).toBeCloseTo(50, 2); expect(e - afterTxn[1]).toBeCloseTo(50, 2);
  }));

  it('the payment that completes what is owed settles it (even when asked not to), counting earlier linked partials only', () => sandbox(async (tx) => {
    const p1 = await mk(tx, { amount: 50 }); await link(tx, p1, { settle: false });
    await mk(tx, { amount: 500, payee: 'Unrelated big purchase' }); // same category, NOT linked: must not count
    const p2 = await mk(tx, { amount: 68.4, date: '2026-11-11' });
    const r = await link(tx, p2, { settle: false });
    expect(r.settled).toBe(true); expect(r.paid_before).toBe(50);
    expect(await due(tx, 2)).toBe('2026-12-14');
    expect(await num(tx, 'select count(*) from bill_payments where category_id=2')).toBe(1);
  }));

  it('an unlinked transaction in the same category is not a payment; a too-small payment alone does not settle', () => sandbox(async (tx) => {
    await mk(tx, { amount: 118.4 }); // ordinary spending, never linked
    expect(await num(tx, 'select count(*) from bill_payments where category_id=2')).toBe(0);
    expect(await due(tx, 2)).toBe('2026-11-14');
    const small = await mk(tx, { amount: 20 }); const r = await link(tx, small, { settle: false });
    expect(r.settled).toBe(false);
  }));

  it('one transaction can only be linked once, and only to its own category; income and scheduled rows are refused', () => sandbox(async (tx) => {
    const id = await mk(tx, { amount: 40 }); await link(tx, id, { settle: false });
    await fails(tx, `select fos_pay_bill_v2($1::jsonb)`, [JSON.stringify({ category_id: 2, due: '2026-11-14', mode: 'link', transaction_id: id, settle: false })], /already linked/);
    const other = await mk(tx, { amount: 30, category_id: 9 });
    await fails(tx, `select fos_pay_bill_v2($1::jsonb)`, [JSON.stringify({ category_id: 2, due: '2026-11-14', mode: 'link', transaction_id: other })], /different category/);
    const inc = await mk(tx, { amount: 30, type: 'Income', category_id: null });
    await fails(tx, `select fos_pay_bill_v2($1::jsonb)`, [JSON.stringify({ category_id: 2, due: '2026-11-14', mode: 'link', transaction_id: inc })], /different category|income cannot/);
    const sch = await mk(tx, { amount: 30, date: '2026-12-01', scheduled: true });
    await fails(tx, `select fos_pay_bill_v2($1::jsonb)`, [JSON.stringify({ category_id: 2, due: '2026-11-14', mode: 'link', transaction_id: sch })], /posted/);
  }));

  it('a linked transaction cannot be deleted from under its payment; undoing the partial unlinks and (optionally) deletes it, restoring everything', () => sandbox(async (tx) => {
    const b = await bal(tx, 1), e = await avail(tx, 2);
    const id = await mk(tx, { amount: 50 }); await link(tx, id, { settle: false });
    await fails(tx, `select fos_delete_transaction($1)`, [id], /confirms a bill payment/);
    await tx.query(`select fos_unpay_partial($1, true)`, [id]);
    expect(await num(tx, 'select count(*) from bill_partials')).toBe(0);
    expect(await num(tx, 'select count(*) from transactions where id=$1', [id])).toBe(0);
    expect(await bal(tx, 1)).toBeCloseTo(b, 2); expect(await avail(tx, 2)).toBeCloseTo(e, 2);
  }));

  it('a debt reduced by a partial is restored exactly by the server (a wrong client figure is ignored); undo is refused once completed', () => sandbox(async (tx) => {
    const r = await pay(tx, { category_id: 5, due: '2026-09-27', mode: 'post', account_id: 1, amount: 100, settle: false });
    expect(await owed(tx, 5)).toBe(8300);
    await tx.query(`select fos_unpay_bill(5, '2026-09-27', true, $1, 9999)`, [r.transaction_id]); // client figure is nonsense on purpose
    expect(await owed(tx, 5)).toBe(8400);
    const r2 = await pay(tx, { category_id: 5, due: '2026-09-27', mode: 'post', account_id: 1, amount: 100, settle: false });
    await pay(tx, { category_id: 5, due: '2026-09-27', mode: 'post', account_id: 1, amount: 220, settle: false }); // 100 + 220 = 320: completes it
    expect(await due(tx, 5)).toBe('2026-10-27'); expect(await owed(tx, 5)).toBe(8400 - 320);
    await fails(tx, `select fos_unpay_partial($1, false)`, [r2.transaction_id], /completed/);
    await tx.query(`select fos_unpay_bill(5, '2026-09-27', true)`); // undo the completing payment (and its transaction): the partial counts again
    expect(await due(tx, 5)).toBe('2026-09-27'); expect(await owed(tx, 5)).toBe(8300);
    await tx.query(`select fos_unpay_partial($1, true)`, [r2.transaction_id]);
    expect(await owed(tx, 5)).toBe(8400);
  }));

  it('post-mode default amount is what is still owed, and a retry with the same request id never double-pays', () => sandbox(async (tx) => {
    const p1 = await mk(tx, { amount: 50 }); await link(tx, p1, { settle: false });
    const o = { category_id: 2, due: '2026-11-14', mode: 'post', account_id: 1, request_id: '22222222-2222-2222-2222-222222222222' };
    const r = await pay(tx, o); const again = await pay(tx, o);
    expect(r.amount).toBeCloseTo(68.4, 2); expect(r.settled).toBe(true); expect(again.duplicate).toBe(true);
    expect(await num(tx, 'select count(*) from bill_payments where category_id=2')).toBe(1);
  }));

  it('full round trip leaves balances, envelopes and Ready to Assign exactly as they started', () => sandbox(async (tx) => {
    const start = [await bal(tx, 1), await avail(tx, 2), await rtaOf(tx), await due(tx, 2)];
    const p1 = await mk(tx, { amount: 50 }); await link(tx, p1, { settle: false });
    const p2 = await mk(tx, { amount: 68.4 }); await link(tx, p2);
    await tx.query(`select fos_unpay_bill(2, '2026-11-14', true)`);
    await tx.query(`select fos_unpay_partial($1, true)`, [p1]);
    expect([await bal(tx, 1), await avail(tx, 2), await rtaOf(tx), await due(tx, 2)]).toEqual(start);
  }));
});

describe('reconciliation to negative balances, and per-user isolation', () => {
  const reco = (tx, a, v) => tx.query(`select fos_reconcile($1, $2, '2026-11-10')`, [a, v]);
  it('positive → negative → zero → positive each land exactly on the target, with one visible adjustment per change and history untouched', () => sandbox(async (tx) => {
    const ordinary = await num(tx, `select count(*) from transactions where not coalesce(is_adjustment,false)`);
    for (const target of [-128.38, 0, 75.25, -5000.5, 4820.15]) {
      await reco(tx, 1, target);
      expect(await bal(tx, 1)).toBe(target);
    }
    expect(await num(tx, `select count(*) from transactions where not coalesce(is_adjustment,false)`)).toBe(ordinary);
    expect(await num(tx, `select count(*) from account_reconciliations where account_id=1`)).toBeGreaterThanOrEqual(5);
    const last = await one(tx, `select type, amount::float a from transactions where is_adjustment and account_id=1 order by id desc limit 1`);
    expect(last.type).toBe('Income'); expect(last.a).toBeCloseTo(5000.5 + 4820.15, 2); // −5,000.50 → 4,820.15 is money coming in
  }));
  it('the adjustment direction follows the sign: overdrawn target is an expense, recovery is income', () => sandbox(async (tx) => {
    await reco(tx, 1, -128.38);
    expect((await one(tx, `select type from transactions where is_adjustment and account_id=1 order by id desc limit 1`)).type).toBe('Expense');
    await reco(tx, 1, 50);
    expect((await one(tx, `select type from transactions where is_adjustment and account_id=1 order by id desc limit 1`)).type).toBe('Income');
    expect(await bal(tx, 1)).toBe(50);
  }));
  it('a different signed-in user sees none of the owner’s data and cannot create anything (so a remembered transfer pair, derived from it, can never cross users)', async () => {
    try {
      await asOwner(db, async (tx) => {
        expect(await num(tx, 'select count(*) from transactions')).toBe(0);
        expect(await num(tx, 'select count(*) from accounts')).toBe(0);
        await fails(tx, `select fos_create_transaction($1::jsonb)`, [JSON.stringify({ date: '2026-11-10', amount: 5, payee: 'x', type: 'Transfer', account_id: 1, to_account_id: 2 })]);
        await fails(tx, `select fos_pay_bill_v2($1::jsonb)`, [JSON.stringify({ category_id: 2, due: '2026-11-14', mode: 'external' })]);
        expect(await num(tx, 'select count(*) from bill_partials')).toBe(0);
        throw ROLLBACK;
      }, '00000000-0000-0000-0000-0000000000e2');
    } catch (e) { if (e !== ROLLBACK) throw e; }
  });
});

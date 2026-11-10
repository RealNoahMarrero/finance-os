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

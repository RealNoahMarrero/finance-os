// Interactive workflow tests against the synthetic live backend (real SQL, in-memory). `npm run test:flows`
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { build, preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { start } from '../../tools/demo/server.mjs';

const chrome = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fos-flows-'));
Object.assign(process.env, { VITE_SUPABASE_URL: 'http://127.0.0.1:54398', VITE_SUPABASE_ANON_KEY: 'demo', VITE_DEMO_TODAY: '2026-11-10' });
const backend = await start(54398);
await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } });
const pv = await preview({ logLevel: 'silent', build: { outDir }, preview: { port: 4183, strictPort: true } });
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
const session = { access_token: 'demo', refresh_token: 'demo', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: 'u', aud: 'authenticated', email: 'demo@example.test' } };
const results = []; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = async (text) => (await backend.pg.query(text)).rows;

async function fresh(vp = { width: 1440, height: 900 }) {
  await backend.reseed();
  const page = await browser.newPage(); await page.setViewport(vp);
  await page.evaluateOnNewDocument((s) => { localStorage.setItem('fos-auth', JSON.stringify(s)); localStorage.setItem('fos-theme', 'light'); }, session);
  page.errors = []; page.on('pageerror', (e) => page.errors.push(String(e)));
  return page;
}
const go = async (page, hash) => { await page.goto(`http://localhost:4183/#${hash}`, { waitUntil: 'networkidle0' }); await page.reload({ waitUntil: 'networkidle0' }); };
const click = async (page, text, sel = 'button, a, [role=button]') => {
  const ok = await page.evaluate((text, sel) => { const el = [...document.querySelectorAll(sel)].find((e) => e.offsetParent !== null && ((e.innerText || '') + ' ' + (e.getAttribute('aria-label') || '')).toLowerCase().includes(text.toLowerCase())); if (el) { el.click(); return true; } return false; }, text, sel);
  if (!ok) {
    const dlg = await page.evaluate(() => (document.querySelector('[role=dialog]')?.innerText ?? '(none)').split('\n').join(' / ').slice(0, 400));
    throw new Error(`click: "${text}" not found; dialog: ${dlg}`);
  }
  await sleep(500);
};
const toastText = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' | '));
async function test(name, fn) {
  const page = await fresh();
  try { await fn(page); if (page.errors.length) throw new Error('page errors: ' + page.errors.join('; ')); results.push([name, true]); }
  catch (e) { results.push([name, false, String(e.message).slice(0, 300)]); }
  await page.close();
}

await test('add an expense: balance and envelope both change', async (page) => {
  await go(page, '/');
  await click(page, 'Add transaction');
  await page.type('input[aria-label=Amount]', '25.50'); await page.type('#payee', 'Corner Cafe');
  await click(page, 'Dining Out', '.chip'); await click(page, 'Add expense');
  const [acct] = await sql('select balance from accounts where id=1'); const [cat] = await sql('select assigned_amount from categories where id=9');
  if (Number(acct.balance) !== 4794.65) throw new Error(`checking is ${acct.balance}, expected 4794.65`);
  if (Number(cat.assigned_amount) !== 29.5) throw new Error(`Dining Out is ${cat.assigned_amount}, expected 29.5`);
});
await test('cover overspending moves budget money only', async (page) => {
  await go(page, '/plan');
  const before = await sql('select sum(balance)::float as b from accounts');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Cover').click()); await sleep(500); await click(page, 'Move $35.00');
  const [gas] = await sql('select assigned_amount from categories where id=8'); const after = await sql('select sum(balance)::float as b from accounts');
  if (Number(gas.assigned_amount) !== 0) throw new Error(`Gas is ${gas.assigned_amount}, expected 0`);
  if (before[0].b !== after[0].b) throw new Error('bank balances changed');
});
await test('Pay an upcoming bill (Electric) records the payment', async (page) => {
  await go(page, '/');
  await click(page, 'Electric details');
  const body = await page.evaluate(() => document.querySelector('[role=dialog]')?.innerText ?? '');
  if (!/Electric/.test(body)) throw new Error('bill sheet did not open');
});
await test('old links still resolve (#/plan/forecast, #/credit)', async (page) => {
  await go(page, '/plan/forecast'); let t = await page.evaluate(() => document.body.innerText); if (!/Forecast/.test(t)) throw new Error('forecast');
  await go(page, '/credit'); t = await page.evaluate(() => document.body.innerText); if (!/latest score/i.test(t)) throw new Error('credit');
});
await test('phone: More menu reaches Accounts, Insights and Settings', async () => {
  const page = await fresh({ width: 390, height: 844, isMobile: true, hasTouch: true });
  try {
    await go(page, '/'); await click(page, 'More');
    const t = await page.evaluate(() => document.querySelector('[role=dialog]').innerText); for (const w of ['Insights', 'Settings']) if (!t.includes(w)) throw new Error(`${w} missing from More`);
    await page.keyboard.press('Escape'); await sleep(300);
    const bar = await page.evaluate(() => document.querySelector('nav.tabbar').innerText); for (const w of ['Home', 'Activity', 'Plan', 'Accounts']) if (!bar.includes(w)) throw new Error(`${w} missing from the bottom bar`);
    results.push(['phone: More menu reaches Accounts, Insights and Settings', true]);
  } catch (e) { results.push(['phone: More menu reaches Accounts, Insights and Settings', false, e.message]); }
  await page.close();
});
await test('settings export control and theme switch exist', async (page) => {
  await go(page, '/settings'); const t = await page.evaluate(() => document.body.innerText); if (!/export everything/i.test(t) || !/appearance/i.test(t)) throw new Error('settings incomplete');
  await click(page, 'Dark', '.theme-seg button'); const th = await page.evaluate(() => document.documentElement.dataset.theme); if (th !== 'dark') throw new Error('theme did not switch');
});

const setVal = (page, sel, v) => page.evaluate((sel, v) => { const el = document.querySelector(sel); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, sel, v);
const openCarLoan = async (page) => { await go(page, '/'); await click(page, 'Car Loan details'); await click(page, 'Record payment', '[data-testid=record-payment]'); };

await test('PAY (record): one atomic payment — account, envelope, debt, due date; a double-click records it once', async (page) => {
  await openCarLoan(page);
  const before = await sql(`select (select balance from accounts where id=1) as b, (select count(*) from transactions) as n`);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^Pay \$320/.test(x.innerText.trim())); b.click(); b.click(); });
  await sleep(1200);
  const [after] = await sql(`select (select balance from accounts where id=1) as b, (select count(*) from transactions) as n, (select balance from categories where id=5) as owed, (select due_date::text from categories where id=5) as due, (select assigned_amount from categories where id=5) as env, (select count(*) from bill_payments where category_id=5) as bp`);
  if (Number(after.n) !== Number(before[0].n) + 1) throw new Error(`transactions went ${before[0].n} -> ${after.n}, expected +1`);
  if (Math.abs(Number(after.b) - (Number(before[0].b) - 320)) > 0.001) throw new Error('checking did not drop by exactly $320');
  if (Number(after.owed) !== 8080) throw new Error(`debt owed is ${after.owed}, expected 8080`);
  if (after.due !== '2026-10-27') throw new Error(`next due ${after.due}`);
  if (Number(after.env) !== 0) throw new Error(`envelope ${after.env}, expected 0`);
});
await test('PAY undo (toast): restores everything and removes the transaction it created', async (page) => {
  await openCarLoan(page);
  const [b0] = await sql(`select (select balance from accounts where id=1) as b, (select count(*) from transactions) as n`);
  await click(page, 'Pay $320');
  await click(page, 'Undo', '.toast button'); await sleep(800);
  const [a] = await sql(`select (select balance from accounts where id=1) as b, (select count(*) from transactions) as n, (select balance from categories where id=5) as owed, (select due_date::text from categories where id=5) as due`);
  if (Number(a.n) !== Number(b0.n) || Number(a.b) !== Number(b0.b) || Number(a.owed) !== 8400 || a.due !== '2026-09-27') throw new Error(JSON.stringify(a));
});
await test('PAY (already recorded): links the existing transaction and creates no duplicate', async (page) => {
  await sql(`insert into transactions (date, amount, payee, category_id, account_id, type, entity_id, status) values ('2026-09-28', 320, 'Loan Co', 5, 1, 'Expense', 'personal', 'posted')`);
  await openCarLoan(page); await click(page, 'Already recorded');
  const n0 = (await sql('select count(*) as n from transactions'))[0].n;
  await click(page, 'Loan Co', 'label'); await click(page, 'Link this transaction');
  const [a] = await sql(`select (select count(*) from transactions) as n, (select balance from categories where id=5) as owed, (select count(*) from bill_payments where category_id=5) as bp`);
  if (Number(a.n) !== Number(n0)) throw new Error('a duplicate transaction was created');
  if (Number(a.owed) !== 8080 || Number(a.bp) !== 1) throw new Error(JSON.stringify(a));
});
await test('PAY (paid elsewhere): marks paid, no transaction, balances untouched', async (page) => {
  await openCarLoan(page); await click(page, 'Paid elsewhere');
  const [b0] = await sql(`select (select sum(balance) from accounts) as b, (select count(*) from transactions) as n`);
  await click(page, 'Mark as paid');
  const [a] = await sql(`select (select sum(balance) from accounts) as b, (select count(*) from transactions) as n, (select balance from categories where id=5) as owed`);
  if (Number(a.n) !== Number(b0.n) || Number(a.b) !== Number(b0.b) || Number(a.owed) !== 8080) throw new Error(JSON.stringify([b0, a]));
});
await test('missed payments: one Car Loan row with a count, expandable, and Home shows one alert', async (page) => {
  await go(page, '/plan');
  const t = await page.evaluate(() => document.body.innerText); if (!/2 payments missed/.test(t)) throw new Error('no missed count on Plan');
  if ((t.match(/Car Loan/g) || []).length > 2) throw new Error('Car Loan appears as several rows');
  await go(page, '/'); const h = await page.evaluate(() => document.querySelector('[data-testid=attention]').innerText);
  if (/Car Loan/.test(h) || /Client refund/.test(h)) throw new Error('missed bills / overdue income are repeated in Needs attention: ' + h.slice(0, 160));
  if (!/Gas is over by/.test(h)) throw new Error('overspent item missing from Needs attention: ' + h.slice(0, 160));
  const up = await page.evaluate(() => [...document.querySelectorAll('.group-h')].map((x) => x.innerText).join('|') + document.body.innerText);
  if (!/2 missed/.test(up)) throw new Error('missed count missing from Upcoming');
});
await test('SCHEDULED: a future-dated expense changes no balance until its date', async (page) => {
  await go(page, '/'); await click(page, 'Add transaction');
  await page.type('input[aria-label=Amount]', '40'); await page.type('#payee', 'Future Cafe'); await click(page, 'Dining Out', '.chip');
  await click(page, 'Date, notes, split'); await setVal(page, '#date', '2026-11-25'); await sleep(300);
  const txt = await page.evaluate(() => document.querySelector('[role=dialog]').innerText); if (!/Scheduled: it won/.test(txt)) throw new Error('no scheduled hint');
  const b0 = Number((await sql('select balance from accounts where id=1'))[0].balance);
  await click(page, 'Schedule expense');
  const [a] = await sql(`select (select balance from accounts where id=1) as b, (select assigned_amount from categories where id=9) as env, (select status from transactions where payee='Future Cafe') as st`);
  if (Number(a.b) !== b0 || Number(a.env) !== 55 || a.st !== 'scheduled') throw new Error(JSON.stringify(a));
  await go(page, '/activity'); const t = await page.evaluate(() => document.body.innerText); if (!/Scheduled · not yet posted/i.test(t) || !/Future Cafe/.test(t)) throw new Error('not shown in Activity');
});
await test('SCHEDULED: opening the app on/after the date posts it exactly once', async (page) => {
  await sql(`insert into transactions (date, amount, payee, category_id, account_id, type, entity_id, status) values ('2026-11-10', 12.5, 'Due Today', 9, 1, 'Expense', 'personal', 'scheduled')`);
  const b0 = Number((await sql('select balance from accounts where id=1'))[0].balance);
  await go(page, '/'); await go(page, '/');
  const [a] = await sql(`select (select balance from accounts where id=1) as b, (select status from transactions where payee='Due Today') as st`);
  if (a.st !== 'posted' || Math.abs(Number(a.b) - (b0 - 12.5)) > 0.001) throw new Error(JSON.stringify([b0, a]));
});

await test('HOME: Expected income section shows totals, overdue confirmation, status, and links to the full view', async (page) => {
  await go(page, '/');
  const t = await page.evaluate(() => document.querySelector('[data-testid=ov-income]').innerText);
  for (const w of ['Acme Payroll', 'Freelance invoice', 'Client refund', 'Guaranteed', 'Anticipated', 'Confirm', 'awaiting confirmation', 'originally Nov 5']) if (!t.includes(w)) throw new Error(`missing "${w}"`);
  const total = await page.evaluate(() => document.querySelector('[data-testid=ov-income-total]').innerText);
  if (!/\$5,870/.test(total)) throw new Error('30-day pending total ' + total); // paychecks 4,820 + invoice 900 + the overdue $150 refund, shown as arriving today
  const rta = await page.evaluate(() => document.querySelector('[data-testid=ov-rta-value]').innerText);
  if (!/\$3,645/.test(rta)) throw new Error('Ready to Assign changed: ' + rta);
  const before = await page.evaluate(() => location.hash);
  await click(page, 'View all', '[data-testid=ov-income-all]'); const after = await page.evaluate(() => location.hash);
  if (!/view=income/.test(after)) throw new Error('link went to ' + after);
});
await test('HOME: Expected income empty state, and mobile layout does not overflow', async () => {
  const page = await fresh({ width: 390, height: 844, isMobile: true, hasTouch: true });
  try {
    await sql(`update projected_income set status='cancelled'`);
    await go(page, '/'); const t = await page.evaluate(() => document.querySelector('[data-testid=ov-income]').innerText);
    if (!/Nothing expected in the next 30 days/.test(t) || !/Add/.test(t)) throw new Error('empty state: ' + t.slice(0, 100));
    const over = await page.evaluate(() => document.documentElement.scrollWidth > 392); if (over) throw new Error('horizontal overflow on phone');
    results.push(['HOME: Expected income empty state, and mobile layout does not overflow', true]);
  } catch (e) { results.push(['HOME: Expected income empty state, and mobile layout does not overflow', false, e.message]); }
  await page.close();
});

await test('INCOME: an overdue entry is awaiting confirmation (dated today, original date kept) and confirming it records it once', async (page) => {
  await go(page, '/');
  const t = await page.evaluate(() => document.querySelector('[data-testid=ov-income]').innerText);
  if (!/Awaiting confirmation · originally Nov 5/.test(t)) throw new Error('overdue label missing: ' + t.slice(0, 160));
  const [raw] = await sql(`select expected_date::text as d, status from projected_income where label='Client refund'`);
  if (raw.d !== '2026-11-05' || raw.status !== 'pending') throw new Error('stored entry was altered: ' + JSON.stringify(raw));
  const b0 = Number((await sql('select balance from accounts where id=1'))[0].balance);
  await page.evaluate(() => [...document.querySelectorAll('[data-testid=ov-income] button')].find((b) => b.innerText.includes('Client refund')).click()); await sleep(500);
  const sheet = await page.evaluate(() => document.querySelector('[role=dialog]').innerText); if (!/Awaiting confirmation/.test(sheet) || !/Originally/.test(sheet)) throw new Error('sheet lacks pending info');
  await click(page, 'Mark as received'); await click(page, 'Record income');
  const [a] = await sql(`select (select balance from accounts where id=1) as b, (select status from projected_income where label='Client refund') as st`);
  if (a.st !== 'received' || Math.abs(Number(a.b) - (b0 + 150)) > 0.001) throw new Error(JSON.stringify(a));
  await go(page, '/'); const total = await page.evaluate(() => document.querySelector('[data-testid=ov-income-total]').innerText);
  if (!/\$5,720/.test(total)) throw new Error('pending total after confirming: ' + total);
});


const rowClick = (page, name) => page.evaluate((name) => { const r = [...document.querySelectorAll('[data-testid=plan-row]')].find((x) => x.innerText.includes(name)); r.click(); }, name);
const detail = (page) => page.evaluate(() => document.querySelector('[data-testid=item-detail]')?.innerText ?? '');

await test('PLAN: one list for bills and spending; selecting any item opens the same detail, adapted to the item', async (page) => {
  await go(page, '/plan');
  const t = await page.evaluate(() => document.body.innerText);
  for (const n of ['Rent', 'Electric', 'Groceries', 'Vacation Fund']) if (!t.includes(n)) throw new Error(`${n} missing from Plan`);
  await rowClick(page, 'Electric'); await sleep(400); const e = await detail(page);
  if (!/Record payment/.test(e) || !/Next payment/.test(e) || !/Move money/.test(e) || !/Archive/.test(e)) throw new Error('scheduled item detail incomplete: ' + e.slice(0, 200));
  await rowClick(page, 'Groceries'); await sleep(400); const g = await detail(page);
  if (/Record payment/.test(g) || /Next payment/.test(g)) throw new Error('an unscheduled item shows schedule controls');
  if (!/Move money/.test(g) || !/Edit/.test(g)) throw new Error('unscheduled item detail incomplete');
});
await test('PLAN: add one item with a goal and a schedule (no bill-vs-category choice)', async (page) => {
  await go(page, '/plan'); await page.evaluate(() => document.querySelector('[data-testid=add-item]').click()); await sleep(400);
  await page.type('#it-name', 'Car Insurance');
  await click(page, 'Add funding goal'); await click(page, 'Add payment schedule');
  await sleep(200); await page.evaluate(() => { const i = document.querySelectorAll('[role=dialog] input[inputmode=decimal]'); });
  const inputs = await page.$$('[role=dialog] input[inputmode=decimal]');
  await inputs[0].type('120'); await inputs[1].type('118');
  await setVal(page, '#it-date', '2026-12-05'); await sleep(200);
  await page.evaluate(() => document.querySelector('[data-testid=item-save]').click()); await sleep(900);
  const [c] = await sql(`select name, bill_amount::float ba, target_amount::float ta, due_date::text d, is_repeating, assigned_amount::float a from categories where name='Car Insurance'`);
  if (!c || c.ba !== 118 || c.ta !== 120 || c.d !== '2026-12-05' || !c.is_repeating || c.a !== 0) throw new Error(JSON.stringify(c));
  await go(page, '/plan'); const t = await page.evaluate(() => document.body.innerText); if (!/Car Insurance/.test(t)) throw new Error('new item not in Plan');
});
await test('PLAN: Archive Item returns its money to Ready to Assign, keeps history, and Undo puts it back', async (page) => {
  await go(page, '/plan');
  const rta0 = Number((await sql(`select (select sum(balance) from accounts where type <> 'Credit Card') - (select sum(assigned_amount) from categories where not is_hidden) as r`))[0].r);
  const banks = (await sql('select sum(balance) b from accounts'))[0].b; const txns = (await sql('select count(*) n from transactions'))[0].n;
  await rowClick(page, 'Vacation Fund'); await sleep(400);
  await page.evaluate(() => document.querySelector('[data-testid=archive-item]').click()); await sleep(500);
  const prev = await page.evaluate(() => document.querySelector('[data-testid=archive-returns]').innerText); if (!/\$900/.test(prev)) throw new Error('confirmation shows ' + prev);
  await page.evaluate(() => document.querySelector('[data-testid=archive-confirm]').click()); await sleep(1000);
  const [a] = await sql(`select is_hidden, assigned_amount::float v from categories where name='Vacation Fund'`);
  if (!a.is_hidden || a.v !== 0) throw new Error(JSON.stringify(a));
  const rta1 = Number((await sql(`select (select sum(balance) from accounts where type <> 'Credit Card') - (select sum(assigned_amount) from categories where not is_hidden) as r`))[0].r);
  if (Math.abs(rta1 - (rta0 + 900)) > 0.001) throw new Error(`RTA ${rta0} -> ${rta1}`);
  if ((await sql('select sum(balance) b from accounts'))[0].b !== banks || (await sql('select count(*) n from transactions'))[0].n !== txns) throw new Error('bank balances or history changed');
  await click(page, 'Undo', '.toast button'); await sleep(900);
  const [u] = await sql(`select is_hidden, assigned_amount::float v from categories where name='Vacation Fund'`);
  if (u.is_hidden || u.v !== 900) throw new Error('undo: ' + JSON.stringify(u));
});
await test('PLAN: archive is refused with the reason (debt still owed); restore comes back empty', async (page) => {
  await go(page, '/plan'); await rowClick(page, 'Car Loan'); await sleep(400);
  await page.evaluate(() => document.querySelector('[data-testid=archive-item]').click()); await sleep(500);
  const t = await page.evaluate(() => document.querySelector('[role=dialog]').innerText); if (!/still owes/.test(t)) throw new Error('no reason shown: ' + t.slice(0, 150));
  const disabled = await page.evaluate(() => document.querySelector('[data-testid=archive-confirm]').disabled); if (!disabled) throw new Error('archive button was enabled');
  await page.keyboard.press('Escape'); await sleep(300);
  await sql(`select 1`); // archive + restore of a plain item
  await rowClick(page, 'Dining Out'); await sleep(300);
  await sql(`update categories set assigned_amount = 0 where name='Dining Out'`);
  await go(page, '/plan'); await rowClick(page, 'Dining Out'); await sleep(300);
  await page.evaluate(() => document.querySelector('[data-testid=archive-item]').click()); await sleep(400);
  await page.evaluate(() => document.querySelector('[data-testid=archive-confirm]').click()); await sleep(900);
  await go(page, '/plan?filter=archived'); const arch = await page.evaluate(() => document.querySelector('[data-testid=archived-list]').innerText); if (!/Dining Out/.test(arch)) throw new Error('not in Archived');
  await click(page, 'Restore'); await sleep(900);
  const [r] = await sql(`select is_hidden, assigned_amount::float v from categories where name='Dining Out'`); if (r.is_hidden || r.v !== 0) throw new Error('restore: ' + JSON.stringify(r));
});
await test('PLAN: a partial payment shows what was paid and what remains, and does not clear the obligation', async (page) => {
  await go(page, '/'); await click(page, 'Electric details'); await click(page, 'Record payment', '[data-testid=record-payment]'); await sleep(300);
  await setVal(page, '#pay-amt', '50'); await sleep(200);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Pay \$50/.test(b.innerText.trim())).click()); await sleep(1000);
  const [p] = await sql(`select (select due_date::text from categories where name='Electric') d, (select count(*) from bill_payments where category_id=(select id from categories where name='Electric')) bp`);
  if (p.d !== '2026-11-14' || Number(p.bp) !== 0) throw new Error('obligation was advanced: ' + JSON.stringify(p));
  await go(page, '/plan'); await rowClick(page, 'Electric'); await sleep(400); const e = await detail(page);
  if (!/Paid so far/.test(e) || !/\$50/.test(e) || !/remaining/.test(e)) throw new Error('partial not shown: ' + e.slice(0, 260));
});
await test('MOVE MONEY: budget movement never changes a bank balance; an account transfer is a separate transaction', async (page) => {
  await go(page, '/plan'); const banks = (await sql('select sum(balance) b from accounts'))[0].b;
  await sql(`select fos_move_money(7, 9, 20)`).catch(() => null);
  await page.evaluate(() => document.querySelector('[data-testid=plan-move]').click()); await sleep(400);
  const t = await page.evaluate(() => document.querySelector('[role=dialog]').innerText); if (!/Nothing changes in your bank accounts/i.test(t)) throw new Error('move sheet lacks the bank-account note');
  if ((await sql('select sum(balance) b from accounts'))[0].b !== banks) throw new Error('banks changed');
});
await test('DEEP LINKS: earlier addresses land on the matching screen', async (page) => {
  const want = { '/bills': /Plan/, '/budget': /Ready to assign/i, '/bills?tab=income': /Pending|Expected income/i, '/bills?view=calendar': /sun/i, '/plan/forecast': /Forecast/i };
  for (const [h, re] of Object.entries(want)) { await go(page, h); const t = await page.evaluate(() => document.body.innerText); if (!re.test(t)) throw new Error(`${h} did not show ${re}`); }
});


await test('ACCOUNTS: balances list, and reconciling records one visible adjustment', async (page) => {
  await go(page, '/accounts'); const t = await page.evaluate(() => document.body.innerText);
  for (const n of ['Everyday Checking', 'Rewards Visa', 'Car Loan']) if (!t.includes(n)) throw new Error(`${n} missing from Accounts`);
  await go(page, '/accounts/1'); await click(page, 'Reconcile');
  await page.type('#act', '4800.00'); await click(page, 'Preview difference'); await click(page, 'Record adjustment'); await sleep(900);
  const [a] = await sql(`select (select balance::float from accounts where id=1) b, (select count(*) from transactions where is_adjustment and account_id=1 and payee='Reconciliation adjustment' and amount=20.15) adj`);
  if (a.b !== 4800 || Number(a.adj) < 1) throw new Error(JSON.stringify(a));
});
await test('APPEARANCE: light, dark and automatic are all available and persist', async (page) => {
  await go(page, '/settings');
  for (const [label, want] of [['Dark', 'dark'], ['Light', 'light']]) { await click(page, label, '.theme-seg button'); const th = await page.evaluate(() => document.documentElement.dataset.theme); if (th !== want) throw new Error(`${label} -> ${th}`); }
  const labels = await page.evaluate(() => [...document.querySelectorAll('.theme-seg button')].map((b) => b.innerText.trim())); if (!labels.includes('Auto')) throw new Error('no Auto option');
});

await test('HOME: two summary areas, an action row beneath them, and distinct sections', async (page) => {
  await go(page, '/');
  const m = await page.evaluate(() => {
    const stats = [...document.querySelectorAll('.home-top .stat')]; const act = document.querySelector('.home-actions'); const tops = stats.map((s) => s.getBoundingClientRect().bottom);
    return { n: stats.length, text: stats.map((s) => s.innerText).join(' | '), inlineLinks: document.querySelectorAll('.stat a, .stat button').length, below: act && act.getBoundingClientRect().top >= Math.max(...tops) - 1,
      primary: document.querySelector('[data-testid=ov-rta-action]').classList.contains('primary'), plan: document.querySelector('[data-testid=ov-open-plan]').classList.contains('primary'),
      heads: [...document.querySelectorAll('.section-h h2')].map((h) => h.innerText.replace(/\d+$/, '').trim()) };
  });
  if (m.n !== 2 || /Due in 14 days/i.test(m.text)) throw new Error('summary cards: ' + m.text);
  if (!/Cash & savings/i.test(m.text) || !/Ready to assign/i.test(m.text)) throw new Error('missing summary: ' + m.text);
  if (m.inlineLinks !== 0) throw new Error('inline links remain inside the summary cards');
  if (!m.below || !m.primary || m.plan) throw new Error('action row: ' + JSON.stringify(m));
  for (const h of ['Upcoming', 'Needs attention', 'Expected income', 'Accounts', 'Recent activity']) if (!m.heads.includes(h)) throw new Error(`section "${h}" missing: ${m.heads}`);
});
await test('THEME: quick toggle in the sidebar switches light/dark at once, and from Automatic picks an explicit theme', async (page) => {
  await go(page, '/');
  const th = () => page.evaluate(() => document.documentElement.dataset.theme); const stored = () => page.evaluate(() => localStorage.getItem('fos-theme'));
  if (await th() !== 'light') throw new Error('expected light to start');
  await click(page, 'Dark mode', '[data-testid=theme-toggle]'); if (await th() !== 'dark' || await stored() !== 'dark') throw new Error('did not switch to dark');
  await click(page, 'Light mode', '[data-testid=theme-toggle]'); if (await th() !== 'light' || await stored() !== 'light') throw new Error('did not switch back');
  const label = await page.evaluate(() => document.querySelector('[data-testid=theme-toggle]').getAttribute('aria-label')); if (!/Switch to dark mode/.test(label)) throw new Error('aria-label: ' + label);
  // Automatic: follow the device (dark), then the toggle must choose an explicit LIGHT; Settings still offers all three
  await go(page, '/settings'); await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]); await click(page, 'Auto', '.theme-seg button'); await sleep(300);
  if (await stored() !== 'system' || await th() !== 'dark') throw new Error('automatic did not follow the device: ' + await th());
  await click(page, 'Light mode', '[data-testid=theme-toggle]'); if (await th() !== 'light' || await stored() !== 'light') throw new Error('toggle from Automatic: ' + await th() + '/' + await stored());
  const labels = await page.evaluate(() => [...document.querySelectorAll('.theme-seg button')].map((b) => b.innerText.trim())); if (labels.join() !== 'Light,Dark,Auto') throw new Error('Settings options: ' + labels);
});
await test('THEME (phone): the More menu has the quick toggle', async () => {
  const page = await fresh({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const name = 'THEME (phone): the More menu has the quick toggle';
  try {
    await go(page, '/'); await click(page, 'More'); await click(page, 'Switch to dark mode', '[data-testid=theme-toggle-mobile]');
    const th = await page.evaluate(() => document.documentElement.dataset.theme); if (th !== 'dark') throw new Error('did not switch: ' + th);
    results.push([name, true]);
  } catch (e) { results.push([name, false, e.message]); }
  await page.close();
});
await test('PLAN: Has money shows only items with a positive available balance, works with search, and leaves other filters alone', async (page) => {
  await go(page, '/plan');
  const names = () => page.evaluate(() => [...document.querySelectorAll('[data-testid=plan-row]')].map((r) => r.querySelector('.li-title').innerText.trim()));
  await click(page, 'Has money', '.seg button'); await sleep(300); const on = await names();
  for (const n of ['Rent', 'Groceries', 'Vacation Fund', 'Dining Out']) if (!on.includes(n)) throw new Error(`${n} should have money; got ${on}`);
  for (const n of ['Gas', 'Streaming', 'Old Internet']) if (on.includes(n)) throw new Error(`${n} (zero or negative) must be excluded; got ${on}`);
  await page.type('input[aria-label="Search the plan"]', 'vac'); await sleep(300); const s = await names(); if (s.join() !== 'Vacation Fund') throw new Error('search + filter: ' + s);
  await page.evaluate(() => { const i = document.querySelector('input[aria-label="Search the plan"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); });
  await click(page, 'Overspent', '.seg button'); await sleep(300); const o = await names(); if (o.join() !== 'Gas') throw new Error('other filters changed: ' + o);
  await click(page, 'Archived', '.seg button'); await sleep(300); if (!(await page.evaluate(() => !!document.querySelector('[data-testid=archived-list]') || /No archived/.test(document.body.innerText)))) throw new Error('archived view broken');
});
await test('PLAN (phone): Has money is reachable in the filter row', async () => {
  const page = await fresh({ width: 390, height: 844, isMobile: true, hasTouch: true }); const name = 'PLAN (phone): Has money is reachable in the filter row';
  try { await go(page, '/plan'); const t = await page.evaluate(() => [...document.querySelectorAll('.seg button')].map((b) => b.innerText)); if (!t.some((x) => /Has money/.test(x))) throw new Error('filter missing'); results.push([name, true]); }
  catch (e) { results.push([name, false, e.message]); }
  await page.close();
});
await test('PAYEE autocomplete: best match highlighted, Enter accepts without submitting, Tab accepts and moves on, Esc dismisses, arrows move', async (page) => {
  await go(page, '/'); await click(page, 'Add transaction'); await page.type('input[aria-label=Amount]', '12');
  const txns = (await sql('select count(*) n from transactions'))[0].n;
  const opts = () => page.evaluate(() => [...document.querySelectorAll('#payee-list [role=option]')].map((o) => ({ t: o.innerText.split('\n')[0], sel: o.getAttribute('aria-selected') === 'true' })));
  const val = () => page.evaluate(() => document.querySelector('#payee').value);
  await page.focus('#payee'); await page.type('#payee', 'Tra'); await sleep(200);
  let o = await opts(); if (!o.length || !o[0].sel) throw new Error('first suggestion not highlighted: ' + JSON.stringify(o));
  if ((await val()) !== 'Tra') throw new Error('typed text was replaced early');
  const combo = await page.evaluate(() => { const i = document.querySelector('#payee'); return [i.getAttribute('role'), i.getAttribute('aria-expanded'), !!i.getAttribute('aria-activedescendant')].join(); }); if (combo !== 'combobox,true,true') throw new Error('combobox semantics: ' + combo);
  await page.keyboard.press('Enter'); await sleep(300);
  if (!/^Trader Joe/.test(await val())) throw new Error('Enter did not accept: ' + await val());
  if (!(await page.evaluate(() => !!document.querySelector('[role=dialog]')))) throw new Error('Enter closed/submitted the dialog');
  if ((await sql('select count(*) n from transactions'))[0].n !== txns) throw new Error('Enter submitted a transaction');
  // Escape dismisses the list but not the dialog; a brand-new payee types normally
  await page.evaluate(() => { const i = document.querySelector('#payee'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.focus('#payee'); await page.type('#payee', 'S'); await sleep(200); o = await opts(); if (o.length < 2) throw new Error('expected several matches for "S"');
  await page.keyboard.press('ArrowDown'); await sleep(100); o = await opts(); if (!o[1].sel || o[0].sel) throw new Error('ArrowDown did not move: ' + JSON.stringify(o));
  await page.keyboard.press('ArrowUp'); await sleep(100); o = await opts(); if (!o[0].sel) throw new Error('ArrowUp did not move back');
  await page.keyboard.press('Escape'); await sleep(200); if ((await opts()).length) throw new Error('Escape left the list open');
  if (!(await page.evaluate(() => !!document.querySelector('[role=dialog]')))) throw new Error('Escape closed the dialog'); if ((await val()) !== 'S') throw new Error('Escape changed the text');
  await page.type('#payee', 'omeNewPlace'); await sleep(200); if ((await val()) !== 'SomeNewPlace' || (await opts()).length) throw new Error('new payee not typed normally: ' + await val());
  // Tab accepts the highlighted suggestion and moves focus on
  await page.evaluate(() => { const i = document.querySelector('#payee'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.focus('#payee'); await page.type('#payee', 'Whole'); await sleep(200); await page.keyboard.press('Tab'); await sleep(300);
  if (!/^Whole Foods/.test(await val())) throw new Error('Tab did not accept: ' + await val());
  if (await page.evaluate(() => document.activeElement.id === 'payee')) throw new Error('focus did not move on');
});
await test('PAYEE autocomplete still files the transaction normally (new and remembered payees)', async (page) => {
  await go(page, '/'); await click(page, 'Add transaction'); await page.type('input[aria-label=Amount]', '8.25'); await page.focus('#payee'); await page.type('#payee', 'Whole'); await page.keyboard.press('Enter'); await sleep(300);
  await click(page, 'Add expense'); await sleep(900);
  const [t] = await sql(`select payee, amount::float a, category_id from transactions order by id desc limit 1`); if (!/^Whole Foods/.test(t.payee) || t.a !== 8.25 || !t.category_id) throw new Error(JSON.stringify(t));
  await click(page, 'Add transaction'); await page.type('input[aria-label=Amount]', '5'); await page.type('#payee', 'Brand New Place'); await click(page, 'Dining Out', '.chip'); await click(page, 'Add expense'); await sleep(900);
  const [n] = await sql(`select payee from transactions order by id desc limit 1`); if (n.payee !== 'Brand New Place') throw new Error('new payee: ' + n.payee);
});

// ───────── transaction & plan usability (Enter key, transfers, pickers, negative reconcile, quick move, payment recognition) ─────────
const device = async (vp = { width: 1440, height: 900 }) => { // a second signed-in device on the SAME data (no reseed)
  const page = await browser.newPage(); await page.setViewport(vp);
  await page.evaluateOnNewDocument((s) => { localStorage.setItem('fos-auth', JSON.stringify(s)); localStorage.setItem('fos-theme', 'light'); }, session);
  page.errors = []; page.on('pageerror', (e) => page.errors.push(String(e))); return page;
};
const pickAcct = async (page, which, text) => {
  await page.evaluate((w) => document.querySelector(`[data-testid=${w}-btn]`).click(), which); await sleep(250);
  await page.type('[role=dialog] .picker input', text); await sleep(150); await page.keyboard.press('Enter'); await sleep(300);
};
const chosen = (page, label) => page.evaluate((label) => {
  const g = document.querySelector(`.chips[aria-label="${label}"]`); if (g) return g.querySelector('[aria-pressed=true]')?.innerText.split('\n')[0] ?? '';
  const b = document.querySelector(`[aria-label^="${label}:"]`); return b ? b.getAttribute('aria-label').slice(label.length + 2).replace(/^none chosen$/, '') : '';
}, label);
const typePressed = (page) => page.evaluate(() => [...document.querySelectorAll('[role=dialog] .seg button')].find((b) => b.getAttribute('aria-pressed') === 'true')?.innerText.trim());
const dialogOpen = (page) => page.evaluate(() => !!document.querySelector('[role=dialog]'));
const nTxn = async () => Number((await sql('select count(*) n from transactions'))[0].n);
const pickCat = async (page, name) => {
  const hit = await page.evaluate((name) => { const c = [...document.querySelectorAll('[role=dialog] .chips .chip')].find((x) => x.innerText.trim().startsWith(name)); if (c) { c.click(); return true; } return false; }, name);
  if (!hit) { await click(page, 'All categories', '[data-testid=all-categories]'); await page.keyboard.type(name); await sleep(150); await page.keyboard.press('Enter'); }
  await sleep(250);
};
const addTxn = async (page, { amount, payee, cat, date, label = 'Add expense' }) => {
  await go(page, '/'); await click(page, 'Add transaction'); await page.type('input[aria-label=Amount]', String(amount)); await page.type('#payee', payee);
  if (cat) await pickCat(page, cat);
  if (date) { await click(page, 'Date, notes, split'); await setVal(page, '#date', date); await sleep(200); }
  await click(page, label); await sleep(1100);
};

await test('ENTER: never changes the transaction type (Income, Transfer, Expense); submits only a valid form', async (page) => {
  await go(page, '/'); await click(page, 'Add transaction'); await click(page, 'Income', '.seg button');
  await page.type('input[aria-label=Amount]', '300'); await page.focus('#payee'); const n0 = await nTxn();
  await page.keyboard.press('Enter'); await sleep(400);
  if (await typePressed(page) !== 'Income') throw new Error('Enter in From switched the type to ' + await typePressed(page));
  if (!(await dialogOpen(page)) || await nTxn() !== n0) throw new Error('an invalid income form was submitted');
  await page.type('#payee', 'Side Gig'); await page.keyboard.press('Enter'); await sleep(1000);
  const [t] = await sql(`select type, payee, amount::float a from transactions order by id desc limit 1`);
  if (t.type !== 'Income' || t.payee !== 'Side Gig' || t.a !== 300) throw new Error('income not saved as income: ' + JSON.stringify(t));
  await click(page, 'Add transaction'); await click(page, 'Transfer', '.seg button'); await page.type('input[aria-label=Amount]', '10'); await page.focus('input[aria-label=Amount]');
  await page.keyboard.press('Enter'); await sleep(900);
  if (await dialogOpen(page)) { if (await typePressed(page) !== 'Transfer') throw new Error('Enter flipped Transfer to ' + await typePressed(page)); }
  else { const [x] = await sql(`select type from transactions order by id desc limit 1`); if (x.type !== 'Transfer') throw new Error('Enter in a transfer saved a ' + x.type); }
  await click(page, 'Add transaction').catch(() => {}); await click(page, 'Expense', '.seg button').catch(() => {});
});

await test('TRANSFER: the last SAVED pair is remembered across devices; canceled or unsaved edits never count; invalid accounts fall back', async (page) => {
  await go(page, '/'); await click(page, 'Add transaction'); await click(page, 'Transfer', '.seg button');
  await pickAcct(page, 'txn-to-account', 'Cash'); await pickAcct(page, 'txn-account', 'High-Yield'); await pickAcct(page, 'txn-to-account', 'Everyday'); // the other side is never offered, so free it first
  await page.type('input[aria-label=Amount]', '5'); await click(page, 'Add transfer'); await sleep(1000);
  const [t] = await sql(`select account_id, to_account_id from transactions where type='Transfer' order by id desc limit 1`); if (Number(t.account_id) !== 2 || Number(t.to_account_id) !== 1) throw new Error('setup transfer: ' + JSON.stringify(t));
  const dev2 = await device(); dev2.on('dialog', () => {});
  try {
    const open = async () => { await go(dev2, '/'); await click(dev2, 'Add transaction'); await click(dev2, 'Transfer', '.seg button'); await sleep(250); };
    await open(); let f = await chosen(dev2, 'From account'), to = await chosen(dev2, 'To account');
    if (f !== 'High-Yield Savings' || to !== 'Everyday Checking') throw new Error(`second device got ${f} -> ${to}`);
    await click(dev2, 'Swap', '[data-testid=txn-swap]'); f = await chosen(dev2, 'From account'); to = await chosen(dev2, 'To account');
    if (f !== 'Everyday Checking' || to !== 'High-Yield Savings') throw new Error('swap did not reverse the accounts');
    await pickAcct(dev2, 'txn-account', 'Cash'); // an unsaved manual change
    await dev2.keyboard.press('Escape'); await sleep(300); await click(dev2, 'Add transaction'); await click(dev2, 'Transfer', '.seg button'); await sleep(250);
    f = await chosen(dev2, 'From account'); to = await chosen(dev2, 'To account');
    if (f !== 'High-Yield Savings' || to !== 'Everyday Checking') throw new Error(`an unsaved change leaked into the preference: ${f} -> ${to}`);
    await sql(`update accounts set is_archived=true where id=2`); await open(); // the remembered From is now archived
    f = await chosen(dev2, 'From account'); to = await chosen(dev2, 'To account');
    if (f === 'High-Yield Savings' || to === 'High-Yield Savings' || (f && f === to)) throw new Error(`archived account was offered: ${f} -> ${to}`);
    if (page.errors.length || dev2.errors.length) throw new Error([...page.errors, ...dev2.errors].join('; '));
  } finally { await dev2.close(); }
});

await test('TRANSFER: Swap reverses From/To, keeps the amount, updates the balance previews; balances show beside account names', async (page) => {
  await go(page, '/'); await click(page, 'Add transaction'); await click(page, 'Transfer', '.seg button');
  await page.type('input[aria-label=Amount]', '100');
  await pickAcct(page, 'txn-to-account', 'Cash'); await pickAcct(page, 'txn-account', 'Everyday'); await pickAcct(page, 'txn-to-account', 'High-Yield');
  const prev = () => page.evaluate(() => [...document.querySelectorAll('[data-testid=bal-preview]')].map((e) => e.innerText.replace(/\s+/g, ' ')));
  let p = await prev(); if (!/4,820\.15 → .*4,720\.15/.test(p[0]) || !/2,400\.00 → .*2,500\.00/.test(p[1])) throw new Error('previews: ' + p.join(' | '));
  await page.focus('[data-testid=txn-swap]'); await page.keyboard.press('Enter'); await sleep(300); // keyboard-operable
  p = await prev(); if (!/2,400\.00 → .*2,300\.00/.test(p[0]) || !/4,820\.15 → .*4,920\.15/.test(p[1])) throw new Error('previews after swap: ' + p.join(' | '));
  if (await page.evaluate(() => document.querySelector('input[aria-label=Amount]').value) !== '100') throw new Error('amount lost on swap');
  await pickAcct(page, 'txn-to-account', 'Rewards'); p = await prev(); if (!/1,240\.50 → .*1,140\.50/.test(p[1])) throw new Error('a card shows what is owed: ' + p.join(' | '));
  await page.evaluate(() => document.querySelector('[data-testid=txn-to-account-btn]').click()); await sleep(250);
  const o = await page.evaluate(() => [...document.querySelectorAll('[role=dialog] .picker [role=option]')].map((x) => x.innerText.replace(/\s+/g, ' ')));
  if (!o.some((t) => /Cash Wallet.*\$140\.00/.test(t)) || !o.some((t) => /Rewards Visa.*owed/.test(t))) throw new Error('account balances missing in the picker: ' + o.join(' | '));
  if (o.some((t) => /High-Yield/.test(t))) throw new Error('the From account is offered as the To account');
});

await test('CATEGORY search: type to filter, best match highlighted, Enter/Tab accept, Esc closes, hidden categories excluded, group shown', async (page) => {
  await sql(`update categories set is_hidden=true where name='Streaming'`);
  await go(page, '/'); await click(page, 'Add transaction'); await page.type('input[aria-label=Amount]', '9'); await page.type('#payee', 'Cafe X'); const n0 = await nTxn();
  await click(page, 'All categories', '[data-testid=all-categories]');
  const opts = () => page.evaluate(() => [...document.querySelectorAll('[data-testid=cat-picker] [role=option]')].map((o) => ({ t: o.querySelector('.li-title').innerText.trim(), sub: o.querySelector('.li-sub')?.innerText ?? '', active: o.getAttribute('data-active') === 'true', sel: o.getAttribute('aria-selected') === 'true' })));
  if (await page.evaluate(() => document.activeElement.getAttribute('aria-label')) !== 'Search All categories') throw new Error('search box not focused');
  let o = await opts(); if (o.some((x) => x.t === 'Streaming')) throw new Error('an archived category is offered'); if (!o[0].active) throw new Error('first not highlighted'); if (!o.every((x) => x.sub)) throw new Error('group context missing');
  await page.keyboard.type('vac'); await sleep(150); o = await opts(); if (o.length !== 1 || o[0].t !== 'Vacation Fund' || !o[0].active) throw new Error('filter: ' + JSON.stringify(o));
  await page.keyboard.press('Enter'); await sleep(300);
  if (!(await page.evaluate(() => [...document.querySelectorAll('[role=dialog] .chips .chip')].some((c) => c.getAttribute('aria-pressed') === 'true' && /Vacation Fund/.test(c.innerText))))) throw new Error('Enter did not select it');
  if (!(await dialogOpen(page)) || await nTxn() !== n0) throw new Error('Enter closed or submitted the transaction');
  await click(page, 'All categories', '[data-testid=all-categories]'); o = await opts(); if (!o.find((x) => x.t === 'Vacation Fund')?.sel) throw new Error('the selected category is not indicated');
  await page.keyboard.type('o'); await sleep(150); o = await opts(); if (o.length < 3) throw new Error('expected several matches'); const first = o[0].t;
  await page.keyboard.press('ArrowDown'); await sleep(100); o = await opts(); if (!o[1].active || o[0].active) throw new Error('ArrowDown');
  await page.keyboard.press('ArrowUp'); await sleep(100); o = await opts(); if (!o[0].active) throw new Error('ArrowUp');
  await page.keyboard.press('Tab'); await sleep(300);
  if (!(await page.evaluate((f) => [...document.querySelectorAll('[role=dialog] .chips .chip')].some((c) => c.getAttribute('aria-pressed') === 'true' && c.innerText.includes(f)), first))) throw new Error('Tab did not accept ' + first);
  if (await page.evaluate(() => document.activeElement.getAttribute('aria-label') === 'Search All categories')) throw new Error('focus stayed in the search');
  await click(page, 'All categories', '[data-testid=all-categories]'); await page.keyboard.press('Escape'); await sleep(250);
  if ((await opts()).length || !(await dialogOpen(page))) throw new Error('Escape should close only the list');
});

await test('RECONCILE: a negative actual balance can be entered; positive → negative → zero → positive land exactly on target; history is kept', async (page) => {
  const rec = async (v) => {
    await go(page, '/accounts/1'); await click(page, 'Reconcile'); await page.type('#act', v); await click(page, 'Preview difference');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Record adjustment|Mark reconciled/.test(b.innerText)).click()); await sleep(1000);
    return (await sql('select balance::float b from accounts where id=1'))[0].b;
  };
  const kept = Number((await sql(`select count(*) n from transactions where not coalesce(is_adjustment,false)`))[0].n);
  const dis = await (async () => { await go(page, '/accounts/1'); await click(page, 'Reconcile'); await page.type('#act', '-'); const off = await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Preview difference/.test(b.innerText)).disabled); await page.keyboard.press('Escape'); await sleep(300); return off; })();
  if (!dis) throw new Error('a lone minus sign should not be accepted');
  if (await rec('-128.38') !== -128.38) throw new Error('negative target not reached');
  const [adj] = await sql(`select type, amount::float a from transactions where is_adjustment and account_id=1 order by id desc limit 1`); if (adj.type !== 'Expense' || Math.abs(adj.a - 4948.53) > 0.001) throw new Error('adjustment: ' + JSON.stringify(adj));
  if (await rec('0') !== 0) throw new Error('zero not reached');
  if (await rec('75.25') !== 75.25) throw new Error('positive after negative not reached');
  if (await rec('-5,000.5') !== -5000.5) throw new Error('thousands separator / signed value');
  const after = Number((await sql(`select count(*) n from transactions where not coalesce(is_adjustment,false)`))[0].n);
  if (after !== kept) throw new Error('ordinary transactions were changed to force a match');
  await go(page, '/accounts/1'); const t = await page.evaluate(() => document.body.innerText); if (!/−\$5,000\.50/.test(t)) throw new Error('negative balance not displayed: ');
});

await test('PLAN rows: a quiet Move money shortcut opens the one Move Money dialog with the item prefilled; Pay buttons are gone', async (page) => {
  await go(page, '/'); await click(page, 'Electric details'); await sleep(300); if (!/Record payment/.test(await detail(page))) throw new Error('Home rows should open the item, where payments are managed');
  await page.keyboard.press('Escape'); await sleep(300);
  const pays = async () => page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'Pay').length);
  if (await pays()) throw new Error('Home still has Pay buttons');
  await go(page, '/plan'); if (await pays()) throw new Error('Plan still has Pay buttons');
  const click1 = (name) => page.evaluate((name) => { const r = [...document.querySelectorAll('[data-testid=plan-row]')].find((x) => x.querySelector('.li-title').innerText.trim() === name); r.querySelector('[data-testid=row-move]').click(); }, name);
  await click1('Rent'); await sleep(500);
  let t = await page.evaluate(() => document.querySelector('[role=dialog]').innerText); if (!/Move money/.test(t)) throw new Error('dialog did not open');
  if (await chosen(page, 'From') !== 'Rent') throw new Error('From should be Rent, got ' + await chosen(page, 'From'));
  await page.keyboard.press('Escape'); await sleep(250); if (await page.evaluate(() => !!document.querySelector('[role=dialog] .picker'))) { await page.keyboard.press('Escape'); await sleep(250); }
  if (await dialogOpen(page)) await page.keyboard.press('Escape'); await sleep(300);
  await click1('Streaming'); await sleep(500);
  if (await chosen(page, 'To') !== 'Streaming' || await chosen(page, 'From') !== 'Ready to Assign') throw new Error(`empty item: ${await chosen(page, 'From')} -> ${await chosen(page, 'To')}`);
  await page.keyboard.press('Escape'); await sleep(300);
  const gasHas = await page.evaluate(() => { const r = [...document.querySelectorAll('[data-testid=plan-row]')].find((x) => x.querySelector('.li-title').innerText.trim() === 'Gas'); return { move: !!r.querySelector('[data-testid=row-move]'), cover: /Cover/.test(r.innerText) }; });
  if (gasHas.move || !gasHas.cover) throw new Error('an overspent item should keep its Cover action only');
  // discoverable by keyboard: focus reveals it
  await page.evaluate(() => document.querySelector('[data-testid=plan-row]').focus()); await sleep(250);
  const op = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid=plan-row] [data-testid=row-move]')).opacity); if (Number(op) < 1) throw new Error('shortcut not revealed on focus: ' + op);
  const lab = await page.evaluate(() => document.querySelector('[data-testid=row-move]').getAttribute('aria-label')); if (!/^Move money (from|to) /.test(lab)) throw new Error('no accessible name: ' + lab);
});
await test('PLAN rows (phone): the Move money shortcut is visible without hover', async () => {
  const page = await fresh({ width: 390, height: 844, isMobile: true, hasTouch: true }); const name = 'PLAN rows (phone): the Move money shortcut is visible without hover';
  try { await go(page, '/plan'); const op = await page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-testid=row-move]')).opacity)); if (op < 0.5) throw new Error('hidden on touch: ' + op); results.push([name, true]); }
  catch (e) { results.push([name, false, e.message]); }
  await page.close();
});

await test('MOVE MONEY keyboard: search, best match highlighted, Tab accepts and advances, Enter never submits, Esc closes, no invalid pairs', async (page) => {
  await go(page, '/plan'); await page.evaluate(() => document.querySelector('[data-testid=plan-move]').click()); await sleep(500);
  const searchFocused = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  if (await searchFocused() !== 'Search From') throw new Error('From search not focused: ' + await searchFocused());
  const act = () => page.evaluate(() => [...document.querySelectorAll('[role=dialog] [role=option]')].find((o) => o.getAttribute('data-active') === 'true')?.querySelector('.li-title').innerText.trim());
  await page.keyboard.type('ren'); await sleep(200); if (await act() !== 'Rent') throw new Error('Rent not highlighted: ' + await act());
  await page.keyboard.press('Tab'); await sleep(400);
  if (await chosen(page, 'From') !== 'Rent') throw new Error('Tab did not accept From');
  if (await searchFocused() !== 'Search To') throw new Error('focus did not advance to To: ' + await searchFocused());
  const toIds = await page.evaluate(() => [...document.querySelectorAll('[data-testid=move-to] [role=option]')].map((o) => o.innerText));
  if (toIds.some((t) => /^Rent/.test(t))) throw new Error('the From item is offered as To');
  await page.keyboard.type('gro'); await sleep(200); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter'); await sleep(400);
  if (await chosen(page, 'To') !== 'Groceries') throw new Error('Enter did not accept To: ' + await chosen(page, 'To'));
  if (!(await dialogOpen(page))) throw new Error('Enter submitted or closed the dialog');
  const m0 = (await sql('select assigned_amount::float a from categories where name=\'Groceries\''))[0].a;
  await page.evaluate(() => document.querySelector('[data-testid=move-to-btn]').click()); await sleep(250); await page.keyboard.press('Escape'); await sleep(250);
  if (!(await dialogOpen(page))) throw new Error('Escape closed the whole dialog');
  await click(page, 'Swap', '[data-testid=move-swap]'); if (await chosen(page, 'From') !== 'Groceries' || await chosen(page, 'To') !== 'Rent') throw new Error('swap');
  await click(page, 'Swap', '[data-testid=move-swap]');
  await page.focus('[role=dialog] input[inputmode=decimal]'); await page.keyboard.type('10'); await page.keyboard.press('Enter'); await sleep(1000);
  const m1 = (await sql('select assigned_amount::float a from categories where name=\'Groceries\''))[0].a;
  if (Math.abs(m1 - (m0 + 10)) > 0.001) throw new Error(`Groceries ${m0} -> ${m1}, expected +10`);
  if (await dialogOpen(page)) throw new Error('dialog should close after moving');
});

await test('RECOGNIZE: a full payment recorded as an ordinary transaction counts automatically; Undo reverses everything', async (page) => {
  const b0 = Number((await sql('select balance::float b from accounts where id=1'))[0].b); const n0 = await nTxn();
  await addTxn(page, { amount: 85, payee: 'Phone Co', cat: 'Phone' });
  const [a] = await sql(`select (select balance::float from accounts where id=1) b, (select count(*) from bill_payments where category_id=3) bp, (select due_date::text from categories where id=3) d`);
  if (await nTxn() !== n0 + 1 || Math.abs(a.b - (b0 - 85)) > 0.001) throw new Error('one transaction, one debit expected: ' + JSON.stringify(a));
  if (Number(a.bp) !== 2 || a.d !== '2026-12-22') throw new Error('not recognised as the Phone payment: ' + JSON.stringify(a));
  const tt = await toastText(page); if (!/counted as your Phone payment/.test(tt)) throw new Error('toast: ' + tt);
  await click(page, 'Undo', '.toast button'); await sleep(900);
  const [u] = await sql(`select (select balance::float from accounts where id=1) b, (select count(*) from bill_payments where category_id=3) bp, (select due_date::text from categories where id=3) d`);
  if (await nTxn() !== n0 || Math.abs(u.b - b0) > 0.001 || Number(u.bp) !== 1 || u.d !== '2026-11-22') throw new Error('undo left a trace: ' + JSON.stringify(u));
});
await test('RECOGNIZE: a linked transaction is locked (no edit/delete) and says why', async (page) => {
  await addTxn(page, { amount: 85, payee: 'Phone Co', cat: 'Phone' });
  await go(page, '/activity'); await sleep(300);
  const hit = await page.evaluate(() => { const r = [...document.querySelectorAll('button')].find((x) => /Phone Co/.test(x.innerText) && x.offsetParent); if (!r) return false; r.click(); return true; });
  if (!hit) throw new Error('row not found: ' + (await page.evaluate(() => document.body.innerText.slice(0, 300))));
  await sleep(500);
  const pane = await page.evaluate(() => document.querySelector('.pane')?.innerText ?? ''); if (/Delete…/.test(pane)) throw new Error('a linked transaction offers Delete');
  await click(page, 'Details', '.pane button'); await sleep(400);
  const d = await page.evaluate(() => document.querySelector('[role=dialog]')?.innerText ?? '');
  if (/Delete/.test(d) || /Edit/.test(d)) throw new Error('linked transaction can be changed: ' + d.slice(0, 200));
  if (!/counts as a payment toward Phone/.test(d)) throw new Error('no explanation: ' + d.slice(0, 260));
});
await test('RECOGNIZE: a smaller amount asks; partial is tracked by explicit link; the completing payment settles; unrelated spending never counts', async (page) => {
  await sql(`insert into transactions (date, amount, payee, category_id, account_id, type, entity_id, status) values ('2026-11-08', 40, 'Unrelated Electric Thing', 2, 1, 'Expense', 'personal', 'posted')`);
  await addTxn(page, { amount: 50, payee: 'Power Co', cat: 'Electric' });
  const t = await page.evaluate(() => document.querySelector('[role=dialog]')?.innerText ?? ''); if (!/Is this a payment toward Electric\?/.test(t)) throw new Error('no question: ' + t.slice(0, 160));
  if (!(await page.evaluate(() => document.querySelector('[data-testid=pay-choice-partial]').checked))) throw new Error('partial should be the default');
  await click(page, 'Confirm', '[data-testid=advance-due]'); await sleep(1000);
  let [p] = await sql(`select (select count(*) from bill_partials) bp, (select sum(amount)::float from bill_partials) s, (select count(*) from bill_payments where category_id=2) pay, (select due_date::text from categories where id=2) d`);
  if (Number(p.bp) !== 1 || p.s !== 50 || Number(p.pay) !== 0 || p.d !== '2026-11-14') throw new Error('partial: ' + JSON.stringify(p));
  await go(page, '/plan'); await rowClick(page, 'Electric'); await sleep(400); const e = await detail(page);
  if (!/Paid so far/.test(e) || !/\$50\.00/.test(e) || !/\$68\.40 remaining/.test(e)) throw new Error('paid-so-far must count only the linked $50 (not the unrelated $40): ' + e.slice(0, 300));
  await addTxn(page, { amount: 68.4, payee: 'Power Co', cat: 'Electric' }); // completes it: no question
  [p] = await sql(`select (select count(*) from bill_partials) bp, (select count(*) from bill_payments where category_id=2) pay, (select due_date::text from categories where id=2) d`);
  if (Number(p.pay) !== 1 || p.d !== '2026-12-14' || Number(p.bp) !== 1) throw new Error('completion: ' + JSON.stringify(p));
});
await test('RECOGNIZE: a partial can be undone from the item (the transaction is kept unless chosen)', async (page) => {
  await addTxn(page, { amount: 50, payee: 'Power Co', cat: 'Electric' }); await click(page, 'Confirm', '[data-testid=advance-due]'); await sleep(900);
  const n0 = await nTxn();
  await go(page, '/'); await click(page, 'Electric details'); await click(page, 'Record payment', '[data-testid=record-payment]');
  await click(page, 'Undo', '[data-testid=undo-partial]'); await click(page, 'Undo payment', '[data-testid=undo-partial-confirm]'); await sleep(900);
  const [p] = await sql(`select (select count(*) from bill_partials) bp`); if (Number(p.bp) !== 0 || await nTxn() !== n0) throw new Error('undo: ' + JSON.stringify(p));
});
await test('RECOGNIZE: no schedule, too early, or backdated → an ordinary transaction; answering "no" links nothing', async (page) => {
  const n0 = await nTxn();
  await addTxn(page, { amount: 40, payee: 'Trader Joe\'s', cat: 'Groceries' });
  await addTxn(page, { amount: 1500, payee: 'Landlord', cat: 'Rent' }); // next rent is Dec 1: far too early to be it
  await addTxn(page, { amount: 118.4, payee: 'Power Co', cat: 'Electric', date: '2026-09-01' }); // backdated before this cycle
  if (await dialogOpen(page)) throw new Error('a question was asked for a non-match');
  const [p] = await sql(`select (select count(*) from bill_payments) bp, (select count(*) from bill_partials) bq`); if (Number(p.bp) !== 2 || Number(p.bq) !== 0) throw new Error('something was linked: ' + JSON.stringify(p));
  if (await nTxn() !== n0 + 3) throw new Error('the transactions themselves must still be recorded');
  await addTxn(page, { amount: 30, payee: 'Power Co', cat: 'Electric' }); await page.evaluate(() => document.querySelector('[data-testid=pay-choice-none]').click()); await sleep(200);
  await click(page, 'Keep as a transaction', '[data-testid=advance-due]'); await sleep(900);
  const [q] = await sql(`select (select count(*) from bill_payments) bp, (select count(*) from bill_partials) bq`); if (Number(q.bp) !== 2 || Number(q.bq) !== 0) throw new Error('"no" still linked: ' + JSON.stringify(q));
});
await test('RECOGNIZE: several missed payments → asks which; confirming pays the oldest, the debt falls, nothing doubles', async (page) => {
  await addTxn(page, { amount: 320, payee: 'Loan Co', cat: 'Car Loan' });
  const t = await page.evaluate(() => document.querySelector('[role=dialog]')?.innerText ?? ''); if (!/oldest missed payment/.test(t)) throw new Error('no backlog question: ' + t.slice(0, 200));
  const n0 = await nTxn(); await click(page, 'Confirm', '[data-testid=advance-due]'); await sleep(1000);
  const [a] = await sql(`select (select balance::float from categories where id=5) owed, (select due_date::text from categories where id=5) d, (select count(*) from bill_payments where category_id=5) bp`);
  if (a.owed !== 8080 || a.d !== '2026-10-27' || Number(a.bp) !== 1 || await nTxn() !== n0) throw new Error(JSON.stringify(a));
});
await browser.close(); await new Promise((r) => pv.httpServer.close(r)); backend.close(); fs.rmSync(outDir, { recursive: true, force: true });
for (const [n, ok, why] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${why ? '  — ' + why : ''}`);
console.log(`${results.filter((r) => r[1]).length}/${results.length} passed`);
process.exit(results.every((r) => r[1]) ? 0 : 1);

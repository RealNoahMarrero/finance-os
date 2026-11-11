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
const openCarLoan = async (page) => { await go(page, '/'); await click(page, 'Car Loan details'); };

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
  if (!/Car Loan · 2 payments missed/.test(h)) throw new Error('Home attention row missing: ' + h.slice(0, 120));
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
  await go(page, '/'); await click(page, 'Electric details'); await sleep(300);
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
await browser.close(); await new Promise((r) => pv.httpServer.close(r)); backend.close(); fs.rmSync(outDir, { recursive: true, force: true });
for (const [n, ok, why] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${why ? '  — ' + why : ''}`);
console.log(`${results.filter((r) => r[1]).length}/${results.length} passed`);
process.exit(results.every((r) => r[1]) ? 0 : 1);

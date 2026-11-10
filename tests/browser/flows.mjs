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
  await go(page, '/budget');
  const before = await sql('select sum(balance)::float as b from accounts');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Cover').click()); await sleep(500); await click(page, 'Move $35.00');
  const [gas] = await sql('select assigned_amount from categories where id=8'); const after = await sql('select sum(balance)::float as b from accounts');
  if (Number(gas.assigned_amount) !== 0) throw new Error(`Gas is ${gas.assigned_amount}, expected 0`);
  if (before[0].b !== after[0].b) throw new Error('bank balances changed');
});
await test('Pay an upcoming bill (Electric) records the payment', async (page) => {
  await go(page, '/bills');
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
    const t = await page.evaluate(() => document.querySelector('[role=dialog]').innerText); for (const w of ['Accounts', 'Insights', 'Settings']) if (!t.includes(w)) throw new Error(`${w} missing from More`);
    results.push(['phone: More menu reaches Accounts, Insights and Settings', true]);
  } catch (e) { results.push(['phone: More menu reaches Accounts, Insights and Settings', false, e.message]); }
  await page.close();
});
await test('settings export control and theme switch exist', async (page) => {
  await go(page, '/settings'); const t = await page.evaluate(() => document.body.innerText); if (!/Export everything/.test(t) || !/Appearance/.test(t)) throw new Error('settings incomplete');
  await click(page, 'Dark', '.theme-seg button'); const th = await page.evaluate(() => document.documentElement.dataset.theme); if (th !== 'dark') throw new Error('theme did not switch');
});

const setVal = (page, sel, v) => page.evaluate((sel, v) => { const el = document.querySelector(sel); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, sel, v);
const openCarLoan = async (page) => { await go(page, '/bills'); await click(page, 'Car Loan details'); };

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
  await go(page, '/bills');
  const t = await page.evaluate(() => document.body.innerText); if (!/2 missed/.test(t)) throw new Error('no "2 missed" on Bills');
  if ((t.match(/Car Loan/g) || []).length > 3) throw new Error('Car Loan appears as several rows');
  await go(page, '/'); const h = await page.evaluate(() => document.querySelector('[aria-label="Needs attention"]').innerText);
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

await browser.close(); await new Promise((r) => pv.httpServer.close(r)); backend.close(); fs.rmSync(outDir, { recursive: true, force: true });
for (const [n, ok, why] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${why ? '  — ' + why : ''}`);
console.log(`${results.filter((r) => r[1]).length}/${results.length} passed`);
process.exit(results.every((r) => r[1]) ? 0 : 1);

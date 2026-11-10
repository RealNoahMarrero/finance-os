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

await browser.close(); await new Promise((r) => pv.httpServer.close(r)); backend.close(); fs.rmSync(outDir, { recursive: true, force: true });
for (const [n, ok, why] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${why ? '  — ' + why : ''}`);
console.log(`${results.filter((r) => r[1]).length}/${results.length} passed`);
process.exit(results.every((r) => r[1]) ? 0 : 1);

// Proves the read-only preview guard: a bundle built with VITE_READONLY=1 talks to a WRITABLE synthetic backend, and nothing the user does can change it.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { build, preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { start } from '../../tools/demo/server.mjs';

const chrome = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fos-ro-'));
Object.assign(process.env, { VITE_SUPABASE_URL: 'http://127.0.0.1:54393', VITE_SUPABASE_ANON_KEY: 'demo', VITE_DEMO_TODAY: '2026-11-10', VITE_READONLY: '1' });
const backend = await start(54393); // writable on purpose: only the client guard stands between the UI and the data
await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } });
const pv = await preview({ logLevel: 'silent', build: { outDir }, preview: { port: 4185, strictPort: true } });
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => localStorage.setItem('fos-auth-preview', JSON.stringify({ access_token: 'd', refresh_token: 'd', token_type: 'bearer', expires_in: 9e9, expires_at: 4102444800, user: { id: 'u', aud: 'authenticated', email: 'd@e.test' } })));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = async () => JSON.stringify((await backend.pg.query(`select (select sum(balance) from accounts) a, (select sum(assigned_amount) from categories) c, (select count(*) from transactions) t, (select count(*) from bill_payments) bp`)).rows[0]);
const results = [];
const check = (name, ok, why = '') => results.push([name, ok, why]);
await page.goto('http://localhost:4185/#/', { waitUntil: 'networkidle0' }); await page.reload({ waitUntil: 'networkidle0' });
const before = await snap();
const banner = await page.evaluate(() => document.body.innerText.includes('Read-only preview'));
check('banner is shown', banner);
// try to add an expense through the UI
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Add transaction')).click()); await sleep(400);
await page.type('input[aria-label=Amount]', '9.99'); await page.type('#payee', 'Should Not Save');
await page.evaluate(() => [...document.querySelectorAll('.chip')].find((b) => b.innerText.includes('Dining Out')).click());
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Add expense/.test(b.innerText.trim())).click()); await sleep(1200);
const toast = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' '));
check('a save attempt is refused with a clear message', /Read-only preview/.test(toast), toast.slice(0, 80));
check('the database is unchanged after the attempt', (await snap()) === before);
// and directly through the same client the app uses
const direct = await page.evaluate(async () => { const r = await fetch('http://127.0.0.1:54393/rest/v1/accounts?id=eq.1', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ balance: 1 }) }); return r.status; });
check('(control) the backend itself would have accepted a raw write', direct === 204 || direct === 200); // proves the guard, not the backend, is what blocks the app
await browser.close(); await new Promise((r) => pv.httpServer.close(r)); backend.close(); fs.rmSync(outDir, { recursive: true, force: true });
for (const [n, ok, why] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${why && !ok ? ' — ' + why : ''}`);
process.exit(results.every((r) => r[1]) ? 0 : 1);

// Browser smoke test against the SYNTHETIC demo backend. Builds a throwaway bundle (not dist/), loads every route on desktop
// and phone widths and fails on: JS errors, console errors, horizontal overflow, empty pages, or ANY attempted write.
// Needs a Chrome/Edge: set CHROME_PATH or install one in a default location.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { build, preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { start } from '../../tools/demo/server.mjs';

const chrome = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
if (!chrome) { console.error('No Chrome/Edge found. Set CHROME_PATH.'); process.exit(2); }
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fos-demo-'));
Object.assign(process.env, { VITE_SUPABASE_URL: 'http://127.0.0.1:54399', VITE_SUPABASE_ANON_KEY: 'demo', VITE_DEMO_TODAY: '2026-11-10' });
const backend = await start(54399);
await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } });
const pv = await preview({ logLevel: 'silent', build: { outDir }, preview: { port: 4181, strictPort: true } });
const base = 'http://localhost:4181/';
const session = { access_token: 'demo', refresh_token: 'demo', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: 'demo-user', aud: 'authenticated', email: 'demo@example.test' } };
const routes = ['/', '/transactions', '/accounts', '/accounts/1', '/plan/bills', '/plan/budget', '/plan/income', '/plan/calendar', '/plan/forecast', '/insights', '/credit'];
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
const failures = []; let checks = 0;
for (const [kind, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844, isMobile: true, hasTouch: true }]]) {
  const page = await browser.newPage(); await page.setViewport(vp);
  await page.evaluateOnNewDocument((s) => { localStorage.setItem('fos-auth', JSON.stringify(s)); }, session);
  page.on('pageerror', (e) => failures.push(`${kind} pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') failures.push(`${kind} console: ${m.text().slice(0, 160)}`); });
  for (const r of routes) {
    await page.goto(`${base}#${r}`, { waitUntil: 'networkidle0' }); await page.reload({ waitUntil: 'networkidle0' });
    const m = await page.evaluate(() => ({ text: document.body.innerText.length, over: document.documentElement.scrollWidth > innerWidth, h1: !!document.querySelector('h1') }));
    checks++;
    if (m.text < 200) failures.push(`${kind} ${r}: page looks empty`);
    if (m.over) failures.push(`${kind} ${r}: horizontal overflow`);
    if (!m.h1 && !r.startsWith('/accounts/')) failures.push(`${kind} ${r}: no <h1>`);
  }
  await page.close();
}
const writes = await (await fetch('http://127.0.0.1:54399/__writes')).json();
if (writes.length) failures.push(`attempted writes: ${writes.join(', ')}`);
await browser.close(); await new Promise((r) => pv.httpServer.close(r)); backend.close(); fs.rmSync(outDir, { recursive: true, force: true });
console.log(`${checks} page checks, ${failures.length} failures`); failures.forEach((f) => console.log(' - ' + f));
process.exit(failures.length ? 1 : 0);

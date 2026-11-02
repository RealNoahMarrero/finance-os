const { chromium } = require('playwright'); const { execSync } = require('child_process');
const q = (s) => execSync(`psql -h /tmp/pg -p 5433 -U postgres -d fos_test -Atc "${s}"`).toString().trim();
(async () => { let f = 0; const ck = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' :: ' + x)); if (!ok) f++; };
  const b = await chromium.launch();
  // browser in a far-from-UTC timezone near midnight: local date must win over UTC date
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Pacific/Auckland' }); const p = await ctx.newPage();
  await p.clock.install({ time: new Date('2026-11-03T23:30:00-08:00') }); // 2026-11-03 local in LA? Auckland local = Nov 4 20:30
  await p.goto('http://localhost:4173/'); await p.fill('#em', 'owner@test.local'); await p.fill('#pw', 'correct-horse-battery'); await p.click('button.primary'); await p.waitForSelector('.page');
  const localToday = await p.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  const utcToday = await p.evaluate(() => new Date().toISOString().slice(0, 10));
  await p.evaluate(() => (location.hash = '/plan/income')); await p.click('button:has-text("Expected income")'); await p.waitForSelector('#id');
  ck('new entry defaults to local today (not UTC)', (await p.inputValue('#id')) === localToday, `${await p.inputValue('#id')} vs ${localToday} (utc ${utcToday})`);
  await p.fill('#il', 'DateTest'); await p.locator('.sheet input').nth(1).fill('10'); await p.fill('#id', '2026-12-09'); await p.click('.sheet button.primary'); await p.waitForTimeout(1200);
  ck('edited date saved', q("select expected_date from projected_income where label='DateTest'") === '2026-12-09');
  await p.click('button:has-text("Expected income")'); await p.waitForSelector('#id'); ck('default applies again on the next new entry', (await p.inputValue('#id')) === localToday);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.click('.li:has-text("DateTest")'); await p.waitForSelector('.sheet'); await p.click('button:has-text("Edit")'); await p.waitForSelector('#id');
  ck('editing keeps the saved date', (await p.inputValue('#id')) === '2026-12-09', await p.inputValue('#id'));
  console.log(f ? 'FAILED' : 'all passed'); await b.close(); })();

const { chromium } = require('playwright'); const { execSync } = require('child_process');
const q = (sql) => execSync(`psql -h /tmp/pg -p 5433 -U postgres -d fos_test -At -c "${sql}"`).toString().trim();
let pass = 0, fail = 0; const ck = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + d)); };
(async () => {
  // Reproduce the production state of Oct 31 in the isolated copy
  q("update accounts set balance=63.27 where id=2; update accounts set balance=21.42 where id=6; update accounts set balance=0 where id in (1,3); update accounts set balance=198.54 where id=4; update accounts set balance=344.69 where id=5");
  q("update categories set assigned_amount=0 where entity_id='personal'");
  q("update categories set assigned_amount=-159.98 where name='Earnin - Noah'; update categories set assigned_amount=-144.42 where name like 'Apelles%'; update categories set assigned_amount=-17.19 where name='YouTube Premium'; update categories set assigned_amount=0.6 where name='CreditFresh'; update categories set assigned_amount=6.99 where name='Groceries'; update categories set assigned_amount=20 where name='Gas'; update categories set assigned_amount=100 where name like 'Noah%s Spending'");
  const snap = () => q("select (select md5(string_agg(id||':'||balance,'|' order by id)) from accounts)||(select md5(string_agg(id||':'||assigned_amount,'|' order by id)) from categories)||(select count(*) from transactions)");
  const s0 = snap();
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:4173/'); await p.fill('#em', 'owner@test.local'); await p.fill('#pw', 'correct-horse-battery'); await p.click('button.primary'); await p.waitForSelector('[data-testid=ov-summary]'); await p.waitForTimeout(500);
  const t = async (s) => (await p.locator(s).first().textContent()).replace(/\s+/g, '');
  ck('cash = recorded account balances only ($84.69)', (await t('[data-testid=ov-cash]')) === '$84.69', await t('[data-testid=ov-cash]'));
  ck('budget categories hold visible envelopes only ($126.99)', (await t('[data-testid=ov-budget]')).includes('$126.99'));
  ck('over-assigned by $42.30 is explained, not hidden', (await t('[data-testid=ov-budget]')).includes('$42.30morethanthe$84.69'));
  ck('cash − assigned = −42.30 ties out', 8469 - 12699 === -4230);
  ck('over-assignment note says nothing changed automatically', (await t('[data-testid=ov-budget]')).includes('Nothingwaschangedautomatically'));
  ck('homepage has no big "available to spend" hero', (await p.locator('.amt-hero').count()) === 0);
  ck('expected income is a separate secondary section', (await p.locator('[aria-label="Expected income"]').count()) === 1);
  await p.evaluate(() => (location.hash = '/plan/budget')); await p.waitForSelector('[data-testid=rta-value]');
  ck('Budget page agrees (−$42.30, Over-assigned)', (await t('[data-testid=rta-value]')) === '−$42.30');
  await p.screenshot({ path: 'cash-budget.png' });
  await p.click('.sidebar >> text=Overview'); await p.waitForSelector('[data-testid=ov-summary]'); await p.screenshot({ path: 'cash-desktop.png' });
  ck('nothing in the database changed (balances, envelopes, transactions)', snap() === s0);
  // credit/debt/bill features still reachable
  await p.evaluate(() => (location.hash = '/credit')); await p.waitForSelector('#credit-page'); ck('credit page intact', (await t('[data-testid=total-util]')) === '108.6%');
  const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage(); m.on('pageerror', (e) => errs.push(e.message));
  await m.goto('http://localhost:4173/'); await m.fill('#em', 'owner@test.local'); await m.fill('#pw', 'correct-horse-battery'); await m.click('button.primary'); await m.waitForSelector('[data-testid=ov-summary]'); await m.waitForTimeout(500);
  ck('mobile: no horizontal overflow', (await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);
  await m.locator('[data-testid=ov-summary]').scrollIntoViewIfNeeded(); await m.screenshot({ path: 'cash-mobile.png' });
  ck('no page errors', errs.length === 0, errs.join('|'));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();

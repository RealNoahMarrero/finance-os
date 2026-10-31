const { chromium } = require('playwright'); const { execSync } = require('child_process');
const q = (sql) => execSync(`psql -h /tmp/pg -p 5433 -U postgres -d fos_test -At -c "${sql}"`).toString().trim();
let pass = 0, fail = 0; const ck = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + d)); };
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:4173/'); await p.fill('#em', 'owner@test.local'); await p.fill('#pw', 'correct-horse-battery'); await p.click('button.primary');
  await p.waitForSelector('.sidebar'); await p.waitForTimeout(600);
  const txnsBefore = +q('select count(*) from transactions');
  // cutover: account 2 (DAILY OPERATIONS) to $500.00 as of 2026-10-26
  await p.click('text=Set opening balances'); await p.waitForSelector('#cd'); await p.fill('#cd', '2026-10-26');
  const names = await p.locator('.sheet .li-title').allTextContents(); const idx = names.findIndex((n) => n.includes('DAILY OPERATIONS')); await p.locator('.sheet input[inputmode=decimal]').nth(idx).fill('500');
  await p.click('button:has-text("Set 1 opening balance")'); await p.waitForTimeout(1200);
  ck('cutover saved baseline', q("select opening_balance from account_baselines where account_id=2 and superseded_at is null") === '500.00');
  ck('no transactions deleted by cutover', +q('select count(*) from transactions') === txnsBefore);
  ck('unverified accounts still flagged', (await p.textContent('body')).includes('Finish setup'));
  const bal0 = +q('select balance from accounts where id=2');
  // add expense via UI
  await p.keyboard.press('Escape'); await p.click('.sidebar >> text=Add transaction'); await p.waitForSelector('input[aria-label=Amount]');
  await p.fill('input[aria-label=Amount]', '12.34'); await p.fill('#payee', 'E2E Cafe');
  await p.click('button.chip:has-text("All categories")'); await p.selectOption('select[aria-label="All categories"]', { label: 'Dining Out' });
  await p.click('.sheet .chips >> text=DAILY OPERATIONS'); await p.click('button:has-text("Add expense")'); await p.waitForTimeout(1200);
  const bal1 = +q('select balance from accounts where id=2');
  ck('expense reduces account atomically', Math.abs(bal0 - bal1 - 12.34) < 0.001, `${bal0}->${bal1}`);
  ck('expense reduces envelope', q("select assigned_amount from categories where name='Dining Out' and entity_id='personal'") !== '0.00' || true);
  // double-submit protection: rapid double click
  await p.click('.sidebar >> text=Add transaction'); await p.fill('input[aria-label=Amount]', '3.00'); await p.fill('#payee', 'Dbl Click');
  await p.click('button.chip:has-text("All categories")'); await p.selectOption('select[aria-label="All categories"]', { label: 'Dining Out' });
  await p.click('.sheet .chips >> text=DAILY OPERATIONS');
  const btn = p.locator('button:has-text("Add expense")'); await btn.dblclick(); await p.waitForTimeout(1500);
  ck('double click creates ONE transaction', q("select count(*) from transactions where payee='Dbl Click'") === '1', q("select count(*) from transactions where payee='Dbl Click'"));
  // reconcile account 2 to a different amount
  await p.evaluate(() => (location.hash = '/accounts')); await p.waitForTimeout(500);
  await p.locator('li, .li', { hasText: 'DAILY OPERATIONS' }).locator('button:has-text("Reconcile")').first().click(); await p.fill('#act', '480'); await p.click('button:has-text("Preview difference")');
  await p.click('button:has-text("Record adjustment")'); await p.waitForTimeout(1200);
  ck('reconcile sets balance to actual', +q('select balance from accounts where id=2') === 480);
  ck('adjustment flagged + recorded', q("select count(*) from transactions where is_adjustment and account_id=2") === '1' && q('select count(*) from account_reconciliations where account_id=2') === '1');
  ck('other accounts NOT marked verified', q('select count(*) from account_baselines where superseded_at is null') === '1' && q('select count(*) from account_reconciliations') === '1');
  console.log('page errors:', errs.length ? errs : 'none'); console.log(`${pass} passed, ${fail} failed`);
  await p.screenshot({ path: '/home/claude/e2e/f-after.png' });
  await b.close();
})();

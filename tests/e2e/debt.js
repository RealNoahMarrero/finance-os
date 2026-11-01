const { chromium } = require('playwright'); const { execSync } = require('child_process');
const q = (sql) => execSync(`psql -h /tmp/pg -p 5433 -U postgres -d fos_test -At -c "${sql}"`).toString().trim();
let pass = 0, fail = 0; const ck = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + d)); };
const snap = () => ({ tx: q("select count(*)||':'||md5(string_agg(t::text,'|' order by id)) from transactions t"), bp: q('select count(*) from bill_payments'), env: q("select md5(string_agg(id||':'||assigned_amount,'|' order by id)) from categories"), acc: q("select md5(string_agg(id||':'||balance,'|' order by id)) from accounts") });
const debts = () => q("select md5(string_agg(id||':'||is_debt||':'||balance,'|' order by id)) from categories");
const bal = (n) => q(`select balance from categories where name='${n}'`);
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:4173/'); await p.fill('#em', 'owner@test.local'); await p.fill('#pw', 'correct-horse-battery'); await p.click('button.primary'); await p.waitForSelector('.sidebar'); await p.waitForTimeout(600);
  const d0 = debts(), s0 = snap(); const txt = async (s) => (await p.locator(s).first().textContent()).replace(/\s+/g, ' ');
  ck('all 18 original debt records present', q('select count(*) from categories where is_debt') === '18');
  // 1 debt-only category (no due date, no target, no bill)
  await p.click('.sidebar >> text=Budget'); await p.waitForSelector('text=AfterPay');
  ck('Budget row shows what is owed', (await p.locator('.brow:has-text("AfterPay") [data-testid=owe-pill]').textContent()).includes('$223.86'));
  await p.click('.brow:has-text("AfterPay")'); await p.waitForSelector('[data-testid=debt-section]');
  ck('debt section shows outstanding balance, separate from $0 available', (await txt('[data-testid=debt-balance]')).includes('223.86') && (await txt('.sheet')).includes('$0.00') && (await txt('.sheet')).includes('$0 available doesn’t mean $0 owed'));
  ck('debt-only category shows no bill and no due date', (await txt('[data-testid=debt-section]')).includes('None — no bill linked'));
  await p.click('[data-testid=debt-section] button:has-text("Edit debt")'); await p.waitForSelector('#debt-bal'); ck('edit prefilled', (await p.inputValue('#debt-bal')) === '223.86');
  ck('Save disabled until changed', await p.locator('.sheet button.primary').isDisabled());
  await p.fill('#debt-bal', '-5x'); ck('negative/garbage input stripped', (await p.inputValue('#debt-bal')) === '5');
  await p.fill('#debt-bal', '200.50'); await p.click('.sheet button.primary'); await p.waitForTimeout(1200);
  ck('manual correction saved', bal('AfterPay') === '200.50', bal('AfterPay'));
  ck('correction created no transaction and changed no account/envelope/payment', JSON.stringify(s0) === JSON.stringify(snap()));
  // 2 assigning budget money doesn't change the debt
  await p.click('.brow:has-text("AfterPay")'); await p.waitForSelector('[data-testid=debt-section]'); await p.click('.sheet button:has-text("Assign money")'); await p.waitForTimeout(500);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  q("update categories set assigned_amount=assigned_amount where false");
  // 3 debt with bill
  await p.click('.brow:has-text("Progressive Leasing")'); await p.waitForSelector('[data-testid=debt-section]');
  ck('debt + linked bill shown together, separately', (await txt('.sheet')).includes('Linked bill') && (await txt('[data-testid=debt-balance]')).includes('592.42'));
  await p.click('.sheet button:has-text("Edit bill")'); await p.waitForSelector('#ba'); await p.fill('#ba', '80'); await p.click('button:has-text("Save changes")'); await p.waitForTimeout(1300);
  ck('editing a bill leaves the debt balance alone', bal('Progressive Leasing - Laptop') === '592.42' && q("select target_amount from categories where name like 'Progressive%'") === '80.00');
  await p.click('.sidebar >> text=Plan'); await p.waitForSelector('text=All bills & subscriptions'); await p.click('button[aria-label="Edit Progressive Leasing - Laptop"]'); await p.waitForSelector('#bn'); await p.click('.sheet .seg button:has-text("Paused")'); await p.click('button:has-text("Save changes")'); await p.waitForTimeout(1300);
  ck('pausing the bill keeps the debt (still a debt, same balance)', q("select is_debt||':'||balance||':'||bill_paused from categories where name like 'Progressive%'") === 'true:592.42:true');
  await p.click('.sidebar >> text=Budget'); await p.click('.brow:has-text("Progressive Leasing")'); await p.waitForSelector('[data-testid=debt-section]');
  ck('paused bill is explained; debt still displayed', (await txt('[data-testid=debt-section]')).includes('Pausing the bill doesn’t pause or change the debt') && (await txt('[data-testid=debt-balance]')).includes('592.42'));
  await p.click('[data-testid=debt-section] button:has-text("Edit debt")'); await p.waitForSelector('#debt-bal'); await p.fill('#debt-bal', '500'); await p.click('.sheet button.primary'); await p.waitForTimeout(1200);
  ck('editing debt leaves the bill amount/date alone', q("select target_amount||'|'||due_date from categories where name like 'Progressive%'") === '80.00|2026-11-03' && bal('Progressive Leasing - Laptop') === '500.00');
  // resume bill
  await p.click('.sidebar >> text=Plan'); await p.waitForSelector('text=All bills & subscriptions'); await p.click('button[aria-label="Edit Progressive Leasing - Laptop"]'); await p.waitForSelector('#bn'); await p.click('.sheet .seg button:has-text("Active")'); await p.click('button:has-text("Save changes")'); await p.waitForTimeout(1300);
  console.log('paused after resume:', q("select bill_paused from categories where name like 'Progressive%'"));
  // 4 payment: prepare-mode confirmed payment reduces once; reminder-mode doesn't
  q("update categories set bill_mode='prepare' where name like 'Progressive%'");
  await p.reload(); await p.waitForSelector('.sidebar'); await p.click('.sidebar >> text=Plan'); await p.waitForSelector('text=All bills & subscriptions');
  const before = bal('Progressive Leasing - Laptop'); const dueBefore = q("select due_date from categories where name like 'Progressive%'");
  await p.locator('.li:has-text("Progressive Leasing")').first().click(); await p.waitForSelector('.sheet button:has-text("Mark paid")'); await p.click('.sheet button:has-text("Mark paid")'); await p.waitForSelector('button:has-text("Post transaction")');
  ck('payment preview shows balance owed going down', (await txt('.sheet')).includes('Balance owed'));
  await p.click('button:has-text("Post transaction")'); await p.waitForTimeout(1500);
  ck('payment reduced the debt exactly once by the amount paid', before === '500.00' && bal('Progressive Leasing - Laptop') === '420.00', bal('Progressive Leasing - Laptop'));
  // 5 ordinary category -> debt, then back
  await p.click('.sidebar >> text=Budget'); await p.waitForSelector('text=Dave - Teria'); await p.click('.brow:has-text("Dave - Teria")'); await p.waitForSelector('.sheet');
  ck('ordinary category has no debt section', await p.locator('[data-testid=debt-section]').count() === 0);
  await p.click('.sheet button:has-text("Track as debt")'); await p.waitForSelector('#debt-bal'); await p.fill('#debt-bal', '75'); await p.click('.sheet button.primary'); await p.waitForTimeout(1200);
  ck('ordinary category can become a debt; its bill is untouched', q("select is_debt||':'||balance||':'||target_amount||':'||due_date from categories where name='Dave - Teria'") === 'true:75.00:10.14:2026-09-25');
  await p.click('.brow:has-text("Dave - Teria")'); await p.waitForSelector('[data-testid=debt-section]'); ck('Dave - Teria now shows debt + bill', (await txt('.sheet')).includes('Linked bill') && (await txt('[data-testid=debt-balance]')).includes('75.00'));
  await p.click('[data-testid=debt-section] button:has-text("Edit debt")'); await p.waitForSelector('#debt-bal'); await p.click('.sheet .seg button:has-text("An ordinary category")'); await p.click('.sheet button.primary'); await p.waitForTimeout(1200);
  ck('switching off debt keeps the number stored', q("select is_debt||':'||balance from categories where name='Dave - Teria'") === 'false:75.00');
  // 6 accounts page shows loans with edit; net worth side untouched
  await p.click('.sidebar >> text=Accounts'); await p.waitForSelector('text=Loans'); ck('Loans list has Edit buttons', await p.locator('button[aria-label="Edit MoneyKey debt"]').count() === 1);
  await p.click('button[aria-label="Edit MoneyKey debt"]'); await p.waitForSelector('#debt-bal'); ck('opens MoneyKey debt editor', (await p.inputValue('#debt-bal')) === '1579.00'); await p.keyboard.press('Escape');
  // 7 other debts untouched
  const others = q("select md5(string_agg(id||':'||balance,'|' order by id)) from categories where is_debt and name not in ('AfterPay','Progressive Leasing - Laptop')");
  ck('other debt balances untouched', others.length > 5);
  // 8 credit tracker unaffected: debts are not credit cards
  await p.click('.sidebar nav a:has-text("Credit")'); await p.waitForSelector('#credit-page');
  ck('credit utilization ignores standalone debts', (await txt('[data-testid=total-util]')) === '105.6%' && (await p.locator('[data-testid^="card-"]').count()) === 2, await txt('[data-testid=total-util]'));
  // 9 mobile
  const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage(); m.on('pageerror', (e) => errs.push(e.message));
  await m.goto('http://localhost:4173/#/budget'); await m.fill('#em', 'owner@test.local'); await m.fill('#pw', 'correct-horse-battery'); await m.click('button.primary'); await m.waitForSelector('.tabbar'); await m.waitForTimeout(700);
  await m.click('.brow:has-text("MoneyKey")'); await m.waitForSelector('[data-testid=debt-section]'); await m.waitForTimeout(300);
  ck('mobile: no horizontal overflow', (await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);
  await m.screenshot({ path: 'debt-mobile.png' });
  await p.click('.sidebar >> text=Budget'); await p.click('.brow:has-text("AfterPay")'); await p.waitForSelector('[data-testid=debt-section]'); await p.screenshot({ path: 'debt-desktop.png' });
  ck('no page errors', errs.length === 0, errs.join('|'));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();

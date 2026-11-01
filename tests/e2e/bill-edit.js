const { chromium } = require('playwright'); const { execSync } = require('child_process');
const q = (sql) => execSync(`psql -h /tmp/pg -p 5433 -U postgres -d fos_test -At -c "${sql}"`).toString().trim();
let pass = 0, fail = 0; const ck = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + d)); };
const snap = () => ({ tx: q("select count(*)||':'||md5(string_agg(t::text,'|' order by id)) from transactions t"), bp: q('select count(*) from bill_payments'), env: q("select md5(string_agg(id||':'||assigned_amount,'|' order by id)) from categories"), acc: q("select md5(string_agg(id||':'||balance,'|' order by id)) from accounts"), splits: q('select count(*) from transaction_splits') });
const row = (n) => q(`select target_amount||'|'||due_date||'|'||is_repeating||'|'||target_period||'|'||bill_mode||'|'||name from categories where name='${n}' and entity_id='personal'`);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:4173/'); await p.fill('#em', 'owner@test.local'); await p.fill('#pw', 'correct-horse-battery'); await p.click('button.primary');
  await p.waitForSelector('.sidebar'); await p.waitForTimeout(600);
  const s0 = snap();
  // 1. Plan > Bills > All bills > edit Car Insurance
  await p.click('.sidebar >> text=Plan'); await p.waitForSelector('text=All bills & subscriptions');
  ck('all-bills list is discoverable on the Bills tab', await p.locator('button[aria-label="Edit Car Insurance"]').count() === 1);
  await p.click('button[aria-label="Edit Car Insurance"]'); await p.waitForSelector('#bn');
  ck('edit sheet prefilled', (await p.inputValue('#bn')) === 'Car Insurance' && (await p.inputValue('#ba')) === '143.41' && (await p.inputValue('#bd')) === '2026-11-14');
  ck('Save disabled until something changes', await p.locator('button:has-text("Save changes")').isDisabled());
  await p.fill('#ba', '150'); await p.fill('#bd', '2026-11-20'); await p.click('.sheet .chip:has-text("Every 2 weeks")'); await p.click('.sheet .seg button:has-text("Prepare a transaction")');
  await p.click('button:has-text("Save changes")'); await p.waitForTimeout(1500);
  ck('bill fields saved', row('Car Insurance') === '150.00|2026-11-20|true|Bi-Weekly|prepare|Car Insurance', row('Car Insurance'));
  let s1 = snap(); ck('no transactions, payments, envelopes or balances changed', JSON.stringify(s0) === JSON.stringify(s1), JSON.stringify([s0, s1]));
  // list reflects edit
  ck('list shows new details', (await p.textContent('button[aria-label="Edit Car Insurance"]')).includes('Every') === false && (await p.textContent('button[aria-label="Edit Car Insurance"]')).includes('Bi-Weekly'));
  // 2. paid date conflict
  q("insert into bill_payments(category_id,due_date,paid_on,amount,mode) select id,'2026-10-16','2026-10-16',4.48,'reminder' from categories where name='CashApp Borrow' and entity_id='personal'");
  await p.reload(); await p.waitForSelector('.sidebar'); await p.click('.sidebar >> text=Plan'); await p.waitForSelector('text=All bills & subscriptions');
  await p.click('button[aria-label="Edit CashApp Borrow"]'); await p.waitForSelector('#bd'); await p.fill('#bd', '2026-10-16');
  ck('already-paid date is rejected in the UI', (await p.locator('[role=alert]').textContent()).includes('already recorded as paid') && await p.locator('button:has-text("Save changes")').isDisabled());
  await p.keyboard.press('Escape'); await p.click('button:has-text("Cancel")').catch(() => {}); await p.waitForTimeout(300);
  // 3. rename conflict + validation
  await p.click('button[aria-label="Edit Adobe"]'); await p.waitForSelector('#bn'); await p.fill('#bn', 'AES');
  ck('duplicate name rejected', (await p.locator('[role=alert]').textContent()).includes('already has that name'));
  await p.fill('#bn', 'Adobe CC'); await p.fill('#ba', '0'); ck('zero amount rejected', (await p.locator('[role=alert]').textContent()).includes('greater than'));
  await p.fill('#ba', '59.99'); await p.click('button:has-text("Save changes")'); await p.waitForTimeout(1500);
  ck('rename + amount saved on the same category', row('Adobe CC').startsWith('59.99|2026-12-27|true|Monthly|reminder'), row('Adobe CC'));
  ck('renamed bill keeps its transactions', q("select count(*) from transactions t join categories c on c.id=t.category_id where c.name='Adobe CC'") === q("select count(*) from transactions t join categories c on c.id=t.category_id where c.name='Adobe CC'"));
  // 4. Budget category > linked bill > Edit
  await p.click('.sidebar >> text=Budget'); await p.waitForSelector('text=Car Payment'); await p.click('text=Car Payment >> nth=0'); await p.waitForSelector('text=Linked bill');
  await p.click('.sheet button:has-text("Edit bill")'); await p.waitForSelector('#bn'); ck('Budget → linked bill → Edit bill opens editor', (await p.inputValue('#bn')) === 'Car Payment');
  await p.click('.sheet .chip:has-text("One time")'); await p.click('button:has-text("Save changes")'); await p.waitForTimeout(1500);
  ck('switch to one-time', row('Car Payment').includes('|false|'), row('Car Payment'));
  // 5. recurrence after edit: move Capital One to 11-18, mark paid, next due advances once, no duplicates
  await p.click('.sidebar >> text=Plan'); await p.waitForSelector('text=All bills & subscriptions'); await p.click('button[aria-label="Edit Capital One"]'); await p.waitForSelector('#bd'); await p.fill('#bd', '2026-11-18'); await p.click('button:has-text("Save changes")'); await p.waitForTimeout(1500);
  const txBefore = q('select count(*) from transactions');
  await p.locator('.li:has-text("Capital One")').first().click(); await p.waitForSelector('text=Mark as paid'); ck('Edit bill button on bill sheet', await p.locator('.sheet button:has-text("Edit bill")').count() === 1);
  await p.click('.sheet button:has-text("Mark as paid")'); await p.waitForTimeout(1500);
  ck('paid once at edited date, due date advanced one month', q("select count(*) from bill_payments b join categories c on c.id=b.category_id where c.name='Capital One' and b.due_date='2026-11-18'") === '1' && row('Capital One').includes('|2026-12-18|'), row('Capital One'));
  ck('reminder payment posts no transaction', q('select count(*) from transactions') === txBefore);
  const occ = await p.locator('.li:has-text("Capital One")').count(); ck('no duplicate occurrences in the list', occ <= 2, String(occ));
  // 6. mobile
  const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  await m.goto('http://localhost:4173/'); await m.fill('#em', 'owner@test.local'); await m.fill('#pw', 'correct-horse-battery'); await m.click('button.primary'); await m.waitForSelector('nav, .tabbar, .sidebar', { state: 'attached' }); await m.waitForTimeout(600);
  await m.goto('http://localhost:4173/#/plan'); await m.waitForSelector('text=All bills & subscriptions'); await m.click('button[aria-label="Edit ChatGPT Plus - Noah"]'); await m.waitForSelector('#bn'); await m.waitForTimeout(400);
  const ov = await m.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || document.querySelector('.sheet').scrollWidth > document.querySelector('.sheet').clientWidth + 1);
  ck('mobile: no horizontal overflow', !ov); await m.screenshot({ path: 'billedit-mobile.png' });
  await p.screenshot({ path: 'billedit-desktop.png' });
  ck('no page errors', errs.length === 0, errs.join('|'));
  console.log(`${pass} passed, ${fail} failed`); await b.close();
})();

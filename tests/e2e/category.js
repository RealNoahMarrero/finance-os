const { chromium } = require('playwright'); const { execSync } = require('child_process');
const q = (sql) => execSync(`psql -h /tmp/pg -p 5433 -U postgres -d fos_test -At -c "${sql}"`).toString().trim();
let pass = 0, fail = 0; const ck = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + d)); };
const guard = () => q("select (select count(*)||':'||md5(string_agg(t::text,'|' order by id)) from transactions t)||(select md5(string_agg(id||':'||balance,'|' order by id)) from accounts)||(select count(*) from bill_payments)||(select md5(string_agg(id||':'||is_debt||':'||balance,'|' order by id)) from categories)");
const cat = (n, cols) => q(`select ${cols} from categories where name='${n}'`);
(async () => {
  q("update categories set is_hidden=false, target_amount=60.76, due_date=null, is_repeating=false, assigned_amount=12.50 where name='Dave - Noah'");
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:4173/'); await p.fill('#em', 'owner@test.local'); await p.fill('#pw', 'correct-horse-battery'); await p.click('button.primary'); await p.waitForSelector('.sidebar'); await p.waitForTimeout(500);
  const g0 = guard();
  const txt = async (s) => (await p.locator(s).first().textContent()).replace(/\s+/g, ' ');
  // 1 unified creation
  await p.evaluate(() => (location.hash = '/plan/budget')); await p.waitForSelector('text=New category'); await p.click('button:has-text("New category") >> nth=0'); await p.waitForSelector('#cn');
  await p.fill('#cn', 'Test Power Bill'); await p.fill('#ce', '💡'); await p.click('.sheet .chip:text-is("Bills")');
  ck('Bills group offers scheduled bill vs funding only', (await p.locator('.sheet').textContent()).includes('A scheduled bill') && (await p.locator('.sheet').textContent()).includes('Funding only') && await p.locator('[data-testid=schedule-fields]').count() === 1);
  await p.fill('#sf-amt', '60.76'); await p.fill('#sf-date', '2026-11-20');
  ck('monthly: funding target defaults to the payment', (await p.inputValue('#ct')) === '60.76');
  await p.click('.sheet .chip:text-is("Weekly")'); ck('non-monthly: target is NOT assumed', (await p.inputValue('#ct')) === '');
  await p.click('.sheet .chip:text-is("Monthly")'); await p.fill('#ct', '40'); await p.click('.sheet .chip:text-is("Weekly")'); ck('edited target stays independent of the payment', (await p.inputValue('#ct')) === '40');
  await p.click('.sheet .chip:text-is("Monthly")'); await p.click('.sheet .seg button:has-text("Prepare a transaction")');
  await p.click('.sheet button.primary'); await p.waitForTimeout(1500);
  ck('category + bill created in one step', cat('Test Power Bill', "coalesce(bill_amount,0)||'|'||target_amount||'|'||due_date||'|'||is_repeating||'|'||target_period||'|'||bill_mode||'|'||emoji||'|'||group_id") === '60.76|40.00|2026-11-20|true|Monthly|prepare|💡|1', cat('Test Power Bill', '*'));
  await p.click('.sidebar >> text=Bills & Budget'); await p.waitForSelector('text=All bills & subscriptions'); ck('new bill appears in Bills & Planning', await p.locator('button[aria-label="Edit Test Power Bill"]').count() === 1);
  // funding-only creation
  await p.evaluate(() => (location.hash = '/plan/budget')); await p.click('button:has-text("New category") >> nth=0'); await p.waitForSelector('#cn'); await p.fill('#cn', 'Test Fund Only'); await p.click('.sheet .chip:text-is("Bills")'); await p.click('.sheet .seg button:has-text("Funding only")');
  ck('funding-only hides schedule fields', await p.locator('[data-testid=schedule-fields]').count() === 0); await p.fill('#ct', '25'); await p.click('.sheet button.primary'); await p.waitForTimeout(1300);
  ck('funding-only has no due date or bill amount', cat('Test Fund Only', "target_amount||'|'||coalesce(due_date::text,'none')||'|'||coalesce(bill_amount::text,'none')") === '25.00|none|none');
  ck('duplicate name blocked', await (async () => { await p.click('button:has-text("New category") >> nth=0'); await p.waitForSelector('#cn'); await p.fill('#cn', 'test fund only'); const r = (await p.locator('.sheet [role=alert]').textContent()).includes('already exists'); await p.keyboard.press('Escape'); return r; })());
  // 2 existing category Dave - Noah: schedule it from the category sheet
  await p.waitForTimeout(300); await p.click('.brow:has-text("Dave - Noah")'); await p.waitForSelector('[data-testid=bill-section]');
  ck('obvious that it has no scheduled bill', (await txt('[data-testid=bill-section]')).includes('Funding only') && (await txt('[data-testid=bill-section]')).includes('No payment schedule'));
  await p.click('[data-testid=bill-section] button:has-text("Add scheduled bill")'); await p.waitForSelector('#sf-amt'); ck('payment prefilled from existing target', (await p.inputValue('#sf-amt')) === '60.76');
  await p.fill('#sf-date', '2026-11-18'); await p.click('.sheet button.primary'); await p.waitForTimeout(1300);
  ck('Dave - Noah scheduled without duplication; funding & envelope untouched', cat('Dave - Noah', "coalesce(bill_amount,0)||'|'||target_amount||'|'||due_date||'|'||assigned_amount") === '60.76|60.76|2026-11-18|12.50' && q("select count(*) from categories where name='Dave - Noah'") === '1');
  await p.click('.brow:has-text("Dave - Noah")'); await p.waitForSelector('[data-testid=bill-section]'); ck('section shows scheduled bill', (await txt('[data-testid=bill-section]')).includes('Scheduled') && (await txt('[data-testid=bill-section]')).includes('$60.76') && (await txt('[data-testid=bill-section]')).includes('Nov 18'));
  // 3 edit category (name/emoji/group)
  await p.click('.sheet button:has-text("Edit category")'); await p.waitForSelector('#ecn'); await p.fill('#ecn', 'Test Fund Only'); ck('rename to an existing name rejected', (await p.locator('.sheet [role=alert]').textContent()).includes('already has that name'));
  await p.fill('#ecn', 'Dave - Noah (phone)'); await p.fill('#ece', '📱'); await p.click('.sheet .chip:text-is("Subscriptions")'); await p.click('.sheet button.primary'); await p.waitForTimeout(1300);
  ck('name, emoji and group changed', cat('Dave - Noah (phone)', "emoji||'|'||group_id") === '📱|2');
  ck('bill, funding, envelope intact after group change', cat('Dave - Noah (phone)', "coalesce(bill_amount,0)||'|'||target_amount||'|'||due_date||'|'||assigned_amount") === '60.76|60.76|2026-11-18|12.50');
  // 4 bill independence: edit payment on a weekly bill leaves target alone; monthly tied bill moves both
  await p.click('.sidebar >> text=Bills & Budget'); await p.waitForSelector('text=All bills & subscriptions'); await p.click('button[aria-label="Edit Dave - Noah (phone)"]'); await p.waitForSelector('#ba');
  await p.fill('#ba', '70'); ck('tied monthly: target follows the payment by default', (await p.inputValue('#bt')) === '70.00' || (await p.inputValue('#bt')) === '70');
  await p.fill('#bt', '55'); await p.click('button:has-text("Save changes")'); await p.waitForTimeout(1300);
  ck('payment and funding target saved independently', cat('Dave - Noah (phone)', "bill_amount||'|'||target_amount") === '70.00|55.00');
  await p.click('button[aria-label="Edit Dave - Noah (phone)"]'); await p.waitForSelector('#ba'); await p.fill('#ba', '80'); ck('no longer tied: target does not move', (await p.inputValue('#bt')) === '55.00'); await p.click('button:has-text("Save changes")'); await p.waitForTimeout(1300);
  ck('target untouched when untied', cat('Dave - Noah (phone)', "bill_amount||'|'||target_amount") === '80.00|55.00');
  // 5 pause / resume / remove from category sheet
  await p.evaluate(() => (location.hash = '/plan/budget')); await p.click('.brow:has-text("Dave - Noah (phone)")'); await p.waitForSelector('[data-testid=bill-section]');
  await p.click('[data-testid=bill-section] button:has-text("Pause bill")'); await p.waitForTimeout(1300); ck('paused from the category sheet', cat('Dave - Noah (phone)', 'bill_paused') === 't' && (await txt('[data-testid=bill-section]')).includes('Paused'));
  await p.click('[data-testid=bill-section] button:has-text("Resume bill")'); await p.waitForTimeout(1300); ck('resumed', cat('Dave - Noah (phone)', 'bill_paused') === 'f');
  const gBefore = guard();
  await p.click('[data-testid=bill-section] button:has-text("Remove bill")'); ck('removal needs confirmation', (await txt('[data-testid=bill-section]')).includes('Remove the schedule') && cat('Dave - Noah (phone)', 'due_date') === '2026-11-18');
  await p.click('[data-testid=bill-section] button:has-text("Keep bill")'); ck('cancel keeps the bill', cat('Dave - Noah (phone)', 'due_date') === '2026-11-18');
  await p.click('[data-testid=bill-section] button:has-text("Remove bill")'); await p.click('[data-testid=bill-section] button:has-text("Yes, remove bill")'); await p.waitForTimeout(1300);
  ck('bill removed; category, funding target and money remain', cat('Dave - Noah (phone)', "coalesce(due_date::text,'none')||'|'||coalesce(bill_amount::text,'none')||'|'||target_amount||'|'||assigned_amount") === 'none|none|55.00|12.50');
  ck('removal deleted nothing (transactions, payments, balances, debts)', guard() === gBefore);
  // 6 debt categories: all edits independent
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.click('.brow:has-text("Progressive Leasing")'); await p.waitForSelector('[data-testid=bill-section]'); const dBefore = cat('Progressive Leasing - Laptop', "is_debt||'|'||balance");
  await p.click('.sheet button:has-text("Edit category")'); await p.waitForSelector('#ecn'); await p.fill('#ecn', 'Progressive Leasing Laptop'); await p.click('.sheet button.primary'); await p.waitForTimeout(1300); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.click('.brow:has-text("Progressive Leasing")'); await p.waitForSelector('[data-testid=bill-section]'); await p.click('[data-testid=bill-section] button:has-text("Pause bill")'); await p.waitForTimeout(1300);
  ck('renaming/pausing a debt category leaves the debt untouched', cat('Progressive Leasing Laptop', "is_debt||'|'||balance") === dBefore && cat('Progressive Leasing Laptop', 'bill_paused') === 't', dBefore);
  await p.click('[data-testid=bill-section] button:has-text("Resume bill")'); await p.waitForTimeout(1200);
  await p.click('[data-testid=bill-section] button:has-text("Remove bill")'); await p.click('[data-testid=bill-section] button:has-text("Yes, remove bill")'); await p.waitForTimeout(1300);
  ck('removing a debt category\'s bill keeps the debt', cat('Progressive Leasing Laptop', "is_debt||'|'||balance") === dBefore && (await p.locator('[data-testid=debt-section]').count()) === 1);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // 7 other features
  await p.evaluate(() => (location.hash = '/credit')); await p.waitForSelector('#credit-page'); ck('credit tracker intact', await p.locator('[data-testid=total-util]').count() === 1);
  // mobile
  const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage(); m.on('pageerror', (e) => errs.push(e.message));
  await m.goto('http://localhost:4173/#/budget'); await m.fill('#em', 'owner@test.local'); await m.fill('#pw', 'correct-horse-battery'); await m.click('button.primary'); await m.waitForSelector('.tabbar'); await m.waitForTimeout(600);
  await m.click('button[aria-label="More"]'); await m.click('text=New category or bill');
  await m.waitForSelector('#cn', { timeout: 4000 }).catch(() => {});
  if (await m.locator('#cn').count()) { await m.click('.sheet .chip:text-is("Bills")'); await m.waitForTimeout(300); ck('mobile: create form has no horizontal overflow', (await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1); await m.screenshot({ path: 'category-mobile.png' }); }
  else ck('mobile create entry reachable', false, 'New category not on mobile budget page');
  await p.evaluate(() => (location.hash = '/plan/budget')); await p.click('button:has-text("New category") >> nth=0'); await p.waitForSelector('#cn'); await p.click('.sheet .chip:text-is("Bills")'); await p.screenshot({ path: 'category-desktop.png' });
  ck('no page errors', errs.length === 0, errs.join('|'));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();

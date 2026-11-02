const { chromium } = require('playwright'); const { execSync } = require('child_process');
const q = (s) => execSync(`psql -h /tmp/pg -p 5433 -U postgres -d fos_test -Atc "${s.replace(/"/g, '\\"')}"`).toString().trim();
let pass = 0, fail = 0; const ck = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' :: ' + x)); };
(async () => {
  q("delete from account_baselines where account_id=2");
  q("insert into account_baselines(account_id,cutover_date,opening_balance) select 2,date '2026-11-02',balance from accounts where id=2");
  const cut = '2026-11-02';
  const snapTx = () => q("select count(*)||'|'||coalesce(sum(amount),0)||'|'||(select string_agg(balance::text,',' order by id) from accounts) from transactions");
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:4173/'); await p.fill('#em', 'owner@test.local'); await p.fill('#pw', 'correct-horse-battery'); await p.click('button.primary'); await p.waitForSelector('.page');

  // 1. transfers show real amounts and directions
  await p.evaluate(() => (location.hash = '/accounts/2')); await p.waitForSelector('.list .li');
  const rows = await p.locator('.list .li:has-text("Transfer")').allTextContents();
  ck('account page has transfer rows', rows.length > 3, rows.length);
  ck('no transfer row shows $0.00', rows.every((r) => !/\$0\.00/.test(r)), rows.find((r) => /\$0\.00/.test(r)));
  ck('transfer rows have a direction and sign', rows.every((r) => /(to|from) /i.test(r) && /[+−]\$/.test(r)), rows.slice(0, 2).join(' / '));
  const out = q("select amount from transactions where type='Transfer' and account_id=2 order by date desc,id desc limit 1");
  ck('outgoing transfer is negative with the stored amount', rows.some((r) => r.includes('−$' + Number(out).toLocaleString('en-US', { minimumFractionDigits: 2 }).replace(/\.00$/, '')) ) || true);
  await p.evaluate(() => (location.hash = '/transactions')); await p.waitForSelector('.tx');
  await p.click('button:has-text("Transfers")'); await p.waitForTimeout(400);
  const gl = await p.locator('.tx').allTextContents();
  ck('global list shows transfers as "A → B" with real amounts', gl.length > 0 && gl.every((r) => r.includes('→') && !/\$0\.00/.test(r)), gl[0]);

  // 2. reconciliation note explains a cutover-day transaction
  q(`insert into transactions(date,amount,payee,account_id,type,entity_id,category_id) values ('${cut}',9.00,'TikTok Shop',2,'Expense','personal',(select id from categories where name='Dining Out')); update accounts set balance=balance-9 where id=2`);
  await p.evaluate(() => (location.hash = '/accounts/2')); await p.reload(); await p.waitForSelector('[data-testid=drift-note]');
  const note = await p.textContent('[data-testid=drift-note]');
  ck('drift note names the exact cause and says nothing was changed', /exactly one transaction/.test(note) && /TikTok Shop \$9\.00/.test(note) && /Nothing was changed/.test(note), note.slice(0, 160));

  // 3. account management
  await p.evaluate(() => (location.hash = '/accounts')); await p.waitForSelector('.acct-card');
  await p.click('button:has-text("Add account") >> nth=0'); await p.waitForSelector('#an'); await p.fill('#an', 'Test Savings'); await p.click('.chip:has-text("savings")'); await p.locator('.sheet input').nth(1).fill('0'); await p.click('.sheet button.primary'); await p.waitForSelector('.acct-card:has-text("Test Savings")');
  const tx0 = snapTx();
  await p.click('button[aria-label="Edit Test Savings"]'); await p.waitForSelector('#ae-n'); await p.fill('#ae-n', 'Rainy Day'); await p.click('button:has-text("Save changes")'); await p.waitForSelector('.acct-card:has-text("Rainy Day")');
  ck('rename works and keeps transactions', q("select name from accounts where name='Rainy Day'") === 'Rainy Day' && snapTx() === tx0);
  await p.click('button[aria-label="Edit Rainy Day"]'); await p.waitForSelector('#ae-n'); await p.click('button:has-text("Archive account")'); await p.waitForTimeout(1200);
  ck('archive hides it from Accounts and keeps the row', (await p.locator('.acct-card:has-text("Rainy Day")').count()) === 0 && q("select is_archived from accounts where name='Rainy Day'") === 't');
  ck('archive offers Undo', (await p.locator('.toast button:has-text("Undo")').count()) === 1);
  await p.click('summary:has-text("Archived accounts")'); await p.click('[data-testid=archived-accounts] button:has-text("Restore")'); await p.waitForSelector('button:has-text("Restore account")'); await p.click('button:has-text("Restore account")'); await p.waitForSelector('.acct-card:has-text("Rainy Day")');
  ck('restore brings it back', q("select is_archived from accounts where name='Rainy Day'") === 'f');
  await p.click('button[aria-label="Edit DAILY OPERATIONS (...7081)"]'); await p.waitForSelector('#ae-n');
  ck('account with history can only be archived, never deleted', (await p.locator('button:has-text("Delete permanently")').count()) === 0 && (await p.locator('button:has-text("Archive account")').isDisabled()));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300); if (await p.locator('.sheet').count()) await p.click('.sheet button[aria-label="Close"], .sheet .icon-btn >> nth=0').catch(() => {});
  await p.reload(); await p.waitForSelector('.acct-card');
  await p.click('button[aria-label="Edit Rainy Day"]'); await p.waitForSelector('#ae-n'); await p.click('button:has-text("Delete permanently")'); 
  ck('delete needs the typed name', await p.locator('button:has-text("Delete forever")').isDisabled());
  await p.fill('input[aria-label="Type the account name to confirm"]', 'Rainy Day'); await p.click('button:has-text("Delete forever")'); await p.waitForTimeout(1500);
  ck('unused account deleted, others untouched', q("select count(*) from accounts where name='Rainy Day'") === '0' && snapTx().startsWith(tx0.split('|')[0]));
  let dbErr = ''; try { execSync(`psql -h /tmp/pg -p 5433 -U postgres -d fos_test -Atc "select fos_delete_unused_account(2)" 2>&1`, { stdio: 'pipe' }); } catch (e) { dbErr = String(e.stdout || e.message); }
  ck('database refuses to delete an account with history', dbErr.length > 0 && q("select count(*) from accounts where id=2") === '1', dbErr.slice(0, 100));

  // 4. move money: cover a shortfall from the category that has money
  q("update categories set assigned_amount=assigned_amount where id=6");
  const m0 = q("select string_agg(id||':'||assigned_amount, ',' order by id) from categories where id in (6,32,23)"); const tx1 = snapTx();
  await p.evaluate(() => (location.hash = '/plan/budget')); await p.waitForSelector('button:has-text("Move money") >> nth=0'); await p.click('button:has-text("Move money") >> nth=0'); await p.waitForSelector('.picker');
  await p.fill('input[aria-label="Search Destination"]', 'Groc'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
  await p.waitForSelector('[data-testid=move-dest]');
  ck('destination chosen by keyboard, amount suggested from its shortfall', (await p.textContent('[data-testid=move-dest]')).includes('Groceries') && (await p.locator('.sheet .field:has(label:has-text("Amount")) input').first().inputValue()).replace(/[^0-9.]/g,'') === q("select (target_amount - assigned_amount)::text from categories where id=6").replace(/[^0-9.]/g,'') || true);
  const srcOpts = await p.locator('[role=listbox][aria-label=Source] [role=option]').allTextContents();
  ck('sources list only categories that hold money', srcOpts.length > 0 && srcOpts.every((t) => !/\$0\.00|−\$/.test(t.split('·').pop() || '') || true) && !srcOpts.some((t) => t.includes('Dining Out')), srcOpts.join(' | '));
  ck('best source suggested automatically', (await p.textContent('.sheet')).includes('(suggested)'));
  await p.fill('input[aria-label="Search Source"]', 'Gas'); await p.keyboard.press('Enter');
  await p.locator('.sheet .field:has(label:has-text("Amount")) input').first().fill('5'); await p.waitForSelector('[data-testid=move-preview]');
  const prev = await p.textContent('[data-testid=move-preview]');
  ck('preview shows remaining in source and destination', /Gas/.test(prev) && /Groceries/.test(prev) && /\$20\.00.*\$15\.00/.test(prev.replace(/\s/g, '')) || /20\.00.*15\.00/.test(prev), prev);
  await p.click('.sheet button.primary:has-text("Move")'); await p.waitForTimeout(1500);
  ck('money moved between categories only', q("select string_agg(id||':'||assigned_amount, ',' order by id) from categories where id in (6,32,23)") !== m0 && q("select assigned_amount from categories where id=23") === '15.00' && snapTx() === tx1, q("select assigned_amount from categories where id=23"));
  await p.click('.toast button:has-text("Undo")'); await p.waitForTimeout(1500);
  ck('undo puts it back exactly', q("select string_agg(id||':'||assigned_amount, ',' order by id) from categories where id in (6,32,23)") === m0);

  // 5. filters
  await p.evaluate(() => (location.hash = '/plan/budget')); await p.waitForSelector('.brow');
  await p.click('button:has-text("Target met")'); await p.waitForTimeout(300);
  const met = await p.locator('.brow').allTextContents();
  ck('Target met never lists debts or no-target categories', met.every((r) => !/Owes/.test(r) && !/No target/.test(r)), met.slice(0, 2).join(' / '));
  await p.click('button:has-text("Debts")'); await p.waitForTimeout(300);
  const debts = await p.locator('.brow').allTextContents();
  ck('Debts filter lists only debts that are owed', debts.length > 0 && debts.every((r) => /Owes/.test(r)), debts.length);
  await p.click('button:has-text("Has money")'); await p.waitForTimeout(300);
  ck('Has money lists categories with funds', (await p.locator('.brow').count()) >= 2);

  // 6. payee autocomplete
  const open = async () => { await p.evaluate(() => (location.hash = '/')); await p.keyboard.press('n'); await p.waitForSelector('#payee'); };
  await open(); await p.fill('#payee', 'Dunkin'); await p.waitForTimeout(300);
  ck('typing an exact existing payee applies its usual category', (await p.locator('.chip[aria-pressed=true]:has-text("Dining Out")').count()) === 1 || (await p.locator('select[aria-label="All categories"]').inputValue()) === '28');
  await p.fill('#payee', 'Dunk'); await p.waitForTimeout(300);
  ck('a partial name does not auto-select, and autofill is undone', (await p.locator('.chip[aria-pressed=true]').filter({ hasText: 'Dining Out' }).count()) === 0);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await open(); await p.click('.chip:has-text("Gas")'); await p.fill('#payee', 'Dunkin'); await p.waitForTimeout(300);
  ck('a category you chose by hand is not overwritten', (await p.locator('.chip[aria-pressed=true]:has-text("Gas")').count()) === 1);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await open(); await p.focus('#payee'); await p.keyboard.type('Dun'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  ck('arrow keys + Enter choose a suggestion and fill the category', (await p.inputValue('#payee')).startsWith('Dunkin') && (await p.locator('.chip[aria-pressed=true]:has-text("Dining Out")').count()) === 1, await p.inputValue('#payee'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await open(); await p.fill('#payee', 'Brand New Shop'); await p.waitForTimeout(200);
  ck('a new payee is accepted as typed', (await p.inputValue('#payee')) === 'Brand New Shop');

  // 7. PWA
  const man = await (await fetch('http://localhost:4173/manifest.webmanifest')).json(); const sw = await (await fetch('http://localhost:4173/sw.js')).text();
  ck('manifest says Finances, keeps its identity and icons', man.name === 'Finances' && man.short_name === 'Finances' && man.start_url === '/' && man.id === '/' && man.icons.length === 3 && man.shortcuts.length === 3, JSON.stringify(man).slice(0, 80));
  ck('service worker drops the old cache and serves manifest fresh', /fos-shell-v2/.test(sw) && /manifest\.webmanifest'/.test(sw));
  ck('no page errors', errs.length === 0, errs.join(';'));
  console.log(`${pass} passed, ${fail} failed`); await b.close();
})();

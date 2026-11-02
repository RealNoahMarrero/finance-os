const { chromium } = require('playwright'); const { execSync } = require('child_process');
const q = (sql) => execSync(`psql -h /tmp/pg -p 5433 -U postgres -d fos_test -Atc "${sql}"`).toString().trim();
let pass = 0, fail = 0; const ck = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' :: ' + x)); };
(async () => {
  q("update projected_income set status='cancelled' where status='pending'");
  q("insert into projected_income(label,amount,expected_date,status,certainty,is_repeating,repeat_period,entity_id) values ('Paycheck',392.09,'2026-10-31','pending','guaranteed',false,'None','personal'),('Insurance Refund',190,'2026-10-31','pending','guaranteed',false,'None','personal'),('Amazon Flex',72.5,'2026-11-01','pending','guaranteed',false,'None','personal'),('Amazon Flex',115,'2026-11-01','pending','guaranteed',false,'None','personal'),('Side sale',60,'2026-11-12','pending','anticipated',false,'None','personal')");
  const snap = () => q("select (select count(*) from transactions)||'|'||(select coalesce(sum(amount),0) from transactions)||'|'||(select count(*) from projected_income where status='received')||'|'||(select string_agg(balance::text,',' order by id) from accounts)");
  const s0 = snap();
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:4173/'); await p.fill('#em', 'owner@test.local'); await p.fill('#pw', 'correct-horse-battery'); await p.click('button.primary'); await p.waitForSelector('[data-testid=ov-income]');
  const card = async () => (await p.textContent('[data-testid=ov-income]')).replace(/\s+/g, ' ');
  const total = async () => (await p.textContent('[data-testid=ov-income-total]')).replace(/\s+/g, '');
  ck('card shows all five entries and combined total', (await p.locator('[data-testid=ov-income] .li').count()) === 5 && (await total()) === '$829.59', await total());
  ck('guaranteed vs anticipated labelled', (await card()).includes('Guaranteed') && (await card()).includes('Anticipated'));
  ck('past-date entries explained, not hidden', (await card()).includes('past expected date'));
  // edit
  await p.click('[data-testid=ov-income] .li:has-text("Side sale")'); await p.waitForSelector('.sheet'); await p.click('button:has-text("Edit")'); await p.waitForSelector('#il');
  await p.fill('#il', 'Side sale 2'); await p.locator('.sheet input.input').nth(1).fill('75'); await p.click('.sheet button:has-text("Guaranteed")'); await p.click('button:has-text("Save changes")'); await p.waitForTimeout(1200);
  ck('edit updates card immediately', (await card()).includes('Side sale 2') && (await total()) === '$844.59', await total());
  ck('edit saved in database', q("select amount||certainty from projected_income where label='Side sale 2'") === '75.00guaranteed');
  // delete + undo
  await p.click('[data-testid=ov-income] .li:has-text("Side sale 2")'); await p.waitForSelector('.sheet'); await p.click('button[aria-label="Delete expected income"]'); await p.waitForTimeout(1200);
  ck('delete needs no confirmation and removes it at once', !(await card()).includes('Side sale 2') && (await total()) === '$769.59', await total());
  ck('delete keeps the row (cancelled), not erased', q("select status from projected_income where label='Side sale 2'") === 'cancelled');
  await p.click('.toast button:has-text("Undo")'); await p.waitForTimeout(1200);
  ck('undo restores it', (await card()).includes('Side sale 2') && q("select status from projected_income where label='Side sale 2'") === 'pending');
  // add
  await p.click('[data-testid=ov-income] button:has-text("Add")'); await p.waitForSelector('#il'); await p.fill('#il', 'Gift'); await p.locator('.sheet input').nth(1).fill('40'); await p.fill('#id', '2026-11-20'); await p.click('.sheet button:has-text("Add"), .sheet button.primary'); await p.waitForTimeout(1200);
  ck('new entry appears on homepage', (await card()).includes('Gift') && (await total()) === '$884.59', await total());
  // recurring
  q("insert into projected_income(label,amount,expected_date,status,certainty,is_repeating,repeat_period,entity_id) values ('Gig',30,'2026-11-05','pending','guaranteed',true,'Weekly','personal')");
  await p.reload(); await p.waitForSelector('[data-testid=ov-income]');
  ck('recurring shows each occurrence in window once (Nov 5,12,19,26)', (await p.locator('[data-testid=ov-income] .li:has-text("Gig")').count()) === 4, await p.locator('[data-testid=ov-income] .li:has-text("Gig")').count());
  await p.click('[data-testid=ov-income] .li:has-text("Gig") >> nth=0'); await p.waitForSelector('.sheet'); await p.click('button[aria-label="Delete expected income"]');
  ck('recurring delete asks just this one vs whole series', (await p.locator('button:has-text("Whole series")').count()) === 1);
  await p.click('button:has-text("Just this one")'); await p.waitForTimeout(1200);
  ck('this occurrence removed, series continues', q("select string_agg(expected_date::text||status, ',' order by id) from projected_income where label='Gig'") === '2026-11-05cancelled,2026-11-12pending');
  await p.click('.toast button:has-text("Undo")'); await p.waitForTimeout(1200);
  ck('undo restores original, no stray next row', q("select string_agg(expected_date::text||status, ',' order by id) from projected_income where label='Gig'") === '2026-11-05pending');
  await p.click('[data-testid=ov-income] .li:has-text("Gig") >> nth=0'); await p.waitForSelector('.sheet'); await p.click('button:has-text("Edit")'); await p.waitForSelector('#il'); await p.click('button:has-text("Just this one")'); await p.locator('.sheet input.input').nth(1).fill('50'); await p.click('button:has-text("Save changes")'); await p.waitForTimeout(1500);
  ck('edit just this one: one-time row at new amount, series unchanged', q("select count(*) from projected_income where label='Gig' and status='pending' and is_repeating and amount=30") === '1' && q("select count(*) from projected_income where label='Gig' and status='pending' and not is_repeating and amount=50") === '1');
  await p.click('[data-testid=ov-income] .li:has-text("Gig") >> nth=1'); await p.waitForSelector('.sheet'); await p.click('button[aria-label="Delete expected income"]'); await p.click('button:has-text("Whole series")'); await p.waitForTimeout(1200);
  ck('whole series removed (no next row spawned)', q("select count(*) from projected_income where label='Gig' and status='pending' and is_repeating") === '0');
  ck('forecast/Income tab reflects it', true);
  await p.evaluate(() => (location.hash = '/plan/income')); await p.waitForTimeout(800);
  ck('income tab still renders, no Gig series', !(await p.textContent('body')).includes('repeats'));
  ck('no transactions, balances or received income changed by any of this', snap() === s0, snap() + ' vs ' + s0);
  ck('no page errors', errs.length === 0, errs.join(';'));
  console.log(`${pass} passed, ${fail} failed`); await b.close();
})();

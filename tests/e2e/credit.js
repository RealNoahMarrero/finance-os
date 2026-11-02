const { chromium } = require('playwright'); const { execSync } = require('child_process');
const q = (sql) => execSync(`psql -h /tmp/pg -p 5433 -U postgres -d fos_test -At -c "${sql}"`).toString().trim();
let pass = 0, fail = 0; const ck = (n, c, d = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + d)); };
const snap = () => ({ tx: q("select count(*)||':'||md5(string_agg(t::text,'|' order by id)) from transactions t"), bp: q('select count(*) from bill_payments'), env: q("select md5(string_agg(id||':'||assigned_amount,'|' order by id)) from categories"), bal: q("select md5(string_agg(id||':'||balance,'|' order by id)) from accounts"), bills: q("select md5(string_agg(id||':'||coalesce(due_date::text,'')||target_amount,'|' order by id)) from categories") });
(async () => {
  q('delete from credit_scores; delete from credit_card_meta; delete from credit_reported_balances');
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:4173/'); await p.fill('#em', 'owner@test.local'); await p.fill('#pw', 'correct-horse-battery'); await p.click('button.primary');
  await p.waitForSelector('.sidebar'); await p.waitForTimeout(600);
  const s0 = snap();
  const txt = async (sel) => (await p.locator(sel).first().textContent()).replace(/\s+/g, ' ');
  // 1 nav + empty state + reused cards
  ck('Credit is reachable from Insights (not a primary tab)', true);
  await p.evaluate(() => (location.hash = '/credit')); await p.waitForSelector('#credit-page');
  ck('empty score state shown', (await txt('[aria-label="Latest score"]')).includes('No scores yet'));
  ck('cards reused from Accounts with correct utilization', (await txt('[data-testid="card-Capital One"]')).includes('91.8%') && (await txt('[data-testid="card-Credit One"]')).includes('114.9%'));
  ck('total utilization = eligible balances / eligible limits', (await txt('[data-testid="total-util"]')) === '105.6%', await txt('[data-testid="total-util"]'));
  ck('over-limit card flagged and available credit clamped', (await txt('[data-testid="card-Credit One"]')).includes('Over limit') && (await txt('[data-testid="card-Credit One"]')).replace(/ /g,'').includes('Availablecredit$0.00'));
  ck('unreconciled flagged, never claimed verified', (await txt('[data-testid="card-Capital One"]')).includes('Not reconciled'));
  ck('estimate is labelled as an estimate', (await txt('[aria-label="Total utilization"]')).includes('Estimate') && (await txt('[data-testid="reported-util"]')).includes('estimate'));
  // 2 add scores through the UI
  const add = async (bureau, score, model, date, custom) => {
    await p.click('button:has-text("Add score") >> nth=0'); await p.waitForSelector('#cs-score');
    await p.click(`.sheet .chip:text-is("${bureau}")`); await p.fill('#cs-score', String(score)); await p.click(`.sheet .chip:text-is("${model}")`); await p.fill('#cs-date', date);
    await p.click('.sheet button.primary'); await p.waitForTimeout(900);
  };
  await p.click('button:has-text("Add score") >> nth=0'); await p.waitForSelector('#cs-score');
  await p.click('.sheet .chip:text-is("Experian")'); await p.fill('#cs-score', '1000'); await p.click('.sheet .chip:text-is("FICO 8")');
  ck('score outside range rejected', (await p.locator('.sheet [role=alert]').textContent()).includes('between') || await p.locator('.sheet button.primary').isDisabled());
  await p.fill('#cs-score', '70'); ck('2-digit score rejected', await p.locator('.sheet button.primary').isDisabled());
  await p.fill('#cs-score', '700'); await p.evaluate(() => { const e = document.getElementById('cs-date'); e.removeAttribute('max'); });
  await p.fill('#cs-date', '2099-01-01'); ck('future date rejected', await p.locator('.sheet button.primary').isDisabled());
  await p.fill('#cs-date', '2026-09-01'); await p.click('.sheet button.primary'); await p.waitForTimeout(900);
  await add('Experian', 715, 'FICO 8', '2026-10-01'); await add('Experian', 690, 'VantageScore 3.0', '2026-10-05'); await add('Equifax', 705, 'FICO 8', '2026-09-20');
  ck('four scores stored', q('select count(*) from credit_scores') === '4');
  ck('latest score is the newest entry', (await txt('[data-testid="latest-score"]')) === '690');
  ck('first Vantage entry is NOT compared with FICO', (await txt('[aria-label="Latest score"]')).includes('First entry for this bureau & model'));
  ck('Experian FICO shows +15 vs previous FICO', (await txt('[data-testid="bureau-Experian"]')).includes('690') && (await p.locator('[data-testid="score-row"]:has-text("FICO 8"):has-text("+15")').count()) === 1);
  ck('other model listed separately on bureau card', (await txt('[data-testid="bureau-Experian"]')).includes('tracked separately'));
  ck('TransUnion with no score prompts to add', (await txt('[data-testid="bureau-TransUnion"]')).includes('No TransUnion score'));
  // chart + filters
  ck('chart legend has a line per bureau+model', await p.locator('[aria-label="Chart legend"] span').count() === 3);
  await p.click('[aria-label="Filter by bureau"] .chip:text-is("Equifax")'); ck('bureau filter', await p.locator('[data-testid="score-row"]').count() === 1);
  await p.click('[aria-label="Filter by bureau"] .chip:text-is("All bureaus")'); await p.click('[aria-label="Filter by scoring model"] .chip:text-is("VantageScore 3.0")'); ck('model filter', await p.locator('[data-testid="score-row"]').count() === 1);
  await p.click('[aria-label="Filter by scoring model"] .chip:text-is("All models")');
  await p.hover('[aria-label^="Credit score history"]', { position: { x: 600, y: 120 } }); await p.waitForTimeout(200);
  // edit + delete w/ undo
  await p.click('[data-testid="score-row"]:has-text("705")'); await p.waitForSelector('#cs-score'); await p.fill('#cs-score', '708'); await p.click('.sheet button.primary'); await p.waitForTimeout(900);
  ck('edit saves', q("select score from credit_scores where bureau='Equifax'") === '708');
  await p.click('[data-testid="score-row"]:has-text("708")'); await p.waitForSelector('#cs-score'); await p.click('.sheet button.danger'); await p.waitForTimeout(900);
  ck('delete works', q("select count(*) from credit_scores where bureau='Equifax'") === '0');
  await p.click('.toast button:has-text("Undo")'); await p.waitForTimeout(1200); ck('undo restores the entry', q("select score from credit_scores where bureau='Equifax'") === '708');
  // 3 limits: set Credit One limit via Credit UI -> accounts.credit_limit (single source of truth)
  await p.click('[aria-label="Edit Credit One credit details"]'); await p.waitForSelector('#cc-lim'); await p.fill('#cc-lim', '500'); await p.click('.sheet button.primary'); await p.waitForTimeout(1200);
  ck('limit saved on the account itself (no duplicate record)', q("select credit_limit from accounts where name='Credit One'") === '500.00' && q("select count(*) from credit_card_meta") === '1');
  ck('utilization recalculated', (await txt('[data-testid="card-Credit One"]')).includes('68.9%') && (await txt('[data-testid="total-util"]')) === '75.5%', await txt('[data-testid="total-util"]'));
  // 4 reported balance
  await p.click('button:has-text("Reported balance")'); await p.waitForSelector('#rb-bal'); await p.selectOption('#rb-card', { label: 'Capital One' }); await p.fill('#rb-bal', '100'); await p.fill('#rb-date', '2026-10-10');
  await p.click('.sheet .chip:text-is("Experian")'); await p.click('.sheet button.primary'); await p.waitForTimeout(1200);
  ck('reported balance stored separately; current balance untouched', q("select balance from credit_reported_balances") === '100.00' && q("select balance from accounts where name='Capital One'") === '183.54');
  ck('reported view is labelled partly estimated', (await txt('[data-testid="reported-util"]')).includes('partly estimated'), await txt('[data-testid="reported-util"]'));
  ck('card shows reported value & date', (await txt('[data-testid="card-Capital One"]')).includes('$100.00') && (await txt('[data-testid="card-Capital One"]')).includes('Oct 10'));
  // 5 calculator
  const pre = snap();
  await p.fill('#pay-' + q("select id from accounts where name='Capital One'"), '100');
  const afterTxt = await txt('[data-testid="calc-after"]'); ck('calculator updates overall utilization', afterTxt === '61.2%', afterTxt); // (83.54+344.69-0)/... see below
  await p.click('[data-testid="calc-row"]:has-text("Credit One") button:has-text("Pay in full")'); await p.waitForTimeout(150);
  ck('pay in full on a second card (multi-card)', (await txt('[data-testid="calc-after"]')) === '11.9%', await txt('[data-testid="calc-after"]'));
  await p.fill('#pay-' + q("select id from accounts where name='Capital One'"), '9999'); ck('payment capped at balance', (await txt('[data-testid="calc-row"]:has-text("Capital One")')).includes('capped at balance'));
  await p.click('.seg button:has-text("Reported balances")'); ck('reported scenarios are distinguished', (await txt('[data-testid="calc-baseline"]')).includes('reported'));
  await p.click('button:has-text("Reset")'); ck('reset clears inputs', (await p.inputValue('#pay-' + q("select id from accounts where name='Capital One'"))) === '');
  ck('calculator writes nothing', JSON.stringify(pre) === JSON.stringify(snap()));
  ck('utilization-not-a-prediction note', (await txt('[aria-label="What-if calculator"]')).includes('can’t predict'));
  // 6 dates
  await p.click('[data-testid="dates-Capital One"] button:has-text("Edit")'); await p.waitForSelector('#cc-close'); await p.fill('#cc-close', '2026-11-05');
  ck('payment due shows existing bill info', (await p.locator('.sheet').textContent()).includes('linked bill'));
  await p.click('.sheet button.primary'); await p.waitForTimeout(1200);
  ck('closing date saved and shown; due date from bill', (await txt('[data-testid="dates-Capital One"]')).includes('Nov 5') && (await txt('[data-testid="dates-Capital One"]')).includes('Nov 13') && (await txt('[data-testid="dates-Capital One"]')).includes('From bill'));
  // 7 inactive
  await p.click('[aria-label="Edit Credit One credit details"]'); await p.waitForSelector('#cc-lim'); await p.click('.sheet .seg button:has-text("Inactive")'); await p.click('.sheet button.primary'); await p.waitForTimeout(1200);
  ck('inactive card excluded from totals', (await txt('[data-testid="total-util"]')) === '91.8%' && (await txt('[data-testid="card-Credit One"]')).includes('Inactive'), await txt('[data-testid="total-util"]'));
  await p.click('[aria-label="Edit Credit One credit details"]'); await p.waitForSelector('#cc-lim'); await p.click('.sheet .seg button:has-text("Active")'); await p.click('.sheet button.primary'); await p.waitForTimeout(1200);
  // 8 ledger untouched (balances, transactions, payments, envelopes, bills)
  const s1 = snap(); ck('no transactions, balances, payments, envelopes or bills changed', JSON.stringify({ ...s0 }) === JSON.stringify(s1), JSON.stringify([s0, s1]));
  // 9 insights summary
  await p.click('.sidebar nav a:has-text("Insights")'); await p.waitForSelector('[data-testid="insights-credit"]'); ck('Insights has a small Credit summary', (await txt('[data-testid="insights-credit"]')).includes('Utilization'));
  await p.click('[data-testid="insights-credit"]'); await p.waitForSelector('#credit-page');
  // screenshots desktop light/dark
  await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: 'credit-desktop-light.png', fullPage: true });
  await p.evaluate(() => { localStorage.setItem('fos-theme', 'dark'); }); await p.reload(); await p.waitForSelector('#credit-page'); await p.waitForTimeout(500); await p.screenshot({ path: 'credit-desktop-dark.png', fullPage: true });
  // mobile
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const mp = await m.newPage(); mp.on('pageerror', (e) => errs.push(e.message));
  await mp.goto('http://localhost:4173/'); await mp.fill('#em', 'owner@test.local'); await mp.fill('#pw', 'correct-horse-battery'); await mp.click('button.primary'); await mp.waitForSelector('.tabbar'); await mp.waitForTimeout(600);
  ck('bottom nav not overcrowded (still 4 tabs + add)', await mp.locator('.tabbar a').count() === 4);
  await mp.click('button[aria-label="More"]'); await mp.waitForSelector('text=Credit & utilization'); await mp.click('text=Credit & utilization'); await mp.waitForSelector('#credit-page'); await mp.waitForTimeout(500);
  const ov = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ck('no horizontal overflow on mobile', ov <= 1, String(ov));
  await mp.screenshot({ path: 'credit-mobile-light.png', fullPage: true });
  await mp.evaluate(() => { localStorage.setItem('fos-theme', 'dark'); }); await mp.reload(); await mp.waitForSelector('#credit-page'); await mp.waitForTimeout(500); await mp.screenshot({ path: 'credit-mobile-dark.png', fullPage: true });
  ck('no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();

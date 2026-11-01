const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await p.goto('http://localhost:4173/'); await p.waitForSelector('#em');
  await p.screenshot({ path: '/home/claude/e2e/s-login.png' });
  await p.fill('#em', 'owner@test.local'); await p.fill('#pw', 'wrong'); await p.click('button.primary'); await p.waitForSelector('[role=alert]');
  console.log('bad login alert:', await p.textContent('[role=alert]'));
  await p.fill('#pw', 'correct-horse-battery'); await p.click('button.primary');
  await p.waitForSelector('.sidebar', { timeout: 15000 }); await p.waitForTimeout(800);
  await p.screenshot({ path: '/home/claude/e2e/s-overview.png', fullPage: true });
  for (const r of ['budget', 'transactions', 'accounts', 'plan/bills', 'plan/income', 'plan/forecast', 'plan/calendar', 'insights']) {
    await p.evaluate((h) => (location.hash = '/' + h), r); await p.waitForTimeout(500);
    await p.screenshot({ path: `/home/claude/e2e/s-${r.replace('/', '-')}.png`, fullPage: true });
  }
  console.log('errors:', errs.length ? errs.slice(0, 8) : 'none');
  await b.close();
})();

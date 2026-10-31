const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 }); const p = await ctx.newPage();
  await p.goto('http://localhost:4173/'); await p.fill('#em', 'owner@test.local'); await p.fill('#pw', 'correct-horse-battery'); await p.click('button.primary');
  await p.waitForSelector('.tabbar'); await p.waitForTimeout(700);
  await p.screenshot({ path: 'm-over.png' });
  await p.click('.tabbar .fab'); await p.waitForTimeout(500); await p.screenshot({ path: 'm-add.png' });
  const ov = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); console.log('horizontal overflow:', ov);
  await b.close();
})();

// Renders every frame of index.html to PNG in both themes: node docs/design/proposal/render.mjs  (needs puppeteer-core + Chrome)
import puppeteer from 'puppeteer-core'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const out = path.join(here, 'png'); fs.mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 1.5 });
for (const theme of ['light', 'dark']) {
  await p.goto(pathToFileURL(path.join(here, 'index.html')).href + `?theme=${theme}`, { waitUntil: 'networkidle0' }); await p.evaluate(() => document.fonts.ready);
  const ids = await p.$$eval('.frame[id]', (els) => els.map((e) => e.id));
  for (const id of ids) { const el = await p.$('#' + id); await el.screenshot({ path: path.join(out, `${id}-${theme}.png`) }); }
}
await b.close(); console.log('done');

// Regenerates every favicon / PWA icon from two tiny SVG definitions (the same mark as the app's sidebar logo: a blue tile with three
// stacked bars). Needs a Chrome/Edge (CHROME_PATH or a default install). Usage:  node tools/make-icons.mjs
import fs from 'node:fs'; import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BLUE = '#0071e3'; // the app accent
const root = path.resolve(import.meta.dirname, '..', 'public');
fs.mkdirSync(path.join(root, 'icons'), { recursive: true });

// App icon: three rounded bars (top one longest), optically centred on a 512 tile. `r` = tile corner radius (0 = full bleed for maskable / iOS).
const tile = (r) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${r}" fill="${BLUE}"/>` +
  `<rect x="124" y="132" width="264" height="56" rx="28" fill="#fff"/><rect x="124" y="228" width="184" height="56" rx="28" fill="#fff" opacity=".82"/><rect x="124" y="324" width="112" height="56" rx="28" fill="#fff" opacity=".64"/></svg>`;
// Favicon: the same mark with heavier bars so it still reads at 16px.
const fav = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${BLUE}"/>` +
  `<rect x="104" y="108" width="304" height="86" rx="43" fill="#fff"/><rect x="104" y="213" width="212" height="86" rx="43" fill="#fff" opacity=".85"/><rect x="104" y="318" width="128" height="86" rx="43" fill="#fff" opacity=".7"/></svg>`;

const chrome = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
if (!chrome) { console.error('No Chrome/Edge found. Set CHROME_PATH.'); process.exit(2); }
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
async function png(svg, size) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:transparent"><img style="display:block" width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body>`);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  return Buffer.from(await page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
}
const write = (rel, data) => { fs.writeFileSync(path.join(root, rel), data); console.log('wrote', rel, Buffer.byteLength(data), 'bytes'); };

write('favicon.svg', fav);
write('favicon-32.png', await png(fav, 32));
// favicon.ico (16 / 32 / 48, PNG-compressed entries) for browsers and tools that ask for /favicon.ico
const sizes = [16, 32, 48]; const imgs = []; for (const s of sizes) imgs.push(await png(fav, s));
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length; const dir = Buffer.concat(imgs.map((b, i) => { const e = Buffer.alloc(16); e[0] = sizes[i]; e[1] = sizes[i]; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(b.length, 8); e.writeUInt32LE(offset, 12); offset += b.length; return e; }));
write('favicon.ico', Buffer.concat([head, dir, ...imgs]));
write('apple-touch-icon.png', await png(tile(0), 180)); // iOS rounds it itself: full bleed, no transparency
write('icons/icon.svg', tile(112));
write('icons/icon-192.png', await png(tile(112), 192));
write('icons/icon-512.png', await png(tile(112), 512));
write('icons/icon-maskable-512.png', await png(tile(0), 512)); // full bleed; the bars sit well inside the 80% safe zone
write('icons/icon-maskable.svg', tile(0));
await browser.close();

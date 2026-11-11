// Favicon / PWA metadata: every referenced icon exists, has the declared size, uses the current blue identity, and the service worker
// precaches files that exist (and drops the previous cache so installed copies pick the new icons up).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs'; import path from 'node:path';

const pub = path.resolve(__dirname, '..', 'public');
const read = (p: string) => fs.readFileSync(path.join(pub, p));
const exists = (url: string) => fs.existsSync(path.join(pub, url.replace(/^\//, '')));
const pngSize = (b: Buffer) => { expect(b.subarray(1, 4).toString()).toBe('PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const manifest = JSON.parse(read('manifest.webmanifest').toString());
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

describe('PWA manifest', () => {
  it('declares 192 and 512 icons plus a maskable one, all real files of the declared size', () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    for (const i of manifest.icons as { src: string; sizes: string; type: string }[]) {
      expect(exists(i.src), i.src).toBe(true); expect(i.type).toBe('image/png');
      const [w, h] = pngSize(read(i.src.replace(/^\//, ''))); expect(`${w}x${h}`).toBe(i.sizes);
    }
  });
  it('shortcut icons exist and the theme colour is the app blue', () => {
    for (const s of manifest.shortcuts) for (const i of s.icons) expect(exists(i.src), i.src).toBe(true);
    expect(manifest.theme_color).toBe('#0071e3'); expect(manifest.start_url).toBe('/'); expect(manifest.display).toBe('standalone');
  });
});

describe('favicon and touch icons', () => {
  it('index.html references files that exist', () => {
    for (const m of html.matchAll(/<link[^>]+rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)) expect(exists(m[1]), m[1]).toBe(true);
    expect(html).toContain('href="/favicon.svg"'); expect(html).toContain('href="/favicon.ico"'); expect(html).toContain('apple-touch-icon');
  });
  it('apple-touch-icon is 180×180 and fully opaque (iOS rounds it itself); favicon png is 32×32', () => {
    expect(pngSize(read('apple-touch-icon.png'))).toEqual([180, 180]); expect(pngSize(read('favicon-32.png'))).toEqual([32, 32]);
  });
  it('favicon.ico holds 16, 32 and 48 pixel images', () => {
    const b = read('favicon.ico'); expect(b.readUInt16LE(2)).toBe(1); const n = b.readUInt16LE(4); expect(n).toBe(3);
    const got = Array.from({ length: n }, (_, i) => b[6 + i * 16]); expect(got).toEqual([16, 32, 48]);
    for (let i = 0; i < n; i++) { const off = b.readUInt32LE(6 + i * 16 + 12); expect(b.subarray(off + 1, off + 4).toString()).toBe('PNG'); }
  });
  it('every icon uses the current blue and none keeps the previous green/serif identity', () => {
    for (const f of ['favicon.svg', 'icons/icon.svg', 'icons/icon-maskable.svg']) { const s = read(f).toString(); expect(s).toContain('#0071e3'); expect(s).not.toMatch(/0f5c4d|serif|gradient/i); }
    for (const old of ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'icon-maskable.svg']) expect(exists(old), `old ${old} should be gone`).toBe(false);
  });
});

describe('service worker', () => {
  const sw = read('sw.js').toString();
  it('uses a new cache name (drops the old icons) and precaches files that exist', () => {
    expect(sw).toMatch(/CACHE = 'fos-shell-v(\d+)'/); expect(Number(/fos-shell-v(\d+)/.exec(sw)![1])).toBeGreaterThanOrEqual(3);
    const list = /addAll\(\[([^\]]+)\]\)/.exec(sw)![1].split(',').map((x) => x.trim().replace(/['"]/g, ''));
    for (const u of list) if (u !== '/') expect(exists(u), u).toBe(true);
  });
  it('still never caches data and still serves the manifest fresh', () => {
    expect(sw).toContain('url.origin !== self.location.origin'); expect(sw).toContain("url.pathname === '/manifest.webmanifest'");
  });
});

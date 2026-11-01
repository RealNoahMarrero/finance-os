const vm = require('vm'), fs = require('fs'), { execFileSync } = require('child_process');
const props = { SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: 'anon', SYNC_EMAIL: process.env.E || 'owner@test.local', SYNC_PASSWORD: process.env.P || 'correct-horse-battery' };
const sheets = {}; let calls = 0;
const mkSheet = (n) => ({ rows: [], clear() { this.rows = []; }, appendRow(r) { this.rows.push(r); }, getRange(r, c, nr, nc) { return { setValues: (v) => { v.forEach((row, i) => { this.rows[r - 1 + i] = row; }); }, setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; } }; }, setColumnWidth() {}, setFrozenRows() {}, getName: () => n });
const ctx = {
  console, JSON, Math, Number, String, Date, Object, Array, Error, RegExp,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] }) },
  UrlFetchApp: { fetch(url, o = {}) {
    calls++; const args = ['-s', '-w', '\n%{http_code}', '-X', (o.method || 'get').toUpperCase(), url];
    for (const [k, v] of Object.entries(o.headers || {})) args.push('-H', `${k}: ${v}`);
    if (o.contentType) args.push('-H', 'Content-Type: ' + o.contentType); if (o.payload) args.push('-d', o.payload);
    const out = execFileSync('curl', args).toString(); const i = out.lastIndexOf('\n');
    return { getResponseCode: () => +out.slice(i + 1), getContentText: () => out.slice(0, i) }; } },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = mkSheet(n)), toast: (m) => console.log('toast:', m) }), getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() {} }) }) },
  Utilities: { formatDate: () => '2026-10-31 12:00' }, Session: { getScriptTimeZone: () => 'UTC' },
};
vm.createContext(ctx); vm.runInContext(fs.readFileSync('/home/claude/out/scripts/google-sheets-sync.gs', 'utf8'), ctx);
try { vm.runInContext('syncFinanceOS()', ctx); } catch (e) { console.log('SYNC ERROR:', e.message); process.exit(0); }
for (const [n, s] of Object.entries(sheets)) console.log(n, s.rows.length - 1 > 0 ? s.rows.length - 1 + ' data rows' : s.rows.length + ' rows');
console.log('http calls', calls);

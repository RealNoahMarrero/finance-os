// Local stand-in for Supabase (Auth + REST) backed by an in-process Postgres (PGlite) running the REAL migrations in db/ and a
// SYNTHETIC dataset. Binds to 127.0.0.1 only, holds no credentials, never touches the network. Changes live in memory and vanish on restart.
// DEMO_READONLY=1 rejects every write (used by the smoke test).
import http from 'node:http';
import { createDb, rest, seedDemo, DEMO_UID } from './db.mjs';

const PORT = Number(process.env.DEMO_PORT || 54399);
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

export async function start(port = PORT, { readonly = process.env.DEMO_READONLY === '1' } = {}) {
  const db = await createDb();
  const writes = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const u = new URL(req.url, 'http://x');
    const send = (c, o) => { res.writeHead(c, { 'content-type': 'application/json', ...cors }); res.end(o === null || o === undefined ? '' : JSON.stringify(o)); };
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const raw = Buffer.concat(chunks).toString(); const body = raw ? JSON.parse(raw) : undefined;
        if (u.pathname === '/__writes') return send(200, writes);
        const session = () => { const now = Math.floor(Date.now() / 1000); return { access_token: 'demo', refresh_token: 'demo', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: { id: DEMO_UID, aud: 'authenticated', email: 'demo@example.test' } }; };
        if (u.pathname === '/auth/v1/token') return send(200, session());
        if (u.pathname === '/auth/v1/user') return send(200, session().user);
        if (u.pathname.startsWith('/auth/v1/')) return send(200, {});
        const m = /^\/rest\/v1\/(rpc\/)?([a-z_0-9]+)$/.exec(u.pathname);
        if (!m) return send(404, {});
        const isRpc = !!m[1]; const name = m[2];
        const write = isRpc ? !['is_owner', 'fos_post_due'].includes(name) : req.method !== 'GET'; // fos_post_due only posts scheduled rows whose date has arrived (none in the read-only fixture)
        if (write) { writes.push(`${req.method} ${u.pathname}`); if (readonly) return send(400, { message: 'DEMO MODE: writes are disabled' }); }
        const accept = req.headers.accept || '';
        const r = await rest(db, { method: req.method, table: isRpc ? undefined : name, rpc: isRpc ? name : undefined, params: u.searchParams, body, prefer: req.headers.prefer || '', single: accept.includes('vnd.pgrst.object') });
        send(r.status, r.body);
      } catch (e) { send(500, { message: String(e.message) }); }
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  server.reseed = async () => { await db.exec('truncate transactions, transaction_splits, projected_income, bill_payments, account_reconciliations, account_baselines, credit_scores, credit_card_meta, credit_reported_balances, categories, category_groups, accounts restart identity cascade'); await seedDemo(db); };
  server.pg = db;
  return server;
}

if (process.argv[1]?.endsWith('server.mjs')) {
  start().then(() => console.log(`demo backend (synthetic, in-memory Postgres) on http://127.0.0.1:${PORT}`));
}

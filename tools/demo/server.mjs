// Local, synthetic stand-in for Supabase (Auth + REST). Serves tools/demo/fixture.mjs.
// SAFE BY DESIGN: binds to 127.0.0.1 only, holds no credentials, never contacts the network,
// and rejects every write (the app shows its normal error toast). Milestone B adds a stateful,
// writable variant backed by an isolated local Postgres; this one stays read-only.
import http from 'node:http';
import { tables } from './fixture.mjs';

const PORT = Number(process.env.DEMO_PORT || 54399);
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
const writes = [];
const RO = { message: 'DEMO MODE: writes are disabled (synthetic read-only data)' };

export function start(port = PORT) {
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const u = new URL(req.url, 'http://x');
    const json = (c, o) => { res.writeHead(c, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(o)); };
    req.resume();
    req.on('end', () => {
      if (u.pathname === '/__writes') return json(200, writes); // test hook: every attempted write
      if (u.pathname === '/auth/v1/user') return json(200, { id: 'demo-user', email: 'demo@example.test', aud: 'authenticated' });
      if (u.pathname === '/auth/v1/token') { // demo sign-in: any credentials work (there is no real account here)
        const now = Math.floor(Date.now() / 1000);
        return json(200, { access_token: 'demo', refresh_token: 'demo', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: { id: 'demo-user', aud: 'authenticated', email: 'demo@example.test' } });
      }
      if (u.pathname.startsWith('/auth/v1/')) return json(200, {});
      if (u.pathname === '/rest/v1/rpc/is_owner') return json(200, true); // read-only check
      const m = /^\/rest\/v1\/([a-z_]+)$/.exec(u.pathname);
      if (m && req.method === 'GET') { const off = Number(u.searchParams.get('offset') || 0); return json(200, off > 0 ? [] : tables[m[1]] ?? []); }
      if (u.pathname.startsWith('/rest/v1/')) { writes.push(`${req.method} ${u.pathname}`); return json(400, RO); }
      json(404, {});
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('server.mjs')) {
  start().then(() => console.log(`demo backend (synthetic, read-only) on http://127.0.0.1:${PORT}`));
}

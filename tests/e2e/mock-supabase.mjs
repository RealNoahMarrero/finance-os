// Local stand-in for Supabase Auth (GoTrue) + REST proxy to PostgREST. TEST ONLY.
import http from 'node:http'; import crypto from 'node:crypto';
const SECRET = 'test-secret-test-secret-test-secret-0123456789';
const OWNER = { id: '11111111-1111-1111-1111-111111111111', email: 'owner@test.local', password: 'correct-horse-battery' };
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const sign = (payload) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(payload); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const session = () => { const now = Math.floor(Date.now() / 1000); const exp = now + 3600; const user = { id: OWNER.id, aud: 'authenticated', role: 'authenticated', email: OWNER.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  return { access_token: sign({ sub: OWNER.id, role: 'authenticated', aud: 'authenticated', email: OWNER.email, iat: now, exp }), token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'rt-' + crypto.randomUUID(), user }; };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const u = new URL(req.url, 'http://x'); let body = [];
  req.on('data', (c) => body.push(c)); req.on('end', () => {
    body = Buffer.concat(body);
    const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/auth/v1/token') {
      const g = u.searchParams.get('grant_type'); const b = body.length ? JSON.parse(body) : {};
      if (g === 'password') return b.email === OWNER.email && b.password === OWNER.password ? json(200, session()) : json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      if (g === 'refresh_token') return b.refresh_token?.startsWith('rt-') ? json(200, session()) : json(400, { error: 'invalid_grant' });
    }
    if (u.pathname === '/auth/v1/user') return json(200, session().user);
    if (u.pathname === '/auth/v1/logout') { res.writeHead(204, cors); return res.end(); }
    if (u.pathname.startsWith('/rest/v1/')) {
      const path = u.pathname.slice('/rest/v1'.length) + u.search;
      const h = { ...req.headers, host: 'localhost:3000' }; delete h['content-length'];
      const pr = http.request({ host: '127.0.0.1', port: 3000, path, method: req.method, headers: { ...h, 'content-length': body.length } }, (r) => { res.writeHead(r.statusCode, { ...r.headers, ...cors }); r.pipe(res); });
      pr.on('error', (e) => json(502, { message: String(e) })); return pr.end(body);
    }
    json(404, { message: 'not found' });
  });
}).listen(54321, () => console.log('mock supabase on 54321'));

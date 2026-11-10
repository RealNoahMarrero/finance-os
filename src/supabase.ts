import { createClient } from '@supabase/supabase-js';

// The existing Netlify site already defines NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY;
// vite.config exposes both prefixes so no new environment variables are needed.
const env = import.meta.env as Record<string, string | undefined>;
export const SUPABASE_URL = env.VITE_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const KEY = env.VITE_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const HOST = (() => { try { return new URL(SUPABASE_URL).hostname; } catch { return ''; } })();
/** Safety: `npm run dev` may only talk to a LOCAL backend (the demo server), so a development session can never write to production data.
 *  Production builds (vite build) are unaffected. Override deliberately with VITE_ALLOW_REMOTE=1. */
export const READ_ONLY = env.VITE_READONLY === '1';
export const blockedRemote = import.meta.env.DEV && !!SUPABASE_URL && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(HOST) && env.VITE_ALLOW_REMOTE !== '1' && !READ_ONLY;
export const configured = Boolean(SUPABASE_URL && KEY) && !blockedRemote;

/** Read-only preview (VITE_READONLY=1): every request that could change data is refused before it leaves the browser. Only GET reads, the
 *  owner check, and sign-in/token refresh are allowed, so a preview against real data cannot modify it, whatever is clicked. */
const guardedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
  const path = (() => { try { return new URL(url).pathname; } catch { return url; } })();
  const safe = method === 'GET' || method === 'HEAD' || path.startsWith('/auth/v1/') || (method === 'POST' && path === '/rest/v1/rpc/is_owner');
  if (!safe) return new Response(JSON.stringify({ message: 'Read-only preview — nothing was saved.' }), { status: 400, headers: { 'content-type': 'application/json' } });
  return fetch(input, init);
};
export const supabase = createClient(SUPABASE_URL || 'http://localhost:54321', KEY || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: READ_ONLY ? 'fos-auth-preview' : 'fos-auth' },
  ...(READ_ONLY ? { global: { fetch: guardedFetch } } : {}),
});

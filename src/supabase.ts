import { createClient } from '@supabase/supabase-js';

// The existing Netlify site already defines NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY;
// vite.config exposes both prefixes so no new environment variables are needed.
const env = import.meta.env as Record<string, string | undefined>;
export const SUPABASE_URL = env.VITE_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const KEY = env.VITE_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const HOST = (() => { try { return new URL(SUPABASE_URL).hostname; } catch { return ''; } })();
/** Safety: `npm run dev` may only talk to a LOCAL backend (the demo server), so a development session can never write to production data.
 *  Production builds (vite build) are unaffected. Override deliberately with VITE_ALLOW_REMOTE=1. */
export const blockedRemote = import.meta.env.DEV && !!SUPABASE_URL && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(HOST) && env.VITE_ALLOW_REMOTE !== '1';
export const configured = Boolean(SUPABASE_URL && KEY) && !blockedRemote;

export const supabase = createClient(SUPABASE_URL || 'http://localhost:54321', KEY || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'fos-auth' },
});

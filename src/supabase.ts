import { createClient } from '@supabase/supabase-js';

// The existing Netlify site already defines NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY;
// vite.config exposes both prefixes so no new environment variables are needed.
const env = import.meta.env as Record<string, string | undefined>;
export const SUPABASE_URL = env.VITE_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const KEY = env.VITE_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const configured = Boolean(SUPABASE_URL && KEY);

export const supabase = createClient(SUPABASE_URL || 'http://localhost:54321', KEY || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'fos-auth' },
});

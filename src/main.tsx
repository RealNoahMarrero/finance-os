import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session } from '@supabase/supabase-js';
import '@fontsource-variable/inter';
import './styles.css';
import { StoreProvider } from './store';
import { App } from './App';
import { Login, Notice } from './Login';
import { blockedRemote, configured, supabase } from './supabase';

type Gate = { state: 'loading' } | { state: 'out' } | { state: 'denied'; email: string } | { state: 'in'; email: string } | { state: 'offline' };

function Root() {
  const [gate, setGate] = useState<Gate>({ state: 'loading' });
  useEffect(() => {
    let alive = true;
    const check = async (s: Session | null) => {
      if (!s) { if (alive) setGate({ state: 'out' }); return; }
      const { data, error } = await supabase.rpc('is_owner');
      if (!alive) return;
      if (error) setGate({ state: 'offline' });
      else setGate(data === true ? { state: 'in', email: s.user.email ?? '' } : { state: 'denied', email: s.user.email ?? '' });
    };
    supabase.auth.getSession().then(({ data }) => check(data.session)).catch(() => alive && setGate({ state: 'offline' }));
    const { data: sub } = supabase.auth.onAuthStateChange((evt, s) => {
      if (evt === 'TOKEN_REFRESHED') return;
      setTimeout(() => check(s), 0); // never await supabase calls inside this callback
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  if (blockedRemote) return <Notice title="Development safety stop">This is a development build pointed at a remote database. To protect real data it will not start. Run <code>npm run demo</code> for synthetic data, or set <code>VITE_ALLOW_REMOTE=1</code> if you really mean it.</Notice>;
  if (!configured) return <Notice title="Not configured">This build is missing its Supabase address or public key. Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in the Netlify site settings and redeploy.</Notice>;
  switch (gate.state) {
    case 'loading': return <div className="boot" aria-busy="true"><span className="boot-dot" /></div>;
    case 'out': return <Login />;
    case 'offline': return <Notice title="Can’t reach the database" action={<button className="btn primary" onClick={() => location.reload()}>Try again</button>}>Check your connection and try again. Nothing has been changed.</Notice>;
    case 'denied': return <Notice title="Not authorized" action={<button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>}>{gate.email} is signed in, but this account isn’t the owner of this Finances. No data is shown.</Notice>;
    case 'in': return <StoreProvider email={gate.email}><App /></StoreProvider>;
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* optional */ }); });
}

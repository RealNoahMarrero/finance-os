import { useState } from 'react';
import { Lock } from 'lucide-react';
import { supabase } from './supabase';

export function BrandMark({ size = 40 }: { size?: number }) {
  return <div className="brand-mark" style={{ width: size, height: size }}><div><i style={{ width: size * 0.4 }} /><i style={{ width: size * 0.28, opacity: 0.75 }} /><i style={{ width: size * 0.18, opacity: 0.5 }} /></div></div>;
}

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setErr(/invalid login/i.test(error.message) ? 'That email and password don’t match.' : error.message);
    setBusy(false);
  };
  return (
    <main className="login-wrap">
      <form className="card login-card fade-in" onSubmit={submit} aria-labelledby="login-h">
        <div className="row gap12" style={{ marginBottom: 18 }}>
          <BrandMark />
          <div><div id="login-h" className="brand-name" style={{ fontSize: 18 }}>Finances</div><div className="small muted">Private — sign in to continue</div></div>
        </div>
        <div className="field"><label htmlFor="em">Email</label>
          <input id="em" className="input" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field" style={{ marginTop: 14 }}><label htmlFor="pw">Password</label>
          <input id="pw" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {err && <div className="callout neg" role="alert" style={{ marginTop: 14 }}><div>{err}</div></div>}
        <button className="btn primary lg" style={{ marginTop: 18, width: '100%' }} disabled={busy || !email || !password}><Lock />{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}

export function Notice({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <main className="login-wrap">
      <div className="card login-card fade-in">
        <div className="row gap12" style={{ marginBottom: 14 }}><BrandMark /><div className="brand-name" style={{ fontSize: 18 }}>{title}</div></div>
        <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.55 }}>{children}</div>
        {action && <div style={{ marginTop: 16 }}>{action}</div>}
      </div>
    </main>
  );
}

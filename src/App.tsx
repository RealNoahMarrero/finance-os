import { lazy, Suspense, useEffect, useState } from 'react';
import { BarChart3, Home, Landmark, Menu, ListChecks, Moon, Plus, Receipt, Settings as Cog, Sun } from 'lucide-react';
import { useStore } from './store';
import { SheetHost } from './sheets';
import { Notice } from './Login';
import { Overview } from './pages/Overview';
import { Transactions } from './pages/Transactions';
import { Plan } from './pages/PlanPage';
import { cn } from './lib';
import { READ_ONLY } from './supabase';

// Heavier, less-visited screens load on demand so the first paint is smaller.
const Insights = lazy(() => import('./pages/Insights').then((m) => ({ default: m.Insights })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const Accounts = lazy(() => import('./pages/Accounts').then((m) => ({ default: m.Accounts })));
const AccountDetail = lazy(() => import('./pages/Accounts').then((m) => ({ default: m.AccountDetail })));

export interface Route { name: string; id?: string; query: URLSearchParams }
/** Canonical routes: '', activity, accounts, plan, insights, settings. Every earlier address (#/bills, #/budget, #/plan/bills,
 *  #/transactions, #/credit …) still works and lands on the right screen. */
function normalize(name: string, id: string | undefined, query: URLSearchParams): Route {
  if (name === 'transactions') return { name: 'activity', id, query };
  if (name === 'credit') return { name: 'insights', id: 'credit', query };
  if (name === 'plan' || name === 'budget' || name === 'bills') {
    if (name === 'plan' && id === 'forecast') return { name: 'insights', id: 'forecast', query };
    const q = new URLSearchParams(query);
    if (query.get('tab') === 'income' || id === 'income') q.set('view', 'income');
    if (id === 'calendar' && !q.get('view')) q.set('view', 'calendar');
    if (query.get('tab') === 'paused') q.set('filter', 'archived');
    q.delete('tab');
    return { name: 'plan', query: q };
  }
  return { name, id, query };
}
function useRoute(): Route {
  const [h, setH] = useState(() => location.hash.slice(1) || '/');
  useEffect(() => { const f = () => { setH(location.hash.slice(1) || '/'); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const [path, qs = ''] = h.split('?');
  const seg = path.split('/').filter(Boolean);
  return normalize(seg[0] ?? '', seg[1], new URLSearchParams(qs));
}

export const NAV = [
  { to: '/', key: '', label: 'Home', icon: Home },
  { to: '/activity', key: 'activity', label: 'Activity', icon: Receipt },
  { to: '/accounts', key: 'accounts', label: 'Accounts', icon: Landmark },
  { to: '/plan', key: 'plan', label: 'Plan', icon: ListChecks },
  { to: '/insights', key: 'insights', label: 'Insights', icon: BarChart3 },
];

export function App() {
  const { data, openModal, status, loadError, refresh, resolvedTheme, toggleTheme } = useStore();
  const r = useRoute();

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !document.querySelector('[role=dialog]') && data.accounts.length) { e.preventDefault(); openModal({ type: 'txn', mode: 'add' }); }
    };
    addEventListener('keydown', f); return () => removeEventListener('keydown', f);
  }, [openModal, data.accounts.length]);

  let page;
  switch (r.name) {
    case 'activity': page = <Transactions query={r.query} />; break;
    case 'accounts': page = r.id ? <AccountDetail id={r.id} /> : <Accounts />; break;
    case 'plan': page = <Plan query={r.query} />; break;
    case 'insights': page = <Insights tab={r.id === 'forecast' || r.id === 'credit' ? r.id : 'overview'} />; break;
    case 'settings': page = <Settings />; break;
    default: page = <Overview />;
  }
  if (status === 'loading') return <div className="boot" aria-busy="true" aria-label="Loading your finances"><span className="boot-dot" /></div>;
  if (status === 'error') return <Notice title="Couldn’t load your data" action={<button className="btn primary" onClick={() => void refresh()}>Try again</button>}>{loadError || 'The database didn’t respond.'} Nothing has been changed.</Notice>;
  const active = (k: string) => (r.name === k ? 'page' : undefined);
  const tab = (to: string, key: string, label: string, Icon: typeof Home) => (
    <a href={`#${to}`} aria-current={active(key)}><Icon /><span>{label}</span></a>
  );

  return (
    <div className="app">
      {READ_ONLY && <div role="status" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 90, background: 'var(--warn-soft)', color: 'var(--warn)', textAlign: 'center', fontSize: 12.5, fontWeight: 650, padding: '5px 12px' }}>Read-only preview of your data — nothing you do here is saved</div>}
      <a href="#main" className="sr" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand"><div className="brand-mark"><div><i style={{ width: 16 }} /><i style={{ width: 11, opacity: 0.8 }} /><i style={{ width: 7, opacity: 0.6 }} /></div></div><div className="brand-name">Finances</div></div>
        <button className="btn primary" style={{ margin: '0 4px 16px', height: 40 }} onClick={() => openModal({ type: 'txn', mode: 'add' })}><Plus />Add transaction<kbd className="kbd">N</kbd></button>
        <nav className="nav" aria-label="Primary">
          {NAV.map((n) => <a key={n.to} href={`#${n.to}`} aria-current={active(n.key)}><n.icon />{n.label}</a>)}
        </nav>
        <div className="side-spacer" />
        <nav className="nav" aria-label="Secondary"><div className="sep" />
          <button className="nav-btn" data-testid="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}>{resolvedTheme === 'dark' ? <Sun /> : <Moon />}{resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
          <a href="#/settings" aria-current={active('settings')}><Cog />Settings</a></nav>
      </aside>

      <main className="main" id="main" tabIndex={-1}>
        <header className="mobile-head">
          <div className="brand"><div className="brand-mark"><div><i style={{ width: 14 }} /><i style={{ width: 10, opacity: 0.8 }} /><i style={{ width: 6, opacity: 0.6 }} /></div></div><div className="brand-name">Finances</div></div>
          <button className="more-btn" aria-label="More: Insights, Settings" onClick={() => openModal({ type: 'menu' })}><Menu />More</button>
        </header>
        <Suspense fallback={<div className="page" aria-busy="true"><div className="skeleton" style={{ height: 120 }} /></div>}>{page}</Suspense>
      </main>

      <nav className="tabbar" aria-label="Primary">
        {tab('/', '', 'Home', Home)}
        {tab('/activity', 'activity', 'Activity', Receipt)}
        <button className="tab" aria-label="Add transaction" onClick={() => openModal({ type: 'txn', mode: 'add' })}><span className={cn('fab')}><Plus /></span></button>
        {tab('/plan', 'plan', 'Plan', ListChecks)}
        {tab('/accounts', 'accounts', 'Accounts', Landmark)}
      </nav>
      <SheetHost />
    </div>
  );
}

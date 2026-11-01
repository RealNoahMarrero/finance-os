import { useEffect, useState } from 'react';
import { BarChart3, CalendarClock, Gauge, Home, Landmark, Menu, PieChart, Plus, Receipt, Wallet } from 'lucide-react';
import { useStore } from './store';
import { attentionItems } from './shared';
import { ThemeSwitch } from './ui';
import { AccountFoot, SheetHost } from './sheets';
import { Notice } from './Login';
import { Overview } from './pages/Overview';
import { Budget } from './pages/Budget';
import { Transactions } from './pages/Transactions';
import { Accounts, AccountDetail } from './pages/Accounts';
import { Plan } from './pages/Plan';
import { Insights } from './pages/Insights';
import { Credit } from './pages/Credit';
import { cn } from './lib';

function useRoute() {
  const [h, setH] = useState(() => location.hash.slice(1) || '/');
  useEffect(() => { const f = () => { setH(location.hash.slice(1) || '/'); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const [path, qs = ''] = h.split('?');
  const seg = path.split('/').filter(Boolean);
  return { name: seg[0] ?? '', id: seg[1], query: new URLSearchParams(qs) };
}

const NAV = [
  { to: '/', key: '', label: 'Overview', icon: Home },
  { to: '/budget', key: 'budget', label: 'Budget', icon: PieChart },
  { to: '/transactions', key: 'transactions', label: 'Transactions', icon: Receipt },
  { to: '/accounts', key: 'accounts', label: 'Accounts', icon: Landmark },
  { to: '/plan/bills', key: 'plan', label: 'Bills & Planning', icon: CalendarClock },
  { to: '/credit', key: 'credit', label: 'Credit', icon: Gauge },
  { to: '/insights', key: 'insights', label: 'Insights', icon: BarChart3 },
];

export function App() {
  const { data, openModal, theme, setTheme, status, loadError, refresh } = useStore();
  const r = useRoute();
  const attn = attentionItems(data).filter((a) => a.tone === 'neg' || a.tone === 'warn').length;

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && data.accounts.length) { e.preventDefault(); openModal({ type: 'txn', mode: 'add' }); }
    };
    addEventListener('keydown', f); return () => removeEventListener('keydown', f);
  }, [openModal, data.accounts.length]);

  let page;
  switch (r.name) {
    case 'budget': page = <Budget />; break;
    case 'transactions': page = <Transactions query={r.query} />; break;
    case 'accounts': page = r.id ? <AccountDetail id={r.id} /> : <Accounts />; break;
    case 'plan': page = <Plan tab={(['bills', 'income', 'forecast', 'calendar'].includes(r.id) ? r.id : 'bills') as 'bills'} />; break;
    case 'credit': page = <Credit />; break;
    case 'insights': page = <Insights />; break;
    default: page = <Overview />;
  }
  if (status === 'loading') return <div className="boot" aria-busy="true" aria-label="Loading your finances"><span className="boot-dot" /></div>;
  if (status === 'error') return <Notice title="Couldn’t load your data" action={<button className="btn primary" onClick={() => void refresh()}>Try again</button>}>{loadError || 'The database didn’t respond.'} Nothing has been changed.</Notice>;
  const tab = (to: string, key: string, label: string, Icon: typeof Home) => (
    <a href={`#${to}`} aria-current={r.name === key ? 'page' : undefined}><Icon /><span>{label}</span></a>
  );

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand"><div className="brand-mark"><div><i style={{ width: 16 }} /><i style={{ width: 11, opacity: 0.75 }} /><i style={{ width: 7, opacity: 0.5 }} /></div></div><div><div className="brand-name">Finance OS</div><div className="brand-sub">Personal</div></div></div>
        <button className="btn primary" style={{ margin: '0 4px 16px' }} onClick={() => openModal({ type: 'txn', mode: 'add' })}><Plus />Add transaction<kbd className="kbd">N</kbd></button>
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.to} href={`#${n.to}`} aria-current={r.name === n.key ? 'page' : undefined}><n.icon />{n.label}{n.key === '' && attn > 0 && <span className="count">{attn}</span>}</a>
          ))}
        </nav>
        <div className="side-spacer" />
        <div className="side-foot">
          <ThemeSwitch theme={theme} setTheme={setTheme} />
          <AccountFoot />
        </div>
      </aside>

      <main className="main" id="main">
        <header className="mobile-head">
          <div className="brand"><div className="brand-mark"><div><i style={{ width: 14 }} /><i style={{ width: 10, opacity: 0.75 }} /><i style={{ width: 6, opacity: 0.5 }} /></div></div><div className="brand-name">Finance OS</div></div>
          <button className="btn icon" aria-label="More" onClick={() => openModal({ type: 'menu' })}><Menu /></button>
        </header>
        {page}
      </main>

      <nav className="tabbar" aria-label="Primary">
        {tab('/', '', 'Home', Home)}
        {tab('/budget', 'budget', 'Budget', Wallet)}
        <button className="tab" aria-label="Add transaction" onClick={() => openModal({ type: 'txn', mode: 'add' })}><span className={cn('fab')}><Plus /></span></button>
        {tab('/transactions', 'transactions', 'Activity', Receipt)}
        {tab('/plan/bills', 'plan', 'Plan', CalendarClock)}
      </nav>
      <SheetHost />
    </div>
  );
}

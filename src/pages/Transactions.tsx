import { useMemo, useState } from 'react';
import { Plus, Receipt, Search, X } from 'lucide-react';
import { useStore } from '../store';
import { addDays, dayHeading, diffDays, money, sum, cn } from '../lib';
import { Empty, Money, Seg } from '../ui';
import { PageHead, TxnRow, txnCategoryLabel } from '../shared';

type Kind = 'all' | 'expense' | 'income' | 'transfer';
type Range = '30' | '90' | 'all';

export function Transactions({ query }: { query: URLSearchParams }) {
  const { data, openModal } = useStore();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [range, setRange] = useState<Range>('90');
  const [acct, setAcct] = useState<string>('all');
  const [limit, setLimit] = useState(40);
  const catFilter = query.get('cat');
  const cat = catFilter ? data.categories.find((c) => c.id === catFilter) : null;

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.txns.filter((t) => {
      if (t.date > data.today) return false;
      if (range !== 'all' && diffDays(data.today, t.date) > Number(range)) return false;
      if (kind !== 'all' && t.type !== kind) return false;
      if (acct !== 'all' && t.accountId !== acct && t.toAccountId !== acct) return false;
      if (catFilter && t.categoryId !== catFilter && !t.splits?.some((x) => x.categoryId === catFilter)) return false;
      if (s) {
        const hay = `${t.payee} ${t.notes ?? ''} ${txnCategoryLabel(data, t)}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [data, q, kind, range, acct, catFilter]);

  const inc = sum(filtered.filter((t) => t.type === 'income' && !t.adjustment), (t) => t.amount);
  const exp = sum(filtered.filter((t) => t.type === 'expense' && !t.adjustment), (t) => t.amount);
  const shown = filtered.slice(0, limit);
  const days: { date: string; items: typeof shown }[] = [];
  for (const t of shown) { const last = days[days.length - 1]; if (last && last.date === t.date) last.items.push(t); else days.push({ date: t.date, items: [t] }); }
  const filtering = q || kind !== 'all' || acct !== 'all' || range !== '90' || catFilter;

  if (data.txns.length === 0) {
    return (
      <div className="page"><PageHead title="Transactions" sub="Everything you’ve spent, earned and moved" />
        <div className="card"><Empty icon={<Receipt />} title="No transactions yet" text="Add your first one — it takes a few seconds. Amount, payee, category, account." action={<button className="btn primary" onClick={() => data.accounts.length ? openModal({ type: 'txn', mode: 'add' }) : openModal({ type: 'account-add' })}><Plus />{data.accounts.length ? 'Add transaction' : 'Add an account first'}</button>} /></div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead title="Transactions" sub={`${filtered.length} ${filtered.length === 1 ? 'transaction' : 'transactions'}${range !== 'all' ? ` in the last ${range} days` : ''}`}
        actions={<button className="btn primary desktop-only" onClick={() => openModal({ type: 'txn', mode: 'add' })}><Plus />Add transaction</button>} />

      <div className="stack gap12" style={{ marginBottom: 14 }}>
        <div className="row gap12" style={{ flexWrap: 'wrap' }}>
          <div className="search-wrap grow" style={{ minWidth: 220 }}>
            <Search /><input className="input search" placeholder="Search payee, notes or category" value={q} onChange={(e) => { setQ(e.target.value); setLimit(40); }} aria-label="Search transactions" />
          </div>
          <div style={{ overflowX: 'auto' }}><Seg value={kind} onChange={(v) => { setKind(v); setLimit(40); }} options={[{ v: 'all', label: 'All' }, { v: 'expense', label: 'Spending' }, { v: 'income', label: 'Income' }, { v: 'transfer', label: 'Transfers' }]} /></div>
          <Seg value={range} onChange={(v) => { setRange(v); setLimit(40); }} options={[{ v: '30', label: '30D' }, { v: '90', label: '90D' }, { v: 'all', label: 'All' }]} />
        </div>
        <div className="chips scroll" role="group" aria-label="Filter by account">
          <button className="chip" aria-pressed={acct === 'all'} onClick={() => setAcct('all')}>All accounts</button>
          {data.accounts.map((a) => <button key={a.id} className="chip" aria-pressed={acct === a.id} onClick={() => setAcct(a.id)}>{a.name}</button>)}
          {cat && <button className="chip" aria-pressed onClick={() => (location.hash = '/transactions')}>{cat.name}<X /></button>}
        </div>
      </div>

      <div className="grid g12 keep2" style={{ marginBottom: 14, gap: 12 }}>
        {[['Income', inc, 'pos'], ['Spending', -exp, ''], ['Net', inc - exp, inc - exp < 0 ? 'neg' : 'pos']].map(([l, v, tone], i) => (
          <div key={l as string} className={cn('card pad', i === 2 && 'half')} style={{ gridColumn: 'span 4', padding: '14px 18px' }}>
            <div className="eyebrow">{l as string}</div>
            <div className={cn('amt-lg num', tone as string)} style={{ marginTop: 4 }}><Money v={v as number} sign={l === 'Net'} cents={false} /></div>
          </div>
        ))}
      </div>

      <section className="card" style={{ overflow: 'hidden' }} aria-label="Transaction list">
        {filtered.length === 0 ? (
          <Empty icon={<Search />} title="No matches" text="Nothing fits those filters. Try a wider date range or clear the search." action={filtering ? <button className="btn" onClick={() => { setQ(''); setKind('all'); setAcct('all'); setRange('90'); location.hash = '/transactions'; }}>Clear filters</button> : undefined} />
        ) : days.map((d) => {
          const net = sum(d.items.filter((t) => !t.adjustment), (t) => (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0));
          return (
            <div key={d.date}>
              <div className="tx-day"><span>{dayHeading(d.date, data.today)}</span><span className="num">{net ? money(net, { sign: true }) : ''}</span></div>
              {d.items.map((t) => <TxnRow key={t.id} t={t} full onOpen={() => openModal({ type: 'txn', mode: 'view', id: t.id })} />)}
            </div>
          );
        })}
        {filtered.length > limit && <div style={{ padding: 14, textAlign: 'center' }}><button className="btn" onClick={() => setLimit(limit + 40)}>Show more ({filtered.length - limit} remaining)</button></div>}
      </section>
      <div className="xs muted" style={{ textAlign: 'center', marginTop: 14 }}>Every past transaction is kept here. Once an account has an opening balance, transactions on or before its opening-balance date are history, and aren’t counted in the opening-balance check.</div>
    </div>
  );
}

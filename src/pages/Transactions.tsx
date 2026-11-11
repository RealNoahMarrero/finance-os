import { useMemo, useState } from 'react';
import { Plus, Receipt, Search, X } from 'lucide-react';
import { useStore } from '../store';
import { cn, dayHeading, diffDays, fmtDate, money, sum } from '../lib';
import { Empty, Money, Seg } from '../ui';
import { PageHead, TxnIcon, txnCategoryLabel, txnDisplayAmount } from '../shared';
import type { Txn } from '../data';

type Kind = 'all' | 'expense' | 'income' | 'transfer';
type Range = '30' | '90' | 'all';

export function Transactions({ query }: { query: URLSearchParams }) {
  const { data, openModal } = useStore();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [range, setRange] = useState<Range>('90');
  const [acct, setAcct] = useState<string>('all');
  const [catSel, setCatSel] = useState<string>('all');
  const [limit, setLimit] = useState(50);
  const [sel, setSel] = useState<string | null>(null);
  const catFilter = query.get('cat') ?? (catSel !== 'all' ? catSel : null);
  const cat = catFilter ? data.categories.find((c) => c.id === catFilter) : null;
  const wide = () => matchMedia('(min-width: 1101px)').matches;

  const { posted, scheduled, counted } = useMemo(() => {
    const s = q.trim().toLowerCase();
    const ok = (t: Txn) => {
      if (kind !== 'all' && t.type !== kind) return false;
      if (acct !== 'all' && t.accountId !== acct && t.toAccountId !== acct) return false;
      if (catFilter && t.categoryId !== catFilter && !t.splits?.some((x) => x.categoryId === catFilter)) return false;
      if (s && !`${t.payee} ${t.notes ?? ''} ${txnCategoryLabel(data, t)}`.toLowerCase().includes(s)) return false;
      return true;
    };
    const all = data.txns.filter(ok);
    return {
      posted: all.filter((t) => !t.scheduled && t.date <= data.today && (range === 'all' || diffDays(data.today, t.date) <= Number(range))).sort((a, b) => b.date.localeCompare(a.date)),
      scheduled: all.filter((t) => t.scheduled).sort((a, b) => a.date.localeCompare(b.date)),
      // entered before scheduling existed: dated in the future but already counted in balances (left exactly as recorded)
      counted: all.filter((t) => !t.scheduled && t.date > data.today).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }, [data, q, kind, range, acct, catFilter]);

  const inc = sum(posted.filter((t) => t.type === 'income' && !t.adjustment), (t) => t.amount);
  const exp = sum(posted.filter((t) => t.type === 'expense' && !t.adjustment), (t) => t.amount);
  const shown = posted.slice(0, limit);
  const days: { date: string; items: Txn[] }[] = [];
  for (const t of shown) { const last = days[days.length - 1]; if (last && last.date === t.date) last.items.push(t); else days.push({ date: t.date, items: [t] }); }
  const filtering = q || kind !== 'all' || acct !== 'all' || range !== '90' || catFilter;
  const open = (t: Txn) => { if (wide()) setSel(t.id); else openModal({ type: 'txn', mode: 'view', id: t.id }); };
  const selTxn = data.txns.find((t) => t.id === sel);

  if (data.txns.length === 0) {
    return (
      <div className="page"><PageHead title="Activity" sub="Everything you’ve spent, earned and moved" />
        <div className="card"><Empty icon={<Receipt />} title="No transactions yet" text="Add your first one — it takes a few seconds." action={<button className="btn primary" onClick={() => data.accounts.length ? openModal({ type: 'txn', mode: 'add' }) : openModal({ type: 'account-add' })}><Plus />{data.accounts.length ? 'Add transaction' : 'Add an account first'}</button>} /></div>
      </div>
    );
  }

  const row = (t: Txn, sched?: boolean) => {
    const acctName = data.allAccounts.find((a) => a.id === t.accountId)?.name;
    const da = txnDisplayAmount(data, t);
    return (
      <button key={t.id} className={sched ? 'tx-row2 sched' : 'tx-row2'} aria-selected={sel === t.id} onClick={() => open(t)}>
        <TxnIcon t={t} />
        <div style={{ minWidth: 0 }}>
          <div className="li-title ellipsis">{t.payee}</div>
          <div className="li-sub ellipsis">{txnCategoryLabel(data, t)}{t.type === 'transfer' ? '' : ` · ${acctName}`}</div>
        </div>
        <div className="c-cat small muted ellipsis">{t.type === 'transfer' ? 'Transfer' : txnCategoryLabel(data, t)}</div>
        <div className="c-date small muted">{sched ? `Posts ${fmtDate(t.date)}` : fmtDate(t.date)}</div>
        <div className="right"><Money v={da.v} sign={t.type === 'income'} className={da.tone === 'pos' ? 'pos amt-md' : sched ? 'muted amt-md' : 'amt-md'} /></div>
      </button>
    );
  };

  return (
    <div className="page">
      <PageHead title="Activity" sub={`${posted.length} ${posted.length === 1 ? 'transaction' : 'transactions'}${range !== 'all' ? ` in the last ${range} days` : ''}`}
        actions={<><div className="search-wrap" style={{ width: 260 }}><Search /><input className="input search" style={{ height: 38 }} placeholder="Search activity" value={q} onChange={(e) => { setQ(e.target.value); setLimit(50); }} aria-label="Search transactions" /></div></>} />

      <div className="row gap12" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ overflowX: 'auto' }}><Seg value={kind} onChange={(v) => { setKind(v); setLimit(50); }} options={[{ v: 'all', label: 'All' }, { v: 'expense', label: 'Spending' }, { v: 'income', label: 'Income' }, { v: 'transfer', label: 'Transfers' }]} /></div>
        <select className="select" style={{ width: 'auto', height: 36, fontSize: 13 }} value={acct} onChange={(e) => setAcct(e.target.value)} aria-label="Filter by account">
          <option value="all">All accounts</option>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select className="select" style={{ width: 'auto', height: 36, fontSize: 13 }} value={catFilter ?? 'all'} onChange={(e) => { setCatSel(e.target.value); if (query.get('cat')) location.hash = '/activity'; }} aria-label="Filter by category">
          <option value="all">All categories</option>{data.categories.filter((c) => !c.hidden).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <Seg value={range} onChange={(v) => { setRange(v); setLimit(50); }} options={[{ v: '30', label: '30D' }, { v: '90', label: '90D' }, { v: 'all', label: 'All' }]} />
        {filtering ? <button className="chip" onClick={() => { setQ(''); setKind('all'); setAcct('all'); setCatSel('all'); setRange('90'); if (query.get('cat')) location.hash = '/activity'; }}>Clear{cat ? ` · ${cat.name}` : ''}<X /></button> : null}
      </div>
      <div className="sum-row" style={{ marginBottom: 16 }}>
        {[['Income', inc, 'pos'], ['Spending', -exp, ''], ['Net', inc - exp, inc - exp < 0 ? 'neg' : 'pos']].map(([l, v, tone]) => (
          <div key={l as string}><div className="eyebrow">{l as string}</div><div className={`amt-lg num ${tone}`} style={{ marginTop: 2 }}><Money v={v as number} sign={l === 'Net'} cents={false} /></div></div>
        ))}
      </div>

      <div className={cn('split-layout', !selTxn && 'idle')}>
        <section className="card" style={{ overflow: 'hidden' }} aria-label="Transaction list">
          {scheduled.length > 0 && (<>
            <div className="tx-day"><span>Scheduled · not yet posted</span><span>{scheduled.length}</span></div>
            {scheduled.map((t) => row(t, true))}
          </>)}
          {counted.length > 0 && (<>
            <div className="tx-day"><span>Future-dated · already counted in your balances</span><span>{counted.length}</span></div>
            {counted.map((t) => row(t))}
          </>)}
          {posted.length === 0 ? (
            <Empty icon={<Search />} title="No matches" text="Nothing fits those filters." action={filtering ? <button className="btn" onClick={() => { setQ(''); setKind('all'); setAcct('all'); setCatSel('all'); setRange('90'); }}>Clear filters</button> : undefined} />
          ) : days.map((d) => {
            const net = sum(d.items.filter((t) => !t.adjustment), (t) => (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0));
            return (
              <div key={d.date}>
                <div className="tx-day"><span>{dayHeading(d.date, data.today)}</span><span className="num">{net ? money(net, { sign: true }) : ''}</span></div>
                {d.items.map((t) => row(t))}
              </div>
            );
          })}
          {posted.length > limit && <div style={{ padding: 14, textAlign: 'center' }}><button className="btn" onClick={() => setLimit(limit + 50)}>Show more ({posted.length - limit} remaining)</button></div>}
        </section>

        <aside className="card pane" aria-label="Transaction details">
          {!selTxn ? <ActivityOverview posted={posted} /> : (() => {
            const t = selTxn; const da = txnDisplayAmount(data, t); const locked = t.adjustment || t.billId || t.incomeId;
            const a = data.allAccounts.find((x) => x.id === t.accountId); const to = data.allAccounts.find((x) => x.id === t.toAccountId);
            return (<>
              <div className="eyebrow">{t.adjustment ? 'Adjustment' : t.date > data.today ? 'Scheduled' : t.type}</div>
              <div className="sect-title" style={{ fontSize: 22, marginTop: 4 }}>{t.payee}</div>
              <div className="amt-xl num" style={{ fontSize: 40, margin: '6px 0 12px' }}><Money v={t.type === 'transfer' ? -t.amount : da.v} sign tone={t.type === 'income' ? 'auto' : undefined} /></div>
              <div className="kv"><span className="k">Date</span><span className="v">{fmtDate(t.date, 'long')}</span></div>
              <div className="kv"><span className="k">Account</span><span className="v">{a?.name}{to ? ` → ${to.name}` : ''}</span></div>
              <div className="kv"><span className="k">Category</span><span className="v">{txnCategoryLabel(data, t)}</span></div>
              {t.notes && <div className="kv"><span className="k">Notes</span><span className="v">{t.notes}</span></div>}
              <div className="row gap8" style={{ marginTop: 16 }}>
                <button className="btn primary grow" onClick={() => openModal({ type: 'txn', mode: locked ? 'view' : 'edit', id: t.id })}>{locked ? 'Details' : 'Edit'}</button>
                {!locked && <button className="btn danger" onClick={() => openModal({ type: 'txn', mode: 'view', id: t.id })}>Delete…</button>}
              </div>
            </>);
          })()}
        </aside>
      </div>
    </div>
  );
}

/** What the side panel shows before anything is selected: where the money in this view went. */
function ActivityOverview({ posted }: { posted: Txn[] }) {
  const { data } = useStore();
  const by = new Map<string, number>();
  for (const t of posted) {
    if (t.type !== 'expense' || t.adjustment) continue;
    if (t.splits?.length) for (const s of t.splits) by.set(s.categoryId, (by.get(s.categoryId) ?? 0) + s.amount);
    else by.set(t.categoryId ?? '', (by.get(t.categoryId ?? '') ?? 0) + t.amount);
  }
  const top = [...by.entries()].map(([id, v]) => ({ name: data.categories.find((c) => c.id === id)?.name ?? 'Uncategorized', v })).sort((a, b) => b.v - a.v).slice(0, 6);
  const max = Math.max(1, ...top.map((x) => x.v));
  const biggest = [...posted].filter((t) => t.type === 'expense' && !t.adjustment).sort((a, b) => b.amount - a.amount)[0];
  return (
    <div aria-label="This view at a glance">
      <div className="eyebrow">Where it went</div>
      {top.length === 0 ? <div className="small muted" style={{ marginTop: 8 }}>No spending in this view.</div> : (
        <div className="stack gap12" style={{ marginTop: 12 }}>
          {top.map((x) => (
            <div key={x.name}><div className="row between small" style={{ marginBottom: 4 }}><span style={{ fontWeight: 560 }}>{x.name}</span><span className="num">{money(x.v, { cents: false })}</span></div><div className="bar planned" style={{ height: 6 }}><i style={{ width: `${(x.v / max) * 100}%` }} /></div></div>
          ))}
        </div>
      )}
      {biggest && <div className="kv" style={{ marginTop: 16 }}><span className="k">Largest</span><span className="v">{biggest.payee} · {money(biggest.amount, { cents: false })}</span></div>}
      <div className="xs muted" style={{ marginTop: 14 }}>Select a transaction to see its details, edit or delete it.</div>
    </div>
  );
}

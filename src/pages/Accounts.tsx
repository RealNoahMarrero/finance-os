import { useState } from 'react';
import { ChevronLeft, ChevronRight, Landmark, Plus, Scale } from 'lucide-react';
import { useStore } from '../store';
import { balanceSeries, billOccurrences, cardsOwed, liquidTotal, loansOwed, netWorth, netWorthSeries, staleness, type Account } from '../data';
import { addDays, cn, compact, fmtDate, money, plural, sum } from '../lib';
import { AccountIcon, Callout, Empty, Money, StatusPill } from '../ui';
import { AreaLine, Spark } from '../charts';
import { BillRow, PageHead, TxnRow } from '../shared';

function StaleBadge({ a, today }: { a: Account; today: string }) {
  const s = staleness(a, today);
  if (s.level === 'never') return <StatusPill status="late">Not verified yet</StatusPill>;
  if (s.level === 'fresh') return <StatusPill status="ok">{s.days === 0 ? 'Reconciled today' : `Reconciled ${s.days}d ago`}</StatusPill>;
  if (s.level === 'aging') return <StatusPill status="warn">Check in · {s.days}d</StatusPill>;
  return <StatusPill status="late">May be stale · {s.days}d</StatusPill>;
}

const typeLabel = (a: Account) => (a.type === 'credit' ? 'Credit card' : a.type[0].toUpperCase() + a.type.slice(1));

export function Accounts() {
  const { data, openModal } = useStore();
  if (data.accounts.length === 0) {
    return (
      <div className="page"><PageHead title="Accounts" sub="Recorded balances you reconcile yourself" />
        <div className="card"><Empty icon={<Landmark />} title="No accounts yet" text="Add checking, savings, cash or a credit card. You enter the balance, and reconcile it against your bank whenever you like." action={<button className="btn primary" onClick={() => openModal({ type: 'account-add' })}><Plus />Add an account</button>} /></div></div>
    );
  }
  const cash = data.accounts.filter((a) => a.type !== 'credit');
  const cards = data.accounts.filter((a) => a.type === 'credit');
  const nw = netWorth(data);
  const series = netWorthSeries(data);
  const assets = liquidTotal(data), owedCards = cardsOwed(data), owedLoans = loansOwed(data);

  const card = (a: Account) => {
    const credit = a.type === 'credit';
    const series = balanceSeries(data, a.id, 30);
    const util = credit && a.limit ? a.balance / a.limit : 0;
    return (
      <button key={a.id} className="card acct-card" onClick={() => (location.hash = `/accounts/${a.id}`)} aria-label={`${a.name}, ${money(a.balance)}`}>
        <div className="row between">
          <div className="row gap12"><div className="li-ico"><AccountIcon type={a.type} /></div>
            <div><div className="li-title">{a.name}</div><div className="li-sub">{typeLabel(a)}</div></div></div>
          <ChevronRight size={16} className="muted" />
        </div>
        <div className="row between" style={{ alignItems: 'flex-end' }}>
          <div><div className="eyebrow">{credit ? 'Owed' : 'Recorded balance'}</div><div className="amt-xl num" style={{ marginTop: 4 }}><Money v={a.balance} /></div></div>
          <Spark values={series} width={92} height={36} color={credit ? 'var(--ink-3)' : 'var(--actual)'} />
        </div>
        {credit && a.limit ? (
          <div><div className="bar actual" style={{ height: 6 }}><i style={{ width: `${Math.min(100, util * 100)}%`, background: util > 0.5 ? 'var(--warn)' : 'var(--actual)' }} /></div>
            <div className="row between xs muted" style={{ marginTop: 5 }}><span>{Math.round(util * 100)}% of {compact(a.limit)} limit</span><span className="num">{money(a.limit - a.balance, { cents: false })} available</span></div></div>
        ) : null}
        <StaleBadge a={a} today={data.today} />
      </button>
    );
  };

  return (
    <div className="page">
      <PageHead title="Accounts" sub="Balances are recorded by you — reconcile to keep them trustworthy"
        actions={<><button className="btn desktop-only" onClick={() => openModal({ type: 'cutover' })}><Scale />Opening balances</button><button className="btn desktop-only" onClick={() => openModal({ type: 'account-add' })}><Plus />Add account</button></>} />
      {data.accounts.some((a) => !a.baseline) && (
        <div style={{ marginBottom: 16 }}><div className="card pad setup-banner"><div><div className="li-title">Set your opening balances</div><div className="small muted" style={{ maxWidth: 560 }}>{data.accounts.filter((a) => !a.baseline).length} of {data.accounts.length} accounts aren’t verified yet. Pick a cutover date and enter the real balance for each — all your past transactions stay saved either way.</div></div><button className="btn primary" onClick={() => openModal({ type: 'cutover' })}><Scale />Set opening balances</button></div></div>
      )}
      <div className="grid g12" style={{ marginBottom: 20 }}>
        <section className="card pad" style={{ gridColumn: '1 / span 7' }} aria-label="Net worth">
          <div className="sect-head"><div><h2 className="sect-title">Net worth <StatusPill status="muted">Recorded</StatusPill></h2><div className="small muted">Last 12 months</div></div>
            <div className="right"><div className="amt-xl num"><Money v={nw} cents={false} /></div><div className={cn('small', nw - series[0].value >= 0 ? 'pos' : 'neg')} style={{ fontWeight: 600 }}>{money(nw - series[0].value, { sign: true, cents: false })} in a year</div></div></div>
          <AreaLine series={series} height={190} label="Net worth over the last twelve months" />
          <div className="grid g12 keep2" style={{ marginTop: 12, gap: 12 }}>
            {[['Cash & savings', assets, ''], ['Credit cards', -owedCards, ''], ['Loans', -owedLoans, '']].map(([l, v]) => (
              <div key={l as string} style={{ gridColumn: 'span 4' }}><div className="eyebrow">{l as string}</div><div className="amt-md num" style={{ marginTop: 3 }}><Money v={v as number} cents={false} /></div></div>
            ))}
          </div>
        </section>
        <section className="card" style={{ gridColumn: '8 / span 5' }} aria-label="Reconciliation status">
          <div className="pad" style={{ paddingBottom: 6 }}><div className="sect-head" style={{ marginBottom: 0 }}><h2 className="sect-title"><Scale size={16} />Reconciliation</h2></div>
            <p className="small muted" style={{ marginTop: 4 }}>How recently each balance was checked against your bank.</p></div>
          <div className="list">
            {[...data.accounts].sort((a, b) => (a.lastReconciled ?? '').localeCompare(b.lastReconciled ?? '')).map((a) => {
              const s = staleness(a, data.today);
              return (
                <div className="li" key={a.id}>
                  <span className="dot" style={{ background: s.level === 'fresh' ? 'var(--pos)' : s.level === 'aging' ? 'var(--warn)' : 'var(--neg)' }} />
                  <div className="grow"><div className="li-title" style={{ fontSize: 13.5 }}>{a.name}</div><div className="li-sub" style={{ fontSize: 12 }}>{a.lastReconciled ? <>{s.days === 0 ? 'Today' : `${plural(s.days, 'day')} ago`} · {fmtDate(a.lastReconciled)}</> : 'Not verified — enter its real balance'}</div></div>
                  <button className={cn('btn sm', !a.lastReconciled && 'primary')} onClick={() => openModal({ type: 'reconcile', id: a.id })}>{a.baseline ? 'Reconcile' : 'Set balance'}</button>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <h2 className="eyebrow" style={{ margin: '0 0 10px' }}>Cash &amp; savings</h2>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', marginBottom: 22 }}>{cash.map(card)}</div>
      {cards.length > 0 && <><h2 className="eyebrow" style={{ margin: '0 0 10px' }}>Credit cards</h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', marginBottom: 22 }}>{cards.map(card)}</div></>}

      {data.debts.length > 0 && (
        <>
          <h2 className="eyebrow" style={{ margin: '0 0 10px' }}>Loans</h2>
          <section className="card" style={{ overflow: 'hidden' }}>
            <div className="list">
              {data.debts.map((d) => {
                return (
                  <div className="li" key={d.id} style={{ padding: '16px 20px', flexWrap: 'wrap' }}>
                    <div className="li-ico"><Landmark /></div>
                    <div className="grow" style={{ minWidth: 150 }}><div className="li-title">{d.name}</div><div className="li-sub">{d.payment > 0 ? `${money(d.payment)} payment` : 'No set payment'}{d.dueDay ? ` · due the ${d.dueDay}${['th','st','nd','rd'][d.dueDay % 10 > 3 || [11, 12, 13].includes(d.dueDay) ? 0 : d.dueDay % 10]}` : ''}</div></div>
                    <div className="right" style={{ minWidth: 100 }}><div className="eyebrow">Balance</div><div className="amt-md num">{money(d.balance)}</div></div>
                    <button className="btn sm" aria-label={`Edit ${d.name} debt`} onClick={() => openModal({ type: 'debt-edit', categoryId: d.id })}>Edit</button>
                  </div>
                );
              })}
            </div>
          </section>
          <p className="xs muted" style={{ marginTop: 8 }}>Balances owed drop when you confirm a payment on the matching bill with a transaction, and you can correct any balance with Edit. Simple records — no interest modeling.</p>
        </>
      )}
    </div>
  );
}

export function AccountDetail({ id }: { id: string }) {
  const { data, openModal } = useStore();
  const [limit, setLimit] = useState(25);
  const a = data.accounts.find((x) => x.id === id);
  if (!a) return <div className="page"><Empty icon={<Landmark />} title="Account not found" text="It may no longer exist." action={<a className="btn" href="#/accounts">Back to accounts</a>} /></div>;
  const credit = a.type === 'credit';
  const txns = data.txns.filter((t) => (t.accountId === a.id || t.toAccountId === a.id) && t.date <= data.today).sort((x, y) => y.date.localeCompare(x.date));
  const s30 = balanceSeries(data, a.id, 30);
  const delta = s30[s30.length - 1] - s30[0];
  const st = staleness(a, data.today);
  const bills = billOccurrences(data, data.today, addDays(data.today, 30)).filter((o) => !o.paid && (o.bill.accountId === a.id || o.bill.toAccountId === a.id)).slice(0, 3);

  return (
    <div className="page">
      <a href="#/accounts" className="sect-link" style={{ marginBottom: 14, display: 'inline-flex' }}><ChevronLeft size={16} />Accounts</a>
      <div className="grid g12">
        <section className="card hero" style={{ gridColumn: '1 / span 12' }}>
          <div className="hero-top" style={{ alignItems: 'center' }}>
            <div>
              <div className="row gap12" style={{ marginBottom: 10 }}><div className="li-ico"><AccountIcon type={a.type} /></div>
                <div><div className="li-title" style={{ fontSize: 17 }}>{a.name}</div><div className="li-sub">{typeLabel(a)}</div></div></div>
              <div className="eyebrow row gap8">{credit ? 'Recorded amount owed' : 'Recorded balance'}<span className="pill"><i className="dot actual" style={{ width: 7, height: 7 }} />Actual</span></div>
              <div className="amt-hero num" style={{ marginTop: 6 }}><Money v={a.balance} /></div>
              <div className={cn('small', (credit ? delta <= 0 : delta >= 0) ? 'pos' : 'muted')} style={{ marginTop: 6, fontWeight: 600 }}>{money(delta, { sign: true })} in 30 days</div>
            </div>
            <div className="stack gap12" style={{ alignItems: 'flex-end' }}>
              <Spark values={s30} width={200} height={64} color={credit ? 'var(--ink-3)' : 'var(--actual)'} />
              <button className="btn primary" onClick={() => openModal({ type: 'reconcile', id: a.id })}><Scale />Reconcile</button>
            </div>
          </div>
        </section>
        <section className="card" style={{ gridColumn: '1 / span 8', overflow: 'hidden' }}>
          <div className="pad" style={{ paddingBottom: 6 }}><div className="sect-head" style={{ marginBottom: 0 }}><h2 className="sect-title">Transactions</h2><span className="small muted">{txns.length} in history</span></div></div>
          <div className="list">{txns.slice(0, limit).map((t, i, arr) => (
            <div key={t.id}>
              {a.baseline && t.date <= a.baseline && (i === 0 || arr[i - 1].date > a.baseline) && <div className="xs muted" style={{ padding: '10px 20px', background: 'var(--surface-2)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>History through {fmtDate(a.baseline, 'long')} — saved for reference; not counted in the balance (the opening balance replaces it).</div>}
              <div style={a.baseline && t.date <= a.baseline ? { opacity: 0.62 } : undefined}><TxnRow t={t} onOpen={() => openModal({ type: 'txn', mode: 'view', id: t.id })} /></div>
            </div>
          ))}</div>
          {txns.length > limit && <div style={{ padding: 14, textAlign: 'center' }}><button className="btn" onClick={() => setLimit(limit + 25)}>Show more</button></div>}
        </section>
        <div className="stack gap16" style={{ gridColumn: '9 / span 4' }}>
          <section className="card pad">
            <div className="sect-head"><h2 className="sect-title">Reconciliation</h2><StaleBadge a={a} today={data.today} /></div>
            <div className="kv"><span className="k">Last verified</span><span className="v">{a.lastReconciled ? fmtDate(a.lastReconciled, 'long') : 'Never'}</span></div>
            {a.lastReconciled && <div className="kv"><span className="k">Days since</span><span className="v num">{st.days}</span></div>}
            <div className="kv"><span className="k">Recorded</span><span className="v num">{money(a.balance)}</span></div>
            {a.derived != null && a.derived !== a.balance && <div style={{ marginTop: 10 }}><Callout tone="warn">Opening balance plus transactions adds up to <b className="num">{money(a.derived)}</b>, which differs from the recorded balance. Reconcile to settle it against your bank.</Callout></div>}
            {!a.baseline ? <div style={{ marginTop: 10 }}><Callout tone="warn">This balance hasn’t been checked against your bank yet. Set the real opening balance to anchor it.</Callout></div>
              : st.level !== 'fresh' && <div style={{ marginTop: 10 }}><Callout tone={st.level === 'stale' ? 'warn' : undefined}>Balances are entered manually, so this may have drifted. A quick check takes under a minute.</Callout></div>}
            {data.reconciliations.filter((r) => r.accountId === a.id).slice(0, 4).map((r) => (
              <div className="kv" key={r.id}><span className="k">{fmtDate(r.date)}</span><span className="v num">{r.diff === 0 ? 'matched' : `adjusted ${money(r.diff, { sign: true })}`}</span></div>
            ))}
          </section>
          <section className="card pad">
            <div className="sect-head"><h2 className="sect-title">Account details</h2></div>
            <div className="kv"><span className="k">Type</span><span className="v">{typeLabel(a)}</span></div>
            {credit && a.limit && <div className="kv"><span className="k">Credit limit</span><span className="v num">{money(a.limit, { cents: false })}</span></div>}
            {a.baseline ? <>
              <div className="kv"><span className="k">Opening balance</span><span className="v num">{money(a.openingBalance ?? 0)}</span></div>
              <div className="kv"><span className="k">Counted from</span><span className="v">after {fmtDate(a.baseline, 'long')}</span></div>
              <p className="xs muted" style={{ marginTop: 6 }}>Earlier transactions are kept and searchable, but the balance counts forward from the verified opening figure.</p>
              <button className="btn sm" style={{ marginTop: 8 }} onClick={() => openModal({ type: 'cutover', id: a.id })}>Change opening balance</button></> : <p className="xs muted" style={{ marginTop: 6 }}>No opening balance yet. All history is saved; nothing has been marked verified.</p>}
          </section>
          {bills.length > 0 && (
            <section className="card" style={{ overflow: 'hidden' }}>
              <div className="pad" style={{ paddingBottom: 4 }}><h2 className="sect-title">Coming from this account</h2></div>
              <div className="list">{bills.map((o) => <BillRow key={o.bill.id + o.date} o={o} onOpen={() => openModal({ type: 'bill', billId: o.bill.id, date: o.date })} />)}</div>
            </section>
          )}
        </div>
      </div>
      
    </div>
  );
}

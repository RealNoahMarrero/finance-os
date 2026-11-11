import { useState } from 'react';
import { ChevronLeft, ChevronRight, Landmark, Pencil, Plus, Scale } from 'lucide-react';
import { useStore } from '../store';
import { balanceSeries, billOccurrences, cardsOwed, liquidTotal, loansOwed, netWorth, staleness, type Account } from '../data';
import { addDays, cn, compact, fmtDate, money } from '../lib';
import { AccountIcon, Callout, Empty, Money, StatusPill } from '../ui';
import { Spark } from '../charts';
import { PageHead, TxnRow, txnDisplayAmount } from '../shared';

function StaleBadge({ a, today }: { a: Account; today: string }) {
  const s = staleness(a, today);
  if (s.level === 'never') return <StatusPill status="late">Not verified</StatusPill>;
  if (s.level === 'fresh') return <StatusPill status="ok">{s.days === 0 ? 'Reconciled today' : `Reconciled ${s.days}d ago`}</StatusPill>;
  if (s.level === 'aging') return <StatusPill status="warn">Check in · {s.days}d</StatusPill>;
  return <StatusPill status="late">Check balance · {s.days}d</StatusPill>;
}
const typeLabel = (a: Account) => (a.type === 'credit' ? 'Credit card' : a.type[0].toUpperCase() + a.type.slice(1));

export function Accounts() {
  const { data, openModal } = useStore();
  if (data.accounts.length === 0) {
    return (
      <div className="page"><PageHead title="Accounts" />
        <div className="card"><Empty icon={<Landmark />} title="No accounts yet" text="Add checking, savings, cash or a credit card." action={<button className="btn primary" onClick={() => openModal({ type: 'account-add' })}><Plus />Add an account</button>} /></div></div>
    );
  }
  const cash = data.accounts.filter((a) => a.type !== 'credit');
  const cards = data.accounts.filter((a) => a.type === 'credit');
  const unverified = data.accounts.filter((a) => !a.baseline);
  const row = (a: Account) => {
    const credit = a.type === 'credit'; const util = credit && a.limit ? a.balance / a.limit : 0;
    return (
      <a key={a.id} className="rowx" href={`#/accounts/${a.id}`} aria-label={`${a.name}, ${money(a.balance)}`}>
        <div className="li-ico"><AccountIcon type={a.type} /></div>
        <div className="grow"><div className="li-title">{a.name}</div>
          <div className="li-sub">{credit && a.limit ? `${Math.round(util * 100)}% of ${compact(a.limit)} limit · ${money(a.limit - a.balance, { cents: false })} available` : typeLabel(a)}</div>
          {credit && a.limit ? <div className="bar" style={{ marginTop: 8, maxWidth: 280 }}><i style={{ width: `${Math.min(100, util * 100)}%`, background: util > 0.5 ? 'var(--warn)' : 'var(--accent)' }} /></div> : null}</div>
        <div className="d-only"><StaleBadge a={a} today={data.today} /></div>
        <div className="right"><div className="amt-md num"><Money v={a.balance} /></div><div className="xs muted">{credit ? 'owed' : ''}</div></div>
        <ChevronRight size={16} className="muted" />
      </a>
    );
  };
  return (
    <div className="page">
      <PageHead title="Accounts" sub={`Cash & savings ${money(liquidTotal(data), { cents: false })} · owed ${money(cardsOwed(data) + loansOwed(data), { cents: false })} · net ${money(netWorth(data), { cents: false })}`}
        actions={<><button className="btn" onClick={() => openModal({ type: 'cutover' })}><Scale />Opening balances</button><button className="btn primary" onClick={() => openModal({ type: 'account-add' })}><Plus />Add account</button></>} />
      {unverified.length > 0 && <div className="mini-banner" style={{ marginBottom: 14 }}><span>{unverified.length} of {data.accounts.length} accounts aren’t verified yet.</span><button className="btn sm" onClick={() => openModal({ type: 'cutover' })}>Set opening balances</button></div>}
      <div className="group-h"><h2>Cash &amp; savings</h2></div>
      <div className="group">{cash.map(row)}</div>
      {cards.length > 0 && <><div className="group-h"><h2>Credit cards</h2><a className="sect-link" href="#/insights/credit">Credit<ChevronRight size={14} /></a></div><div className="group">{cards.map(row)}</div></>}
      {data.debts.length > 0 && (<>
        <div className="group-h"><h2>Debts &amp; loans</h2></div>
        <div className="group">{data.debts.map((d) => (
          <div className="rowx" key={d.id}>
            <div className="li-ico"><Landmark /></div>
            <div className="grow"><div className="li-title">{d.name}</div><div className="li-sub">{d.payment > 0 ? `${money(d.payment, { cents: false })} payment` : 'No set payment'}{d.dueDay ? ` · due the ${d.dueDay}${['th', 'st', 'nd', 'rd'][d.dueDay % 10 > 3 || [11, 12, 13].includes(d.dueDay) ? 0 : d.dueDay % 10]}` : ''}</div></div>
            <div className="amt-md num"><Money v={d.balance} /></div>
            <button className="btn sm" aria-label={`Edit ${d.name}`} onClick={() => openModal({ type: 'category-edit', id: d.id })}>Edit</button>
          </div>))}</div></>)}
      {data.allAccounts.some((x) => x.archived) && (
        <details style={{ marginTop: 18 }} data-testid="archived-accounts">
          <summary className="group-h" style={{ cursor: 'pointer', paddingTop: 0 }}><h2>Archived accounts · {data.allAccounts.filter((x) => x.archived).length}</h2></summary>
          <div className="group">{data.allAccounts.filter((x) => x.archived).map((x) => (
            <div className="rowx" key={x.id}><div className="li-ico"><AccountIcon type={x.type} /></div><div className="grow"><div className="li-title">{x.name}</div><div className="li-sub">{typeLabel(x)} · history kept</div></div>
              <a className="btn sm" href={`#/accounts/${x.id}`}>History</a><button className="btn sm" onClick={() => openModal({ type: 'account-edit', id: x.id })}>Restore…</button></div>))}</div>
        </details>
      )}
    </div>
  );
}

export function AccountDetail({ id }: { id: string }) {
  const { data, openModal } = useStore();
  const [limit, setLimit] = useState(25);
  const a = data.allAccounts.find((x) => x.id === id);
  if (!a) return <div className="page"><Empty icon={<Landmark />} title="Account not found" text="It may no longer exist." action={<a className="btn" href="#/accounts">Back to accounts</a>} /></div>;
  const credit = a.type === 'credit';
  const txns = data.txns.filter((t) => (t.accountId === a.id || t.toAccountId === a.id) && t.date <= data.today).sort((x, y) => y.date.localeCompare(x.date));
  const s30 = balanceSeries(data, a.id, 30);
  const delta = s30[s30.length - 1] - s30[0];
  const st = staleness(a, data.today);
  const bills = billOccurrences(data, data.today, addDays(data.today, 30)).filter((o) => !o.paid && (o.bill.accountId === a.id || o.bill.toAccountId === a.id)).slice(0, 3);
  return (
    <div className="page">
      <a href="#/accounts" className="sect-link" style={{ marginBottom: 12, display: 'inline-flex' }}><ChevronLeft size={16} />Accounts</a>
      <div className="topbar">
        <div><div className="eyebrow">{typeLabel(a)}{a.archived ? ' · archived' : ''}</div><h1 className="page-title" style={{ fontSize: 28 }}>{a.name}</h1></div>
        <div className="top-actions"><button className="btn" data-testid="edit-account" onClick={() => openModal({ type: 'account-edit', id: a.id })}><Pencil />{a.archived ? 'Restore…' : 'Edit'}</button><button className="btn primary" onClick={() => openModal({ type: 'reconcile', id: a.id })}><Scale />Reconcile</button></div>
      </div>
      <div className="row gap24" style={{ alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18 }}>
        <div><div className="eyebrow">{credit ? 'Recorded amount owed' : 'Recorded balance'}</div><div className="amt-hero num"><Money v={a.balance} /></div>
          <div className={cn('small', (credit ? delta <= 0 : delta >= 0) ? 'pos' : 'muted')} style={{ marginTop: 4, fontWeight: 560 }}>{money(delta, { sign: true })} in 30 days</div></div>
        <Spark values={s30} width={180} height={54} color={credit ? 'var(--ink-3)' : 'var(--accent)'} />
      </div>
      <div className="split-layout">
        <section>
          <div className="group-h"><h2>Transactions</h2><span className="small muted">{txns.length}</span></div>
          <div className="group">{txns.slice(0, limit).map((t, i, arr) => (
            <div key={t.id}>
              {a.baseline && t.date <= a.baseline && (i === 0 || arr[i - 1].date > a.baseline) && <div className="tx-day"><span>History through {fmtDate(a.baseline, 'long')} · not counted in the balance</span></div>}
              <div style={a.baseline && t.date <= a.baseline ? { opacity: 0.6 } : undefined}><TxnRow t={t} pov={a.id} onOpen={() => openModal({ type: 'txn', mode: 'view', id: t.id })} /></div>
            </div>
          ))}</div>
          {txns.length > limit && <div style={{ padding: 14, textAlign: 'center' }}><button className="btn" onClick={() => setLimit(limit + 25)}>Show more</button></div>}
        </section>
        <div className="rail">
          <div><div className="group-h"><h2>Reconciliation</h2></div>
            <div className="group">
              <div className="rowx"><div className="grow li-sub">Status</div><StaleBadge a={a} today={data.today} /></div>
              <div className="rowx"><div className="grow li-sub">Last verified</div><div className="small" style={{ fontWeight: 560 }}>{a.lastReconciled ? fmtDate(a.lastReconciled, 'long') : 'Never'}</div></div>
              {a.baseline && <div className="rowx"><div className="grow li-sub">Opening balance</div><div className="small num" style={{ fontWeight: 560 }}>{money(a.openingBalance ?? 0)} · {fmtDate(a.baseline)}</div></div>}
              {credit && a.limit && <div className="rowx"><div className="grow li-sub">Credit limit</div><div className="small num" style={{ fontWeight: 560 }}>{money(a.limit, { cents: false })}</div></div>}
              {data.reconciliations.filter((r) => r.accountId === a.id).slice(0, 3).map((r) => <div className="rowx" key={r.id}><div className="grow li-sub">{fmtDate(r.date)}</div><div className="small num">{r.diff === 0 ? 'matched' : `adjusted ${money(r.diff, { sign: true })}`}</div></div>)}
              {a.baseline && <div className="rowx" style={{ justifyContent: 'flex-end' }}><button className="btn sm" onClick={() => openModal({ type: 'cutover', id: a.id })}>Change opening balance</button></div>}
            </div>
            {a.derived != null && a.derived !== a.balance && (() => {
              const diff = a.balance - a.derived;
              const day = a.baseline ? txns.filter((t) => t.date === a.baseline && !t.adjustment) : [];
              const eff = day.reduce((n, t) => n + (credit ? -1 : 1) * txnDisplayAmount(data, t, a.id).v, 0);
              const explained = day.length > 0 && eff === diff;
              return <div style={{ marginTop: 10 }} data-testid="drift-note"><Callout tone="warn">{explained
                ? <>The recorded balance is <b className="num">{money(Math.abs(diff))}</b> {diff < 0 ? 'lower' : 'higher'} than the opening balance plus later transactions — exactly {day.length === 1 ? 'one transaction' : `${day.length} transactions`} dated on the opening-balance day ({day.map((t) => `${t.payee} ${money(t.amount)}`).join(', ')}). Reconcile against your bank to settle it.</>
                : <>Opening balance plus later transactions is <b className="num">{money(a.derived)}</b>; the recorded balance is <b className="num">{money(a.balance)}</b>. Reconcile against your bank to see which is right.</>}</Callout></div>;
            })()}
            {!a.baseline ? <div style={{ marginTop: 10 }}><Callout tone="warn">Not checked against your bank yet. Set the real opening balance to anchor it.</Callout></div>
              : st.level !== 'fresh' && <div style={{ marginTop: 10 }}><Callout>Balances are entered manually, so this may have drifted. A quick check takes under a minute.</Callout></div>}
          </div>
          {bills.length > 0 && <div><div className="group-h"><h2>Coming from this account</h2></div><div className="group">{bills.map((o) => (
            <button key={o.bill.id + o.date} className="rowx" onClick={() => openModal({ type: 'bill', billId: o.bill.id, date: o.date })}><div className="grow"><div className="li-title">{o.bill.name}</div><div className="li-sub">{fmtDate(o.date)}</div></div><div className="amt-md num"><Money v={o.bill.amount} /></div></button>))}</div></div>}
        </div>
      </div>
    </div>
  );
}

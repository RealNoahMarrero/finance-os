import { Plus, Landmark, ChevronRight, CircleCheck } from 'lucide-react';
import { useStore } from '../store';
import {
  cashCheck, cardsOwed, loansOwed, netWorth, netWorthSeries, upcomingBills, groupBills, allEnvelopes, overspent, readyToAssign, underfunded, monthlyFlow, usualSpend, type DataState, type Account,
} from '../data';
import { daysInMonth, diffDays, fmtDate, money, monthKey, parse, plural, sum } from '../lib';
import { Empty, Money } from '../ui';
import { PageHead, TxnRow } from '../shared';
import { BillList } from './Bills';

export interface Insight { id: string; tone: 'pos' | 'warn' | 'planned' | 'proj'; title: string; text: string; href?: string }
export function buildInsights(d: DataState): Insight[] {
  const out: Insight[] = [];
  const cur = monthKey(d.today);
  const frac = parse(d.today).getDate() / daysInMonth(cur);
  // 1) pace of the most over-pace flexible category
  const pace = allEnvelopes(d)
    .filter((e) => { const g = d.groups.find((x) => x.id === e.cat.groupId); return !!g && (g.kind === 'lifestyle' || g.kind === 'everyday') && e.env.spent > 0 && !e.cat.hidden; })
    .map((e) => ({ ...e, usual: usualSpend(d, e.cat.id), projected: Math.round(e.env.spent / frac) }))
    .filter((e) => e.usual > 0 && e.projected > e.usual * 1.25)
    .sort((a, b) => b.projected / b.usual - a.projected / a.usual)[0];
  if (pace) out.push({ id: 'pace', tone: 'warn', title: `${pace.cat.name} is running ahead of your usual`, text: `${money(pace.env.spent, { cents: false })} spent in ${Math.round(frac * daysInMonth(cur))} days — on pace for about ${money(pace.projected, { cents: false })} vs a usual ${money(pace.usual, { cents: false })}.`, href: '/insights' });
  // 2) unusually large purchase
  const recent = d.txns.filter((t) => t.type === 'expense' && !t.adjustment && diffDays(d.today, t.date) <= 12 && diffDays(d.today, t.date) >= 0);
  for (const t of recent) {
    const prior = d.txns.filter((x) => x.id !== t.id && x.payee === t.payee && x.type === 'expense' && x.date < t.date);
    if (prior.length >= 2) {
      const avg = sum(prior, (x) => x.amount) / prior.length;
      if (t.amount > avg * 2.5) { out.push({ id: 'unusual', tone: 'proj', title: `${t.payee} was larger than usual`, text: `${money(t.amount)} on ${fmtDate(t.date)} — about ${(t.amount / avg).toFixed(1)}× your typical ${money(Math.round(avg))} there.` }); break; }
    }
  }
  // 3) saving rate last full month
  const flow = monthlyFlow(d);
  const last = flow[flow.length - 2];
  if (last && last.income > 0) {
    const kept = last.income - last.expense;
    out.push({ id: 'saved', tone: 'pos', title: `You kept ${Math.round((kept / last.income) * 100)}% of last month’s income`, text: `${money(kept, { cents: false })} left after ${money(last.expense, { cents: false })} of spending in ${new Date(2000, parse(last.key + '-01').getMonth(), 1).toLocaleString('en', { month: 'long' })}.` });
  }
  const nw = netWorthSeries(d);
  const chg = nw[nw.length - 1].value - nw[0].value;
  if (out.length < 3 && d.txns.length > 20) out.push({ id: 'nw', tone: chg >= 0 ? 'pos' : 'warn', title: chg >= 0 ? 'Net worth is trending up' : 'Net worth is lower than a year ago', text: `${chg >= 0 ? 'Up' : 'Down'} about ${money(Math.abs(chg), { cents: false })} over twelve months (estimate from recorded income and spending).` });
  return out;
}

function Chip({ a }: { a: Account }) {
  const credit = a.type === 'credit';
  return (
    <a className={credit ? 'acct-chip debt' : 'acct-chip'} href={`#/accounts/${a.id}`} aria-label={`${a.name}, ${credit ? 'owed' : 'balance'} ${money(a.balance)}`}>
      <span className="xs muted ellipsis">{a.name}{credit ? ' · owed' : ''}</span>
      <span className="n num"><Money v={a.balance} /></span>
      {credit && a.limit ? <span className="xs muted">{Math.round((a.balance / a.limit) * 100)}% of {money(a.limit, { cents: false })}</span> : null}
    </a>
  );
}

/** The few things that need a person: missed bills, overspending, income that hasn't arrived, over-assignment. */
function Attention({ d }: { d: DataState }) {
  const { openModal } = useStore();
  const items: { id: string; tone: 'neg' | 'warn' | ''; title: string; sub: string; action: string; run: () => void }[] = [];
  const groups = groupBills(upcomingBills(d, 30)).filter((g) => g.missed > 0);
  for (const g of groups) items.push({ id: `b${g.bill.id}`, tone: 'neg', title: g.missed > 1 ? `${g.bill.name} · ${g.missed} payments missed` : `${g.bill.name} is overdue`, sub: `${money(g.total)} · since ${fmtDate(g.next.date)}`, action: 'Pay', run: () => openModal({ type: 'bill', billId: g.bill.id, date: g.next.date }) });
  for (const e of overspent(d)) items.push({ id: `o${e.cat.id}`, tone: 'warn', title: `${e.cat.name} is over by ${money(-e.env.avail)}`, sub: 'Cover it from Ready to Assign or another category', action: 'Cover', run: () => openModal({ type: 'move', to: e.cat.id, amount: -e.env.avail }) });
  const rta = readyToAssign(d);
  if (rta < 0) items.push({ id: 'rta', tone: 'warn', title: `${money(-rta)} more is set aside than you have`, sub: 'Move money back to Ready to Assign', action: 'Review', run: () => openModal({ type: 'move', to: 'rta', amount: -rta }) });
  for (const i of d.incomes.filter((x) => x.date <= d.today)) items.push({ id: `i${i.id}`, tone: '', title: `${i.label} hasn’t been marked received`, sub: `Expected ${fmtDate(i.date)} · ${money(i.amount)}`, action: 'Review', run: () => openModal({ type: 'income', mode: 'view', id: i.id }) });
  if (!items.length) return <div className="alert"><CircleCheck size={18} style={{ color: 'var(--pos)' }} /><div className="small">You’re all caught up.</div></div>;
  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      {items.slice(0, 4).map((x) => (
        <div key={x.id} className={`alert ${x.tone}`}>
          <div className="grow"><div className="li-title" style={{ fontSize: 14 }}>{x.title}</div><div className="li-sub ellipsis">{x.sub}</div></div>
          <button className={x.tone === 'neg' ? 'btn sm primary' : 'btn sm'} onClick={x.run}>{x.action}</button>
        </div>
      ))}
      {items.length > 4 && <div className="xs muted">+ {items.length - 4} more — see Bills and Budget</div>}
    </div>
  );
}

export function Overview() {
  const { data, openModal } = useStore();
  if (data.accounts.length === 0) return <Welcome />;

  const cc = cashCheck(data);
  const owed = cardsOwed(data), loans = loansOwed(data), position = netWorth(data);
  const cash = data.accounts.filter((a) => a.type !== 'credit');
  const cards = data.accounts.filter((a) => a.type === 'credit');
  const unverified = data.accounts.filter((a) => !a.baseline);
  const groups = groupBills(upcomingBills(data, 30)).slice(0, 4);
  const dueGroups = groupBills(upcomingBills(data, 14));
  const dueTotal = sum(dueGroups, (g) => g.occs.filter((o) => diffDays(o.date, data.today) <= 14).reduce((n, o) => n + o.bill.amount, 0));
  const overdueTotal = sum(dueGroups, (g) => g.total);
  const recent = data.txns.filter((t) => t.date <= data.today).slice(0, 5);
  const rta = cc.rta;
  const needs = underfunded(data).length;

  return (
    <div className="page">
      <PageHead title="Where you stand" sub={fmtDate(data.today, 'long')} />
      {unverified.length > 0 && (
        <div className="mini-banner" style={{ marginBottom: 16 }}>
          <span>{unverified.length === data.accounts.length ? 'No account balances are verified yet.' : `${plural(unverified.length, 'account')} not verified yet.`}</span>
          <button className="btn sm" onClick={() => openModal({ type: 'cutover' })}>Set opening balances</button>
        </div>
      )}
      <section className="card hero3" aria-label="Where you stand" data-testid="ov-summary">
        <div className="hero3-stats">
          <div className="hero-stat">
            <div className="eyebrow">Cash &amp; savings</div>
            <div className="amt-hero num" data-testid="ov-cash"><Money v={cc.cash} cents={false} /></div>
            <div className="small muted">Ready to assign <b className="num" style={{ color: 'var(--ink)' }}>{money(rta, { cents: false })}</b></div>
          </div>
          <div className="hero-stat">
            <div className="eyebrow">Due in the next 14 days</div>
            <div className={`amt-hero num ${dueGroups.some((g) => g.missed) ? 'neg' : ''}`} data-testid="ov-due"><Money v={dueTotal} cents={false} /></div>
            <div className="small muted">{dueGroups.length ? `${plural(dueGroups.length, 'bill')}${overdueTotal > 0 ? ` · ${money(overdueTotal, { cents: false })} overdue` : ''}` : 'Nothing due'}</div>
          </div>
          <div className="hero-stat">
            <div className="eyebrow">Net position</div>
            <div className="amt-hero num" data-testid="ov-position"><Money v={position} cents={false} /></div>
            <div className="small muted">Cards owed <b className="num" style={{ color: 'var(--ink)' }} data-testid="ov-owed">{money(owed, { cents: false })}</b>{loans > 0 && <> · loans <b className="num" style={{ color: 'var(--ink)' }}>{money(loans, { cents: false })}</b></>}</div>
          </div>
        </div>
        <div className="strip hero3-accts">{cash.map((a) => <Chip key={a.id} a={a} />)}{cards.map((a) => <Chip key={a.id} a={a} />)}</div>
      </section>

      <div className="home-grid">
        <div>
          <section className="card pad" aria-label="Coming up">
            <div className="sect-head"><h2 className="sect-title">Coming up</h2><a className="sect-link" href="#/bills">All bills<ChevronRight size={14} /></a></div>
            {groups.length ? <BillList groups={groups} compact /> : <div className="small muted">Nothing due in the next 30 days.</div>}
          </section>
          <section className="card pad" aria-label="Recent activity">
            <div className="sect-head"><h2 className="sect-title">Recent activity</h2><a className="sect-link" href="#/activity">All activity<ChevronRight size={14} /></a></div>
            {recent.length ? <div className="list">{recent.map((t) => <TxnRow key={t.id} t={t} onOpen={() => openModal({ type: 'txn', mode: 'view', id: t.id })} />)}</div> : <div className="small muted">No transactions yet.</div>}
          </section>
        </div>
        <div>
          <section className="card pad" aria-label="Needs attention">
            <div className="sect-head"><h2 className="sect-title">Needs attention</h2></div>
            <Attention d={data} />
          </section>
          <section className="card pad" aria-label="Budget" data-testid="ov-budget">
            <div className="sect-head"><h2 className="sect-title">Budget</h2><a className="sect-link" href="#/budget">Open budget<ChevronRight size={14} /></a></div>
            <div className="eyebrow">{rta < 0 ? 'Over-assigned' : 'Ready to assign'}</div>
            <div className="row between" style={{ marginTop: 6, gap: 12 }}>
              <div className={`amt-xl num ${rta < 0 ? 'neg' : 'c-planned'}`} data-testid="ov-rta-value"><Money v={rta} /></div>
              <button className="btn primary sm" data-testid="ov-rta-action" onClick={() => openModal(rta < 0 ? { type: 'move', to: 'rta', amount: -rta } : { type: 'move', from: 'rta' })}>Move money</button>
            </div>
            <div className="small muted" style={{ marginTop: 10 }}>{needs > 0 ? `${plural(needs, 'category', 'categories')} still need funding` : 'Every target is funded'}{overspent(data).length ? ` · ${overspent(data).length} over` : ''}</div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Welcome() {
  const { openModal } = useStore();
  return (
    <div className="page">
      <PageHead title="Welcome to Finances" sub="A calm place for your household money." />
      <div className="card" style={{ maxWidth: 640 }}>
        <Empty icon={<Landmark />} title="Start with an account" text="Add the account you use most — checking is a good first one."
          action={<button className="btn primary" onClick={() => openModal({ type: 'account-add' })}><Plus />Add your first account</button>} />
      </div>
    </div>
  );
}

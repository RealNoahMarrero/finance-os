import { Plus, Landmark, ChevronRight, CircleCheck } from 'lucide-react';
import { useStore } from '../store';
import {
  cashCheck, cardsOwed, loansOwed, netWorth, netWorthSeries, upcomingBills, groupBills, allEnvelopes, overspent, readyToAssign, underfunded, monthlyFlow, usualSpend, expectedIncomeSummary, type DataState, type Account,
} from '../data';
import { daysInMonth, diffDays, fmtDate, money, monthKey, parse, plural, sum } from '../lib';
import { Empty, Money, StatusPill } from '../ui';
import { PageHead, TxnRow } from '../shared';
import { BillList } from './PlanPage';

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
  void netWorthSeries;
  return out;
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
  for (const i of d.incomes.filter((x) => x.date <= d.today)) items.push({ id: `i${i.id}`, tone: '', title: `${i.label} hasn’t been marked received`, sub: `Awaiting confirmation · originally ${fmtDate(i.date)} · ${money(i.amount)}`, action: 'Review', run: () => openModal({ type: 'income', mode: 'view', id: i.id }) });
  if (!items.length) return <div className="group"><div className="rowx"><CircleCheck size={18} style={{ color: 'var(--pos)' }} /><div className="grow small">You’re all caught up.</div></div></div>;
  return (
    <div className="group" data-testid="attention">
      {items.slice(0, 4).map((x) => (
        <div key={x.id} className="rowx">
          <div className="grow"><div className="li-title" style={{ fontSize: 14, color: x.tone === 'neg' ? 'var(--neg)' : undefined }}>{x.title}</div><div className="li-sub ellipsis">{x.sub}</div></div>
          <button className={x.tone === 'neg' ? 'btn sm primary' : 'btn sm'} onClick={x.run}>{x.action}</button>
        </div>
      ))}
      {items.length > 4 && <div className="rowx xs muted">+ {items.length - 4} more in Plan</div>}
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
  const inc = expectedIncomeSummary(data, 30);
  const accountRow = (a: Account) => {
    const credit = a.type === 'credit';
    return (
      <a key={a.id} className="rowx" href={`#/accounts/${a.id}`} aria-label={`${a.name}, ${credit ? 'owed' : 'balance'} ${money(a.balance)}`}>
        <div className="grow"><div className="li-title">{a.name}</div><div className="li-sub">{credit ? (a.limit ? `Owed · ${Math.round((a.balance / a.limit) * 100)}% of ${money(a.limit, { cents: false })}` : 'Owed') : a.type[0].toUpperCase() + a.type.slice(1)}</div></div>
        <div className="amt-md num"><Money v={a.balance} /></div><ChevronRight size={16} className="muted" />
      </a>
    );
  };

  return (
    <div className="page">
      <PageHead title="Home" sub={fmtDate(data.today, 'long')} />
      {unverified.length > 0 && (
        <div className="mini-banner" style={{ marginBottom: 14 }}>
          <span>{unverified.length === data.accounts.length ? 'No account balances are verified yet.' : `${plural(unverified.length, 'account')} not verified yet.`}</span>
          <button className="btn sm" onClick={() => openModal({ type: 'cutover' })}>Set opening balances</button>
        </div>
      )}
      <section className="home-top" aria-label="Summary" data-testid="ov-summary">
        <div className="stat"><div className="eyebrow">Cash &amp; savings</div><div className="amt-xl num" data-testid="ov-cash"><Money v={cc.cash} cents={false} /></div></div>
        <div className="stat"><div className="eyebrow">Ready to assign</div><div className={`amt-xl num ${rta < 0 ? 'neg' : ''}`} data-testid="ov-rta-value"><Money v={rta} cents={false} /></div>
          <div className="row gap8"><button className="sect-link" data-testid="ov-rta-action" onClick={() => openModal(rta < 0 ? { type: 'move', to: 'rta', amount: -rta } : { type: 'move', from: 'rta' })}>Move money</button><a className="sect-link" href="#/plan">Open plan</a></div></div>
        <div className="stat"><div className="eyebrow">Due in 14 days</div><div className={`amt-xl num ${dueGroups.some((g) => g.missed) ? 'neg' : ''}`} data-testid="ov-due"><Money v={dueTotal} cents={false} /></div>
          <div className="small muted">{dueGroups.length ? `${plural(dueGroups.length, 'item')}${overdueTotal > 0 ? ` · ${money(overdueTotal, { cents: false })} overdue` : ''}` : 'Nothing due'}</div></div>
      </section>

      <div className="home-grid" style={{ marginTop: 22 }}>
        <div>
          <div className="group-h"><h2>Upcoming</h2><a className="sect-link" href="#/plan">Plan<ChevronRight size={14} /></a></div>
          {groups.length ? <BillList groups={groups} /> : <div className="group pad small muted">Nothing due in the next 30 days.</div>}

          <div className="group-h"><h2>Expected income</h2>
            <span className="row gap12"><button className="sect-link" onClick={() => openModal({ type: 'income', mode: 'add' })}>Add</button><a className="sect-link" href="#/plan?view=income" data-testid="ov-income-all">View all<ChevronRight size={14} /></a></span></div>
          <section data-testid="ov-income" aria-label="Expected income">
            {inc.rows.length === 0 ? (
              <div className="group pad small muted">Nothing expected in the next 30 days. Add a paycheck or invoice to see money coming in next to what’s going out.</div>
            ) : (<>
              <div className="group">
                <div className="rowx"><div className="grow"><div className="eyebrow">Pending · next 30 days</div><div className="amt-lg num" data-testid="ov-income-total"><Money v={inc.total} cents={false} /></div></div>
                  <div className="right small"><div>Guaranteed <b className="num" data-testid="ov-income-g">{money(inc.guaranteed, { cents: false })}</b></div><div className="muted">Anticipated <b className="num" data-testid="ov-income-a">{money(inc.anticipated, { cents: false })}</b></div></div></div>
                {inc.overdue.length > 0 && <div className="rowx" style={{ background: 'var(--warn-soft)' }}><div className="grow small"><b>{plural(inc.overdue.length, 'entry', 'entries')} awaiting confirmation</b> · {money(inc.overdueTotal, { cents: false })}, shown as arriving today</div></div>}
                {inc.rows.slice(0, 5).map((r) => (
                  <button key={r.id + r.date} className="rowx" onClick={() => openModal({ type: 'income', mode: 'view', id: r.id })}>
                    <div className={`datebox ${r.overdue ? 'late' : 'proj'}`}><b className="num">{fmtDate(r.date, 'day')}</b><span>{fmtDate(r.date).split(' ')[0]}</span></div>
                    <div className="grow"><div className="row gap8"><span className="li-title ellipsis">{r.label}</span>{r.overdue && <StatusPill status="warn">Confirm</StatusPill>}</div>
                      <div className="li-sub ellipsis">{r.overdue ? `Awaiting confirmation · originally ${fmtDate(r.originalDate!)}` : fmtDate(r.date)}{r.repeats ? ' · repeats' : ''}</div></div>
                    <div className="right"><div className="amt-md num pos">+{money(r.amount, { cents: false })}</div><div className="xs muted">{r.certainty === 'guaranteed' ? 'Guaranteed' : 'Anticipated'}</div></div>
                  </button>
                ))}
              </div>
              {inc.rows.length > 5 && <div className="xs muted" style={{ margin: '6px 4px 0' }}>+ {inc.rows.length - 5} more in the full view</div>}
              <div className="xs muted" style={{ margin: '8px 4px 0' }}>Pending, not received: not in your balances or Ready to Assign until you mark it received.</div>
            </>)}
          </section>
        </div>

        <div>
          <div className="group-h"><h2>Needs attention</h2></div>
          <Attention d={data} />

          <div className="group-h"><h2>Accounts</h2><a className="sect-link" href="#/accounts">All<ChevronRight size={14} /></a></div>
          <div className="group">
            {cash.map(accountRow)}
            {cards.map(accountRow)}
            <div className="rowx" style={{ background: 'var(--surface-2)' }}><div className="grow li-sub">Net worth{owed > 0 || loans > 0 ? ` · after ${money(owed + loans, { cents: false })} owed` : ''}</div><div className="small num" style={{ fontWeight: 600 }} data-testid="ov-position"><Money v={position} cents={false} /></div></div>
          </div>
          <span hidden data-testid="ov-owed">{money(owed)}</span>

          <div className="group-h"><h2>Recent activity</h2><a className="sect-link" href="#/activity">All<ChevronRight size={14} /></a></div>
          {recent.length ? <div className="group">{recent.map((t) => <TxnRow key={t.id} t={t} onOpen={() => openModal({ type: 'txn', mode: 'view', id: t.id })} />)}</div> : <div className="group pad small muted">No transactions yet.</div>}
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

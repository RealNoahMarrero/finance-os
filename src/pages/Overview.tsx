import { Plus, ChevronRight, Landmark } from 'lucide-react';
import { useStore } from '../store';
import {
  cashCheck, cardsOwed, loansOwed, netWorth, netWorthSeries, upcomingBills, billOccurrences, incomeOccurrences, allEnvelopes, envelope, totalAvail, monthlyFlow, usualSpend, type DataState, type Account,
} from '../data';
import { addDays, compact, daysInMonth, diffDays, fmtDate, money, monthKey, monthLabel, parse, plural, sum } from '../lib';
import { Empty, Money, StatusPill } from '../ui';
import { BillRow, PageHead, ReadyToAssignCard, TxnRow } from '../shared';

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
      if (t.amount > avg * 2.5) { out.push({ id: 'unusual', tone: 'proj', title: `${t.payee} was larger than usual`, text: `${money(t.amount)} on ${fmtDate(t.date)} — about ${(t.amount / avg).toFixed(1)}× your typical ${money(Math.round(avg))} there. Worth a glance if it wasn’t expected.` }); break; }
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
  if (out.length < 3 && d.txns.length > 20) out.push({ id: 'nw', tone: chg >= 0 ? 'pos' : 'warn', title: chg >= 0 ? 'Net worth is trending up' : 'Net worth is lower than a year ago', text: `${chg >= 0 ? 'Up' : 'Down'} ${money(Math.abs(chg), { cents: false })} over twelve months, based on recorded income and spending.` });
  return out;
}

export function Overview() {
  const { data, openModal } = useStore();
  if (data.accounts.length === 0) return <Welcome />;

  const cc = cashCheck(data);
  const owed = cardsOwed(data);
  const loans = loansOwed(data);
  const position = netWorth(data);
  const cash = data.accounts.filter((a) => a.type !== 'credit');
  const cards = data.accounts.filter((a) => a.type === 'credit');
  const unverified = data.accounts.filter((a) => !a.baseline);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const bills = upcomingBills(data, 30).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const overdue = bills.filter((o) => o.status === 'overdue').length;
  const monthStart = `${monthKey(data.today)}-01`;
  const paidCount = billOccurrences(data, monthStart, data.today).filter((o) => o.paid).length;
  const recent = data.txns.filter((t) => t.date <= data.today).slice(0, 5);

  const flow = monthlyFlow(data);
  const thisMonth = flow[flow.length - 1];
  const inEnvelopes = totalAvail(data);
  const hasBudget = data.categories.some((c) => !c.hidden && (c.target || envelope(data, c.id).assigned > 0));

  // Expected income: entries whose date has arrived but aren't marked received ("waiting"), plus everything scheduled for the next 30 days.
  const exp = incomeOccurrences(data, addDays(data.today, 1), addDays(data.today, 30));
  const waiting = data.incomes.filter((i) => i.date <= data.today).sort((x, y) => x.date.localeCompare(y.date));
  const allExp = [...waiting, ...exp];
  const expTotal = sum(waiting, (i) => i.amount) + sum(exp, (o) => o.amount);
  const incRow = (key: string, label: string, date: string, amount: number, cert: 'guaranteed' | 'anticipated', late: boolean, repeats?: boolean) => (
    <button key={key} className="li" onClick={() => openModal({ type: 'income', mode: 'view', id: key.replace(/\d{4}-\d\d-\d\d$/, '') })}>
      <div className="grow"><div className="li-title ellipsis">{label}</div><div className="li-sub">{fmtDate(date)}{late ? ' · past expected date' : ''}{repeats ? ' · repeats' : ''}</div></div>
      <div className="right stack" style={{ alignItems: 'flex-end', gap: 3 }}><Money v={amount} className="amt-md" /><StatusPill status={cert === 'guaranteed' ? 'planned' : 'muted'}>{cert === 'guaranteed' ? 'Guaranteed' : 'Anticipated'}</StatusPill></div>
    </button>
  );

  const tile = (a: Account) => {
    const credit = a.type === 'credit';
    const util = credit && a.limit ? a.balance / a.limit : 0;
    return (
      <a key={a.id} className="ov-tile" href={`#/accounts/${a.id}`} aria-label={`${a.name}, ${credit ? 'owed' : 'balance'} ${money(a.balance)}`}>
        <div className="row between"><span className="li-sub ellipsis">{a.name}</span><ChevronRight size={14} className="muted" /></div>
        <div className="amt-xl num"><Money v={a.balance} /></div>
        <div className="xs muted">{credit ? (a.limit ? `Owed · ${Math.round(util * 100)}% of ${compact(a.limit)} limit` : 'Owed') : a.type[0].toUpperCase() + a.type.slice(1)}</div>
      </a>
    );
  };

  return (
    <div className="page">
      <PageHead
        title={`${greeting}, Noah`}
        sub={fmtDate(data.today, 'long')}
        actions={<button className="btn primary desktop-only" onClick={() => openModal({ type: 'txn', mode: 'add' })}><Plus />Add transaction</button>}
      />
      {unverified.length > 0 && (
        <div className="card pad setup-banner" style={{ marginBottom: 16 }}>
          <div><div className="li-title">Finish setup: verify your balances</div>
            <div className="small muted" style={{ maxWidth: 620 }}>{unverified.length === data.accounts.length ? 'None of your accounts are verified yet.' : `${unverified.length} of ${data.accounts.length} accounts aren’t verified yet.`} Pick a cutover date and enter each real balance. Past transactions stay saved — nothing is deleted or guessed.</div></div>
          <button className="btn primary" onClick={() => openModal({ type: 'cutover' })}>Set opening balances</button>
        </div>
      )}

      <div style={{ marginBottom: 16 }}><ReadyToAssignCard testid="ov-rta" compact /></div>
      <section className="card pad ov-sum" aria-label="Where you stand" data-testid="ov-summary">
        <div><div className="eyebrow">Cash &amp; savings</div><div className="amt-xl num" data-testid="ov-cash"><Money v={cc.cash} /></div><div className="xs muted">In your accounts</div></div>
        <div><div className="eyebrow">Owed on cards</div><div className="amt-xl num" data-testid="ov-owed"><Money v={owed} /></div><div className="xs muted">{cards.length ? `${plural(cards.length, 'card')}` : 'No cards'}</div></div>
        <div><div className="eyebrow">Overall</div><div className="amt-xl num" data-testid="ov-position"><Money v={position} /></div><div className="xs muted">{loans > 0 ? 'After cards and loans' : 'After cards'}</div></div>
      </section>

      <section style={{ marginTop: 24 }} aria-label="Accounts">
        <div className="sect-head"><h2 className="sect-title">Accounts</h2><a className="sect-link" href="#/accounts">All accounts<ChevronRight size={14} /></a></div>
        <div className="ov-tiles">{cash.map(tile)}</div>
        {cards.length > 0 && (<>
          <div className="eyebrow" style={{ margin: '16px 0 8px' }}>Credit cards · money you owe</div>
          <div className="ov-tiles">{cards.map(tile)}</div>
        </>)}
        <div className="xs muted" style={{ marginTop: 10 }}>Balances are what you’ve recorded — not a live bank connection.</div>
      </section>

      <div className="ov-cols">
        <section className="card pad" aria-label="Upcoming bills">
          <div className="sect-head"><h2 className="sect-title">Upcoming bills{overdue > 0 && <StatusPill status="late">{overdue} overdue</StatusPill>}</h2><a className="sect-link" href="#/plan/bills">See all bills<ChevronRight size={14} /></a></div>
          {bills.length ? <div className="list">{bills.map((o) => <BillRow key={o.bill.id + o.date} o={o} simple onOpen={() => openModal({ type: 'bill', billId: o.bill.id, date: o.date })} />)}</div>
            : <div className="small muted">Nothing due in the next 30 days.</div>}
          {paidCount > 0 && <div className="xs muted" style={{ marginTop: 10 }}>{plural(paidCount, 'bill')} marked paid this month. Money set aside for a bill isn’t counted as paid.</div>}
        </section>

        <section className="card pad" aria-label="Recent transactions">
          <div className="sect-head"><h2 className="sect-title">Recent transactions</h2><a className="sect-link" href="#/transactions">All transactions<ChevronRight size={14} /></a></div>
          {recent.length ? <div className="list">{recent.map((t) => <TxnRow key={t.id} t={t} onOpen={() => openModal({ type: 'txn', mode: 'view', id: t.id })} />)}</div>
            : <div className="small muted">No transactions yet.</div>}
          <button className="btn" style={{ marginTop: 12 }} onClick={() => openModal({ type: 'txn', mode: 'add' })}><Plus />Add transaction</button>
        </section>
      </div>

      <div className="ov-cols">
        <section className="card pad" aria-label="Budget this month" data-testid="ov-budget">
          <div className="sect-head"><h2 className="sect-title">Budget this month</h2><a className="sect-link" href="#/plan/budget">Open budget<ChevronRight size={14} /></a></div>
          <div className="kv"><span className="k">Spent so far in {monthLabel(monthKey(data.today))}</span><span className="v num">{money(thisMonth.expense)}</span></div>
          {hasBudget
            ? <div className="kv"><span className="k">Left in your budget categories</span><span className="v num">{money(inEnvelopes)}</span></div>
            : <div className="small muted" style={{ marginTop: 6 }}>No category budgets set. Budgeting is optional — add one whenever it helps.</div>}
          {cc.overAssigned > 0 && <div className="xs muted" style={{ marginTop: 10 }}>Your categories hold {money(cc.overAssigned)} more than the {money(cc.cash)} in your accounts, so nothing is unassigned. Nothing was changed automatically.</div>}
        </section>

        <section className="card pad" aria-label="Expected income" data-testid="ov-income">
          <div className="sect-head"><h2 className="sect-title">Expected income</h2><span className="row gap12"><button className="sect-link" onClick={() => openModal({ type: 'income', mode: 'add' })}><Plus size={14} />Add</button><a className="sect-link" href="#/plan/income">All income<ChevronRight size={14} /></a></span></div>
          {allExp.length === 0 ? <div className="small muted">No expected income is recorded. Use Add to plan for a paycheck or invoice.</div> : (<>
            <div className="amt-xl num" data-testid="ov-income-total"><Money v={expTotal} /></div>
            <div className="xs muted" style={{ marginBottom: 8 }}>
              {exp.length > 0 && <>{money(sum(exp, (o) => o.amount))} in the next 30 days</>}{exp.length > 0 && waiting.length > 0 && ' · '}{waiting.length > 0 && <>{money(sum(waiting, (i) => i.amount))} past its expected date</>}. Not received yet and not in your balances.</div>
            <div className="list">
              {waiting.map((i) => incRow(i.id, i.label, i.date, i.amount, i.certainty, true))}
              {exp.map((o) => incRow(o.inc.id + o.date, o.inc.label, o.date, o.amount, o.inc.certainty, false, o.inc.repeat !== 'none'))}
            </div>
            {waiting.length > 0 && <div className="xs muted" style={{ marginTop: 8 }}>Entries past their date are still marked pending. Open one to mark it received or not coming.</div>}
            {exp.length === 0 && <div className="xs muted" style={{ marginTop: 8 }}>Nothing else is scheduled in the next 30 days.</div>}
          </>)}
        </section>
      </div>
    </div>
  );
}

function Welcome() {
  const { openModal } = useStore();
  return (
    <div className="page">
      <PageHead title="Welcome to Finances" sub="A calm place for your household money. Let’s set up three things." />
      <div className="card" style={{ maxWidth: 640 }}>
        <Empty icon={<Landmark />} title="Start with an account" text="Add the account you use most — checking is a good first one. Balances are entered by you and checked against your bank whenever you like."
          action={<button className="btn primary" onClick={() => openModal({ type: 'account-add' })}><Plus />Add your first account</button>} />
        <div className="list">
          {[['1', 'Add accounts', 'Checking, savings, cash, cards'], ['2', 'Give every dollar a job', 'Create envelopes and optional monthly targets'], ['3', 'Plan bills & income', 'See what’s coming before it arrives']].map(([n, t, s]) => (
            <div key={n} className="li"><div className="li-ico planned num" style={{ fontWeight: 650 }}>{n}</div><div className="grow"><div className="li-title">{t}</div><div className="li-sub">{s}</div></div></div>
          ))}
        </div>
      </div>
    </div>
  );
}

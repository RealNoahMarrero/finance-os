import { useMemo, useState } from 'react';
import { Plus, ChevronRight, Info, TrendingUp, Landmark, CircleCheck, Lightbulb, Wallet } from 'lucide-react';
import { useStore } from '../store';
import {
  buckets, buildForecast, shortfall, netWorth, netWorthSeries, upcomingBills, incomeOccurrences, allEnvelopes, envelope, spendingTotal, staleness,
  monthlyFlow, usualSpend, type DataState,
} from '../data';
import { addDays, compact, daysInMonth, diffDays, fmtDate, mon, money, monthKey, parse, plural, sum, cn } from '../lib';
import { Callout, Empty, Money, Seg, StatusPill } from '../ui';
import { ForecastChart, ForecastLegend } from '../charts';
import { AttnRow, BillRow, PageHead, TxnRow, attentionItems } from '../shared';
import { Ring } from '../charts';

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

const URGENCY = (id: string) => (id.startsWith('od-') ? 0 : id === 'short' ? 1 : id.startsWith('os-') ? 2 : id.startsWith('uf-') ? 3 : id === 'rta' ? 8 : 9);

export function Overview() {
  const { data, openModal } = useStore();
  const [scenario, setScenario] = useState<'conservative' | 'both'>('conservative');
  const [showAll, setShowAll] = useState(false);
  const forecast = useMemo(() => buildForecast(data, 365), [data]);
  if (data.accounts.length === 0) return <Welcome />;

  const b = buckets(data);
  const nw = netWorth(data);
  const nwSeries = netWorthSeries(data);
  const nwDelta = nw - nwSeries[0].value;
  const attn = attentionItems(data).sort((a, c) => URGENCY(a.id) - URGENCY(c.id));
  const urgent = attn.filter((a) => URGENCY(a.id) < 8);
  const top = urgent.slice(0, 3);
  const rest = attn.filter((a) => !top.includes(a));
  const bills = upcomingBills(data, 21).slice(0, 4);
  const sf = shortfall(forecast, 30);
  const next30 = incomeOccurrences(data, addDays(data.today, 1), addDays(data.today, 30));
  const g30 = sum(next30.filter((o) => o.inc.certainty === 'guaranteed'), (o) => o.amount);
  const a30 = sum(next30.filter((o) => o.inc.certainty === 'anticipated'), (o) => o.amount);
  const recent = data.txns.filter((t) => t.date <= data.today).slice(0, 5);
  const stale = data.accounts.filter((a) => staleness(a, data.today).level === 'stale');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const envs = allEnvelopes(data).filter((e) => !e.cat.hidden);
  const unverified = data.accounts.filter((a) => !a.baseline);
  const withTarget = envs.filter((e) => e.cat.target);
  const tgtTotal = sum(withTarget, (e) => e.cat.target!);
  const funded = sum(withTarget, (e) => Math.min(e.cat.target!, e.env.assigned));
  const fundedPct = tgtTotal ? funded / tgtTotal : 0;
  const overs = envs.filter((e) => e.env.avail < 0);
  const underCount = envs.filter((e) => e.env.remaining > 0).length;
  const insights = buildInsights(data).slice(0, 2);

  const total = Math.max(1, b.committed + Math.max(0, b.flexible) + Math.max(0, b.rta));
  const seg = (v: number) => Math.max(0, v) / total;

  return (
    <div className="page wide">
      <PageHead
        title={`${greeting}, Noah`}
        sub={`${fmtDate(data.today, 'long')}`}
        actions={<button className="btn primary desktop-only" onClick={() => openModal({ type: 'txn', mode: 'add' })}><Plus />Add transaction</button>}
      />
      {unverified.length > 0 && (
        <div className="card pad setup-banner fade-in" style={{ marginBottom: 16 }}>
          <div><div className="li-title">Finish setup: verify your balances</div>
            <div className="small muted" style={{ maxWidth: 620 }}>{unverified.length === data.accounts.length ? 'None of your accounts are verified yet.' : `${unverified.length} of ${data.accounts.length} accounts aren’t verified yet.`} Pick a cutover date and enter each real balance. All {plural(data.txns.length, 'past transaction')} stay saved and searchable — nothing is deleted or guessed.</div></div>
          <button className="btn primary" onClick={() => openModal({ type: 'cutover' })}>Set opening balances</button>
        </div>
      )}
      <div className="grid g12 ov">
        {/* L1 · Financial position ─────────────── */}
        <section className="card hero fade-in" style={{ gridColumn: '1 / span 7', gridRow: 1, alignSelf: showAll ? 'start' : 'stretch' }} aria-label="Money summary">
          <div className="eyebrow row gap8">Available to spend <span className="pill" title="Money in your everyday and lifestyle envelopes"><Info />after bills &amp; goals</span></div>
          <div className="amt-hero num" style={{ marginTop: 8 }}><Money v={b.flexible} /></div>
          <div className="small muted" style={{ marginTop: 6 }}>
            What’s left in your everyday &amp; lifestyle envelopes.
            {overs.length > 0 && <> <a href="#/budget" className="neg" style={{ fontWeight: 600 }}>{overs.length === 1 ? `${overs[0].cat.name} is overspent` : `${overs.length} envelopes overspent`}.</a></>}
          </div>
          <div style={{ marginTop: 22 }}>
            <div className="stackbar" role="img" aria-label={`Of ${money(b.total)} in your accounts: ${money(b.committed)} committed, ${money(b.flexible)} spendable, ${money(b.rta)} ready to assign`}>
              <i style={{ flexGrow: seg(b.committed), background: 'var(--ink-2)' }} />
              <i style={{ flexGrow: seg(b.flexible), background: 'var(--pos)' }} />
              <i style={{ flexGrow: seg(b.rta), background: 'var(--planned)' }} />
            </div>
            <div className="hero-metrics">
              <a href="#/budget" className="hero-metric"><div className="k"><i className="sw" style={{ background: 'var(--ink-2)' }} />Committed<span className="long">&nbsp;to bills &amp; goals</span></div><Money v={b.committed} className="amt-md num" /></a>
              <a href="#/budget" className="hero-metric"><div className="k"><i className="sw" style={{ background: 'var(--pos)' }} />Spendable</div><Money v={b.flexible} className="amt-md num" /></a>
              <button className="hero-metric" style={{ textAlign: 'left' }} onClick={() => openModal({ type: 'assign' })}><div className="k"><i className="sw" style={{ background: 'var(--planned)' }} />Ready to Assign</div><Money v={b.rta} className="amt-md num c-planned" /></button>
            </div>
          </div>
          <div className="hero-foot">
            <a href="#/accounts" className="small muted">Net worth <b className="num" style={{ color: 'var(--ink-2)' }}>{money(nw, { cents: false })}</b> <span className={nwDelta >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 600 }}>{nwDelta >= 0 ? '↗' : '↘'} {compact(Math.abs(nwDelta))} in 12 mo</span></a>
            {stale.length > 0 && <a href="#/accounts" className="small" style={{ color: 'var(--warn)', fontWeight: 600 }}>{stale.map((a) => a.name).join(', ')} not checked in {staleness(stale[0], data.today).days}+ days</a>}
          </div>
        </section>

        {/* L2 · Immediate priorities ───────────── */}
        <section className="card" style={{ gridColumn: '8 / span 5', gridRow: 1 }} aria-label="Needs attention">
          <div className="pad" style={{ paddingBottom: 6 }}>
            <div className="sect-head" style={{ marginBottom: 0 }}><h2 className="sect-title">Needs attention</h2>
              {rest.length > 0 && <button className="sect-link" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>{showAll ? 'Show less' : `View all ${attn.length}`}<ChevronRight size={14} style={{ transform: showAll ? 'rotate(-90deg)' : 'rotate(90deg)' }} /></button>}
            </div>
          </div>
          {top.length === 0 ? <div className="pad small muted" style={{ paddingTop: 4 }}><CircleCheck size={15} style={{ verticalAlign: -3, marginRight: 6, color: 'var(--pos)' }} />Nothing urgent — no overdue bills, shortfalls or overspending.</div>
            : <div className="list">{top.map((a) => <AttnRow key={a.id} a={a} />)}</div>}
          {showAll && rest.length > 0 && (
            <div className="fade-in">
              <div className="xs muted" style={{ padding: '10px 20px 4px', fontWeight: 650, letterSpacing: '.05em', textTransform: 'uppercase' }}>Also on your radar</div>
              <div className="list">{rest.map((a) => <AttnRow key={a.id} a={a} />)}</div>
            </div>
          )}
        </section>

        {/* Bills (mobile: right after priorities) ─ */}
        <section className="card" style={{ gridColumn: '8 / span 5', gridRow: 2 }} aria-label="Upcoming bills">
          <div className="pad" style={{ paddingBottom: 4 }}>
            <div className="sect-head"><h2 className="sect-title">Upcoming bills</h2><a className="sect-link" href="#/plan/bills">View all<ChevronRight size={14} /></a></div>
          </div>
          <div className="list">{bills.map((o, i) => <div key={o.bill.id + o.date} className={i === 3 ? 'd-only' : undefined}><BillRow o={o} onOpen={() => openModal({ type: 'bill', billId: o.bill.id, date: o.date })} /></div>)}</div>
        </section>

        {/* Income (mobile: next) ─────────────── */}
        <section className="card" style={{ gridColumn: '1 / span 4', gridRow: 3 }} aria-label="Expected income">
          <div className="pad" style={{ paddingBottom: 12 }}>
            <div className="sect-head"><h2 className="sect-title">Expected income <StatusPill status="proj">Projected</StatusPill></h2><a className="sect-link" href="#/plan/income">Details<ChevronRight size={14} /></a></div>
            <div className="row gap16">
              <div className="grow"><div className="eyebrow">Guaranteed · 30d</div><div className="amt-lg num c-proj" style={{ marginTop: 4 }}><Money v={g30} cents={false} /></div></div>
              <div className="grow"><div className="eyebrow">Anticipated · 30d</div><div className="amt-lg num c-proj" style={{ marginTop: 4, opacity: 0.75, borderBottom: '1.5px dashed var(--proj)', display: 'inline-block' }}><Money v={a30} cents={false} /></div></div>
            </div>
          </div>
          <div className="list">
            {next30.slice(0, 3).map((o, i) => (
              <button key={o.inc.id + o.date} className={cn('li', i === 2 && 'd-only')} onClick={() => openModal({ type: 'income', mode: 'view', id: o.inc.id })}>
                <div className="datebox proj"><b className="num">{fmtDate(o.date, 'day')}</b><span>{mon(o.date)}</span></div>
                <div className="grow"><div className="li-title ellipsis">{o.inc.label}</div><div className="li-sub">{o.inc.certainty === 'guaranteed' ? 'Guaranteed' : 'Anticipated'}</div></div>
                <div className="right"><div className="amt-md num c-proj" style={{ borderBottom: o.inc.certainty === 'anticipated' ? '1.5px dashed var(--proj)' : 'none', display: 'inline-block' }}>+<Money v={o.amount} cents={false} /></div></div>
              </button>
            ))}
          </div>
          <div className="xs muted" style={{ padding: '10px 20px 14px' }}>Not in your accounts until you confirm it arrived.</div>
        </section>

        {/* Forecast ─────────────────────────── */}
        <section className="card pad" style={{ gridColumn: '1 / span 7', gridRow: 2 }} aria-label="30-day forecast">
          <div className="sect-head">
            <div>
              <h2 className="sect-title">Next 30 days <StatusPill status="proj">Projected</StatusPill></h2>
              <div className="small muted" style={{ marginTop: 2 }}>Checking &amp; cash · recorded to today, projected after{unverified.length > 0 ? ' · balances not yet verified' : ''}</div>
            </div>
            <div className="row gap8"><Seg value={scenario} onChange={setScenario} options={[{ v: 'conservative', label: 'Guaranteed' }, { v: 'both', label: '+ Anticipated' }]} /></div>
          </div>
          <ForecastChart f={forecast} horizon={30} scenario={scenario} today={data.today} height={188} />
          <div style={{ marginTop: 8 }}><ForecastLegend scenario={scenario} /></div>
          <div className="small" style={{ marginTop: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            {sf.min.balance < 0
              ? <><b style={{ color: 'var(--warn)' }}>Possible shortfall</b> — with guaranteed income only, cash could dip to <b className="num">{money(sf.min.balance, { cents: false })}</b> around {fmtDate(sf.min.date)}. </>
              : <>Cash stays above $0 for the next 30 days, with a low of <b className="num">{money(sf.min.balance, { cents: false })}</b> around {fmtDate(sf.min.date)}. </>}
            <a href="#/plan/forecast" style={{ fontWeight: 650, textDecoration: 'underline' }}>Full forecast</a>
          </div>
        </section>

        {/* Recent ───────────────────────────── */}
        <section className="card" style={{ gridColumn: '5 / span 4', gridRow: 3 }} aria-label="Recent transactions">
          <div className="pad" style={{ paddingBottom: 4 }}>
            <div className="sect-head"><h2 className="sect-title">Recent activity</h2><a className="sect-link" href="#/transactions">View all<ChevronRight size={14} /></a></div>
          </div>
          <div className="list">{recent.map((t) => <TxnRow key={t.id} t={t} onOpen={() => openModal({ type: 'txn', mode: 'view', id: t.id })} />)}</div>
        </section>

        {/* Insight + budget ────────────────────── */}
        <section className="card" style={{ gridColumn: '9 / span 4', gridRow: 3 }} aria-label="Insights">
          <div className="pad" style={{ paddingBottom: 8 }}>
            <div className="sect-head"><h2 className="sect-title"><Lightbulb size={16} />Worth knowing</h2><a className="sect-link" href="#/insights">Insights<ChevronRight size={14} /></a></div>
            <div className="stack gap12">{insights.map((i) => <div key={i.id}><div className="li-title" style={{ fontSize: 14 }}>{i.title}</div><div className="small muted" style={{ marginTop: 3, lineHeight: 1.5 }}>{i.text}</div></div>)}</div>
          </div>
          <a href="#/budget" className="ov-budget">
            <Ring pct={fundedPct} size={52} stroke={6} color="var(--planned)"><span className="num" style={{ fontSize: 12 }}>{Math.round(fundedPct * 100)}%</span></Ring>
            <div className="grow small"><div style={{ fontWeight: 600 }}>Monthly targets funded</div><div className="muted">{underCount ? `${underCount} still need funding` : 'All funded'} · {money(funded, { cents: false })} of {money(tgtTotal, { cents: false })}</div></div>
            <ChevronRight size={16} className="muted" />
          </a>
        </section>
      </div>
    </div>
  );
}

function Welcome() {
  const { openModal } = useStore();
  return (
    <div className="page">
      <PageHead title="Welcome to Finance OS" sub="A calm place for your household money. Let’s set up three things." />
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
void spendingTotal; void envelope;

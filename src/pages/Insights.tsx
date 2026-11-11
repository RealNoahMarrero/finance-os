import { useMemo } from 'react';
import { BarChart3, Info } from 'lucide-react';
import { useStore } from '../store';
import { allEnvelopes, categorySpend, liquidTotal, monthlyFlow, netWorthSeries, usualSpend, upcomingBills } from '../data';
import { addDays, cn, money, monthKey, monthLabel, sum } from '../lib';
import { Empty, Money, Kind } from '../ui';
import { ForecastTab } from './Plan';
import { Credit } from './Credit';
import { AreaLine, FlowBars } from '../charts';
import { PageHead } from './../shared';
import { buildInsights } from './Overview';
import { cardRows, totals, scoreRows } from '../credit';

export function Insights({ tab = 'overview' }: { tab?: 'overview' | 'forecast' | 'credit' }) {
  const { data } = useStore();
  const flow = useMemo(() => monthlyFlow(data), [data]);
  const nw = useMemo(() => netWorthSeries(data), [data]);
  const cats = useMemo(() => categorySpend(data), [data]);
  const insights = useMemo(() => buildInsights(data), [data]);
  const cr = useMemo(() => { const rows = cardRows(data, data.credit); return { n: rows.length, t: totals(rows), s: scoreRows(data.credit.scores)[0] }; }, [data]);

  const tabs = (
    <nav className="view-tabs" aria-label="Insights views">
      <a href="#/insights" aria-current={tab === 'overview' ? 'page' : undefined}>Overview</a>
      <a href="#/insights/forecast" aria-current={tab === 'forecast' ? 'page' : undefined}>Forecast</a>
      <a href="#/insights/credit" aria-current={tab === 'credit' ? 'page' : undefined}>Credit</a>
    </nav>
  );
  if (tab === 'forecast') return <div className="page"><PageHead title="Insights" sub="Forecast — a projection from the bills and income you’ve entered" />{tabs}{data.accounts.length ? <ForecastTab /> : <div className="card pad small muted">Add an account to see a forecast.</div>}</div>;
  if (tab === 'credit') return <div className="page"><PageHead title="Insights" sub="Credit" />{tabs}<Credit embedded /></div>;
  if (data.txns.length === 0) {
    return (
      <div className="page"><PageHead title="Insights" sub="Trends, patterns and financial health" />
        <div className="card"><Empty icon={<BarChart3 />} title="Insights appear as you go" text="After a few weeks of transactions you’ll see where money goes, how this month compares to your usual, and how your cash holds up." /></div></div>
    );
  }

  const last = flow[flow.length - 2];
  const savingsRate = last && last.income ? Math.round(((last.income - last.expense) / last.income) * 100) : 0;
  const envs = allEnvelopes(data).filter((e) => !e.cat.hidden); // archived envelopes aren't part of the budget
  const over = envs.filter((e) => e.env.avail < 0);
  const adherence = Math.round(((envs.length - over.length) / Math.max(1, envs.length)) * 100);
  const avgExp = sum(flow.filter((m) => !m.partial), (m) => m.expense) / Math.max(1, flow.filter((m) => !m.partial).length);
  const runway = avgExp > 0 ? Math.round(liquidTotal(data) / (avgExp / 30)) : null;
  const occ = upcomingBills(data, 40);
  const overdue = occ.filter((o) => o.status === 'overdue').length;
  const totalCat = sum(cats, (c) => c.spent) || 1;
  const maxCat = Math.max(...cats.map((c) => Math.max(c.spent, usualSpend(data, c.cat.id))), 1);

  // weekly spending (last 8 weeks)
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const end = addDays(data.today, -7 * (7 - i)); const start = addDays(end, -6);
    const v = sum(data.txns.filter((t) => t.type === 'expense' && !t.adjustment && t.date >= start && t.date <= end), (t) => t.amount);
    return { end, v };
  });
  const wmax = Math.max(...weeks.map((w) => w.v), 1);

  const health = [
    { l: 'Cash runway', v: runway == null ? '—' : `${runway} days`, s: runway == null ? 'not enough spending history yet' : 'estimate at your usual monthly spending', pct: runway == null ? 0 : Math.min(100, (runway / 90) * 100), c: 'var(--actual)' },
    { l: 'Kept last month', v: `${savingsRate}%`, s: 'of last month’s income', pct: Math.max(0, Math.min(100, savingsRate * 4)), c: 'var(--actual)' },
  ];

  return (
    <div className="page">
      <PageHead title="Insights" sub={`${monthLabel(monthKey(data.today), true)} · what your history says`} />
      {tabs}

      <div className="grid g12" style={{ marginBottom: 16, gap: 12 }}>
        {health.map((h) => (
          <section key={h.l} className="card pad" style={{ gridColumn: 'span 6' }}>
            <div className="row between"><div className="eyebrow">{h.l}</div></div>
            <div className="amt-lg num" style={{ marginTop: 6 }}>{h.v}</div>
            <div className="xs muted" style={{ marginTop: 2 }}>{h.s}</div>
            <div className="bar" style={{ height: 6, marginTop: 12 }}><i style={{ width: `${h.pct}%`, background: h.c }} /></div>
          </section>
        ))}
      </div>

      <div className="grid g12" style={{ marginBottom: 16 }}>
        <section className="card pad" style={{ gridColumn: 'span 7' }}>
          <div className="sect-head"><h2 className="sect-title">Income vs spending</h2><Kind kind="actual" label="Actual" /></div>
          <FlowBars months={flow} height={320} />
          <div className="xs muted" style={{ marginTop: 8 }}><Info size={12} style={{ verticalAlign: -2 }} /> The current month is still in progress.</div>
        </section>
        <section className="card pad" style={{ gridColumn: 'span 5' }}>
          <div className="sect-head"><h2 className="sect-title">Net worth</h2><span className="small muted">12 months · estimate</span></div>
          <div className="amt-xl num" style={{ marginBottom: 6 }}><Money v={nw[nw.length - 1].value} cents={false} /></div>
          <AreaLine series={nw} label="Net worth" height={300} />
        </section>
      </div>

      <div className="grid g12" style={{ marginBottom: 16 }}>
        <section className="card pad" style={{ gridColumn: 'span 7' }}>
          <div className="sect-head"><h2 className="sect-title">Where it went this month</h2><span className="small muted num">{money(totalCat, { cents: false })}</span></div>
          <div className="stack gap12">
            {cats.slice(0, 8).map((c) => {
              const usual = usualSpend(data, c.cat.id);
              const hi = usual > 0 && c.spent > usual * 1.1;
              return (
                <a key={c.cat.id} href={`#/activity?cat=${c.cat.id}`} className="cat-row">
                  <div className="row between small" style={{ marginBottom: 5 }}>
                    <span style={{ fontWeight: 560 }}>{c.cat.name}</span>
                    <span className="num">{money(c.spent, { cents: false })}<span className="muted"> · {Math.round((c.spent / totalCat) * 100)}%</span></span>
                  </div>
                  <div className="bar" style={{ height: 8, position: 'relative', overflow: 'visible' }}>
                    <i style={{ width: `${(c.spent / maxCat) * 100}%`, background: hi ? 'var(--warn)' : 'var(--actual)' }} />
                    {usual > 0 && <span title={`Usual ${money(usual, { cents: false })}`} style={{ position: 'absolute', left: `${(usual / maxCat) * 100}%`, top: -3, bottom: -3, width: 2, background: 'var(--ink-2)', borderRadius: 1 }} />}
                  </div>
                  {usual > 0 && <div className="xs muted" style={{ marginTop: 3 }}>usual {money(usual, { cents: false })}</div>}
                </a>
              );
            })}
          </div>
        </section>
        <section className="card pad" style={{ gridColumn: 'span 5' }}>
          <div className="sect-head"><h2 className="sect-title">Weekly spending</h2><span className="small muted">8 weeks</span></div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 150 }} role="img" aria-label="Weekly spending bars">
            {weeks.map((w, i) => (
              <div key={w.end} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', height: '100%' }} title={`Week ending ${w.end}: ${money(w.v, { cents: false })}`}>
                <div className="xs num muted" style={{ marginBottom: 4 }}>{Math.round(w.v / 100)}</div>
                <div style={{ width: '100%', maxWidth: 28, height: `${(w.v / wmax) * 100}%`, minHeight: 3, borderRadius: '5px 5px 2px 2px', background: i === 7 ? 'var(--actual)' : 'color-mix(in srgb, var(--actual) 45%, var(--surface-3))' }} />
              </div>
            ))}
          </div>
          <div className="xs muted" style={{ marginTop: 8, textAlign: 'center' }}>Dollars per week · latest week highlighted</div>
        </section>
      </div>

      <section className="card" style={{ overflow: 'hidden' }}>
        <div className="sect-head" style={{ padding: '16px 18px 4px' }}><h2 className="sect-title">Worth knowing</h2></div>
        {insights.map((i) => (
          <div key={i.id} className="li" style={{ alignItems: 'flex-start' }}>
            <div className={cn('li-ico', i.tone === 'pos' ? 'pos' : i.tone === 'warn' ? 'warn' : i.tone)}><Info /></div>
            <div className="grow"><div className="li-title">{i.title}</div><div className="li-sub" style={{ whiteSpace: 'normal' }}>{i.text}</div></div>
          </div>
        ))}
      </section>
      <div className="m-only" style={{ height: 1 }} />
    </div>
  );
}

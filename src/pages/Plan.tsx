import { useMemo, useState } from 'react';
import { Archive, Bell, ChevronLeft, ChevronRight, Info, Pencil, Plus, Receipt, TrendingDown } from 'lucide-react';
import { useStore } from '../store';
import { envelope } from '../data';
import {
  billOccurrences, buildForecast, cashEvents, expectedIncomeSummary, incomeOccurrences, shortfall, upcomingBills, type BillOcc,
} from '../data';
import { addDays, cn, compact, daysInMonth, diffDays, fmtDate, mon, money, monthKey, monthLabel, monthShift, parse, relDay, sum } from '../lib';
import { Callout, Empty, Money, Seg, StatusPill } from '../ui';
import { ForecastChart, ForecastLegend, type Scenario } from '../charts';
import { billStatusPill } from '../shared';

// ── Income ──────────────────────────────────────────────────
export function IncomeTab() {
  const { data, openModal } = useStore();
  const [days, setDays] = useState(60);
  // One calculation shared with Home: everything pending that arrives within the window, overdue (still unconfirmed) entries included.
  const sum_ = expectedIncomeSummary(data, days);
  const g = sum_.guaranteed, a = sum_.anticipated;
  const occ = incomeOccurrences(data, data.today, addDays(data.today, days)).filter((o) => !o.overdue);
  const received = data.txns.filter((t) => t.type === 'income' && !t.adjustment && t.date <= data.today).slice(0, 4);
  const waiting = sum_.overdue;
  return (
    <div className="fade-in">
      <div className="row between" style={{ marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <Seg value={String(days) as '30'} onChange={(v) => setDays(Number(v))} options={[{ v: '30', label: '30 days' }, { v: '60', label: '60 days' }, { v: '90', label: '90 days' }]} />
        <button className="btn primary" onClick={() => openModal({ type: 'income', mode: 'add' })}><Plus />Expected income</button>
      </div>
      <div className="grid g12" style={{ marginBottom: 16 }}>
        <div className="card pad" style={{ gridColumn: 'span 4', borderColor: 'color-mix(in srgb, var(--proj) 35%, var(--line))' }}>
          <div className="eyebrow">Conservative · guaranteed only</div><div className="amt-xl num c-proj" style={{ marginTop: 4 }}><Money v={g} cents={false} /></div><div className="small muted" style={{ marginTop: 2 }}>{g === 0 ? `No guaranteed income pending in the next ${days} days` : `Pending, not received${waiting.some((w) => w.certainty === 'guaranteed') ? ' · includes entries awaiting confirmation' : ''}`}</div></div>
        <div className="card pad" style={{ gridColumn: 'span 4', borderStyle: 'dashed', borderColor: 'color-mix(in srgb, var(--proj) 55%, var(--line))' }}>
          <div className="eyebrow">Plus anticipated</div><div className="amt-xl num c-proj" style={{ marginTop: 4, opacity: 0.85 }}><Money v={a} cents={false} /></div><div className="small muted" style={{ marginTop: 2 }}>Invoices &amp; side income, if they land</div></div>
        <div className="card pad" style={{ gridColumn: 'span 4' }}>
          <div className="eyebrow">Optimistic total</div><div className="amt-xl num c-proj" style={{ marginTop: 4 }}><Money v={g + a} cents={false} /></div><div className="small muted" style={{ marginTop: 2 }}>Next {days} days · not in accounts</div></div>
      </div>
      {waiting.length > 0 && (
        <section className="card" style={{ overflow: 'hidden', marginBottom: 16, borderColor: 'color-mix(in srgb, var(--warn) 45%, var(--line))' }}>
          <div className="pad" style={{ paddingBottom: 6 }}><div className="sect-head" style={{ marginBottom: 0 }}><h2 className="sect-title">Did it arrive?</h2><span className="small muted">Confirm or mark as not coming</span></div></div>
          <div className="list">{waiting.map((i) => (
            <button key={i.id} className="li" style={{ padding: '14px 20px' }} onClick={() => openModal({ type: 'income', mode: 'view', id: i.id })}>
              <div className="datebox late"><b className="num">{fmtDate(i.date, 'day')}</b><span>{mon(i.date)}</span></div>
              <div className="grow"><div className="li-title ellipsis">{i.label}</div><div className="li-sub">Awaiting confirmation · originally expected {fmtDate(i.originalDate!)} · shown as arriving today</div></div>
              <div className="right stack" style={{ alignItems: 'flex-end', gap: 5 }}><span className="amt-md num c-proj">+<Money v={i.amount} /></span>
                {i.certainty === 'guaranteed' ? <StatusPill status="proj">Guaranteed</StatusPill> : <span className="pill" style={{ border: '1px dashed var(--ink-4)', background: 'transparent' }}>Anticipated</span>}</div>
            </button>))}</div>
        </section>
      )}
      <section className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div className="pad" style={{ paddingBottom: 6 }}><div className="sect-head" style={{ marginBottom: 0 }}><h2 className="sect-title">Coming up <StatusPill status="proj">Projected</StatusPill></h2></div></div>
        <div className="list">
          {occ.length === 0 && <div className="pad small muted">No expected income in the next {days} days. Add paychecks and invoices so the forecast can plan around them.</div>}
          {occ.map((o) => (
            <button key={o.inc.id + o.date} className="li" style={{ padding: '14px 20px' }} onClick={() => openModal({ type: 'income', mode: 'view', id: o.inc.id })}>
              <div className="datebox proj"><b className="num">{fmtDate(o.date, 'day')}</b><span>{mon(o.date)}</span></div>
              <div className="grow"><div className="li-title ellipsis">{o.inc.label}</div><div className="li-sub">{relDay(o.date, data.today)}{o.inc.repeat !== 'none' ? ' · repeats' : ''}</div></div>
              <div className="right stack" style={{ alignItems: 'flex-end', gap: 5 }}><span className="amt-md num c-proj">+<Money v={o.amount} /></span>
                {o.inc.certainty === 'guaranteed' ? <StatusPill status="proj">Guaranteed</StatusPill> : <span className="pill" style={{ border: '1px dashed var(--ink-4)', background: 'transparent' }}>Anticipated</span>}</div>
            </button>
          ))}
        </div>
      </section>
      <section className="card" style={{ overflow: 'hidden' }}>
        <div className="pad" style={{ paddingBottom: 6 }}><div className="sect-head" style={{ marginBottom: 0 }}><h2 className="sect-title">Recently received <StatusPill status="muted">Actual</StatusPill></h2></div></div>
        <div className="list">{received.map((t) => (
          <button className="li" key={t.id} onClick={() => openModal({ type: 'txn', mode: 'view', id: t.id })}><div className="datebox"><b className="num">{fmtDate(t.date, 'day')}</b><span>{mon(t.date)}</span></div><div className="grow"><div className="li-title">{t.payee}</div><div className="li-sub">{data.accounts.find((x) => x.id === t.accountId)?.name}</div></div><Money v={t.amount} sign className="amt-md pos" /></button>
        ))}</div>
      </section>
    </div>
  );
}

// ── Forecast ────────────────────────────────────────────────
export function ForecastTab() {
  const { data } = useStore();
  const [horizon, setHorizon] = useState(90);
  const [scenario, setScenario] = useState<Scenario>('both');
  const f = useMemo(() => buildForecast(data, 365), [data]);
  const sf = shortfall(f, horizon);
  const cons = f.conservative[horizon], opt = f.optimistic[horizon];
  const events = cashEvents(data, addDays(data.today, 1), addDays(data.today, 35));
  const balAt = (date: string, s: 'conservative' | 'optimistic') => f[s][Math.max(0, diffDays(date, data.today))]?.balance ?? 0;
  const firstShort = f.conservative.slice(0, horizon + 1).find((p) => p.balance < 0);
  const trigger = firstShort ? [...cashEvents(data, addDays(data.today, 1), firstShort.date)].filter((e) => e.amount < 0).pop() : undefined;
  return (
    <div className="fade-in">
      <div className="row between" style={{ marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <Seg value={scenario} onChange={setScenario} options={[{ v: 'both', label: 'Both' }, { v: 'conservative', label: 'Conservative' }, { v: 'optimistic', label: 'Optimistic' }]} />
        <Seg value={String(horizon) as '90'} onChange={(v) => setHorizon(Number(v))} options={[{ v: '30', label: '30D' }, { v: '90', label: '90D' }, { v: '365', label: '12M' }]} />
      </div>
      <section className="card pad" style={{ marginBottom: 16 }}>
        <div className="sect-head"><div><h2 className="sect-title">Checking &amp; cash <StatusPill status="proj">Projected</StatusPill></h2><div className="small muted">Solid line is recorded history. Everything right of “Today” is a projection.</div></div></div>
        <ForecastChart f={f} horizon={horizon} scenario={scenario} today={data.today} height={400} />
        <div style={{ marginTop: 12 }}><ForecastLegend scenario={scenario} /></div>
      </section>

      <div className="grid g12" style={{ marginBottom: 16 }}>
        <div className="card pad" style={{ gridColumn: 'span 4' }}>
          <div className="eyebrow">Conservative low point</div>
          <div className={cn('amt-xl num', sf.min.balance < 0 && 'neg')} style={{ marginTop: 4 }}><Money v={sf.min.balance} cents={false} /></div>
          <div className="small muted" style={{ marginTop: 2 }}>{fmtDate(sf.min.date)} · guaranteed income only</div></div>
        <div className="card pad" style={{ gridColumn: 'span 4' }}>
          <div className="eyebrow">Optimistic low point</div>
          <div className={cn('amt-xl num', sf.optMin.balance < 0 && 'neg')} style={{ marginTop: 4 }}><Money v={sf.optMin.balance} cents={false} /></div>
          <div className="small muted" style={{ marginTop: 2 }}>{fmtDate(sf.optMin.date)} · with anticipated income</div></div>
        <div className="card pad" style={{ gridColumn: 'span 4' }}>
          <div className="eyebrow">In {horizon === 365 ? '12 months' : `${horizon} days`}</div>
          <div className="amt-lg num" style={{ marginTop: 6 }}><span className="c-proj"><Money v={cons.balance} cents={false} /></span> <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>to</span> <span className="c-proj"><Money v={opt.balance} cents={false} /></span></div>
          <div className="small muted" style={{ marginTop: 2 }}>Conservative → optimistic</div></div>
      </div>

      {firstShort ? (
        <div style={{ marginBottom: 16 }}><Callout tone="warn" icon={<TrendingDown />}>
          <b>Possible shortfall from {fmtDate(firstShort.date)}.</b> Counting only guaranteed income, checking &amp; cash would go below $0{trigger ? <> — {trigger.label} ({money(-trigger.amount, { cents: false })}) leaves on {fmtDate(trigger.date)}</> : ''}. Moving a bill, trimming a flexible category, or confirming an anticipated payment would close the gap. This is a projection, not a balance.</Callout></div>
      ) : <div style={{ marginBottom: 16 }}><Callout icon={<Info />}>No shortfall projected in this window.</Callout></div>}

      <section className="card" style={{ overflow: 'hidden' }}>
        <div className="pad" style={{ paddingBottom: 6 }}><div className="sect-head" style={{ marginBottom: 0 }}><h2 className="sect-title">Next 5 weeks, event by event</h2><span className="small muted">Conservative running balance</span></div></div>
        <div className="list">
          {events.map((e, i) => {
            const bal = balAt(e.date, 'conservative');
            return (
              <div className="li" key={i} style={{ padding: '11px 20px' }}>
                <div className={cn('datebox', e.kind.startsWith('income') && 'proj')}><b className="num">{fmtDate(e.date, 'day')}</b><span>{mon(e.date)}</span></div>
                <div className="grow"><div className="li-title ellipsis" style={{ fontSize: 13.5 }}>{e.label}</div>
                  <div className="li-sub" style={{ fontSize: 12 }}>{e.kind === 'income-g' ? 'Guaranteed income' : e.kind === 'income-a' ? 'Anticipated income · optimistic only' : e.kind === 'scheduled' ? 'Scheduled transaction' : 'Bill'}</div></div>
                <div className="right"><div className={cn('amt-md num', e.amount > 0 ? 'c-proj' : '')}>{money(e.amount, { sign: true, cents: false })}</div>
                  <div className={cn('xs num', bal < 0 ? 'neg' : 'muted')} style={{ fontWeight: bal < 0 ? 650 : 500 }}>{e.kind === 'income-a' ? 'not counted' : `bal ${money(bal, { cents: false })}`}</div></div>
              </div>
            );
          })}
        </div>
      </section>
      <p className="xs muted" style={{ marginTop: 10 }}>Assumes ~{money(f.flexDaily, { cents: false })}/day of everyday spending (your 2-month average), all bills on their due dates, and planned items below. Savings accounts are excluded.</p>
    </div>
  );
}
// ── Calendar ────────────────────────────────────────────────
export function CalendarTab() {
  const { data, openModal } = useStore();
  const [month, setMonth] = useState(monthKey(data.today));
  const [sel, setSel] = useState(data.today);
  const first = parse(`${month}-01`);
  const lead = first.getDay();
  const dim = daysInMonth(month);
  const cells: string[] = [];
  for (let i = -lead; i < 42 - lead; i++) cells.push(addDays(`${month}-01`, i));
  const from = cells[0], to = cells[cells.length - 1];
  const bills = billOccurrences(data, from, to);
  const incomes = incomeOccurrences(data, from, to);
  const planned = cashEvents(data, from, to).filter((e) => e.kind === 'scheduled');
  const evFor = (d: string) => ({
    bills: bills.filter((b) => b.date === d), income: incomes.filter((i) => i.date === d), planned: planned.filter((p) => p.date === d),
  });
  const selEv = evFor(sel);
  const rows = Math.ceil((lead + dim) / 7);
  return (
    <div className="fade-in">
      <section className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div className="pad row between" style={{ paddingBottom: 12 }}>
          <h2 className="sect-title" style={{ fontSize: 17 }}>{monthLabel(month, true)}</h2>
          <div className="row gap8">
            <button className="icon-btn" aria-label="Previous month" onClick={() => setMonth(monthShift(month, -1))}><ChevronLeft /></button>
            <button className="btn sm" onClick={() => { setMonth(monthKey(data.today)); setSel(data.today); }}>Today</button>
            <button className="icon-btn" aria-label="Next month" onClick={() => setMonth(monthShift(month, 1))}><ChevronRight /></button>
          </div>
        </div>
        <div className="cal">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div className="cal-h" key={d}>{d}</div>)}
          {cells.slice(0, rows * 7).map((d) => {
            const e = evFor(d);
            const out = monthKey(d) !== month;
            const items = [
              ...e.bills.map((b) => ({ k: `b${b.bill.id}`, label: b.bill.name, cls: b.paid ? 'paid' : b.status === 'overdue' ? 'late' : 'bill', fn: () => openModal({ type: 'bill', billId: b.bill.id, date: b.date }) })),
              ...e.income.map((i) => ({ k: `i${i.inc.id}`, label: `+${compact(i.amount)} ${i.inc.label.split(' · ')[0]}`, cls: i.inc.certainty === 'guaranteed' ? 'inc-g' : 'inc-a', fn: () => openModal({ type: 'income', mode: 'view', id: i.inc.id }) })),
              ...e.planned.map((p) => ({ k: `p${p.label}`, label: p.label, cls: 'bill', fn: () => setSel(d) })),
            ];
            return (
              <div key={d} className={cn('cal-d', out && 'out', d === data.today && 'today')} role="button" tabIndex={0} aria-label={`${fmtDate(d, 'long')}, ${items.length} events`}
                onClick={() => setSel(d)} onKeyDown={(ev) => { if (ev.key === 'Enter') setSel(d); }} style={{ cursor: 'pointer', ...(d === sel ? { boxShadow: 'inset 0 0 0 2px var(--planned)' } : {}) }}>
                <span className="n num">{fmtDate(d, 'day')}</span>
                <div className="cal-evs">
                  {items.slice(0, 3).map((it) => <button key={it.k} className={cn('ev', it.cls)} title={it.label} onClick={(ev) => { ev.stopPropagation(); setSel(d); it.fn(); }}>{it.label}</button>)}
                  {items.length > 3 && <span className="xs muted" style={{ paddingLeft: 4 }}>+{items.length - 3}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <div className="legend" style={{ marginBottom: 16 }}>
        <span><i className="sw" style={{ background: 'var(--surface-3)', border: '1px solid var(--line-2)' }} />Bill</span>
        <span><i className="sw" style={{ background: 'var(--neg-soft)', border: '1px solid var(--neg)' }} />Overdue</span>
        <span><i className="sw" style={{ background: 'var(--pos-soft)', border: '1px solid var(--pos)' }} />Paid</span>
        <span><i className="sw" style={{ background: 'var(--proj-soft)', border: '1px solid var(--proj)' }} />Guaranteed income</span>
        <span><i className="sw" style={{ border: '1.5px dashed var(--proj)' }} />Anticipated income</span>
      </div>
      <section className="card" style={{ overflow: 'hidden' }}>
        <div className="pad" style={{ paddingBottom: 6 }}><h2 className="sect-title">{fmtDate(sel, 'long')}</h2></div>
        {selEv.bills.length + selEv.income.length + selEv.planned.length === 0 ? <div className="small muted" style={{ padding: '4px 20px 18px' }}>Nothing scheduled.</div> : (
          <div className="list">
            {selEv.bills.map((b) => <button className="li" key={b.bill.id} onClick={() => openModal({ type: 'bill', billId: b.bill.id, date: b.date })}><div className="li-ico"><Bell /></div><div className="grow"><div className="li-title">{b.bill.name}</div><div className="li-sub">Bill</div></div><div className="right stack" style={{ alignItems: 'flex-end', gap: 4 }}><Money v={-b.bill.amount} className="amt-md" />{billStatusPill(b, data.today)}</div></button>)}
            {selEv.income.map((i) => <button className="li" key={i.inc.id} onClick={() => openModal({ type: 'income', mode: 'view', id: i.inc.id })}><div className="li-ico proj"><Receipt /></div><div className="grow"><div className="li-title">{i.inc.label}</div><div className="li-sub">Expected · {i.inc.certainty}</div></div><Money v={i.amount} sign className="amt-md c-proj" /></button>)}
            {selEv.planned.map((p) => <div className="li" key={p.label}><div className="li-ico"><Info /></div><div className="grow"><div className="li-title">{p.label}</div><div className="li-sub">Scheduled transaction</div></div><Money v={p.amount} className="amt-md" /></div>)}
          </div>
        )}
      </section>
    </div>
  );
}

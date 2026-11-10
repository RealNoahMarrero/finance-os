import { useState } from 'react';
import { Bell, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useStore } from '../store';
import { groupBills, upcomingBills, type BillGroup } from '../data';
import { cn, diffDays, fmtDate, mon, money, plural, relDay, sum } from '../lib';
import { Empty, Money, Seg, StatusPill } from '../ui';
import { PageHead } from '../shared';
import { AllBills, ArchivedBills, CalendarTab, IncomeTab } from './Plan';

/** One row per bill. A bill that has been missed more than once is still one row, with a count and its occurrences one tap away. */
export function BillList({ groups, compact }: { groups: BillGroup[]; compact?: boolean }) {
  const { data, openModal } = useStore();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div>
      {groups.map((g) => {
        const n = g.next; const late = g.missed > 0; const soon = !late && diffDays(n.date, data.today) <= 3;
        const many = g.occs.length > 1;
        const sub = late
          ? g.missed > 1 ? `${g.missed} payments missed · since ${fmtDate(n.date)}` : `Was due ${relDay(n.date, data.today).toLowerCase()}`
          : `${relDay(n.date, data.today)}${n.short > 0 && !n.future ? ` · ${money(n.short, { cents: false })} short` : n.funded >= g.bill.amount && !n.future ? ' · funded' : ''}`;
        return (
          <div key={g.bill.id}>
            <div className="rowx">
              <div className={cn('datebox', late && 'late')}><b className="num">{fmtDate(n.date, 'day')}</b><span>{mon(n.date)}</span></div>
              <button className="grow" style={{ textAlign: 'left', minWidth: 0 }} onClick={() => openModal({ type: 'bill', billId: g.bill.id, date: n.date })} aria-label={`${g.bill.name} details`}>
                <div className="row gap8"><span className="li-title ellipsis">{g.bill.name}</span>
                  {g.missed > 1 ? <StatusPill status="late">{g.missed} missed</StatusPill> : late ? <StatusPill status="late">Overdue</StatusPill> : soon ? <StatusPill status="warn">Due soon</StatusPill> : null}</div>
                <div className="li-sub ellipsis">{sub}</div>
              </button>
              <div className="right"><div className="amt-md num"><Money v={g.bill.amount} /></div>{late && g.missed > 1 && <div className="xs muted num">{money(g.total)} total</div>}</div>
              {!compact && many && <button className="icon-btn" aria-label={open[g.bill.id] ? 'Hide occurrences' : 'Show occurrences'} aria-expanded={!!open[g.bill.id]} onClick={() => setOpen({ ...open, [g.bill.id]: !open[g.bill.id] })}>{open[g.bill.id] ? <ChevronDown /> : <ChevronRight />}</button>}
              <button className={cn('btn sm', (late || soon) && 'primary')} onClick={() => openModal({ type: 'bill', billId: g.bill.id, date: n.date })}>Pay</button>
            </div>
            {!compact && many && open[g.bill.id] && (
              <div className="occ fade-in">
                {g.occs.map((o) => (
                  <div className="r" key={o.date}><span className="muted">{fmtDate(o.date)}{o.status === 'overdue' ? ` · ${-diffDays(o.date, data.today)} days late` : o.future ? ' · next month' : ''}</span><b className="num">{money(o.bill.amount)}</b></div>
                ))}
                <div className="xs muted" style={{ marginTop: 6 }}>Pay the oldest first. The money set aside in {g.bill.name} is counted once, toward the oldest payment.</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

type Tab = 'upcoming' | 'income' | 'paused';
export function Bills({ query }: { query: URLSearchParams }) {
  const { data, openModal } = useStore();
  const tab = (['upcoming', 'income', 'paused'].includes(query.get('tab') ?? '') ? query.get('tab') : 'upcoming') as Tab;
  const view = query.get('view') === 'calendar' ? 'calendar' : 'list';
  const setQ = (t: Tab, v = view) => { location.hash = `/bills${t === 'upcoming' && v === 'list' ? '' : `?${new URLSearchParams({ ...(t !== 'upcoming' ? { tab: t } : {}), ...(v === 'calendar' ? { view: v } : {}) })}`}`; };

  const occ = upcomingBills(data, 45);
  const groups = groupBills(occ);
  const overdue = groups.filter((g) => g.missed > 0);
  const week = groups.filter((g) => g.missed === 0 && diffDays(g.next.date, data.today) <= 7);
  const later = groups.filter((g) => g.missed === 0 && diffDays(g.next.date, data.today) > 7 && !g.next.future);
  const nextMonth = groups.filter((g) => g.missed === 0 && g.next.future);
  const overdueTotal = sum(overdue, (g) => g.total);
  const due7 = sum(week, (g) => g.next.bill.amount);
  const paused = data.bills.filter((b) => b.paused);

  const section = (title: string, gs: BillGroup[], tone?: string) => gs.length ? (
    <section className="card pad" style={{ marginBottom: 16 }} aria-label={title}>
      <div className="sect-head"><h2 className="sect-title" style={{ color: tone }}>{title}</h2><span className="small muted num">{money(sum(gs, (g) => (g.missed ? g.total : g.next.bill.amount)), { cents: false })}</span></div>
      <BillList groups={gs} />
    </section>) : null;

  return (
    <div className="page">
      <PageHead title="Bills" sub={overdueTotal > 0 ? `${money(overdueTotal, { cents: false })} overdue · ${money(due7, { cents: false })} due this week` : `${money(due7, { cents: false })} due this week`}
        actions={<>{tab === 'upcoming' && <Seg value={view} onChange={(v) => setQ('upcoming', v)} options={[{ v: 'list', label: 'List' }, { v: 'calendar', label: 'Calendar' }]} />}<button className="btn primary" onClick={() => openModal({ type: 'category-add' })}><Plus />New bill</button></>} />
      <nav className="view-tabs" aria-label="Bills views">
        <a href="#/bills" aria-current={tab === 'upcoming' ? 'page' : undefined}>Upcoming</a>
        <a href="#/bills?tab=income" aria-current={tab === 'income' ? 'page' : undefined}>Expected income</a>
        <a href="#/bills?tab=paused" aria-current={tab === 'paused' ? 'page' : undefined}>Paused &amp; archived</a>
      </nav>

      {tab === 'income' && <IncomeTab />}
      {tab === 'paused' && (
        <div className="fade-in">
          <section className="card pad" style={{ marginBottom: 16 }}>
            <div className="sect-head"><h2 className="sect-title">Paused</h2></div>
            {paused.length === 0 ? <div className="small muted">No paused bills.</div> : <div className="list">{paused.map((b) => (
              <div className="rowx" key={b.id}><div className="grow"><div className="li-title">{b.name}</div><div className="li-sub">{b.recurring ? b.period : 'One time'} · {money(b.amount)}</div></div>
                <button className="btn sm" onClick={() => openModal({ type: 'bill-edit', billId: b.id })}>Resume…</button></div>))}</div>}
          </section>
          <ArchivedBills />
        </div>
      )}
      {tab === 'upcoming' && (view === 'calendar' ? <CalendarTab /> : data.bills.length === 0 ? (
        <div className="card"><Empty icon={<Bell />} title="No bills yet" text="Add a bill with a due date and amount to see it here." action={<button className="btn primary" onClick={() => openModal({ type: 'category-add' })}><Plus />New bill</button>} /></div>
      ) : (
        <div className="fade-in">
          {groups.length === 0 && <div className="card pad small muted" style={{ marginBottom: 16 }}>Nothing is due in the next 45 days.</div>}
          {section('Overdue', overdue, 'var(--neg)')}
          {section('This week', week)}
          {section('Later this month', later)}
          {section('Next month', nextMonth)}
          <details className="card" style={{ overflow: 'hidden' }}>
            <summary className="pad small" style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--ink-2)' }}>All scheduled bills · {plural(data.bills.length, 'bill')}</summary>
            <AllBills />
          </details>
          <ArchivedBills />
        </div>
      ))}
    </div>
  );
}

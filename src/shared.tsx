import type { ReactNode } from 'react';
import { ArrowLeftRight, ArrowDownLeft, ChevronRight, Scale, Split, TriangleAlert, Clock, Sparkles, Wallet, TrendingDown, Landmark, CircleAlert } from 'lucide-react';
import { useStore, type Modal } from './store';
import {
  buildForecast, shortfall, overspent, readyToAssign, upcomingBills, staleness, underfunded, type DataState, type Txn, type BillOcc,
} from './data';
import { cn, diffDays, fmtDate, mon, money, relDay } from './lib';
import { CatIcon, Money, StatusPill } from './ui';

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="topbar">
      <div><h1 className="page-title">{title}</h1>{sub && <p className="page-sub">{sub}</p>}</div>
      <div className="top-actions">{actions}</div>
    </div>
  );
}

/** "DAILY OPERATIONS (...7081)" -> "Daily Operations" for compact transfer labels. */
export const shortAcct = (name: string) => {
  const n = name.replace(/\s*\(\.\.\.\d+\)\s*$/, '').trim();
  return n === n.toUpperCase() ? n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : n;
};
/** Where a transfer goes, from an account's point of view (pov) or neutrally ("A → B"). */
export function transferLabel(d: DataState, t: Txn, pov?: string) {
  const from = shortAcct(d.allAccounts.find((a) => a.id === t.accountId)?.name ?? 'Unknown account');
  const to = shortAcct(d.allAccounts.find((a) => a.id === t.toAccountId)?.name ?? 'Unknown account');
  if (pov && pov === t.accountId) return `Transfer to ${to}`;
  if (pov && pov === t.toAccountId) return `Transfer from ${from}`;
  return `${from} → ${to}`;
}

export function txnCategoryLabel(d: DataState, t: Txn, pov?: string) {
  if (t.adjustment) return 'Adjustment';
  if (t.splits?.length) return `Split · ${t.splits.length}`;
  if (t.type === 'transfer') return transferLabel(d, t, pov);
  if (t.type === 'income') return 'Ready to Assign';
  return d.categories.find((c) => c.id === t.categoryId)?.name ?? 'Uncategorized';
}

/** The signed amount to draw for a row. Transfers are neither income nor spending: with an account
 *  point of view they show the real direction (credit cards invert, since paying a card lowers what you owe). */
export function txnDisplayAmount(d: DataState, t: Txn, pov?: string) {
  if (t.type === 'income') return { v: t.amount, tone: 'pos' as const };
  if (t.type === 'expense') return { v: -t.amount, tone: '' as const };
  if (!pov) return { v: t.amount, tone: '' as const, neutral: true };
  const credit = d.allAccounts.find((a) => a.id === pov)?.type === 'credit';
  const out = pov === t.accountId;
  const inflow = out ? false : true;
  const v = credit ? (inflow ? -t.amount : t.amount) : (inflow ? t.amount : -t.amount);
  return { v, tone: '' as const };
}

export function TxnIcon({ t }: { t: Txn }) {
  const { data } = useStore();
  const cat = data.categories.find((c) => c.id === (t.splits?.[0]?.categoryId ?? t.categoryId));
  if (t.adjustment) return <div className="li-ico planned"><Scale /></div>;
  if (t.type === 'income') return <div className="li-ico pos"><ArrowDownLeft /></div>;
  if (t.type === 'transfer') return <div className="li-ico"><ArrowLeftRight /></div>;
  return <div className="li-ico">{cat ? <CatIcon k={cat.icon} /> : <Wallet />}</div>;
}

export function TxnRow({ t, full, onOpen, pov }: { t: Txn; full?: boolean; onOpen: () => void; pov?: string }) {
  const { data } = useStore();
  const acct = data.allAccounts.find((a) => a.id === t.accountId);
  const cat = txnCategoryLabel(data, t, pov);
  const da = txnDisplayAmount(data, t, pov);
  const amt = <Money v={da.v} sign={t.type === 'income' || (t.type === 'transfer' && !!pov)} className={cn(da.tone === 'pos' && 'pos', 'amt-md')} />;
  
  if (!full) {
    return (
      <button className="li" onClick={onOpen}>
        <TxnIcon t={t} />
        <div className="grow"><div className="li-title ellipsis">{t.payee}</div><div className="li-sub ellipsis">{cat} · {fmtDate(t.date)}</div></div>
        <div className="right">{amt}</div>
      </button>
    );
  }
  return (
    <button className="tx" onClick={onOpen}>
      <TxnIcon t={t} />
      <div style={{ minWidth: 0 }}>
        <div className="li-title ellipsis">{t.payee}{t.splits?.length ? <span className="badge-split" style={{ marginLeft: 8 }}><Split size={12} />Split</span> : null}</div>
        <div className="li-sub ellipsis tx-m">{cat}{t.type === 'transfer' ? '' : ` · ${acct?.name}`}</div>
        {t.notes && <div className="li-sub ellipsis" style={{ fontSize: 12 }}>{t.notes}</div>}
      </div>
      <div className="tx-cat ellipsis small" style={{ color: 'var(--ink-2)' }}>{t.type === 'transfer' ? 'Transfer' : cat}</div>
      <div className="tx-acct ellipsis small muted">{t.type === 'transfer' ? cat : acct?.name}</div>
      <div className="right">{amt}</div>
    </button>
  );
}

export function billStatusPill(o: BillOcc, today: string) {
  const n = diffDays(o.date, today);
  if (o.paid) return <StatusPill status="ok">Paid</StatusPill>;
  if (o.status === 'overdue') return <StatusPill status="late">{-n}d overdue</StatusPill>;
  if (o.short > 0) return <StatusPill status="warn">{money(o.short, { cents: false })} short</StatusPill>;
  if (o.future) return <StatusPill status="muted">{relDay(o.date, today).replace('In ', 'In ')}</StatusPill>;
  return <StatusPill status="planned">Funded</StatusPill>;
}

/** Plain status for the homepage: only whether it's late, close, or just scheduled. Budget funding is not payment. */
export function simplePill(o: BillOcc, today: string) {
  const n = diffDays(o.date, today);
  if (o.paid) return <StatusPill status="ok">Paid</StatusPill>;
  if (o.status === 'overdue') return <StatusPill status="late">{-n}d overdue</StatusPill>;
  if (n <= 7) return <StatusPill status="planned">Due soon</StatusPill>;
  return <StatusPill status="muted">Scheduled</StatusPill>;
}

export function BillRow({ o, onOpen, simple }: { o: BillOcc; onOpen: () => void; simple?: boolean }) {
  const { data } = useStore();
  const late = o.status === 'overdue';
  return (
    <button className="li" onClick={onOpen}>
      <div className={cn('datebox', late && 'late')}><b className="num">{fmtDate(o.date, 'day')}</b><span>{mon(o.date)}</span></div>
      <div className="grow"><div className="li-title ellipsis">{o.bill.name}</div><div className="li-sub">{late ? `Was due ${relDay(o.date, data.today).toLowerCase()}` : relDay(o.date, data.today)}</div></div>
      <div className="right stack" style={{ alignItems: 'flex-end', gap: 3 }}><Money v={o.bill.amount} className="amt-md" />{simple ? simplePill(o, data.today) : billStatusPill(o, data.today)}</div>
    </button>
  );
}

// ── "Needs attention": the actionable list ───────────────────
export interface Attn { id: string; tone: 'neg' | 'warn' | 'planned' | 'proj'; icon: ReactNode; title: string; sub: string; modal?: Modal; href?: string }
export function attentionItems(d: DataState): Attn[] {
  const out: Attn[] = [];
  const bills = upcomingBills(d, 14);
  for (const o of bills.filter((b) => b.status === 'overdue')) {
    out.push({ id: `od-${o.bill.id}`, tone: 'neg', icon: <Clock />, title: `${o.bill.name} is ${-diffDays(o.date, d.today)} days overdue`, sub: `${money(o.bill.amount)} · due ${fmtDate(o.date)} — not yet marked paid`, modal: { type: 'bill', billId: o.bill.id, date: o.date } });
  }
  const f = buildForecast(d, 90);
  const s = shortfall(f, 90);
  if (s.first) {
    out.push({ id: 'short', tone: 'warn', icon: <TrendingDown />, title: `Projected cash shortfall on ${fmtDate(s.first.date)}`, sub: 'Conservative forecast · covered if anticipated income arrives', href: '/plan/forecast' });
  }
  for (const e of overspent(d)) {
    out.push({ id: `os-${e.cat.id}`, tone: 'neg', icon: <CircleAlert />, title: `${e.cat.name} is overspent by ${money(-e.env.avail)}`, sub: 'Cover it by moving money from another category', modal: { type: 'move', to: e.cat.id, amount: -e.env.avail } });
  }
  for (const o of bills.filter((b) => b.short > 0 && b.status !== 'overdue').slice(0, 2)) {
    out.push({ id: `uf-${o.bill.id}`, tone: 'warn', icon: <TriangleAlert />, title: `${o.bill.name} needs ${money(o.short)} more`, sub: `Due ${fmtDate(o.date)} · ${money(o.funded)} of ${money(o.bill.amount)} funded`, modal: { type: 'move', from: 'rta', to: o.bill.categoryId, amount: o.short } });
  }
  const rta = readyToAssign(d);
  if (rta < 0) out.push({ id: 'rta-neg', tone: 'warn', icon: <TriangleAlert />, title: `Envelopes hold ${money(-rta)} more than your cash`, sub: 'Review envelope balances — nothing was changed automatically', href: '#/budget' });
  if (rta > 0) out.push({ id: 'rta', tone: 'planned', icon: <Sparkles />, title: `${money(rta)} is ready to assign`, sub: `${underfunded(d).length} targets still need funding`, modal: { type: 'assign' } });
  for (const a of d.accounts) {
    const st = staleness(a, d.today);
    if (st.level !== 'fresh') out.push({ id: `st-${a.id}`, tone: 'proj', icon: <Landmark />, title: `${a.name} hasn’t been reconciled in ${st.days} days`, sub: 'Balances are manual — a quick check keeps them trustworthy', modal: { type: 'reconcile', id: a.id } });
  }
  return out;
}

export function AttnRow({ a }: { a: Attn }) {
  const { openModal } = useStore();
  const cls = { neg: 'neg', warn: 'warn', planned: 'planned', proj: 'proj' }[a.tone];
  return (
    <button className="attn" onClick={() => (a.modal ? openModal(a.modal) : (location.hash = a.href!))}>
      <div className={cn('li-ico', cls)}>{a.icon}</div>
      <div className="grow"><div className="li-title" style={{ fontSize: 13.5, lineHeight: 1.3 }}>{a.title}</div><div className="li-sub" style={{ fontSize: 12 }}>{a.sub}</div></div>
      <ChevronRight size={16} className="muted" style={{ marginTop: 8, flex: 'none' }} />
    </button>
  );
}

/** Tabs shared by the "Bills & Budget" section. */
export function SectionTabs({ active }: { active: 'bills' | 'budget' | 'income' | 'calendar' | 'forecast' }) {
  const items = [['bills', 'Bills', '/bills'], ['budget', 'Budget', '/budget'], ['income', 'Income', '/bills?tab=income'], ['calendar', 'Calendar', '/bills?view=calendar']] as const;
  return (
    <nav className="subtabs" aria-label="Bills and budget sections">
      {items.map(([k, l, to]) => <a key={k} href={`#${to}`} aria-current={active === k ? 'page' : undefined}>{l}</a>)}
    </nav>
  );
}


/** Ready to Assign — one card for Overview and Budget. Uses the single existing readyToAssign() calculation; no values of its own. */
export function ReadyToAssignCard({ testid, compact: tight }: { testid: string; compact?: boolean }) {
  const { data, openModal } = useStore();
  const rta = readyToAssign(data);
  const over = rta < 0, zero = rta === 0;
  const needs = underfunded(data).length;
  // Overspent categories are already counted in Ready to Assign (it is cash minus what the categories hold, negatives included), so the number is right —
  // but it is not free money until those categories are covered, so say so and offer the shortcut.
  const overs = overspent(data).sort((a, b) => a.env.avail - b.env.avail);
  const overTotal = overs.reduce((n, e) => n - e.env.avail, 0);
  return (
    <section className={cn('card rta-card', tight && 'rta-compact')} aria-label="Ready to Assign" data-testid={testid}
      style={over ? { borderColor: 'color-mix(in srgb, var(--neg) 35%, var(--line))' } : undefined}>
      <div style={{ minWidth: 0 }}>
        <div className="eyebrow" style={{ color: over ? 'var(--neg)' : 'var(--planned)' }}>{over ? 'Over-assigned' : 'Ready to Assign'}</div>
        <div className={cn('amt-xl num', over ? 'neg' : zero ? '' : 'c-planned')} style={{ marginTop: 4 }} data-testid={`${testid}-value`}><Money v={rta} /></div>
        <div className="small muted" style={{ marginTop: 4, maxWidth: 420 }}>
          {over ? 'Your categories hold more than the cash in your accounts. Move money back to Ready to Assign to fix it.'
            : zero ? <><b style={{ color: 'var(--ink-2)' }}>Everything is assigned.</b> Every dollar in your accounts has a job.{overs.length > 0 && <> {overs.length === 1 ? '1 category is' : `${overs.length} categories are`} overspent by {money(overTotal)}.</>}</>
            : <>Money waiting for a job.{overs.length > 0 ? <> But {overs.length === 1 ? '1 category is' : `${overs.length} categories are`} overspent by {money(overTotal)} — cover that first.</> : needs > 0 ? <> {needs === 1 ? '1 category still needs' : `${needs} categories still need`} funding.</> : null}</>}
        </div>
      </div>
      <div className="stack gap8 rta-actions">
        {over ? <button className="btn primary" data-testid={`${testid}-action`} onClick={() => openModal({ type: 'move', to: 'rta', amount: -rta })}><ArrowLeftRight />Review over-assignment</button>
          : zero ? <button className="btn" data-testid={`${testid}-action`} onClick={() => openModal({ type: 'move' })}><ArrowLeftRight />Move money</button>
          : <button className={cn('btn', overs.length === 0 && 'primary')} data-testid={`${testid}-action`} onClick={() => openModal({ type: 'assign' })}><Sparkles />Assign money</button>}
        {!over && rta > 0 && overs.length > 0 && <button className="btn primary" data-testid={`${testid}-cover`} onClick={() => openModal({ type: 'move', from: 'rta', to: overs[0].cat.id, amount: Math.min(rta, -overs[0].env.avail) })}><ArrowLeftRight />Cover overspending</button>}
      </div>
    </section>
  );
}

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


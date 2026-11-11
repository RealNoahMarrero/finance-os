import { useState } from 'react';
import { Archive, ChevronRight, Plus, Search, Wallet } from 'lucide-react';
import { useStore } from '../store';
import { envelope, groupBills, readyToAssign, upcomingBills, type BillGroup, type Category } from '../data';
import { cn, diffDays, fmtDate, mon, money, relDay, sum } from '../lib';
import { CatIcon, Empty, Money, Seg, StatusPill } from '../ui';
import { PageHead } from '../shared';
import { ItemDetail, restoreResume } from '../itemSheets';
import { CalendarTab, IncomeTab } from './Plan';

/** A compact list of what is due, one row per item (a bill missed twice is still one row). Used on Home. */
export function BillList({ groups }: { groups: BillGroup[] }) {
  const { data, openModal } = useStore();
  return (
    <div className="group">
      {groups.map((g) => {
        const n = g.next; const late = g.missed > 0; const soon = !late && diffDays(n.date, data.today) <= 3;
        return (
          <div key={g.bill.id} className="rowx">
            <div className={cn('datebox', late && 'late')}><b className="num">{fmtDate(n.date, 'day')}</b><span>{mon(n.date)}</span></div>
            <button className="grow" style={{ textAlign: 'left', minWidth: 0 }} onClick={() => openModal({ type: 'bill', billId: g.bill.id, date: n.date })} aria-label={`${g.bill.name} details`}>
              <div className="row gap8"><span className="li-title ellipsis">{g.bill.name}</span>{g.missed > 1 ? <StatusPill status="late">{g.missed} missed</StatusPill> : late ? <StatusPill status="late">Overdue</StatusPill> : soon ? <StatusPill status="warn">Due soon</StatusPill> : null}</div>
              <div className="li-sub ellipsis">{late ? (g.missed > 1 ? `${g.missed} payments missed · since ${fmtDate(n.date)}` : `Was due ${relDay(n.date, data.today).toLowerCase()}`) : relDay(n.date, data.today)}</div>
            </button>
            <div className="right"><div className="amt-md num"><Money v={g.bill.amount} /></div>{late && g.missed > 1 && <div className="xs muted num">{money(g.total)} total</div>}</div>
            <button className={cn('btn sm', (late || soon) && 'primary')} onClick={() => openModal({ type: 'bill', billId: g.bill.id, date: n.date })}>Pay</button>
          </div>
        );
      })}
    </div>
  );
}

type Filter = 'all' | 'due' | 'needs' | 'over' | 'debts' | 'archived';
export type PlanView = 'items' | 'calendar' | 'income';

export function Plan({ query }: { query: URLSearchParams }) {
  const { data, openModal, restoreItem, toast } = useStore();
  const view: PlanView = query.get('view') === 'calendar' ? 'calendar' : query.get('view') === 'income' ? 'income' : 'items';
  const [filter, setFilter] = useState<Filter>(query.get('filter') === 'archived' ? 'archived' : 'all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const rta = readyToAssign(data);
  const wide = () => matchMedia('(min-width: 1101px)').matches;
  const setView = (v: PlanView) => { location.hash = v === 'items' ? '/plan' : `/plan?view=${v}`; };

  const occGroups = groupBills(upcomingBills(data, 60));
  const byBill = new Map(occGroups.map((g) => [g.bill.id, g]));
  const items = data.categories.filter((c) => !c.hidden).map((cat) => {
    const bill = data.bills.find((b) => b.categoryId === cat.id);
    return { cat, env: envelope(data, cat.id), bill, g: bill ? byBill.get(bill.id) : undefined };
  });
  const status = (it: typeof items[number]): { text: string; tone: '' | 'neg' | 'pos' | 'warn' } => {
    const { cat, env, bill, g } = it;
    if (env.avail < 0) return { text: `Overspent by ${money(-env.avail, { cents: false })}`, tone: 'neg' };
    if (bill && g && g.missed > 0) return { text: g.missed > 1 ? `${g.missed} payments missed · ${money(g.total, { cents: false })}` : `Overdue · ${money(bill.amount, { cents: false })}`, tone: 'neg' };
    if (bill?.paused) return { text: 'Schedule paused', tone: '' };
    const bits: string[] = [];
    if (bill && g) bits.push(`Due ${fmtDate(g.next.date)} · ${money(bill.amount, { cents: false })}`);
    if (cat.isDebt && (cat.debtBalance ?? 0) > 0) bits.push(`owes ${money(cat.debtBalance ?? 0, { cents: false })}`);
    else if (env.remaining > 0) bits.push(`needs ${money(env.remaining, { cents: false })}`);
    return { text: bits.join(' · ') || (cat.target ? 'Funded' : ''), tone: '' };
  };
  const matches = (it: typeof items[number]) => {
    const s = q.trim().toLowerCase();
    if (s && !it.cat.name.toLowerCase().includes(s)) return false;
    if (filter === 'due') return !!it.g && (it.g.missed > 0 || diffDays(it.g.next.date, data.today) <= 14);
    if (filter === 'needs') return it.env.remaining > 0;
    if (filter === 'over') return it.env.avail < 0;
    if (filter === 'debts') return !!it.cat.isDebt && (it.cat.debtBalance ?? 0) > 0;
    return true;
  };
  const archived = data.categories.filter((c) => c.hidden && c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const count = { due: items.filter((i) => i.g && (i.g.missed > 0 || diffDays(i.g.next.date, data.today) <= 14)).length, needs: items.filter((i) => i.env.remaining > 0).length, over: items.filter((i) => i.env.avail < 0).length, debts: items.filter((i) => i.cat.isDebt && (i.cat.debtBalance ?? 0) > 0).length };
  const pick = (id: string) => { if (wide()) setSel(id); else openModal({ type: 'category', id }); };
  const selOk = sel && data.categories.some((c) => c.id === sel && !c.hidden);

  const header = (
    <PageHead title="Plan" sub="Everything you pay for or set money aside for"
      actions={<><Seg value={view} onChange={setView} options={[{ v: 'items', label: 'Items' }, { v: 'calendar', label: 'Calendar' }, { v: 'income', label: 'Income' }]} /><button className="btn primary" data-testid="add-item" onClick={() => openModal({ type: 'category-add' })}><Plus />Add item</button></>} />
  );
  if (view === 'calendar') return <div className="page">{header}<CalendarTab /></div>;
  if (view === 'income') return <div className="page">{header}<IncomeTab /></div>;

  if (data.categories.length === 0) {
    return <div className="page">{header}<div className="card"><Empty icon={<Wallet />} title="Nothing planned yet" text="Add the things you pay for or save toward — rent, groceries, a vacation fund." action={<button className="btn primary" onClick={() => openModal({ type: 'category-add' })}><Plus />Add item</button>} /></div></div>;
  }

  return (
    <div className="page">
      {header}
      <div className={cn('rta-bar', rta < 0 && 'over')} style={{ marginBottom: 14 }} aria-label="Ready to Assign" data-testid="rta">
        <div><div className="eyebrow" style={{ color: rta < 0 ? 'var(--neg)' : undefined }}>{rta < 0 ? 'Over-assigned' : 'Ready to assign'}</div><div className={cn('amt-lg num', rta < 0 && 'neg')} data-testid="rta-value"><Money v={rta} /></div></div>
        <button className="btn primary" data-testid="plan-move" onClick={() => openModal(rta < 0 ? { type: 'move', to: 'rta', amount: -rta } : { type: 'move' })}>Move money</button>
      </div>

      <div className="row gap12" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="search-wrap" style={{ width: 240 }}><Search /><input className="input search" style={{ height: 36, fontSize: 14 }} placeholder="Search" aria-label="Search the plan" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div style={{ overflowX: 'auto', maxWidth: '100%' }}><Seg value={filter} onChange={setFilter} options={[
          { v: 'all', label: 'All' }, { v: 'due', label: `Due soon${count.due ? ` · ${count.due}` : ''}` }, { v: 'needs', label: `Needs funding${count.needs ? ` · ${count.needs}` : ''}` },
          { v: 'over', label: `Overspent${count.over ? ` · ${count.over}` : ''}` }, { v: 'debts', label: `Debts${count.debts ? ` · ${count.debts}` : ''}` }, { v: 'archived', label: 'Archived' }]} /></div>
      </div>

      <div className="split-layout">
        <div>
          {filter === 'archived' ? (
            archived.length === 0 ? <div className="card"><Empty icon={<Archive />} title="No archived items" text="Archived items keep their history and can be restored any time." /></div> : (
              <div className="group" data-testid="archived-list">{archived.map((c) => {
                const e = envelope(data, c.id);
                return (
                  <div key={c.id} className="rowx"><div className="li-ico"><CatIcon k={c.icon} /></div>
                    <div className="grow"><div className="li-title">{c.name}</div>{e.avail !== 0 && <div className="li-sub">Still holds {money(e.avail)} from before</div>}</div>
                    <button className="btn sm" onClick={async () => { if (await restoreItem(c.id, 0, restoreResume(data, c))) toast(`${c.name} restored — it comes back empty`); }}>Restore</button></div>);
              })}</div>)
          ) : (<>
            {data.groups.map((g) => {
              const rows = items.filter((i) => i.cat.groupId === g.id && matches(i));
              if (!rows.length) return null;
              return (
                <section key={g.id} aria-label={g.name}>
                  <div className="group-h"><h2>{g.name}</h2><span className="small muted num">{money(sum(rows, (r) => r.env.avail), { cents: false })}</span></div>
                  <div className="group">
                    {rows.map((it) => {
                      const st = status(it); const over = it.env.avail < 0; const late = !!it.g && it.g.missed > 0; const soon = !!it.g && !late && diffDays(it.g.next.date, data.today) <= 3;
                      return (
                        <div key={it.cat.id} className="plan-row" role="button" tabIndex={0} aria-selected={sel === it.cat.id} data-testid="plan-row" onClick={() => pick(it.cat.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(it.cat.id); } }}>
                          <div className={cn('li-ico', over || late ? 'neg' : 'planned')}><CatIcon k={it.cat.icon} /></div>
                          <div className="grow"><div className="li-title ellipsis">{it.cat.name}</div><div className={cn('li-sub', st.tone === 'neg' && 'neg')} style={st.tone === 'neg' ? { fontWeight: 560 } : undefined}>{st.text || ' '}</div></div>
                          {it.bill && it.g && (late || soon) && <button className="btn sm primary" onClick={(e) => { e.stopPropagation(); openModal({ type: 'bill', billId: it.bill!.id, date: it.g!.next.date }); }}>Pay</button>}
                          {over && <button className="btn sm" onClick={(e) => { e.stopPropagation(); openModal({ type: 'move', to: it.cat.id, amount: -it.env.avail }); }}>Cover</button>}
                          <div className={cn('amt-md num', over && 'neg')} style={{ minWidth: 84, textAlign: 'right' }}><Money v={it.env.avail} /></div>
                          <ChevronRight size={16} className="muted" />
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
            {items.every((i) => !matches(i)) && <div className="card"><Empty icon={<Search />} title="Nothing here" text="No items match." /></div>}
          </>)}
        </div>

        <aside className="card pane" aria-label="Item details">
          {selOk ? <ItemDetail key={sel!} id={sel!} /> : (
            <div aria-label="Plan at a glance">
              <div className="eyebrow">At a glance</div>
              <div className="kv"><span className="k">In your accounts</span><span className="v num">{money(sum(data.accounts.filter((a) => a.type !== 'credit'), (a) => a.balance), { cents: false })}</span></div>
              <div className="kv"><span className="k">Set aside in items</span><span className="v num">{money(sum(data.accounts.filter((a) => a.type !== 'credit'), (a) => a.balance) - rta, { cents: false })}</span></div>
              <div className="kv"><span className="k">Ready to assign</span><span className={cn('v num', rta < 0 && 'neg')}>{money(rta, { cents: false })}</span></div>
              {[...items.filter((i) => i.env.avail < 0), ...items.filter((i) => i.env.avail >= 0 && i.env.remaining > 0)].slice(0, 5).length > 0 && <div className="eyebrow" style={{ margin: '16px 0 2px' }}>Needs attention</div>}
              {[...items.filter((i) => i.env.avail < 0), ...items.filter((i) => i.env.avail >= 0 && i.env.remaining > 0)].slice(0, 5).map((i) => (
                <button key={i.cat.id} className="rowx" style={{ padding: '9px 0' }} onClick={() => setSel(i.cat.id)}><div className="grow"><div className="li-title" style={{ fontSize: 14 }}>{i.cat.name}</div><div className="li-sub">{i.env.avail < 0 ? `Over by ${money(-i.env.avail, { cents: false })}` : `Needs ${money(i.env.remaining, { cents: false })}`}</div></div><ChevronRight size={15} className="muted" /></button>
              ))}
              <div className="xs muted" style={{ marginTop: 12 }}>Select an item to see its details, record a payment or move money.</div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
void (null as unknown as Category);

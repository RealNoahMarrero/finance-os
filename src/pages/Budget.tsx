import { useState } from 'react';
import { Archive, ArrowLeftRight, ChevronDown, ChevronRight, CircleHelp, Plus, Sparkles, Wallet } from 'lucide-react';
import { useStore } from '../store';
import { allEnvelopes, billOccurrences, readyToAssign, monthlyFlow, totalAvail, type Category, type Envelope } from '../data';
import { addDays, cn, fmtDate, money, monthLabel, monthKey, sum } from '../lib';
import { CatIcon, Callout, Empty, Money, Seg, StatusPill } from '../ui';
import { PageHead, ReadyToAssignCard, SectionTabs } from '../shared';

const PRI = { 1: 'Essential', 2: 'Important', 3: 'Flexible' } as const;
type Filter = 'all' | 'needs' | 'over' | 'money' | 'funded' | 'debts';

export function Budget() {
  const { data, openModal, setCategoryArchived, toast } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [help, setHelp] = useState(false);
  const rta = readyToAssign(data);
  const allEnvs = allEnvelopes(data);
  const envs = allEnvs.filter((e) => !e.cat.hidden);
  const hiddenEnvs = allEnvs.filter((e) => e.cat.hidden && e.env.avail !== 0);

  if (data.categories.length === 0) {
    return (
      <div className="page"><PageHead title="Budget" sub="Every dollar gets a job" />
        <div className="card"><Empty icon={<Wallet />} title="No envelopes yet" text="Envelopes are the categories you assign money to — rent, groceries, a vacation fund. Add an account first, then create your first few." action={<button className="btn primary" onClick={() => openModal({ type: 'account-add' })}><Plus />Add an account</button>} /></div>
      </div>
    );
  }

  const needs = envs.filter((e) => e.env.remaining > 0).sort((a, b) => a.cat.priority - b.cat.priority || a.env.remaining - b.env.remaining);
  const totalNeeds = sum(needs, (e) => e.env.remaining);
  const overs = envs.filter((e) => e.env.avail < 0);
  let pool = Math.max(0, rta);
  const order = needs.map((e) => { const cover = Math.min(pool, e.env.remaining); pool -= cover; return { ...e, cover }; });

  // "Funded" means a monthly target that is fully covered. Having no target, owing a debt, or holding money are different things and have their own filters.
  const isFunded = (e: { cat: Category; env: Envelope }) => !!e.cat.target && e.env.remaining === 0 && e.env.avail >= 0;
  const matchesEnv = (e: { cat: Category; env: Envelope }) => filter === 'all' ? true : filter === 'needs' ? e.env.remaining > 0 : filter === 'over' ? e.env.avail < 0 : filter === 'money' ? e.env.avail > 0 : filter === 'debts' ? !!e.cat.isDebt && (e.cat.debtBalance ?? 0) > 0 : isFunded(e);
  const matches = matchesEnv;
  const counts = { needs: needs.length, over: overs.length, money: envs.filter((e) => e.env.avail > 0).length, debts: envs.filter((e) => e.cat.isDebt && (e.cat.debtBalance ?? 0) > 0).length, funded: envs.filter(isFunded).length };

  const nextDue = (c: Category) => {
    const b = data.bills.find((x) => x.categoryId === c.id);
    if (!b) return null;
    const o = billOccurrences(data, addDays(data.today, -20), addDays(data.today, 40)).filter((x) => x.bill.id === b.id && !x.paid)[0];
    return o ? o : null;
  };

  const month = monthKey(data.today);
  const flow = monthlyFlow(data);
  const thisMonth = flow[flow.length - 1];
  const near = envs.filter((e) => e.cat.target && e.env.avail >= 0 && e.env.spent >= 0.8 * e.cat.target!);
  return (
    <div className="page">
      <PageHead title="Bills & Budget" sub={`${monthLabel(month, true)} · Optional — set a monthly amount for the categories you care about`}
        actions={<><button className="btn desktop-only" onClick={() => openModal({ type: 'category-add' })}><Plus />New category</button><button className="btn desktop-only" onClick={() => openModal({ type: 'move' })}><ArrowLeftRight />Move money</button><button className="btn primary desktop-only" onClick={() => openModal({ type: 'assign' })}><Plus />Assign money</button></>} />

      <SectionTabs active="budget" />
      <div style={{ marginBottom: 16 }}><ReadyToAssignCard testid="rta" /></div>
      <section className="card pad" style={{ marginBottom: 16 }} aria-label="This month" data-testid="budget-month">
        <div className="ov-sum">
          <div><div className="eyebrow">Spent this month</div><div className="amt-xl num"><Money v={thisMonth.expense} /></div><div className="xs muted">Excludes transfers</div></div>
          <div><div className="eyebrow">Left in categories</div><div className="amt-xl num"><Money v={totalAvail(data)} /></div><div className="xs muted">Money set aside, not bank cash</div></div>
          <div><div className="eyebrow">Needs a look</div><div className="amt-xl num">{overs.length + near.length}</div><div className="xs muted">{overs.length} over · {near.length} close to their amount</div></div>
        </div>
      </section>

      <details style={{ marginBottom: 16 }} >
        <summary className="small" style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--ink-2)', padding: '4px 0 12px' }}>Advanced: funding order</summary>
      <div className="grid g12">
        <section className="card pad" style={{ gridColumn: '1 / -1' }} aria-label="Funding order">
          <div className="sect-head" style={{ marginBottom: 8 }}><h2 className="sect-title">Suggested funding order</h2><StatusPill status="planned">Planned</StatusPill></div>
          {order.length === 0 ? <div className="small muted">All targets are funded — nothing to prioritize.</div> : (
            <div className="stack">
              {order.slice(0, 4).map((e, i) => (
                <div key={e.cat.id} className="row gap12" style={{ padding: '8px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                  <div className="num" style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--planned-soft)', color: 'var(--planned)', fontSize: 11.5, fontWeight: 700, display: 'grid', placeItems: 'center', flex: 'none' }}>{i + 1}</div>
                  <div className="grow"><div className="li-title" style={{ fontSize: 13.5 }}>{e.cat.name}</div><div className="li-sub" style={{ fontSize: 12 }}>{PRI[e.cat.priority]} · needs <span className="num">{money(e.env.remaining)}</span></div></div>
                  {e.cover >= e.env.remaining ? <StatusPill status="ok">Covered</StatusPill> : e.cover > 0 ? <StatusPill status="warn">{money(e.cover, { cents: false })} of {money(e.env.remaining, { cents: false })}</StatusPill> : <StatusPill status="muted">Not covered</StatusPill>}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      </details>

      <div className="row between" style={{ gap: 12, margin: '4px 0 12px', flexWrap: 'wrap' }}>
        <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
          <Seg value={filter} onChange={setFilter} options={[
            { v: 'all', label: 'All' }, { v: 'needs', label: `Needs funding${counts.needs ? ` · ${counts.needs}` : ''}` },
            { v: 'over', label: `Overspent${counts.over ? ` · ${counts.over}` : ''}` }, { v: 'money', label: `Has money · ${counts.money}` },
            { v: 'funded', label: `Target met · ${counts.funded}` }, { v: 'debts', label: `Debts · ${counts.debts}` }]} />
        </div>
        <button className="btn ghost sm" onClick={() => setHelp((v) => !v)} aria-expanded={help}><CircleHelp />What do these mean?</button>
      </div>
      {help && (
        <div className="fade-in" style={{ marginBottom: 12 }}>
          <Callout tone="planned">
            <b>Target</b> is what you’d like to set aside (optional). <b>Available</b> is the money in that envelope right now — it grows when you assign money and drops as you spend. A target is met once the envelope holds at least that much — categories with no target are never shown as met. <b>Has money</b> lists categories with money you could move. <b>Debts</b> shows what you still owe; debts are tracked separately from funding. <b>Spent</b> is this month’s activity. Anything left in Ready to Assign has no job yet.
          </Callout>
        </div>
      )}

      <section className="card" style={{ overflow: 'hidden' }} aria-label="Categories">
        <div className="bgrid bhead">
          <span>Category</span><span className="d-only">Monthly target</span><span className="right col-fund">Target</span><span className="right col-spent">Spent</span><span className="right">Available</span><span className="col-chev" />
        </div>
        {data.groups.map((g) => {
          const rows = envs.filter((e) => e.cat.groupId === g.id && matches(e));
          if (!rows.length) return null;
          const isOpen = !collapsed[g.id];
          const gAvail = sum(rows, (e) => e.env.avail);
          const gTgt = sum(rows, (e) => e.cat.target ?? 0);
          const gFund = sum(rows.filter((e) => e.cat.target), (e) => Math.min(e.cat.target!, e.env.assigned));
          return (
            <div key={g.id}>
              <button className="bgroup row between" onClick={() => setCollapsed({ ...collapsed, [g.id]: isOpen })} aria-expanded={isOpen}>
                <span className="row gap8">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}{g.name}</span>
                <span className="small muted num" style={{ fontWeight: 560 }}><span className="d-only" style={{ marginRight: 14 }}>{money(gFund, { cents: false })} of {money(gTgt, { cents: false })} funded</span><span style={{ color: gAvail < 0 ? 'var(--neg)' : 'var(--ink-2)' }}>{money(gAvail, { cents: false })}</span></span>
              </button>
              {isOpen && rows.map(({ cat, env }) => {
                const due = nextDue(cat);
                const over = env.avail < 0;
                const sub = [PRI[cat.priority], due ? (due.status === 'overdue' ? `overdue since ${fmtDate(due.date)}` : `due ${fmtDate(due.date)}`) : null].filter(Boolean).join(' · ');
                const pct = cat.target ? `${Math.min(100, env.fundedPct * 100)}%` : '0%';
                return (
                  <div key={cat.id} role="button" tabIndex={0} className="brow bgrid" style={{ cursor: 'pointer', ...(over ? { background: 'color-mix(in srgb, var(--neg-soft) 55%, transparent)' } : {}) }}
                    onClick={() => openModal({ type: 'category', id: cat.id })} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal({ type: 'category', id: cat.id }); } }}>
                    <div className="row gap12" style={{ minWidth: 0 }}>
                      <div className={cn('li-ico', over ? 'neg' : 'planned')} style={{ width: 34, height: 34 }}><CatIcon k={cat.icon} /></div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="li-title ellipsis" style={{ fontSize: 14 }}>{cat.name}</div>
                        <div className="li-sub ellipsis" style={{ fontSize: 12 }}>{sub}</div>
                        {cat.isDebt && <div style={{ marginTop: 3 }}><span className="pill neg" data-testid="owe-pill">Owes {money(cat.debtBalance ?? 0)}</span></div>}
                        {cat.target != null && <div className="m-only" style={{ marginTop: 6 }}><div className="bar planned" style={{ height: 6 }}><i style={{ width: pct }} /></div>
                          <div className="tgt-line"><span>{money(env.assigned, { cents: false })} of {money(cat.target, { cents: false })}</span>{env.remaining > 0 ? <span className="c-planned" style={{ fontWeight: 600 }}>needs {money(env.remaining, { cents: false })}</span> : <span className="pos" style={{ fontWeight: 600 }}>funded</span>}</div></div>}
                      </div>
                    </div>
                    <div className="d-only">
                      {cat.target != null ? (<><div className="bar planned" style={{ height: 6 }}><i style={{ width: pct }} /></div>
                        <div className="tgt-line"><span className="num">{money(env.assigned, { cents: false })} / {money(cat.target, { cents: false })}</span>{env.remaining > 0 ? <span className="c-planned num" style={{ fontWeight: 600 }}>needs {money(env.remaining, { cents: false })}</span> : <span className="pos" style={{ fontWeight: 600 }}>Funded</span>}</div></>) : <span className="small muted">No target</span>}
                    </div>
                    <div className="right num col-fund small muted">{cat.target ? money(cat.target) : '—'}</div>
                    <div className="right num col-spent small muted">{env.spent ? money(env.spent) : '—'}</div>
                    <div className="right">
                      <span className={cn('avail num', over ? 'neg' : env.avail === 0 ? 'zero' : 'pos')}>{money(env.avail)}</span>
                      {over && <button className="btn sm" style={{ marginTop: 6, display: 'flex', marginLeft: 'auto', color: 'var(--neg)' }} onClick={(e) => { e.stopPropagation(); openModal({ type: 'move', to: cat.id, amount: -env.avail }); }}>Cover</button>}
                    </div>
                    <ChevronRight size={16} className="muted col-chev" />
                  </div>
                );
              })}
            </div>
          );
        })}
        {envs.every((e) => !matches(e)) && <Empty icon={<Sparkles />} title="Nothing here" text="No categories match this filter right now." />}
      </section>
      {allEnvs.some((e) => e.cat.hidden) && (
        <details className="card" style={{ marginTop: 16, overflow: 'hidden' }} data-testid="archived-categories">
          <summary className="pad small" style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--ink-2)' }}><Archive size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Archived categories · {allEnvs.filter((e) => e.cat.hidden).length}</summary>
          <div className="xs muted" style={{ padding: '0 20px 8px' }}>Left out of Ready to Assign, budget totals and new transactions. History is kept. {hiddenEnvs.length > 0 && <>Old balances they still hold add up to {money(sum(hiddenEnvs, (e) => e.env.avail))}.</>}</div>
          <div className="list">{allEnvs.filter((e) => e.cat.hidden).map((e) => (
            <div key={e.cat.id} className="li" style={{ padding: '12px 20px' }}>
              <div className="grow" style={{ minWidth: 0 }}><div className="li-title ellipsis">{e.cat.name}</div>
                {e.env.avail !== 0 && <div className="xs muted">{e.env.avail < 0 ? `Restoring brings back its earlier overspent balance of ${money(e.env.avail)} — spending that exceeded what was set aside — and it counts in your totals again.` : `Restoring brings back the ${money(e.env.avail)} it still holds.`}</div>}</div>
              <div className="right row gap8"><Money v={e.env.avail} className="amt-md" />
                <button className="btn sm" onClick={async () => { if (await setCategoryArchived(e.cat.id, false)) toast(`${e.cat.name} restored`); }}>Restore</button></div>
            </div>))}</div>
        </details>
      )}
    </div>
  );
}

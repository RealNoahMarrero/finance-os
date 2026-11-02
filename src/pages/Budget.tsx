import { useState } from 'react';
import { ArrowLeftRight, ChevronDown, ChevronRight, CircleHelp, Plus, Sparkles, Wallet } from 'lucide-react';
import { useStore } from '../store';
import { allEnvelopes, billOccurrences, readyToAssign, monthlyFlow, totalAvail, type Category, type Envelope } from '../data';
import { addDays, cn, fmtDate, money, monthLabel, monthKey, sum } from '../lib';
import { CatIcon, Callout, Empty, Money, Seg, StatusPill } from '../ui';
import { PageHead, SectionTabs } from '../shared';

const PRI = { 1: 'Essential', 2: 'Important', 3: 'Flexible' } as const;
type Filter = 'all' | 'needs' | 'over' | 'funded';

export function Budget() {
  const { data, openModal } = useStore();
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

  const matches = (e: { env: Envelope }) => filter === 'all' ? true : filter === 'needs' ? e.env.remaining > 0 : filter === 'over' ? e.env.avail < 0 : e.env.remaining === 0 && e.env.avail >= 0;
  const counts = { needs: needs.length, over: overs.length };

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
      <section className="card pad" style={{ marginBottom: 16 }} aria-label="This month" data-testid="budget-month">
        <div className="ov-sum">
          <div><div className="eyebrow">Spent this month</div><div className="amt-xl num"><Money v={thisMonth.expense} /></div><div className="xs muted">Excludes transfers</div></div>
          <div><div className="eyebrow">Left in categories</div><div className="amt-xl num"><Money v={totalAvail(data)} /></div><div className="xs muted">Money set aside, not bank cash</div></div>
          <div><div className="eyebrow">Needs a look</div><div className="amt-xl num">{overs.length + near.length}</div><div className="xs muted">{overs.length} over · {near.length} close to their amount</div></div>
        </div>
      </section>

      <details style={{ marginBottom: 16 }} open={rta < 0 || undefined}>
        <summary className="small" style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--ink-2)', padding: '4px 0 12px' }}>Advanced: envelopes &amp; funding {rta < 0 ? `· over-assigned by ${money(-rta)}` : `· ${money(rta)} unassigned`}</summary>
      <div className="grid g12">
        <section className="card rta-card fade-in" style={{ gridColumn: '1 / span 7' }} aria-label="Ready to Assign">
          <div>
            <div className="eyebrow" style={{ color: rta < 0 ? 'var(--neg)' : 'var(--planned)' }}>{rta < 0 ? 'Over-assigned' : 'Ready to Assign'}</div>
            <div className={cn('amt-hero num', rta < 0 ? 'neg' : 'c-planned')} style={{ marginTop: 6 }} data-testid="rta-value"><Money v={rta} /></div>
            <div className="small muted" style={{ marginTop: 6, maxWidth: 360 }}>{rta < 0 ? <>Your envelopes hold more than the cash recorded in your accounts. Move money between envelopes or review old balances.</> : <>Money that’s in your accounts right now but doesn’t have a job yet.</>}{totalNeeds > 0 && <> Your monthly targets still need <b className="num" style={{ color: 'var(--ink-2)' }}>{money(totalNeeds, { cents: false })}</b>.</>}</div>
          </div>
          <div className="stack gap8" style={{ flex: 'none', minWidth: 170 }}>
            <button className="btn primary" onClick={() => openModal({ type: 'assign' })} disabled={rta <= 0}><Sparkles />Assign money</button>
            <button className="btn" onClick={() => openModal({ type: 'move' })}><ArrowLeftRight />Move money</button>
          </div>
        </section>
        <section className="card pad" style={{ gridColumn: '8 / span 5' }} aria-label="Funding order">
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
            { v: 'over', label: `Overspent${counts.over ? ` · ${counts.over}` : ''}` }, { v: 'funded', label: 'Funded' }]} />
        </div>
        <button className="btn ghost sm" onClick={() => setHelp((v) => !v)} aria-expanded={help}><CircleHelp />What do these mean?</button>
      </div>
      {help && (
        <div className="fade-in" style={{ marginBottom: 12 }}>
          <Callout tone="planned">
            <b>Target</b> is what you’d like to set aside (optional). <b>Available</b> is the money in that envelope right now — it grows when you assign money and drops as you spend. A target counts as funded once the envelope holds at least that much. <b>Spent</b> is this month’s activity. Anything left in Ready to Assign has no job yet.
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
        {hiddenEnvs.length > 0 && filter === 'all' && <div className="xs muted" style={{ padding: '12px 20px', borderTop: '1px solid var(--line)' }}>{hiddenEnvs.length} archived {hiddenEnvs.length === 1 ? 'category holds' : 'categories hold'} {money(sum(hiddenEnvs, (e) => e.env.avail))} that still counts toward Ready to Assign.</div>}
        {envs.every((e) => !matches(e)) && <Empty icon={<Sparkles />} title="Nothing here" text="No categories match this filter right now." />}
      </section>
    </div>
  );
}

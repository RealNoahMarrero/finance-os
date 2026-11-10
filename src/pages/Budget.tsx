import { useState } from 'react';
import { Archive, ChevronRight, Plus, Sparkles, Wallet } from 'lucide-react';
import { useStore } from '../store';
import { allEnvelopes, billOccurrences, readyToAssign, monthlyFlow, type Category, type Envelope } from '../data';
import { addDays, cn, fmtDate, money, monthLabel, monthKey, sum } from '../lib';
import { CatIcon, Empty, Money, Seg } from '../ui';
import { PageHead } from '../shared';

type Filter = 'all' | 'needs' | 'over' | 'money' | 'funded' | 'debts';
type Row = { cat: Category; env: Envelope };

export function Budget() {
  const { data, openModal, setCategoryArchived, toast } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [sel, setSel] = useState<string | null>(null);
  const rta = readyToAssign(data);
  const liquid = sum(data.accounts.filter((a) => a.type !== 'credit'), (a) => a.balance);
  const allEnvs = allEnvelopes(data);
  const envs = allEnvs.filter((e) => !e.cat.hidden);
  const hiddenEnvs = allEnvs.filter((e) => e.cat.hidden && e.env.avail !== 0);
  const wide = () => matchMedia('(min-width: 1101px)').matches;

  if (data.categories.length === 0) {
    return (
      <div className="page"><PageHead title="Budget" sub="Every dollar gets a job" />
        <div className="card"><Empty icon={<Wallet />} title="No categories yet" text="Categories are where you set money aside — rent, groceries, a vacation fund." action={<button className="btn primary" onClick={() => openModal({ type: 'category-add' })}><Plus />New category</button>} /></div>
      </div>
    );
  }

  const overs = envs.filter((e) => e.env.avail < 0);
  const needs = envs.filter((e) => e.env.remaining > 0);
  const isFunded = (e: Row) => !!e.cat.target && e.env.remaining === 0 && e.env.avail >= 0 && !e.cat.billPaused;
  const matches = (e: Row) => filter === 'all' ? true : filter === 'needs' ? e.env.remaining > 0 : filter === 'over' ? e.env.avail < 0 : filter === 'money' ? e.env.avail > 0 : filter === 'debts' ? !!e.cat.isDebt && (e.cat.debtBalance ?? 0) > 0 : isFunded(e);
  const counts = { needs: needs.length, over: overs.length, money: envs.filter((e) => e.env.avail > 0).length, debts: envs.filter((e) => e.cat.isDebt && (e.cat.debtBalance ?? 0) > 0).length, funded: envs.filter(isFunded).length };

  const nextDue = (c: Category) => {
    const b = data.bills.find((x) => x.categoryId === c.id);
    if (!b || b.paused) return null;
    return billOccurrences(data, addDays(data.today, -400), addDays(data.today, 40)).filter((x) => x.bill.id === b.id && !x.paid)[0] ?? null;
  };
  const status = (e: Row): { text: string; tone: '' | 'neg' | 'pos' } => {
    const due = nextDue(e.cat);
    if (e.env.avail < 0) return { text: `Overspent by ${money(-e.env.avail, { cents: false })}`, tone: 'neg' };
    if (e.cat.billPaused) return { text: e.cat.billArchived ? 'Archived bill' : 'Paused bill', tone: '' };
    const bits: string[] = [];
    if (e.cat.isDebt && (e.cat.debtBalance ?? 0) > 0) bits.push(`Owes ${money(e.cat.debtBalance ?? 0, { cents: false })}`);
    if (e.env.remaining > 0) bits.push(`Needs ${money(e.env.remaining, { cents: false })}`);
    else if (e.cat.target) bits.push('Funded');
    if (due) bits.push(due.status === 'overdue' ? `overdue since ${fmtDate(due.date)}` : `due ${fmtDate(due.date)}`);
    return { text: bits.join(' · ') || ' ', tone: e.env.remaining === 0 && e.cat.target ? 'pos' : '' };
  };
  const pick = (id: string) => { if (wide()) setSel(id); else openModal({ type: 'category', id }); };
  const flow = monthlyFlow(data);
  const spentMonth = flow[flow.length - 1].expense;
  const selRow = envs.find((e) => e.cat.id === sel) ?? null;

  return (
    <div className="page">
      <PageHead title="Budget" sub={monthLabel(monthKey(data.today), true)}
        actions={<><button className="btn" onClick={() => openModal({ type: 'category-add' })}><Plus />New category</button><button className="btn primary" data-testid="budget-move" onClick={() => openModal({ type: 'move' })}>Move money</button></>} />

      <section className="card pad row between" style={{ marginBottom: 16, background: rta < 0 ? 'var(--neg-soft)' : 'var(--brand-soft)', borderColor: 'transparent', boxShadow: 'none', gap: 16, flexWrap: 'wrap' }} aria-label="Ready to Assign" data-testid="rta">
        <div><div className="eyebrow" style={{ color: rta < 0 ? 'var(--neg)' : 'var(--brand)' }}>{rta < 0 ? 'Over-assigned' : 'Ready to assign'}</div>
          <div className={cn('amt-xl num', rta < 0 ? 'neg' : 'c-planned')} data-testid="rta-value"><Money v={rta} /></div></div>
        <div className="small muted" style={{ maxWidth: 300 }}>{rta < 0 ? 'You’ve set aside more than your accounts hold. Move money back to fix it.' : overs.length ? `Cover ${overs[0].cat.name}${overs.length > 1 ? ` and ${overs.length - 1} more` : ''} first${needs.length ? ', then fund what needs it' : ''}.` : needs.length ? `${needs.length} ${needs.length === 1 ? 'category needs' : 'categories need'} funding.` : 'Everything is funded.'} Spent so far this month: <b className="num" style={{ color: 'var(--ink)' }}>{money(spentMonth, { cents: false })}</b></div>
      </section>

      <div style={{ overflowX: 'auto', marginBottom: 6 }}>
        <Seg value={filter} onChange={setFilter} options={[
          { v: 'all', label: 'All' }, { v: 'needs', label: `Needs funding${counts.needs ? ` · ${counts.needs}` : ''}` }, { v: 'over', label: `Overspent${counts.over ? ` · ${counts.over}` : ''}` },
          { v: 'money', label: `Has money · ${counts.money}` }, { v: 'funded', label: `Funded · ${counts.funded}` }, { v: 'debts', label: `Debts · ${counts.debts}` }]} />
      </div>

      <div className="split-layout">
        <div>
          {data.groups.map((g) => {
            const rows = envs.filter((e) => e.cat.groupId === g.id && matches(e));
            if (!rows.length) return null;
            return (
              <section key={g.id} aria-label={g.name}>
                <div className="grp-h"><span>{g.name}</span><span className="num">{money(sum(rows, (e) => e.env.avail), { cents: false })}</span></div>
                {rows.map((e) => {
                  const st = status(e); const over = e.env.avail < 0;
                  return (
                    <div key={e.cat.id} className="brow2" role="button" tabIndex={0} aria-selected={sel === e.cat.id} onClick={() => pick(e.cat.id)}
                      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(e.cat.id); } }} data-testid="cat-row">
                      <div className={cn('li-ico', over ? 'neg' : 'planned')}><CatIcon k={e.cat.icon} /></div>
                      <div className="grow"><div className="li-title ellipsis">{e.cat.name}</div><div className={cn('li-sub ellipsis', st.tone)} style={st.tone === 'neg' ? { fontWeight: 600 } : undefined}>{st.text}</div></div>
                      {over && <button className="btn sm" onClick={(ev) => { ev.stopPropagation(); openModal({ type: 'move', to: e.cat.id, amount: -e.env.avail }); }}>Cover</button>}
                      <div className={cn('amt-md num', over && 'neg')} style={{ minWidth: 90, textAlign: 'right' }}><Money v={e.env.avail} /></div>
                      <ChevronRight size={16} className="muted" />
                    </div>
                  );
                })}
              </section>
            );
          })}
          {envs.every((e) => !matches(e)) && <div className="card"><Empty icon={<Sparkles />} title="Nothing here" text="No categories match this filter." /></div>}

          {allEnvs.some((e) => e.cat.hidden) && (
            <details className="card" style={{ marginTop: 20, overflow: 'hidden' }} data-testid="archived-categories">
              <summary className="pad small" style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--ink-2)' }}><Archive size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Archived categories · {allEnvs.filter((e) => e.cat.hidden).length}</summary>
              {hiddenEnvs.length > 0 && <div className="xs muted" style={{ padding: '0 20px 8px' }}>Left out of Ready to Assign and totals. They still hold {money(sum(hiddenEnvs, (e) => e.env.avail))} from before.</div>}
              <div className="list">{allEnvs.filter((e) => e.cat.hidden).map((e) => (
                <div key={e.cat.id} className="li" style={{ padding: '12px 20px' }}>
                  <div className="grow" style={{ minWidth: 0 }}><div className="li-title ellipsis">{e.cat.name}</div>
                    {e.env.avail !== 0 && <div className="xs muted">{e.env.avail < 0 ? `Restoring brings back its overspent balance of ${money(e.env.avail)}.` : `Restoring brings back the ${money(e.env.avail)} it holds.`}</div>}</div>
                  <div className="right row gap8"><Money v={e.env.avail} className="amt-md" />
                    <button className="btn sm" onClick={async () => { if (await setCategoryArchived(e.cat.id, false)) toast(`${e.cat.name} restored`); }}>Restore</button></div>
                </div>))}</div>
            </details>
          )}
        </div>

        <aside className="card pane" aria-label="Category details">
          {!selRow ? (
            <div aria-label="Budget at a glance">
              <div className="eyebrow">Where your money stands</div>
              <div className="kv"><span className="k">In your accounts</span><span className="v num">{money(liquid, { cents: false })}</span></div>
              <div className="kv"><span className="k">Set aside in categories</span><span className="v num">{money(liquid - rta, { cents: false })}</span></div>
              <div className="kv"><span className="k">Ready to assign</span><span className={cn('v num', rta < 0 && 'neg')}>{money(rta, { cents: false })}</span></div>
              {(overs.length > 0 || needs.length > 0) && <div className="eyebrow" style={{ margin: '18px 0 4px' }}>{overs.length ? 'Cover first' : 'Needs funding'}</div>}
              {[...overs, ...needs.filter((e) => e.env.avail >= 0)].slice(0, 5).map((e) => (
                <button key={e.cat.id} className="rowx" style={{ padding: '9px 0' }} onClick={() => setSel(e.cat.id)}>
                  <div className="grow"><div className="li-title" style={{ fontSize: 14 }}>{e.cat.name}</div><div className="li-sub">{e.env.avail < 0 ? `Over by ${money(-e.env.avail, { cents: false })}` : `Needs ${money(e.env.remaining, { cents: false })}`}</div></div><ChevronRight size={15} className="muted" /></button>
              ))}
              <div className="xs muted" style={{ marginTop: 12 }}>Select a category for its details, or use Move money to fund it.</div>
            </div>
          ) : (() => {
            const { cat, env } = selRow; const over = env.avail < 0; const bill = data.bills.find((b) => b.categoryId === cat.id);
            return (<>
              <div className="row gap12"><div className={cn('li-ico', over ? 'neg' : 'planned')}><CatIcon k={cat.icon} /></div>
                <div><div className="sect-title" style={{ fontSize: 24 }}>{cat.name}</div><div className="small muted">{data.groups.find((g) => g.id === cat.groupId)?.name}</div></div></div>
              <div className="eyebrow" style={{ margin: '18px 0 4px' }}>Available</div>
              <div className={cn('amt-xl num', over && 'neg')} style={{ fontSize: 40 }}><Money v={env.avail} /></div>
              {cat.target != null && <><div className="bar planned" style={{ margin: '12px 0 6px' }}><i style={{ width: `${env.fundedPct * 100}%` }} /></div>
                <div className="small muted">{Math.round(env.fundedPct * 100)}% of {money(cat.target, { cents: false })} monthly target</div></>}
              <div style={{ marginTop: 14 }}>
                <div className="kv"><span className="k">Spent this month</span><span className="v num">{money(env.spent)}</span></div>
                {cat.target != null && <div className="kv"><span className="k">Still to fund</span><span className="v num">{money(env.remaining)}</span></div>}
                {cat.isDebt && <div className="kv"><span className="k">Owed</span><span className="v num">{money(cat.debtBalance ?? 0)}</span></div>}
                <div className="kv"><span className="k">Bill</span><span className="v">{bill ? `${money(bill.amount)} ${bill.paused ? 'paused' : bill.recurring ? bill.period.toLowerCase() : 'once'}` : 'None'}</span></div>
              </div>
              <div className="row gap8" style={{ marginTop: 16 }}>
                <button className="btn primary grow" onClick={() => openModal({ type: 'move', ...(over ? { to: cat.id, amount: -env.avail } : env.avail > 0 ? { from: cat.id } : { from: 'rta', to: cat.id, amount: env.remaining || undefined }) })}>{over ? 'Cover' : 'Move money'}</button>
                <button className="btn" onClick={() => openModal({ type: 'category', id: cat.id })}>Manage</button>
              </div>
              <div className="xs muted" style={{ marginTop: 10 }}>Target, schedule, pause, archive and debt settings are under Manage.</div>
            </>);
          })()}
        </aside>
      </div>
    </div>
  );
}

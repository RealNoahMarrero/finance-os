// Credit page: scores you enter by hand, utilization from your existing credit-card accounts, a what-if calculator and statement/payment dates.
// Nothing here writes to the ledger. The calculator never saves anything.
import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CalendarClock, Gauge, Pencil, Plus, RotateCcw, TriangleAlert } from 'lucide-react';
import { useStore } from '../store';
import { PageHead } from '../shared';
import { Callout, Empty, Money, Seg, StatusPill } from '../ui';
import { MoneyInput } from '../sheets';
import { ScoreChart, SeriesSwatch, BUREAU_COLOR } from '../charts';
import {
  BUREAUS, cardDates, cardRows, latestByBureau, latestReported, models, reportedUtil, scoreRows, scoreSeries, totals, totalsCaveats, utilLevel, whatIf,
  type Bureau, type CardRow, type ScoreRow, type UtilLevel,
} from '../credit';
import { centsToInput, cn, diffDays, fmtDate, money, plural, toCents } from '../lib';

const barTone = (l: UtilLevel) => (l === 'low' ? 'actual' : l === 'mid' ? 'warn' : l === 'none' ? '' : 'neg');
const pctText = (p: number | null) => (p == null ? '—' : `${p.toFixed(1).replace(/\.0$/, '')}%`);
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;

export function ChangeBadge({ row, compact }: { row: ScoreRow; compact?: boolean }) {
  if (row.change == null) return <span className="xs muted">{compact ? 'First entry' : 'First entry for this bureau & model'}</span>;
  if (row.change === 0) return <span className="xs muted">No change</span>;
  const up = row.change > 0;
  return <span className={cn('small num', up ? 'pos' : 'neg')} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontWeight: 600 }}>{up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{signed(row.change)}{!compact && <span className="muted" style={{ fontWeight: 500, marginLeft: 4 }}>vs {fmtDate(row.prev!.observedOn)}</span>}</span>;
}

function UtilBar({ pct, level }: { pct: number | null; level: UtilLevel }) {
  return <div className={cn('bar', barTone(level))} role="img" aria-label={pct == null ? 'Utilization unavailable' : `Utilization ${pctText(pct)}`}><i style={{ width: `${Math.min(100, pct ?? 0)}%` }} /></div>;
}

export function Credit({ embedded }: { embedded?: boolean } = {}) {
  const { data, openModal } = useStore();
  const credit = data.credit;
  const rows = useMemo(() => cardRows(data, credit), [data, credit]);
  const tot = useMemo(() => totals(rows), [rows]);
  const caveats = useMemo(() => totalsCaveats(tot), [tot]);
  const sRows = useMemo(() => scoreRows(credit.scores), [credit.scores]);
  const rep = useMemo(() => reportedUtil(rows, credit.reported), [rows, credit.reported]);
  const latest = sRows[0] ?? null;

  return (
    <div className={embedded ? '' : 'page'} id="credit-page">
      {embedded
        ? <div className="row between" style={{ marginBottom: 14 }}><div className="small muted">Scores you enter by hand · utilization from your credit-card accounts</div><button className="btn primary" onClick={() => openModal({ type: 'credit-score' })}><Plus />Add score</button></div>
        : <PageHead title="Credit" sub="Scores you enter by hand · utilization from your credit-card accounts"
        actions={<button className="btn primary" onClick={() => openModal({ type: 'credit-score' })}><Plus />Add score</button>} />}
      {!credit.ready && <div style={{ marginBottom: 16 }}><Callout tone="warn">Credit tracking isn’t set up in the database yet, so scores can’t be saved. Everything else in Finances is unaffected.</Callout></div>}

      {/* ── Overview ── */}
      <div className="grid g12" style={{ gap: 12, marginBottom: 12 }}>
        <section className="card pad" style={{ gridColumn: 'span 6' }} aria-label="Latest score">
          <div className="eyebrow">Latest score</div>
          {latest ? <>
            <div className="row gap12" style={{ alignItems: 'baseline', marginTop: 6, flexWrap: 'wrap' }}>
              <div className="amt-hero num" data-testid="latest-score">{latest.score}</div>
              <ChangeBadge row={latest} />
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>{latest.bureau} · {latest.model} · {fmtDate(latest.observedOn, 'long')}{latest.source ? ` · ${latest.source}` : ''}</div>
            <div className="xs muted" style={{ marginTop: 4 }}>Change is only measured against the previous {latest.bureau} {latest.model} entry.</div>
          </> : <div style={{ marginTop: 8 }}>
            <div className="small muted">No scores yet. Add a score from any bureau’s app or report — Finances never looks scores up or estimates them.</div>
            <button className="btn" style={{ marginTop: 12 }} onClick={() => openModal({ type: 'credit-score' })}><Plus />Add your first score</button>
          </div>}
        </section>

        <section className="card pad" style={{ gridColumn: 'span 6' }} aria-label="Total utilization">
          <div className="row between"><div className="eyebrow">Total utilization</div><StatusPill status="muted">{rep.mode === 'reported' ? 'Reported' : 'Estimate'}</StatusPill></div>
          <div className="row gap12" style={{ alignItems: 'baseline', marginTop: 6 }}>
            <div className={cn('amt-hero num', tot.level === 'high' || tot.level === 'over' ? 'neg' : tot.level === 'mid' ? 'warn' : '')} data-testid="total-util">{pctText(tot.pct)}</div>
            {tot.pct != null && <div className="small muted num">{money(tot.eligibleOwed)} of {money(tot.eligibleLimit)}</div>}
          </div>
          <div style={{ marginTop: 10 }}><UtilBar pct={tot.pct} level={tot.level} /></div>
          <div className="small muted" style={{ marginTop: 8 }}>{tot.pct == null ? 'Add a credit limit to at least one active card to calculate this.' : `Estimated from today’s balances across ${plural(tot.eligibleCards, 'card')} with a limit.`}</div>
          <div className="xs muted" style={{ marginTop: 4 }} data-testid="reported-util">
            {rep.mode === 'reported' ? <>Reported {pctText(rep.pct)} as of {fmtDate(rep.asOf!)} (your entered balances).</>
              : rep.mode === 'mixed' ? <>Reported-balance view: {pctText(rep.pct)} — <b>partly estimated</b>: {rep.usedCurrent.map((r) => r.account.name).join(', ')} {rep.usedCurrent.length === 1 ? 'has' : 'have'} no reported balance, so today’s balance is used.</>
                : 'No reported balances entered, so this is an estimate rather than what a bureau has seen.'}
          </div>
        </section>
      </div>
      <div className="grid g12 keep2" style={{ gap: 12, marginBottom: 12 }}>
        {[['Revolving balances', tot.owed, 'Owed on active cards'], ['Total credit limits', tot.limits, 'Active cards with a limit'], ['Available credit', tot.available, 'Limit minus balance, never below $0']].map(([l, v, s]) => (
          <section key={l as string} className="card pad" style={{ gridColumn: 'span 4' }}>
            <div className="eyebrow">{l}</div><div className="amt-lg num" style={{ marginTop: 6 }}><Money v={v as number} /></div><div className="xs muted" style={{ marginTop: 4 }}>{s}</div>
          </section>
        ))}
      </div>
      {caveats.length > 0 && <div style={{ marginBottom: 20 }}><Callout tone={tot.overLimit.length ? 'warn' : undefined} icon={tot.overLimit.length ? <TriangleAlert /> : undefined}>
        <div className="stack" style={{ gap: 4 }}>{caveats.map((c) => <div key={c}>{c}</div>)}</div></Callout></div>}

      <ScoreHistory sRows={sRows} />
      <BureauCards sRows={sRows} />
      <CardUtilization rows={rows} />
      <Calculator rows={rows} />
      <DatesSection rows={rows} />
    </div>
  );
}

// ── Score history ─────────────────────────────────────────
function ScoreHistory({ sRows }: { sRows: ScoreRow[] }) {
  const { data, openModal } = useStore();
  const [bureau, setBureau] = useState<'all' | Bureau>('all');
  const [model, setModel] = useState('all');
  const all = data.credit.scores;
  const modelList = models(all);
  const filtered = sRows.filter((r) => (bureau === 'all' || r.bureau === bureau) && (model === 'all' || r.model.trim().replace(/\s+/g, ' ').toLowerCase() === model.toLowerCase()));
  const series = scoreSeries(filtered);
  return (
    <section className="card pad" style={{ marginBottom: 20 }} aria-label="Score history">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 16, fontWeight: 650, letterSpacing: '-0.02em' }}>Score history</h2>
        <button className="btn sm" onClick={() => openModal({ type: 'credit-score' })}><Plus />Add score</button>
      </div>
      {all.length === 0 ? <Empty icon={<Gauge />} title="No scores yet" text="Add a score and its date. Each bureau and scoring model is charted as its own line, so FICO and VantageScore are never mixed." /> : <>
        <div className="stack" style={{ gap: 8, marginTop: 12 }}>
          <div className="chips" role="group" aria-label="Filter by bureau"><button className="chip" aria-pressed={bureau === 'all'} onClick={() => setBureau('all')}>All bureaus</button>{BUREAUS.map((b) => <button key={b} className="chip" aria-pressed={bureau === b} onClick={() => setBureau(b)}>{b}</button>)}</div>
          <div className="chips" role="group" aria-label="Filter by scoring model"><button className="chip" aria-pressed={model === 'all'} onClick={() => setModel('all')}>All models</button>{modelList.map((m) => <button key={m} className="chip" aria-pressed={model.toLowerCase() === m.toLowerCase()} onClick={() => setModel(m)}>{m}</button>)}</div>
        </div>
        {filtered.length === 0 ? <div className="small muted" style={{ padding: '24px 0' }}>No entries match these filters.</div> : <>
          <div style={{ marginTop: 14 }}><ScoreChart series={series} height={340} /></div>
          <div className="legend" style={{ marginTop: 10 }} aria-label="Chart legend">{series.map((s) => <span key={s.key}><SeriesSwatch s={s} all={series} />{s.bureau} · {s.model}</span>)}</div>
          {series.length > 1 && <div className="xs muted" style={{ marginTop: 6 }}>Each line is one bureau and one scoring model; lines are never combined or compared across models.</div>}
          <div className="list" style={{ marginTop: 14 }} role="table" aria-label="Score entries">
            {filtered.map((r) => (
              <button key={r.id} className="li hover" style={{ padding: '10px 4px', textAlign: 'left' }} data-testid="score-row" onClick={() => openModal({ type: 'credit-score', id: r.id })}>
                <span className="li-ico" style={{ background: 'transparent' }}><i className="dot" style={{ background: BUREAU_COLOR[r.bureau] }} /></span>
                <span className="grow" style={{ minWidth: 0 }}><span className="li-title">{r.bureau} · {r.model}</span><span className="xs muted" style={{ display: 'block' }}>{fmtDate(r.observedOn, 'long')}{r.source ? ` · ${r.source}` : ''}{r.notes ? ' · has notes' : ''}</span></span>
                <span style={{ textAlign: 'right' }}><span className="amt-md num" style={{ display: 'block' }}>{r.score}</span><ChangeBadge row={r} compact /></span>
              </button>
            ))}
          </div>
        </>}
      </>}
    </section>
  );
}

// ── Bureau cards ──────────────────────────────────────────
function BureauCards({ sRows }: { sRows: ScoreRow[] }) {
  const { openModal } = useStore();
  const per = latestByBureau(sRows);
  return (
    <section style={{ marginBottom: 20 }} aria-label="Scores by bureau">
      <h2 style={{ fontSize: 16, fontWeight: 650, letterSpacing: '-0.02em', marginBottom: 10 }}>By bureau</h2>
      <div className="grid g12 keep2" style={{ gap: 12 }}>
        {per.map(({ bureau, row }) => {
          const others = sRows.filter((r) => r.bureau === bureau && row && r.id !== row.id && r.model.toLowerCase() !== row.model.toLowerCase());
          const seen = new Set<string>(); const otherLatest = others.filter((r) => { const k = r.model.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
          return (
            <div key={bureau} className="card pad half" style={{ gridColumn: 'span 4' }} data-testid={`bureau-${bureau}`}>
              <div className="row gap12"><i className="dot" style={{ background: BUREAU_COLOR[bureau] }} /><div className="eyebrow">{bureau}</div></div>
              {row ? <>
                <div className="row gap12" style={{ alignItems: 'baseline', marginTop: 6, flexWrap: 'wrap' }}><div className="amt-xl num">{row.score}</div><ChangeBadge row={row} compact /></div>
                <div className="small muted" style={{ marginTop: 4 }}>{row.model} · {fmtDate(row.observedOn)}</div>
                {otherLatest.map((o) => <div key={o.id} className="xs muted" style={{ marginTop: 4 }}>{o.model}: <b className="num" style={{ color: 'var(--ink-2)' }}>{o.score}</b> · {fmtDate(o.observedOn)} (tracked separately)</div>)}
                <button className="btn sm" style={{ marginTop: 12 }} onClick={() => openModal({ type: 'credit-score', bureau, model: row.model })}><Plus />Add {bureau} score</button>
              </> : <>
                <div className="small muted" style={{ marginTop: 8 }}>No {bureau} score entered.</div>
                <button className="btn sm" style={{ marginTop: 12 }} onClick={() => openModal({ type: 'credit-score', bureau })}><Plus />Add {bureau} score</button>
              </>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Card utilization + reported balances ──────────────────
function CardUtilization({ rows }: { rows: CardRow[] }) {
  const { data, openModal } = useStore();
  const reported = [...data.credit.reported].sort((a, b) => (a.reportedOn < b.reportedOn ? 1 : -1));
  return (
    <section style={{ marginBottom: 20 }} aria-label="Card utilization">
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 650, letterSpacing: '-0.02em' }}>Card utilization</h2>
        {rows.length > 0 && <button className="btn sm" onClick={() => openModal({ type: 'credit-reported' })}><Plus />Reported balance</button>}
      </div>
      {rows.length === 0 ? <div className="card"><Empty icon={<Gauge />} title="No credit cards yet" text="Credit cards you add under Accounts appear here automatically, with their limits and balances." action={<a className="btn" href="#/accounts">Go to Accounts</a>} /></div> : (
        <div className="grid g12" style={{ gap: 12 }}>
          {rows.map((r) => {
            const rb = latestReported(data.credit.reported, r.account.id);
            const rbPct = rb && r.hasLimit ? (Math.round((rb.balance * 1000) / r.limit) / 10) : null;
            return (
              <div key={r.account.id} className={cn('card pad half', !r.active && 'dim')} style={{ gridColumn: 'span 6', opacity: r.active ? 1 : 0.7 }} data-testid={`card-${r.account.name}`}>
                <div className="row between" style={{ gap: 8 }}>
                  <div style={{ minWidth: 0 }}><div className="li-title">{r.account.name}</div>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                      {!r.active && <StatusPill status="muted">Inactive</StatusPill>}
                      {r.active && !r.hasLimit && <StatusPill status="warn">No limit</StatusPill>}
                      {r.eligible && r.overBy > 0 && <StatusPill status="late">Over limit</StatusPill>}
                      {!r.verified && <StatusPill status="warn">Not reconciled</StatusPill>}
                      {r.creditBalance > 0 && <StatusPill status="planned">Credit balance</StatusPill>}
                    </div></div>
                  <button className="icon-btn" aria-label={`Edit ${r.account.name} credit details`} onClick={() => openModal({ type: 'credit-card', accountId: r.account.id })}><Pencil /></button>
                </div>
                <div className="row gap12" style={{ alignItems: 'baseline', marginTop: 10 }}>
                  <div className={cn('amt-xl num', r.level === 'high' || r.level === 'over' ? 'neg' : r.level === 'mid' ? 'warn' : '')}>{r.eligible ? pctText(r.pct) : '—'}</div>
                  <div className="small muted num">{money(r.owed)}{r.hasLimit ? ` of ${money(r.limit)}` : ''}</div>
                </div>
                <div style={{ marginTop: 8 }}><UtilBar pct={r.eligible ? r.pct : null} level={r.eligible ? r.level : 'none'} /></div>
                <div className="kv" style={{ marginTop: 10 }}><span className="k">Available credit</span><span className="v num">{r.eligible ? money(r.available) : '—'}</span></div>
                {r.overBy > 0 && <div className="kv"><span className="k">Over limit by</span><span className="v num neg">{money(r.overBy)}</span></div>}
                {r.creditBalance > 0 && <div className="kv"><span className="k">Credit balance</span><span className="v num">{money(r.creditBalance)}</span></div>}
                <div className="kv"><span className="k">Reported to a bureau</span><span className="v num">{rb ? <>{money(rb.balance)}{rbPct != null && ` · ${pctText(rbPct)}`}<span className="xs muted"> · {fmtDate(rb.reportedOn)}{rb.bureau ? ` · ${rb.bureau}` : ''}</span></> : <span className="muted">Not entered</span>}</span></div>
                {r.notes.length > 0 && <div className="xs muted" style={{ marginTop: 8 }}>{r.notes.join(' · ')}</div>}
                {!r.hasLimit && r.active && <button className="btn sm" style={{ marginTop: 10 }} onClick={() => openModal({ type: 'credit-card', accountId: r.account.id })}>Set credit limit</button>}
              </div>
            );
          })}
        </div>
      )}
      {reported.length > 0 && <div className="card pad" style={{ marginTop: 12 }}>
        <div className="eyebrow">Reported balances you’ve entered</div>
        <div className="list" style={{ marginTop: 6 }}>
          {reported.map((r) => {
            const a = data.accounts.find((x) => x.id === r.accountId);
            return <button key={r.id} className="li hover" style={{ padding: '10px 4px', textAlign: 'left' }} data-testid="reported-row" onClick={() => openModal({ type: 'credit-reported', id: r.id })}>
              <span className="grow"><span className="li-title">{a?.name ?? 'Card'}</span><span className="xs muted" style={{ display: 'block' }}>{fmtDate(r.reportedOn, 'long')}{r.bureau ? ` · ${r.bureau}` : ''}</span></span>
              <span className="amt-md num">{money(r.balance)}</span></button>;
          })}
        </div>
      </div>}
    </section>
  );
}

// ── What-if calculator ────────────────────────────────────
function Calculator({ rows }: { rows: CardRow[] }) {
  const { data } = useStore();
  const [pay, setPay] = useState<Record<string, string>>({});
  const [base, setBase] = useState<'current' | 'reported'>('current');
  const el = rows.filter((r) => r.eligible);
  const hasReported = el.some((r) => latestReported(data.credit.reported, r.account.id));
  const useRep = base === 'reported' && hasReported;
  const result = useMemo(() => whatIf(rows, Object.fromEntries(Object.entries(pay).map(([k, v]) => [k, toCents(v)])), data.credit.reported, useRep), [rows, pay, data.credit.reported, useRep]);
  const touched = Object.values(pay).some((v) => v !== '');
  return (
    <section className="card pad" style={{ marginBottom: 20 }} aria-label="What-if calculator">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div><h2 style={{ fontSize: 16, fontWeight: 650, letterSpacing: '-0.02em' }}>What if I pay…</h2><div className="small muted">Try payments on one or several cards. Nothing is saved or posted.</div></div>
        <button className="btn sm" disabled={!touched} onClick={() => setPay({})}><RotateCcw />Reset</button>
      </div>
      {el.length === 0 ? <div className="small muted" style={{ padding: '18px 0' }}>The calculator needs an active card with a credit limit.</div> : <>
        {hasReported && <div style={{ marginTop: 12 }}><Seg value={base} onChange={setBase} options={[{ v: 'current', label: 'Current balances' }, { v: 'reported', label: 'Reported balances' }]} /></div>}
        <div className="xs muted" style={{ marginTop: 8 }} data-testid="calc-baseline">{useRep ? 'Scenario based on the balances you entered as reported (cards without one use today’s balance).' : 'Starting point: today’s balance on each card.'}</div>
        <div className="stack" style={{ gap: 0, marginTop: 8 }}>
          {result.cards.map((c) => (
            <div key={c.row.account.id} className="row gap12" style={{ padding: '12px 0', borderTop: '1px solid var(--line)', flexWrap: 'wrap', alignItems: 'center' }} data-testid="calc-row">
              <div className="grow" style={{ minWidth: 150 }}><div className="li-title">{c.row.account.name}</div><div className="xs muted num">Owes {money(c.baseline)} · limit {money(c.row.limit)} · {pctText(c.pctBefore)}</div></div>
              <div style={{ width: 130 }}><MoneyInput value={pay[c.row.account.id] ?? ''} onChange={(v) => setPay({ ...pay, [c.row.account.id]: v })} placeholder="Payment" id={`pay-${c.row.account.id}`} /></div>
              <button className="chip" onClick={() => setPay({ ...pay, [c.row.account.id]: centsToInput(c.baseline) })} disabled={c.baseline <= 0}>Pay in full</button>
              <div style={{ minWidth: 120, textAlign: 'right' }}><div className="amt-md num">{money(c.after)}</div><div className={cn('xs num', c.pctAfter != null && utilLevel(c.pctAfter) === 'low' ? '' : 'muted')}>{pctText(c.pctAfter)}{c.capped && <span className="warn"> · capped at balance</span>}</div></div>
            </div>
          ))}
        </div>
        <div className="card pad" style={{ boxShadow: 'none', background: 'var(--surface-2)', marginTop: 8 }} data-testid="calc-result">
          <div className="grid g12" style={{ gap: 12 }}>
            <div style={{ gridColumn: 'span 4' }}><div className="eyebrow">Overall utilization</div><div className="amt-lg num" style={{ marginTop: 4 }}>{pctText(result.pctBefore)} → <span data-testid="calc-after">{pctText(result.pctAfter)}</span></div>
              {result.pointsChange != null && result.pointsChange !== 0 && <div className="xs muted num">{result.pointsChange > 0 ? '+' : '−'}{Math.abs(result.pointsChange)} percentage points</div>}</div>
            <div style={{ gridColumn: "span 4" }}><div className="eyebrow">Total balances</div><div className="amt-lg num" style={{ marginTop: 4 }}>{money(result.owedBefore)} → {money(result.owedAfter)}</div><div className="xs muted num">{money(result.totalPay)} in payments</div></div>
            <div style={{ gridColumn: "span 4" }}><div className="eyebrow">Available credit</div><div className="amt-lg num" style={{ marginTop: 4 }}>{money(result.availableBefore)} → {money(result.availableAfter)}</div></div>
          </div>
        </div>
        <div className="xs muted" style={{ marginTop: 10 }}>Utilization is one of several factors in a credit score. This tool shows how your balances would change — it can’t predict what any score would do.</div>
      </>}
    </section>
  );
}

// ── Statement & payment dates ─────────────────────────────
function DatesSection({ rows }: { rows: CardRow[] }) {
  const { data, openModal } = useStore();
  const active = rows.filter((r) => r.active);
  const when = (d?: string) => (d ? (diffDays(d, data.today) === 0 ? 'today' : diffDays(d, data.today) > 0 ? `in ${plural(diffDays(d, data.today), 'day')}` : `${plural(-diffDays(d, data.today), 'day')} ago`) : '');
  return (
    <section style={{ marginBottom: 24 }} aria-label="Statement and payment dates">
      <h2 style={{ fontSize: 16, fontWeight: 650, letterSpacing: '-0.02em', marginBottom: 10 }}>Statement & payment dates</h2>
      {active.length === 0 ? <div className="card pad small muted">No active cards.</div> : <div className="card pad"><div className="list">
        {active.map((r) => {
          const d = cardDates(data, data.credit, r);
          return (
            <div key={r.account.id} style={{ padding: '12px 0' }} data-testid={`dates-${r.account.name}`}>
              <div className="row between"><div className="li-title">{r.account.name}</div>
                <button className="btn sm" onClick={() => openModal({ type: 'credit-card', accountId: r.account.id })}><CalendarClock />Edit</button></div>
              <div className="grid g12" style={{ gap: 8, marginTop: 8 }}>
                <div style={{ gridColumn: "span 4" }}><div className="xs muted">Statement closes</div><div className="small" style={{ fontWeight: 600 }}>{d.closing ? `${fmtDate(d.closing)} · ${when(d.closing)}` : <span className="muted" style={{ fontWeight: 400 }}>Not set</span>}</div>{d.closingNote && <div className="xs warn">{d.closingNote}</div>}{d.closing && <div className="xs muted">{r.meta.repeats ? 'Repeats monthly' : 'One date'}</div>}</div>
                <div style={{ gridColumn: "span 4" }}><div className="xs muted">Payment due</div><div className={cn('small', d.due && diffDays(d.due, data.today) < 0 && 'neg')} style={{ fontWeight: 600 }}>{d.due ? `${fmtDate(d.due)} · ${when(d.due)}` : <span className="muted" style={{ fontWeight: 400 }}>No bill linked</span>}</div>
                  <div className="xs muted">{d.dueBill ? `From bill · ${d.dueBill.period}${d.dueBill.paused ? ' · paused' : ''}` : d.dueSource === 'account' ? 'From the account' : ''}</div></div>
                <div style={{ gridColumn: "span 4" }}><div className="xs muted">Last reported</div><div className="small" style={{ fontWeight: 600 }}>{d.lastReported ? fmtDate(d.lastReported) : <span className="muted" style={{ fontWeight: 400 }}>Not entered</span>}</div></div>
              </div>
            </div>
          );
        })}
      </div><div className="xs muted" style={{ marginTop: 8 }}>Due dates come from your existing bills, so marking a bill paid moves them forward here too. Nothing on this page posts a payment.</div></div>}
    </section>
  );
}

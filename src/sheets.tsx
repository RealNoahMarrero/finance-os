import { useMemo, useRef, useState, useEffect } from 'react';
import { ArrowRight, ArrowUpDown, Bell, Check, CircleCheck, Download, Eye, FlaskConical, Info, Landmark, LogOut, ListChecks, Pencil, Plus, Scale, Split, StickyNote, Trash, TriangleAlert, Wallet } from 'lucide-react';
import { useStore } from './store';
import {
  allEnvelopes, envelope, readyToAssign, staleness, billOccurrences, drift, rollForward, type Account, type Bill, type BillPeriod, type Category, type Txn, type Income, type Repeat as Rep,
} from './data';
import { addDays, centsToInput, cn, diffDays, fmtDate, money, monthKey, relDay, sum, toCents, plural, todayISO } from './lib';
import { CatIcon, Callout, Money, Seg, Sheet, StatusPill, ThemeSwitch } from './ui';
import { exportEverything } from './db';
import { CreditScoreSheet, CreditCardSheet, CreditReportedSheet } from './creditSheets';
import { Gauge } from 'lucide-react';

const go = (path: string) => { location.hash = path; };

export function MoneyInput({ value, onChange, autoFocus, big, placeholder = '0.00', id, invalid }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; big?: boolean; placeholder?: string; id?: string; invalid?: boolean }) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 13, top: big ? 11 : 10, color: 'var(--ink-4)', fontWeight: 560 }}>$</span>
      <input id={id} className="input num" inputMode="decimal" autoFocus={autoFocus} placeholder={placeholder} value={value} aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
        style={{ paddingLeft: 26, textAlign: 'right', fontWeight: 600, ...(invalid ? { borderColor: 'var(--neg)' } : {}) }} />
    </div>
  );
}

const groupCats = (cats: Category[], groups: { id: string; name: string }[]) => groups.map((g) => ({ g, items: cats.filter((c) => c.groupId === g.id && !c.hidden) })).filter((x) => x.items.length);

// ═══════════════════════════════════════════════════════════
// Transaction: add / view / edit
// ═══════════════════════════════════════════════════════════
export function TxnSheet({ mode: initialMode, id, prefill }: { mode: 'add' | 'view' | 'edit'; id?: string; prefill?: Partial<Txn> }) {
  const { data, closeModal, addTxn, updateTxn, deleteTxn, toast, openModal } = useStore();
  const existing = id ? data.txns.find((t) => t.id === id) : undefined;
  const [mode, setMode] = useState(initialMode);
  const [confirmDel, setConfirmDel] = useState(false);
  const [saving, setSaving] = useState(false);

  const seed: Partial<Txn> = existing ?? prefill ?? {};
  const defaultAcct = data.accounts.find((a) => a.type === 'checking')?.id ?? data.accounts[0]?.id ?? '';
  const [type, setType] = useState<Txn['type']>(seed.type ?? 'expense');
  const [amount, setAmount] = useState(seed.amount ? centsToInput(seed.amount) : '');
  const [payee, setPayee] = useState(seed.payee ?? '');
  const [categoryId, setCategoryId] = useState(seed.categoryId ?? '');
  const [accountId, setAccountId] = useState(seed.accountId ?? defaultAcct);
  const [toAccountId, setToAccountId] = useState(seed.toAccountId ?? '');
  const [date, setDate] = useState(seed.date ?? data.today);
  const [notes, setNotes] = useState(seed.notes ?? '');
  const [splitOn, setSplitOn] = useState(!!seed.splits?.length);
  const [lines, setLines] = useState<{ categoryId: string; amount: string }[]>(seed.splits?.map((s) => ({ categoryId: s.categoryId, amount: centsToInput(s.amount) })) ?? [{ categoryId: '', amount: '' }, { categoryId: '', amount: '' }]);
  const [more, setMore] = useState(!!seed.notes || !!seed.splits?.length);
  const [hint, setHint] = useState('');
  const [focusPayee, setFocusPayee] = useState(false);
  const [showAllCats, setShowAllCats] = useState(false);
  const amtRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (mode !== 'view') amtRef.current?.focus(); }, [mode]);

  const cents = toCents(amount);
  const catById = (cid?: string) => data.categories.find((c) => c.id === cid);
  const acct = (aid?: string) => data.accounts.find((a) => a.id === aid);

  // payee memory
  const payeeStats = useMemo(() => {
    const m = new Map<string, { n: number; last: Txn }>();
    for (const t of data.txns) {
      if (t.type !== 'expense' || t.adjustment || !t.payee) continue;
      const cur = m.get(t.payee);
      if (!cur) m.set(t.payee, { n: 1, last: t });
      else { cur.n++; if (t.date > cur.last.date) cur.last = t; }
    }
    return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.n - a.n);
  }, [data.txns]);
  const suggestions = payeeStats.filter((p) => p.name.toLowerCase().includes(payee.toLowerCase()) && p.name !== payee).slice(0, 4);
  const pickPayee = (p: typeof payeeStats[number]) => {
    setPayee(p.name); setFocusPayee(false);
    const lc = p.last.splits?.length ? [...p.last.splits].sort((a, b) => b.amount - a.amount)[0].categoryId : p.last.categoryId;
    if (lc) setCategoryId(lc);
    setAccountId(p.last.accountId);
    setHint(`Filled in from your last ${p.name} purchase${p.last.splits?.length ? ' (it was split — you can split again below)' : ''}`);
  };

  // frequent categories
  const freq = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of data.txns) if (t.type === 'expense' && t.categoryId && !t.adjustment) m.set(t.categoryId, (m.get(t.categoryId) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).filter((k) => !catById(k)?.cardAccountId).slice(0, 6);
  }, [data.txns]); // eslint-disable-line react-hooks/exhaustive-deps
  const chipCats = categoryId && !freq.includes(categoryId) ? [categoryId, ...freq.slice(0, 5)] : freq;

  const linesTotal = sum(lines, (l) => toCents(l.amount));
  const splitRemaining = cents - linesTotal;
  const splitOk = !splitOn || (lines.filter((l) => l.categoryId && toCents(l.amount) > 0).length >= 2 && splitRemaining === 0);
  const valid = cents > 0 && accountId && (type === 'transfer' ? toAccountId && toAccountId !== accountId : type === 'income' ? !!payee.trim() : !!payee.trim() && (splitOn ? splitOk : !!categoryId));

  const sourceAcct = acct(accountId);
  const afterBal = sourceAcct && cents > 0
    ? sourceAcct.type === 'credit' ? sourceAcct.balance + (type === 'income' ? -cents : cents) : sourceAcct.balance + (type === 'income' ? cents : -cents)
    : null;

  const buildTxn = (): Omit<Txn, 'id'> => {
    const toAcct = acct(toAccountId);
    const autoCat = type === 'transfer' && toAcct?.type === 'credit' ? data.categories.find((c) => c.cardAccountId === toAcct.id)?.id : undefined;
    return {
      date, amount: cents, type, accountId, payee: type === 'transfer' ? `Transfer to ${toAcct?.name}` : payee.trim(),
      toAccountId: type === 'transfer' ? toAccountId : undefined,
      categoryId: type === 'expense' && !splitOn ? categoryId : autoCat,
      splits: type === 'expense' && splitOn ? lines.filter((l) => l.categoryId && toCents(l.amount) > 0).map((l) => ({ categoryId: l.categoryId, amount: toCents(l.amount) })) : undefined,
      notes: notes.trim() || undefined,
      adjustment: existing?.adjustment,
    };
  };
  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const t = buildTxn();
    if (existing) {
      if (await updateTxn(existing.id, t)) { toast('Transaction updated'); closeModal(); }
    } else {
      const newId = await addTxn(t);
      if (newId) { toast(`${t.type === 'income' ? 'Income' : t.type === 'transfer' ? 'Transfer' : 'Expense'} added · ${money(t.amount)}`, () => { void deleteTxn(newId); }); closeModal(); }
    }
    setSaving(false);
  };

  // ── view mode ──
  if (mode === 'view' && existing) {
    const t = existing;
    const c = catById(t.categoryId);
    const a = acct(t.accountId); const to = acct(t.toAccountId);
    const sign = t.type === 'income' ? 1 : t.type === 'expense' ? -1 : 0;
    return (
      <Sheet title="Transaction" onClose={closeModal}
        footer={confirmDel ? (
          <><button className="btn" onClick={() => setConfirmDel(false)}>Keep it</button>
            <button className="btn primary" disabled={saving} style={{ background: 'var(--neg)', borderColor: 'var(--neg)', color: '#fff' }} onClick={async () => {
              setSaving(true); if (await deleteTxn(t.id)) closeModal(); else setSaving(false);
            }}>Delete</button></>
        ) : t.adjustment || t.billId || t.incomeId ? (
          <button className="btn" onClick={closeModal}>Close</button>
        ) : (
          <><button className="btn danger" onClick={() => setConfirmDel(true)}><Trash />Delete</button>
            <button className="btn primary" onClick={() => setMode('edit')}>Edit</button></>
        )}>
        <div style={{ textAlign: 'center', padding: '8px 0 20px' }}>
          <div className="muted small" style={{ marginBottom: 4 }}>{t.payee}</div>
          <div className="amt-hero"><Money v={sign * t.amount} sign tone={sign === 0 ? undefined : 'auto'} /></div>
          <div style={{ marginTop: 10, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
            <StatusPill status="muted">{fmtDate(t.date, 'long')}</StatusPill>
            {t.adjustment && <StatusPill status="planned"><Scale />Reconciliation adjustment</StatusPill>}
            {t.splits?.length ? <StatusPill status="planned"><Split />Split · {t.splits.length} categories</StatusPill> : null}
          </div>
        </div>
        <div>
          <div className="kv"><span className="k">Account</span><span className="v">{a?.name}{to ? ` → ${to.name}` : ''}</span></div>
          {!t.splits?.length && t.type !== 'transfer' && !t.adjustment && <div className="kv"><span className="k">Category</span><span className="v">{c ? c.name : t.type === 'income' ? 'Ready to Assign' : 'Uncategorized'}</span></div>}
          {t.splits?.map((s) => <div className="kv" key={s.categoryId}><span className="k">{catById(s.categoryId)?.name}</span><span className="v num">{money(s.amount)}</span></div>)}
          {t.type === 'transfer' && c && <div className="kv"><span className="k">Counts toward</span><span className="v">{c.name}</span></div>}
          {t.billId && <div className="kv"><span className="k">Bill</span><span className="v">{data.bills.find((b) => b.id === t.billId)?.name}</span></div>}
          <div className="kv"><span className="k">Notes</span><span className="v" style={{ maxWidth: 260 }}>{t.notes || <span className="muted">—</span>}</span></div>
        </div>
        {(t.adjustment || t.billId || t.incomeId) && <div style={{ marginTop: 14 }}><Callout>{t.adjustment ? 'Reconciliation adjustments are a permanent record and can’t be edited or deleted.' : t.billId ? 'This transaction confirms a bill payment. Undo the payment from the bill first if it needs changing.' : 'This transaction confirms received income, so it is locked.'}</Callout></div>}
        {t.type === 'income' && !t.adjustment && !t.incomeId && <div style={{ marginTop: 14 }}><Callout>Income lands in <b>Ready to Assign</b>, then you give it a job in Budget.</Callout></div>}
      </Sheet>
    );
  }

  // ── add / edit form ──
  const title = existing ? 'Edit transaction' : 'New transaction';
  const verb = type === 'expense' ? 'expense' : type === 'income' ? 'income' : 'transfer';
  return (
    <Sheet title={title} onClose={existing ? () => setMode('view') : closeModal} wide
      footer={<button className="btn primary lg" disabled={!valid || saving} onClick={save}>{saving ? 'Saving…' : existing ? 'Save changes' : `Add ${verb}`}{cents > 0 ? ` · ${money(cents)}` : ''}</button>}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Seg block value={type} onChange={(v) => { setType(v); setHint(''); }} options={[{ v: 'expense', label: 'Expense' }, { v: 'income', label: 'Income' }, { v: 'transfer', label: 'Transfer' }]} />
        <div className="amount-input">
          <span>$</span>
          <input ref={amtRef} inputMode="decimal" placeholder="0.00" aria-label="Amount" value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))} />
        </div>

        {type !== 'transfer' && (
          <div className="field" style={{ position: 'relative', marginTop: 4 }}>
            <label htmlFor="payee">{type === 'income' ? 'From' : 'Payee'}</label>
            <input id="payee" className="input" autoComplete="off" placeholder={type === 'income' ? 'Who paid you?' : 'Where did you spend it?'} value={payee}
              onFocus={() => setFocusPayee(true)} onBlur={() => setTimeout(() => setFocusPayee(false), 140)}
              onChange={(e) => { setPayee(e.target.value); setHint(''); }} />
            {focusPayee && type === 'expense' && (suggestions.length > 0) && (
              <div className="suggest" role="listbox">
                {suggestions.map((p) => (
                  <button type="button" key={p.name} role="option" onMouseDown={(e) => e.preventDefault()} onClick={() => pickPayee(p)}>
                    <span style={{ fontWeight: 580 }}>{p.name}</span>
                    <span className="muted small">{p.last.splits?.length ? 'Split' : catById(p.last.categoryId)?.name}</span>
                  </button>
                ))}
              </div>
            )}
            {hint && <div className="xs c-planned" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Check size={12} />{hint}</div>}
          </div>
        )}

        {type === 'expense' && !splitOn && (
          <div className="field" style={{ marginTop: 16 }}>
            <label>Category</label>
            <div className="chips">
              {chipCats.map((k) => { const c = catById(k)!; return <button type="button" key={k} className="chip" aria-pressed={categoryId === k} onClick={() => setCategoryId(k)}><CatIcon k={c.icon} />{c.name}</button>; })}
              <button type="button" className="chip" onClick={() => setShowAllCats((v) => !v)}>{showAllCats ? 'Hide' : 'All categories'}</button>
            </div>
            {showAllCats && (
              <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="All categories">
                <option value="">Choose a category…</option>
                {groupCats(data.categories, data.groups).map(({ g, items }) => <optgroup key={g.id} label={g.name}>{items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
              </select>
            )}
          </div>
        )}
        {type === 'income' && <div style={{ marginTop: 14 }}><Callout>Income goes to <b>Ready to Assign</b> so you can give every dollar a job.</Callout></div>}

        <div className="field" style={{ marginTop: 16 }}>
          <label>{type === 'transfer' ? 'From' : type === 'income' ? 'Deposit to' : 'Account'}</label>
          <div className="chips">
            {data.accounts.map((a) => <button type="button" key={a.id} className="chip" aria-pressed={accountId === a.id} onClick={() => setAccountId(a.id)}>{a.name}</button>)}
          </div>
          {sourceAcct && afterBal != null && type !== 'transfer' && (
            <div className="xs muted num" style={{ marginTop: 2 }}>Recorded balance {money(sourceAcct.balance)} → <b style={{ color: 'var(--ink-2)' }}>{money(afterBal)}</b> after this</div>
          )}
        </div>

        {type === 'transfer' && (
          <div className="field" style={{ marginTop: 16 }}>
            <label>To</label>
            <div className="chips">
              {data.accounts.filter((a) => a.id !== accountId).map((a) => <button type="button" key={a.id} className="chip" aria-pressed={toAccountId === a.id} onClick={() => setToAccountId(a.id)}>{a.name}</button>)}
            </div>
            {acct(toAccountId)?.type === 'credit' && <div className="xs muted">Counts toward the card’s payment envelope in your budget.</div>}
          </div>
        )}

        <button type="button" className="btn ghost sm" style={{ marginTop: 14, marginLeft: -8 }} onClick={() => setMore((v) => !v)} aria-expanded={more}>
          <Plus style={{ transform: more ? 'rotate(45deg)' : 'none', transition: 'transform .2s' }} />{more ? 'Fewer details' : 'Date, notes, split'}
        </button>
        {more && (
          <div className="stack gap12 fade-in" style={{ marginTop: 6 }}>
            <div className="field"><label htmlFor="date">Date</label>
              <div className="row gap8"><input id="date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
                {date !== data.today && <button type="button" className="btn sm" onClick={() => setDate(data.today)}>Today</button>}</div></div>
            <div className="field"><label htmlFor="notes"><StickyNote size={12} style={{ verticalAlign: -1, marginRight: 4 }} />Notes</label>
              <textarea id="notes" className="textarea" placeholder="Optional" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            {type === 'expense' && (
              <div className="stack gap8">
                <button type="button" className="chip" style={{ alignSelf: 'flex-start' }} aria-pressed={splitOn} onClick={() => setSplitOn((v) => !v)}><Split />Split across categories</button>
                {splitOn && (
                  <div className="stack gap8 fade-in">
                    {lines.map((l, i) => (
                      <div className="row gap8" key={i}>
                        <select className="select" style={{ flex: 1.4 }} aria-label={`Split ${i + 1} category`} value={l.categoryId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)))}>
                          <option value="">Category…</option>
                          {groupCats(data.categories, data.groups).map(({ g, items }) => <optgroup key={g.id} label={g.name}>{items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
                        </select>
                        <div style={{ flex: 1 }}><MoneyInput value={l.amount} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: v } : x)))} /></div>
                      </div>
                    ))}
                    <div className="row between">
                      <button type="button" className="btn ghost sm" onClick={() => setLines([...lines, { categoryId: '', amount: '' }])}><Plus />Add line</button>
                      <span className={cn('small num', splitRemaining === 0 ? 'pos' : 'warn')} style={{ fontWeight: 600 }}>{splitRemaining === 0 ? 'Fully allocated' : splitRemaining > 0 ? `${money(splitRemaining)} left to split` : `${money(-splitRemaining)} over`}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════
// Assign money (funding priorities)
// ═══════════════════════════════════════════════════════════
const PRI = { 1: 'Essential', 2: 'Important', 3: 'Flexible' } as const;
export function AssignSheet() {
  const { data, closeModal, assign, toast } = useStore();
  const rta = readyToAssign(data);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const envs = allEnvelopes(data).filter((e) => !e.cat.hidden);
  const needs = envs.filter((e) => e.env.remaining > 0).sort((a, b) => a.cat.priority - b.cat.priority || (a.env.remaining - b.env.remaining));
  const others = envs.filter((e) => e.env.remaining <= 0 && !e.cat.cardAccountId);
  const [showOthers, setShowOthers] = useState(false);
  const planned = sum(Object.values(vals), toCents);
  const left = rta - planned;
  const over = left < 0;

  const fundByPriority = () => {
    let pool = Math.max(0, rta);
    const next: Record<string, string> = {};
    for (const e of needs) {
      const a = Math.min(pool, e.env.remaining);
      if (a > 0) { next[e.cat.id] = centsToInput(a); pool -= a; }
    }
    setVals(next);
  };
  const fill = (id: string, remaining: number) => {
    const others = planned - toCents(vals[id] || '0');
    const room = Math.max(0, rta - others);
    setVals({ ...vals, [id]: centsToInput(Math.min(remaining, room)) });
  };
  const totalNeeds = sum(needs, (e) => e.env.remaining);

  const row = (e: typeof envs[number]) => {
    const v = vals[e.cat.id] ?? '';
    return (
      <div key={e.cat.id} className="row gap12" style={{ padding: '11px 0', borderBottom: '1px solid var(--line)' }}>
        <div className="li-ico planned" style={{ width: 34, height: 34 }}><CatIcon k={e.cat.icon} /></div>
        <div className="grow">
          <div className="li-title" style={{ fontSize: 13.5 }}>{e.cat.name}</div>
          <div className="xs muted">{e.env.remaining > 0 ? <><span className="c-planned" style={{ fontWeight: 600 }}>{PRI[e.cat.priority]}</span> · needs <span className="num">{money(e.env.remaining)}</span></> : <>Available <span className="num">{money(e.env.avail)}</span></>}</div>
        </div>
        {e.env.remaining > 0 && toCents(v) < e.env.remaining && <button className="btn sm" onClick={() => fill(e.cat.id, e.env.remaining)}>Fill</button>}
        <div style={{ width: 112 }}><MoneyInput value={v} onChange={(x) => setVals({ ...vals, [e.cat.id]: x })} /></div>
      </div>
    );
  };

  return (
    <Sheet title="Assign money" sub="Give your Ready to Assign dollars a job." onClose={closeModal} wide
      footer={<button className="btn primary lg" disabled={planned <= 0 || over || saving} onClick={async () => {
        const amounts: Record<string, number> = {}; for (const [k, v] of Object.entries(vals)) if (toCents(v) > 0) amounts[k] = toCents(v);
        setSaving(true);
        if (await assign(amounts)) {
          const undo = Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, -v]));
          toast(`Assigned ${money(planned)} across ${plural(Object.keys(amounts).length, 'category', 'categories')}`, () => { void assign(undo); }); closeModal();
        } else setSaving(false);
      }}>{planned > 0 ? `Assign ${money(planned)}` : 'Assign money'}</button>}>
      <div className="card pad" style={{ background: over ? 'var(--neg-soft)' : 'var(--planned-soft)', borderColor: 'transparent', marginBottom: 14 }}>
        <div className="row between">
          <div>
            <div className="eyebrow" style={{ color: over ? 'var(--neg)' : 'var(--planned)' }}>{over ? 'Over by' : 'Left to assign'}</div>
            <div className="amt-xl num"><Money v={Math.abs(left)} /></div>
          </div>
          <div className="right small muted">Ready to Assign now<div className="num" style={{ fontWeight: 650, color: 'var(--ink)' }}>{money(rta)}</div></div>
        </div>
      </div>
      {totalNeeds > 0 && (
        <div className="row between" style={{ margin: '4px 0 6px' }}>
          <div className="small muted">Underfunded targets: <b className="num" style={{ color: 'var(--ink)' }}>{money(totalNeeds)}</b>{totalNeeds > rta && <> · you can cover {money(Math.max(0, rta))}</>}</div>
          <button className="btn sm" onClick={fundByPriority}><ListChecks />Fund by priority</button>
        </div>
      )}
      {needs.length > 0 ? <div>{needs.map(row)}</div> : <Callout icon={<CircleCheck />}>Every monthly target is funded. Nice.</Callout>}
      <button className="btn ghost sm" style={{ margin: '10px 0 0 -8px' }} onClick={() => setShowOthers((v) => !v)}>{showOthers ? 'Hide' : 'Show'} other categories</button>
      {showOthers && <div className="fade-in">{others.map(row)}</div>}
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════
// Move money
// ═══════════════════════════════════════════════════════════
export function MoveSheet({ from: f0, to: t0, amount: a0 }: { from?: string; to?: string; amount?: number }) {
  const { data, closeModal, assign, moveMoney, toast } = useStore();
  const [from, setFrom] = useState(f0 ?? 'rta');
  const [to, setTo] = useState(t0 ?? '');
  const [amt, setAmt] = useState(a0 ? centsToInput(a0) : '');
  const [saving, setSaving] = useState(false);
  const rta = readyToAssign(data);
  const envs = allEnvelopes(data);
  const availOf = (id: string) => (id === 'rta' ? rta : envs.find((e) => e.cat.id === id)?.env.avail ?? 0);
  const nameOf = (id: string) => (id === 'rta' ? 'Ready to Assign' : data.categories.find((c) => c.id === id)?.name ?? '');
  const cents = toCents(amt);
  const max = Math.max(0, availOf(from));
  const valid = cents > 0 && to && from !== to && cents <= max;
  const swap = () => { if (to) { setFrom(to); setTo(from); } };
  const sel = (value: string, set: (v: string) => void, label: string, exclude?: string) => (
    <select className="select" value={value} onChange={(e) => set(e.target.value)} aria-label={label}>
      {label.startsWith('From') ? null : <option value="">Choose…</option>}
      <option value="rta" disabled={exclude === 'rta'}>Ready to Assign · {money(rta)}</option>
      {groupCats(data.categories, data.groups).map(({ g, items }) => (
        <optgroup key={g.id} label={g.name}>{items.filter((c) => c.id !== exclude).map((c) => <option key={c.id} value={c.id}>{c.name} · {money(availOf(c.id))}</option>)}</optgroup>
      ))}
    </select>
  );
  return (
    <Sheet title="Move money" sub="Shift funds between categories. Nothing leaves your accounts." onClose={closeModal}
      footer={<button className="btn primary lg" disabled={!valid || saving} onClick={async () => {
        setSaving(true);
        const good = from === 'rta' ? await assign({ [to]: cents }) : to === 'rta' ? await assign({ [from]: -cents }) : await moveMoney(from, to, cents);
        if (good) {
          toast(`Moved ${money(cents)} to ${nameOf(to)}`, () => { if (from === 'rta') void assign({ [to]: -cents }); else if (to === 'rta') void assign({ [from]: cents }); else void moveMoney(to, from, cents); });
          closeModal();
        } else setSaving(false);
      }}>{cents > 0 ? `Move ${money(cents)}` : 'Move money'}</button>}>
      <div className="stack gap12">
        <div className="field"><label>From</label>{sel(from, setFrom, 'From', to)}</div>
        <div style={{ display: 'flex', justifyContent: 'center' }}><button className="icon-btn" onClick={swap} aria-label="Swap direction" style={{ border: '1px solid var(--line-2)' }}><ArrowUpDown /></button></div>
        <div className="field"><label>To</label>{sel(to, setTo, 'To', from)}</div>
        <div className="field"><label>Amount</label>
          <MoneyInput value={amt} onChange={setAmt} autoFocus invalid={cents > max} />
          <div className="row between xs muted"><span>{cents > max ? <span className="neg">Only {money(max)} available in {nameOf(from)}</span> : `Up to ${money(max)} available`}</span>
            {max > 0 && <button className="sect-link" type="button" onClick={() => setAmt(centsToInput(max))}>Use max</button>}</div>
        </div>
        {to && cents > 0 && valid && (
          <div className="card pad fade-in" style={{ background: 'var(--surface-2)', boxShadow: 'none' }}>
            {[from, to].map((id, i) => (
              <div className="row between small" key={id} style={{ padding: '3px 0' }}>
                <span>{nameOf(id)}</span><span className="num"><span className="muted">{money(availOf(id))}</span> → <b>{money(availOf(id) + (i === 0 ? -cents : cents))}</b></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════
// Category detail
// ═══════════════════════════════════════════════════════════
export function CategorySheet({ id }: { id: string }) {
  const { data, closeModal, openModal, setTarget, updateBill, removeBill, toast } = useStore();
  const cat = data.categories.find((c) => c.id === id)!;
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busyBill, setBusyBill] = useState(false);
  const env = envelope(data, id);
  const [editing, setEditing] = useState(false);
  const [tgt, setTgt] = useState(cat.target ? centsToInput(cat.target) : '');
  const recent = data.txns.filter((t) => t.categoryId === id || t.splits?.some((s) => s.categoryId === id)).slice(0, 4);
  const bill = data.bills.find((b) => b.categoryId === id);
  const over = env.avail < 0;
  // Payments confirmed through the linked bill that produced a transaction (the only payments that reduce the balance automatically)
  const confirmed = bill ? Object.values(bill.paid).map((tid) => data.txns.find((t) => t.id === tid)).filter((t): t is Txn => !!t) : [];
  const confirmedSum = sum(confirmed, (t) => t.amount);
  return (
    <Sheet title={<span className="row gap12"><span className="li-ico planned" style={{ width: 34, height: 34 }}><CatIcon k={cat.icon} /></span>{cat.name}</span>} onClose={closeModal}
      footer={<>
        <button className="btn" onClick={() => openModal({ type: 'move', from: over ? undefined : id, to: over ? id : undefined, amount: over ? -env.avail : undefined })}>Move money</button>
        <button className="btn primary" onClick={() => openModal({ type: 'move', from: 'rta', to: id, amount: env.remaining || undefined })}>Assign money</button>
      </>}>
      {cat.isDebt && (
        <div className="card pad" style={{ boxShadow: 'none', borderColor: 'color-mix(in srgb, var(--neg) 30%, var(--line))', marginBottom: 14 }} data-testid="debt-section">
          <div className="row between" style={{ gap: 8 }}>
            <div><div className="eyebrow">Outstanding debt</div><div className={cn('amt-xl num', (cat.debtBalance ?? 0) > 0 && 'neg')} data-testid="debt-balance"><Money v={cat.debtBalance ?? 0} /></div></div>
            <div style={{ textAlign: 'right' }}>{(cat.debtBalance ?? 0) === 0 ? <StatusPill status="ok">Paid off</StatusPill> : <StatusPill status="late">Owed</StatusPill>}
              <div><button className="btn sm" style={{ marginTop: 8 }} onClick={() => openModal({ type: 'debt-edit', categoryId: id })}><Pencil />Edit debt</button></div></div>
          </div>
          <div style={{ marginTop: 8 }}>
            <div className="kv"><span className="k">Payment target</span><span className="v num">{cat.target != null ? money(cat.target) : 'None set'}</span></div>
            <div className="kv"><span className="k">Next due date</span><span className="v">{bill?.date && !bill.paused ? fmtDate(bill.date) : bill?.paused ? 'Bill paused' : 'None — no bill linked'}</span></div>
            {confirmed.length > 0 && <div className="kv"><span className="k">Payments confirmed via bill</span><span className="v num">{money(confirmedSum)} · {plural(confirmed.length, 'payment')}</span></div>}
          </div>
          <div className="xs muted" style={{ marginTop: 8 }}>This is what you owe, separate from the money set aside below. $0 available doesn’t mean $0 owed.{bill?.paused ? ' Pausing the bill doesn’t pause or change the debt.' : ''}</div>
        </div>
      )}
      {over && <div style={{ marginBottom: 14 }}><Callout tone="neg">This envelope is overspent by <b>{money(-env.avail)}</b>. Cover it by moving money in from another category.</Callout></div>}
      <div className="card pad" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <div><div className="eyebrow">{cat.isDebt ? 'Set aside toward payments' : 'Available to spend'}</div><div className={cn('amt-xl num', over && 'neg')}><Money v={env.avail} /></div></div>
          {cat.billPaused ? <StatusPill status="muted">Bill paused</StatusPill> : cat.target != null && <StatusPill status={env.remaining === 0 ? 'ok' : 'planned'}>{env.remaining === 0 ? 'Target funded' : `${Math.round(env.fundedPct * 100)}% funded`}</StatusPill>}
        </div>
        {cat.target != null && <div className="bar planned"><i style={{ width: `${env.fundedPct * 100}%` }} /></div>}
        <div style={{ marginTop: 8 }}>
          <div className="kv"><span className="k">Monthly target</span><span className="v num">{cat.target != null ? money(cat.target) : 'None'}</span></div>
          <div className="kv"><span className="k">Set aside so far</span><span className="v num c-planned">{money(env.assigned)}</span></div>
          <div className="kv"><span className="k">Still to fund</span><span className="v num">{money(env.remaining)}</span></div>
          <div className="kv"><span className="k">Spent this month</span><span className="v num">{money(env.spent)}</span></div>
        </div>
      </div>
      <div className="row between" style={{ margin: '16px 0 4px' }}>
        <div className="small muted">Group: <b style={{ color: 'var(--ink)' }}>{data.groups.find((g) => g.id === cat.groupId)?.name}</b></div>
        {!editing ? <span className="row gap8" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}><button className="btn ghost sm" onClick={() => openModal({ type: 'category-edit', id })}><Pencil />Edit category</button>{!cat.isDebt && <button className="btn ghost sm" onClick={() => openModal({ type: 'debt-edit', categoryId: id })}>Track as debt</button>}<button className="btn ghost sm" onClick={() => setEditing(true)}>Edit target</button></span> : null}
      </div>
      {editing && (
        <div className="row gap8 fade-in" style={{ marginBottom: 10 }}>
          <div style={{ flex: 1 }}><MoneyInput value={tgt} onChange={setTgt} autoFocus placeholder="No target" /></div>
          <button className="btn primary" onClick={async () => { if (await setTarget(id, tgt ? toCents(tgt) : null)) setEditing(false); }}>Save</button>
        </div>
      )}
      <div className="card pad" style={{ boxShadow: 'none', marginTop: 12 }} data-testid="bill-section">
        <div className="row between" style={{ gap: 8 }}>
          <div className="eyebrow">Scheduled bill</div>
          {bill ? <StatusPill status={bill.paused ? 'muted' : 'planned'}>{bill.paused ? 'Paused' : 'Scheduled'}</StatusPill> : <StatusPill status="muted">Funding only</StatusPill>}
        </div>
        {bill ? <>
          <div className="small" style={{ marginTop: 6 }}><b className="num">{money(bill.amount)}</b> {bill.recurring ? bill.period === 'Bi-Weekly' ? 'every 2 weeks' : bill.period.toLowerCase() : 'one time'} · {bill.paused ? 'paused — not in upcoming bills or forecasts' : bill.date ? `next due ${fmtDate(bill.date)}` : 'no due date'} · {bill.mode === 'prepare' ? 'prepares a transaction' : 'reminder only'}</div>
          <div className="row gap8" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={() => openModal({ type: 'bill-edit', billId: bill.id })}><Pencil />Edit bill</button>
            <button className="btn sm" disabled={busyBill} onClick={async () => {
              setBusyBill(true);
              const resume = bill.paused;
              const date = resume && bill.date && bill.recurring ? rollForward({ recurring: true, period: bill.period, anchor: bill.anchor, date: bill.date, paid: bill.paid }, bill.date, data.today) : bill.date!;
              const ok = await updateBill(bill.id, { name: bill.name, amount: bill.amount, date, recurring: bill.recurring, period: bill.period, mode: bill.mode, groupId: cat.groupId, paused: !resume });
              setBusyBill(false); if (ok) toast(resume ? `${bill.name} resumed` : `${bill.name} paused · history and debt kept`);
            }}>{bill.paused ? 'Resume bill' : 'Pause bill'}</button>
            {!confirmRemove && <button className="btn sm danger" onClick={() => setConfirmRemove(true)}><Trash />Remove bill</button>}
          </div>
          {confirmRemove && <div className="fade-in" style={{ marginTop: 10 }}><Callout tone="warn">Remove the schedule from <b>{cat.name}</b>? The envelope, its money, transactions, past payments{cat.isDebt ? ' and the debt balance' : ''} all stay. Only the due date and reminders go away.
            <div className="row gap8" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => setConfirmRemove(false)}>Keep bill</button><button className="btn sm danger" disabled={busyBill} onClick={async () => { setBusyBill(true); const ok = await removeBill(id); setBusyBill(false); if (ok) { setConfirmRemove(false); toast(`${cat.name} is now funding-only · nothing deleted`); } }}>Yes, remove bill</button></div></Callout></div>}
        </> : <>
          <div className="small muted" style={{ marginTop: 6 }}>No payment schedule — this category only holds budget money. It won’t appear in upcoming bills or the forecast.</div>
          <button className="btn sm" style={{ marginTop: 10 }} onClick={() => openModal({ type: 'bill-schedule', categoryId: id })}><Plus />Add scheduled bill</button>
        </>}
      </div>
      {recent.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Recent activity</div>
          {recent.map((t) => (
            <button key={t.id} className="row between" style={{ width: '100%', padding: '9px 0', borderBottom: '1px solid var(--line)', textAlign: 'left' }} onClick={() => openModal({ type: 'txn', mode: 'view', id: t.id })}>
              <span><span style={{ fontWeight: 560 }}>{t.payee}</span> <span className="muted small">· {fmtDate(t.date)}</span></span>
              <span className="num small" style={{ fontWeight: 600 }}>{money(t.splits?.find((s) => s.categoryId === id)?.amount ?? t.amount)}</span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════
// Bill
// ═══════════════════════════════════════════════════════════
export function BillSheet({ billId, date }: { billId: string; date: string }) {
  const { data, closeModal, openModal, payBill, setBillMode, toast } = useStore();
  const bill = data.bills.find((b) => b.id === billId)!;
  const occ = billOccurrences(data, date, date).find((o) => o.bill.id === billId)!;
  const [step, setStep] = useState<'view' | 'review'>('view');
  const [amt, setAmt] = useState(centsToInput(bill.amount));
  const [acctId, setAcctId] = useState(bill.accountId);
  const [saving, setSaving] = useState(false);
  const cat = data.categories.find((c) => c.id === bill.categoryId);
  const env = cat ? envelope(data, cat.id) : null;
  const n = diffDays(date, data.today);
  const paidTxnId = bill.paid[occ.key];
  const paidTxn = paidTxnId && paidTxnId !== 'manual' ? data.txns.find((t) => t.id === paidTxnId) : undefined;
  const statusPill = occ.paid ? <StatusPill status="ok">Paid</StatusPill> : n < 0 ? <StatusPill status="late">{-n} days overdue</StatusPill> : n <= 3 ? <StatusPill status="warn">Due {relDay(date).toLowerCase()}</StatusPill> : <StatusPill status="muted">{relDay(date)}</StatusPill>;

  if (step === 'review') {
    const a = data.accounts.find((x) => x.id === acctId)!;
    const cents = toCents(amt);
    return (
      <Sheet title="Review before posting" sub="Nothing is recorded until you confirm." onClose={closeModal}
        footer={<><button className="btn" onClick={() => setStep('view')}>Back</button>
          <button className="btn primary" disabled={cents <= 0 || saving || !a} onClick={async () => { setSaving(true); if (await payBill(billId, date, { post: true, amount: cents, accountId: acctId })) { toast(`${bill.name} paid · ${money(cents)} posted`); closeModal(); } else setSaving(false); }}>{saving ? 'Posting…' : 'Post transaction'}</button></>}>
        <Callout tone="planned" icon={<Eye />}>Finances prepared this transaction from your bill. Edit anything, then post it.</Callout>
        <div className="card pad" style={{ margin: '14px 0', boxShadow: 'none', background: 'var(--surface-2)' }}>
          <div className="kv"><span className="k">Payee</span><span className="v">{bill.payee}</span></div>
          <div className="kv"><span className="k">Date</span><span className="v">{fmtDate(data.today, 'long')}</span></div>
          {bill.isDebt && <div className="kv"><span className="k">Balance owed</span><span className="v num">{money(data.debts.find((x) => x.billId === bill.id)?.balance ?? 0)} → {money(Math.max(0, (data.debts.find((x) => x.billId === bill.id)?.balance ?? 0) - cents))}</span></div>}
          <div className="kv"><span className="k">Category</span><span className="v">{cat?.name}</span></div>
          <div className="kv"><span className="k">Type</span><span className="v">{bill.toAccountId ? `Transfer to ${data.accounts.find((x) => x.id === bill.toAccountId)?.name}` : 'Expense'}</span></div>
        </div>
        <div className="field"><label>Amount paid</label><MoneyInput value={amt} onChange={setAmt} autoFocus /></div>
        <div className="field" style={{ marginTop: 14 }}><label>Pay from</label>
          <div className="chips">{data.accounts.filter((x) => x.type !== 'credit' || !bill.toAccountId).map((x) => <button key={x.id} className="chip" aria-pressed={acctId === x.id} onClick={() => setAcctId(x.id)}>{x.name}</button>)}</div>
          <div className="xs muted num">{a.name} balance {money(a.balance)} → <b style={{ color: 'var(--ink-2)' }}>{money(a.balance - (a.type === 'credit' ? -cents : cents))}</b></div></div>
      </Sheet>
    );
  }

  return (
    <Sheet title={bill.name} onClose={closeModal}
      footer={occ.paid ? (paidTxn ? <button className="btn primary" onClick={() => openModal({ type: 'txn', mode: 'view', id: paidTxn.id })}>View transaction</button> : <button className="btn" onClick={closeModal}>Done</button>)
        : <><button className="btn" onClick={closeModal}>Close</button>
          <button className="btn primary" disabled={saving} onClick={async () => { if (bill.mode === 'prepare') setStep('review'); else { setSaving(true); if (await payBill(billId, date, { post: false })) { toast(`${bill.name} marked paid · no transaction posted`); closeModal(); } else setSaving(false); } }}>
            {bill.mode === 'prepare' ? 'Mark paid & review' : 'Mark as paid'}</button></>}>
      <div style={{ textAlign: 'center', padding: '4px 0 18px' }}>
        <div className="amt-hero num"><Money v={bill.amount} /></div>
        <div style={{ marginTop: 10, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>{statusPill}<StatusPill status="muted">{fmtDate(date, 'long')}</StatusPill></div>
      </div>
      {!occ.paid && env && !occ.future && (
        <div className="card pad" style={{ boxShadow: 'none', background: 'var(--surface-2)', marginBottom: 14 }}>
          <div className="row between small" style={{ marginBottom: 8 }}><span className="muted">Funded from {cat?.name}</span><b className="num">{money(occ.funded)} of {money(bill.amount)}</b></div>
          <div className="bar planned"><i style={{ width: `${Math.min(100, (occ.funded / bill.amount) * 100)}%` }} /></div>
          {occ.short > 0 && <div className="row between small" style={{ marginTop: 10 }}><span className="warn" style={{ fontWeight: 600 }}>{money(occ.short)} still to fund</span><button className="btn sm" onClick={() => openModal({ type: 'move', from: 'rta', to: cat!.id, amount: occ.short })}>Fund it</button></div>}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'center', margin: '-6px 0 14px' }}><button className="btn sm" onClick={() => openModal({ type: 'bill-edit', billId })}><Pencil />Edit bill</button></div>
      {occ.paid && <Callout icon={<CircleCheck />}>{paidTxn ? <>Posted on {fmtDate(paidTxn.date)} from {data.accounts.find((a) => a.id === paidTxn.accountId)?.name}.</> : 'Marked paid without posting a transaction.'}</Callout>}
      {!occ.paid && (
        <div style={{ marginTop: 4 }}>
          <div className="label" style={{ marginBottom: 8 }}>When you mark this paid…</div>
          <Seg block value={bill.mode} onChange={(m) => { void setBillMode(billId, m); }} options={[{ v: 'reminder', label: 'Just a reminder' }, { v: 'prepare', label: 'Prepare a transaction' }]} />
          <div className="small muted" style={{ marginTop: 8 }}>{bill.mode === 'reminder' ? 'Finances only tracks the due date. You record the payment yourself.' : 'Finances prepares the transaction for you to review. It is never posted without your confirmation.'}</div>
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <div className="kv"><span className="k">Pays from</span><span className="v">{data.accounts.find((a) => a.id === bill.accountId)?.name}</span></div>
        <div className="kv"><span className="k">Repeats</span><span className="v">{bill.recurring ? bill.period : 'One time'}</span></div>
      </div>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════
// Expected income
// ═══════════════════════════════════════════════════════════
const REPEATS: { v: Rep; label: string }[] = [{ v: 'none', label: 'One time' }, { v: 'weekly', label: 'Weekly' }, { v: 'biweekly', label: 'Every 2 weeks' }, { v: 'semimonthly', label: 'Twice a month' }, { v: 'monthly', label: 'Monthly' }];
export function IncomeSheet({ mode, id }: { mode: 'view' | 'add'; id?: string }) {
  const { data, closeModal, receiveIncome, addIncome, updateIncome, deleteIncome, toast } = useStore();
  const [saving, setSaving] = useState(false);
  const [choose, setChoose] = useState<null | 'delete'>(null);
  const [editing, setEditing] = useState(false);
  const [scope, setScope] = useState<'future' | 'this'>('future');
  const inc = id ? data.incomes.find((i) => i.id === id) : undefined;
  const [step, setStep] = useState<'view' | 'confirm'>('view');
  const [label, setLabel] = useState(inc?.label ?? '');
  const [amt, setAmt] = useState(inc ? centsToInput(inc.amount) : '');
  const [date, setDate] = useState(inc?.date ?? todayISO());
  const [cert, setCert] = useState<Income['certainty']>(inc?.certainty ?? 'anticipated');
  const [rep, setRep] = useState<Rep>(inc?.repeat ?? 'none');
  const [acctId, setAcctId] = useState(inc?.accountId ?? data.accounts.find((a) => a.type === 'checking')?.id ?? '');
  const [recvDate, setRecvDate] = useState(data.today);
  const liquid = data.accounts.filter((a) => a.type !== 'credit');

  if (mode === 'add') {
    const valid = label.trim() && toCents(amt) > 0;
    return (
      <Sheet title="Expected income" sub="Plan for money that hasn’t arrived yet." onClose={closeModal}
        footer={<button className="btn primary lg" disabled={!valid || saving} onClick={async () => { setSaving(true); if (await addIncome({ label: label.trim(), amount: toCents(amt), date, certainty: cert, repeat: rep, accountId: acctId, who: 'Household' })) { toast('Expected income added · projected only'); closeModal(); } else setSaving(false); }}>Add expected income</button>}>
        <div className="stack gap12">
          <div className="field"><label htmlFor="il">Source</label><input id="il" className="input" placeholder="e.g. Client invoice" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus /></div>
          <div className="row gap12"><div className="field grow"><label>Amount</label><MoneyInput value={amt} onChange={setAmt} /></div>
            <div className="field grow"><label htmlFor="id">Expected on</label><input id="id" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div></div>
          <div className="field"><label>How sure are you?</label>
            <Seg block value={cert} onChange={setCert} options={[{ v: 'guaranteed', label: 'Guaranteed' }, { v: 'anticipated', label: 'Anticipated' }]} />
            <div className="xs muted">{cert === 'guaranteed' ? 'Counts in your conservative forecast (e.g. a paycheck).' : 'Only counts in the optimistic forecast (e.g. an unpaid invoice).'}</div></div>
          <div className="field"><label>Repeats</label><div className="chips">{REPEATS.map((r) => <button key={r.v} className="chip" aria-pressed={rep === r.v} onClick={() => setRep(r.v)}>{r.label}</button>)}</div></div>
          <div className="field"><label>Deposits to</label><div className="chips">{liquid.map((a) => <button key={a.id} className="chip" aria-pressed={acctId === a.id} onClick={() => setAcctId(a.id)}>{a.name}</button>)}</div></div>
        </div>
      </Sheet>
    );
  }
  if (!inc) return null;
  const acct = data.accounts.find((a) => a.id === inc.accountId)!;
  if (editing) {
    const valid = label.trim() && toCents(amt) > 0 && !!date;
    return (
      <Sheet title="Edit expected income" sub="Changes the plan only — nothing received or recorded is touched." onClose={closeModal}
        footer={<><button className="btn" onClick={() => setEditing(false)}>Cancel</button><button className="btn primary" disabled={!valid || saving} onClick={async () => { setSaving(true); if (await updateIncome(inc.id, { label: label.trim(), amount: toCents(amt), date, certainty: cert, repeat: rep, accountId: acctId }, scope)) { toast('Saved'); closeModal(); } else setSaving(false); }}>Save changes</button></>}>
        <div className="stack gap12">
          <div className="field"><label htmlFor="il">Source</label><input id="il" className="input" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus /></div>
          <div className="row gap12"><div className="field grow"><label>Amount</label><MoneyInput value={amt} onChange={setAmt} /></div>
            <div className="field grow"><label htmlFor="id">Expected on</label><input id="id" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div></div>
          <div className="field"><label>How sure are you?</label>
            <Seg block value={cert} onChange={setCert} options={[{ v: 'guaranteed', label: 'Guaranteed' }, { v: 'anticipated', label: 'Anticipated' }]} /></div>
          <div className="field"><label>Repeats</label><div className="chips">{REPEATS.map((r) => <button key={r.v} className="chip" aria-pressed={rep === r.v} onClick={() => setRep(r.v)}>{r.label}</button>)}</div></div>
          <div className="field"><label>Deposits to</label><div className="chips">{liquid.map((a) => <button key={a.id} className="chip" aria-pressed={acctId === a.id} onClick={() => setAcctId(a.id)}>{a.name}</button>)}</div></div>
          {inc.repeat !== 'none' && (
            <div className="field"><label>Apply to</label>
              <Seg block value={scope} onChange={setScope} options={[{ v: 'future', label: 'This and future' }, { v: 'this', label: 'Just this one' }]} />
              <div className="xs muted">{scope === 'future' ? 'Updates this entry and the ones scheduled after it.' : 'Only this date changes; the repeating schedule stays as it was.'}</div></div>)}
        </div>
      </Sheet>
    );
  }
  if (step === 'confirm') {
    const cents = toCents(amt);
    const dest = data.accounts.find((a) => a.id === acctId)!;
    return (
      <Sheet title="Confirm receipt" sub="Only record this once the money is really in the account." onClose={closeModal}
        footer={<><button className="btn" onClick={() => setStep('view')}>Back</button>
          <button className="btn primary" disabled={cents <= 0 || saving} onClick={async () => { setSaving(true); if (await receiveIncome(inc.id, { date: recvDate, amount: cents, accountId: acctId })) { toast(`${money(cents)} received · added to ${dest.name}`); closeModal(); } else setSaving(false); }}>{saving ? 'Recording…' : 'Record income'}</button></>}>
        <div className="stack gap12">
          <div className="field"><label>Amount received</label><MoneyInput value={amt} onChange={setAmt} autoFocus /></div>
          <div className="field"><label htmlFor="rd">Date received</label><input id="rd" type="date" className="input" value={recvDate} max={data.today} onChange={(e) => setRecvDate(e.target.value)} /></div>
          <div className="field"><label>Deposited to</label><div className="chips">{liquid.map((a) => <button key={a.id} className="chip" aria-pressed={acctId === a.id} onClick={() => setAcctId(a.id)}>{a.name}</button>)}</div></div>
          <div className="card pad num" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
            <div className="row between small"><span>{dest.name}</span><span><span className="muted">{money(dest.balance)}</span> → <b>{money(dest.balance + cents)}</b></span></div>
            <div className="row between small" style={{ marginTop: 6 }}><span>Ready to Assign</span><span><span className="muted">{money(readyToAssign(data))}</span> → <b>{money(readyToAssign(data) + cents)}</b></span></div>
          </div>
          {inc.repeat !== 'none' && <div className="xs muted">The next {inc.label} will stay on your forecast automatically.</div>}
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title={inc.label} onClose={closeModal}
      footer={choose === 'delete'
        ? <><button className="btn" onClick={() => setChoose(null)}>Back</button><button className="btn danger" disabled={saving} onClick={async () => { setSaving(true); if (await deleteIncome(inc.id, 'this')) closeModal(); else setSaving(false); }}>Just this one</button><button className="btn danger" disabled={saving} onClick={async () => { setSaving(true); if (await deleteIncome(inc.id, 'series')) closeModal(); else setSaving(false); }}>Whole series</button></>
        : <><button className="btn danger" aria-label="Delete expected income" disabled={saving} onClick={async () => { if (inc.repeat !== 'none') { setChoose('delete'); return; } setSaving(true); if (await deleteIncome(inc.id, 'this')) closeModal(); else setSaving(false); }}><Trash />Delete</button><button className="btn" onClick={() => setEditing(true)}><Pencil />Edit</button><button className="btn primary" onClick={() => setStep('confirm')}>Mark as received</button></>}>
      <div style={{ textAlign: 'center', padding: '4px 0 18px' }}>
        <div className="amt-hero num c-proj"><Money v={inc.amount} /></div>
        <div style={{ marginTop: 10, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
          <StatusPill status="proj">Projected</StatusPill><StatusPill status="muted">{fmtDate(inc.date, 'long')}</StatusPill>
        </div>
      </div>
      <Callout tone="proj" icon={<FlaskConical />}>This is a <b>projection</b>. It does not appear in {acct.name} or in Ready to Assign until you confirm it arrived.</Callout>
      <div style={{ marginTop: 16 }}>
        <div className="kv"><span className="k">Confidence</span><span className="v">{inc.certainty === 'guaranteed' ? 'Guaranteed' : 'Anticipated'}</span></div>
        <div className="small muted" style={{ margin: '6px 0 10px' }}>{inc.certainty === 'guaranteed' ? 'Included in both the conservative and optimistic forecasts.' : 'Only included in the optimistic forecast — your conservative plan doesn’t count on it.'}</div>
      </div>
      <div style={{ marginTop: 14 }}>
                <div className="kv"><span className="k">Repeats</span><span className="v">{REPEATS.find((r) => r.v === inc.repeat)?.label}</span></div>
        <div className="kv"><span className="k">Deposits to</span><span className="v">{acct.name}</span></div>
      </div>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════
// Reconcile (compare to the bank, record an adjustment only when you confirm)
// ═══════════════════════════════════════════════════════════
export function ReconcileSheet({ id }: { id: string }) {
  const { data, closeModal, reconcile, openModal } = useStore();
  const a = data.accounts.find((x) => x.id === id);
  const [step, setStep] = useState(1);
  const [val, setVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ diff: number; adjustmentTxnId?: string } | null>(null);
  if (!a) return null;
  if (!a.baseline) return <CutoverSheet id={id} />; // never anchored: set the opening balance first
  const credit = a.type === 'credit';
  const actual = toCents(val);
  const diff = actual - a.balance;
  const st = staleness(a, data.today);
  const isExpense = credit ? diff > 0 : diff < 0;
  const rtaBefore = readyToAssign(data);
  const rtaAfter = credit ? rtaBefore : rtaBefore + diff;
  const dr = drift(a);

  return (
    <Sheet title={`Reconcile ${a.name}`} onClose={closeModal}
      footer={step === 1 ? <button className="btn primary lg" disabled={val === ''} onClick={() => setStep(2)}>Preview difference</button>
        : step === 2 ? <><button className="btn" onClick={() => setStep(1)}>Back</button><button className="btn primary" disabled={saving} onClick={async () => { setSaving(true); const r = await reconcile(id, actual); if (r) { setResult(r); setStep(3); } setSaving(false); }}>{saving ? 'Saving…' : diff === 0 ? 'Mark reconciled' : 'Record adjustment'}</button></>
          : <><button className="btn" onClick={closeModal}>Done</button>{result?.adjustmentTxnId && <button className="btn primary" onClick={() => openModal({ type: 'txn', mode: 'view', id: result.adjustmentTxnId })}>View adjustment</button>}</>}>
      <div className="stepper" aria-label={`Step ${step} of 3`}>{[1, 2, 3].map((n) => <i key={n} className={n <= step ? 'on' : ''} />)}</div>
      {step === 1 && (
        <div className="stack gap16 fade-in">
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 650, letterSpacing: '-0.02em' }}>What does your {credit ? 'statement or card app' : 'bank'} say right now?</h3>
            <p className="small muted" style={{ marginTop: 4 }}>{credit ? 'Enter the current amount owed.' : 'Enter the current available balance.'} Finances compares it with what’s recorded and never changes anything until you confirm.</p>
          </div>
          <div className="card pad" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
            <div className="row between"><div><div className="eyebrow">Recorded in Finances</div><div className="amt-lg num"><Money v={a.balance} /></div></div>
              <StatusPill status={st.level === 'fresh' ? 'ok' : st.level === 'aging' ? 'warn' : 'late'}>{st.days === 0 ? 'Reconciled today' : `${st.days} days since last`}</StatusPill></div>
            <div className="xs muted" style={{ marginTop: 6 }}>Last reconciled {a.lastReconciled ? fmtDate(a.lastReconciled, 'long') : 'never'}</div>
          </div>
          {dr != null && dr !== 0 && <Callout tone="warn">The opening balance plus your transactions adds up to <b className="num">{money(a.derived!)}</b>, but the recorded balance is <b className="num">{money(a.balance)}</b>. Reconciling will show which one matches your bank.</Callout>}
          <div className="field"><label htmlFor="act">{credit ? 'Amount owed per statement' : 'Actual balance'}</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 14, top: 14, color: 'var(--ink-4)', fontSize: 20 }}>$</span>
              <input id="act" className="input num" inputMode="decimal" autoFocus placeholder="0.00" value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
                style={{ height: 56, fontSize: 26, fontWeight: 620, paddingLeft: 32, letterSpacing: '-0.03em' }} />
            </div>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="stack gap16 fade-in">
          <div className="card pad" style={{ boxShadow: 'none' }}>
            <div className="kv"><span className="k">Recorded in Finances</span><span className="v num">{money(a.balance)}</span></div>
            <div className="kv"><span className="k">{credit ? 'Statement says you owe' : 'Your bank says'}</span><span className="v num">{money(actual)}</span></div>
            <div className="kv"><span className="k" style={{ fontWeight: 650, color: 'var(--ink)' }}>Difference</span>
              <span className={cn('v num', diff === 0 ? 'pos' : 'warn')} style={{ fontSize: 18, fontWeight: 650 }}>{diff === 0 ? 'None — it matches' : money(diff, { sign: true })}</span></div>
          </div>
          {diff === 0 ? <Callout icon={<CircleCheck />}>Everything lines up. Today will be recorded as the last reconciliation date.</Callout> : (
            <>
              <div>
                <div className="eyebrow" style={{ marginBottom: 8 }}>What will be recorded</div>
                <div className="card pad" style={{ boxShadow: 'none', background: 'var(--planned-soft)', borderColor: 'transparent' }}>
                  <div className="row gap12"><div className="li-ico planned"><Scale /></div>
                    <div className="grow"><div className="li-title">Reconciliation adjustment</div><div className="xs muted">{fmtDate(data.today, 'long')} · {a.name} · no category</div></div>
                    <div className={cn('amt-md num', isExpense ? '' : 'pos')}>{money(isExpense ? -Math.abs(diff) : Math.abs(diff), { sign: true })}</div></div>
                </div>
              </div>
              {!credit && <div className="small muted num">Ready to Assign will change from {money(rtaBefore)} to <b style={{ color: 'var(--ink)' }}>{money(rtaAfter)}</b>.</div>}
              <Callout tone="warn">A difference usually means a missing or mistyped transaction. You can close this, fix it, and come back — nothing is changed until you confirm. The adjustment is a permanent, visible record.</Callout>
            </>
          )}
        </div>
      )}
      {step === 3 && result && (
        <div className="stack gap12 fade-in" style={{ alignItems: 'center', textAlign: 'center', padding: '14px 0' }}>
          <div style={{ width: 64, height: 64, borderRadius: 22, background: 'var(--pos-soft)', color: 'var(--pos)', display: 'grid', placeItems: 'center' }}><Check size={32} strokeWidth={2.4} /></div>
          <h3 style={{ fontSize: 19, fontWeight: 650, letterSpacing: '-0.02em' }}>{a.name} is reconciled</h3>
          <p className="muted small" style={{ maxWidth: 320 }}>{result.diff === 0 ? 'Recorded and actual balances match.' : `An adjustment of ${money(result.diff, { sign: true })} was recorded so the balance is now ${money(actual)}.`}</p>
        </div>
      )}
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════
// Cutover: choose a date, enter the REAL balances. History stays intact; balances count forward from here.
// ═══════════════════════════════════════════════════════════
const delta = (a: Account, t: Txn) => {
  const credit = a.type === 'credit'; let d = 0;
  if (t.accountId === a.id) d += (t.type === 'income' ? 1 : -1) * t.amount * (credit ? -1 : 1);
  if (t.type === 'transfer' && t.toAccountId === a.id) d += t.amount * (credit ? -1 : 1);
  return d;
};
export function CutoverSheet({ id }: { id?: string }) {
  const { data, closeModal, setCutovers } = useStore();
  const list = id ? data.accounts.filter((a) => a.id === id) : data.accounts;
  const [date, setDate] = useState(() => data.accounts.find((a) => a.baseline)?.baseline ?? addDays(data.today, -1));
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const entered = list.filter((a) => vals[a.id] !== undefined && vals[a.id] !== '');
  const countAfter = (a: Account) => data.txns.filter((t) => t.date > date && (t.accountId === a.id || t.toAccountId === a.id)).length;
  const countBefore = (a: Account) => data.txns.filter((t) => t.date <= date && (t.accountId === a.id || t.toAccountId === a.id)).length;
  const newBal = (a: Account) => toCents(vals[a.id]) + sum(data.txns.filter((t) => t.date > date), (t) => delta(a, t));
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= data.today;
  return (
    <Sheet title={id ? `Set opening balance` : 'Set opening balances'} wide onClose={closeModal}
      sub="Pick a date, then enter what each account really held at the end of that day."
      footer={<button className="btn primary lg" disabled={!entered.length || !validDate || saving} onClick={async () => {
        setSaving(true);
        const ok = await setCutovers(date, entered.map((a) => ({ accountId: a.id, opening: toCents(vals[a.id]) })));
        if (ok) closeModal(); else setSaving(false);
      }}>{saving ? 'Saving…' : entered.length ? `Set ${entered.length} opening balance${entered.length > 1 ? 's' : ''}` : 'Enter at least one balance'}</button>}>
      <Callout tone="planned" icon={<Eye />}>Nothing is deleted or rewritten. Every past transaction stays saved and searchable; only transactions dated <b>after</b> the date you pick change the balance from here on. Use balances from your bank or card statements — Finances never guesses them.</Callout>
      <div className="field" style={{ marginTop: 14 }}><label htmlFor="cd">Cutover date</label>
        <input id="cd" type="date" className="input" value={date} max={data.today} onChange={(e) => setDate(e.target.value)} />
        <div className="xs muted">Balances you enter below are as of the end of this day. A recent statement date works best.</div></div>
      <div className="stack" style={{ marginTop: 10 }}>
        {list.map((a) => {
          const v = vals[a.id] ?? ''; const credit = a.type === 'credit';
          return (
            <div key={a.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="row between gap12" style={{ alignItems: 'flex-start' }}>
                <div className="grow"><div className="li-title" style={{ fontSize: 14 }}>{a.name}</div>
                  <div className="xs muted">{a.baseline ? `Verified ${fmtDate(a.baseline)} · ` : 'Not verified yet · '}Recorded now <span className="num">{money(a.balance)}</span>{a.derived != null && a.derived !== a.balance ? <> · history implies <span className="num">{money(a.derived)}</span></> : null}</div></div>
                <div style={{ width: 150 }}><MoneyInput value={v} onChange={(x) => setVals({ ...vals, [a.id]: x })} placeholder={credit ? 'Amount owed' : 'Balance'} /></div>
              </div>
              {v !== '' && validDate && (
                <div className="xs muted num fade-in" style={{ marginTop: 6 }}>
                  {countBefore(a)} earlier transaction{countBefore(a) === 1 ? '' : 's'} kept as history · {countAfter(a)} counted after {fmtDate(date)} → balance becomes <b style={{ color: 'var(--ink-2)' }}>{money(newBal(a))}</b>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════
// Add account / category
// ═══════════════════════════════════════════════════════════
export function AccountAddSheet() {
  const { data, closeModal, addAccount, toast } = useStore();
  const [name, setName] = useState('');
  const [type, setType] = useState<Account['type']>('checking');
  const [bal, setBal] = useState('');
  const [limit, setLimit] = useState('');
  const [date, setDate] = useState(data.today);
  const [saving, setSaving] = useState(false);
  return (
    <Sheet title="Add an account" sub="Enter the real balance as of a date you choose." onClose={closeModal}
      footer={<button className="btn primary lg" disabled={!name.trim() || bal === '' || saving} onClick={async () => {
        setSaving(true);
        if (await addAccount({ name: name.trim(), type, limit: toCents(limit) || undefined, opening: toCents(bal), cutover: date })) { toast('Account added'); closeModal(); } else setSaving(false);
      }}>{saving ? 'Adding…' : 'Add account'}</button>}>
      <div className="stack gap16">
        <div className="field"><label htmlFor="an">Name</label><input id="an" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Everyday Checking" /></div>
        <div className="field"><label>Type</label><div className="chips">{(['checking', 'savings', 'cash', 'credit'] as const).map((t) => <button key={t} className="chip" aria-pressed={type === t} onClick={() => setType(t)} style={{ textTransform: 'capitalize' }}>{t === 'credit' ? 'Credit card' : t}</button>)}</div></div>
        <div className="row gap12">
          <div className="field grow"><label>{type === 'credit' ? 'Amount owed' : 'Balance'}</label><MoneyInput value={bal} onChange={setBal} /></div>
          <div className="field grow"><label htmlFor="ad">As of</label><input id="ad" type="date" className="input" value={date} max={data.today} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        {type === 'credit' && <div className="field"><label>Credit limit (optional)</label><MoneyInput value={limit} onChange={setLimit} /></div>}
      </div>
    </Sheet>
  );
}

/** Shared schedule fields: payment amount, next due date, recurrence, reminder/prepare. */
interface ScheduleState { amount: string; date: string; period: 'once' | BillPeriod; mode: Bill['mode'] }
function ScheduleFields({ s, set }: { s: ScheduleState; set: (p: Partial<ScheduleState>) => void }) {
  const day = Number((s.date || '0000-00-00').slice(8, 10));
  return (
    <div className="stack gap16" data-testid="schedule-fields">
      <div className="row gap12" style={{ alignItems: 'flex-start' }}>
        <div className="field grow"><label htmlFor="sf-amt">Payment amount</label><MoneyInput id="sf-amt" value={s.amount} onChange={(v) => set({ amount: v })} /></div>
        <div className="field grow"><label htmlFor="sf-date">Next due date</label><input id="sf-date" type="date" className="input" value={s.date} onChange={(e) => set({ date: e.target.value })} /></div>
      </div>
      <div className="field"><label>Repeats</label><div className="chips">{PERIODS.map((o) => <button key={o.v} className="chip" aria-pressed={s.period === o.v} onClick={() => set({ period: o.v })}>{o.label}</button>)}</div>
        {(s.period === 'Monthly' || s.period === 'Yearly') && day >= 29 && <div className="xs muted" style={{ marginTop: 6 }}>Anchored to the {day}th: shorter months use their last day, then it returns to the {day}th.</div>}</div>
      <div className="field"><label>When you mark it paid…</label>
        <Seg block value={s.mode} onChange={(m) => set({ mode: m })} options={[{ v: 'reminder', label: 'Just a reminder' }, { v: 'prepare', label: 'Prepare a transaction' }]} />
        <div className="xs muted" style={{ marginTop: 6 }}>{s.mode === 'reminder' ? 'Finances only tracks the due date.' : 'Finances prepares the transaction for you to review. It is never posted without your confirmation.'}</div></div>
    </div>
  );
}

export function CategoryAddSheet() {
  const { data, closeModal, addCategory, toast } = useStore();
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState(data.groups[0]?.id ?? '');
  const [target, setTarget] = useState('');
  const [tgtTouched, setTgtTouched] = useState(false);
  const [emoji, setEmoji] = useState('');
  const [kind, setKind] = useState<'funding' | 'bill'>('bill');
  const [sch, setSch] = useState<ScheduleState>({ amount: '', date: '', period: 'Monthly', mode: 'reminder' });
  const [saving, setSaving] = useState(false);
  const isBillsGroup = data.groups.find((g) => g.id === groupId)?.kind === 'bills';
  const scheduled = isBillsGroup && kind === 'bill';
  const dup = !!name.trim() && data.categories.some((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  // Sensible default: a monthly bill's funding target starts equal to the payment; other frequencies are never assumed.
  const tgtShown = tgtTouched ? target : scheduled && sch.period === 'Monthly' ? sch.amount : '';
  const amountC = toCents(sch.amount);
  const err = !name.trim() ? 'Give the category a name.' : dup ? 'A category with that name already exists.' : scheduled && amountC <= 0 ? 'Enter the payment amount.' : scheduled && !sch.date ? 'Choose the next due date.' : '';
  return (
    <Sheet title="New category" sub={scheduled ? 'A budget envelope plus a scheduled bill, in one step.' : 'A target is optional — you can always just assign what you have.'} onClose={closeModal}
      footer={<button className="btn primary lg" disabled={!!err || !groupId || saving} onClick={async () => {
        setSaving(true);
        const ok = await addCategory({ name: name.trim(), groupId, target: toCents(tgtShown) || null, emoji: emoji.trim() || undefined, schedule: scheduled ? { amount: amountC, date: sch.date, period: sch.period, mode: sch.mode } : undefined });
        if (ok) { toast(scheduled ? `${name.trim()} added with a scheduled bill` : `${name.trim()} added`); closeModal(); } else setSaving(false);
      }}>{saving ? 'Adding…' : scheduled ? 'Add category & bill' : 'Add category'}</button>}>
      <div className="stack gap16">
        <div className="row gap12"><div className="field grow"><label htmlFor="cn">Name</label><input id="cn" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field" style={{ width: 84 }}><label htmlFor="ce">Emoji</label><input id="ce" className="input" maxLength={4} value={emoji} onChange={(e) => setEmoji(e.target.value)} style={{ textAlign: 'center' }} /></div></div>
        <div className="field"><label>Group</label><div className="chips">{data.groups.map((g) => <button key={g.id} className="chip" aria-pressed={groupId === g.id} onClick={() => setGroupId(g.id)}>{g.name}</button>)}</div></div>
        {isBillsGroup && <div className="field"><label>This category is</label>
          <Seg block value={kind} onChange={setKind} options={[{ v: 'bill', label: 'A scheduled bill' }, { v: 'funding', label: 'Funding only' }]} />
          <div className="xs muted" style={{ marginTop: 6 }}>{kind === 'bill' ? 'Has a due date, shows in upcoming bills and the forecast, and you can mark it paid.' : 'Just an envelope you set money aside in. No due date, no reminders — you can add a schedule later.'}</div></div>}
        {scheduled && <ScheduleFields s={sch} set={(p) => setSch({ ...sch, ...p })} />}
        <div className="field"><label htmlFor="ct">Monthly funding target{scheduled ? '' : ' (optional)'}</label><MoneyInput id="ct" value={tgtShown} onChange={(v) => { setTarget(v); setTgtTouched(true); }} placeholder="No target" />
          {scheduled && <div className="xs muted" style={{ marginTop: 6 }}>How much to set aside each month. {sch.period === 'Monthly' ? 'Starts equal to the payment — change it any time.' : 'Left empty for non-monthly bills — enter what you want to set aside per month.'}</div>}</div>
        {err && name && <div className="small neg" role="alert">{err}</div>}
      </div>
    </Sheet>
  );
}

export function CategoryEditSheet({ id }: { id: string }) {
  const { data, closeModal, updateCategory, toast } = useStore();
  const cat = data.categories.find((c) => c.id === id);
  const [name, setName] = useState(cat?.name ?? '');
  const [emoji, setEmoji] = useState(/^[a-z]+$/i.test(cat?.icon ?? '') ? '' : cat?.icon ?? '');
  const [groupId, setGroupId] = useState(cat?.groupId ?? '');
  const [saving, setSaving] = useState(false);
  if (!cat) return <Sheet title="Category not found" onClose={closeModal}><div className="small muted">This category no longer exists.</div></Sheet>;
  const dup = data.categories.some((c) => c.id !== id && c.name.trim().toLowerCase() === name.trim().toLowerCase());
  const keepIcon = /^[a-z]+$/i.test(cat.icon); // built-in icon keys stay unless an emoji is typed
  const err = !name.trim() ? 'Give the category a name.' : dup ? 'Another category already has that name.' : '';
  const changed = name.trim() !== cat.name || groupId !== cat.groupId || (emoji.trim() !== (keepIcon ? '' : cat.icon));
  return (
    <Sheet title="Edit category" sub={cat.name} onClose={closeModal}
      footer={<><button className="btn" onClick={closeModal}>Cancel</button><button className="btn primary" disabled={!!err || !changed || saving} onClick={async () => {
        setSaving(true);
        const ok = await updateCategory(id, { name, emoji: emoji.trim() || (keepIcon ? cat.icon : ''), groupId });
        if (ok) { toast(`${name.trim()} updated · budget, bills and transactions unchanged`); closeModal(); } else setSaving(false);
      }}>{saving ? 'Saving…' : 'Save changes'}</button></>}>
      <Callout icon={<Info />}>Renaming or moving a category keeps its money, transactions, bill, payment history and any debt exactly as they are.</Callout>
      <div className="row gap12" style={{ marginTop: 14 }}><div className="field grow"><label htmlFor="ecn">Name</label><input id="ecn" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field" style={{ width: 84 }}><label htmlFor="ece">Emoji</label><input id="ece" className="input" maxLength={4} value={emoji} onChange={(e) => setEmoji(e.target.value)} style={{ textAlign: 'center' }} placeholder={keepIcon ? '—' : ''} /></div></div>
      <div className="field" style={{ marginTop: 14 }}><label>Group</label><div className="chips">{data.groups.map((g) => <button key={g.id} className="chip" aria-pressed={groupId === g.id} onClick={() => setGroupId(g.id)}>{g.name}</button>)}</div></div>
      {err && changed && <div className="small neg" style={{ marginTop: 12 }} role="alert">{err}</div>}
    </Sheet>
  );
}

/** Add a payment schedule to a category that has none (funding-only today). Funding target, balance and history are not touched. */
export function BillScheduleSheet({ categoryId }: { categoryId: string }) {
  const { data, closeModal, scheduleBill, toast } = useStore();
  const cat = data.categories.find((c) => c.id === categoryId);
  const [sch, setSch] = useState<ScheduleState>({ amount: cat?.target ? centsToInput(cat.target) : '', date: '', period: 'Monthly', mode: 'reminder' });
  const [saving, setSaving] = useState(false);
  if (!cat) return <Sheet title="Category not found" onClose={closeModal}><div className="small muted">This category no longer exists.</div></Sheet>;
  const amountC = toCents(sch.amount);
  const err = amountC <= 0 ? 'Enter the payment amount.' : !sch.date ? 'Choose the next due date.' : '';
  return (
    <Sheet title="Add scheduled bill" sub={cat.name} onClose={closeModal}
      footer={<><button className="btn" onClick={closeModal}>Cancel</button><button className="btn primary" disabled={!!err || saving} onClick={async () => {
        setSaving(true);
        if (await scheduleBill(categoryId, { amount: amountC, date: sch.date, period: sch.period, mode: sch.mode })) { toast(`${cat.name} now has a scheduled bill · no transactions created`); closeModal(); } else setSaving(false);
      }}>{saving ? 'Saving…' : 'Add bill'}</button></>}>
      <Callout icon={<Info />}>This only adds the payment schedule. The envelope’s monthly target ({cat.target ? money(cat.target) : 'none'}), its balance and your transactions stay as they are.</Callout>
      <div style={{ marginTop: 14 }}><ScheduleFields s={sch} set={(p) => setSch({ ...sch, ...p })} /></div>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════
// Menu + account footer
// ═══════════════════════════════════════════════════════════
export function AccountFoot() {
  const { email, signOut, data, toast } = useStore();
  const hb = data.hiddenBusiness;
  return (
    <div className="who-note">
      Signed in as <b style={{ color: 'var(--ink-2)' }}>{email}</b>
      {(hb.accounts + hb.transactions) > 0 && <div style={{ marginTop: 4 }}>Business records ({hb.transactions} transactions) are hidden but safely stored.</div>}
      <div className="row-links">
        <button onClick={async () => { try { await exportEverything(); toast('Export downloaded'); } catch { toast('Export failed — please try again'); } }}><Download size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Export all data</button>
        <button onClick={() => { void signOut(); }}><LogOut size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Sign out</button>
      </div>
    </div>
  );
}

export function MenuSheet() {
  const { closeModal, theme, setTheme, openModal } = useStore();
  const link = (path: string, label: string, icon: React.ReactNode) => (
    <button className="li hover" style={{ padding: '14px 4px' }} onClick={() => { closeModal(); go(path); }}><span className="li-ico">{icon}</span><span className="li-title grow">{label}</span><ArrowRight size={16} className="muted" /></button>
  );
  return (
    <Sheet title="More" onClose={closeModal}>
      <div className="list">{link('/plan/budget', 'Budget (optional)', <Wallet />)}{link('/accounts', 'Accounts & reconciliation', <Landmark />)}{link('/credit', 'Credit & utilization', <Gauge />)}{link('/insights', 'Insights', <Eye />)}
        <button className="li hover" style={{ padding: '14px 4px' }} onClick={() => openModal({ type: 'category-add' })}><span className="li-ico"><Plus /></span><span className="li-title grow">New category or bill</span><ArrowRight size={16} className="muted" /></button>
        <button className="li hover" style={{ padding: '14px 4px' }} onClick={() => openModal({ type: 'cutover' })}><span className="li-ico"><Scale /></span><span className="li-title grow">Set opening balances</span><ArrowRight size={16} className="muted" /></button></div>
      <div style={{ marginTop: 18 }}><div className="label" style={{ marginBottom: 8 }}>Appearance</div><ThemeSwitch theme={theme} setTheme={setTheme} /></div>
      <div style={{ marginTop: 18 }}><AccountFoot /></div>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// Debt details for a category (amount owed). Independent of bills, envelopes and accounts.
// ═══════════════════════════════════════════════════════════
export function DebtEditSheet({ categoryId }: { categoryId: string }) {
  const { data, closeModal, saveDebt, toast } = useStore();
  const cat = data.categories.find((c) => c.id === categoryId);
  const [isDebt, setIsDebt] = useState(true); // opened to track a debt; the toggle switches it back off
  const [bal, setBal] = useState(cat?.debtBalance ? centsToInput(cat.debtBalance) : '');
  const [saving, setSaving] = useState(false);
  if (!cat) return <Sheet title="Category not found" onClose={closeModal}><div className="small muted">This category no longer exists.</div></Sheet>;
  const cents = toCents(bal);
  const changed = isDebt !== !!cat.isDebt || (isDebt && cents !== (cat.debtBalance ?? 0));
  const save = async () => {
    setSaving(true);
    const ok = await saveDebt(categoryId, { isDebt, balance: isDebt ? cents : (cat.debtBalance ?? 0) });
    if (ok) { toast(isDebt ? `${cat.name}: balance owed set to ${money(cents)} · nothing else changed` : `${cat.name} is now an ordinary category`); closeModal(); } else setSaving(false);
  };
  return (
    <Sheet title={cat.isDebt ? 'Edit debt' : 'Track as debt'} sub={cat.name} onClose={closeModal}
      footer={<><button className="btn" onClick={closeModal}>Cancel</button><button className="btn primary" disabled={!changed || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button></>}>
      <Callout icon={<Info />}>This only records how much you owe. No transaction is created, and account balances, budget funding, bills and payment history are not touched.</Callout>
      <div className="field" style={{ marginTop: 14 }}><label>This category is</label>
        <Seg block value={isDebt ? 'debt' : 'plain'} onChange={(v) => setIsDebt(v === 'debt')} options={[{ v: 'plain', label: 'An ordinary category' }, { v: 'debt', label: 'A debt' }]} /></div>
      {isDebt && <div className="field" style={{ marginTop: 14 }}><label htmlFor="debt-bal">Amount you currently owe</label><MoneyInput id="debt-bal" value={bal} onChange={setBal} autoFocus placeholder="0.00" />
        <div className="xs muted" style={{ marginTop: 6 }}>Correct it any time. A due date or monthly payment is optional — set those with “Edit target” or a linked bill. If the debt has a bill and you post its payment with a transaction, the balance drops by the amount paid.</div></div>}
      {!isDebt && cat.isDebt && <div className="xs muted" style={{ marginTop: 10 }}>The saved balance ({money(cat.debtBalance ?? 0)}) is kept in case you switch this back on.</div>}
    </Sheet>
  );
}

const PERIODS: { v: 'once' | BillPeriod; label: string }[] = [{ v: 'once', label: 'One time' }, { v: 'Weekly', label: 'Weekly' }, { v: 'Bi-Weekly', label: 'Every 2 weeks' }, { v: 'Monthly', label: 'Monthly' }, { v: 'Yearly', label: 'Yearly' }];
export function BillEditSheet({ billId }: { billId: string }) {
  const { data, closeModal, updateBill, toast } = useStore();
  const bill = data.bills.find((b) => b.id === billId);
  const [name, setName] = useState(bill?.name ?? '');
  const [amt, setAmt] = useState(bill ? centsToInput(bill.amount) : '');
  const [date, setDate] = useState(bill?.date ?? data.today);
  const [period, setPeriod] = useState<'once' | BillPeriod>(bill ? (bill.recurring ? bill.period : 'once') : 'Monthly');
  const [mode, setMode] = useState<Bill['mode']>(bill?.mode ?? 'reminder');
  const [paused, setPaused] = useState(bill?.paused ?? false);
  const [groupId, setGroupId] = useState(data.categories.find((c) => c.id === bill?.categoryId)?.groupId ?? '');
  const [tgt, setTgt] = useState('');
  const [tgtTouched, setTgtTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!bill) return <Sheet title="Bill not found" onClose={closeModal}><div className="small muted">This bill no longer exists.</div></Sheet>;
  const cents = toCents(amt);
  const catRow = data.categories.find((c) => c.id === bill.categoryId);
  // The funding target and the payment are separate numbers. They only move together while they are still equal AND the bill is monthly;
  // otherwise the target is left alone unless you edit it.
  const wasTied = (catRow?.target ?? 0) === bill.amount;
  const tgtEdited = tgtTouched ? (toCents(tgt) || null) : undefined;
  const tgtEffective: number | null | undefined = tgtTouched ? (tgtEdited === (catRow?.target ?? null) ? undefined : tgtEdited) : wasTied && period === 'Monthly' && cents !== bill.amount ? cents : undefined;
  const tgtShown = tgtTouched ? tgt : tgtEffective != null ? centsToInput(tgtEffective) : catRow?.target ? centsToInput(catRow.target) : '';
  const dup = data.categories.some((c) => c.id !== bill.categoryId && c.name.trim().toLowerCase() === name.trim().toLowerCase());
  const alreadyPaid = !!bill.paid[date] && date !== bill.date;
  const skipsOverdue = !!bill.date && bill.date < data.today && !bill.paid[bill.date] && date > bill.date;
  const err = !name.trim() ? 'Give the bill a name.' : dup ? 'Another category already has that name.' : cents <= 0 ? 'Enter an amount greater than $0.' : !date ? 'Choose a due date.' : alreadyPaid ? 'That date is already recorded as paid. Choose the next unpaid date.' : '';
  const changed = name.trim() !== bill.name || cents !== bill.amount || date !== bill.date || period !== (bill.recurring ? bill.period : 'once') || mode !== bill.mode || paused !== bill.paused || tgtEffective !== undefined || groupId !== data.categories.find((c) => c.id === bill.categoryId)?.groupId;
  const save = async () => {
    setSaving(true);
    const ok = await updateBill(billId, { name, amount: cents, date, recurring: period !== 'once', period: period === 'once' ? bill.period : period, mode, groupId, paused, anchor: date !== bill.date ? date : undefined, target: tgtEffective });
    if (ok) { toast(`${name.trim()} updated · no transactions changed`); closeModal(); } else setSaving(false);
  };
  return (
    <Sheet title="Edit bill" sub={bill.name} onClose={closeModal}
      footer={<><button className="btn" onClick={closeModal}>Cancel</button><button className="btn primary" disabled={!!err || !changed || saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button></>}>
      <Callout icon={<Info />}>Changes apply from now on. Past payments, transactions and your budget amounts stay exactly as they are, and nothing is posted.</Callout>
      <div className="field" style={{ marginTop: 14 }}><label>Status</label>
        <Seg block value={paused ? 'paused' : 'active'} onChange={(v) => { const p = v === 'paused'; setPaused(p); if (!p && bill.paused && date < data.today && period !== 'once') setDate(rollForward({ recurring: true, period: period as BillPeriod, anchor: bill.anchor, date: bill.date, paid: bill.paid }, date, data.today)); }} options={[{ v: 'active', label: 'Active' }, { v: 'paused', label: 'Paused' }]} />
        <div className="xs muted" style={{ marginTop: 6 }}>{paused ? 'Paused bills drop out of upcoming bills, overdue alerts and forecasts. History and payments are kept.' : bill.paused ? `Resuming — next due ${fmtDate(date)}. Change it below if needed.` : 'Active bills show in upcoming bills, alerts and forecasts.'}</div></div>
      <div className="field" style={{ marginTop: 14 }}><label htmlFor="bn">Name</label><input id="bn" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></div>
      <div className="row gap12" style={{ marginTop: 14, alignItems: 'flex-start' }}>
        <div className="field grow"><label htmlFor="ba">Amount due</label><MoneyInput id="ba" value={amt} onChange={setAmt} /></div>
        <div className="field grow"><label htmlFor="bd">Next due date</label><input id="bd" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      {(period === 'Monthly' || period === 'Yearly') && Number((date || '0000-00-00').slice(8, 10)) >= 29 && <div className="xs muted" style={{ marginTop: 8 }}>Anchored to the {Number(date.slice(8, 10))}th{period === 'Yearly' ? ' of that month' : ''}: shorter months use their last day, then it returns to the {Number(date.slice(8, 10))}th.</div>}
      {skipsOverdue && <div className="xs muted" style={{ marginTop: 8 }}>The overdue {fmtDate(bill.date!)} due date stops showing. It isn’t marked paid and nothing is recorded.</div>}
      <div className="field" style={{ marginTop: 14 }}><label>Repeats</label>
        <div className="chips">{PERIODS.map((o) => <button key={o.v} className="chip" aria-pressed={period === o.v} onClick={() => setPeriod(o.v)}>{o.label}</button>)}</div></div>
      <div className="field" style={{ marginTop: 14 }}><label htmlFor="bt">Monthly funding target</label><MoneyInput id="bt" value={tgtShown} onChange={(v) => { setTgt(v); setTgtTouched(true); }} placeholder="No target" />
        <div className="xs muted" style={{ marginTop: 6 }}>What you set aside each month. Separate from the payment amount above.</div></div>
      <div className="field" style={{ marginTop: 14 }}><label>When you mark it paid…</label>
        <Seg block value={mode} onChange={setMode} options={[{ v: 'reminder', label: 'Just a reminder' }, { v: 'prepare', label: 'Prepare a transaction' }]} />
        <div className="xs muted" style={{ marginTop: 6 }}>{mode === 'reminder' ? 'Finances only tracks the due date.' : 'Finances prepares the transaction for you to review. It is never posted without your confirmation.'}</div></div>
      <div className="field" style={{ marginTop: 14 }}><label htmlFor="bg">Budget group</label>
        <select id="bg" className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>{data.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        <div className="xs muted" style={{ marginTop: 6 }}>This bill is paid from its own budget envelope, <b>{name.trim() || bill.name}</b>. Renaming it renames that envelope everywhere; its history stays attached.</div></div>
      {err && changed && <div className="small neg" style={{ marginTop: 12 }} role="alert">{err}</div>}
    </Sheet>
  );
}

export function SheetHost() {
  const { modal } = useStore();
  if (!modal) return null;
  switch (modal.type) {
    case 'txn': return <TxnSheet key={`${modal.mode}-${modal.id ?? 'new'}-${JSON.stringify(modal.prefill ?? {})}`} mode={modal.mode} id={modal.id} prefill={modal.prefill} />;
    case 'assign': return <AssignSheet />;
    case 'move': return <MoveSheet key={`${modal.from}-${modal.to}-${modal.amount}`} from={modal.from} to={modal.to} amount={modal.amount} />;
    case 'category': return <CategorySheet key={modal.id} id={modal.id} />;
    case 'category-add': return <CategoryAddSheet />;
    case 'category-edit': return <CategoryEditSheet key={modal.id} id={modal.id} />;
    case 'bill-schedule': return <BillScheduleSheet key={modal.categoryId} categoryId={modal.categoryId} />;
    case 'bill-edit': return <BillEditSheet key={modal.billId} billId={modal.billId} />;
    case 'bill': return <BillSheet key={`${modal.billId}-${modal.date}`} billId={modal.billId} date={modal.date} />;
    case 'income': return <IncomeSheet key={`${modal.mode}-${modal.id}`} mode={modal.mode} id={modal.id} />;
    case 'reconcile': return <ReconcileSheet key={modal.id} id={modal.id} />;
    case 'cutover': return <CutoverSheet key={modal.id ?? 'all'} id={modal.id} />;
    case 'account-add': return <AccountAddSheet />;
    case 'credit-score': return <CreditScoreSheet key={`${modal.id ?? 'new'}-${modal.bureau ?? ''}-${modal.model ?? ''}`} id={modal.id} bureau={modal.bureau} model={modal.model} />;
    case 'credit-card': return <CreditCardSheet key={modal.accountId} accountId={modal.accountId} />;
    case 'credit-reported': return <CreditReportedSheet key={`${modal.id ?? 'new'}-${modal.accountId ?? ''}`} id={modal.id} accountId={modal.accountId} />;
    case 'debt-edit': return <DebtEditSheet key={modal.categoryId} categoryId={modal.categoryId} />;
    case 'menu': return <MenuSheet />;
    default: return null;
  }
}
void TriangleAlert; void monthKey; void FlaskConical; void StickyNote; void Split; void Trash; void Plus; void diffDays; void relDay; void envelope; void allEnvelopes; void billOccurrences;

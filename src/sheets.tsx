import { useMemo, useRef, useState, useEffect, type ReactNode } from 'react';
import { Archive, ArrowLeftRight, ArrowRight, ArrowUpDown, ChevronDown, Bell, Check, CircleCheck, Download, Eye, FlaskConical, Info, Landmark, LogOut, ListChecks, Pencil, Plus, Scale, Split, StickyNote, Trash, TriangleAlert, Wallet } from 'lucide-react';
import { useStore } from './store';
import {
  allEnvelopes, envelope, readyToAssign, staleness, billOccurrences, drift, rollForward, nextDueDate, type Account, type Bill, type BillPeriod, type Category, type Txn, type Income, type Repeat as Rep,
} from './data';
import { addDays, centsToInput, cn, diffDays, fmtDate, money, monthKey, relDay, sum, toCents, plural, todayISO } from './lib';
import { CatIcon, Callout, Money, Seg, Sheet, StatusPill, ThemeSwitch } from './ui';
import { exportEverything, newRequestId } from './db';
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
  const { data, closeModal, addTxn, updateTxn, deleteTxn, payBill, unpayBill, toast, openModal } = useStore();
  const existing = id ? data.txns.find((t) => t.id === id) : undefined;
  const [mode, setMode] = useState(initialMode);
  const [confirmDel, setConfirmDel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adv, setAdv] = useState<{ bill: Bill; id: string; t: Omit<Txn, 'id'> } | null>(null);

  const seed: Partial<Txn> = existing ?? prefill ?? {};
  // Opened from an account's own page? Use that account (read once, when the sheet opens, so context never goes stale).
  const [ctxAcct] = useState(() => {
    if (initialMode !== 'add' || prefill?.accountId) return undefined;
    const m = /^#\/accounts\/([^/?]+)/.exec(location.hash);
    return m ? data.accounts.find((a) => a.id === decodeURIComponent(m[1]))?.id : undefined;
  });
  const defaultAcct = data.accounts.find((a) => a.type === 'checking')?.id ?? data.accounts[0]?.id ?? '';
  const [type, setType] = useState<Txn['type']>(seed.type ?? 'expense');
  const [amount, setAmount] = useState(seed.amount ? centsToInput(seed.amount) : '');
  const [payee, setPayee] = useState(seed.payee ?? '');
  const [categoryId, setCategoryId] = useState(seed.categoryId ?? '');
  const [accountId, setAccountId] = useState(seed.accountId ?? ctxAcct ?? defaultAcct);
  const [toAccountId, setToAccountId] = useState(seed.toAccountId ?? '');
  const [date, setDate] = useState(seed.date ?? data.today);
  const [notes, setNotes] = useState(seed.notes ?? '');
  const [splitOn, setSplitOn] = useState(!!seed.splits?.length);
  const [lines, setLines] = useState<{ categoryId: string; amount: string }[]>(seed.splits?.map((s) => ({ categoryId: s.categoryId, amount: centsToInput(s.amount) })) ?? [{ categoryId: '', amount: '' }, { categoryId: '', amount: '' }]);
  const [more, setMore] = useState(!!seed.notes || !!seed.splits?.length);
  const [hint, setHint] = useState('');
  const [focusPayee, setFocusPayee] = useState(false);
  const [hiSug, setHiSug] = useState(-1);
  // Anything the user picks by hand is never overwritten by payee autofill.
  const [catTouched, setCatTouched] = useState(mode !== 'add' || !!seed.categoryId);
  const [acctTouched, setAcctTouched] = useState(mode !== 'add');
  const [autoCat, setAutoCat] = useState(false);
  const [showAllCats, setShowAllCats] = useState(false);
  const amtRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (mode !== 'view') amtRef.current?.focus(); }, [mode]);

  const cents = toCents(amount);
  const catById = (cid?: string) => data.categories.find((c) => c.id === cid);
  const acct = (aid?: string) => data.allAccounts.find((a) => a.id === aid);

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
  const needle = payee.trim().toLowerCase();
  const suggestions = (needle
    ? payeeStats.filter((p) => p.name.toLowerCase().includes(needle) && p.name !== payee).sort((x, y) => Number(y.name.toLowerCase().startsWith(needle)) - Number(x.name.toLowerCase().startsWith(needle)) || y.n - x.n)
    : payeeStats).slice(0, 5);
  const applyPayee = (p: typeof payeeStats[number], explicit: boolean) => {
    const lc = p.last.splits?.length ? [...p.last.splits].sort((a, b) => b.amount - a.amount)[0].categoryId : p.last.categoryId;
    // Clicking/choosing a suggestion is an explicit request; an exact typed match only fills what you haven't chosen yourself.
    if (lc && (explicit || !catTouched)) { setCategoryId(lc); setAutoCat(true); if (explicit) setCatTouched(false); }
    if (!ctxAcct && (explicit || !acctTouched)) setAccountId(p.last.accountId); // the account you opened this from stays
    setHint(`Filled in from your last ${p.name} purchase${p.last.splits?.length ? ' (it was split — you can split again below)' : ''}`);
  };
  const pickPayee = (p: typeof payeeStats[number]) => { setPayee(p.name); setFocusPayee(false); setHiSug(-1); applyPayee(p, true); };
  const onPayeeChange = (v: string) => {
    setPayee(v); setHint(''); setHiSug(-1);
    if (type !== 'expense' || mode !== 'add') return;
    const exact = payeeStats.find((p) => p.name.toLowerCase() === v.trim().toLowerCase());
    if (exact) applyPayee(exact, false);
    else if (autoCat && !catTouched) { setCategoryId(''); setAutoCat(false); } // typed away from the match: undo the autofill
  };
  const onPayeeKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const open = focusPayee && type === 'expense' && suggestions.length > 0;
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHiSug((h) => Math.min(suggestions.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHiSug((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter' && hiSug >= 0) { e.preventDefault(); pickPayee(suggestions[hiSug]); }
    else if (e.key === 'Tab' && hiSug >= 0) pickPayee(suggestions[hiSug]); // accept, then Tab moves on as normal
    else if (e.key === 'Escape' && focusPayee) { e.stopPropagation(); setFocusPayee(false); }
  };

  // frequent categories
  const freq = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of data.txns) if (t.type === 'expense' && t.categoryId && !t.adjustment) m.set(t.categoryId, (m.get(t.categoryId) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).filter((k) => !catById(k)?.cardAccountId && !catById(k)?.hidden).slice(0, 6);
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

  /** A recurring, active bill this new payment plausibly settles — only a full-or-larger payment close to the due date, never a debt or a paused bill. */
  const billForNewTxn = (t: Omit<Txn, 'id'>): Bill | undefined => {
    if (t.type === 'income' || t.splits?.length || !t.categoryId || t.scheduled || t.date > data.today) return undefined;
    const b = data.bills.find((x) => x.categoryId === t.categoryId);
    if (!b || b.paused || !b.date || b.paid[b.date] || t.amount < b.amount) return undefined;
    const early = b.period === 'Weekly' ? 3 : b.period === 'Bi-Weekly' ? 7 : b.period === 'Yearly' ? 45 : 15;
    return t.date >= addDays(b.date, -early) ? b : undefined;
  };
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
      scheduled: date > data.today, // a future date is scheduled: it does not touch balances until that day
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
      if (newId) {
        const added = () => toast(`${t.scheduled ? 'Scheduled' : t.type === 'income' ? 'Income added' : t.type === 'transfer' ? 'Transfer added' : 'Expense added'} · ${money(t.amount)}`, () => { void deleteTxn(newId); });
        const b = billForNewTxn(t);
        if (b) { setAdv({ bill: b, id: newId, t }); setSaving(false); return; }
        added(); closeModal();
      }
    }
    setSaving(false);
  };

  // ── a new expense that looks like a bill payment: offer to count it, never silently ──
  if (adv) {
    const { bill, t, id: newId } = adv;
    const finish = () => { toast(`${t.type === 'transfer' ? 'Transfer' : 'Expense'} added · ${money(t.amount)}`, () => { void deleteTxn(newId); }); closeModal(); };
    return (
      <Sheet title={`Count this as your ${bill.name} payment?`} sub={`${money(t.amount)} recorded · ${bill.name} due ${fmtDate(bill.date!)}`} onClose={finish}
        footer={<><button className="btn" data-testid="keep-due" disabled={saving} onClick={finish}>No, just the transaction</button>
          <button className="btn primary" data-testid="advance-due" disabled={saving} onClick={async () => {
            setSaving(true);
            const r = await payBill({ billId: bill.id, due: bill.date!, mode: 'link', transactionId: newId });
            if (r) { toast(`${bill.name} marked paid`, () => { void unpayBill(bill.id, bill.date!, false); }); closeModal(); } else setSaving(false);
          }}>Yes, mark it paid</button></>}>
        <Callout icon={<Info />}>Your transaction is kept either way. Marking it paid {bill.isDebt ? 'also lowers what you owe and ' : ''}moves {bill.name} to its next due date.</Callout>
      </Sheet>
    );
  }

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
            {t.scheduled && <StatusPill status="proj">Scheduled · not posted yet</StatusPill>}
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
      footer={<button className="btn primary lg" disabled={!valid || saving} onClick={save}>{saving ? 'Saving…' : existing ? 'Save changes' : date > data.today ? `Schedule ${verb}` : `Add ${verb}`}{cents > 0 ? ` · ${money(cents)}` : ''}</button>}>
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
              onChange={(e) => onPayeeChange(e.target.value)} onKeyDown={onPayeeKey} role="combobox" aria-expanded={focusPayee && suggestions.length > 0} aria-autocomplete="list" />
            {focusPayee && type === 'expense' && (suggestions.length > 0) && (
              <div className="suggest" role="listbox">
                {suggestions.map((p, i) => (
                  <button type="button" key={p.name} role="option" aria-selected={hiSug === i} style={hiSug === i ? { background: 'var(--surface-2)' } : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => pickPayee(p)}>
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
              {chipCats.map((k) => { const c = catById(k)!; return <button type="button" key={k} className="chip" aria-pressed={categoryId === k} onClick={() => { setCategoryId(k); setCatTouched(true); setAutoCat(false); }}><CatIcon k={c.icon} />{c.name}</button>; })}
              <button type="button" className="chip" onClick={() => setShowAllCats((v) => !v)}>{showAllCats ? 'Hide' : 'All categories'}</button>
            </div>
            {showAllCats && (
              <select className="select" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setCatTouched(true); setAutoCat(false); }} aria-label="All categories">
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
            {data.accounts.map((a) => <button type="button" key={a.id} className="chip" aria-pressed={accountId === a.id} onClick={() => { setAccountId(a.id); setAcctTouched(true); }}>{a.name}</button>)}
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
                {date !== data.today && <button type="button" className="btn sm" onClick={() => setDate(data.today)}>Today</button>}</div>
              {date > data.today && <div className="xs c-planned">Scheduled: it won’t change your balances or budget until {fmtDate(date)}.</div>}</div>
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
interface PickItem { id: string; name: string; group: string; avail: number; need: number }
/** Compact searchable select: shows the current choice; opens a short list with a search box (type, ↑/↓, Enter, Esc). */
function EnvSelect({ items, value, onPick, label, testid, disabledIds, placeholder, hint, autoFocus }: { items: PickItem[]; value: string; onPick: (id: string) => void; label: string; testid: string; disabledIds?: (it: PickItem) => boolean; placeholder: string; hint?: (it: PickItem) => string; autoFocus?: boolean }) {
  const [open, setOpen] = useState(!!autoFocus && !value);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const cur = items.find((i) => i.id === value);
  const nq = q.trim().toLowerCase();
  const off = (i: PickItem) => !!disabledIds?.(i);
  const usable = items.filter((i) => !off(i)), unusable = items.filter(off);
  const base = nq || showAll ? [...usable, ...unusable] : usable;
  const list = nq ? base.filter((i) => i.name.toLowerCase().includes(nq) || i.group.toLowerCase().includes(nq)) : base;
  const choose = (it: PickItem) => { if (off(it)) return; onPick(it.id); setOpen(false); setQ(''); setShowAll(false); };
  return (
    <div className="stack gap8" data-testid={testid}>
      <button type="button" className="row between card" aria-label={`${label}: ${cur ? cur.name : 'none chosen'}`} aria-expanded={open} data-testid={`${testid}-btn`}
        style={{ boxShadow: 'none', background: 'var(--surface-2)', padding: '10px 14px', width: '100%', textAlign: 'left', gap: 10 }} onClick={() => setOpen((v) => !v)}>
        <div style={{ minWidth: 0 }}>
          <div className="li-title ellipsis">{cur ? cur.name : <span className="muted">{placeholder}</span>}</div>
          {cur && <div className="li-sub ellipsis">{hint ? hint(cur) : cur.group}</div>}
        </div>
        <div className="row gap8">{cur && <b className="num small">{money(cur.avail)}</b>}<ChevronDown size={16} className="muted" /></div>
      </button>
      {open && (
        <div className="picker fade-in">
          <input className="input" autoFocus placeholder={`Search ${label.toLowerCase()}…`} aria-label={`Search ${label}`} value={q}
            onChange={(e) => { setQ(e.target.value); setHi(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(list.length - 1, h + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); if (list[hi]) choose(list[hi]); }
              else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
            }} />
          <div role="listbox" aria-label={label} style={{ maxHeight: 200, overflowY: 'auto', marginTop: 6 }}>
            {list.length === 0 && <div className="small muted" style={{ padding: 10 }}>{nq ? `Nothing matches “${q}”.` : 'Nothing available.'}</div>}
            {list.map((it, i) => (
              <button type="button" key={it.id} role="option" aria-selected={value === it.id} aria-disabled={off(it)} data-id={it.id} className="li hover" onClick={() => choose(it)}
                style={{ padding: '8px 10px', borderRadius: 10, width: '100%', textAlign: 'left', opacity: off(it) ? 0.5 : 1, cursor: off(it) ? 'default' : undefined, background: value === it.id ? 'var(--planned-soft)' : i === hi && nq ? 'var(--surface-2)' : undefined }}>
                <div className="grow" style={{ minWidth: 0 }}><div className="li-title ellipsis" style={{ fontSize: 14 }}>{it.name}</div><div className="li-sub ellipsis" style={{ fontSize: 12 }}>{hint ? hint(it) : it.group}</div></div>
                <div className="right num small" style={{ fontWeight: 600 }}>{money(it.avail)}</div>
              </button>
            ))}
          </div>
          {unusable.length > 0 && !nq && <button type="button" className="sect-link" style={{ marginTop: 6 }} onClick={() => setShowAll((v) => !v)}>{showAll ? 'Hide empty ones' : `Show ${unusable.length} with nothing to move`}</button>}
        </div>
      )}
    </div>
  );
}

/** Move Money: From → To → Amount. One dialog for every entry point (Cover, Assign, Move). Budget allocations only — never touches bank balances. */
export function MoveSheet({ from: f0, to: t0, amount: a0 }: { from?: string; to?: string; amount?: number }) {
  const { data, closeModal, assign, moveMoney, toast, openModal } = useStore();
  const rta = readyToAssign(data);
  const envs = allEnvelopes(data).filter((e) => !e.cat.hidden);
  const groupName = (gid: string) => data.groups.find((g) => g.id === gid)?.name ?? '';
  const items: PickItem[] = useMemo(() => envs.map((e) => ({ id: e.cat.id, name: e.cat.name, group: groupName(e.cat.groupId), avail: e.env.avail, need: e.env.avail < 0 ? -e.env.avail : Math.max(0, e.env.remaining) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data]);
  const rtaItem: PickItem = { id: 'rta', name: 'Ready to Assign', group: 'Unassigned money', avail: rta, need: 0 };
  const all = useMemo(() => [rtaItem, ...items], [items, rta]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = (id: string) => all.find((i) => i.id === id);
  const nameOf = (id: string) => byId(id)?.name ?? '';
  const availOf = (id: string) => byId(id)?.avail ?? 0;

  // Opening from "Cover" (a destination is known, no source): suggest the shortfall and a source that can pay it — still nothing moves until Move is pressed.
  const suggestedFrom = (t: string, want: number) => {
    const funded = all.filter((i) => i.id !== t && i.avail > 0).sort((x, y) => (x.id === 'rta' ? -1 : y.id === 'rta' ? 1 : y.avail - x.avail));
    return (funded.find((i) => i.avail >= want && want > 0) ?? funded[0])?.id ?? '';
  };
  const [to, setTo] = useState(t0 ?? '');
  const [from, setFrom] = useState(() => f0 ?? (t0 ? suggestedFrom(t0, a0 ?? byId(t0)?.need ?? 0) : ''));
  const [amt, setAmt] = useState(() => {
    const want = a0 ?? (t0 ? byId(t0)?.need ?? 0 : 0);
    const src = f0 ?? (t0 ? suggestedFrom(t0, want) : '');
    const cap = src ? Math.max(0, availOf(src)) : want;
    return want > 0 && cap > 0 ? centsToInput(Math.min(want, cap)) : '';
  });
  const [saving, setSaving] = useState(false);
  const cents = toCents(amt);
  const max = Math.max(0, from ? availOf(from) : 0);
  const shortage = to ? byId(to)?.need ?? 0 : 0;
  let problem = '';
  if (from && to && from === to) problem = 'Pick two different places.';
  else if (from && max <= 0) problem = `${nameOf(from)} has nothing available to move${availOf(from) < 0 ? ` (it is overspent by ${money(-availOf(from))})` : ''}. Pick another source or swap the direction.`;
  else if (from && cents > max) problem = `Only ${money(max)} is available in ${nameOf(from)}.`;
  const valid = !!from && !!to && from !== to && cents > 0 && cents <= max;
  const swap = () => { const f = from, t = to; setFrom(t); setTo(f); };
  const go = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const good = from === 'rta' ? await assign({ [to]: cents }) : to === 'rta' ? await assign({ [from]: -cents }) : await moveMoney(from, to, cents);
    if (good) {
      const f = from, t = to;
      toast(`Moved ${money(cents)} to ${nameOf(t)}`, () => { if (f === 'rta') void assign({ [t]: -cents }); else if (t === 'rta') void assign({ [f]: cents }); else void moveMoney(t, f, cents); });
      closeModal();
    } else setSaving(false);
  };
  const fromHint = (i: PickItem) => (i.avail > 0 ? `${i.group} · available` : i.avail < 0 ? `${i.group} · overspent` : `${i.group} · empty`);
  const toHint = (i: PickItem) => (i.avail < 0 ? `${i.group} · overspent by ${money(-i.avail)}` : i.need > 0 ? `${i.group} · needs ${money(i.need)} more` : i.group);
  const toItems = useMemo(() => all.filter((i) => i.id !== from).sort((x, y) => (y.need > 0 ? 1 : 0) - (x.need > 0 ? 1 : 0) || y.need - x.need), [all, from]);
  const fromItems = useMemo(() => all.filter((i) => i.id !== to).sort((x, y) => (x.id === 'rta' ? -1 : y.id === 'rta' ? 1 : y.avail - x.avail)), [all, to]);

  return (
    <Sheet title="Move money" sub="Moves budget money between categories. Nothing changes in your bank accounts." onClose={closeModal}
      footer={<button className="btn primary lg" disabled={!valid || saving} onClick={go}>{valid ? `Move ${money(cents)}` : 'Move money'}</button>}>
      <form className="stack gap12" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <div className="field"><label>From</label>
          <EnvSelect items={fromItems} value={from} onPick={setFrom} label="From" testid="move-from" placeholder="Choose where the money comes from" disabledIds={(i) => i.avail <= 0} hint={fromHint} autoFocus={!from} /></div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn sm" data-testid="move-swap" onClick={swap} disabled={!from && !to} aria-label="Swap From and To"><ArrowUpDown size={14} />Swap</button>
        </div>
        <div className="field"><label>To</label>
          <EnvSelect items={toItems} value={to} onPick={(id) => { setTo(id); }} label="To" testid="move-to" placeholder="Choose where it goes" hint={toHint} autoFocus={!!from && !to} /></div>
        <div className="field"><label htmlFor="mv-amt">Amount</label>
          <MoneyInput value={amt} onChange={setAmt} invalid={!!problem && cents > 0} autoFocus={!!from && !!to} />
          <div className="row between small" style={{ marginTop: 6, gap: 8, flexWrap: 'wrap' }}>
            <span className="muted" data-testid="move-max">{from ? `Max ${money(max)} available` : 'Choose a source to see the max'}</span>
            <span className="row gap8">
              {to && shortage > 0 && max > 0 && <button type="button" className="chip" data-testid="move-shortfall" onClick={() => setAmt(centsToInput(Math.min(shortage, max)))}>Shortfall · {money(Math.min(shortage, max))}</button>}
              {max > 0 && <button type="button" className="chip" data-testid="move-all" onClick={() => setAmt(centsToInput(max))}>Move all</button>}
            </span>
          </div>
          {problem && <div className="small neg" role="alert" data-testid="move-error" style={{ marginTop: 6 }}>{problem}</div>}
        </div>
        {from && to && from !== to && cents > 0 && (
          <div className="card pad fade-in" style={{ background: 'var(--surface-2)', boxShadow: 'none' }} data-testid="move-preview">
            {[from, to].map((id, i) => (
              <div className="row between small" key={id} style={{ padding: '3px 0' }}>
                <span>{nameOf(id)}</span><span className="num"><span className="muted">{money(availOf(id))}</span> → <b>{money(availOf(id) + (i === 0 ? -cents : cents))}</b></span>
              </div>
            ))}
          </div>
        )}
        <button type="submit" style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />
        <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => openModal({ type: 'assign' })}>Assign to several categories at once…</button>
      </form>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════
// Category detail
// ═══════════════════════════════════════════════════════════
export function CategorySheet({ id }: { id: string }) {
  const { data, closeModal, openModal, setTarget, setBillPaused, removeBill, setCategoryArchived, toast } = useStore();
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
          <div className="small" style={{ marginTop: 6 }}><b className="num">{money(bill.amount)}</b> {bill.recurring ? bill.period === 'Bi-Weekly' ? 'every 2 weeks' : bill.period.toLowerCase() : 'one time'} · {bill.paused ? 'paused — not in upcoming bills or forecasts' : bill.date ? `next due ${fmtDate(bill.date)}` : 'no due date'}</div>
          <div className="row gap8" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={() => openModal({ type: 'bill-edit', billId: bill.id })}><Pencil />Edit bill</button>
            <button className="btn sm" disabled={busyBill} onClick={async () => {
              setBusyBill(true);
              const resume = bill.paused;
              const date = resume && bill.date && bill.recurring ? rollForward({ recurring: true, period: bill.period, anchor: bill.anchor, date: bill.date, paid: bill.paid }, bill.date, data.today) : undefined;
              const ok = await setBillPaused(bill.id, !resume, date); // changes only the paused flag (and the resume date), never the rest of the bill
              setBusyBill(false); if (ok) toast(resume ? `${bill.name} resumed` : `${bill.name} paused · history and debt kept`);
            }}>{bill.paused ? 'Resume bill' : 'Pause bill'}</button>
            <button className="btn sm" data-testid="archive-bill" onClick={() => openModal({ type: 'bill-archive', billId: bill.id })}><Archive />Archive bill</button>
            {!confirmRemove && <button className="btn sm danger" onClick={() => setConfirmRemove(true)}><Trash />Remove bill</button>}
          </div>
          {confirmRemove && <div className="fade-in" style={{ marginTop: 10 }}><Callout tone="warn">Remove the schedule from <b>{cat.name}</b>? The envelope, its money, transactions, past payments{cat.isDebt ? ' and the debt balance' : ''} all stay. Only the due date and reminders go away.
            <div className="row gap8" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => setConfirmRemove(false)}>Keep bill</button><button className="btn sm danger" disabled={busyBill} onClick={async () => { setBusyBill(true); const ok = await removeBill(id); setBusyBill(false); if (ok) { setConfirmRemove(false); toast(`${cat.name} is now funding-only · nothing deleted`); } }}>Yes, remove bill</button></div></Callout></div>}
        </> : <>
          <div className="small muted" style={{ marginTop: 6 }}>No payment schedule — this category only holds budget money. It won’t appear in upcoming bills or the forecast.</div>
          <button className="btn sm" style={{ marginTop: 10 }} onClick={() => openModal({ type: 'bill-schedule', categoryId: id })}><Plus />Add scheduled bill</button>
        </>}
      </div>
      {!cat.cardAccountId && (
        <div className="card pad" style={{ boxShadow: 'none', marginTop: 12 }} data-testid="category-archive">
          <div className="eyebrow">Archive category</div>
          {(() => {
            const why = bill ? 'It still has an active scheduled bill — archive the bill first.' : env.avail !== 0 ? `It still holds ${money(env.avail)}. Move that money first so nothing is lost or silently reassigned.` : cat.isDebt && (cat.debtBalance ?? 0) > 0 ? 'It tracks a debt that is still owed.' : '';
            return <>
              <div className="small muted" style={{ marginTop: 6 }}>{why || 'Hides it from your budget and from new transactions. Its history, allocations and transactions are kept, and you can restore it any time.'}</div>
              <div className="row gap8" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                {env.avail !== 0 && !bill && <button className="btn sm" onClick={() => openModal({ type: 'move', ...(env.avail > 0 ? { from: id } : { to: id, amount: -env.avail }) })}><ArrowLeftRight />Move money</button>}
                <button className="btn sm" disabled={!!why || busyBill} onClick={async () => { setBusyBill(true); const ok = await setCategoryArchived(id, true); setBusyBill(false); if (ok) { toast(`${cat.name} archived · history kept`, () => { void setCategoryArchived(id, false); }); closeModal(); } }}><Archive />Archive category</button>
              </div></>;
          })()}
        </div>
      )}
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
// Archive a bill (history kept)
// ═══════════════════════════════════════════════════════════
export function BillArchiveSheet({ billId }: { billId: string }) {
  const { data, closeModal, openModal, archiveBill, restoreBill, toast } = useStore();
  const bill = data.bills.find((b) => b.id === billId);
  const cat = data.categories.find((c) => c.id === billId);
  const [also, setAlso] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!bill || !cat) return <Sheet title="Bill not found" onClose={closeModal}><div className="small muted">This bill no longer exists or is already archived.</div></Sheet>;
  const env = envelope(data, billId);
  // Transactions in this category that are not payments of this bill (another payee, not confirmed through the bill).
  const others = data.txns.filter((t) => !t.billId && (t.categoryId === billId || t.splits?.some((s) => s.categoryId === billId)) && t.payee.trim().toLowerCase() !== bill.payee.trim().toLowerCase());
  const owes = cat.isDebt && (cat.debtBalance ?? 0) > 0;
  const blocker = env.avail !== 0 ? `${cat.name} still holds ${money(env.avail)}. Move it first if you want to archive the category too.` : owes ? `${cat.name} tracks a debt that is still owed, so the category stays.` : others.length > 0 ? `${others.length} other ${others.length === 1 ? 'transaction uses' : 'transactions use'} this category, so it stays.` : '';
  const go = async () => {
    setSaving(true);
    const withCat = also && !blocker;
    if (await archiveBill(billId, withCat)) { toast(`${bill.name} archived · history kept`, () => { void restoreBill(billId, withCat); }); closeModal(); } else setSaving(false);
  };
  return (
    <Sheet title="Archive bill" sub={bill.name} onClose={closeModal}
      footer={<><button className="btn" onClick={closeModal}>Cancel</button><button className="btn primary" disabled={saving} onClick={go}>{saving ? 'Archiving…' : 'Archive bill'}</button></>}>
      <div className="stack gap12">
        <Callout icon={<Info />}>Archived bills leave your bill lists, reminders and forecasts. Every past payment, transaction and the original name are kept, and you can restore it from <b>Bills → Archived bills</b>. Nothing is deleted.</Callout>
        {bill.recurring && <div className="small muted">Its repeating schedule stops while archived. Restoring moves it to its next unpaid due date.</div>}
        {!bill.recurring && bill.date && !bill.paid[bill.date] && <div className="small muted">{bill.name} has an unpaid due date ({fmtDate(bill.date)}). It will stop counting as upcoming or overdue until you restore it.</div>}
        <div className="card pad" style={{ boxShadow: 'none' }} data-testid="archive-category-option">
          <label className="row gap12" style={{ alignItems: 'flex-start', cursor: blocker ? 'default' : 'pointer' }}>
            <input type="checkbox" checked={also && !blocker} disabled={!!blocker} onChange={(e) => setAlso(e.target.checked)} style={{ marginTop: 3 }} />
            <span><b>Also archive the “{cat.name}” category</b><div className="small muted" style={{ marginTop: 2 }}>{blocker || 'Nothing else uses it and it holds no money. It leaves your budget and new-transaction choices; its history stays.'}</div></span>
          </label>
          {env.avail !== 0 && <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => openModal({ type: 'move', ...(env.avail > 0 ? { from: billId } : { to: billId, amount: -env.avail }) })}><ArrowLeftRight />Move money</button>}
        </div>
      </div>
    </Sheet>
  );
}

// ═══════════════════════════════════════════════════════════
// Bill
// ═══════════════════════════════════════════════════════════
export function BillSheet({ billId, date }: { billId: string; date: string }) {
  const { data, closeModal, openModal, payBill, unpayBill, toast } = useStore();
  const bill = data.bills.find((b) => b.id === billId)!;
  const occ = billOccurrences(data, date, date).find((o) => o.bill.id === billId);
  const requestId = useRef(newRequestId()); // one id per sheet: a double-tap or retry can never record the payment twice
  const liquid = data.accounts.filter((a) => a.type !== 'credit');
  const [tab, setTab] = useState<'pay' | 'link' | 'outside'>('pay');
  const [amt, setAmt] = useState(bill ? centsToInput(bill.amount) : '');
  const [paidOn, setPaidOn] = useState(data.today);
  const [acctId, setAcctId] = useState(liquid.find((a) => a.type === 'checking')?.id ?? liquid[0]?.id ?? '');
  const [settle, setSettle] = useState(false);
  const [linkId, setLinkId] = useState('');
  const [saving, setSaving] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [alsoDelete, setAlsoDelete] = useState(false);
  if (!bill || !occ) return <Sheet title="Bill not found" onClose={closeModal}><div className="small muted">This bill is no longer scheduled.</div></Sheet>;
  const cat = data.categories.find((c) => c.id === bill.categoryId);
  const env = cat ? envelope(data, cat.id) : null;
  const n = diffDays(date, data.today);
  const paidTxnId = bill.paid[occ.key];
  const paidTxn = paidTxnId && paidTxnId !== 'manual' ? data.txns.find((t) => t.id === paidTxnId) : undefined;
  const latestPaid = Object.keys(bill.paid).sort().pop();
  const isOldest = !!bill.date && date === bill.date;
  const statusPill = occ.paid ? <StatusPill status="ok">Paid</StatusPill> : n < 0 ? <StatusPill status="late">{-n} days overdue</StatusPill> : n <= 3 ? <StatusPill status="warn">Due {relDay(date).toLowerCase()}</StatusPill> : <StatusPill status="muted">{relDay(date)}</StatusPill>;
  const cents = toCents(amt);
  const partial = tab !== 'link' && cents > 0 && cents < bill.amount;
  const toCard = !!bill.toAccountId;
  const a = data.accounts.find((x) => x.id === acctId);
  const debtNow = cat?.isDebt ? cat.debtBalance ?? 0 : null;
  const candidates = data.txns.filter((t) => !t.scheduled && !t.billId && !t.adjustment && (t.type === 'expense' || t.type === 'transfer') && t.categoryId === bill.categoryId && diffDays(data.today, t.date) <= 120).slice(0, 12);
  const linked = data.txns.find((t) => t.id === linkId);
  const payCents = tab === 'link' ? linked?.amount ?? 0 : cents;
  const next = bill.recurring && bill.date ? nextDueDate(bill.period, bill.anchor ?? bill.date, bill.date) : null;
  const valid = tab === 'pay' ? cents > 0 && !!a && paidOn <= data.today : tab === 'link' ? !!linked : cents > 0;

  const confirm = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const r = await payBill({ billId, due: date, mode: tab === 'pay' ? 'post' : tab === 'link' ? 'link' : 'external', amount: tab === 'link' ? undefined : cents, accountId: tab === 'pay' ? acctId : undefined, paidOn: tab === 'link' ? undefined : paidOn, transactionId: tab === 'link' ? linkId : undefined, settle: partial ? settle : true, requestId: requestId.current });
    if (!r) { setSaving(false); return; }
    toast(r.settled ? `${bill.name} paid · ${money(r.amount)}` : `${money(r.amount)} recorded toward ${bill.name} · still due`, () => { void unpayBill(billId, date, r.created && r.settled); });
    closeModal();
  };

  // ── already paid: show it, offer an undo ──
  if (occ.paid) {
    if (undoing) {
      return (
        <Sheet title="Undo this payment?" sub={bill.name} onClose={closeModal}
          footer={<><button className="btn" onClick={() => setUndoing(false)}>Keep it</button>
            <button className="btn primary" disabled={saving} onClick={async () => { setSaving(true); if (await unpayBill(billId, date, !!paidTxn && alsoDelete)) { toast(`${bill.name} is due again on ${fmtDate(date)}`); closeModal(); } else setSaving(false); }}>Undo payment</button></>}>
          <div className="stack gap12">
            <div className="small">The due date goes back to {fmtDate(date)}{bill.isDebt ? ' and the amount owed is restored' : ''}.</div>
            {paidTxn && <label className="row gap12" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={alsoDelete} onChange={(e) => setAlsoDelete(e.target.checked)} style={{ marginTop: 3 }} /><span>Also delete the {money(paidTxn.amount)} transaction<div className="small muted">Leave unticked if the money really was spent.</div></span></label>}
          </div>
        </Sheet>
      );
    }
    return (
      <Sheet title={bill.name} onClose={closeModal}
        footer={<>{date === latestPaid && <button className="btn" onClick={() => setUndoing(true)}>Undo payment</button>}{paidTxn ? <button className="btn primary" onClick={() => openModal({ type: 'txn', mode: 'view', id: paidTxn.id })}>View transaction</button> : <button className="btn primary" onClick={closeModal}>Done</button>}</>}>
        <div style={{ textAlign: 'center', padding: '4px 0 18px' }}><div className="amt-hero num"><Money v={bill.amount} /></div>
          <div style={{ marginTop: 10, display: 'flex', gap: 6, justifyContent: 'center' }}>{statusPill}<StatusPill status="muted">{fmtDate(date, 'long')}</StatusPill></div></div>
        <Callout icon={<CircleCheck />}>{paidTxn ? <>Paid {fmtDate(paidTxn.date)} from {data.allAccounts.find((x) => x.id === paidTxn.accountId)?.name}.</> : 'Marked paid outside your tracked accounts — no transaction was recorded.'}</Callout>
      </Sheet>
    );
  }

  // ── older missed payments come first ──
  if (!isOldest && bill.date) {
    return (
      <Sheet title={bill.name} sub={`Due ${fmtDate(date, 'long')}`} onClose={closeModal}
        footer={<><button className="btn" onClick={closeModal}>Close</button><button className="btn primary" onClick={() => openModal({ type: 'bill', billId, date: bill.date! })}>Pay {fmtDate(bill.date)} first</button></>}>
        <Callout tone="warn">{bill.name} has an earlier unpaid date ({fmtDate(bill.date)}). Payments are recorded oldest first so none is skipped.</Callout>
      </Sheet>
    );
  }

  const rows: { k: string; before: string; after: string }[] = [];
  if (tab === 'pay' && a && cents > 0) rows.push({ k: a.name, before: money(a.balance), after: money(a.balance - cents) });
  if (tab !== 'link' && env && cents > 0) rows.push({ k: `${cat?.name} set aside`, before: money(env.avail), after: money(tab === 'pay' ? env.avail - cents : env.avail) });
  if (tab === 'link' && linked) rows.push({ k: 'Transaction', before: 'recorded', after: 'counted toward this bill' });
  if (debtNow != null && payCents > 0) rows.push({ k: 'Amount owed', before: money(debtNow), after: money(Math.max(0, debtNow - payCents)) });
  if (toCard && tab === 'pay' && cents > 0) { const card = data.allAccounts.find((x) => x.id === bill.toAccountId); if (card) rows.push({ k: card.name, before: money(card.balance), after: money(card.balance - cents) }); }
  if ((!partial || settle) && next && valid) rows.push({ k: 'Next due', before: fmtDate(date), after: fmtDate(next) });

  return (
    <Sheet title={bill.name} sub={`Due ${fmtDate(date, 'long')}`} onClose={closeModal} wide
      footer={<button className="btn primary lg" disabled={!valid || saving} onClick={confirm}>{saving ? 'Saving…' : tab === 'pay' ? `Pay ${cents > 0 ? money(cents) : ''}` : tab === 'link' ? 'Link this transaction' : 'Mark as paid'}</button>}>
      <div style={{ textAlign: 'center', padding: '0 0 14px' }}>
        <div className="amt-hero num"><Money v={bill.amount} /></div>
        <div style={{ marginTop: 8, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>{statusPill}{!occ.future && env && occ.short > 0 && <StatusPill status="warn">{money(occ.short, { cents: false })} not set aside</StatusPill>}</div>
      </div>
      <Seg block value={tab} onChange={setTab} options={[{ v: 'pay', label: 'Record payment' }, { v: 'link', label: 'Already recorded' }, { v: 'outside', label: 'Paid elsewhere' }]} />

      {tab === 'pay' && (
        <div className="stack gap12" style={{ marginTop: 14 }}>
          <div className="row gap12"><div className="field grow"><label htmlFor="pay-amt">Amount</label><MoneyInput id="pay-amt" value={amt} onChange={setAmt} autoFocus /></div>
            <div className="field grow"><label htmlFor="pay-date">Date</label><input id="pay-date" type="date" className="input" value={paidOn} max={data.today} onChange={(e) => setPaidOn(e.target.value)} /></div></div>
          <div className="field"><label>Pay from</label><div className="chips">{liquid.map((x) => <button key={x.id} className="chip" aria-pressed={acctId === x.id} onClick={() => setAcctId(x.id)}>{x.name}</button>)}</div></div>
        </div>
      )}
      {tab === 'link' && (
        <div className="stack" style={{ marginTop: 14 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>Pick the transaction you already recorded for this bill. Nothing new is created.</div>
          {candidates.length === 0 ? <div className="card pad small muted" style={{ boxShadow: 'none' }}>No unlinked {cat?.name} transactions from the last 4 months. If you recorded it under another category, change its category first.</div> : candidates.map((t) => (
            <label key={t.id} className="rowx" style={{ cursor: 'pointer' }}><input type="radio" name="lk" checked={linkId === t.id} onChange={() => setLinkId(t.id)} /><div className="grow"><div className="li-title">{t.payee}</div><div className="li-sub">{fmtDate(t.date)} · {data.allAccounts.find((x) => x.id === t.accountId)?.name}</div></div><Money v={t.amount} className="amt-md" /></label>
          ))}
        </div>
      )}
      {tab === 'outside' && (
        <div className="stack gap12" style={{ marginTop: 14 }}>
          <div className="small muted">Use this if it was paid from an account you don’t track here. No transaction is recorded and your balances don’t change.</div>
          <div className="row gap12"><div className="field grow"><label htmlFor="pay-amt">Amount paid</label><MoneyInput id="pay-amt" value={amt} onChange={setAmt} /></div>
            <div className="field grow"><label htmlFor="pay-date">Date</label><input id="pay-date" type="date" className="input" value={paidOn} max={data.today} onChange={(e) => setPaidOn(e.target.value)} /></div></div>
        </div>
      )}
      {partial && <label className="row gap12" style={{ alignItems: 'flex-start', marginTop: 12 }}><input type="checkbox" checked={settle} onChange={(e) => setSettle(e.target.checked)} style={{ marginTop: 3 }} /><span>Count this as the full payment<div className="small muted">Unticked, it is recorded but {bill.name} stays due for the rest ({money(bill.amount - cents)}).</div></span></label>}
      {rows.length > 0 && (
        <div className="card pad num" style={{ boxShadow: 'none', background: 'var(--surface-2)', marginTop: 14 }} data-testid="pay-preview">
          {rows.map((r) => <div className="row between small" key={r.k} style={{ padding: '3px 0', gap: 10 }}><span>{r.k}</span><span><span className="muted">{r.before}</span> → <b>{r.after}</b></span></div>)}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}><button className="btn ghost sm" onClick={() => openModal({ type: 'bill-edit', billId })}><Pencil />Edit bill</button></div>
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
  const acct = data.allAccounts.find((a) => a.id === inc.accountId)!;
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
          {cents > 0 && cents !== inc.amount && <div className="small" data-testid="receipt-diff" style={{ marginTop: -6 }}>That is <b className="num">{money(Math.abs(cents - inc.amount))} {cents < inc.amount ? 'less' : 'more'}</b> than the {money(inc.amount)} you expected. Only the amount you enter here is recorded.</div>}
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

export function AccountEditSheet({ id }: { id: string }) {
  const { data, closeModal, updateAccount, archiveAccount, restoreAccount, deleteAccount, toast } = useStore();
  const a = data.allAccounts.find((x) => x.id === id);
  const [name, setName] = useState(a?.name ?? '');
  const [type, setType] = useState<Account['type']>(a?.type ?? 'checking');
  const [limit, setLimit] = useState(a?.limit ? centsToInput(a.limit) : '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState('');
  if (!a) return null;
  const used = data.txns.some((t) => t.accountId === a.id || t.toAccountId === a.id);
  const linked = used || data.reconciliations.some((r) => r.accountId === a.id) || data.incomes.some((i) => i.accountId === a.id) || !!a.paymentCategoryId
    || data.bills.some((b) => b.accountId === a.id || b.toAccountId === a.id) || !!data.credit.meta[a.id] || data.credit.reported.some((r) => r.accountId === a.id);
  const credit = type === 'credit';
  const dirty = name.trim() !== a.name || type !== a.type || (credit && toCents(limit) !== (a.limit ?? 0));
  const settled = a.balance === 0;
  return (
    <Sheet title={a.archived ? 'Archived account' : 'Edit account'} sub={a.archived ? 'Hidden from lists and pickers. All history is kept.' : 'Renaming never changes transactions, transfers, bills or reconciliations.'} onClose={closeModal}
      footer={a.archived
        ? <button className="btn primary lg" disabled={saving} onClick={async () => { setSaving(true); if (await restoreAccount(a.id)) { toast(`${a.name} restored`); closeModal(); } else setSaving(false); }}>Restore account</button>
        : <button className="btn primary lg" disabled={!name.trim() || !dirty || saving} onClick={async () => { setSaving(true); if (await updateAccount(a.id, { name: name.trim(), type: used ? undefined : type, limit: credit ? toCents(limit) || null : undefined })) { toast('Saved'); closeModal(); } else setSaving(false); }}>Save changes</button>}>
      <div className="stack gap16">
        {!a.archived && <>
          <div className="field"><label htmlFor="ae-n">Name</label><input id="ae-n" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
          <div className="field"><label>Type</label><div className="chips">{(['checking', 'savings', 'cash', 'credit'] as const).map((t) => <button key={t} className="chip" aria-pressed={type === t} disabled={used} onClick={() => setType(t)} style={{ textTransform: 'capitalize' }}>{t === 'credit' ? 'Credit card' : t}</button>)}</div>
            {used && <div className="xs muted">The type is locked because this account has transactions.</div>}</div>
          {credit && <div className="field"><label>Credit limit (optional)</label><MoneyInput value={limit} onChange={setLimit} /></div>}
        </>}
        <div className="card pad" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
          <div className="li-title">{a.archived ? 'Remove it for good' : 'No longer using it?'}</div>
          {!a.archived && <>
            <div className="small muted" style={{ margin: '4px 0 10px' }}>{settled ? 'Archiving hides it everywhere but keeps every transaction, transfer and reconciliation. You can restore it any time.' : `It still holds ${money(a.balance)}. Bring the balance to $0 first (record a transfer or reconcile), then archive it.`}</div>
            <button className="btn" disabled={!settled || saving} onClick={async () => { setSaving(true); if (await archiveAccount(a.id)) closeModal(); else setSaving(false); }}>Archive account</button>
          </>}
          {linked
            ? <div className="xs muted" style={{ marginTop: 10 }}>Permanent deletion is only offered for accounts with no history. This one has history, so archive it instead.</div>
            : !deleting
              ? <div style={{ marginTop: 10 }}><div className="xs muted" style={{ marginBottom: 6 }}>This account has no transactions, bills or credit data, so it can be deleted permanently.</div><button className="btn danger" onClick={() => setDeleting(true)}><Trash />Delete permanently…</button></div>
              : <div style={{ marginTop: 10 }}><div className="small" style={{ marginBottom: 6 }}>This cannot be undone. Type <b>{a.name}</b> to confirm.</div>
                  <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type the account name to confirm" />
                  <div className="row gap8" style={{ marginTop: 8 }}><button className="btn" onClick={() => { setDeleting(false); setTyped(''); }}>Cancel</button>
                    <button className="btn danger" disabled={typed.trim() !== a.name || saving} onClick={async () => { setSaving(true); if (await deleteAccount(a.id)) { toast('Account deleted'); closeModal(); location.hash = '/accounts'; } else setSaving(false); }}>Delete forever</button></div></div>}
        </div>
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
      <div className="list">{link('/accounts', 'Accounts', <Landmark />)}{link('/insights', 'Insights', <Eye />)}{link('/insights/forecast', 'Forecast', <Gauge />)}{link('/insights/credit', 'Credit', <Gauge />)}{link('/settings', 'Settings', <Wallet />)}
        <button className="li hover" style={{ padding: '14px 4px' }} onClick={() => openModal({ type: 'category-add' })}><span className="li-ico"><Plus /></span><span className="li-title grow">New category or bill</span><ArrowRight size={16} className="muted" /></button>
        <button className="li hover" style={{ padding: '14px 4px' }} onClick={() => openModal({ type: 'cutover' })}><span className="li-ico"><Scale /></span><span className="li-title grow">Set opening balances</span><ArrowRight size={16} className="muted" /></button></div>
      <div style={{ marginTop: 18 }}><div className="label" style={{ marginBottom: 8 }}>Appearance</div><ThemeSwitch theme={theme} setTheme={setTheme} /></div>
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
    case 'bill-archive': return <BillArchiveSheet key={modal.billId} billId={modal.billId} />;
    case 'bill-edit': return <BillEditSheet key={modal.billId} billId={modal.billId} />;
    case 'bill': return <BillSheet key={`${modal.billId}-${modal.date}`} billId={modal.billId} date={modal.date} />;
    case 'income': return <IncomeSheet key={`${modal.mode}-${modal.id}`} mode={modal.mode} id={modal.id} />;
    case 'reconcile': return <ReconcileSheet key={modal.id} id={modal.id} />;
    case 'cutover': return <CutoverSheet key={modal.id ?? 'all'} id={modal.id} />;
    case 'account-add': return <AccountAddSheet />;
    case 'account-edit': return <AccountEditSheet key={modal.id} id={modal.id} />;
    case 'credit-score': return <CreditScoreSheet key={`${modal.id ?? 'new'}-${modal.bureau ?? ''}-${modal.model ?? ''}`} id={modal.id} bureau={modal.bureau} model={modal.model} />;
    case 'credit-card': return <CreditCardSheet key={modal.accountId} accountId={modal.accountId} />;
    case 'credit-reported': return <CreditReportedSheet key={`${modal.id ?? 'new'}-${modal.accountId ?? ''}`} id={modal.id} accountId={modal.accountId} />;
    case 'debt-edit': return <DebtEditSheet key={modal.categoryId} categoryId={modal.categoryId} />;
    case 'menu': return <MenuSheet />;
    default: return null;
  }
}
void TriangleAlert; void monthKey; void FlaskConical; void StickyNote; void Split; void Trash; void Plus; void diffDays; void relDay; void envelope; void allEnvelopes; void billOccurrences;

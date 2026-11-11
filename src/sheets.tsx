import { useMemo, useRef, useState, useEffect, type ReactNode } from 'react';
import { Archive, ArrowLeftRight, ArrowRight, ArrowUpDown, ChevronDown, Bell, Check, CircleCheck, Download, Eye, FlaskConical, Info, Landmark, LogOut, ListChecks, Pencil, Plus, Scale, Split, StickyNote, Trash, TriangleAlert, Wallet } from 'lucide-react';
import { useStore } from './store';
import {
  allEnvelopes, envelope, readyToAssign, staleness, billOccurrences, drift, rollForward, nextDueDate, paidTowardCurrent, lastTransferPair, matchBillPayment, type PayMatch, type Account, type Bill, type BillPeriod, type Category, type Txn, type Income, type Repeat as Rep,
} from './data';
import { addDays, centsToInput, cn, diffDays, fmtDate, money, monthKey, relDay, sum, toCents, plural, todayISO, parseSignedCents, signedInput } from './lib';
import { SearchSelect, type PickOption } from './pickers';
import { CatIcon, Callout, Money, Seg, Sheet, StatusPill, ThemeSwitch } from './ui';
import { exportEverything, newRequestId } from './db';
import { ItemSheet, ItemAddSheet, ItemEditSheet, ArchiveItemSheet } from './itemSheets';
import { CreditScoreSheet, CreditCardSheet, CreditReportedSheet } from './creditSheets';
import { Gauge, Moon, Sun } from 'lucide-react';

const go = (path: string) => { location.hash = path; };

export function MoneyInput({ value, onChange, autoFocus, big, placeholder = '0.00', id, invalid, signed }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; big?: boolean; placeholder?: string; id?: string; invalid?: boolean; signed?: boolean }) {
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 13, top: big ? 11 : 10, color: 'var(--ink-4)', fontWeight: 560 }}>$</span>
      <input id={id} className="input num" inputMode={signed ? 'text' : 'decimal'} autoFocus={autoFocus} placeholder={placeholder} value={value} aria-invalid={invalid}
        onChange={(e) => onChange(signed ? signedInput(e.target.value) : e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
        style={{ paddingLeft: 26, textAlign: 'right', fontWeight: 600, ...(invalid ? { borderColor: 'var(--neg)' } : {}) }} />
    </div>
  );
}

/** Accounts as chips when there are few, as a clean menu when there are many. */
/** An account's recorded balance, exactly as the Accounts page computes it (a card shows what is owed). Nothing "available to spend" is invented. */
export const balText = (a: Account) => (a.type === 'credit' ? `${money(a.balance)} owed` : money(a.balance));
const ACCT_KIND: Record<string, string> = { checking: 'Checking', savings: 'Savings', cash: 'Cash', credit: 'Credit card' };
export function AccountPick({ accounts, value, onPick, label, testid, asChips }: { accounts: Account[]; value: string; onPick: (id: string) => void; label: string; testid?: string; asChips?: boolean }) {
  if (asChips ?? accounts.length <= 4) return <div className="chips" role="group" aria-label={label}>{accounts.map((a) => <button type="button" key={a.id} className="chip" aria-pressed={value === a.id} onClick={() => onPick(a.id)}>{a.name}<span className={cn('chip-bal num', a.balance < 0 && 'neg')}>{balText(a)}</span></button>)}</div>;
  const options: PickOption[] = accounts.map((a) => ({ id: a.id, label: a.name, sub: ACCT_KIND[a.type] ?? undefined, right: <span className={a.balance < 0 ? 'neg' : undefined}>{balText(a)}</span> }));
  return <SearchSelect options={options} value={value} onPick={onPick} label={label} testid={testid ?? `acct-${label.toLowerCase().replace(/\W+/g, '-')}`} placeholder="Choose an account…" searchPlaceholder="Search accounts…" />;
}
const groupCats = (cats: Category[], groups: { id: string; name: string }[]) => groups.map((g) => ({ g, items: cats.filter((c) => c.groupId === g.id && !c.hidden) })).filter((x) => x.items.length);

// ═══════════════════════════════════════════════════════════
// Transaction: add / view / edit
// ═══════════════════════════════════════════════════════════
export function TxnSheet({ mode: initialMode, id, prefill }: { mode: 'add' | 'view' | 'edit'; id?: string; prefill?: Partial<Txn> }) {
  const { data, closeModal, addTxn, updateTxn, deleteTxn, payBill, unpayBill, unpayPartial, toast, openModal } = useStore();
  const existing = id ? data.txns.find((t) => t.id === id) : undefined;
  const [mode, setMode] = useState(initialMode);
  const [confirmDel, setConfirmDel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adv, setAdv] = useState<{ m: Extract<PayMatch, { kind: 'ask' }>; id: string; t: Omit<Txn, 'id'> } | null>(null);
  const [payChoice, setPayChoice] = useState<'partial' | 'full' | 'none'>('none');

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
  // A new transfer starts from the last SAVED transfer's From/To (never from an unsaved or canceled form). Anything chosen by hand is never overwritten.
  const xferStart = (current: string) => { const p = lastTransferPair(data); const from = ctxAcct ?? p.from ?? current; return { from, to: p.to && p.to !== from ? p.to : p.from && p.from !== from ? p.from : '' }; };
  const startX = initialMode === 'add' && seed.type === 'transfer' && !seed.toAccountId ? xferStart(seed.accountId ?? ctxAcct ?? defaultAcct) : null;
  const [accountId, setAccountId] = useState(startX?.from ?? seed.accountId ?? ctxAcct ?? defaultAcct);
  const [toAccountId, setToAccountId] = useState(startX?.to ?? seed.toAccountId ?? '');
  const [xferTouched, setXferTouched] = useState(initialMode !== 'add' || !!seed.toAccountId);
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
  const allCatsBtn = useRef<HTMLButtonElement>(null);
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
  // The best match is highlighted as soon as you start typing; nothing is replaced until you accept it (Tab, Enter or a click).
  const sugOpen = focusPayee && type === 'expense' && suggestions.length > 0;
  const activeSug = !sugOpen ? -1 : hiSug >= 0 ? Math.min(hiSug, suggestions.length - 1) : needle ? 0 : -1;
  const onPayeeChange = (v: string) => {
    setPayee(v); setHint(''); setHiSug(-1); setFocusPayee(true);
    if (type !== 'expense' || mode !== 'add') return;
    const exact = payeeStats.find((p) => p.name.toLowerCase() === v.trim().toLowerCase());
    if (exact) applyPayee(exact, false);
    else if (autoCat && !catTouched) { setCategoryId(''); setAutoCat(false); } // typed away from the match: undo the autofill
  };
  const onPayeeKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && focusPayee && suggestions.length > 0 && type === 'expense') { e.stopPropagation(); setFocusPayee(false); return; } // dismiss the list, keep the dialog
    if (!sugOpen) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHiSug(Math.min(suggestions.length - 1, activeSug + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHiSug(Math.max(0, activeSug - 1)); }
    else if (e.key === 'Enter' && activeSug >= 0) { e.preventDefault(); pickPayee(suggestions[activeSug]); } // accept; never submits the transaction
    else if (e.key === 'Tab' && !e.shiftKey && activeSug >= 0) pickPayee(suggestions[activeSug]); // accept, then Tab moves on to the next field as normal
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

  // Before/after for an account, using the same recorded balance as the Accounts page. When editing, the transaction's own effect is taken out first.
  const hypo: Txn = { id: 'preview', date, amount: cents, type, accountId, toAccountId: type === 'transfer' ? toAccountId : undefined, payee: '' };
  const balLine = (aid: string) => {
    const a = acct(aid); if (!a) return null;
    const base = a.balance - (existing && !existing.scheduled ? delta(a, existing) : 0);
    const after = cents > 0 && date <= data.today ? base + delta(a, hypo) : null;
    return <div className="xs muted num" data-testid="bal-preview" style={{ marginTop: 2 }}>{a.type === 'credit' ? 'Owed' : 'Recorded balance'} <span className={base < 0 ? 'neg' : undefined}>{money(base)}</span>{after != null && <> → <b className={after < 0 ? 'neg' : undefined} style={after < 0 ? undefined : { color: 'var(--ink-2)' }}>{money(after)}</b> after this</>}</div>;
  };
  const changeType = (v: Txn['type']) => {
    setType(v); setHint('');
    if (v === 'transfer' && mode === 'add' && !xferTouched) { const x = xferStart(accountId); setAccountId(x.from); setToAccountId(x.to); }
  };
  const pickFrom = (id: string) => { if (id === toAccountId) setToAccountId(accountId); setAccountId(id); setAcctTouched(true); setXferTouched(true); };
  const pickTo = (id: string) => { if (id === accountId) setAccountId(toAccountId); setToAccountId(id); setXferTouched(true); };
  const swapAccounts = () => { if (!toAccountId) return; const f = accountId; setAccountId(toAccountId); setToAccountId(f); setXferTouched(true); };
  const catOptions: PickOption[] = useMemo(() => groupCats(data.categories, data.groups).flatMap(({ g, items }) => items.map((c) => ({ id: c.id, label: c.name, sub: g.name, icon: <CatIcon k={c.icon} /> }))), [data.categories, data.groups]);

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
        const label = t.scheduled ? 'Scheduled' : t.type === 'income' ? 'Income added' : t.type === 'transfer' ? 'Transfer added' : 'Expense added';
        // Transaction-first payments: if this clearly pays a scheduled item, count it (through the same atomic path as every other payment);
        // if it might, ask; otherwise it stays an ordinary transaction. Nothing is ever marked paid on a guess.
        const m = matchBillPayment(data, t);
        if (m.kind === 'auto') {
          const r = await payBill({ billId: m.bill.id, due: m.due, mode: 'link', transactionId: newId, settle: true });
          if (r) { toast(`${label} · ${money(t.amount)} · counted as your ${m.bill.name} payment`, () => { void unpayBill(m.bill.id, m.due, true); }); closeModal(); setSaving(false); return; }
          // refused (for example another device already paid it): the transaction itself is kept as an ordinary one
        } else if (m.kind === 'ask') { setPayChoice(m.reason === 'partial' ? 'partial' : m.reason === 'backlog' ? 'full' : 'none'); setAdv({ m, id: newId, t }); setSaving(false); return; }
        toast(`${label} · ${money(t.amount)}`, () => { void deleteTxn(newId); }); closeModal();
      }
    }
    setSaving(false);
  };

  // ── it might be a payment toward a scheduled item: the user decides ──
  if (adv) {
    const { m, t, id: newId } = adv; const { bill } = m;
    const finish = () => { toast(`${t.type === 'transfer' ? 'Transfer' : 'Expense'} added · ${money(t.amount)}`, () => { void deleteTxn(newId); }); closeModal(); };
    const left = Math.max(0, m.remaining - t.amount);
    const opts: { v: 'partial' | 'full' | 'none'; title: string; text: string }[] = [
      ...(m.reason === 'partial' ? [{ v: 'partial' as const, title: 'A partial payment', text: `${money(t.amount)} toward ${bill.name}${m.paidBefore > 0 ? ` (${money(m.paidBefore)} already paid)` : ''}. ${money(left)} stays due.` }] : []),
      { v: 'full', title: m.reason === 'backlog' ? `Pay the oldest missed payment (${fmtDate(m.due)})` : 'Count it as the full payment', text: `Marks ${bill.name} paid${bill.recurring ? ' and moves it to its next due date' : ''}${bill.isDebt ? ', and lowers what you owe by the amount paid' : ''}.` },
      { v: 'none', title: 'No — just a transaction', text: 'Nothing about the schedule changes.' },
    ];
    const confirmPay = async () => {
      if (payChoice === 'none') { finish(); return; }
      setSaving(true);
      const r = await payBill({ billId: bill.id, due: m.due, mode: 'link', transactionId: newId, settle: payChoice === 'full' });
      if (!r) { setSaving(false); return; }
      toast(r.settled ? `${bill.name} marked paid · ${money(t.amount)}` : `${money(t.amount)} recorded toward ${bill.name} · ${money(Math.max(0, m.remaining - t.amount))} still due`,
        () => { void (r.settled ? unpayBill(bill.id, m.due, true) : unpayPartial(newId, true)); });
      closeModal();
    };
    return (
      <Sheet title={`Is this a payment toward ${bill.name}?`} sub={`${money(t.amount)} recorded · ${bill.name} ${money(bill.amount)} due ${fmtDate(m.due)}`} onClose={finish}
        footer={<><button className="btn" data-testid="keep-due" disabled={saving} onClick={finish}>Skip</button>
          <button className="btn primary" data-testid="advance-due" disabled={saving} onClick={confirmPay}>{payChoice === 'none' ? 'Keep as a transaction' : 'Confirm'}</button></>}>
        <div className="stack gap8" role="radiogroup" aria-label="What this transaction was">
          {opts.map((o) => (
            <label key={o.v} className="rowx" style={{ cursor: 'pointer', alignItems: 'flex-start' }}>
              <input type="radio" name="pay-choice" checked={payChoice === o.v} onChange={() => setPayChoice(o.v)} style={{ marginTop: 4 }} data-testid={`pay-choice-${o.v}`} />
              <div className="grow"><div className="li-title">{o.title}</div><div className="li-sub">{o.text}</div></div>
            </label>
          ))}
        </div>
        <div style={{ marginTop: 12 }}><Callout icon={<Info />}>Your transaction is kept whichever you choose.</Callout></div>
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
        {(t.adjustment || t.billId || t.incomeId) && <div style={{ marginTop: 14 }}><Callout>{t.adjustment ? 'Reconciliation adjustments are a permanent record and can’t be edited or deleted.' : t.billId ? `This transaction counts as ${t.billPartial ? 'a partial' : 'a'} payment toward ${data.bills.find((b) => b.id === t.billId)?.name ?? 'a scheduled item'}. Undo the payment from that item first if it needs changing.` : 'This transaction confirms received income, so it is locked.'}</Callout></div>}
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
        <Seg block value={type} onChange={changeType} options={[{ v: 'expense', label: 'Expense' }, { v: 'income', label: 'Income' }, { v: 'transfer', label: 'Transfer' }]} />
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
              onChange={(e) => onPayeeChange(e.target.value)} onKeyDown={onPayeeKey} role="combobox" aria-expanded={sugOpen} aria-autocomplete="list" aria-controls="payee-list" aria-activedescendant={activeSug >= 0 ? `payee-opt-${activeSug}` : undefined} />
            {focusPayee && type === 'expense' && (suggestions.length > 0) && (
              <div className="suggest" role="listbox" id="payee-list" aria-label="Payee suggestions">
                {suggestions.map((p, i) => (
                  <button type="button" key={p.name} id={`payee-opt-${i}`} role="option" tabIndex={-1} aria-selected={activeSug === i} style={activeSug === i ? { background: 'var(--accent-soft)' } : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => pickPayee(p)}>
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
              <button type="button" ref={allCatsBtn} className="chip" data-testid="all-categories" aria-expanded={showAllCats} aria-haspopup="listbox" onClick={() => setShowAllCats((v) => !v)}>{showAllCats ? 'Hide' : 'All categories'}</button>
            </div>
            {showAllCats && (
              <SearchSelect inline={{ onClose: () => setShowAllCats(false), anchor: allCatsBtn }} options={catOptions} value={categoryId} label="All categories" testid="cat-picker" placeholder="Choose a category" searchPlaceholder="Search categories…"
                onPick={(cid) => { setCategoryId(cid); setCatTouched(true); setAutoCat(false); }} />
            )}
          </div>
        )}
        {type === 'income' && <div style={{ marginTop: 14 }}><Callout>Income goes to <b>Ready to Assign</b> so you can give every dollar a job.</Callout></div>}

        <div className="field" style={{ marginTop: 16 }}>
          <label>{type === 'transfer' ? 'From' : type === 'income' ? 'Deposit to' : 'Account'}</label>
          <AccountPick accounts={type === 'transfer' ? data.accounts.filter((a) => a.id !== toAccountId) : data.accounts} value={accountId} label={type === 'transfer' ? 'From account' : 'Account'} testid="txn-account" asChips={data.accounts.length <= 4} onPick={pickFrom} />
          {balLine(accountId)}
        </div>

        {type === 'transfer' && (<>
          <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
            <button type="button" className="btn sm" data-testid="txn-swap" onClick={swapAccounts} disabled={!toAccountId} aria-label="Swap From and To accounts"><ArrowUpDown size={14} />Swap</button>
          </div>
          <div className="field" style={{ marginTop: 8 }}>
            <label>To</label>
            <AccountPick accounts={data.accounts.filter((a) => a.id !== accountId)} value={toAccountId} label="To account" testid="txn-to-account" asChips={data.accounts.length <= 4} onPick={pickTo} />
            {balLine(toAccountId)}
            {acct(toAccountId)?.type === 'credit' && <div className="xs muted">Counts toward the card’s payment envelope in your budget.</div>}
          </div></>
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
                        <div style={{ flex: 1.4, minWidth: 0 }}><SearchSelect options={catOptions} value={l.categoryId} label={`Split ${i + 1} category`} testid={`split-cat-${i}`} placeholder="Category…" searchPlaceholder="Search categories…" onPick={(cid) => setLines(lines.map((x, j) => (j === i ? { ...x, categoryId: cid } : x)))} /></div>
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
/** Budget-item picker for Move Money: the shared searchable picker (type, best match highlighted, ↑/↓, Enter accepts, Tab accepts and moves on, Esc closes). */
function EnvSelect({ items, value, onPick, label, testid, disabledIds, placeholder, hint, autoFocus }: { items: PickItem[]; value: string; onPick: (id: string) => void; label: string; testid: string; disabledIds?: (it: PickItem) => boolean; placeholder: string; hint?: (it: PickItem) => string; autoFocus?: boolean }) {
  const options: PickOption[] = items.map((i) => ({ id: i.id, label: i.name, sub: hint ? hint(i) : i.group, right: money(i.avail), disabled: !!disabledIds?.(i), keywords: i.group }));
  return <SearchSelect options={options} value={value} onPick={onPick} label={label} testid={testid} placeholder={placeholder} searchPlaceholder="Search categories…" autoOpen={!!autoFocus && !value} disabledLabel={(n, shown) => (shown ? 'Hide empty ones' : `Show ${n} with nothing to move`)} />;
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
          <EnvSelect items={fromItems} value={from} onPick={(id) => { setFrom(id); if (id === to) setTo(''); }} label="From" testid="move-from" placeholder="Choose where the money comes from" disabledIds={(i) => i.avail <= 0} hint={fromHint} autoFocus={!from} /></div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn sm" data-testid="move-swap" onClick={swap} disabled={!from && !to} aria-label="Swap From and To"><ArrowUpDown size={14} />Swap</button>
        </div>
        <div className="field"><label>To</label>
          <EnvSelect key={`to-${from}`} items={toItems} value={to} onPick={(id) => { setTo(id); }} label="To" testid="move-to" placeholder="Choose where it goes" hint={toHint} autoFocus={!!from && !to} /></div>
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
// Bill
// ═══════════════════════════════════════════════════════════
export function BillSheet({ billId, date }: { billId: string; date: string }) {
  const { data, closeModal, openModal, payBill, unpayBill, unpayPartial, toast } = useStore();
  const bill = data.bills.find((b) => b.id === billId)!;
  const [undoingPartial, setUndoingPartial] = useState<string | null>(null);
  const occ = billOccurrences(data, date, date).find((o) => o.bill.id === billId);
  const requestId = useRef(newRequestId()); // one id per sheet: a double-tap or retry can never record the payment twice
  const liquid = data.accounts.filter((a) => a.type !== 'credit');
  const [tab, setTab] = useState<'pay' | 'link' | 'outside'>('pay');
  const paidSoFar = bill ? paidTowardCurrent(data, bill) : 0; // earlier partial payments toward this obligation (display and default only)
  const [amt, setAmt] = useState(bill ? centsToInput(paidSoFar > 0 && paidSoFar < bill.amount ? bill.amount - paidSoFar : bill.amount) : '');
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
  const toCard = !!bill.toAccountId;
  const a = data.accounts.find((x) => x.id === acctId);
  const debtNow = cat?.isDebt ? cat.debtBalance ?? 0 : null;
  const candidates = data.txns.filter((t) => !t.scheduled && !t.billId && !t.adjustment && (t.type === 'expense' || t.type === 'transfer') && t.categoryId === bill.categoryId && diffDays(data.today, t.date) <= 120).slice(0, 12);
  const linked = data.txns.find((t) => t.id === linkId);
  const payCents = tab === 'link' ? linked?.amount ?? 0 : cents;
  const partial = payCents > 0 && paidSoFar + payCents < bill.amount; // still short of the full payment, counting only explicitly linked earlier partials
  const next = bill.recurring && bill.date ? nextDueDate(bill.period, bill.anchor ?? bill.date, bill.date) : null;
  const valid = tab === 'pay' ? cents > 0 && !!a && paidOn <= data.today : tab === 'link' ? !!linked : cents > 0;

  const confirm = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const r = await payBill({ billId, due: date, mode: tab === 'pay' ? 'post' : tab === 'link' ? 'link' : 'external', amount: tab === 'link' ? undefined : cents, accountId: tab === 'pay' ? acctId : undefined, paidOn: tab === 'link' ? undefined : paidOn, transactionId: tab === 'link' ? linkId : undefined, settle: partial ? settle : true, requestId: requestId.current });
    if (!r) { setSaving(false); return; }
    toast(r.settled ? `${bill.name} paid · ${money(r.amount)}` : `${money(r.amount)} recorded toward ${bill.name} · still due`,
      r.settled ? () => { void unpayBill(billId, date, r.created); } : r.transactionId ? () => { void unpayPartial(r.transactionId!, r.created); } : undefined);
    closeModal();
  };

  // ── undo one explicitly linked partial payment ──
  const partials = (data.billPartials ?? []).filter((p) => p.billId === billId && p.due === bill.date);
  const undoP = undoingPartial ? partials.find((p) => p.txnId === undoingPartial) : undefined;
  if (undoP && !occ.paid) {
    const pt = data.txns.find((t) => t.id === undoP.txnId);
    return (
      <Sheet title="Undo this partial payment?" sub={bill.name} onClose={closeModal}
        footer={<><button className="btn" onClick={() => setUndoingPartial(null)}>Keep it</button>
          <button className="btn primary" data-testid="undo-partial-confirm" disabled={saving} onClick={async () => { setSaving(true); if (await unpayPartial(undoP.txnId, alsoDelete)) { toast(`${money(undoP.amount)} no longer counts toward ${bill.name}`); closeModal(); } else setSaving(false); }}>Undo payment</button></>}>
        <div className="stack gap12">
          <div className="small">{money(undoP.amount)} stops counting toward {bill.name}{bill.isDebt ? ' and the amount owed is restored' : ''}. The remaining amount due goes back up.</div>
          {pt && <label className="row gap12" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={alsoDelete} onChange={(e) => setAlsoDelete(e.target.checked)} style={{ marginTop: 3 }} /><span>Also delete the {money(pt.amount)} transaction<div className="small muted">Leave unticked if the money really was spent.</div></span></label>}
        </div>
      </Sheet>
    );
  }

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
        {paidSoFar > 0 && paidSoFar < bill.amount && <div className="small muted" style={{ marginTop: 8 }} data-testid="paid-so-far">Paid so far <b className="num">{money(paidSoFar)}</b> · <b className="num">{money(bill.amount - paidSoFar)}</b> remaining</div>}
        {partials.length > 0 && <div className="group" style={{ marginTop: 10, textAlign: 'left' }} data-testid="partial-list">{partials.map((p) => { const pt = data.txns.find((t) => t.id === p.txnId); return (
          <div className="rowx" key={p.txnId}><div className="grow"><div className="li-title" style={{ fontSize: 14 }}>{pt?.payee ?? 'Payment'}</div><div className="li-sub">{pt ? fmtDate(pt.date) : ''} · partial payment</div></div><div className="amt-md num"><Money v={p.amount} /></div>
            <button className="btn sm" data-testid="undo-partial" onClick={() => { setAlsoDelete(false); setUndoingPartial(p.txnId); }}>Undo</button></div>); })}</div>}
      </div>
      <Seg block value={tab} onChange={setTab} options={[{ v: 'pay', label: 'Record payment' }, { v: 'link', label: 'Already recorded' }, { v: 'outside', label: 'Paid elsewhere' }]} />

      {tab === 'pay' && (
        <div className="stack gap12" style={{ marginTop: 14 }}>
          <div className="row gap12"><div className="field grow"><label htmlFor="pay-amt">Amount</label><MoneyInput id="pay-amt" value={amt} onChange={setAmt} autoFocus /></div>
            <div className="field grow"><label htmlFor="pay-date">Date</label><input id="pay-date" type="date" className="input" value={paidOn} max={data.today} onChange={(e) => setPaidOn(e.target.value)} /></div></div>
          <div className="field"><label>Pay from</label><AccountPick accounts={liquid} value={acctId} label="Pay from" onPick={setAcctId} /></div>
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
      {partial && <label className="row gap12" style={{ alignItems: 'flex-start', marginTop: 12 }}><input type="checkbox" checked={settle} onChange={(e) => setSettle(e.target.checked)} style={{ marginTop: 3 }} /><span>Count this as the full payment<div className="small muted">Unticked, it is recorded but {bill.name} stays due for the rest ({money(bill.amount - paidSoFar - payCents)}).</div></span></label>}
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
          {inc.date < data.today ? <StatusPill status="warn">Awaiting confirmation</StatusPill> : <StatusPill status="proj">Projected</StatusPill>}<StatusPill status="muted">{inc.date < data.today ? `Originally ${fmtDate(inc.date, 'long')}` : fmtDate(inc.date, 'long')}</StatusPill>
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
  // Signed: a checking account can be overdrawn, so -128.38 is a valid target. A card's "amount owed" is entered as a positive number.
  const typed = parseSignedCents(val);
  const actual = typed ?? 0;
  const entryError = val.trim() === '' || val.trim() === '-' ? '' : typed == null ? 'Enter an amount such as 1,250.00 or -128.38.' : credit && typed < 0 ? 'Enter what you owe as a positive number. (A card with a credit balance can’t be set here.)' : '';
  const entryOk = typed != null && !entryError;
  const diff = actual - a.balance;
  const st = staleness(a, data.today);
  const isExpense = credit ? diff > 0 : diff < 0;
  const rtaBefore = readyToAssign(data);
  const rtaAfter = credit ? rtaBefore : rtaBefore + diff;
  const dr = drift(a);

  return (
    <Sheet title={`Reconcile ${a.name}`} onClose={closeModal}
      footer={step === 1 ? <button className="btn primary lg" disabled={!entryOk} onClick={() => setStep(2)}>Preview difference</button>
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
              <input id="act" className="input num" inputMode={credit ? 'decimal' : 'text'} autoFocus placeholder="0.00" value={val} aria-invalid={!!entryError} aria-describedby={entryError ? 'act-err' : undefined}
                onChange={(e) => setVal(credit ? e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1') : signedInput(e.target.value))}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (entryOk) setStep(2); } }}
                style={{ height: 56, fontSize: 26, fontWeight: 620, paddingLeft: 32, letterSpacing: '-0.03em', ...(entryError ? { borderColor: 'var(--neg)' } : {}) }} />
            </div>
            {entryError && <div className="small neg" id="act-err" role="alert" style={{ marginTop: 6 }}>{entryError}</div>}
            {!credit && !entryError && <div className="xs muted" style={{ marginTop: 6 }}>Overdrawn? Enter a negative amount, like -128.38.</div>}
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
  const entered = list.filter((a) => vals[a.id] !== undefined && vals[a.id] !== '' && vals[a.id] !== '-' && parseSignedCents(vals[a.id]) != null && !(a.type === 'credit' && parseSignedCents(vals[a.id])! < 0));
  const countAfter = (a: Account) => data.txns.filter((t) => t.date > date && (t.accountId === a.id || t.toAccountId === a.id)).length;
  const countBefore = (a: Account) => data.txns.filter((t) => t.date <= date && (t.accountId === a.id || t.toAccountId === a.id)).length;
  const newBal = (a: Account) => (parseSignedCents(vals[a.id]) ?? 0) + sum(data.txns.filter((t) => t.date > date), (t) => delta(a, t));
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= data.today;
  return (
    <Sheet title={id ? `Set opening balance` : 'Set opening balances'} wide onClose={closeModal}
      sub="Pick a date, then enter what each account really held at the end of that day."
      footer={<button className="btn primary lg" disabled={!entered.length || !validDate || saving} onClick={async () => {
        setSaving(true);
        const ok = await setCutovers(date, entered.map((a) => ({ accountId: a.id, opening: parseSignedCents(vals[a.id])! })));
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
                <div style={{ width: 150 }}><MoneyInput signed={!credit} value={v} onChange={(x) => setVals({ ...vals, [a.id]: x })} placeholder={credit ? 'Amount owed' : 'Balance'} /></div>
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
  const { closeModal, theme, setTheme, openModal, resolvedTheme, toggleTheme } = useStore();
  const link = (path: string, label: string, icon: React.ReactNode) => (
    <button className="rowx hover" onClick={() => { closeModal(); go(path); }}><span className="li-ico">{icon}</span><span className="li-title grow">{label}</span><ArrowRight size={16} className="muted" /></button>
  );
  return (
    <Sheet title="More" onClose={closeModal}>
      <div className="group" style={{ marginBottom: 14 }}><button className="rowx hover" data-testid="theme-toggle-mobile" onClick={toggleTheme} aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}><span className="li-ico">{resolvedTheme === 'dark' ? <Sun /> : <Moon />}</span><span className="li-title grow">{resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}</span></button></div>
      <div className="group">{link('/insights', 'Insights', <Eye />)}{link('/insights/forecast', 'Forecast', <Gauge />)}{link('/insights/credit', 'Credit', <Gauge />)}{link('/settings', 'Settings', <Wallet />)}</div>
      <div className="group" style={{ marginTop: 14 }}>
        <button className="rowx hover" onClick={() => openModal({ type: 'category-add' })}><span className="li-ico"><Plus /></span><span className="li-title grow">Add item to Plan</span><ArrowRight size={16} className="muted" /></button>
        <button className="rowx hover" onClick={() => openModal({ type: 'cutover' })}><span className="li-ico"><Scale /></span><span className="li-title grow">Set opening balances</span><ArrowRight size={16} className="muted" /></button></div>
      <div style={{ marginTop: 18 }}><div className="label" style={{ marginBottom: 8 }}>Appearance</div><ThemeSwitch theme={theme} setTheme={setTheme} /></div>
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
    case 'category': return <ItemSheet key={modal.id} id={modal.id} />;
    case 'category-add': return <ItemAddSheet />;
    case 'category-edit': return <ItemEditSheet key={modal.id} id={modal.id} />;
    case 'bill-schedule': return <ItemEditSheet key={modal.categoryId} id={modal.categoryId} />;
    case 'bill-archive': return <ArchiveItemSheet key={modal.billId} id={modal.billId} />;
    case 'bill-edit': return <ItemEditSheet key={modal.billId} id={modal.billId} />;
    case 'bill': return <BillSheet key={`${modal.billId}-${modal.date}`} billId={modal.billId} date={modal.date} />;
    case 'income': return <IncomeSheet key={`${modal.mode}-${modal.id}`} mode={modal.mode} id={modal.id} />;
    case 'reconcile': return <ReconcileSheet key={modal.id} id={modal.id} />;
    case 'cutover': return <CutoverSheet key={modal.id ?? 'all'} id={modal.id} />;
    case 'account-add': return <AccountAddSheet />;
    case 'account-edit': return <AccountEditSheet key={modal.id} id={modal.id} />;
    case 'credit-score': return <CreditScoreSheet key={`${modal.id ?? 'new'}-${modal.bureau ?? ''}-${modal.model ?? ''}`} id={modal.id} bureau={modal.bureau} model={modal.model} />;
    case 'credit-card': return <CreditCardSheet key={modal.accountId} accountId={modal.accountId} />;
    case 'credit-reported': return <CreditReportedSheet key={`${modal.id ?? 'new'}-${modal.accountId ?? ''}`} id={modal.id} accountId={modal.accountId} />;
    case 'debt-edit': return <ItemEditSheet key={modal.categoryId} id={modal.categoryId} />;
    case 'menu': return <MenuSheet />;
    default: return null;
  }
}
void TriangleAlert; void monthKey; void FlaskConical; void StickyNote; void Split; void Trash; void Plus; void diffDays; void relDay; void envelope; void allEnvelopes; void billOccurrences;

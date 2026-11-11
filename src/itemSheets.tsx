// One concept: a Plan item is a category that can optionally have a payment schedule. These are its only screens:
// detail (pane or sheet), add, edit, archive.
import { useMemo, useState } from 'react';
import { Archive, ArrowLeftRight, ChevronDown, ChevronRight, Pencil, Plus, Trash } from 'lucide-react';
import { useStore } from './store';
import { billOccurrences, envelope, groupBills, paidTowardCurrent, rollForward, upcomingBills, type Bill, type BillPeriod, type Category } from './data';
import { addDays, centsToInput, cn, diffDays, fmtDate, money, plural, relDay, sum, toCents } from './lib';
import { CatIcon, Callout, Money, Seg, Sheet, StatusPill } from './ui';
import { MoneyInput } from './sheets';

const PERIODS: { v: 'once' | BillPeriod; label: string }[] = [{ v: 'once', label: 'One time' }, { v: 'Weekly', label: 'Weekly' }, { v: 'Bi-Weekly', label: 'Every 2 weeks' }, { v: 'Monthly', label: 'Monthly' }, { v: 'Yearly', label: 'Yearly' }];
const recurrenceLabel = (b: Bill) => (!b.recurring ? 'One time' : b.period === 'Bi-Weekly' ? 'Every 2 weeks' : b.period);

/** What stops an item from being archived right now — mirrors the checks the database enforces, so the reason is shown before anything happens. */
export function archiveBlockers(d: ReturnType<typeof useStore>['data'], cat: Category): string[] {
  const out: string[] = [];
  const env = envelope(d, cat.id);
  const bill = d.bills.find((b) => b.categoryId === cat.id);
  if (cat.cardAccountId) out.push(`${cat.name} is linked to a credit card, so it stays.`);
  if (cat.isDebt && (cat.debtBalance ?? 0) > 0) out.push(`${cat.name} still owes ${money(cat.debtBalance ?? 0)}. It stays until the debt is paid or corrected.`);
  if (env.avail < 0) out.push(`${cat.name} is overspent by ${money(-env.avail)}. Cover it first so nothing is hidden.`);
  if (bill && !bill.paused && bill.date && bill.date < d.today) out.push(`${cat.name} has an unpaid payment due ${fmtDate(bill.date)}. Record it, or edit the schedule, first.`);
  return out;
}

// ═══════════════════════════ Detail ═══════════════════════════
export function ItemDetail({ id }: { id: string }) {
  const { data, openModal } = useStore();
  const cat = data.categories.find((c) => c.id === id);
  const [showMissed, setShowMissed] = useState(false);
  if (!cat) return <div className="small muted">This item no longer exists.</div>;
  const env = envelope(data, id);
  const bill = data.bills.find((b) => b.categoryId === id);
  const grp = bill ? groupBills(upcomingBills(data, 60)).find((g) => g.bill.id === bill.id) : undefined;
  const over = env.avail < 0;
  const paid = bill && grp ? paidTowardCurrent(data, bill) : 0;
  const partial = bill && paid > 0 && paid < bill.amount;
  const history = bill
    ? [...data.txns.filter((t) => t.billId === id).map((t) => ({ key: t.id, date: t.date, label: t.payee, amount: t.amount, txn: t.id })),
       ...Object.entries(bill.paid).filter(([, v]) => v === 'manual').map(([due]) => ({ key: `m${due}`, date: due, label: 'Paid outside your accounts', amount: bill.amount, txn: '' }))].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)
    : [];
  const activity = data.txns.filter((t) => !t.scheduled && (t.categoryId === id || t.splits?.some((s) => s.categoryId === id)) && !t.billId).slice(0, 5);
  const goal = cat.target != null ? `${cat.targetMode === 'save' ? 'Save toward' : 'Keep'} ${money(cat.target, { cents: false })}${cat.targetMode === 'save' ? '' : ' available'}` : 'No funding goal';
  const group = data.groups.find((g) => g.id === cat.groupId)?.name;

  return (
    <div className="stack" style={{ gap: 18 }} data-testid="item-detail">
      <div className="row gap12">
        <div className={cn('li-ico', over ? 'neg' : 'planned')} style={{ width: 44, height: 44, borderRadius: 12 }}><CatIcon k={cat.icon} size={22} /></div>
        <div className="grow"><div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{cat.name}</div><div className="small muted">{group}{cat.isDebt ? ` · owes ${money(cat.debtBalance ?? 0)}` : ''}</div></div>
      </div>

      <div>
        <div className="eyebrow">Available</div>
        <div className={cn('amt-hero num', over && 'neg')} data-testid="item-available"><Money v={env.avail} /></div>
        {cat.target != null && <><div className="bar" style={{ margin: '10px 0 6px' }}><i style={{ width: `${Math.max(0, Math.min(1, env.fundedPct)) * 100}%` }} /></div>
          <div className="small muted">{goal}{env.remaining > 0 ? ` · needs ${money(env.remaining, { cents: false })}` : ' · funded'}</div></>}
        {over && <div className="small neg" style={{ marginTop: 6, fontWeight: 560 }}>Overspent by {money(-env.avail)}</div>}
      </div>

      {bill && (
        <div className="group" aria-label="Payment schedule">
          <div className="rowx"><div className="grow"><div className="li-title">{bill.paused ? 'Paused' : grp?.missed ? (grp.missed > 1 ? `${grp.missed} payments missed` : 'Overdue') : 'Next payment'}</div>
            <div className="li-sub">{bill.date ? `${fmtDate(bill.date, 'long')} · ${bill.paused ? 'schedule paused' : relDay(bill.date, data.today)}` : 'No date'} · {recurrenceLabel(bill)}</div></div>
            <div className="amt-md num"><Money v={bill.amount} /></div></div>
          {partial && <div className="rowx"><div className="grow li-sub">Paid so far</div><div className="small num"><b>{money(paid)}</b> · {money(bill.amount - paid)} remaining</div></div>}
          {grp && grp.missed > 1 && (<>
            <button className="rowx" onClick={() => setShowMissed((v) => !v)} aria-expanded={showMissed}><div className="grow li-sub">Missed payments · {money(grp.total)} total</div>{showMissed ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
            {showMissed && <div className="occ fade-in" style={{ margin: '0 16px 12px' }}>{grp.occs.filter((o) => o.status === 'overdue').map((o) => <div className="r" key={o.date}><span className="muted">{fmtDate(o.date)} · {-diffDays(o.date, data.today)} days late</span><b className="num">{money(o.bill.amount)}</b></div>)}
              <div className="xs muted" style={{ marginTop: 6 }}>Pay the oldest first. The money set aside is counted once, toward the oldest payment.</div></div>}
          </>)}
          {!bill.paused && <div className="rowx" style={{ justifyContent: 'flex-end' }}><button className="btn" data-testid="record-payment" onClick={() => openModal({ type: 'bill', billId: id, date: bill.date! })}>Record payment</button></div>}
        </div>
      )}

      <div className="group">
        {cat.target != null && <div className="rowx"><div className="grow li-sub">Funding goal</div><div className="small" style={{ fontWeight: 560 }}>{goal}</div></div>}
        <div className="rowx"><div className="grow li-sub">Spent this month</div><div className="small num" style={{ fontWeight: 560 }}>{money(env.spent)}</div></div>
        {cat.isDebt && <div className="rowx"><div className="grow li-sub">Still owed</div><div className="small num" style={{ fontWeight: 560 }}>{money(cat.debtBalance ?? 0)}</div></div>}
      </div>

      {(history.length > 0 || activity.length > 0) && (
        <div>
          <div className="group-h" style={{ paddingTop: 0 }}><h2>{bill ? 'Payment history' : 'Recent activity'}</h2>{!bill && <a className="sect-link" href={`#/activity?cat=${id}`}>See all</a>}</div>
          <div className="group">
            {(bill ? history : activity.map((t) => ({ key: t.id, date: t.date, label: t.payee, amount: t.amount, txn: t.id }))).map((h) => (
              <button key={h.key} className="rowx" disabled={!h.txn} onClick={() => h.txn && openModal({ type: 'txn', mode: 'view', id: h.txn })}><div className="grow"><div className="li-title" style={{ fontSize: 14 }}>{h.label}</div><div className="li-sub">{fmtDate(h.date)}</div></div><div className="amt-md num"><Money v={h.amount} /></div></button>
            ))}
          </div>
        </div>
      )}

      <div className="row gap8" style={{ flexWrap: 'wrap' }}>
        <button className={bill ? 'btn' : 'btn primary'} onClick={() => openModal({ type: 'move', ...(over ? { to: id, amount: -env.avail } : env.avail > 0 ? { from: id } : { from: 'rta', to: id, amount: env.remaining || undefined }) })}><ArrowLeftRight />{over ? 'Cover' : 'Move money'}</button>
        <button className="btn" onClick={() => openModal({ type: 'category-edit', id })}><Pencil />Edit</button>
        <button className="btn danger" data-testid="archive-item" onClick={() => openModal({ type: 'bill-archive', billId: id })}><Archive />Archive</button>
      </div>
    </div>
  );
}

export function ItemSheet({ id }: { id: string }) {
  const { closeModal } = useStore();
  return <Sheet title="" onClose={closeModal} wide><ItemDetail id={id} /></Sheet>;
}

// ═══════════════════════════ Add / edit ═══════════════════════════
interface FormState { name: string; emoji: string; groupId: string; goalOn: boolean; goal: string; mode: 'save' | 'keep'; schedOn: boolean; schedAmt: string; schedDate: string; period: 'once' | BillPeriod; paused: boolean; debtOn: boolean; debtBal: string }

function ItemForm({ id }: { id?: string }) {
  const { data, closeModal, openModal, saveItem, toast } = useStore();
  const cat = id ? data.categories.find((c) => c.id === id) : undefined;
  const bill = id ? data.bills.find((b) => b.categoryId === id) : undefined;
  const defGroup = data.groups.find((g) => g.kind === 'everyday')?.id ?? data.groups[0]?.id ?? '';
  const keepIcon = !!cat && /^[a-z]+$/i.test(cat.icon);
  const [f, setF] = useState<FormState>(() => ({
    name: cat?.name ?? '', emoji: cat && !keepIcon ? cat.icon : '', groupId: cat?.groupId ?? defGroup,
    goalOn: cat?.target != null, goal: cat?.target ? centsToInput(cat.target) : '', mode: cat?.targetMode ?? 'keep',
    schedOn: !!bill, schedAmt: bill ? centsToInput(bill.amount) : '', schedDate: bill?.date ?? '', period: bill ? (bill.recurring ? bill.period : 'once') : 'Monthly', paused: !!bill?.paused,
    debtOn: !!cat?.isDebt, debtBal: cat?.debtBalance ? centsToInput(cat.debtBalance) : '',
  }));
  const [saving, setSaving] = useState(false);
  const [touchedGoal, setTouchedGoal] = useState(false);
  const set = (p: Partial<FormState>) => setF((x) => ({ ...x, ...p }));
  const billsGroup = data.groups.find((g) => g.kind === 'bills')?.id;
  const amountC = toCents(f.schedAmt);
  const goalShown = !touchedGoal && !cat && f.schedOn && f.period === 'Monthly' && !f.goalOn ? '' : f.goal;
  const dup = !!f.name.trim() && data.categories.some((c) => c.id !== id && c.name.trim().toLowerCase() === f.name.trim().toLowerCase());
  const alreadyPaid = !!bill && !!f.schedDate && !!bill.paid[f.schedDate] && f.schedDate !== bill.date;
  const err = !f.name.trim() ? 'Give it a name.' : dup ? 'Another item already has that name.' : f.schedOn && amountC <= 0 ? 'Enter the payment amount.' : f.schedOn && !f.schedDate ? 'Choose the next due date.' : alreadyPaid ? 'That date is already recorded as paid. Choose the next unpaid date.' : f.goalOn && toCents(f.goal) <= 0 ? 'Enter the funding goal, or remove it.' : '';

  const save = async () => {
    if (err || saving) return;
    setSaving(true);
    const ok = await saveItem({
      id, name: f.name.trim(), emoji: f.emoji.trim() || (keepIcon ? cat!.icon : ''), groupId: f.groupId,
      target: f.goalOn ? toCents(f.goal) : null, mode: f.goalOn ? f.mode : undefined,
      schedule: f.schedOn ? { amount: amountC, date: f.schedDate, period: f.period } : bill ? null : undefined,
      paused: f.schedOn ? f.paused : undefined,
      isDebt: id ? f.debtOn : undefined, debtBalance: id && f.debtOn ? toCents(f.debtBal) : undefined,
    });
    if (ok) { toast(id ? `${f.name.trim()} saved` : `${f.name.trim()} added`); closeModal(); } else setSaving(false);
  };

  return (
    <Sheet title={id ? 'Edit item' : 'New item'} sub={cat?.name} onClose={closeModal} wide
      footer={<><button className="btn" onClick={closeModal}>Cancel</button><button className="btn primary" data-testid="item-save" disabled={!!err || saving} onClick={save}>{saving ? 'Saving…' : id ? 'Save' : 'Add item'}</button></>}>
      <form className="stack" style={{ gap: 16 }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="row gap12" style={{ alignItems: 'flex-end' }}>
          <div className="field grow"><label htmlFor="it-name">Name</label><input id="it-name" className="input" autoFocus autoComplete="off" value={f.name} placeholder="Rent, Groceries, Car insurance…" onChange={(e) => set({ name: e.target.value })} /></div>
          <div className="field" style={{ width: 76 }}><label htmlFor="it-emoji">Icon</label><input id="it-emoji" className="input" maxLength={4} value={f.emoji} placeholder={keepIcon ? '—' : '🙂'} onChange={(e) => set({ emoji: e.target.value })} style={{ textAlign: 'center' }} /></div>
        </div>
        <div className="field"><label>Group</label><div className="chips">{data.groups.map((g) => <button type="button" key={g.id} className="chip" aria-pressed={f.groupId === g.id} onClick={() => set({ groupId: g.id })}>{g.name}</button>)}</div></div>

        {f.goalOn ? (
          <div className="group" style={{ padding: '14px 16px' }}>
            <div className="row between" style={{ marginBottom: 10 }}><div className="li-title">Funding goal</div><button type="button" className="sect-link" onClick={() => set({ goalOn: false, goal: '' })}>Remove</button></div>
            <Seg block value={f.mode} onChange={(m) => set({ mode: m })} options={[{ v: 'save', label: 'Save toward an amount' }, { v: 'keep', label: 'Keep an amount available' }]} />
            <div className="small muted" style={{ margin: '8px 0' }}>{f.mode === 'save' ? 'Build up an amount over time for a goal or a future expense.' : 'Keep this much available, and top it up as you spend.'}</div>
            <MoneyInput value={goalShown} onChange={(v) => { setTouchedGoal(true); set({ goal: v }); }} placeholder="Amount" />
          </div>
        ) : <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => set({ goalOn: true, goal: !touchedGoal && f.schedOn && f.period === 'Monthly' ? f.schedAmt : f.goal })}><Plus />Add funding goal</button>}

        {f.schedOn ? (
          <div className="group" style={{ padding: '14px 16px' }} data-testid="schedule-fields">
            <div className="row between" style={{ marginBottom: 10 }}><div className="li-title">Payment schedule</div><button type="button" className="sect-link" onClick={() => set({ schedOn: false, paused: false })}>{bill ? 'Remove schedule' : 'Remove'}</button></div>
            <div className="row gap12" style={{ alignItems: 'flex-start' }}>
              <div className="field grow"><label htmlFor="it-amt">Payment</label><MoneyInput id="it-amt" value={f.schedAmt} onChange={(v) => set({ schedAmt: v })} /></div>
              <div className="field grow"><label htmlFor="it-date">Next due</label><input id="it-date" type="date" className="input" value={f.schedDate} onChange={(e) => set({ schedDate: e.target.value })} /></div>
            </div>
            <div className="field" style={{ marginTop: 12 }}><label>Repeats</label><div className="chips">{PERIODS.map((o) => <button type="button" key={o.v} className="chip" aria-pressed={f.period === o.v} onClick={() => set({ period: o.v })}>{o.label}</button>)}</div></div>
            {(f.period === 'Monthly' || f.period === 'Yearly') && Number((f.schedDate || '0000-00-00').slice(8, 10)) >= 29 && <div className="xs muted" style={{ marginTop: 8 }}>Anchored to the {Number(f.schedDate.slice(8, 10))}th: shorter months use their last day, then it returns to the {Number(f.schedDate.slice(8, 10))}th.</div>}
            {bill && <label className="row gap12" style={{ marginTop: 12 }}><input type="checkbox" checked={f.paused} onChange={(e) => set({ paused: e.target.checked })} /><span>Pause this schedule<div className="xs muted">Paused items leave upcoming payments and forecasts. History is kept.</div></span></label>}
          </div>
        ) : <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => set({ schedOn: true, groupId: !cat && f.groupId === defGroup && billsGroup ? billsGroup : f.groupId })}><Plus />Add payment schedule</button>}

        {id && (
          <div className="group" style={{ padding: '12px 16px' }}>
            <label className="row gap12"><input type="checkbox" checked={f.debtOn} onChange={(e) => set({ debtOn: e.target.checked })} /><span>Track an amount owed<div className="xs muted">For a loan or balance this item pays down. Payments you record reduce it.</div></span></label>
            {f.debtOn && <div className="field" style={{ marginTop: 10 }}><label htmlFor="it-debt">Amount you currently owe</label><MoneyInput id="it-debt" value={f.debtBal} onChange={(v) => set({ debtBal: v })} /></div>}
          </div>
        )}
        {err && f.name && <div className="small neg" role="alert">{err}</div>}
        {id && <button type="button" className="btn danger" style={{ alignSelf: 'flex-start' }} onClick={() => openModal({ type: 'bill-archive', billId: id })}><Archive />Archive this item…</button>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
export const ItemAddSheet = () => <ItemForm />;
export const ItemEditSheet = ({ id }: { id: string }) => <ItemForm id={id} />;

// ═══════════════════════════ Archive ═══════════════════════════
export function ArchiveItemSheet({ id }: { id: string }) {
  const { data, closeModal, archiveItem, restoreItem, toast } = useStore();
  const [saving, setSaving] = useState(false);
  const cat = data.categories.find((c) => c.id === id);
  const bill = data.bills.find((b) => b.categoryId === id);
  if (!cat) return <Sheet title="Archive" onClose={closeModal}><div className="small muted">This item no longer exists.</div></Sheet>;
  const env = envelope(data, id);
  const blockers = archiveBlockers(data, cat);
  const returned = Math.max(0, env.avail);
  const go = async () => {
    setSaving(true);
    const r = await archiveItem(id);
    if (r == null) { setSaving(false); return; }
    toast(`${cat.name} archived${r > 0 ? ` · ${money(r)} returned to Ready to Assign` : ''}`, () => { void restoreItem(id, r); });
    closeModal();
  };
  return (
    <Sheet title={`Archive ${cat.name}?`} onClose={closeModal}
      footer={<><button className="btn" onClick={closeModal}>Cancel</button><button className="btn primary" data-testid="archive-confirm" disabled={blockers.length > 0 || saving} onClick={go}>{saving ? 'Archiving…' : 'Archive'}</button></>}>
      {blockers.length > 0 ? (
        <div className="stack gap12">{blockers.map((b) => <Callout key={b} tone="warn">{b}</Callout>)}</div>
      ) : (
        <div className="group" data-testid="archive-preview">
          <div className="rowx"><div className="grow">Returns to Ready to Assign</div><div className="amt-md num" data-testid="archive-returns"><Money v={returned} /></div></div>
          {bill && <div className="rowx"><div className="grow">Payment schedule</div><div className="small muted">Stops{bill.recurring ? ' repeating' : ''}</div></div>}
          <div className="rowx"><div className="grow">Transactions and history</div><div className="small muted">Kept</div></div>
        </div>
      )}
      {blockers.length === 0 && <div className="xs muted" style={{ marginTop: 12 }}>You can restore it any time. A restored item comes back empty — nothing is re-funded unless you do it.</div>}
    </Sheet>
  );
}

/** Restore an archived item (empty); used by the Archived list in Plan. */
export function restoreResume(d: ReturnType<typeof useStore>['data'], cat: Category): string | undefined {
  const b = d.archivedBills.find((x) => x.categoryId === cat.id);
  if (!b?.date) return undefined;
  return b.recurring ? rollForward({ recurring: true, period: b.period, anchor: b.anchor, date: b.date, paid: b.paid }, b.date, d.today) : b.date;
}
void useMemo; void plural; void sum; void addDays; void billOccurrences; void Trash; void StatusPill;

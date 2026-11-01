// Credit tracker forms: score entry, card details (limit / active / statement date), reported balance.
// None of these touch transactions, balances or bills; they only write the credit tables and the card's credit limit.
import { useState } from 'react';
import { Info } from 'lucide-react';
import { useStore } from './store';
import { BUREAUS, MODEL_PRESETS, SCORE_MAX, SCORE_MIN, modelLabel, type Bureau } from './credit';
import { MoneyInput } from './sheets';
import { Callout, Sheet, Seg } from './ui';
import { centsToInput, fmtDate, toCents } from './lib';

const isPreset = (m: string) => (MODEL_PRESETS as readonly string[]).some((p) => p.toLowerCase() === m.trim().toLowerCase());

export function CreditScoreSheet({ id, bureau: b0, model: m0 }: { id?: string; bureau?: Bureau; model?: string }) {
  const { data, closeModal, saveScore, deleteScore, toast } = useStore();
  const existing = id ? data.credit.scores.find((s) => s.id === id) : undefined;
  const [bureau, setBureau] = useState<Bureau | ''>(existing?.bureau ?? b0 ?? '');
  const [score, setScore] = useState(existing ? String(existing.score) : '');
  const startModel = existing?.model ?? m0 ?? '';
  const [model, setModel] = useState(startModel && isPreset(startModel) ? MODEL_PRESETS.find((p) => p.toLowerCase() === startModel.trim().toLowerCase())! : startModel ? 'Custom' : '');
  const [custom, setCustom] = useState(startModel && !isPreset(startModel) ? startModel : '');
  const [date, setDate] = useState(existing?.observedOn ?? data.today);
  const [source, setSource] = useState(existing?.source ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [saving, setSaving] = useState(false);
  if (id && !existing) return <Sheet title="Entry not found" onClose={closeModal}><div className="small muted">This score entry no longer exists.</div></Sheet>;

  const n = Number(score);
  const finalModel = model === 'Custom' ? custom.trim() : model;
  const err = !bureau ? 'Choose a bureau.' : !/^\d{3}$/.test(score) || n < SCORE_MIN || n > SCORE_MAX ? `Enter a score between ${SCORE_MIN} and ${SCORE_MAX}.`
    : !model ? 'Choose the scoring model (or “Unknown”).' : model === 'Custom' && !custom.trim() ? 'Type the model’s name.' : model === 'Custom' && custom.trim().length > 40 ? 'Model name is too long.'
      : !date ? 'Choose the date you saw this score.' : date > data.today ? 'The date can’t be in the future.' : '';
  const dup = !!bureau && !!finalModel && data.credit.scores.some((s) => s.id !== id && s.bureau === bureau && s.observedOn === date && modelLabel(s.model).toLowerCase() === modelLabel(finalModel).toLowerCase() && s.score === n);
  const save = async () => {
    setSaving(true);
    const ok = await saveScore(id, { bureau: bureau as Bureau, score: n, model: finalModel, observedOn: date, source, notes });
    if (ok) { toast(id ? 'Score updated' : `${bureau} score saved`); closeModal(); } else setSaving(false);
  };
  return (
    <Sheet title={id ? 'Edit score' : 'Add a score'} sub="Entered by hand — Finance OS never looks scores up or estimates them" onClose={closeModal}
      footer={<>{id && <button className="btn danger" disabled={saving} onClick={async () => { if (await deleteScore(id)) closeModal(); }}>Delete</button>}<button className="btn" onClick={closeModal}>Cancel</button><button className="btn primary" disabled={!!err || saving} onClick={save}>{saving ? 'Saving…' : id ? 'Save changes' : 'Save score'}</button></>}>
      <div className="field"><label>Bureau</label>
        <div className="chips" role="group" aria-label="Bureau">{BUREAUS.map((x) => <button key={x} className="chip" aria-pressed={bureau === x} onClick={() => setBureau(x)}>{x}</button>)}</div></div>
      <div className="row gap12" style={{ marginTop: 14, alignItems: 'flex-start' }}>
        <div className="field grow"><label htmlFor="cs-score">Score</label><input id="cs-score" className="input num" inputMode="numeric" maxLength={3} placeholder="e.g. 712" value={score} onChange={(e) => setScore(e.target.value.replace(/\D/g, '').slice(0, 3))} style={{ textAlign: 'right', fontWeight: 600 }} /></div>
        <div className="field grow"><label htmlFor="cs-date">Date seen</label><input id="cs-date" type="date" className="input" max={data.today} value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <div className="field" style={{ marginTop: 14 }}><label>Scoring model</label>
        <div className="chips" role="group" aria-label="Scoring model">
          {MODEL_PRESETS.map((x) => <button key={x} className="chip" aria-pressed={model === x} onClick={() => setModel(x)}>{x}</button>)}
          <button className="chip" aria-pressed={model === 'Custom'} onClick={() => setModel('Custom')}>Other…</button>
        </div>
        {model === 'Custom' && <input className="input" style={{ marginTop: 8 }} placeholder="Model name, e.g. FICO Auto 8" aria-label="Custom model name" maxLength={40} value={custom} onChange={(e) => setCustom(e.target.value)} autoFocus />}
        <div className="xs muted" style={{ marginTop: 6 }}>FICO and VantageScore are different models, so they’re tracked as separate lines and never compared with each other. Not sure? Choose “Unknown” — it stays its own line too.</div></div>
      <div className="field" style={{ marginTop: 14 }}><label htmlFor="cs-src">Where you saw it (optional)</label><input id="cs-src" className="input" placeholder="e.g. Experian app, bank, Credit Karma" maxLength={120} value={source} onChange={(e) => setSource(e.target.value)} /></div>
      <div className="field" style={{ marginTop: 14 }}><label htmlFor="cs-notes">Notes (optional)</label><textarea id="cs-notes" className="textarea" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      {dup && <div className="xs warn" style={{ marginTop: 10 }}>You already have an identical entry for this bureau, model and date.</div>}
      {err && (score || bureau) && <div className="small neg" style={{ marginTop: 12 }} role="alert">{err}</div>}
    </Sheet>
  );
}

export function CreditCardSheet({ accountId }: { accountId: string }) {
  const { data, closeModal, saveCard, openModal, toast } = useStore();
  const a = data.accounts.find((x) => x.id === accountId && x.type === 'credit');
  const meta = data.credit.meta[accountId];
  const [limit, setLimit] = useState(a?.limit ? centsToInput(a.limit) : '');
  const [active, setActive] = useState(meta ? meta.active : true);
  const [closing, setClosing] = useState(meta?.closingDate ?? '');
  const [repeats, setRepeats] = useState(meta ? meta.repeats : true);
  const [notes, setNotes] = useState(meta?.notes ?? '');
  const [saving, setSaving] = useState(false);
  if (!a) return <Sheet title="Card not found" onClose={closeModal}><div className="small muted">This card no longer exists.</div></Sheet>;
  const bill = a.paymentCategoryId ? data.bills.find((b) => b.id === a.paymentCategoryId) : undefined;
  const lim = toCents(limit);
  const limitChanged = lim !== (a.limit ?? 0);
  const save = async () => {
    setSaving(true);
    const ok = await saveCard(accountId, limitChanged ? lim : null, { active, closingDate: closing || undefined, repeats, notes });
    if (ok) { toast(`${a.name} updated`); closeModal(); } else setSaving(false);
  };
  return (
    <Sheet title={a.name} sub="Credit card details" onClose={closeModal}
      footer={<><button className="btn" onClick={closeModal}>Cancel</button><button className="btn primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button></>}>
      <div className="field"><label htmlFor="cc-lim">Credit limit</label><MoneyInput id="cc-lim" value={limit} onChange={setLimit} placeholder="No limit set" />
        <div className="xs muted" style={{ marginTop: 6 }}>Saved on the account itself, so Accounts and Credit always agree. Leave empty if you don’t know it — utilization is skipped for that card rather than guessed.</div></div>
      <div className="field" style={{ marginTop: 14 }}><label>Include this card</label>
        <Seg block value={active ? 'on' : 'off'} onChange={(v) => setActive(v === 'on')} options={[{ v: 'on', label: 'Active' }, { v: 'off', label: 'Inactive' }]} />
        <div className="xs muted" style={{ marginTop: 6 }}>{active ? 'Counted in utilization and totals.' : 'Left out of utilization, totals and the calculator. Nothing is deleted.'}</div></div>
      <div className="row gap12" style={{ marginTop: 14, alignItems: 'flex-start' }}>
        <div className="field grow"><label htmlFor="cc-close">Statement closing date</label><input id="cc-close" type="date" className="input" value={closing} onChange={(e) => setClosing(e.target.value)} /></div>
      </div>
      <label className="row gap12" style={{ marginTop: 10, cursor: 'pointer' }}><input type="checkbox" checked={repeats} onChange={(e) => setRepeats(e.target.checked)} /><span className="small">Repeats every month on this day</span></label>
      <div className="field" style={{ marginTop: 14 }}><label>Payment due date</label>
        {bill ? <div className="small">{bill.date ? fmtDate(bill.date, 'long') : 'Not set'} · from the linked bill “{bill.name}”{bill.paused ? ' (paused)' : ''}. <button className="link" onClick={() => openModal({ type: 'bill-edit', billId: bill.id })}>Edit bill</button></div>
          : <div className="small muted">{a.nextPaymentDue ? `${fmtDate(a.nextPaymentDue, 'long')} · from the account.` : 'No payment bill is linked to this card.'} Due dates come from your existing bills — nothing is duplicated here.</div>}</div>
      <div className="field" style={{ marginTop: 14 }}><label htmlFor="cc-notes">Notes (optional)</label><textarea id="cc-notes" className="textarea" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <div style={{ marginTop: 14 }}><Callout icon={<Info />}>Changing the limit or schedule never changes this card’s balance, transactions or payments.</Callout></div>
    </Sheet>
  );
}

export function CreditReportedSheet({ id, accountId }: { id?: string; accountId?: string }) {
  const { data, closeModal, saveReported, deleteReported, toast } = useStore();
  const existing = id ? data.credit.reported.find((r) => r.id === id) : undefined;
  const cards = data.accounts.filter((a) => a.type === 'credit');
  const [acct, setAcct] = useState(existing?.accountId ?? accountId ?? cards[0]?.id ?? '');
  const [bal, setBal] = useState(existing ? centsToInput(existing.balance) : '');
  const [date, setDate] = useState(existing?.reportedOn ?? data.today);
  const [bureau, setBureau] = useState<Bureau | ''>(existing?.bureau ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [saving, setSaving] = useState(false);
  if (id && !existing) return <Sheet title="Entry not found" onClose={closeModal}><div className="small muted">This reported balance no longer exists.</div></Sheet>;
  const err = !acct ? 'Choose a card.' : bal === '' ? 'Enter the balance that was reported.' : !date ? 'Choose the report date.' : date > data.today ? 'The date can’t be in the future.' : '';
  const save = async () => {
    setSaving(true);
    const ok = await saveReported(id, { accountId: acct, balance: toCents(bal), reportedOn: date, bureau: bureau || undefined, notes });
    if (ok) { toast('Reported balance saved'); closeModal(); } else setSaving(false);
  };
  return (
    <Sheet title={id ? 'Edit reported balance' : 'Add a reported balance'} sub="What a bureau or your statement showed — separate from today’s balance" onClose={closeModal}
      footer={<>{id && <button className="btn danger" disabled={saving} onClick={async () => { if (await deleteReported(id)) closeModal(); }}>Delete</button>}<button className="btn" onClick={closeModal}>Cancel</button><button className="btn primary" disabled={!!err || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button></>}>
      <div className="field"><label htmlFor="rb-card">Card</label>
        <select id="rb-card" className="input" value={acct} onChange={(e) => setAcct(e.target.value)}>{cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="row gap12" style={{ marginTop: 14, alignItems: 'flex-start' }}>
        <div className="field grow"><label htmlFor="rb-bal">Balance reported</label><MoneyInput id="rb-bal" value={bal} onChange={setBal} /></div>
        <div className="field grow"><label htmlFor="rb-date">Reported on</label><input id="rb-date" type="date" className="input" max={data.today} value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <div className="field" style={{ marginTop: 14 }}><label>Bureau (optional)</label>
        <div className="chips" role="group" aria-label="Bureau"><button className="chip" aria-pressed={bureau === ''} onClick={() => setBureau('')}>Not specified</button>{BUREAUS.map((x) => <button key={x} className="chip" aria-pressed={bureau === x} onClick={() => setBureau(x)}>{x}</button>)}</div></div>
      <div className="field" style={{ marginTop: 14 }}><label htmlFor="rb-notes">Notes (optional)</label><textarea id="rb-notes" className="textarea" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <div style={{ marginTop: 14 }}><Callout icon={<Info />}>Enter the amount owed, as a positive number. This is a record of what was reported; it never changes the card’s current balance.</Callout></div>
    </Sheet>
  );
}

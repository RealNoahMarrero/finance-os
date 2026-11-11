import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { emptyData, rollForward, type DataState, type Txn, type Income, type Account, type Bill } from './data';
import * as db from './db';
import { supabase } from './supabase';
import { todayISO } from './lib';
import type { Bureau } from './credit';

export type Modal =
  | { type: 'txn'; mode: 'add' | 'view' | 'edit'; id?: string; prefill?: Partial<Txn> }
  | { type: 'assign' }
  | { type: 'move'; from?: string; to?: string; amount?: number }
  | { type: 'category'; id: string }
  | { type: 'category-add' }
  | { type: 'category-edit'; id: string }
  | { type: 'bill-schedule'; categoryId: string }
  | { type: 'bill'; billId: string; date: string }
  | { type: 'bill-edit'; billId: string }
  | { type: 'bill-archive'; billId: string }
  | { type: 'income'; mode: 'view' | 'add'; id?: string; date?: string }
  | { type: 'reconcile'; id: string }
  | { type: 'cutover'; id?: string }
  | { type: 'account-add' }
  | { type: 'account-edit'; id: string }
  | { type: 'credit-score'; id?: string; bureau?: Bureau; model?: string }
  | { type: 'credit-card'; accountId: string }
  | { type: 'credit-reported'; id?: string; accountId?: string }
  | { type: 'debt-edit'; categoryId: string }
  | { type: 'menu' }
  | { type: 'forecast-detail' };

export interface Toast { id: number; text: string; undo?: () => void; tone?: 'error' }
export type ThemePref = 'light' | 'dark' | 'system';
type Opt<T> = T | undefined;

interface Store {
  data: DataState; status: 'loading' | 'ready' | 'error'; loadError: string; refresh: () => Promise<void>; busy: boolean; email: string; signOut: () => Promise<void>;
  modal: Modal | null; openModal: (m: Modal) => void; closeModal: () => void;
  toasts: Toast[]; toast: (text: string, undo?: () => void) => void;
  theme: ThemePref; setTheme: (t: ThemePref) => void;
  addTxn: (t: Omit<Txn, 'id'>) => Promise<Opt<string>>;
  updateTxn: (id: string, t: Omit<Txn, 'id'>) => Promise<boolean>;
  deleteTxn: (id: string) => Promise<boolean>;
  assign: (amounts: Record<string, number>) => Promise<boolean>;
  moveMoney: (from: string, to: string, amount: number) => Promise<boolean>;
  setTarget: (catId: string, target: number | null) => Promise<boolean>;
  addCategory: (c: { name: string; groupId: string; target: number | null; emoji?: string; schedule?: db.ScheduleInput }) => Promise<boolean>;
  updateCategory: (id: string, p: { name: string; emoji: string; groupId: string }) => Promise<boolean>;
  scheduleBill: (categoryId: string, s: db.ScheduleInput) => Promise<boolean>;
  removeBill: (categoryId: string) => Promise<boolean>;
  /** Retire / restore a bill (history kept). `alsoCategory` also archives its budget category. */
  archiveBill: (billId: string, alsoCategory?: boolean) => Promise<boolean>;
  restoreBill: (billId: string, alsoCategory?: boolean) => Promise<boolean>;
  setCategoryArchived: (categoryId: string, archived: boolean) => Promise<boolean>;
  /** The one payment path: records/links the payment, applies the budget and debt effects and advances the schedule, atomically. Undo reverses it. */
  payBill: (input: Omit<db.PayInput, 'requestId'> & { requestId?: string }) => Promise<db.PayResult | undefined>;
  unpayBill: (billId: string, due: string, deleteTxn: boolean, partial?: { transactionId?: string; debtApplied: number }) => Promise<boolean>;
  setBillPaused: (billId: string, paused: boolean, resume?: string) => Promise<boolean>;
  /** One item = a category plus an optional schedule. Create, edit and archive are single atomic operations. */
  saveItem: (i: db.SaveItemInput) => Promise<string | undefined>;
  archiveItem: (id: string) => Promise<number | undefined>;
  restoreItem: (id: string, reassign?: number, resume?: string) => Promise<boolean>;
  updateBill: (billId: string, patch: db.BillPatch) => Promise<boolean>;
  receiveIncome: (incomeId: string, opts: { date: string; amount: number; accountId: string }) => Promise<boolean>;
  skipIncome: (incomeId: string) => Promise<boolean>;
  addIncome: (i: Omit<Income, 'id' | 'status'>) => Promise<boolean>;
  setCertainty: (id: string, c: Income['certainty']) => Promise<boolean>;
  updateIncome: (id: string, p: db.IncomePatch, scope?: 'future' | 'this') => Promise<boolean>;
  deleteIncome: (id: string, scope: 'this' | 'series') => Promise<boolean>;
  reconcile: (accountId: string, actual: number, note?: string) => Promise<Opt<{ diff: number; adjustmentTxnId?: string }>>;
  setCutover: (accountId: string, date: string, opening: number) => Promise<boolean>;
  setCutovers: (date: string, items: { accountId: string; opening: number }[]) => Promise<boolean>;
  saveDebt: (categoryId: string, d: { isDebt: boolean; balance: number }) => Promise<boolean>;
  saveScore: (id: string | undefined, s: db.ScoreInput) => Promise<boolean>;
  deleteScore: (id: string) => Promise<boolean>;
  saveCard: (accountId: string, limit: number | null, meta: db.CardMetaInput) => Promise<boolean>;
  saveReported: (id: string | undefined, r: db.ReportedInput) => Promise<boolean>;
  deleteReported: (id: string) => Promise<boolean>;
  updateAccount: (id: string, a: { name: string; type?: Account['type']; limit?: number | null }) => Promise<boolean>;
  archiveAccount: (id: string) => Promise<boolean>;
  restoreAccount: (id: string) => Promise<boolean>;
  deleteAccount: (id: string) => Promise<boolean>;
  addAccount: (a: { name: string; type: Account['type']; limit?: number; opening: number; cutover: string }) => Promise<boolean>;
}

const Ctx = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(Ctx);

const storedTheme = (): ThemePref => {
  try { const t = localStorage.getItem('fos-theme'); if (t === 'light' || t === 'dark' || t === 'system') return t; } catch { /* storage unavailable */ }
  return 'system';
};

export function StoreProvider({ children, email }: { children: ReactNode; email: string }) {
  const [data, setData] = useState<DataState>(() => emptyData());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<Modal | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setThemeState] = useState<ThemePref>(storedTheme);
  const seq = useRef(1);
  const lock = useRef(false);
  const loadedAt = useRef(0);

  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  const setTheme = useCallback((t: ThemePref) => { setThemeState(t); try { localStorage.setItem('fos-theme', t); } catch { /* ignore */ } }, []);

  const toast = useCallback((text: string, undo?: () => void, tone?: 'error') => {
    const id = seq.current++;
    setToasts((x) => [...x, { id, text, undo, tone }]);
    setTimeout(() => setToasts((x) => x.filter((t) => t.id !== id)), tone === 'error' ? 8000 : 5200);
  }, []);
  const dismissToast = (id: number) => setToasts((x) => x.filter((t) => t.id !== id));

  const refresh = useCallback(async () => {
    try {
      await db.postDue(todayISO()); // scheduled transactions whose date has arrived are posted by the database (idempotent)
      const { state } = await db.loadAll();
      setData(state); setStatus('ready'); setLoadError(''); loadedAt.current = Date.now();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setStatus((s) => (s === 'ready' ? s : 'error'));
      if (status === 'ready') toast('Could not refresh — showing the last loaded data', undefined, 'error');
    }
  }, [status, toast]);
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const f = () => { if (document.visibilityState === 'visible' && Date.now() - loadedAt.current > 90_000 && !lock.current) void refresh(); };
    document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f);
  }, [refresh]);

  /** One write at a time: blocks double-taps, shows a friendly error, then reloads so every number comes from the database. */
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
    if (lock.current) return { ok: false };
    lock.current = true; setBusy(true);
    try {
      const value = await fn();
      await refresh();
      return { ok: true, value };
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong — nothing was changed.', undefined, 'error');
      return { ok: false };
    } finally { lock.current = false; setBusy(false); }
  }, [refresh, toast]);

  const signOut = useCallback(async () => { await supabase.auth.signOut(); }, []);

  const addTxn: Store['addTxn'] = useCallback(async (t) => { const r = await run(() => db.createTxn(t)); return r.ok ? r.value : undefined; }, [run]);
  const updateTxn: Store['updateTxn'] = useCallback(async (id, t) => (await run(() => db.updateTxn(id, t))).ok, [run]);
  const deleteTxn: Store['deleteTxn'] = useCallback(async (id) => {
    const r = await run(() => db.deleteTxn(id));
    if (r.ok) { const copy = r.value; toast('Transaction deleted', () => { void addTxn(copy); }); }
    return r.ok;
  }, [run, toast, addTxn]);
  const assign: Store['assign'] = useCallback(async (a) => (await run(() => db.assignMoney(a))).ok, [run]);
  const moveMoney: Store['moveMoney'] = useCallback(async (f, t, a) => (await run(() => db.moveMoney(f, t, a))).ok, [run]);
  const setTarget: Store['setTarget'] = useCallback(async (id, t) => (await run(() => db.setCategoryTarget(id, t))).ok, [run]);
  const addCategory: Store['addCategory'] = useCallback(async (c) => (await run(() => db.addCategoryRow(c))).ok, [run]);

  const payBill: Store['payBill'] = useCallback(async (i) => {
    const r = await run(() => db.payBillV2({ ...i, requestId: i.requestId ?? db.newRequestId() }));
    return r.ok ? r.value : undefined;
  }, [run]);
  const unpayBill: Store['unpayBill'] = useCallback(async (id, due, del, partial) => (await run(() => db.unpayBill(id, due, del, partial))).ok, [run]);
  const saveItem: Store['saveItem'] = useCallback(async (i) => { const r = await run(() => db.saveItem(i)); return r.ok ? r.value : undefined; }, [run]);
  const archiveItem: Store['archiveItem'] = useCallback(async (id) => { const r = await run(() => db.archiveItem(id, todayISO())); return r.ok ? r.value : undefined; }, [run]);
  const restoreItem: Store['restoreItem'] = useCallback(async (id, reassign = 0, resume) => (await run(() => db.restoreItem(id, reassign, resume))).ok, [run]);
  const setBillPaused: Store['setBillPaused'] = useCallback(async (id, paused, resume) => (await run(() => db.setBillPaused(id, paused, resume))).ok, [run]);
  const updateCategory: Store['updateCategory'] = useCallback(async (id, p) => (await run(() => db.updateCategory(id, p))).ok, [run]);
  const scheduleBill: Store['scheduleBill'] = useCallback(async (id, s) => (await run(() => db.scheduleBill(id, s))).ok, [run]);
  const removeBill: Store['removeBill'] = useCallback(async (id) => (await run(() => db.removeBill(id))).ok, [run]);
  const archiveBill: Store['archiveBill'] = useCallback(async (id, alsoCat) => {
    return (await run(() => db.archiveBillAtomic(id, true, !!alsoCat))).ok;
  }, [run]);
  const restoreBill: Store['restoreBill'] = useCallback(async (id, alsoCat) => {
    const b = data.archivedBills.find((x) => x.id === id);
    const resume = b?.date && b.recurring ? rollForward({ recurring: true, period: b.period, anchor: b.anchor, date: b.date, paid: b.paid }, b.date, todayISO()) : b?.date;
    return (await run(() => db.archiveBillAtomic(id, false, !!alsoCat, resume))).ok;
  }, [run, data.archivedBills]);
  const setCategoryArchived: Store['setCategoryArchived'] = useCallback(async (id, a) => (await run(() => db.setCategoryHidden(id, a))).ok, [run]);
  const updateBill: Store['updateBill'] = useCallback(async (id, p) => (await run(() => db.updateBill(id, p))).ok, [run]);

  const receiveIncome: Store['receiveIncome'] = useCallback(async (id, o) => (await run(() => db.receiveIncome(id, o.date, o.amount, o.accountId))).ok, [run]);
  const skipIncome: Store['skipIncome'] = useCallback(async (id) => {
    const inc = data.incomes.find((i) => i.id === id);
    return (await run(() => db.skipIncome(id, inc?.date ?? todayISO()))).ok;
  }, [run, data.incomes]);
  const addIncome: Store['addIncome'] = useCallback(async (i) => (await run(() => db.addIncomeRow(i))).ok, [run]);
  const updateIncome: Store['updateIncome'] = useCallback(async (id, p, scope = 'future') => {
    const inc = data.incomes.find((i) => i.id === id);
    if (scope === 'this' && inc && inc.repeat !== 'none') {
      // Only this occurrence changes: it's skipped (the series carries on unchanged) and a one-time entry holds the edited values.
      return (await run(async () => {
        const nextId = await db.skipOccurrence(id, inc.date);
        try { await db.addIncomeRow({ ...p, repeat: 'none', who: 'Household' }); }
        catch (e) { await db.undoSkipOccurrence(id, inc.date, nextId); throw e; } // never leave the occurrence skipped without its replacement
      })).ok;
    }
    return (await run(() => db.updateIncomeRow(id, p))).ok;
  }, [run, data.incomes]);
  const deleteIncome: Store['deleteIncome'] = useCallback(async (id, scope) => {
    const inc = data.incomes.find((i) => i.id === id);
    if (!inc) return false;
    if (scope === 'this' && inc.repeat !== 'none') {
      const r = await run(() => db.skipOccurrence(id, inc.date));
      if (r.ok) toast(`${inc.label} · this one removed`, () => { void run(() => db.undoSkipOccurrence(id, inc.date, r.value)); });
      return r.ok;
    }
    const r = await run(() => db.cancelIncomeRow(id));
    if (r.ok) toast(inc.repeat !== 'none' ? `${inc.label} · series removed` : `${inc.label} removed`, () => { void run(() => db.restoreIncomeRow(id)); });
    return r.ok;
  }, [run, toast, data.incomes]);
  const setCertainty: Store['setCertainty'] = useCallback(async (id, c) => (await run(() => db.setIncomeCertainty(id, c))).ok, [run]);

  const reconcile: Store['reconcile'] = useCallback(async (id, actual, note) => {
    const r = await run(() => db.reconcileAccount(id, actual, todayISO(), db.newRequestId(), note));
    return r.ok ? r.value : undefined;
  }, [run]);
  const setCutover: Store['setCutover'] = useCallback(async (id, date, opening) => (await run(() => db.setCutover(id, date, opening))).ok, [run]);
  const setCutovers: Store['setCutovers'] = useCallback(async (date, items) => (await run(() => db.setCutoversAtomic(date, items))).ok, [run]);
  const addAccount: Store['addAccount'] = useCallback(async (a) => (await run(() => db.addAccountAtomic(a))).ok, [run]);

  const updateAccount: Store['updateAccount'] = useCallback(async (id, a) => (await run(() => db.updateAccountRow(id, a))).ok, [run]);
  const archiveAccount: Store['archiveAccount'] = useCallback(async (id) => {
    const a = data.allAccounts.find((x) => x.id === id);
    const r = await run(() => db.setAccountArchived(id, true));
    if (r.ok) toast(`${a?.name ?? 'Account'} archived`, () => { void run(() => db.setAccountArchived(id, false)); });
    return r.ok;
  }, [run, toast, data.allAccounts]);
  const restoreAccount: Store['restoreAccount'] = useCallback(async (id) => (await run(() => db.setAccountArchived(id, false))).ok, [run]);
  const deleteAccount: Store['deleteAccount'] = useCallback(async (id) => (await run(() => db.deleteUnusedAccount(id))).ok, [run]);
  const saveDebt: Store['saveDebt'] = useCallback(async (id, d) => (await run(() => db.setDebt(id, d))).ok, [run]);
  const saveScore: Store['saveScore'] = useCallback(async (id, sc) => (await run(async () => { if (id) await db.updateScore(id, sc); else await db.addScore(sc); })).ok, [run]);
  const deleteScore: Store['deleteScore'] = useCallback(async (id) => {
    const old = data.credit.scores.find((x) => x.id === id);
    const r = await run(() => db.deleteScore(id));
    if (r.ok && old) toast('Score entry deleted', () => { void run(() => db.addScore({ bureau: old.bureau, score: old.score, model: old.model, observedOn: old.observedOn, source: old.source, notes: old.notes })); });
    return r.ok;
  }, [run, toast, data.credit.scores]);
  const saveCard: Store['saveCard'] = useCallback(async (accountId, limit, meta) => (await run(async () => {
    if (limit != null) await db.setCreditLimit(accountId, limit);
    await db.saveCardMeta(accountId, meta);
  })).ok, [run]);
  const saveReported: Store['saveReported'] = useCallback(async (id, rep) => (await run(async () => { if (id) await db.updateReported(id, rep); else await db.addReported(rep); })).ok, [run]);
  const deleteReported: Store['deleteReported'] = useCallback(async (id) => {
    const old = data.credit.reported.find((x) => x.id === id);
    const r = await run(() => db.deleteReported(id));
    if (r.ok && old) toast('Reported balance deleted', () => { void run(() => db.addReported({ accountId: old.accountId, balance: old.balance, reportedOn: old.reportedOn, bureau: old.bureau, notes: old.notes })); });
    return r.ok;
  }, [run, toast, data.credit.reported]);

  const value = useMemo<Store>(() => ({
    data, status, loadError, refresh, busy, email, signOut, modal, openModal: setModal, closeModal: () => setModal(null), toasts, toast, theme, setTheme,
    addTxn, updateTxn, deleteTxn, assign, moveMoney, setTarget, addCategory, updateCategory, scheduleBill, removeBill, archiveBill, restoreBill, setCategoryArchived, payBill, unpayBill, setBillPaused, saveItem, archiveItem, restoreItem, updateBill, receiveIncome, skipIncome, addIncome, setCertainty, updateIncome, deleteIncome, reconcile, setCutover, setCutovers, addAccount, updateAccount, archiveAccount, restoreAccount, deleteAccount, saveDebt, saveScore, deleteScore, saveCard, saveReported, deleteReported,
  }), [data, status, loadError, busy, email, modal, toasts, theme, refresh, signOut, toast, setTheme, addTxn, updateTxn, deleteTxn, assign, moveMoney, setTarget, addCategory, updateCategory, scheduleBill, removeBill, archiveBill, restoreBill, setCategoryArchived, payBill, unpayBill, setBillPaused, saveItem, archiveItem, restoreItem, updateBill, receiveIncome, skipIncome, addIncome, setCertainty, reconcile, setCutover, setCutovers, addAccount, saveDebt, saveScore, deleteScore, saveCard, saveReported, deleteReported]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={t.tone === 'error' ? 'toast error' : 'toast'} role={t.tone === 'error' ? 'alert' : undefined}>
            <span>{t.text}</span>
            {t.undo && <button onClick={() => { t.undo!(); dismissToast(t.id); }}>Undo</button>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Gauge,
  Plus,
  Loader2,
  Save,
  Trash2,
  TrendingDown,
  TrendingUp,
  Minus,
  Calendar,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { ResponsiveModal } from '@/components/ui/responsive-modal';
import { CreditScoreChart } from '@/components/charts/credit-score-chart';
import { cn } from '@/lib/cn';
import {
  CREDIT_SCORE_PERSON_LABELS,
  entriesForSlot,
  formatRecordedDate,
  getSlotsForPerson,
  latestEntryPerSlot,
  parseCreditScoreInput,
  scoreDelta,
  slotKeyFromSlot,
  type CreditScoreSlot,
} from '@/lib/credit-scores';
import {
  deleteCreditScoreEntry,
  fetchAllCreditScoreEntries,
  insertCreditScoreBatch,
  insertCreditScoreEntry,
} from '@/lib/queries/credit-scores';
import type { CreditScoreEntry, CreditScorePerson, CreditScorePayload } from '@/lib/types';

const PERSON_STORAGE_KEY = 'finance_os_credit_score_person';

function readStoredPerson(): CreditScorePerson {
  if (typeof window === 'undefined') return 'me';
  const stored = localStorage.getItem(PERSON_STORAGE_KEY);
  return stored === 'teria' ? 'teria' : 'me';
}

function DeltaBadge({ delta, className }: { delta: number | null; className?: string }) {
  if (delta == null || delta === 0) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-0.5 text-[10px] font-bold text-[var(--text-muted)]',
          className
        )}
      >
        <Minus size={10} />
        —
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-[10px] font-bold',
        up ? 'text-[var(--accent-positive)]' : 'text-[var(--accent-negative)]',
        className
      )}
    >
      {up ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {up ? '+' : ''}
      {delta}
    </span>
  );
}

function ScoreSlotCard({
  slot,
  latest,
  previous,
  onClick,
}: {
  slot: CreditScoreSlot;
  latest: CreditScoreEntry | undefined;
  previous: CreditScoreEntry | null;
  onClick: () => void;
}) {
  const delta =
    latest && previous ? scoreDelta(latest.score, previous.score) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[5.75rem] flex-col justify-between rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3.5 text-left transition-all hover:bg-[var(--surface-hover)] active:scale-[0.98] touch-manipulation sm:min-h-[6.25rem] sm:p-4"
    >
      <p className="truncate text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
        <span className="sm:hidden">{slot.compactLabel}</span>
        <span className="hidden sm:inline">{slot.shortLabel}</span>
      </p>
      <p className="mt-1 text-2xl font-black tabular-nums text-[var(--text-primary)] sm:text-3xl">
        {latest ? latest.score : '—'}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <DeltaBadge delta={delta} />
        {latest && (
          <span className="text-[10px] font-bold leading-tight text-[var(--text-muted)]">
            <span className="sm:hidden">{format(parseISO(latest.recorded_date), 'M/d/yy')}</span>
            <span className="hidden sm:inline">{formatRecordedDate(latest.recorded_date)}</span>
          </span>
        )}
      </div>
    </button>
  );
}

export function CreditScoresSection() {
  const [person, setPerson] = useState<CreditScorePerson>('me');
  const [entries, setEntries] = useState<CreditScoreEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const [activeSlot, setActiveSlot] = useState<CreditScoreSlot | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    const { data } = await fetchAllCreditScoreEntries();
    setEntries(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    setPerson(readStoredPerson());
    loadEntries();
  }, [loadEntries]);

  function selectPerson(next: CreditScorePerson) {
    setPerson(next);
    localStorage.setItem(PERSON_STORAGE_KEY, next);
  }

  const slots = useMemo(() => getSlotsForPerson(person), [person]);
  const personEntries = useMemo(
    () => entries.filter((e) => e.person === person),
    [entries, person]
  );
  const latestBySlot = useMemo(() => latestEntryPerSlot(personEntries), [personEntries]);

  const groupedSlots = useMemo(() => {
    const groups = new Map<string, CreditScoreSlot[]>();
    for (const slot of slots) {
      const list = groups.get(slot.group) ?? [];
      list.push(slot);
      groups.set(slot.group, list);
    }
    return [...groups.entries()];
  }, [slots]);

  function previousEntryForSlot(slot: CreditScoreSlot): CreditScoreEntry | null {
    const history = entriesForSlot(personEntries, slot);
    if (history.length < 2) return null;
    return history[history.length - 2];
  }

  const activeHistory = activeSlot ? entriesForSlot(personEntries, activeSlot) : [];

  return (
    <>
      <GlassCard>
        <div className="mb-4 flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Gauge size={20} className="shrink-0 text-[var(--accent-blue)]" />
            Credit scores
          </h3>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <div className="flex flex-1 rounded-xl border border-[var(--border)] p-1">
              {(['me', 'teria'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => selectPerson(p)}
                  className={cn(
                    'min-h-11 flex-1 rounded-lg px-3 text-sm font-bold touch-manipulation transition-colors',
                    person === p
                      ? 'bg-[var(--text-primary)] text-[var(--canvas)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  )}
                >
                  {CREDIT_SCORE_PERSON_LABELS[p]}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setIsBatchOpen(true)}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent-blue)] px-4 text-sm font-bold text-white touch-manipulation sm:w-auto sm:shrink-0"
            >
              <Plus size={18} />
              Log scores
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-[var(--text-muted)]">
            <Loader2 className="animate-spin" size={24} />
          </div>
        ) : (
          <div className="space-y-5 sm:space-y-6">
            {groupedSlots.map(([group, groupSlots]) => (
              <div key={group}>
                <p className="mb-2.5 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] sm:mb-3">
                  {group}
                </p>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
                  {groupSlots.map((slot) => {
                    const key = slotKeyFromSlot(slot);
                    const latest = latestBySlot.get(key);
                    return (
                      <ScoreSlotCard
                        key={key}
                        slot={slot}
                        latest={latest}
                        previous={previousEntryForSlot(slot)}
                        onClick={() => setActiveSlot(slot)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      <BatchLogModal
        open={isBatchOpen}
        onOpenChange={setIsBatchOpen}
        person={person}
        slots={slots}
        isSubmitting={isSubmitting}
        onSubmit={async (payloads) => {
          setIsSubmitting(true);
          const { error } = await insertCreditScoreBatch(payloads);
          setIsSubmitting(false);
          if (error) {
            alert(error);
            return;
          }
          setIsBatchOpen(false);
          await loadEntries();
        }}
      />

      <SlotDetailModal
        open={activeSlot != null}
        onOpenChange={(open) => {
          if (!open) setActiveSlot(null);
        }}
        slot={activeSlot}
        history={activeHistory}
        isSubmitting={isSubmitting}
        onAdd={async (payload) => {
          setIsSubmitting(true);
          const { error } = await insertCreditScoreEntry(payload);
          setIsSubmitting(false);
          if (error) {
            alert(error);
            return;
          }
          await loadEntries();
        }}
        onDelete={async (id) => {
          if (!confirm('Delete this score entry?')) return;
          setIsSubmitting(true);
          const { error } = await deleteCreditScoreEntry(id);
          setIsSubmitting(false);
          if (error) {
            alert(error);
            return;
          }
          await loadEntries();
        }}
      />
    </>
  );
}

function BatchLogModal({
  open,
  onOpenChange,
  person,
  slots,
  isSubmitting,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: CreditScorePerson;
  slots: CreditScoreSlot[];
  isSubmitting: boolean;
  onSubmit: (payloads: CreditScorePayload[]) => Promise<void>;
}) {
  const [recordedDate, setRecordedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [scores, setScores] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setRecordedDate(format(new Date(), 'yyyy-MM-dd'));
      setScores({});
    }
  }, [open, person]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payloads: CreditScorePayload[] = [];
    for (const slot of slots) {
      const key = slotKeyFromSlot(slot);
      const score = parseCreditScoreInput(scores[key] ?? '');
      if (score == null) continue;
      payloads.push({
        person: slot.person,
        provider: slot.provider,
        variant: slot.variant,
        score,
        recorded_date: recordedDate,
        notes: null,
      });
    }
    if (payloads.length === 0) {
      alert('Enter at least one score between 300 and 850.');
      return;
    }
    onSubmit(payloads);
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Log scores · ${CREDIT_SCORE_PERSON_LABELS[person]}`}
    >
      <form onSubmit={handleSubmit} className="space-y-4" data-vaul-no-drag>
        <div>
          <label className="mb-1 block text-xs font-bold text-[var(--text-muted)]">
            Date checked
          </label>
          <div className="relative">
            <Calendar
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              type="date"
              value={recordedDate}
              onChange={(e) => setRecordedDate(e.target.value)}
              className="app-input min-h-11 w-full pl-10"
              required
            />
          </div>
        </div>

        <div className="max-h-[min(52vh,24rem)] space-y-3 overflow-y-auto overscroll-contain pr-1">
          {slots.map((slot) => {
            const key = slotKeyFromSlot(slot);
            return (
              <div
                key={key}
                className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3 sm:flex-row sm:items-center sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0"
              >
                <label className="min-w-0 flex-1 text-sm font-semibold leading-snug text-[var(--text-primary)]">
                  {slot.label}
                </label>
                <input
                  type="number"
                  min={300}
                  max={850}
                  inputMode="numeric"
                  placeholder="Score"
                  value={scores[key] ?? ''}
                  onChange={(e) =>
                    setScores((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  className="app-input min-h-11 w-full text-center text-base font-bold tabular-nums sm:w-28"
                />
              </div>
            );
          })}
        </div>

        <p className="text-xs leading-relaxed text-[var(--text-muted)]">
          Leave blank any scores you did not check. Only filled fields will be saved.
        </p>

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--accent-positive)] text-base font-bold text-white disabled:opacity-60 touch-manipulation"
        >
          {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
          Save scores
        </button>
      </form>
    </ResponsiveModal>
  );
}

function SlotDetailModal({
  open,
  onOpenChange,
  slot,
  history,
  isSubmitting,
  onAdd,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot: CreditScoreSlot | null;
  history: CreditScoreEntry[];
  isSubmitting: boolean;
  onAdd: (payload: CreditScorePayload) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [scoreInput, setScoreInput] = useState('');
  const [recordedDate, setRecordedDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => {
    if (open) {
      setScoreInput('');
      setRecordedDate(format(new Date(), 'yyyy-MM-dd'));
    }
  }, [open, slot]);

  if (!slot) return null;

  const latest = history.length > 0 ? history[history.length - 1] : null;
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const delta = latest && previous ? scoreDelta(latest.score, previous.score) : null;

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!slot) return;
    const score = parseCreditScoreInput(scoreInput);
    if (score == null) {
      alert('Enter a score between 300 and 850.');
      return;
    }
    onAdd({
      person: slot.person,
      provider: slot.provider,
      variant: slot.variant,
      score,
      recorded_date: recordedDate,
      notes: null,
    });
    setScoreInput('');
  }

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} title={slot.label}>
      <div className="space-y-5" data-vaul-no-drag>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Latest
            </p>
            <p className="text-4xl font-black tabular-nums sm:text-5xl">
              {latest ? latest.score : '—'}
            </p>
          </div>
          <DeltaBadge delta={delta} className="text-xs sm:text-sm" />
        </div>

        <CreditScoreChart entries={history} />

        <form
          onSubmit={handleAdd}
          className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-xs font-bold text-[var(--text-muted)]">Date</label>
            <input
              type="date"
              value={recordedDate}
              onChange={(e) => setRecordedDate(e.target.value)}
              className="app-input min-h-11 w-full"
              required
            />
          </div>
          <div className="sm:w-28">
            <label className="mb-1 block text-xs font-bold text-[var(--text-muted)]">Score</label>
            <input
              type="number"
              min={300}
              max={850}
              inputMode="numeric"
              value={scoreInput}
              onChange={(e) => setScoreInput(e.target.value)}
              className="app-input min-h-11 w-full text-center text-base font-bold"
              placeholder="742"
              required
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent-positive)] px-4 text-sm font-bold text-white disabled:opacity-60 touch-manipulation sm:w-auto"
          >
            {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
            Add entry
          </button>
        </form>

        {history.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              History
            </p>
            <ul className="max-h-52 space-y-2 overflow-y-auto overscroll-contain">
              {[...history].reverse().map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <span className="text-lg font-black tabular-nums">{entry.score}</span>
                    <span className="ml-2 text-xs font-bold text-[var(--text-muted)]">
                      {formatRecordedDate(entry.recorded_date)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDelete(entry.id)}
                    disabled={isSubmitting}
                    className="flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50 touch-manipulation"
                    aria-label="Delete entry"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ResponsiveModal>
  );
}

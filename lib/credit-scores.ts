import { format, parseISO } from 'date-fns';
import type {
  CreditScoreEntry,
  CreditScorePerson,
  CreditScoreProvider,
  CreditScoreVariant,
} from '@/lib/types';

export const CREDIT_SCORE_PERSON_LABELS: Record<CreditScorePerson, string> = {
  me: 'You',
  teria: 'Teria',
};

export interface CreditScoreSlot {
  person: CreditScorePerson;
  provider: CreditScoreProvider;
  variant: CreditScoreVariant | null;
  label: string;
  shortLabel: string;
  /** Shorter label for narrow score cards on mobile */
  compactLabel: string;
  group: string;
}

const ME_SLOTS: Omit<CreditScoreSlot, 'person'>[] = [
  {
    provider: 'experian',
    variant: '1',
    label: 'Experian',
    shortLabel: 'Experian',
    compactLabel: 'EXP',
    group: 'Bureaus',
  },
  {
    provider: 'experian',
    variant: '2',
    label: 'Equifax',
    shortLabel: 'Equifax',
    compactLabel: 'EQ',
    group: 'Bureaus',
  },
  {
    provider: 'experian',
    variant: '3',
    label: 'TransUnion',
    shortLabel: 'TransUnion',
    compactLabel: 'TU',
    group: 'Bureaus',
  },
  {
    provider: 'credit_karma',
    variant: 'transunion',
    label: 'Credit Karma · TransUnion',
    shortLabel: 'CK · TU',
    compactLabel: 'CK·TU',
    group: 'Credit Karma',
  },
  {
    provider: 'credit_karma',
    variant: 'equifax',
    label: 'Credit Karma · Equifax',
    shortLabel: 'CK · EQ',
    compactLabel: 'CK·EQ',
    group: 'Credit Karma',
  },
  {
    provider: 'chase',
    variant: null,
    label: 'Chase',
    shortLabel: 'Chase',
    compactLabel: 'Chase',
    group: 'Banks',
  },
  {
    provider: 'capital_one',
    variant: null,
    label: 'Capital One',
    shortLabel: 'Cap One',
    compactLabel: 'Cap1',
    group: 'Banks',
  },
];

const TERIA_SLOTS: Omit<CreditScoreSlot, 'person'>[] = ME_SLOTS.filter(
  (s) => s.provider !== 'capital_one'
);

export const CREDIT_SCORE_SLOTS: CreditScoreSlot[] = [
  ...ME_SLOTS.map((s) => ({ ...s, person: 'me' as const })),
  ...TERIA_SLOTS.map((s) => ({ ...s, person: 'teria' as const })),
];

export function creditScoreSlotKey(
  person: CreditScorePerson,
  provider: CreditScoreProvider,
  variant: CreditScoreVariant | null
): string {
  return `${person}:${provider}:${variant ?? ''}`;
}

export function slotKeyFromEntry(entry: Pick<CreditScoreEntry, 'person' | 'provider' | 'variant'>) {
  return creditScoreSlotKey(entry.person, entry.provider, entry.variant);
}

export function slotKeyFromSlot(slot: CreditScoreSlot): string {
  return creditScoreSlotKey(slot.person, slot.provider, slot.variant);
}

export function getSlotsForPerson(person: CreditScorePerson): CreditScoreSlot[] {
  return CREDIT_SCORE_SLOTS.filter((s) => s.person === person);
}

export function findSlotByKey(key: string): CreditScoreSlot | undefined {
  return CREDIT_SCORE_SLOTS.find((s) => slotKeyFromSlot(s) === key);
}

export function latestEntryPerSlot(
  entries: CreditScoreEntry[]
): Map<string, CreditScoreEntry> {
  const map = new Map<string, CreditScoreEntry>();
  for (const entry of entries) {
    const key = slotKeyFromEntry(entry);
    const existing = map.get(key);
    if (
      !existing ||
      entry.recorded_date > existing.recorded_date ||
      (entry.recorded_date === existing.recorded_date &&
        (entry.created_at ?? '') > (existing.created_at ?? ''))
    ) {
      map.set(key, entry);
    }
  }
  return map;
}

export function entriesForSlot(
  entries: CreditScoreEntry[],
  slot: CreditScoreSlot
): CreditScoreEntry[] {
  const key = slotKeyFromSlot(slot);
  return entries
    .filter((e) => slotKeyFromEntry(e) === key)
    .sort((a, b) => {
      if (a.recorded_date !== b.recorded_date) {
        return a.recorded_date.localeCompare(b.recorded_date);
      }
      return (a.created_at ?? '').localeCompare(b.created_at ?? '');
    });
}

export function scoreDelta(current: number, previous: number | null): number | null {
  if (previous == null) return null;
  return current - previous;
}

export function formatRecordedDate(date: string): string {
  return format(parseISO(date), 'MMM d, yyyy');
}

export function parseCreditScoreInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 300 || n > 850) return null;
  return n;
}

export function isValidCreditScore(score: number): boolean {
  return Number.isInteger(score) && score >= 300 && score <= 850;
}

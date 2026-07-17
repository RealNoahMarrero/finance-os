const TRANSFER_PAIR_KEY = 'finance_os_last_transfer_pair';
const SESSION_ACCOUNT_KEY = 'finance_os_last_txn_account';

export interface TransferPair {
  fromAccountId: string;
  toAccountId: string;
}

export function loadLastTransferPair(): TransferPair | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TRANSFER_PAIR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TransferPair;
    if (!parsed?.fromAccountId || !parsed?.toAccountId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLastTransferPair(fromAccountId: string, toAccountId: string) {
  if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) return;
  try {
    localStorage.setItem(
      TRANSFER_PAIR_KEY,
      JSON.stringify({ fromAccountId, toAccountId } satisfies TransferPair)
    );
  } catch {
    /* ignore */
  }
}

export function loadLastTxnAccountId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(SESSION_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

export function saveLastTxnAccountId(accountId: string) {
  if (!accountId) return;
  try {
    localStorage.setItem(SESSION_ACCOUNT_KEY, accountId);
  } catch {
    /* ignore */
  }
}

/**
 * Prefer the current/clicked account as Pay From.
 * Only reuse the last transfer pair for destination (and as from if none preferred).
 */
export function resolveTransferDefaults(
  accountIds: string[],
  preferredFrom?: string
): TransferPair {
  const pair = loadLastTransferPair();
  const valid = new Set(accountIds);

  const from =
    preferredFrom && valid.has(preferredFrom)
      ? preferredFrom
      : pair && valid.has(pair.fromAccountId)
        ? pair.fromAccountId
        : accountIds[0] || '';

  let to = '';
  if (pair) {
    if (pair.toAccountId !== from && valid.has(pair.toAccountId)) {
      to = pair.toAccountId;
    } else if (pair.fromAccountId !== from && valid.has(pair.fromAccountId)) {
      to = pair.fromAccountId;
    }
  }
  if (!to) {
    to = accountIds.find((id) => id !== from) || '';
  }

  return { fromAccountId: from, toAccountId: to };
}

export function resolveOpeningAccountId(
  accountIds: string[],
  preferred?: string | null
): string {
  const valid = new Set(accountIds);
  if (preferred && valid.has(preferred)) return preferred;
  const last = loadLastTxnAccountId();
  if (last && valid.has(last)) return last;
  return accountIds[0] || '';
}

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

/** Apply last transfer pair if both accounts still exist. */
export function resolveTransferDefaults(
  accountIds: string[],
  fallbackFrom?: string
): TransferPair {
  const pair = loadLastTransferPair();
  const valid = new Set(accountIds);

  if (
    pair &&
    valid.has(pair.fromAccountId) &&
    valid.has(pair.toAccountId) &&
    pair.fromAccountId !== pair.toAccountId
  ) {
    return pair;
  }

  const from = fallbackFrom && valid.has(fallbackFrom) ? fallbackFrom : accountIds[0] || '';
  const to = accountIds.find((id) => id !== from) || '';
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

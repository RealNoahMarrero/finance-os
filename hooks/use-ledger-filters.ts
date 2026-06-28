'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  DEFAULT_LEDGER_FILTERS,
  loadLedgerFiltersFromStorage,
  parseLedgerSearchParams,
  saveLedgerFiltersToStorage,
  type LedgerFiltersState,
} from '@/lib/ledger/filters';

export function useLedgerFilters() {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<LedgerFiltersState>(() => ({
    ...DEFAULT_LEDGER_FILTERS,
  }));
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const fromStorage = loadLedgerFiltersFromStorage();
    const fromUrl = parseLedgerSearchParams(searchParams);
    const hasUrlOverrides = Object.keys(fromUrl).length > 0;
    setFilters(
      hasUrlOverrides
        ? { ...fromStorage, ...fromUrl }
        : fromStorage
    );
    setInitialized(true);
  }, [searchParams]);

  useEffect(() => {
    if (!initialized) return;
    saveLedgerFiltersToStorage(filters);
  }, [filters, initialized]);

  const patch = useCallback((partial: Partial<LedgerFiltersState>) => {
    setFilters((prev) => ({ ...prev, ...partial }));
  }, []);

  const reset = useCallback(() => {
    setFilters({ ...DEFAULT_LEDGER_FILTERS });
  }, []);

  return { filters, patch, reset, initialized };
}

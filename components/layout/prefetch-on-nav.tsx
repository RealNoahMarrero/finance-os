'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { prefetchCoreFinanceData } from '@/hooks/use-finance-queries';

/** Warm shared finance caches once when the app shell mounts. */
export function PrefetchOnNav() {
  const qc = useQueryClient();

  useEffect(() => {
    prefetchCoreFinanceData(qc);
  }, [qc]);

  return null;
}

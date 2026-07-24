'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useEntity } from '@/app/providers/entity-provider';
import { prefetchCoreFinanceData } from '@/hooks/use-finance-queries';

/** Warm shared finance caches once when the app shell mounts / entity changes. */
export function PrefetchOnNav() {
  const qc = useQueryClient();
  const { entityId } = useEntity();

  useEffect(() => {
    prefetchCoreFinanceData(qc, entityId);
  }, [qc, entityId]);

  return null;
}

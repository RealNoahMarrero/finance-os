import { Suspense } from 'react';
import { LedgerView } from '@/features/ledger/ledger-view';
import { PageSkeleton } from '@/components/ui/skeleton';

export default function LedgerPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LedgerView />
    </Suspense>
  );
}

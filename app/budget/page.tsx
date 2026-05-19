import { Suspense } from 'react';
import { BudgetView } from '@/features/budget/budget-view';
import { PageSkeleton } from '@/components/ui/skeleton';

export default function BudgetPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <BudgetView />
    </Suspense>
  );
}

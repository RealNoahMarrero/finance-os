'use client';

import * as React from 'react';
import { Sheet } from '@/components/ui/sheet';
import { Dialog } from '@/components/ui/dialog';

export function ResponsiveModal({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: React.ReactNode;
}) {
  const [isDesktop, setIsDesktop] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mq.matches);
    const handler = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange} title={title}>
        {children}
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
      {children}
    </Sheet>
  );
}

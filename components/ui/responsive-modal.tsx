'use client';

import * as React from 'react';
import { Sheet } from '@/components/ui/sheet';
import { Dialog } from '@/components/ui/dialog';

type LayoutMode = 'sheet' | 'dialog';

function resolveLayoutMode(): LayoutMode {
  if (typeof window === 'undefined') return 'dialog';
  return window.matchMedia('(min-width: 1024px)').matches ? 'dialog' : 'sheet';
}

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
  const layoutRef = React.useRef<LayoutMode | null>(null);
  const [layout, setLayout] = React.useState<LayoutMode>(() => resolveLayoutMode());

  React.useEffect(() => {
    if (layoutRef.current == null) {
      layoutRef.current = resolveLayoutMode();
      setLayout(layoutRef.current);
    }
  }, []);

  if (!open) return null;

  if (layout === 'dialog') {
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

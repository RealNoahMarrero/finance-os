'use client';

import { Zap } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Fab({
  onClick,
  className,
  visible = true,
}: {
  onClick: () => void;
  className?: string;
  visible?: boolean;
}) {
  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'fixed right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full',
        'gradient-positive text-white shadow-lg shadow-emerald-500/30',
        'touch-manipulation active:scale-95 transition-transform lg:hidden',
        'bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom)+0.75rem)]',
        className
      )}
      aria-label="Quick entry"
    >
      <Zap size={24} />
    </button>
  );
}

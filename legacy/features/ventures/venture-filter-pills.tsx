'use client';

import { cn } from '@/lib/cn';
import type { Venture } from '@/lib/types';

export type VentureFilterValue = 'all' | 'overhead' | number;

export function VentureFilterPills({
  ventures,
  value,
  onChange,
  className,
}: {
  ventures: Venture[];
  value: VentureFilterValue;
  onChange: (value: VentureFilterValue) => void;
  className?: string;
}) {
  const pills: { id: VentureFilterValue; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'overhead', label: 'Overhead' },
    ...ventures.map((v) => ({ id: v.id as VentureFilterValue, label: v.name })),
  ];

  return (
    <div
      className={cn(
        '-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className
      )}
    >
      {pills.map((p) => {
        const active = value === p.id;
        return (
          <button
            key={String(p.id)}
            type="button"
            onClick={() => onChange(p.id)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition-colors touch-manipulation',
              active
                ? 'bg-[var(--entity-accent)] text-white'
                : 'bg-[var(--surface-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            )}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

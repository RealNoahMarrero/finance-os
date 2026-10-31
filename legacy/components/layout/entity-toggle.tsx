'use client';

import { Building2, User } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useEntity } from '@/app/providers/entity-provider';
import type { EntityId } from '@/lib/types';

type EntityToggleProps = {
  className?: string;
  /** Compact for mobile header strip */
  size?: 'sm' | 'md';
};

export function EntityToggle({ className, size = 'md' }: EntityToggleProps) {
  const { entityId, setEntityId } = useEntity();

  const options: { id: EntityId; label: string; icon: typeof User }[] = [
    { id: 'personal', label: 'Personal', icon: User },
    { id: 'business', label: 'Business', icon: Building2 },
  ];

  return (
    <div
      role="group"
      aria-label="Finance books"
      className={cn(
        'inline-flex rounded-xl border border-[var(--border)] bg-[var(--surface-glass)] p-0.5 backdrop-blur-xl',
        className
      )}
    >
      {options.map(({ id, label, icon: Icon }) => {
        const active = entityId === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setEntityId(id)}
            aria-pressed={active}
            className={cn(
              'flex items-center gap-1.5 rounded-lg font-bold transition-colors touch-manipulation',
              size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm',
              active
                ? 'bg-[var(--entity-accent)] text-white shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            )}
          >
            <Icon size={size === 'sm' ? 14 : 16} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

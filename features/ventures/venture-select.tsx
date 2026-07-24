'use client';

import type { Venture } from '@/lib/types';

export function VentureSelect({
  ventures,
  value,
  onChange,
  label = 'Venture',
  allowEmpty = true,
  emptyLabel = 'General / Overhead',
  className,
}: {
  ventures: Venture[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </label>
      <select
        className="app-select w-full cursor-pointer rounded-xl border border-[var(--border)] p-3 text-sm font-bold text-[var(--text-primary)] outline-none focus:border-[var(--entity-accent)]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {ventures.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    </div>
  );
}

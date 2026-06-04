import { cn } from '@/lib/cn';

export function StatHero({
  label,
  value,
  sublabel,
  variant = 'default',
  className,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  variant?: 'default' | 'positive' | 'negative' | 'hero';
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-full min-h-[8.5rem] flex-col rounded-[var(--radius-card)] p-5 md:p-6',
        variant === 'hero' && 'gradient-hero text-white',
        variant === 'positive' && 'gradient-positive text-white',
        variant === 'negative' && 'gradient-negative text-white',
        variant === 'default' && 'glass-card',
        className
      )}
    >
      <p
        className={cn(
          'text-xs font-bold uppercase tracking-widest mb-2',
          variant === 'default' ? 'text-[var(--text-muted)]' : 'text-white/70'
        )}
      >
        {label}
      </p>
      <div
        className={cn(
          'min-w-0 flex-1 font-black tracking-tighter tabular-nums leading-tight',
          valueClassName ??
            'text-[clamp(1.35rem,3.5vw,2.25rem)]',
          variant === 'default' && 'text-[var(--text-primary)]'
        )}
      >
        {value}
      </div>
      {sublabel && (
        <div
          className={cn(
            'mt-auto pt-3 text-sm font-medium',
            variant === 'default' ? 'text-[var(--text-muted)]' : 'text-white/80'
          )}
        >
          {sublabel}
        </div>
      )}
    </div>
  );
}

import { cn } from '@/lib/cn';

export function StatHero({
  label,
  value,
  sublabel,
  variant = 'default',
  className,
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  variant?: 'default' | 'positive' | 'negative' | 'hero';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] p-5 md:p-6',
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
          'font-black tracking-tighter text-4xl md:text-5xl lg:text-6xl',
          variant === 'default' && 'text-[var(--text-primary)]'
        )}
      >
        {value}
      </div>
      {sublabel && (
        <div
          className={cn(
            'mt-3 text-sm font-medium',
            variant === 'default' ? 'text-[var(--text-muted)]' : 'text-white/80'
          )}
        >
          {sublabel}
        </div>
      )}
    </div>
  );
}

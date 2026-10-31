import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
  {
    variants: {
      variant: {
        default: 'bg-[var(--border)] text-[var(--text-muted)]',
        positive: 'bg-emerald-500/15 text-[var(--accent-positive)]',
        negative: 'bg-red-500/15 text-[var(--accent-negative)]',
        gold: 'bg-gradient-to-br from-yellow-400 to-amber-500 text-white',
        blue: 'bg-blue-500/15 text-[var(--accent-blue)]',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

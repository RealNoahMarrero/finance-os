import { cn } from '@/lib/cn';

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('app-select touch-manipulation', className)} {...props} />;
}

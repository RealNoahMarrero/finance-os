import * as React from 'react';
import { cn } from '@/lib/cn';

export function GlassCard({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('glass-card p-5 md:p-6', className)} {...props}>
      {children}
    </div>
  );
}

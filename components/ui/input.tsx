import * as React from 'react';
import { cn } from '@/lib/cn';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'w-full min-h-12 px-4 rounded-2xl font-semibold text-[var(--text-primary)]',
      'bg-[var(--surface)] border border-[var(--border)]',
      'placeholder:text-[var(--text-muted)] outline-none',
      'focus:border-[var(--accent-blue)] focus:ring-2 focus:ring-[var(--accent-blue)]/20',
      'touch-manipulation',
      className
    )}
    {...props}
  />
));
Input.displayName = 'Input';

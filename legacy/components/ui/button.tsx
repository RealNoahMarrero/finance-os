'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-2xl font-bold transition-all touch-manipulation disabled:opacity-50 disabled:pointer-events-none min-h-12 px-5 text-sm active:scale-[0.98]',
  {
    variants: {
      variant: {
        primary:
          'gradient-positive text-white shadow-lg shadow-emerald-500/20 hover:brightness-105',
        secondary:
          'bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border)] hover:bg-[var(--border)]',
        ghost:
          'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]',
        destructive:
          'gradient-negative text-white shadow-lg shadow-red-500/20',
        outline:
          'border-2 border-[var(--border)] bg-transparent text-[var(--text-primary)]',
      },
      size: {
        default: 'min-h-12 px-5',
        sm: 'min-h-10 px-4 text-xs rounded-xl',
        lg: 'min-h-14 px-8 text-base rounded-2xl',
        icon: 'h-12 w-12 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />
  );
}

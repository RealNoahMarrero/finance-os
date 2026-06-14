'use client';

import * as React from 'react';
import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground handleOnly>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm" />
        <Drawer.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-[100] mt-24 flex max-h-[92dvh] flex-col rounded-t-[1.75rem] bg-[var(--canvas)] outline-none',
            'lg:inset-auto lg:left-1/2 lg:top-1/2 lg:bottom-auto lg:w-full lg:max-w-lg lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[var(--radius-card)] lg:max-h-[90vh]',
            className
          )}
        >
          <Drawer.Handle className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-[var(--border)] lg:hidden" />
          {title && (
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
              <Drawer.Title className="text-lg font-bold text-[var(--text-primary)]">
                {title}
              </Drawer.Title>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--border)] touch-manipulation"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
          )}
          <div
            className="flex-1 overflow-y-auto hide-scrollbar p-5 safe-bottom overscroll-contain touch-pan-y"
            data-vaul-no-drag
          >
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

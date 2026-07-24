'use client';

import { BottomNav } from '@/components/layout/bottom-nav';
import { EntityToggle } from '@/components/layout/entity-toggle';
import { PrefetchOnNav } from '@/components/layout/prefetch-on-nav';
import { TopBar } from '@/components/layout/top-bar';
import { Toaster } from 'sonner';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PrefetchOnNav />
      <div className="mx-auto min-h-dvh w-full max-w-6xl px-4 pt-4 md:px-6 md:pt-6 lg:px-8">
        <TopBar />
        {/* Mobile entity switch — desktop toggle lives in TopBar */}
        <div className="mb-4 flex justify-center lg:hidden">
          <EntityToggle size="sm" />
        </div>
        <main className="pb-nav">{children}</main>
      </div>
      <BottomNav />
      <Toaster position="top-center" richColors closeButton />
    </>
  );
}

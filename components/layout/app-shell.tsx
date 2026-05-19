'use client';

import { usePathname } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { BottomNav } from '@/components/layout/bottom-nav';
import { TopBar } from '@/components/layout/top-bar';
import { Toaster } from 'sonner';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  return (
    <>
      <div className="mx-auto min-h-dvh w-full max-w-6xl px-4 pt-4 md:px-6 md:pt-6 lg:px-8">
        <TopBar />
        <motion.main
          key={pathname}
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="pb-nav"
        >
          {children}
        </motion.main>
      </div>
      <BottomNav />
      <Toaster position="top-center" richColors closeButton />
    </>
  );
}

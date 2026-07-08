'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { prefetchRouteData } from '@/hooks/use-finance-queries';
import {
  PieChart,
  LayoutGrid,
  ListOrdered,
  Calendar,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/cn';

const navItems = [
  { name: 'Home', path: '/', icon: PieChart },
  { name: 'Budget', path: '/budget', icon: LayoutGrid },
  { name: 'Ledger', path: '/ledger', icon: ListOrdered },
  { name: 'Calendar', path: '/calendar', icon: Calendar },
  { name: 'Insights', path: '/reports', icon: BarChart3 },
];

export function BottomNav() {
  const pathname = usePathname();
  const queryClient = useQueryClient();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface-glass)] backdrop-blur-xl lg:hidden safe-bottom"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-1 pt-1">
        {navItems.map((item) => {
          const isActive =
            item.path === '/'
              ? pathname === '/'
              : pathname.startsWith(item.path);
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              href={item.path}
              onMouseEnter={() => prefetchRouteData(queryClient, item.path)}
              onFocus={() => prefetchRouteData(queryClient, item.path)}
              onTouchStart={() => prefetchRouteData(queryClient, item.path)}
              className={cn(
                'flex min-h-[3rem] min-w-[3rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 touch-manipulation transition-colors',
                isActive
                  ? 'text-[var(--accent-positive)]'
                  : 'text-[var(--text-muted)]'
              )}
            >
              <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[10px] font-bold">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

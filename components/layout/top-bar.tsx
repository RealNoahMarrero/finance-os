'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { prefetchRouteData } from '@/hooks/use-finance-queries';
import { useTheme } from 'next-themes';
import {
  PieChart,
  LayoutGrid,
  ListOrdered,
  Calendar,
  BarChart3,
  Sun,
  Moon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { EntityToggle } from '@/components/layout/entity-toggle';
import { useEntity } from '@/app/providers/entity-provider';

const navItems = [
  { name: 'Home', path: '/', icon: PieChart },
  { name: 'Budget', path: '/budget', icon: LayoutGrid },
  { name: 'Ledger', path: '/ledger', icon: ListOrdered },
  { name: 'Calendar', path: '/calendar', icon: Calendar },
  { name: 'Insights', path: '/reports', icon: BarChart3 },
];

export function TopBar() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const { entityLabel, isBusiness, entityId } = useEntity();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <header className="mb-6 hidden lg:block">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col">
          <Link href="/" className="text-2xl font-extrabold tracking-tight">
            Finance
            <span className="text-[var(--entity-accent)]">OS</span>
          </Link>
          <span className="text-xs font-bold text-[var(--text-muted)]">
            {isBusiness ? 'Marrero LLC · ' : ''}
            {entityLabel}
          </span>
        </div>
        <nav className="flex items-center gap-1 rounded-2xl border border-[var(--border)] bg-[var(--surface-glass)] p-1 backdrop-blur-xl">
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
                onMouseEnter={() => prefetchRouteData(queryClient, item.path, entityId)}
                onFocus={() => prefetchRouteData(queryClient, item.path, entityId)}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors',
                  isActive
                    ? 'bg-[var(--text-primary)] text-[var(--canvas)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                )}
              >
                <Icon size={16} />
                {item.name}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <EntityToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
          >
            {mounted && theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </Button>
        </div>
      </div>
    </header>
  );
}

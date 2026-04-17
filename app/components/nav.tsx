'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PieChart, LayoutGrid, ListOrdered, Calendar as CalendarIcon } from 'lucide-react';

export default function Navigation() {
  const pathname = usePathname();

  const navItems = [
    { name: 'Dashboard', path: '/', icon: PieChart },
    { name: 'Budget', path: '/budget', icon: LayoutGrid },
    { name: 'Ledger', path: '/ledger', icon: ListOrdered },
    { name: 'Calendar', path: '/calendar', icon: CalendarIcon },
  ];

  return (
    <div className="flex flex-wrap justify-center md:justify-start gap-2 mb-8 bg-white p-2 rounded-2xl shadow-sm border border-slate-100 w-fit mx-auto md:mx-0">
      {navItems.map(item => {
        const isActive = pathname === item.path;
        const Icon = item.icon;
        return (
          <Link 
            key={item.path} 
            href={item.path} 
            className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-colors ${isActive ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}`}
          >
            <Icon size={16}/> {item.name}
          </Link>
        );
      })}
    </div>
  );
}
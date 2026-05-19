'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { 
  ChevronLeft, ChevronRight, Calendar as CalendarIcon, 
  AlertTriangle, CheckCircle2, CircleDashed 
} from 'lucide-react';
import { 
  format, addMonths, subMonths, startOfMonth, endOfMonth, 
  startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay, isBefore, startOfDay, parseISO
} from 'date-fns';
import { formatMoney, snapMoney } from '@/lib/money';
import { motion, AnimatePresence } from 'framer-motion';
import { PageSkeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';

export function CalendarView() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [monthDirection, setMonthDirection] = useState(1);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    // Fetch all active categories that have a due date
    const { data } = await supabase
      .from('categories')
      .select('*')
      .eq('is_hidden', false)
      .not('due_date', 'is', null);
      
    if (data) setCategories(data);
    setLoading(false);
  }

  const nextMonth = () => {
    setMonthDirection(1);
    setCurrentMonth(addMonths(currentMonth, 1));
  };
  const prevMonth = () => {
    setMonthDirection(-1);
    setCurrentMonth(subMonths(currentMonth, 1));
  };
  const jumpToToday = () => setCurrentMonth(new Date());

  // Calendar Grid Generation
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const calendarDays = [];
  let day = startDate;
  while (day <= endDate) {
    calendarDays.push(day);
    day = addDays(day, 1);
  }

  const today = startOfDay(new Date());

  // Math for the header stats
  const currentMonthBills = categories.filter(c => c.due_date && isSameMonth(parseISO(c.due_date), currentMonth));
  const totalDueThisMonth = snapMoney(currentMonthBills.reduce((sum, c) => sum + Number(c.target_amount), 0));
  const totalFundedThisMonth = snapMoney(currentMonthBills.reduce((sum, c) => sum + Number(c.assigned_amount), 0));

  if (loading) return <PageSkeleton />;

  return (
    <>
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-[var(--text-primary)] tracking-tight flex items-center gap-3">
              Calendar
          </h1>
        </div>
        
        <div className="flex items-center gap-2 app-card p-1 rounded-xl border border-[var(--border)] shadow-sm">
            <button onClick={prevMonth} className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] rounded-lg transition-colors"><ChevronLeft size={20}/></button>
            <button onClick={jumpToToday} className="px-4 py-2 text-sm font-bold text-[var(--text-primary)] hover:text-[var(--text-primary)] transition-colors">{format(currentMonth, 'MMMM yyyy')}</button>
            <button onClick={nextMonth} className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] rounded-lg transition-colors"><ChevronRight size={20}/></button>
        </div>
      </div>

      {/* QUICK STATS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="app-card p-4 rounded-2xl shadow-sm border border-[var(--border)] flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center"><CalendarIcon size={24}/></div>
              <div>
                  <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Due in {format(currentMonth, 'MMMM')}</p>
                  <p className="text-2xl font-black text-[var(--text-primary)]">${formatMoney(totalDueThisMonth)}</p>
              </div>
          </div>
          <div className="app-card p-4 rounded-2xl shadow-sm border border-[var(--border)] flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-500 flex items-center justify-center"><CheckCircle2 size={24}/></div>
              <div>
                  <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Funded</p>
                  <p className="text-2xl font-black text-[var(--text-primary)]">${formatMoney(totalFundedThisMonth)}</p>
              </div>
          </div>
      </div>

      {/* CALENDAR GRID */}
      <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={format(currentMonth, 'yyyy-MM')}
        initial={{ opacity: 0, x: monthDirection * 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: monthDirection * -24 }}
        transition={{ duration: 0.2 }}
        className="bg-[var(--border)] border border-[var(--border)] rounded-3xl overflow-hidden shadow-sm"
      >
        {/* Days of Week */}
        <div className="grid grid-cols-7 gap-px bg-[var(--border)] border-b border-[var(--border)]">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="bg-[var(--surface-subtle)] py-3 text-center text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">
                <span className="hidden md:inline">{d}</span>
                <span className="md:hidden">{d.charAt(0)}</span>
            </div>
          ))}
        </div>

        {/* Calendar Cells */}
        <div className="grid grid-cols-7 gap-px bg-[var(--border)]">
          {calendarDays.map((day, i) => {
            const isCurrentMonth = isSameMonth(day, currentMonth);
            const isToday = isSameDay(day, today);
            
            // Find bills due on this exact day
            const dayBills = categories.filter(c => c.due_date === format(day, 'yyyy-MM-dd'));

            return (
              <div key={i} className={`min-h-[100px] md:min-h-[140px] app-card p-1 md:p-2 transition-colors ${!isCurrentMonth ? 'opacity-40 bg-[var(--surface-subtle)]' : 'hover:bg-[var(--surface-hover)]'}`}>
                
                <div className={`text-right text-xs md:text-sm font-bold w-6 h-6 flex items-center justify-center rounded-full ml-auto ${isToday ? 'bg-blue-500 text-white shadow-md' : 'text-[var(--text-muted)]'}`}>
                    {format(day, 'd')}
                </div>
                
                <div className="mt-1 md:mt-2 flex flex-col gap-1">
                  {dayBills.map(bill => {
                      const isPastDue = isBefore(parseISO(bill.due_date), today);
                      const isFullyFunded = Number(bill.assigned_amount) >= Number(bill.target_amount);

                      let statusClass = "bg-[var(--surface-subtle)] border-[var(--border)] text-[var(--text-muted)]"; // Default
                      if (bill.is_asap || (isPastDue && !isFullyFunded)) statusClass = "bg-red-500/10 border-red-500/30 text-red-700 shadow-sm"; // Emergency
                      else if (isFullyFunded && bill.target_amount > 0) statusClass = "bg-gradient-to-br from-yellow-400 to-amber-500 text-white border-amber-500 shadow-sm"; // Gold Gamification Sync

                      return (
                          <Link
                            key={bill.id}
                            href={`/budget?category=${bill.id}`}
                            className={`px-1.5 py-1 md:p-1.5 rounded border text-[9px] md:text-xs font-bold flex flex-col xl:flex-row xl:items-center justify-between gap-0.5 xl:gap-2 truncate touch-manipulation hover:brightness-95 active:scale-[0.98] transition-all ${statusClass}`}
                          >
                              <div className="flex items-center gap-1 truncate">
                                  <span>{bill.emoji}</span>
                                  <span className="truncate max-w-[4rem] sm:max-w-none">{bill.name}</span>
                              </div>
                              <span className="font-black xl:ml-auto">${formatMoney(bill.target_amount)}</span>
                          </Link>
                      );
                  })}
                </div>

              </div>
            );
          })}
        </div>
      </motion.div>
      </AnimatePresence>

    </>
  );
}
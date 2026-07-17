'use client';
import { useEffect, useState, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { 
  FolderPlus, Plus, X, Save, Trash2, Edit2, 
  ChevronDown, ChevronRight, Target, LayoutGrid, 
  Wallet, Calendar, FileText, Repeat, AlignLeft, PieChart,
  ArrowUpDown, AlertCircle, AlertTriangle, ArrowRightLeft,
  FastForward, ListOrdered, Filter, Download, Activity, Archive, RotateCcw,
  ChevronUp
} from 'lucide-react';
import { format, parseISO, addWeeks, addMonths, addYears, isAfter } from 'date-fns';
import { formatMoney, formatMoneyInput, roundMoney, snapMoney, MONEY_EPSILON } from '@/lib/money';
import { motion, AnimatePresence } from 'framer-motion';
import { PageSkeleton } from '@/components/ui/skeleton';
import { Select } from '@/components/ui/select';
import { useReadyToAssign } from '@/hooks/use-ready-to-assign';
import {
  useAccounts,
  useCategories,
  useCategoryGroups,
  useInvalidateFinance,
  usePendingProjectedIncome,
} from '@/hooks/use-finance-queries';

import {
  displayReadyToAssign,
  RtaBannerExtras,
  rtaIsNegative,
} from '@/components/budget/rta-banner-extras';
import type { Account, Category, CategoryGroup, ProjectedIncome } from '@/lib/types';

const ExportModal = dynamic(
  () => import('@/features/export/export-modal').then((m) => m.ExportModal),
  { ssr: false }
);

function transferErrorMessage(error: { message?: string; hint?: string }) {
  const msg = error.message ?? 'Unknown error';
  if (/failed to fetch/i.test(msg)) {
    return [
      'Could not reach Supabase (network error).',
      'Check your internet, hard-refresh the page, and disable ad blockers for this site.',
      'In DevTools → Network, look for a failed PATCH to supabase.co.',
    ].join('\n\n');
  }
  return error.hint ? `${msg}\n\n${error.hint}` : msg;
}

export function BudgetView() {
  const searchParams = useSearchParams();
  const openedFromUrl = useRef(false);
  const expandedInitialized = useRef(false);
  const { patchCategories, patchCategoryGroups, invalidateAfterBudgetChange } =
    useInvalidateFinance();
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const { data: categories = [], isLoading: categoriesLoading } = useCategories();
  const { data: groups = [], isLoading: groupsLoading } = useCategoryGroups();
  const { data: pendingProjected = [] } = usePendingProjectedIncome();
  const [reorderingGroups, setReorderingGroups] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  // UI States (Persistent)
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [categorySort, setCategorySort] = useState('default');
  const [categoryFilter, setCategoryFilter] = useState('all');

  // Modals & Forms
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [groupFormName, setGroupFormName] = useState('');

  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [showArchivedSection, setShowArchivedSection] = useState(false);
  const [catForm, setCatForm] = useState({
    group_id: '', name: '', emoji: '', 
    target_type: 'Set Aside', target_amount: '', 
    due_date: '', is_repeating: false, target_period: 'Monthly', end_date: '', notes: '',
    is_debt: false, balance: '', is_asap: false, is_hidden: false
  });

  // Funding Mode States
  const [fundingCatId, setFundingCatId] = useState<number | null>(null);
  const [fundingAmount, setFundingAmount] = useState('');

  // Transfer Mode States
  const [transferForm, setTransferForm] = useState({
      fromCatId: '', toCatId: 'RTA', amount: ''
  });
  const [transferring, setTransferring] = useState(false);

  const liquidCash = useMemo(
    () =>
      snapMoney(
        accounts
          .filter((a) => ['Checking', 'Savings', 'Cash'].includes(a.type))
          .reduce((sum, a) => sum + Number(a.balance), 0)
      ),
    [accounts]
  );

  const pageLoading = accountsLoading || categoriesLoading || groupsLoading;

  useEffect(() => {
    if (groups.length === 0 || expandedInitialized.current) return;
    expandedInitialized.current = true;
    const savedExpanded = localStorage.getItem('finance_os_expanded');
    if (savedExpanded) {
      setExpandedGroups(new Set(JSON.parse(savedExpanded)));
    } else {
      setExpandedGroups(new Set(groups.map((group) => group.id)));
    }
  }, [groups]);

  useEffect(() => { 
      // Load persistent filters and sorts
      const savedSort = localStorage.getItem('finance_os_sort');
      if (savedSort) setCategorySort(savedSort);

      const savedFilter = localStorage.getItem('finance_os_filter');
      if (savedFilter) setCategoryFilter(savedFilter);
  }, []);

  useEffect(() => {
      if (pageLoading || openedFromUrl.current) return;
      const categoryId = searchParams.get('category');
      if (!categoryId || categories.length === 0) return;
      const cat = categories.find((c) => c.id.toString() === categoryId);
      if (!cat) return;
      openedFromUrl.current = true;
      setExpandedGroups((prev) => new Set([...prev, cat.group_id]));
      setEditingCatId(cat.id);
      setCatForm({
          group_id: cat.group_id.toString(),
          name: cat.name,
          emoji: cat.emoji || '',
          target_type: cat.target_type || 'Set Aside',
          target_amount: cat.target_amount ? cat.target_amount.toString() : '',
          due_date: cat.due_date || '',
          is_repeating: cat.is_repeating || false,
          target_period: cat.target_period || 'Monthly',
          end_date: cat.end_date || '',
          notes: cat.notes || '',
          is_debt: cat.is_debt || false,
          balance: cat.balance ? cat.balance.toString() : '',
          is_asap: cat.is_asap || false,
          is_hidden: !!cat.is_hidden,
      });
      setIsCategoryModalOpen(true);
  }, [pageLoading, categories, searchParams]);

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      setCategorySort(val);
      localStorage.setItem('finance_os_sort', val);
  };

  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      setCategoryFilter(val);
      localStorage.setItem('finance_os_filter', val);
  };

  const toggleGroup = (id: number) => {
      const next = new Set(expandedGroups);
      if (next.has(id)) next.delete(id); else next.add(id);
      setExpandedGroups(next);
      localStorage.setItem('finance_os_expanded', JSON.stringify(Array.from(next)));
  };

  async function refreshBudgetData() {
    await invalidateAfterBudgetChange();
  }

  // --- FUNDING & INLINE MATH LOGIC ---
  function openFundingMode(e: React.MouseEvent, cat: any) {
      e.stopPropagation();
      setFundingCatId(cat.id);
      
      // Feature 2: Floating-Point Math Fix
      // Round to 2 decimal places to prevent microscopic remainders from breaking the UI
      const cleanBalance = formatMoney(cat.assigned_amount || 0);
      setFundingAmount(cleanBalance);
  }

  async function saveFunding(e: React.FormEvent) {
      e.preventDefault();
      if (!fundingCatId) return;

      const cat = categories.find(c => c.id === fundingCatId);
      if (!cat) return;

      let newAmount = Number(cat.assigned_amount || 0);
      try {
          let cleanMath = fundingAmount.replace(/[^0-9+\-*/.]/g, '');
          if (cleanMath.startsWith('+') || cleanMath.startsWith('-')) {
              cleanMath = `${newAmount}${cleanMath}`;
          }
          if (cleanMath) {
              newAmount = new Function(`return ${cleanMath}`)();
          }
      } catch (err) {
          newAmount = parseFloat(fundingAmount) || 0;
      }

      newAmount = roundMoney(newAmount);

      const { error } = await supabase
        .from('categories')
        .update({ assigned_amount: newAmount })
        .eq('id', fundingCatId);

      if (!error) {
          patchCategories((cats) =>
            cats.map((c) => (c.id === fundingCatId ? { ...c, assigned_amount: newAmount } : c))
          );
      }
      setFundingCatId(null);
  }

  const visibleCategories = categories.filter((c) => !c.is_hidden);

  const {
    readyToAssign,
    totalOverspent,
    assignableReadyToAssign,
    projectedAssignableReadyToAssign,
    conservativeAssignableRta,
    pendingInflow,
    guaranteedInflow,
    anticipatedInflow,
  } = useReadyToAssign(accounts, categories, pendingProjected);

  const shownReadyToAssign = displayReadyToAssign(
    readyToAssign,
    assignableReadyToAssign,
    totalOverspent
  );
  const rtaNegative = rtaIsNegative(
    readyToAssign,
    assignableReadyToAssign,
    totalOverspent
  );

  // --- TRANSFER LOGIC ---
  const swapTransferDirection = () => {
      setTransferForm(prev => ({
          ...prev,
          fromCatId: prev.toCatId,
          toCatId: prev.fromCatId
      }));
  };

  async function executeTransfer(e: React.FormEvent) {
      e.preventDefault();
      if (transferring) return;

      const amt = roundMoney(parseFloat(transferForm.amount) || 0);
      if (amt <= 0) {
          alert('Enter an amount greater than zero.');
          return;
      }

      const fromId = transferForm.fromCatId;
      const toId = transferForm.toCatId;

      if (!fromId || !toId) {
          alert('Choose both a source and destination.');
          return;
      }
      if (fromId === toId) {
          alert('Source and destination must be different.');
          return;
      }

      setTransferring(true);
      let updatedCategories = [...categories];
      let sourceRollback: { id: number; assigned_amount: number } | null = null;

      try {
          // Handle DEDUCTION from Source
          if (fromId !== 'RTA') {
              const sourceCat = updatedCategories.find(c => c.id.toString() === fromId);
              if (sourceCat) {
                  const previousAmt = roundMoney(Number(sourceCat.assigned_amount) || 0);
                  const newAmt = roundMoney(previousAmt - amt);
                  const { error } = await supabase.from('categories').update({ assigned_amount: newAmt }).eq('id', sourceCat.id);
                  if (error) {
                      alert(`Could not move funds: ${transferErrorMessage(error)}`);
                      return;
                  }
                  sourceRollback = { id: sourceCat.id, assigned_amount: previousAmt };
                  updatedCategories = updatedCategories.map(c =>
                    c.id.toString() === fromId ? { ...c, assigned_amount: newAmt } : c
                  );
              }
          }

          // Handle ADDITION to Destination
          if (toId !== 'RTA') {
              const destCat = updatedCategories.find(c => c.id.toString() === toId);
              if (destCat) {
                  const newAmt = roundMoney((Number(destCat.assigned_amount) || 0) + amt);
                  const { error } = await supabase.from('categories').update({ assigned_amount: newAmt }).eq('id', destCat.id);
                  if (error) {
                      if (sourceRollback) {
                          await supabase
                            .from('categories')
                            .update({ assigned_amount: sourceRollback.assigned_amount })
                            .eq('id', sourceRollback.id);
                      }
                      alert(`Could not move funds: ${transferErrorMessage(error)}`);
                      return;
                  }
                  updatedCategories = updatedCategories.map(c =>
                    c.id.toString() === toId ? { ...c, assigned_amount: newAmt } : c
                  );
              }
          }

          patchCategories(() => updatedCategories);
          setIsTransferModalOpen(false);
      } finally {
          setTransferring(false);
      }
  }

  // --- DUE DATE ADVANCER (REPEATING GOALS) ---
  async function advanceDate(e: React.MouseEvent, cat: any) {
      e.stopPropagation();
      if (!cat.due_date || !cat.is_repeating || cat.target_period === 'None') return;

      let current = parseISO(cat.due_date);
      let nextDate = current;

      if (cat.target_period === 'Weekly') nextDate = addWeeks(current, 1);
      else if (cat.target_period === 'Bi-Weekly') nextDate = addWeeks(current, 2);
      else if (cat.target_period === 'Monthly') nextDate = addMonths(current, 1);
      else if (cat.target_period === 'Yearly') nextDate = addYears(current, 1);

      let payload: any = { due_date: format(nextDate, 'yyyy-MM-dd') };

      if (cat.end_date && isAfter(nextDate, parseISO(cat.end_date))) {
          payload = { is_hidden: true };
          alert(`Final payment reached! ${cat.name} has been archived and removed from the active budget.`);
      }

      const { error } = await supabase.from('categories').update(payload).eq('id', cat.id);
      if (!error) {
          patchCategories((cats) =>
            cats.map((c) => (c.id === cat.id ? { ...c, ...payload } : c))
          );
      }
  }

  // --- GROUP ACTIONS ---
  function openGroupModal(group: any = null) {
      if (group) { setEditingGroupId(group.id); setGroupFormName(group.name); } 
      else { setEditingGroupId(null); setGroupFormName(''); }
      setIsGroupModalOpen(true);
  }

  async function saveGroup(e: React.FormEvent) {
      e.preventDefault();
      if (editingGroupId) {
          const { error } = await supabase.from('category_groups').update({ name: groupFormName }).eq('id', editingGroupId);
          if (!error) patchCategoryGroups((gs) => gs.map((g) => (g.id === editingGroupId ? { ...g, name: groupFormName } : g)));
      } else {
          const nextOrder =
            groups.reduce((max, g) => Math.max(max, g.sort_order), -1) + 1;
          const { data } = await supabase
            .from('category_groups')
            .insert([{ name: groupFormName, sort_order: nextOrder }])
            .select()
            .single();
          if (data) {
            patchCategoryGroups((gs) =>
              [...gs, data as CategoryGroup].sort(
                (a, b) => a.sort_order - b.sort_order || a.id - b.id
              )
            );
            setExpandedGroups(new Set(expandedGroups).add(data.id));
          }
      }
      setIsGroupModalOpen(false);
  }

  async function deleteGroup() {
      if (!editingGroupId) return;
      if (!confirm("Delete this group? All categories inside will be deleted.")) return;
      await supabase.from('category_groups').delete().eq('id', editingGroupId);
      patchCategoryGroups((gs) => gs.filter((g) => g.id !== editingGroupId));
      patchCategories((cats) => cats.filter((c) => c.group_id !== editingGroupId));
      setIsGroupModalOpen(false);
  }

  async function moveGroup(groupId: number, direction: 'up' | 'down') {
      const sorted = [...groups].sort(
        (a, b) => a.sort_order - b.sort_order || a.id - b.id
      );
      const index = sorted.findIndex((g) => g.id === groupId);
      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || swapIndex < 0 || swapIndex >= sorted.length) return;

      const reordered = [...sorted];
      [reordered[index], reordered[swapIndex]] = [
        reordered[swapIndex],
        reordered[index],
      ];

      setReorderingGroups(true);
      const withOrder = reordered.map((g, i) => ({ ...g, sort_order: i }));
      await Promise.all(
        withOrder.map((g) =>
          supabase
            .from('category_groups')
            .update({ sort_order: g.sort_order })
            .eq('id', g.id)
        )
      );
      patchCategoryGroups(() => withOrder);
      setReorderingGroups(false);
  }

  // --- CATEGORY ACTIONS ---
  function openCategoryModal(cat: any = null, defaultGroupId: number | null = null) {
      if (cat) {
          setEditingCatId(cat.id);
          setCatForm({ 
              group_id: cat.group_id.toString(), name: cat.name, emoji: cat.emoji || '', 
              target_type: cat.target_type || 'Set Aside', target_amount: cat.target_amount ? cat.target_amount.toString() : '', 
              due_date: cat.due_date || '', is_repeating: cat.is_repeating || false, target_period: cat.target_period || 'Monthly', 
              end_date: cat.end_date || '', notes: cat.notes || '',
              is_debt: cat.is_debt || false, balance: cat.balance ? cat.balance.toString() : '',
              is_asap: cat.is_asap || false, is_hidden: !!cat.is_hidden
          });
      } else {
          setEditingCatId(null);
          setCatForm({ 
              group_id: defaultGroupId ? defaultGroupId.toString() : (groups[0]?.id.toString() || ''), 
              name: '', emoji: '', target_type: 'Set Aside', target_amount: '', due_date: '', 
              is_repeating: false, target_period: 'Monthly', end_date: '', notes: '',
              is_debt: false, balance: '', is_asap: false, is_hidden: false
          });
      }
      setIsCategoryModalOpen(true);
  }

  async function saveCategory(e: React.FormEvent) {
      e.preventDefault();
      const payload = { 
          group_id: parseInt(catForm.group_id), name: catForm.name, emoji: catForm.emoji || null, 
          target_type: catForm.target_type, target_amount: roundMoney(parseFloat(catForm.target_amount) || 0), 
          due_date: catForm.due_date || null, is_repeating: catForm.is_repeating, target_period: catForm.target_period, 
          end_date: catForm.end_date || null, notes: catForm.notes || null,
          is_debt: catForm.is_debt, balance: roundMoney(parseFloat(catForm.balance) || 0),
          is_asap: catForm.is_asap,
          is_hidden: catForm.is_hidden
      };
      
      if (editingCatId) {
          const { error } = await supabase.from('categories').update(payload).eq('id', editingCatId);
          if (!error) {
            patchCategories((cats) =>
              cats.map((c) => (c.id === editingCatId ? { ...c, ...payload } : c))
            );
          }
      } else {
          const { data } = await supabase.from('categories').insert([payload]).select().single();
          if (data) patchCategories((cats) => [...cats, data]);
      }
      setIsCategoryModalOpen(false);
  }

  async function deleteCategory() {
      if (!editingCatId) return;
      if (!confirm("Delete this category?")) return;
      await supabase.from('categories').delete().eq('id', editingCatId);
      patchCategories((cats) => cats.filter((c) => c.id !== editingCatId));
      setIsCategoryModalOpen(false);
  }

  async function restoreCategory(id: number) {
      const { error } = await supabase.from('categories').update({ is_hidden: false }).eq('id', id);
      if (!error) {
        patchCategories((cats) =>
          cats.map((c) => (c.id === id ? { ...c, is_hidden: false } : c))
        );
      }
  }

  // Math (Only count visible categories for totals)
  const archivedCategories = categories.filter((c) => c.is_hidden);
  const hasNegativeCategories = visibleCategories.some(c => {
      let assigned = Number(c.assigned_amount || 0);
      assigned = snapMoney(assigned);
      return assigned < 0;
  });

  function pickDefaultDestinationCategory() {
      const underfunded = visibleCategories.find((c) => {
          const target = Number(c.target_amount || 0);
          const assigned = snapMoney(Number(c.assigned_amount || 0));
          return target > 0 && assigned < target;
      });
      if (underfunded) return underfunded.id.toString();
      return visibleCategories[0]?.id.toString() || '';
  }

  function pickDefaultSourceCategory(excludeCatId?: number) {
      const funded = visibleCategories
          .filter((c) => {
              if (excludeCatId != null && c.id === excludeCatId) return false;
              return snapMoney(Number(c.assigned_amount || 0)) > 0;
          })
          .sort(
              (a, b) =>
                  Number(b.assigned_amount || 0) - Number(a.assigned_amount || 0)
          );
      return funded[0]?.id.toString() || '';
  }

  function openRtaTransferModal() {
      if (assignableReadyToAssign > 0) {
          setTransferForm({
              fromCatId: 'RTA',
              toCatId: pickDefaultDestinationCategory(),
              amount: formatMoneyInput(assignableReadyToAssign),
          });
      } else if (assignableReadyToAssign < 0) {
          const sourceId = pickDefaultSourceCategory();
          const sourceCat = visibleCategories.find((c) => c.id.toString() === sourceId);
          const sourceAvailable = snapMoney(Number(sourceCat?.assigned_amount || 0));
          const needed = Math.abs(assignableReadyToAssign);
          setTransferForm({
              fromCatId: sourceId,
              toCatId: 'RTA',
              amount: formatMoneyInput(Math.min(needed, Math.max(0, sourceAvailable)) || needed),
          });
      } else {
          setTransferForm({
              fromCatId: 'RTA',
              toCatId: pickDefaultDestinationCategory(),
              amount: '',
          });
      }
      setIsTransferModalOpen(true);
  }

  function openTransferModal(cat: Category) {
      const available = snapMoney(Number(cat.assigned_amount || 0));
      const absAvailable = Math.abs(available);

      if (available < 0) {
          setTransferForm({
              fromCatId: pickDefaultSourceCategory(cat.id) || 'RTA',
              toCatId: cat.id.toString(),
              amount: formatMoneyInput(absAvailable),
          });
          setIsTransferModalOpen(true);
          return;
      }

      setTransferForm({
          fromCatId: cat.id.toString(),
          toCatId: 'RTA',
          amount: absAvailable <= MONEY_EPSILON ? '' : formatMoneyInput(absAvailable),
      });
      setIsTransferModalOpen(true);
  }

  const orderedGroups = useMemo(
    () => [...groups].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    [groups]
  );

  if (pageLoading) return <PageSkeleton />;

  return (
    <>

      {/* READY TO ASSIGN BANNER */}
      <div className={`text-white rounded-3xl p-6 md:p-8 shadow-lg mb-8 relative overflow-hidden flex flex-col md:flex-row justify-between items-center md:items-start gap-4 transition-colors ${rtaNegative ? 'bg-red-500/100' : 'bg-emerald-500'}`}>
        <div className={`absolute top-0 right-0 w-64 h-64 rounded-full mix-blend-screen filter blur-3xl opacity-50 translate-x-20 -translate-y-20 ${rtaNegative ? 'bg-red-400' : 'bg-emerald-400'}`}></div>
        <div className="relative z-10 text-center md:text-left">
           <h2 className="text-white/80 font-bold uppercase tracking-widest text-sm mb-2 flex items-center justify-center md:justify-start gap-2">
              <Wallet size={16}/> {totalOverspent > 0 ? 'Assignable' : 'Ready to Assign'}
           </h2>
           <h1 className="text-5xl md:text-6xl font-black tracking-tighter">
              ${formatMoney(shownReadyToAssign)}
           </h1>
           {assignableReadyToAssign < 0 && (
             <p className="font-bold text-white mt-2 bg-red-600 inline-block px-3 py-1 rounded-lg text-sm">
               You assigned more money than you have in liquid cash.
             </p>
           )}
           <RtaBannerExtras
             readyToAssign={readyToAssign}
             assignableReadyToAssign={assignableReadyToAssign}
             totalOverspent={totalOverspent}
             pendingInflow={pendingInflow}
             guaranteedInflow={guaranteedInflow}
             anticipatedInflow={anticipatedInflow}
             projectedAssignableReadyToAssign={projectedAssignableReadyToAssign}
             conservativeAssignableRta={conservativeAssignableRta}
           />
        </div>
        <div className="relative z-10 flex flex-col items-stretch md:items-end gap-3 w-full md:w-auto md:min-w-[200px]">
            <button
                type="button"
                onClick={openRtaTransferModal}
                disabled={visibleCategories.length === 0}
                className={`w-full min-h-12 md:min-h-0 md:min-w-0 md:w-auto px-5 py-3.5 md:py-3 rounded-xl font-black text-sm uppercase tracking-wide shadow-lg shadow-black/10 dark:shadow-black/30 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 ${
                    assignableReadyToAssign < 0
                        ? 'bg-white/95 dark:bg-white/15 dark:backdrop-blur-md text-red-700 dark:text-white border border-transparent dark:border-white/25 hover:bg-white dark:hover:bg-white/25'
                        : 'bg-white/95 dark:bg-white/15 dark:backdrop-blur-md text-emerald-700 dark:text-white border border-transparent dark:border-white/25 hover:bg-white dark:hover:bg-white/25'
                }`}
                title="Assign from Ready to Assign or pull money back into RTA"
            >
                <ArrowRightLeft size={18} className="shrink-0"/>
                <span className="sm:hidden">
                    {assignableReadyToAssign > 0 ? 'Assign' : assignableReadyToAssign < 0 ? 'Cover' : 'Move'}
                </span>
                <span className="hidden sm:inline">
                    {assignableReadyToAssign > 0 ? 'Assign Money' : assignableReadyToAssign < 0 ? 'Cover Overbudget' : 'Move Money'}
                </span>
            </button>
            <div className="bg-white/20 dark:bg-black/20 backdrop-blur-md border border-white/20 dark:border-white/10 rounded-xl p-4 w-full md:w-auto text-center">
                <p className="text-white/80 text-xs font-bold uppercase mb-1">Total Target Goals</p>
                <p className="text-xl font-bold">
                    ${formatMoney(visibleCategories.reduce((sum, c) => sum + Number(c.target_amount), 0))}
                </p>
            </div>
        </div>
      </div>



      {/* OVERSPENDING WARNING BANNER */}
      {hasNegativeCategories && (
          <div className="bg-red-500/15 border border-red-500/30 text-red-700 p-4 rounded-2xl flex items-start md:items-center gap-3 mb-8 shadow-sm animate-in fade-in slide-in-from-top-2">
            <AlertCircle size={20} className="shrink-0 mt-0.5 md:mt-0"/>
            <div>
                <h4 className="font-bold text-sm">Action Required: Overspent Categories</h4>
                <p className="text-xs mt-0.5 opacity-90">You have categories with a negative available balance. Move money from other envelopes to cover the deficit.</p>
            </div>
          </div>
      )}

      {/* HEADER & CONTROLS */}
      <div className="flex flex-col xl:flex-row justify-between items-center mb-6 gap-4">
        <div className="flex items-center gap-4 w-full xl:w-auto">
            <h2 className="text-2xl font-extrabold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
                <LayoutGrid size={24} className="text-blue-500"/> Budget Planner
            </h2>
            <button type="button" onClick={() => setIsExportOpen(true)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" title="Export budget">
                <Download size={18}/>
            </button>
        </div>
        
        <div className="flex flex-wrap gap-2 w-full xl:w-auto">
            <div className="flex flex-wrap gap-2 flex-grow md:flex-grow-0">
                <div className="flex items-center gap-2 app-card-subtle px-3 py-1.5 rounded-xl flex-1 min-w-[140px]">
                    <ArrowUpDown size={14} className="text-[var(--text-muted)] shrink-0"/>
                    <Select value={categorySort} onChange={handleSortChange} className="flex-1 min-w-0 border-0 !bg-transparent !p-0 min-h-9">
                        <option value="default">Sort: Custom</option>
                        <option value="name">Sort: A-Z</option>
                        <option value="target">Sort: Goal</option>
                        <option value="assigned">Sort: Assigned</option>
                        <option value="date">Sort: Due Date</option>
                    </Select>
                </div>
                <div className="flex items-center gap-2 app-card-subtle px-3 py-1.5 rounded-xl flex-1 min-w-[140px]">
                    <Filter size={14} className="text-[var(--text-muted)] shrink-0"/>
                    <Select value={categoryFilter} onChange={handleFilterChange} className="flex-1 min-w-0 border-0 !bg-transparent !p-0 min-h-9">
                        <option value="all">View: All</option>
                        <option value="actionable">View: Actionable</option>
                        <option value="underfunded">View: Underfunded</option>
                        <option value="available">View: Available</option>
                        <option value="overspent">View: Overspent</option>
                    </Select>
                </div>
            </div>
            <button onClick={() => openGroupModal()} className="flex-1 md:flex-none app-card text-[var(--text-muted)] border border-[var(--border)] px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[var(--surface-hover)] shadow-sm transition-colors">
                <FolderPlus size={18}/> New Group
            </button>
            <button onClick={() => openCategoryModal()} className="flex-1 md:flex-none gradient-positive text-white px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 hover:brightness-105 shadow-sm transition-colors">
                <Plus size={18}/> New Category
            </button>
        </div>
      </div>

      {categorySort !== 'default' && orderedGroups.length > 1 && (
        <p className="text-xs font-bold text-[var(--text-muted)] mb-4 -mt-2">
          Set sort to <span className="text-[var(--text-primary)]">Custom</span> to
          reorder groups with the arrow buttons.
        </p>
      )}

      {/* BUDGET GROUPS GRID */}
      <div className="space-y-6">
        {orderedGroups.map((group, groupIndex) => {
            // Apply View Filter first
            let groupCats = visibleCategories.filter(c => {
                if (c.group_id !== group.id) return false;
                
                // MATH FIX: Snap to zero to kill floating point dust
                let assigned = Number(c.assigned_amount || 0);
                assigned = snapMoney(assigned);
                
                const target = Number(c.target_amount || 0);
                
                if (categoryFilter === 'underfunded') {
                    return target > 0 && assigned < target;
                }
                if (categoryFilter === 'actionable') {
                    // Show if either positive available (money to pull) or negative available (needs money)
                    return Math.abs(assigned) >= MONEY_EPSILON;
                }
                if (categoryFilter === 'available') {
                    return assigned > 0;
                }
                if (categoryFilter === 'overspent') {
                    return assigned < 0;
                }
                return true;
            });
            
            // If filtering is active and group is empty, hide the entire group UI
            if (categoryFilter !== 'all' && groupCats.length === 0) return null;

            // Apply Sorting
            if (categorySort === 'name') {
                groupCats.sort((a, b) => a.name.localeCompare(b.name));
            } else if (categorySort === 'target') {
                groupCats.sort((a, b) => Number(b.target_amount) - Number(a.target_amount));
            } else if (categorySort === 'assigned') {
                groupCats.sort((a, b) => Number(b.assigned_amount || 0) - Number(a.assigned_amount || 0));
            } else if (categorySort === 'date') {
                groupCats.sort((a, b) => {
                    if (!a.due_date) return 1;
                    if (!b.due_date) return -1;
                    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
                });
            }

            const isExpanded = expandedGroups.has(group.id);
            const groupTarget = groupCats.reduce((sum, c) => sum + Number(c.target_amount), 0);

            return (
                <div key={group.id} className="app-card rounded-3xl shadow-sm border border-[var(--border)] overflow-hidden">
                    <div onClick={() => toggleGroup(group.id)} className="bg-[var(--surface-subtle)] p-4 border-b border-[var(--border)] flex items-center justify-between cursor-pointer hover:bg-[var(--surface-hover)] transition-colors">
                        <div className="flex items-center gap-3">
                            <div className="text-[var(--text-muted)]">{isExpanded ? <ChevronDown size={20}/> : <ChevronRight size={20}/>}</div>
                            {categorySort === 'default' && orderedGroups.length > 1 && (
                              <div
                                className="flex flex-col -my-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  disabled={reorderingGroups || groupIndex === 0}
                                  onClick={() => moveGroup(group.id, 'up')}
                                  className="p-0.5 text-[var(--text-muted)] hover:text-blue-500 disabled:opacity-30 rounded transition-colors"
                                  title="Move group up"
                                >
                                  <ChevronUp size={14} />
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    reorderingGroups ||
                                    groupIndex === orderedGroups.length - 1
                                  }
                                  onClick={() => moveGroup(group.id, 'down')}
                                  className="p-0.5 text-[var(--text-muted)] hover:text-blue-500 disabled:opacity-30 rounded transition-colors"
                                  title="Move group down"
                                >
                                  <ChevronDown size={14} />
                                </button>
                              </div>
                            )}
                            <h3 className="font-bold text-lg text-[var(--text-primary)]">{group.name}</h3>
                            <button onClick={(e) => { e.stopPropagation(); openGroupModal(group); }} className="text-[var(--text-muted)] hover:text-blue-500 p-1 rounded-md transition-colors"><Edit2 size={14}/></button>
                        </div>
                        <div className="flex items-center gap-4">
                            {groupTarget > 0 && <span className="text-sm font-bold text-[var(--text-muted)] hidden md:inline-block">Target: ${formatMoney(groupTarget)}</span>}
                            <button onClick={(e) => { e.stopPropagation(); openCategoryModal(null, group.id); }} className="text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-500/100/15 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors"><Plus size={14}/> Add Item</button>
                        </div>
                    </div>

                    {isExpanded && (
                        <div className="divide-y divide-[var(--border)]">
                            {groupCats.length > 0 ? (
                                groupCats.map(cat => {
                                    // MATH FIX: Snap to zero to kill floating point dust
                                    let assigned = Number(cat.assigned_amount || 0);
                                    assigned = snapMoney(assigned);
                                    
                                    const target = Number(cat.target_amount || 0);
                                    const remainingToFund = target > 0 ? Math.max(0, target - assigned) : 0;
                                    const available = assigned; 
                                    const isFunding = fundingCatId === cat.id;
                                    
                                    // Color logic variables
                                    const isNegative = available < 0;
                                    const isFullyFunded = target > 0 && available >= target;

                                    // Time & Math Logic
                                    const today = new Date();
                                    today.setHours(0,0,0,0);
                                    const isPastDue = cat.due_date && new Date(cat.due_date + 'T00:00:00') < today;
                                    
                                    // Savings Breakdown Calculation
                                    let savingsBreakdown = '';
                                    if (target > 0 && remainingToFund > 0 && cat.due_date && !isPastDue) {
                                        const dueDate = new Date(cat.due_date + 'T00:00:00');
                                        const daysLeft = Math.max(1, Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 3600 * 24)));
                                        const daily = remainingToFund / daysLeft;
                                        savingsBreakdown = `Save $${formatMoney(daily)}/d`;
                                        if (daysLeft >= 7) savingsBreakdown += ` • $${formatMoney(daily * 7)}/w`;
                                        if (daysLeft >= 30) savingsBreakdown += ` • $${formatMoney(daily * 30.4)}/mo`;
                                    }

                                    return (
                                        <div key={cat.id} className={`p-4 flex flex-col lg:flex-row lg:items-center justify-between hover:bg-[var(--surface-hover)] cursor-pointer transition-colors group/item gap-4 ${cat.is_asap || isPastDue ? 'bg-red-500/10/30' : ''}`} onClick={() => openCategoryModal(cat)}>
                                            <div className="flex items-center gap-3 w-full lg:w-1/2">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[var(--text-muted)] border transition-colors shrink-0 text-lg ${cat.is_asap || isPastDue ? 'bg-red-500/10 border-red-500/30' : 'bg-[var(--surface-subtle)] border-[var(--border)] group-hover/item:border-blue-500/30 group-hover/item:text-blue-500'}`}>
                                                    {cat.emoji ? cat.emoji : <Target size={16}/>}
                                                </div>
                                                <div className="min-w-0">
                                                    <h4 className="font-bold text-[var(--text-primary)] truncate flex items-center gap-2">
                                                        {cat.name}
                                                        {cat.notes && <span title={cat.notes}><FileText size={12} className="text-[var(--text-muted)]" /></span>}
                                                        {isPastDue && !cat.is_asap && <span className="text-[10px] bg-red-500/15 text-red-700 px-1.5 py-0.5 rounded font-bold uppercase flex items-center gap-1"><AlertTriangle size={10}/> Late</span>}
                                                    </h4>
                                                    <div className="flex flex-wrap items-center gap-2 mt-0.5">
                                                        {cat.is_asap && (
                                                            <span className="text-[10px] font-bold text-white bg-red-500/100 px-1.5 py-0.5 rounded truncate flex items-center gap-1">
                                                                <AlertTriangle size={10}/> ASAP
                                                            </span>
                                                        )}
                                                        {cat.is_debt && cat.balance > 0 && (
                                                            <span className="text-[10px] font-bold text-red-600 bg-red-500/10 border border-red-100 px-1.5 py-0.5 rounded truncate">
                                                                Owe: ${formatMoney(cat.balance)}
                                                            </span>
                                                        )}
                                                        {target > 0 && <span className="text-[10px] font-bold text-[var(--text-muted)] app-card border border-[var(--border)] px-1.5 py-0.5 rounded truncate">{cat.target_type}: ${formatMoney(target)} {cat.is_repeating && cat.target_period !== 'None' ? `/ ${cat.target_period}` : ''}</span>}
                                                        {cat.due_date && (
                                                            <div className="flex items-center gap-1">
                                                                <span className="text-[10px] font-bold text-[var(--text-muted)] flex items-center gap-1">
                                                                    <Calendar size={10}/> {format(parseISO(cat.due_date), 'MMM d')}
                                                                </span>
                                                                {cat.is_repeating && cat.target_period !== 'None' && (
                                                                    <button 
                                                                        onClick={(e) => advanceDate(e, cat)}
                                                                        className="p-0.5 text-[var(--text-muted)] hover:text-blue-500 hover:bg-blue-500/10 rounded transition-colors"
                                                                        title="Advance to next payment cycle"
                                                                    >
                                                                        <FastForward size={12}/>
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )}
                                                        {cat.is_repeating && <span title="Repeating Goal"><Repeat size={10} className="text-blue-400" /></span>}
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            {/* ASSIGNMENT MATH & TRANSFERS */}
                                            <div className="flex items-center justify-between lg:justify-end gap-4 lg:gap-6 w-full lg:w-auto shrink-0 pl-12 lg:pl-0">
                                                <div>
                                                    <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-0.5">Assigned</p>
                                                    {isFunding ? (
                                                        <form onSubmit={saveFunding} onClick={e => e.stopPropagation()} className="flex items-center relative">
                                                            <span className="absolute left-2 font-bold text-[var(--text-muted)] text-sm">$</span>
                                                            <input 
                                                                autoFocus
                                                                type="text" 
                                                                placeholder="e.g. +50 or 100-20"
                                                                className="w-28 pl-5 pr-2 py-1 app-card border-2 border-blue-400 rounded-lg text-sm font-bold text-[var(--text-primary)] outline-none shadow-sm"
                                                                value={fundingAmount}
                                                                onChange={e => setFundingAmount(e.target.value)}
                                                                onBlur={saveFunding}
                                                            />
                                                        </form>
                                                    ) : (
                                                        <div 
                                                            onClick={(e) => openFundingMode(e, cat)}
                                                            className={`font-bold px-3 py-1 rounded-lg text-sm transition-colors border cursor-pointer ${cat.is_asap || isPastDue ? 'bg-red-500/15 text-red-600 border-red-500/30 hover:bg-red-200' : 'bg-[var(--surface-subtle)] text-[var(--text-primary)] hover:bg-blue-500/100/15 hover:text-blue-700 border-transparent hover:border-blue-500/30'}`}
                                                            title="Click to assign money (Math enabled: +50, 100-20)"
                                                        >
                                                            ${formatMoney(assigned)}
                                                        </div>
                                                    )}
                                                    {target > 0 && remainingToFund > 0 && (
                                                        <div className="flex flex-col mt-1 pl-1">
                                                            <p className="text-[9px] font-bold text-[var(--text-muted)]">Left: ${formatMoney(remainingToFund)}</p>
                                                            {savingsBreakdown && <p className="text-[9px] font-bold text-blue-400">{savingsBreakdown}</p>}
                                                        </div>
                                                    )}
                                                </div>
                                                <div>
                                                    <p className={`text-[10px] font-bold uppercase mb-0.5 text-right transition-colors ${isNegative ? 'text-red-400' : isFullyFunded ? 'text-amber-500' : 'text-[var(--text-muted)]'}`}>Available</p>
                                                    <div 
                                                        onClick={(e) => { e.stopPropagation(); openTransferModal(cat); }}
                                                        className={`font-black px-3 py-1 rounded-lg text-sm border min-w-[80px] text-right cursor-pointer transition-all ${
                                                            isNegative 
                                                            ? 'bg-red-500/100 text-white border-red-600 hover:bg-red-600 hover:border-red-700 shadow-sm'
                                                            : isFullyFunded
                                                            ? 'bg-gradient-to-br from-yellow-400 to-amber-500 text-white border-amber-500 hover:from-yellow-500 hover:to-amber-600 shadow-md shadow-amber-500/40'
                                                            : 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-500/100/15 hover:border-emerald-300'
                                                        }`}
                                                        title={isFullyFunded ? "Goal fully funded! Click to transfer money" : "Click to transfer money"}
                                                    >
                                                        {isNegative ? `-$${formatMoney(Math.abs(available))}` : `$${formatMoney(available)}`}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="p-6 text-center text-sm text-[var(--text-muted)] font-medium">No items match the current filter.</div>
                            )}
                        </div>
                    )}
                </div>
            );
        })}

        {archivedCategories.length > 0 && (
            <div className="bg-[var(--surface-subtle)]/80 rounded-3xl border border-[var(--border)] overflow-hidden">
                <button
                    type="button"
                    onClick={() => setShowArchivedSection(!showArchivedSection)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-[var(--surface-subtle)] transition-colors"
                >
                    <span className="font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Archive size={18} className="text-amber-600"/>
                        Archived categories
                        <span className="text-xs font-black text-[var(--text-muted)] app-card px-2 py-0.5 rounded-lg border border-[var(--border)]">{archivedCategories.length}</span>
                    </span>
                    <ChevronDown size={20} className={`text-[var(--text-muted)] transition-transform ${showArchivedSection ? 'rotate-180' : ''}`}/>
                </button>
                {showArchivedSection && (
                    <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)] bg-[var(--surface-elevated)]">
                        {archivedCategories.map(c => (
                            <li key={c.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <button
                                    type="button"
                                    onClick={() => openCategoryModal(c)}
                                    className="text-left min-w-0 flex items-center gap-3 group"
                                >
                                    <span className="text-lg shrink-0 w-10 h-10 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border)] flex items-center justify-center">
                                        {c.emoji ? c.emoji : <Target size={16} className="text-[var(--text-muted)]"/>}
                                    </span>
                                    <span>
                                        <span className="font-bold text-[var(--text-primary)] group-hover:text-blue-600 transition-colors block truncate">{c.name}</span>
                                        <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                                            {groups.find(g => g.id === c.group_id)?.name || 'Group'}
                                            {' · '}
                                            assigned ${formatMoney(c.assigned_amount || 0)}
                                        </span>
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => restoreCategory(c.id)}
                                    className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600 transition-colors"
                                >
                                    <RotateCcw size={14}/> Restore
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        )}

        {groups.length === 0 && (
            <div className="text-center py-20 app-card rounded-3xl border-2 border-dashed border-[var(--border)]">
                <div className="w-16 h-16 bg-[var(--surface-subtle)] text-[var(--text-muted)] rounded-full flex items-center justify-center mx-auto mb-4"><FolderPlus size={32}/></div>
                <h4 className="font-bold text-[var(--text-primary)] text-lg">Empty Budget</h4>
                <p className="text-sm text-[var(--text-muted)] mt-1">Start by creating a Category Group (e.g., Living Expenses).</p>
            </div>
        )}
      </div>

      {/* --- MODAL: GROUP --- */}
      {isGroupModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={saveGroup} className="app-modal w-full max-w-sm rounded-3xl p-6 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-xl flex items-center gap-2"><FolderPlus size={20}/> {editingGroupId ? 'Edit Group' : 'New Group'}</h3>
              <div className="flex gap-2">
                 {editingGroupId && <button type="button" onClick={deleteGroup} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-500/100/10 rounded-full transition-colors"><Trash2 size={18}/></button>}
                 <button type="button" onClick={() => setIsGroupModalOpen(false)} className="p-2 text-[var(--text-muted)] hover:text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] rounded-full transition-colors"><X size={18}/></button>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Group Name</label>
                <input required autoFocus placeholder="e.g. Fixed Costs" className="w-full p-3 app-input rounded-xl font-bold text-[var(--text-primary)] border border-[var(--border)] outline-none focus:border-blue-300 focus:bg-[var(--surface-elevated)] transition-all" value={groupFormName} onChange={e => setGroupFormName(e.target.value)} />
              </div>
            </div>
            <button type="submit" className="w-full gradient-positive text-white py-4 rounded-xl font-bold mt-8 shadow-lg hover:brightness-105 transition-colors">
              {editingGroupId ? 'Save Changes' : 'Create Group'}
            </button>
          </form>
        </div>
      )}

      {/* --- MODAL: CATEGORY (ADVANCED + DEBT + ASAP) --- */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={saveCategory} className="app-modal w-full max-w-lg rounded-3xl p-6 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto hide-scrollbar">
            <div className="flex justify-between items-center mb-6 sticky top-0 bg-[var(--surface-elevated)] z-10 pb-2 border-b border-[var(--border)]">
              <h3 className="font-bold text-xl flex items-center gap-2"><Target size={20}/> {editingCatId ? 'Edit Category' : 'New Category'}</h3>
              <div className="flex gap-2">
                 {editingCatId && <button type="button" onClick={deleteCategory} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-500/100/10 rounded-full transition-colors"><Trash2 size={18}/></button>}
                 <button type="button" onClick={() => setIsCategoryModalOpen(false)} className="p-2 text-[var(--text-muted)] hover:text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] rounded-full transition-colors"><X size={18}/></button>
              </div>
            </div>

            <div className="space-y-6">
              
              {/* BASIC INFO */}
              <div className="space-y-4">
                  <div className="flex gap-3">
                      <div className="w-1/4">
                          <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Emoji</label>
                          <input maxLength={2} placeholder="🍕" className="w-full p-3 app-input rounded-xl font-black text-center text-xl text-[var(--text-primary)] border border-[var(--border)] outline-none focus:border-blue-300 focus:bg-[var(--surface-elevated)] transition-all" value={catForm.emoji} onChange={e => setCatForm({...catForm, emoji: e.target.value})} />
                      </div>
                      <div className="w-3/4">
                          <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Category Name</label>
                          <input required autoFocus placeholder="e.g. Groceries" className="w-full p-3 app-input rounded-xl font-bold text-[var(--text-primary)] border border-[var(--border)] outline-none focus:border-blue-300 focus:bg-[var(--surface-elevated)] transition-all" value={catForm.name} onChange={e => setCatForm({...catForm, name: e.target.value})} />
                      </div>
                  </div>
                  <div>
                      <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Parent Group</label>
                      <select className="w-full p-3 app-input rounded-xl font-bold text-[var(--text-primary)] border border-[var(--border)] outline-none focus:border-blue-300 focus:bg-[var(--surface-elevated)] transition-all cursor-pointer" value={catForm.group_id} onChange={e => setCatForm({...catForm, group_id: e.target.value})}>
                          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                  </div>
              </div>

              {/* DEBT TRACKING */}
              <div className="app-card-subtle p-4 rounded-2xl border border-[var(--border)] space-y-4">
                  <div className="flex items-center gap-3">
                      <button type="button" onClick={() => setCatForm({ ...catForm, is_debt: !catForm.is_debt })} className={`w-10 h-6 rounded-full flex items-center transition-colors px-1 ${catForm.is_debt ? 'bg-red-500/100' : 'bg-[var(--surface-subtle)]'}`}>
                          <div className={`w-4 h-4 app-card rounded-full shadow-sm transition-transform ${catForm.is_debt ? 'translate-x-4' : 'translate-x-0'}`}></div>
                      </button>
                      <span className="text-sm font-bold text-[var(--text-primary)]">Track as Debt / Outstanding Balance</span>
                  </div>
                  
                  {catForm.is_debt && (
                      <div className="animate-in slide-in-from-top-2 fade-in">
                          <label className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-1.5 flex items-center gap-1"><AlertCircle size={12}/> Total Balance Owed</label>
                          <div className="relative">
                              <span className="absolute left-3 top-2.5 font-bold text-red-400">$</span>
                              <input type="number" step="0.01" placeholder="0.00" className="w-full pl-7 p-2.5 app-card rounded-lg font-black text-sm border border-red-500/30 outline-none focus:border-red-400 transition-all text-red-600" value={catForm.balance} onChange={e => setCatForm({...catForm, balance: e.target.value})} />
                          </div>
                      </div>
                  )}
              </div>

              {/* TARGET GOAL SETTINGS */}
              <div className="app-card-subtle p-4 rounded-2xl border border-[var(--border)] space-y-4">
                  <h4 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest flex items-center gap-2"><Target size={14}/> Goal Target</h4>
                  <div className="flex flex-col md:flex-row gap-3">
                      <div className="w-full md:w-1/2">
                          <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5 block">Goal Type</label>
                          <select className="w-full p-2.5 app-card rounded-lg font-bold text-sm text-[var(--text-primary)] border border-[var(--border)] outline-none focus:border-blue-300 cursor-pointer" value={catForm.target_type} onChange={e => setCatForm({...catForm, target_type: e.target.value})}>
                              <option value="Set Aside">Set Aside (Build up over time)</option>
                              <option value="Fill Up To">Fill Up To (Cap at amount)</option>
                              <option value="Have Balance">Have a Balance (Target total)</option>
                          </select>
                      </div>
                      <div className="w-full md:w-1/2">
                          <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5 block">Target Amount</label>
                          <div className="relative">
                              <span className="absolute left-3 top-2.5 font-bold text-[var(--text-muted)]">$</span>
                              <input type="number" step="0.01" placeholder="0.00" className="w-full pl-7 p-2.5 app-card rounded-lg font-black text-sm text-[var(--text-primary)] border border-[var(--border)] outline-none focus:border-blue-300 transition-all" value={catForm.target_amount} onChange={e => setCatForm({...catForm, target_amount: e.target.value})} />
                          </div>
                      </div>
                  </div>
              </div>

              {/* SCHEDULE & TIMELINE */}
              <div className="app-card-subtle p-4 rounded-2xl border border-[var(--border)] space-y-4">
                  <div className="flex justify-between items-center mb-1">
                      <h4 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest flex items-center gap-2"><Calendar size={14}/> Schedule & Timeline</h4>
                      {/* ASAP TOGGLE */}
                      <button 
                          type="button" 
                          onClick={() => setCatForm({ ...catForm, is_asap: !catForm.is_asap })} 
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border flex items-center gap-1 transition-colors ${catForm.is_asap ? 'bg-red-500/100 text-white border-red-600' : 'bg-[var(--surface-elevated)] text-[var(--text-muted)] border-[var(--border)] hover:bg-[var(--surface-subtle)]'}`}
                      >
                          <AlertTriangle size={10}/> Due ASAP
                      </button>
                  </div>
                  
                  <div className="flex gap-3">
                      <div className="w-1/2">
                          <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5 block">Due Date / Funding Date</label>
                          <input type="date" className="w-full p-2.5 app-card rounded-lg font-bold text-sm text-[var(--text-primary)] border border-[var(--border)] outline-none focus:border-blue-300 transition-all" value={catForm.due_date} onChange={e => setCatForm({...catForm, due_date: e.target.value})} />
                      </div>
                      <div className="w-1/2">
                          <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5 block">Final Payment / End Date</label>
                          <input type="date" className="w-full p-2.5 app-card rounded-lg font-bold text-sm text-[var(--text-primary)] border border-[var(--border)] outline-none focus:border-blue-300 transition-all" value={catForm.end_date} onChange={e => setCatForm({...catForm, end_date: e.target.value})} />
                      </div>
                  </div>
                  
                  <div className="flex items-center gap-3 pt-2">
                      <button type="button" onClick={() => setCatForm({ ...catForm, is_repeating: !catForm.is_repeating })} className={`w-10 h-6 rounded-full flex items-center transition-colors px-1 ${catForm.is_repeating ? 'bg-blue-500' : 'bg-[var(--surface-subtle)]'}`}>
                          <div className={`w-4 h-4 app-card rounded-full shadow-sm transition-transform ${catForm.is_repeating ? 'translate-x-4' : 'translate-x-0'}`}></div>
                      </button>
                      <span className="text-sm font-bold text-[var(--text-primary)]">Goal Repeats?</span>
                  </div>

                  {catForm.is_repeating && (
                      <div className="animate-in slide-in-from-top-2 fade-in mt-2">
                          <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5 block">Frequency</label>
                          <select className="w-full p-2.5 app-card rounded-lg font-bold text-sm text-[var(--text-primary)] border border-[var(--border)] outline-none focus:border-blue-300 cursor-pointer" value={catForm.target_period} onChange={e => setCatForm({...catForm, target_period: e.target.value})}>
                              <option value="Weekly">Weekly</option>
                              <option value="Bi-Weekly">Bi-Weekly</option>
                              <option value="Monthly">Monthly</option>
                              <option value="Yearly">Yearly</option>
                          </select>
                      </div>
                  )}
              </div>

              {/* NOTES */}
              <div>
                  <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-2"><AlignLeft size={14}/> Category Notes</label>
                  <textarea placeholder="Account numbers, vendor phone numbers, login details..." className="w-full p-3 app-input rounded-xl font-bold text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] border border-[var(--border)] outline-none focus:border-blue-300 focus:bg-[var(--surface-elevated)] transition-all resize-none" rows={3} value={catForm.notes} onChange={e => setCatForm({...catForm, notes: e.target.value})} />
              </div>

              {editingCatId && (
                  <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 space-y-3">
                      <div className="flex items-center gap-2 text-amber-800 font-bold text-xs uppercase tracking-widest">
                          <Archive size={14}/> Archive
                      </div>
                      <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-bold text-[var(--text-muted)] leading-snug">
                              Archived categories stay out of the budget grid and bill calendar. Ledger history and payee links stay intact.
                          </p>
                          <button
                              type="button"
                              onClick={() => setCatForm({ ...catForm, is_hidden: !catForm.is_hidden })}
                              className={`shrink-0 w-10 h-6 rounded-full flex items-center transition-colors px-1 ${catForm.is_hidden ? 'bg-amber-500' : 'bg-[var(--surface-subtle)]'}`}
                              title={catForm.is_hidden ? 'Restore to active budget' : 'Archive this category'}
                          >
                              <div className={`w-4 h-4 app-card rounded-full shadow-sm transition-transform ${catForm.is_hidden ? 'translate-x-4' : 'translate-x-0'}`}></div>
                          </button>
                      </div>
                      {catForm.is_hidden && (
                          <p className="text-[10px] font-bold text-amber-700">This category is archived. Save to apply, or turn off to keep it active.</p>
                      )}
                  </div>
              )}
            </div>

            <button type="submit" className="w-full gradient-positive text-white py-4 rounded-xl font-bold mt-8 shadow-lg hover:brightness-105 transition-colors">
              {editingCatId ? 'Save Changes' : 'Save Category'}
            </button>
          </form>
        </div>
      )}

      {/* --- MODAL: TRANSFER MONEY --- */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={executeTransfer} className="app-modal w-full max-w-sm rounded-3xl p-6 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-xl flex items-center gap-2"><ArrowRightLeft size={20} className="text-emerald-500"/> Move Money</h3>
              <button type="button" onClick={() => setIsTransferModalOpen(false)} className="p-2 text-[var(--text-muted)] hover:text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] rounded-full transition-colors"><X size={18}/></button>
            </div>

            <div className="space-y-4">
                <div>
                    <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Amount to Move</label>
                    <div className="relative">
                        <span className="absolute left-4 top-3.5 font-bold text-[var(--text-muted)]">$</span>
                        <input
                            required
                            autoFocus
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            className="w-full pl-8 p-3 app-input rounded-xl font-black text-lg text-[var(--text-primary)] border border-[var(--border)] outline-none focus:border-emerald-300 focus:bg-[var(--surface-elevated)] transition-all"
                            value={transferForm.amount}
                            onChange={(e) =>
                                setTransferForm({ ...transferForm, amount: e.target.value })
                            }
                        />
                    </div>
                </div>
                
                <div className="flex flex-col gap-2 bg-[var(--surface-subtle)] p-4 rounded-xl border border-[var(--border)]">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider w-12 shrink-0">From</span>
                        <select className="flex-1 min-w-0 p-3 app-card rounded-xl font-bold text-[var(--text-primary)] border border-[var(--border)] outline-none focus:border-emerald-300 cursor-pointer truncate" value={transferForm.fromCatId} onChange={e => setTransferForm({...transferForm, fromCatId: e.target.value})}>
                            <option value="RTA">Ready to Assign</option>
                            <optgroup label="Categories">
                                {visibleCategories.map(c => (
                                    <option key={`from-${c.id}`} value={c.id.toString()}>{c.name}</option>
                                ))}
                            </optgroup>
                        </select>
                    </div>
                    
                    <div className="flex justify-center -my-2 relative z-10">
                        <button type="button" onClick={swapTransferDirection} className="app-card p-2 rounded-full border border-[var(--border)] shadow-sm text-[var(--text-muted)] hover:text-emerald-500 hover:border-emerald-500/30 transition-all hover:bg-emerald-500/10" title="Swap transfer direction">
                            <ArrowUpDown size={16} />
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider w-12 shrink-0">To</span>
                        <select className="flex-1 min-w-0 p-3 app-card rounded-xl font-bold text-[var(--text-primary)] border border-[var(--border)] outline-none focus:border-emerald-300 cursor-pointer truncate" value={transferForm.toCatId} onChange={e => setTransferForm({...transferForm, toCatId: e.target.value})}>
                            <option value="RTA">Ready to Assign</option>
                            <optgroup label="Categories">
                                {visibleCategories.map(c => (
                                    <option key={`to-${c.id}`} value={c.id.toString()}>{c.name}</option>
                                ))}
                            </optgroup>
                        </select>
                    </div>
                </div>
            </div>

            {/* Actionable Categories Quick Reference */}
            <div className="mt-6 pt-6 border-t border-[var(--border)]">
                <p className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-3 flex items-center gap-2">
                    <Activity size={12}/> Envelope balances
                </p>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-2 hide-scrollbar">
                    {visibleCategories.filter(c => Math.abs(Number(c.assigned_amount || 0)) >= MONEY_EPSILON).map(c => (
                        <div key={`ref-${c.id}`} className="flex items-center justify-between p-2 rounded-lg bg-[var(--surface-subtle)] border border-[var(--border)]">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="text-sm">{c.emoji}</span>
                                <span className="text-xs font-bold text-[var(--text-primary)] truncate">{c.name}</span>
                            </div>
                            <span className={`text-xs font-black ${Number(c.assigned_amount) < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                                {Number(c.assigned_amount) < 0 ? '-' : ''}${formatMoney(Math.abs(c.assigned_amount))}
                            </span>
                        </div>
                    ))}
                    {(assignableReadyToAssign !== 0 || totalOverspent > 0) && (
                        <div className="flex items-center justify-between p-2 rounded-lg bg-blue-50 border border-blue-100 mt-2">
                            <span className="text-xs font-bold text-blue-700">
                              {totalOverspent > 0 ? 'Assignable' : 'Ready to Assign'}
                            </span>
                            <span className={`text-xs font-black ${assignableReadyToAssign < 0 ? 'text-red-500' : 'text-blue-600'}`}>
                                {assignableReadyToAssign < 0 ? '-' : ''}${formatMoney(Math.abs(totalOverspent > 0 ? assignableReadyToAssign : readyToAssign))}
                            </span>
                        </div>
                    )}
                    {totalOverspent > 0 && (
                        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 dark:border-red-500/30 dark:bg-red-500/10">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-300">
                            Overspent
                          </p>
                          <p className="text-[10px] font-bold text-red-700 dark:text-red-200">
                            ${formatMoney(totalOverspent)} needs coverage · $
                            {formatMoney(readyToAssign)} before
                          </p>
                        </div>
                    )}
                </div>
            </div>

            <button
              type="submit"
              disabled={transferring}
              className="w-full bg-emerald-500 text-white py-4 rounded-xl font-bold mt-8 shadow-lg shadow-emerald-200 hover:bg-emerald-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {transferring ? 'Moving…' : 'Move Funds'}
            </button>
          </form>
        </div>
      )}

      <ExportModal
        open={isExportOpen}
        onOpenChange={setIsExportOpen}
        initialPreset="budget"
      />
    </>
  );
}
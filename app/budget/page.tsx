'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import Link from 'next/link';
import { 
  FolderPlus, Plus, X, Save, Trash2, Edit2, 
  ChevronDown, ChevronRight, Target, LayoutGrid, 
  Wallet, Calendar, FileText, Repeat, AlignLeft, PieChart,
  ArrowUpDown, AlertCircle, AlertTriangle, ArrowRightLeft,
  FastForward, ListOrdered, Filter, Download
} from 'lucide-react';
import { format, parseISO, addWeeks, addMonths, addYears, isAfter } from 'date-fns';

export default function BudgetPage() {
  const [groups, setGroups] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [liquidCash, setLiquidCash] = useState(0);
  const [loading, setLoading] = useState(true);

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
  const [catForm, setCatForm] = useState({
    group_id: '', name: '', emoji: '', 
    target_type: 'Set Aside', target_amount: '', 
    due_date: '', is_repeating: false, target_period: 'Monthly', end_date: '', notes: '',
    is_debt: false, balance: '', is_asap: false
  });

  // Funding Mode States
  const [fundingCatId, setFundingCatId] = useState<number | null>(null);
  const [fundingAmount, setFundingAmount] = useState('');

  // Transfer Mode States
  const [transferForm, setTransferForm] = useState({
      fromCatId: '', toCatId: 'RTA', amount: ''
  });

  useEffect(() => { 
      // Load persistent filters and sorts
      const savedSort = localStorage.getItem('finance_os_sort');
      if (savedSort) setCategorySort(savedSort);

      const savedFilter = localStorage.getItem('finance_os_filter');
      if (savedFilter) setCategoryFilter(savedFilter);

      fetchData(); 
  }, []);

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

  async function fetchData() {
    setLoading(true);
    
    const { data: accs } = await supabase.from('accounts').select('balance, type');
    if (accs) {
        const liquid = accs.filter(a => ['Checking', 'Savings', 'Cash'].includes(a.type)).reduce((sum, a) => sum + Number(a.balance), 0);
        setLiquidCash(liquid);
    }

    const { data: g } = await supabase.from('category_groups').select('*').order('sort_order', { ascending: true }).order('id');
    const { data: c } = await supabase.from('categories').select('*').order('sort_order', { ascending: true }).order('id');
    
    if (g) {
        setGroups(g);
        // Load persistent expanded groups, or default to all open
        const savedExpanded = localStorage.getItem('finance_os_expanded');
        if (savedExpanded) {
            setExpandedGroups(new Set(JSON.parse(savedExpanded)));
        } else {
            setExpandedGroups(new Set(g.map(group => group.id)));
        }
    }
    if (c) setCategories(c);
    
    setLoading(false);
  }

  function exportBudget() {
      const visibleCats = categories.filter(c => !c.is_hidden);
      const totalAssigned = visibleCats.reduce((sum, c) => sum + Number(c.assigned_amount || 0), 0);
      const totalGoals = visibleCats.reduce((sum, c) => sum + Number(c.target_amount || 0), 0);
      
      let text = `FINANCE OS - BUDGET MASTER EXPORT\nDate: ${format(new Date(), 'MMM d, yyyy')}\n\n`;
      text += `Liquid Cash: $${liquidCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`;
      text += `Ready to Assign: $${(liquidCash - totalAssigned).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`;
      text += `Total Goals Target: $${totalGoals.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n\n`;

      groups.forEach(g => {
          const groupCats = visibleCats.filter(c => c.group_id === g.id);
          if (groupCats.length === 0) return;
          
          text += `--- ${g.name.toUpperCase()} ---\n`;
          groupCats.forEach(c => {
              const assigned = Number(c.assigned_amount || 0);
              const target = Number(c.target_amount || 0);
              
              text += `${c.emoji ? c.emoji + ' ' : ''}${c.name}\n`;
              text += `  Assigned: $${assigned.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
              
              if (target > 0) text += ` | Goal: $${target.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${c.target_type}, ${c.is_repeating ? c.target_period : 'One-Time'})`;
              if (c.due_date) text += ` | Due: ${c.due_date}`;
              if (c.is_debt && c.balance > 0) text += ` | Debt Bal: $${Number(c.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
              if (c.is_asap) text += ` | [ASAP]`;
              if (c.notes) text += ` | Notes: ${c.notes}`;
              
              text += `\n\n`;
          });
      });

      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `FinanceOS_Budget_${format(new Date(), 'yyyy-MM-dd')}.txt`;
      a.click();
  }

  // --- FUNDING & INLINE MATH LOGIC ---
  function openFundingMode(e: React.MouseEvent, cat: any) {
      e.stopPropagation();
      setFundingCatId(cat.id);
      setFundingAmount(cat.assigned_amount ? cat.assigned_amount.toString() : '0');
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

      newAmount = Math.round(newAmount * 100) / 100;

      const { error } = await supabase.from('categories').update({ assigned_amount: newAmount }).eq('id', fundingCatId);
      
      if (!error) {
          setCategories(categories.map(c => c.id === fundingCatId ? { ...c, assigned_amount: newAmount } : c));
      }
      setFundingCatId(null);
  }

  // --- TRANSFER LOGIC ---
  function openTransferModal(cat: any) {
      setTransferForm({ fromCatId: cat.id.toString(), toCatId: 'RTA', amount: '' });
      setIsTransferModalOpen(true);
  }

  const swapTransferDirection = () => {
      setTransferForm(prev => ({
          ...prev,
          fromCatId: prev.toCatId,
          toCatId: prev.fromCatId
      }));
  };

  async function executeTransfer(e: React.FormEvent) {
      e.preventDefault();
      const amt = parseFloat(transferForm.amount) || 0;
      if (amt <= 0) return;

      const fromId = transferForm.fromCatId;
      const toId = transferForm.toCatId;
      
      if (fromId === toId) return; // Prevent transferring to itself

      let updatedCategories = [...categories];

      // Handle DEDUCTION from Source
      if (fromId !== 'RTA') {
          const sourceCat = updatedCategories.find(c => c.id.toString() === fromId);
          if (sourceCat) {
              const newAmt = (Number(sourceCat.assigned_amount) || 0) - amt;
              await supabase.from('categories').update({ assigned_amount: newAmt }).eq('id', sourceCat.id);
              updatedCategories = updatedCategories.map(c => c.id.toString() === fromId ? { ...c, assigned_amount: newAmt } : c);
          }
      }

      // Handle ADDITION to Destination
      if (toId !== 'RTA') {
          const destCat = updatedCategories.find(c => c.id.toString() === toId);
          if (destCat) {
              const newAmt = (Number(destCat.assigned_amount) || 0) + amt;
              await supabase.from('categories').update({ assigned_amount: newAmt }).eq('id', destCat.id);
              updatedCategories = updatedCategories.map(c => c.id.toString() === toId ? { ...c, assigned_amount: newAmt } : c);
          }
      }

      setCategories(updatedCategories);
      setIsTransferModalOpen(false);
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
          setCategories(categories.map(c => c.id === cat.id ? { ...c, ...payload } : c));
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
          if (!error) setGroups(groups.map(g => g.id === editingGroupId ? { ...g, name: groupFormName } : g));
      } else {
          const { data } = await supabase.from('category_groups').insert([{ name: groupFormName }]).select().single();
          if (data) { setGroups([...groups, data]); setExpandedGroups(new Set(expandedGroups).add(data.id)); }
      }
      setIsGroupModalOpen(false);
  }

  async function deleteGroup() {
      if (!editingGroupId) return;
      if (!confirm("Delete this group? All categories inside will be deleted.")) return;
      await supabase.from('category_groups').delete().eq('id', editingGroupId);
      setGroups(groups.filter(g => g.id !== editingGroupId));
      setCategories(categories.filter(c => c.group_id !== editingGroupId));
      setIsGroupModalOpen(false);
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
              is_asap: cat.is_asap || false
          });
      } else {
          setEditingCatId(null);
          setCatForm({ 
              group_id: defaultGroupId ? defaultGroupId.toString() : (groups[0]?.id.toString() || ''), 
              name: '', emoji: '', target_type: 'Set Aside', target_amount: '', due_date: '', 
              is_repeating: false, target_period: 'Monthly', end_date: '', notes: '',
              is_debt: false, balance: '', is_asap: false
          });
      }
      setIsCategoryModalOpen(true);
  }

  async function saveCategory(e: React.FormEvent) {
      e.preventDefault();
      const payload = { 
          group_id: parseInt(catForm.group_id), name: catForm.name, emoji: catForm.emoji || null, 
          target_type: catForm.target_type, target_amount: parseFloat(catForm.target_amount) || 0, 
          due_date: catForm.due_date || null, is_repeating: catForm.is_repeating, target_period: catForm.target_period, 
          end_date: catForm.end_date || null, notes: catForm.notes || null,
          is_debt: catForm.is_debt, balance: parseFloat(catForm.balance) || 0,
          is_asap: catForm.is_asap
      };
      
      if (editingCatId) {
          const { error } = await supabase.from('categories').update(payload).eq('id', editingCatId);
          if (!error) setCategories(categories.map(c => c.id === editingCatId ? { ...c, ...payload } : c));
      } else {
          const { data } = await supabase.from('categories').insert([payload]).select().single();
          if (data) setCategories([...categories, data]);
      }
      setIsCategoryModalOpen(false);
  }

  async function deleteCategory() {
      if (!editingCatId) return;
      if (!confirm("Delete this category?")) return;
      await supabase.from('categories').delete().eq('id', editingCatId);
      setCategories(categories.filter(c => c.id !== editingCatId));
      setIsCategoryModalOpen(false);
  }

  // Math (Only count visible categories for totals)
  const visibleCategories = categories.filter(c => !c.is_hidden);
  const totalAssigned = visibleCategories.reduce((sum, c) => sum + Number(c.assigned_amount || 0), 0);
  
  let calculatedRTA = liquidCash - totalAssigned;
  if (Math.abs(calculatedRTA) < 0.01) calculatedRTA = 0; 
  const readyToAssign = calculatedRTA;

  const hasNegativeCategories = visibleCategories.some(c => Number(c.assigned_amount || 0) < 0);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400 font-bold animate-pulse">Loading Budget Engine...</div>;

  return (
    <main className="pb-32">

      {/* READY TO ASSIGN BANNER */}
      <div className={`text-white rounded-3xl p-6 md:p-8 shadow-lg mb-8 relative overflow-hidden flex flex-col md:flex-row justify-between items-center md:items-start gap-4 transition-colors ${readyToAssign < 0 ? 'bg-red-500' : 'bg-emerald-500'}`}>
        <div className={`absolute top-0 right-0 w-64 h-64 rounded-full mix-blend-screen filter blur-3xl opacity-50 translate-x-20 -translate-y-20 ${readyToAssign < 0 ? 'bg-red-400' : 'bg-emerald-400'}`}></div>
        <div className="relative z-10 text-center md:text-left">
           <h2 className="text-white/80 font-bold uppercase tracking-widest text-sm mb-2 flex items-center justify-center md:justify-start gap-2">
              <Wallet size={16}/> Ready to Assign
           </h2>
           <h1 className="text-5xl md:text-6xl font-black tracking-tighter">
              ${readyToAssign.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
           </h1>
           {readyToAssign < 0 && <p className="font-bold text-white mt-2 bg-red-600 inline-block px-3 py-1 rounded-lg text-sm">You assigned more money than you have in liquid cash.</p>}
        </div>
        <div className="relative z-10 flex flex-col items-center md:items-end gap-3">
            <div className="bg-white/20 backdrop-blur-md border border-white/20 rounded-xl p-4 w-full md:w-auto text-center">
                <p className="text-white/80 text-xs font-bold uppercase mb-1">Total Target Goals</p>
                <p className="text-xl font-bold">
                    ${visibleCategories.reduce((sum, c) => sum + Number(c.target_amount), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
            </div>
        </div>
      </div>

      {/* OVERSPENDING WARNING BANNER */}
      {hasNegativeCategories && (
          <div className="bg-red-100 border border-red-200 text-red-700 p-4 rounded-2xl flex items-start md:items-center gap-3 mb-8 shadow-sm animate-in fade-in slide-in-from-top-2">
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
            <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                <LayoutGrid size={24} className="text-blue-500"/> Budget Planner
            </h2>
            <button onClick={exportBudget} className="text-slate-400 hover:text-slate-900 transition-colors" title="Export Budget to .txt">
                <Download size={18}/>
            </button>
        </div>
        
        <div className="flex flex-wrap gap-2 w-full xl:w-auto">
            <div className="flex items-center bg-white px-3 py-2 rounded-xl border border-slate-200 shadow-sm flex-grow md:flex-grow-0 gap-2 divide-x divide-slate-100">
                <div className="flex items-center gap-2 pr-2">
                    <ArrowUpDown size={14} className="text-slate-400 shrink-0"/>
                    <select value={categorySort} onChange={handleSortChange} className="bg-transparent font-bold text-sm text-slate-900 outline-none cursor-pointer w-full">
                        <option value="default">Sort: Custom</option>
                        <option value="name">Sort: A-Z</option>
                        <option value="target">Sort: Goal</option>
                        <option value="assigned">Sort: Assigned</option>
                        <option value="date">Sort: Due Date</option>
                    </select>
                </div>
                <div className="flex items-center gap-2 pl-3">
                    <Filter size={14} className="text-slate-400 shrink-0"/>
                    <select value={categoryFilter} onChange={handleFilterChange} className="bg-transparent font-bold text-sm text-slate-900 outline-none cursor-pointer w-full">
                        <option value="all">View: All</option>
                        <option value="underfunded">View: Underfunded</option>
                        <option value="available">View: Available</option>
                        <option value="overspent">View: Overspent</option>
                    </select>
                </div>
            </div>
            <button onClick={() => openGroupModal()} className="flex-1 md:flex-none bg-white text-slate-600 border border-slate-200 px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-50 shadow-sm transition-colors">
                <FolderPlus size={18}/> New Group
            </button>
            <button onClick={() => openCategoryModal()} className="flex-1 md:flex-none bg-slate-900 text-white px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 shadow-sm transition-colors">
                <Plus size={18}/> New Category
            </button>
        </div>
      </div>

      {/* BUDGET GROUPS GRID */}
      <div className="space-y-6">
        {groups.map(group => {
            // Apply View Filter first
            let groupCats = visibleCategories.filter(c => {
                if (c.group_id !== group.id) return false;
                
                // MATH FIX: Snap to zero to kill floating point dust
                let assigned = Number(c.assigned_amount || 0);
                if (Math.abs(assigned) < 0.01) assigned = 0;
                
                const target = Number(c.target_amount || 0);
                
                if (categoryFilter === 'underfunded') {
                    return target > 0 && assigned < target;
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
                <div key={group.id} className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
                    <div onClick={() => toggleGroup(group.id)} className="bg-slate-50/50 p-4 border-b border-slate-100 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors">
                        <div className="flex items-center gap-3">
                            <div className="text-slate-400">{isExpanded ? <ChevronDown size={20}/> : <ChevronRight size={20}/>}</div>
                            <h3 className="font-bold text-lg text-slate-800">{group.name}</h3>
                            <button onClick={(e) => { e.stopPropagation(); openGroupModal(group); }} className="text-slate-300 hover:text-blue-500 p-1 rounded-md transition-colors"><Edit2 size={14}/></button>
                        </div>
                        <div className="flex items-center gap-4">
                            {groupTarget > 0 && <span className="text-sm font-bold text-slate-400 hidden md:inline-block">Target: ${groupTarget.toLocaleString()}</span>}
                            <button onClick={(e) => { e.stopPropagation(); openCategoryModal(null, group.id); }} className="text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors"><Plus size={14}/> Add Item</button>
                        </div>
                    </div>

                    {isExpanded && (
                        <div className="divide-y divide-slate-50">
                            {groupCats.length > 0 ? (
                                groupCats.map(cat => {
                                    // MATH FIX: Snap to zero to kill floating point dust
                                    let assigned = Number(cat.assigned_amount || 0);
                                    if (Math.abs(assigned) < 0.01) assigned = 0;
                                    
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
                                        savingsBreakdown = `Save $${daily.toFixed(2)}/d`;
                                        if (daysLeft >= 7) savingsBreakdown += ` • $${(daily * 7).toFixed(2)}/w`;
                                        if (daysLeft >= 30) savingsBreakdown += ` • $${(daily * 30.4).toFixed(2)}/mo`;
                                    }

                                    return (
                                        <div key={cat.id} className={`p-4 flex flex-col lg:flex-row lg:items-center justify-between hover:bg-slate-50 cursor-pointer transition-colors group/item gap-4 ${cat.is_asap || isPastDue ? 'bg-red-50/30' : ''}`} onClick={() => openCategoryModal(cat)}>
                                            <div className="flex items-center gap-3 w-full lg:w-1/2">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 border transition-colors shrink-0 text-lg ${cat.is_asap || isPastDue ? 'bg-red-50 border-red-200' : 'bg-slate-100 border-slate-200 group-hover/item:border-blue-200 group-hover/item:text-blue-500'}`}>
                                                    {cat.emoji ? cat.emoji : <Target size={16}/>}
                                                </div>
                                                <div className="min-w-0">
                                                    <h4 className="font-bold text-slate-700 truncate flex items-center gap-2">
                                                        {cat.name}
                                                        {cat.notes && <span title={cat.notes}><FileText size={12} className="text-slate-300" /></span>}
                                                        {isPastDue && !cat.is_asap && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold uppercase flex items-center gap-1"><AlertTriangle size={10}/> Late</span>}
                                                    </h4>
                                                    <div className="flex flex-wrap items-center gap-2 mt-0.5">
                                                        {cat.is_asap && (
                                                            <span className="text-[10px] font-bold text-white bg-red-500 px-1.5 py-0.5 rounded truncate flex items-center gap-1">
                                                                <AlertTriangle size={10}/> ASAP
                                                            </span>
                                                        )}
                                                        {cat.is_debt && cat.balance > 0 && (
                                                            <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded truncate">
                                                                Owe: ${cat.balance.toLocaleString()}
                                                            </span>
                                                        )}
                                                        {target > 0 && <span className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded truncate">{cat.target_type}: ${target} {cat.is_repeating && cat.target_period !== 'None' ? `/ ${cat.target_period}` : ''}</span>}
                                                        {cat.due_date && (
                                                            <div className="flex items-center gap-1">
                                                                <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                                                                    <Calendar size={10}/> {format(parseISO(cat.due_date), 'MMM d')}
                                                                </span>
                                                                {cat.is_repeating && cat.target_period !== 'None' && (
                                                                    <button 
                                                                        onClick={(e) => advanceDate(e, cat)}
                                                                        className="p-0.5 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors"
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
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">Assigned</p>
                                                    {isFunding ? (
                                                        <form onSubmit={saveFunding} onClick={e => e.stopPropagation()} className="flex items-center relative">
                                                            <span className="absolute left-2 font-bold text-slate-400 text-sm">$</span>
                                                            <input 
                                                                autoFocus
                                                                type="text" 
                                                                placeholder="e.g. +50 or 100-20"
                                                                className="w-28 pl-5 pr-2 py-1 bg-white border-2 border-blue-400 rounded-lg text-sm font-bold text-slate-900 outline-none shadow-sm"
                                                                value={fundingAmount}
                                                                onChange={e => setFundingAmount(e.target.value)}
                                                                onBlur={saveFunding}
                                                            />
                                                        </form>
                                                    ) : (
                                                        <div 
                                                            onClick={(e) => openFundingMode(e, cat)}
                                                            className={`font-bold px-3 py-1 rounded-lg text-sm transition-colors border cursor-pointer ${cat.is_asap || isPastDue ? 'bg-red-100 text-red-600 border-red-200 hover:bg-red-200' : 'bg-slate-100 text-slate-700 hover:bg-blue-100 hover:text-blue-700 border-transparent hover:border-blue-200'}`}
                                                            title="Click to assign money (Math enabled: +50, 100-20)"
                                                        >
                                                            ${assigned.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                        </div>
                                                    )}
                                                    {target > 0 && remainingToFund > 0 && (
                                                        <div className="flex flex-col mt-1 pl-1">
                                                            <p className="text-[9px] font-bold text-slate-400">Left: ${remainingToFund.toLocaleString()}</p>
                                                            {savingsBreakdown && <p className="text-[9px] font-bold text-blue-400">{savingsBreakdown}</p>}
                                                        </div>
                                                    )}
                                                </div>
                                                <div>
                                                    <p className={`text-[10px] font-bold uppercase mb-0.5 text-right transition-colors ${isNegative ? 'text-red-400' : isFullyFunded ? 'text-amber-500' : 'text-slate-400'}`}>Available</p>
                                                    <div 
                                                        onClick={(e) => { e.stopPropagation(); openTransferModal(cat); }}
                                                        className={`font-black px-3 py-1 rounded-lg text-sm border min-w-[80px] text-right cursor-pointer transition-all ${
                                                            isNegative 
                                                            ? 'bg-red-500 text-white border-red-600 hover:bg-red-600 hover:border-red-700 shadow-sm'
                                                            : isFullyFunded
                                                            ? 'bg-gradient-to-br from-yellow-400 to-amber-500 text-white border-amber-500 hover:from-yellow-500 hover:to-amber-600 shadow-md shadow-amber-500/40'
                                                            : 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100 hover:border-emerald-300'
                                                        }`}
                                                        title={isFullyFunded ? "Goal fully funded! Click to transfer money" : "Click to transfer money"}
                                                    >
                                                        {isNegative ? `-$${Math.abs(available).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : `$${available.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="p-6 text-center text-sm text-slate-400 font-medium">No items match the current filter.</div>
                            )}
                        </div>
                    )}
                </div>
            );
        })}

        {groups.length === 0 && (
            <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-slate-200">
                <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4"><FolderPlus size={32}/></div>
                <h4 className="font-bold text-slate-700 text-lg">Empty Budget</h4>
                <p className="text-sm text-slate-500 mt-1">Start by creating a Category Group (e.g., Living Expenses).</p>
            </div>
        )}
      </div>

      {/* --- MODAL: GROUP --- */}
      {isGroupModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={saveGroup} className="bg-white w-full max-w-sm rounded-3xl p-6 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-xl flex items-center gap-2"><FolderPlus size={20}/> {editingGroupId ? 'Edit Group' : 'New Group'}</h3>
              <div className="flex gap-2">
                 {editingGroupId && <button type="button" onClick={deleteGroup} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"><Trash2 size={18}/></button>}
                 <button type="button" onClick={() => setIsGroupModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"><X size={18}/></button>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Group Name</label>
                <input required autoFocus placeholder="e.g. Fixed Costs" className="w-full p-3 bg-slate-50 rounded-xl font-bold text-slate-900 border border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all" value={groupFormName} onChange={e => setGroupFormName(e.target.value)} />
              </div>
            </div>
            <button type="submit" className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold mt-8 shadow-lg hover:bg-slate-800 transition-colors">
              {editingGroupId ? 'Save Changes' : 'Create Group'}
            </button>
          </form>
        </div>
      )}

      {/* --- MODAL: CATEGORY (ADVANCED + DEBT + ASAP) --- */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={saveCategory} className="bg-white w-full max-w-lg rounded-3xl p-6 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto hide-scrollbar">
            <div className="flex justify-between items-center mb-6 sticky top-0 bg-white z-10 pb-2 border-b border-slate-50">
              <h3 className="font-bold text-xl flex items-center gap-2"><Target size={20}/> {editingCatId ? 'Edit Category' : 'New Category'}</h3>
              <div className="flex gap-2">
                 {editingCatId && <button type="button" onClick={deleteCategory} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"><Trash2 size={18}/></button>}
                 <button type="button" onClick={() => setIsCategoryModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"><X size={18}/></button>
              </div>
            </div>

            <div className="space-y-6">
              
              {/* BASIC INFO */}
              <div className="space-y-4">
                  <div className="flex gap-3">
                      <div className="w-1/4">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Emoji</label>
                          <input maxLength={2} placeholder="🍕" className="w-full p-3 bg-slate-50 rounded-xl font-black text-center text-xl text-slate-900 border border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all" value={catForm.emoji} onChange={e => setCatForm({...catForm, emoji: e.target.value})} />
                      </div>
                      <div className="w-3/4">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Category Name</label>
                          <input required autoFocus placeholder="e.g. Groceries" className="w-full p-3 bg-slate-50 rounded-xl font-bold text-slate-900 border border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all" value={catForm.name} onChange={e => setCatForm({...catForm, name: e.target.value})} />
                      </div>
                  </div>
                  <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Parent Group</label>
                      <select className="w-full p-3 bg-slate-50 rounded-xl font-bold text-slate-900 border border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all cursor-pointer" value={catForm.group_id} onChange={e => setCatForm({...catForm, group_id: e.target.value})}>
                          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                  </div>
              </div>

              {/* DEBT TRACKING */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-4">
                  <div className="flex items-center gap-3">
                      <button type="button" onClick={() => setCatForm({ ...catForm, is_debt: !catForm.is_debt })} className={`w-10 h-6 rounded-full flex items-center transition-colors px-1 ${catForm.is_debt ? 'bg-red-500' : 'bg-slate-300'}`}>
                          <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${catForm.is_debt ? 'translate-x-4' : 'translate-x-0'}`}></div>
                      </button>
                      <span className="text-sm font-bold text-slate-700">Track as Debt / Outstanding Balance</span>
                  </div>
                  
                  {catForm.is_debt && (
                      <div className="animate-in slide-in-from-top-2 fade-in">
                          <label className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-1.5 flex items-center gap-1"><AlertCircle size={12}/> Total Balance Owed</label>
                          <div className="relative">
                              <span className="absolute left-3 top-2.5 font-bold text-red-400">$</span>
                              <input type="number" step="0.01" placeholder="0.00" className="w-full pl-7 p-2.5 bg-white rounded-lg font-black text-sm border border-red-200 outline-none focus:border-red-400 transition-all text-red-600" value={catForm.balance} onChange={e => setCatForm({...catForm, balance: e.target.value})} />
                          </div>
                      </div>
                  )}
              </div>

              {/* TARGET GOAL SETTINGS */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-4">
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-2"><Target size={14}/> Goal Target</h4>
                  <div className="flex flex-col md:flex-row gap-3">
                      <div className="w-full md:w-1/2">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Goal Type</label>
                          <select className="w-full p-2.5 bg-white rounded-lg font-bold text-sm text-slate-900 border border-slate-200 outline-none focus:border-blue-300 cursor-pointer" value={catForm.target_type} onChange={e => setCatForm({...catForm, target_type: e.target.value})}>
                              <option value="Set Aside">Set Aside (Build up over time)</option>
                              <option value="Fill Up To">Fill Up To (Cap at amount)</option>
                              <option value="Have Balance">Have a Balance (Target total)</option>
                          </select>
                      </div>
                      <div className="w-full md:w-1/2">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Target Amount</label>
                          <div className="relative">
                              <span className="absolute left-3 top-2.5 font-bold text-slate-400">$</span>
                              <input type="number" step="0.01" placeholder="0.00" className="w-full pl-7 p-2.5 bg-white rounded-lg font-black text-sm text-slate-900 border border-slate-200 outline-none focus:border-blue-300 transition-all" value={catForm.target_amount} onChange={e => setCatForm({...catForm, target_amount: e.target.value})} />
                          </div>
                      </div>
                  </div>
              </div>

              {/* SCHEDULE & TIMELINE */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-4">
                  <div className="flex justify-between items-center mb-1">
                      <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-2"><Calendar size={14}/> Schedule & Timeline</h4>
                      {/* ASAP TOGGLE */}
                      <button 
                          type="button" 
                          onClick={() => setCatForm({ ...catForm, is_asap: !catForm.is_asap })} 
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border flex items-center gap-1 transition-colors ${catForm.is_asap ? 'bg-red-500 text-white border-red-600' : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-100'}`}
                      >
                          <AlertTriangle size={10}/> Due ASAP
                      </button>
                  </div>
                  
                  <div className="flex gap-3">
                      <div className="w-1/2">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Due Date / Funding Date</label>
                          <input type="date" className="w-full p-2.5 bg-white rounded-lg font-bold text-sm text-slate-900 border border-slate-200 outline-none focus:border-blue-300 transition-all" value={catForm.due_date} onChange={e => setCatForm({...catForm, due_date: e.target.value})} />
                      </div>
                      <div className="w-1/2">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Final Payment / End Date</label>
                          <input type="date" className="w-full p-2.5 bg-white rounded-lg font-bold text-sm text-slate-900 border border-slate-200 outline-none focus:border-blue-300 transition-all" value={catForm.end_date} onChange={e => setCatForm({...catForm, end_date: e.target.value})} />
                      </div>
                  </div>
                  
                  <div className="flex items-center gap-3 pt-2">
                      <button type="button" onClick={() => setCatForm({ ...catForm, is_repeating: !catForm.is_repeating })} className={`w-10 h-6 rounded-full flex items-center transition-colors px-1 ${catForm.is_repeating ? 'bg-blue-500' : 'bg-slate-300'}`}>
                          <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${catForm.is_repeating ? 'translate-x-4' : 'translate-x-0'}`}></div>
                      </button>
                      <span className="text-sm font-bold text-slate-700">Goal Repeats?</span>
                  </div>

                  {catForm.is_repeating && (
                      <div className="animate-in slide-in-from-top-2 fade-in mt-2">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Frequency</label>
                          <select className="w-full p-2.5 bg-white rounded-lg font-bold text-sm text-slate-900 border border-slate-200 outline-none focus:border-blue-300 cursor-pointer" value={catForm.target_period} onChange={e => setCatForm({...catForm, target_period: e.target.value})}>
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
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2"><AlignLeft size={14}/> Category Notes</label>
                  <textarea placeholder="Account numbers, vendor phone numbers, login details..." className="w-full p-3 bg-slate-50 rounded-xl font-bold text-sm text-slate-900 placeholder-slate-400 border border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all resize-none" rows={3} value={catForm.notes} onChange={e => setCatForm({...catForm, notes: e.target.value})} />
              </div>
            </div>

            <button type="submit" className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold mt-8 shadow-lg hover:bg-slate-800 transition-colors">
              {editingCatId ? 'Save Changes' : 'Save Category'}
            </button>
          </form>
        </div>
      )}

      {/* --- MODAL: TRANSFER MONEY --- */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={executeTransfer} className="bg-white w-full max-w-sm rounded-3xl p-6 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-xl flex items-center gap-2"><ArrowRightLeft size={20} className="text-emerald-500"/> Move Money</h3>
              <button type="button" onClick={() => setIsTransferModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"><X size={18}/></button>
            </div>

            <div className="space-y-4">
                <div>
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Amount to Move</label>
                    <div className="relative">
                        <span className="absolute left-4 top-3.5 font-bold text-slate-400">$</span>
                        <input required autoFocus type="number" step="0.01" max={transferForm.fromCatId !== 'RTA' ? (categories.find(c => c.id.toString() === transferForm.fromCatId)?.assigned_amount || 0) : undefined} placeholder="0.00" className="w-full pl-8 p-3 bg-slate-50 rounded-xl font-black text-lg text-slate-900 border border-slate-100 outline-none focus:border-emerald-300 focus:bg-white transition-all" value={transferForm.amount} onChange={e => setTransferForm({...transferForm, amount: e.target.value})} />
                    </div>
                </div>
                
                <div className="flex flex-col gap-2 bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider w-12 shrink-0">From</span>
                        <select className="flex-1 min-w-0 p-3 bg-white rounded-xl font-bold text-slate-900 border border-slate-200 outline-none focus:border-emerald-300 cursor-pointer truncate" value={transferForm.fromCatId} onChange={e => setTransferForm({...transferForm, fromCatId: e.target.value})}>
                            <option value="RTA">Ready to Assign</option>
                            <optgroup label="Categories">
                                {visibleCategories.map(c => (
                                    <option key={`from-${c.id}`} value={c.id.toString()}>{c.name}</option>
                                ))}
                            </optgroup>
                        </select>
                    </div>
                    
                    <div className="flex justify-center -my-2 relative z-10">
                        <button type="button" onClick={swapTransferDirection} className="bg-white p-2 rounded-full border border-slate-200 shadow-sm text-slate-400 hover:text-emerald-500 hover:border-emerald-200 transition-all hover:bg-emerald-50" title="Swap transfer direction">
                            <ArrowUpDown size={16} />
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider w-12 shrink-0">To</span>
                        <select className="flex-1 min-w-0 p-3 bg-white rounded-xl font-bold text-slate-900 border border-slate-200 outline-none focus:border-emerald-300 cursor-pointer truncate" value={transferForm.toCatId} onChange={e => setTransferForm({...transferForm, toCatId: e.target.value})}>
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

            <button type="submit" className="w-full bg-emerald-500 text-white py-4 rounded-xl font-bold mt-8 shadow-lg shadow-emerald-200 hover:bg-emerald-600 transition-colors">
              Move Funds
            </button>
          </form>
        </div>
      )}

    </main>
  );
}
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  Wallet, Landmark, CreditCard, Banknote, Plus, 
  ArrowUpRight, ArrowDownRight, ArrowRightLeft, Activity, X, 
  AlertCircle, Trash2, LayoutGrid, PieChart, ListOrdered, 
  Calendar, FileText, Download, Zap, Edit2, Tag, AlignLeft, Save, Loader2,
  TrendingUp, Split
} from 'lucide-react';
import { format, parseISO, addWeeks, addMonths, addYears } from 'date-fns';
import SearchableDropdown from '@/app/components/SearchableDropdown';
import { formatMoney, roundMoney, snapMoney } from '@/lib/money';
import { applyBalanceAdjustment, applySmartBillPay } from '@/lib/balance-adjustment';
import {
  categorySupportsAdvanceDueDate,
  categorySupportsSmartBillPay,
} from '@/lib/smart-bill-pay';
import { applyTransactionBalances } from '@/lib/transaction-balance';
import { replaceTransactionSplits } from '@/lib/queries/transaction-splits';
import {
  emptySplitLine,
  parseSplitLines,
  splitsMatchTotal,
  type SplitFormLine,
} from '@/lib/transaction-splits';
import { SplitTransactionFields } from '@/features/ledger/split-transaction-fields';
import { PageSkeleton } from '@/components/ui/skeleton';
import { Fab } from '@/components/layout/fab';
import { useReadyToAssign } from '@/hooks/use-ready-to-assign';
import { sortPendingByDate } from '@/lib/projected-income';
import {
  cancelProjectedIncome,
  fetchAllProjectedIncome,
  fetchPendingProjectedIncome,
} from '@/lib/queries/projected-income';
import { attachSplitsToTransactions } from '@/lib/queries/transactions';
import { ExportModal } from '@/features/export/export-modal';
import { PROJECTED_INCOME_CERTAINTY_LABELS } from '@/lib/projected-income';
import {
  ProjectedIncomeFormModal,
  ProjectedIncomeListModal,
  ProjectedIncomeReceiveModal,
} from '@/features/projected-income/projected-income-modals';
import { computeInitialNextPaymentDueDate } from '@/lib/credit-cards';
import type { Account, Category, ProjectedIncome } from '@/lib/types';

export function DashboardView() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [payeeSuggestions, setPayeeSuggestions] = useState<string[]>([]);
  const [monthlyStats, setMonthlyStats] = useState({ income: 0, expense: 0 });
  const [totalAssigned, setTotalAssigned] = useState(0);
  const [pendingProjected, setPendingProjected] = useState<ProjectedIncome[]>([]);
  const [allProjected, setAllProjected] = useState<ProjectedIncome[]>([]);
  const [loading, setLoading] = useState(true);

  const [isProjectedFormOpen, setIsProjectedFormOpen] = useState(false);
  const [editingProjected, setEditingProjected] = useState<ProjectedIncome | null>(null);
  const [receiveProjected, setReceiveProjected] = useState<ProjectedIncome | null>(null);
  const [isProjectedListOpen, setIsProjectedListOpen] = useState(false);

  // Modals
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  
  const [isQuickEntryOpen, setIsQuickEntryOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isSubmittingTxn, setIsSubmittingTxn] = useState(false);

  // Smart Bill Pay Logic States
  const [smartBillPay, setSmartBillPay] = useState({
      showToggle: false,
      advanceCycle: true,
      deductDebt: true,
      category: null as any
  });
  
  // Forms
  const [accountForm, setAccountForm] = useState({
    name: '',
    type: 'Checking',
    balance: '',
    credit_limit: '',
    minimum_payment: '',
    payment_due_day: '',
    payment_category_id: '',
  });
  const [adjustmentType, setAdjustmentType] = useState('transaction');

  const [quickForm, setQuickForm] = useState({
    type: 'Expense', date: format(new Date(), 'yyyy-MM-dd'), amount: '', 
    payee: '', category_id: '', account_id: '', to_account_id: '', notes: ''
  });

  const [isSplitMode, setIsSplitMode] = useState(false);
  const [splitLines, setSplitLines] = useState<SplitFormLine[]>([
    emptySplitLine(),
    emptySplitLine(),
  ]);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  async function fetchDashboardData() {
    setLoading(true);
    
    const { data: accs } = await supabase.from('accounts').select('*').order('type').order('name');
    if (accs) setAccounts(accs);

    const { data: cats } = await supabase.from('categories').select('id, name, emoji, assigned_amount, is_hidden').order('name');
    if (cats) {
        setCategories(cats);
        setTotalAssigned(snapMoney(cats.filter(c => !c.is_hidden).reduce((sum, c) => sum + Number(c.assigned_amount || 0), 0)));
    }

    const { data: txns } = await supabase
      .from('transactions')
      .select('*, categories(name, emoji), accounts!account_id(name, type)')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10);
      
    if (txns) {
        setRecentTransactions(txns);
        const unique = Array.from(new Set(txns.map(t => t.payee).filter(Boolean)));
        setPayeeSuggestions(unique as string[]);
    }

    // Calculate Monthly Cashflow
    const startOfMonth = format(new Date(), 'yyyy-MM-01');
    const { data: monthTxns } = await supabase.from('transactions').select('amount, type').gte('date', startOfMonth);
    
    let inc = 0; let exp = 0;
    if (monthTxns) {
        monthTxns.forEach(t => {
            if (t.type === 'Income') inc = roundMoney(inc + Number(t.amount));
            if (t.type === 'Expense') exp = roundMoney(exp + Number(t.amount));
        });
    }
    setMonthlyStats({ income: inc, expense: exp });

    const { data: pending } = await fetchPendingProjectedIncome();
    if (pending) setPendingProjected(pending);

    const { data: allProj } = await fetchAllProjectedIncome();
    if (allProj) setAllProjected(allProj);

    setLoading(false);
  }

  async function refreshProjectedIncome() {
    const { data: pending } = await fetchPendingProjectedIncome();
    if (pending) setPendingProjected(pending);
    const { data: allProj } = await fetchAllProjectedIncome();
    if (allProj) setAllProjected(allProj);

    const { data: accs } = await supabase.from('accounts').select('*').order('type').order('name');
    if (accs) setAccounts(accs);

    const { data: cats } = await supabase
      .from('categories')
      .select('id, name, emoji, assigned_amount, is_hidden')
      .order('name');
    if (cats) {
      setCategories(cats);
      setTotalAssigned(
        snapMoney(
          cats.filter((c) => !c.is_hidden).reduce((sum, c) => sum + Number(c.assigned_amount || 0), 0)
        )
      );
    }
  }

  async function handleCancelProjected(id: number) {
    await cancelProjectedIncome(id);
    await refreshProjectedIncome();
  }

  function openAddProjected() {
    setEditingProjected(null);
    setIsProjectedFormOpen(true);
  }

  function openEditProjected(item: ProjectedIncome) {
    setEditingProjected(item);
    setIsProjectedFormOpen(true);
    setIsProjectedListOpen(false);
  }

  // --- ACCOUNT CRUD LOGIC ---
  function openAccountModal(acc: any = null) {
    if (acc) {
      setEditingAccountId(acc.id);
      setAccountForm({
        name: acc.name,
        type: acc.type,
        balance: roundMoney(acc.balance).toFixed(2),
        credit_limit: acc.credit_limit ? roundMoney(acc.credit_limit).toFixed(2) : '',
        minimum_payment: acc.minimum_payment
          ? roundMoney(acc.minimum_payment).toFixed(2)
          : '',
        payment_due_day:
          acc.payment_due_day != null ? String(acc.payment_due_day) : '',
        payment_category_id: acc.payment_category_id
          ? String(acc.payment_category_id)
          : '',
      });
    } else {
      setEditingAccountId(null);
      setAccountForm({
        name: '',
        type: 'Checking',
        balance: '',
        credit_limit: '',
        minimum_payment: '',
        payment_due_day: '',
        payment_category_id: '',
      });
    }
    setAdjustmentType('transaction');
    setIsAccountModalOpen(true);
  }

  async function saveAccount(e: React.FormEvent) {
    e.preventDefault();
    const newBalance = roundMoney(parseFloat(accountForm.balance) || 0);
    const oldAcc = accounts.find(a => a.id === editingAccountId);
    const oldBalance = oldAcc ? roundMoney(oldAcc.balance) : 0;
    
    const isCC = accountForm.type === 'Credit Card';
    const dueDayRaw = parseInt(accountForm.payment_due_day, 10);
    const dueDayValid =
      isCC && accountForm.payment_due_day && dueDayRaw >= 1 && dueDayRaw <= 31;
    const dueDayChanged =
      oldAcc && dueDayValid && oldAcc.payment_due_day !== dueDayRaw;

    const payload: Record<string, unknown> = {
      name: accountForm.name,
      type: accountForm.type,
      balance: newBalance,
      credit_limit: roundMoney(parseFloat(accountForm.credit_limit) || 0),
      minimum_payment: isCC ? roundMoney(parseFloat(accountForm.minimum_payment) || 0) : 0,
      payment_due_day: dueDayValid ? dueDayRaw : null,
      payment_category_id:
        isCC && accountForm.payment_category_id
          ? Number(accountForm.payment_category_id)
          : null,
    };

    if (isCC && dueDayValid) {
      if (!editingAccountId || dueDayChanged || !oldAcc?.next_payment_due_date) {
        payload.next_payment_due_date =
          computeInitialNextPaymentDueDate(dueDayRaw);
      }
    } else if (!isCC) {
      payload.next_payment_due_date = null;
      payload.payment_category_id = null;
    }

    if (editingAccountId && adjustmentType === 'transaction' && oldBalance !== newBalance) {
        const diff = roundMoney(newBalance - oldBalance);
        const isCC = accountForm.type === 'Credit Card';
        
        let txnType = 'Expense';
        if (isCC) txnType = diff > 0 ? 'Expense' : 'Income'; 
        else txnType = diff > 0 ? 'Income' : 'Expense';      
        
        const txnPayload = {
            date: format(new Date(), 'yyyy-MM-dd'),
            amount: roundMoney(Math.abs(diff)),
            payee: 'Manual Balance Adjustment',
            account_id: editingAccountId,
            type: txnType,
            notes: 'Auto-generated via account edit.'
        };
        await supabase.from('transactions').insert([txnPayload]);
    }

    if (editingAccountId) {
      await supabase.from('accounts').update(payload).eq('id', editingAccountId);
    } else {
      await supabase.from('accounts').insert([payload]);
    }
    
    setIsAccountModalOpen(false);
    fetchDashboardData(); 
  }

  async function deleteAccount() {
    if (!editingAccountId) return;
    if (!confirm("Are you sure you want to delete this account? This will break associated transactions.")) return;
    await supabase.from('accounts').delete().eq('id', editingAccountId);
    setIsAccountModalOpen(false);
    fetchDashboardData();
  }

  // --- QUICK ENTRY LOGIC ---
  function openQuickEntry(accId?: number) {
      setQuickForm({
        type: 'Expense', date: format(new Date(), 'yyyy-MM-dd'), amount: '', 
        payee: '', category_id: '', account_id: (accId ?? accounts[0]?.id)?.toString() || '', to_account_id: '', notes: ''
      });
      setIsSplitMode(false);
      setSplitLines([emptySplitLine(), emptySplitLine()]);
      setSmartBillPay({ showToggle: false, advanceCycle: true, deductDebt: true, category: null });
      setIsQuickEntryOpen(true);
  }

  // Feature 1: Payee Memory
  const handlePayeeChange = async (val: string) => {
      setQuickForm(prev => ({ ...prev, payee: val }));
      
      if (val) {
          const { data } = await supabase
              .from('transactions')
              .select('category_id')
              .eq('payee', val)
              .order('date', { ascending: false })
              .limit(1);
          
          if (data && data[0]?.category_id) {
              const catId = data[0].category_id.toString();
              setQuickForm(prev => ({ ...prev, category_id: catId }));
              checkSmartBillPay(catId);
          }
      }
  };

  const checkSmartBillPay = (catId: string) => {
      if (!catId) {
          setSmartBillPay({ showToggle: false, advanceCycle: true, deductDebt: true, category: null });
          return;
      }
      supabase.from('categories').select('*').eq('id', catId).single().then(({ data }) => {
          if (data && categorySupportsSmartBillPay(data)) {
              setSmartBillPay({
                  showToggle: true,
                  advanceCycle: categorySupportsAdvanceDueDate(data),
                  deductDebt: Boolean(data.is_debt),
                  category: data,
              });
          } else {
              setSmartBillPay({ showToggle: false, advanceCycle: true, deductDebt: true, category: null });
          }
      });
  };

  const handleBalanceAdjustment = (txn: any) => applyBalanceAdjustment(txn, 'apply');

  function resetQuickEntryForm() {
      setQuickForm({
          type: 'Expense',
          date: format(new Date(), 'yyyy-MM-dd'),
          amount: '',
          payee: '',
          category_id: '',
          account_id: accounts[0]?.id?.toString() || '',
          to_account_id: '',
          notes: '',
      });
      setIsSplitMode(false);
      setSplitLines([emptySplitLine(), emptySplitLine()]);
      setSmartBillPay({ showToggle: false, advanceCycle: true, deductDebt: true, category: null });
  }

  async function saveQuickEntry(e: React.FormEvent) {
      e.preventDefault();
      setIsSubmittingTxn(true);

      const amount = roundMoney(parseFloat(quickForm.amount) || 0);
      const useSplit = isSplitMode && quickForm.type !== 'Transfer';
      const parsedSplits = useSplit ? parseSplitLines(splitLines) : [];

      if (useSplit) {
          if (parsedSplits.length < 2) {
              alert('Add at least two categories with amounts for a split transaction.');
              setIsSubmittingTxn(false);
              return;
          }
          if (!splitsMatchTotal(amount, splitLines)) {
              alert('Split amounts must equal the transaction total.');
              setIsSubmittingTxn(false);
              return;
          }
      }

      const payload = {
          date: quickForm.date,
          amount: amount,
          payee: quickForm.type === 'Transfer' ? 'Transfer' : quickForm.payee,
          category_id:
            quickForm.type === 'Transfer'
              ? null
              : useSplit
                ? null
                : quickForm.category_id
                  ? parseInt(quickForm.category_id)
                  : null,
          account_id: parseInt(quickForm.account_id),
          to_account_id: quickForm.type === 'Transfer' ? parseInt(quickForm.to_account_id) : null,
          type: quickForm.type,
          notes: quickForm.notes || null,
      };

      const { data: inserted } = await supabase.from('transactions').insert([payload]).select().single();
      if (inserted) {
          if (useSplit) {
              await replaceTransactionSplits(inserted.id, parsedSplits);
              const [fullTxn] = await attachSplitsToTransactions([inserted]);
              await applyTransactionBalances(fullTxn);
          } else {
              await handleBalanceAdjustment(payload);
              if (smartBillPay.showToggle && smartBillPay.category) {
                  await applySmartBillPay(smartBillPay.category, {
                      advanceCycle: smartBillPay.advanceCycle,
                      deductDebt: smartBillPay.deductDebt,
                  });
              }
          }

          setIsQuickEntryOpen(false);
          resetQuickEntryForm();
          await fetchDashboardData();
      }
      setIsSubmittingTxn(false);
  }

  const netWorth = snapMoney(accounts.reduce((sum, acc) => acc.type === 'Credit Card' ? sum - Math.abs(acc.balance) : sum + Number(acc.balance), 0));
  const {
    liquidCash,
    readyToAssign,
    projectedReadyToAssign,
    conservativeProjectedRta,
    pendingInflow,
    guaranteedInflow,
    anticipatedInflow,
  } = useReadyToAssign(
    accounts,
    categories.map((c) => ({ ...c, is_hidden: c.is_hidden ?? false, assigned_amount: c.assigned_amount })),
    pendingProjected
  );

  const upcomingProjected = sortPendingByDate(pendingProjected).slice(0, 5);

  // Feature 8: Group and Sort Accounts
  const liquidAccounts = accounts
    .filter(a => ['Checking', 'Savings', 'Cash'].includes(a.type))
    .sort((a, b) => a.name.localeCompare(b.name));
  
  const creditCards = accounts
    .filter(a => a.type === 'Credit Card')
    .sort((a, b) => a.name.localeCompare(b.name));

  const getAccountIcon = (type: string) => {
    switch(type) {
      case 'Checking': return <Landmark className="text-blue-500" size={24} />;
      case 'Savings': return <Wallet className="text-emerald-500" size={24} />;
      case 'Credit Card': return <CreditCard className="text-red-500" size={24} />;
      case 'Cash': return <Banknote className="text-green-600" size={24} />;
      default: return <Landmark className="text-[var(--text-muted)]" size={24} />;
    }
  };

  const getTxnIcon = (type: string) => {
    switch(type) {
      case 'Income': return <div className="p-3 bg-emerald-500/15 rounded-2xl text-emerald-600 shadow-sm"><ArrowUpRight size={20}/></div>;
      case 'Expense': return <div className="p-3 bg-[var(--surface-subtle)] rounded-2xl text-[var(--text-muted)] shadow-sm"><ArrowDownRight size={20}/></div>;
      case 'Transfer': return <div className="p-3 bg-blue-500/15 rounded-2xl text-blue-600 shadow-sm"><ArrowRightLeft size={20}/></div>;
      default: return <div className="p-3 bg-[var(--surface-subtle)] rounded-2xl text-[var(--text-muted)] shadow-sm"><Activity size={20}/></div>;
    }
  };

  if (loading) return <PageSkeleton />;

  return (
    <>
      
      {/* HEADER & NET WORTH */}
      <div className="mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
            <h1 className="text-4xl font-extrabold text-[var(--text-primary)] tracking-tight">Finance<span className="text-emerald-500">OS</span></h1>
            <button type="button" onClick={() => setIsExportOpen(true)} className="w-full md:w-auto app-card px-4 py-2 rounded-xl text-[var(--text-muted)] font-bold border border-[var(--border)] shadow-sm flex items-center justify-center gap-2 hover:bg-[var(--surface-hover)] transition-colors">
                <Download size={16}/> Export
            </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          <div className="col-span-1 md:col-span-2 gradient-hero text-white rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 translate-x-20 -translate-y-20"></div>
            <p className="text-white/70 font-bold text-sm uppercase tracking-widest mb-2">Total Net Worth</p>
            <h2 className="text-5xl md:text-7xl font-black tracking-tighter mb-4">
              ${formatMoney(netWorth)}
            </h2>
            <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-white/90">
              <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-lg backdrop-blur-md border border-white/5">
                 <Wallet size={16} className="text-emerald-400"/>
                 <span>Liquid Cash: ${formatMoney(liquidCash)}</span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-lg backdrop-blur-md border border-white/5">
                 <Activity size={16} className="text-blue-400"/>
                 <span>This Month: <span className="text-emerald-400">+${formatMoney(monthlyStats.income)}</span> / <span className="text-red-400">-${formatMoney(monthlyStats.expense)}</span></span>
              </div>
            </div>
          </div>

          <div className={`text-white rounded-3xl p-6 shadow-lg flex flex-col justify-center items-center text-center relative overflow-hidden transition-colors ${readyToAssign < 0 ? 'bg-red-500/100' : 'bg-emerald-500'}`}>
            <div className={`absolute top-0 left-0 w-32 h-32 rounded-full filter blur-2xl opacity-50 -translate-x-10 -translate-y-10 ${readyToAssign < 0 ? 'bg-red-400' : 'bg-emerald-400'}`}></div>
            <h3 className="font-bold text-white/90 uppercase tracking-widest text-xs mb-2 z-10">Ready to Assign</h3>
            <div className="font-black text-4xl tracking-tighter z-10">
               ${formatMoney(readyToAssign)}
            </div>
            {readyToAssign < 0 && <p className="text-xs bg-red-700/50 text-white px-2 py-1 rounded mt-3 font-bold z-10 flex items-center gap-1 border border-red-400"><AlertCircle size={12}/> Overbudgeted</p>}
            {pendingInflow > 0 && (
              <div className="text-xs text-white/80 mt-3 z-10 font-medium leading-snug space-y-1">
                <p>
                  If guaranteed arrives:{' '}
                  <span className="font-black text-white">${formatMoney(conservativeProjectedRta)}</span>
                </p>
                {anticipatedInflow > 0 && (
                  <p>
                    If all pending (${formatMoney(guaranteedInflow)} + ${formatMoney(anticipatedInflow)}):{' '}
                    <span className="font-black text-white">${formatMoney(projectedReadyToAssign)}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 md:mt-8 app-card rounded-3xl p-5 md:p-6 border border-[var(--border)] shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-lg text-[var(--text-primary)] flex items-center gap-2">
              <TrendingUp size={20} className="text-emerald-500" />
              Expected income
            </h3>
            <button
              type="button"
              onClick={openAddProjected}
              className="p-2 bg-emerald-500/10 text-emerald-600 rounded-full hover:bg-emerald-500/20 transition-colors"
            >
              <Plus size={16} />
            </button>
          </div>
          {upcomingProjected.length > 0 ? (
            <div className="space-y-2">
              {upcomingProjected.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border)]"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-[var(--text-primary)] truncate">{item.label}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {format(new Date(item.expected_date + 'T00:00:00'), 'MMM d')}
                      {item.accounts?.name ? ` · ${item.accounts.name}` : ''}
                      {' · '}
                      <span
                        className={
                          (item.certainty ?? 'guaranteed') === 'guaranteed'
                            ? 'text-emerald-600'
                            : 'text-amber-600'
                        }
                      >
                        {PROJECTED_INCOME_CERTAINTY_LABELS[item.certainty ?? 'guaranteed']}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-black text-emerald-600">+${formatMoney(item.amount)}</span>
                    <button
                      type="button"
                      onClick={() => setReceiveProjected(item)}
                      className="text-[10px] font-bold px-2 py-1 bg-emerald-500 text-white rounded-lg"
                    >
                      Received
                    </button>
                  </div>
                </div>
              ))}
            </div>

          ) : (
            <p className="text-sm text-[var(--text-muted)] text-center py-6">
              Track paychecks, gig payouts, and invoices before they land.
            </p>
          )}
          <button
            type="button"
            onClick={() => setIsProjectedListOpen(true)}
            className="w-full mt-4 py-2.5 text-sm font-bold text-emerald-600 hover:bg-emerald-500/10 rounded-xl transition-colors"
          >
            View all expected income
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* ACCOUNTS COLUMN */}
        <div className="lg:col-span-1 space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-xl text-[var(--text-primary)] flex items-center gap-2"><Landmark size={20}/> Accounts</h3>
            <button onClick={() => openAccountModal()} className="p-2 bg-[var(--surface-subtle)] hover:bg-emerald-500/100/15 hover:text-emerald-600 text-[var(--text-muted)] rounded-full transition-colors"><Plus size={16} /></button>
          </div>

          <div className="space-y-6">
            {/* Liquid Accounts Section */}
            {liquidAccounts.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-2 px-1">
                  <Banknote size={12}/> Liquid Accounts
                </h4>
                {liquidAccounts.map(acc => (
                  <div key={acc.id} className="app-card rounded-2xl shadow-sm border border-[var(--border)] flex flex-col hover:border-emerald-500/30 transition-all group overflow-hidden">
                    <div className="p-4 flex items-center gap-4 cursor-pointer" onClick={() => router.push(`/ledger?account=${acc.id}`)}>
                        <div className="w-12 h-12 bg-[var(--surface-subtle)] rounded-xl flex items-center justify-center shrink-0 border border-[var(--border)]">{getAccountIcon(acc.type)}</div>
                        <div className="flex-grow min-w-0">
                        <h4 className="font-bold text-[var(--text-primary)] truncate">{acc.name}</h4>
                        <p className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider mb-1">{acc.type}</p>
                        </div>
                        <div className="font-black text-lg text-[var(--text-primary)]">
                        {snapMoney(acc.balance) < 0 ? '-' : ''}${formatMoney(Math.abs(acc.balance))}
                        </div>
                    </div>
                    <div className="flex border-t border-[var(--border)] bg-[var(--surface-subtle)]">
                        <button onClick={() => openQuickEntry(acc.id)} className="flex-1 py-2.5 text-xs font-bold text-[var(--text-muted)] hover:bg-emerald-500/10 hover:text-emerald-600 border-r border-[var(--border)] transition-colors flex items-center justify-center gap-1">
                            <Zap size={12}/> Quick Entry
                        </button>
                        <button onClick={() => openAccountModal(acc)} className="flex-1 py-2.5 text-xs font-bold text-[var(--text-muted)] hover:bg-blue-500/10 hover:text-blue-600 transition-colors flex items-center justify-center gap-1">
                            <Edit2 size={12}/> Edit
                        </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Credit Cards Section */}
            {creditCards.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-red-400 uppercase tracking-widest flex items-center gap-2 px-1">
                  <CreditCard size={12}/> Credit Cards
                </h4>
                {creditCards.map(acc => (
                  <div key={acc.id} className="app-card rounded-2xl shadow-sm border border-[var(--border)] flex flex-col hover:border-red-500/30 transition-all group overflow-hidden">
                    <div className="p-4 flex items-center gap-4 cursor-pointer" onClick={() => router.push(`/ledger?account=${acc.id}`)}>
                        <div className="w-12 h-12 bg-[var(--surface-subtle)] rounded-xl flex items-center justify-center shrink-0 border border-[var(--border)]">{getAccountIcon(acc.type)}</div>
                        <div className="flex-grow min-w-0">
                        <h4 className="font-bold text-[var(--text-primary)] truncate">{acc.name}</h4>
                        <p className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider mb-1">{acc.type}</p>
                        {acc.credit_limit > 0 && (
                          <div className="text-xs font-bold text-emerald-600">
                            Avail: ${formatMoney(Math.max(0, acc.credit_limit - Math.abs(snapMoney(acc.balance))))}
                          </div>
                        )}
                        {acc.minimum_payment > 0 && (
                          <p className="text-[10px] font-bold text-orange-600 mt-0.5">
                            Min pay ${formatMoney(acc.minimum_payment)}
                            {acc.payment_due_day != null ? ` · due day ${acc.payment_due_day}` : ''}
                          </p>
                        )}
                        </div>
                        <div className="font-black text-lg text-red-500">
                        {snapMoney(acc.balance) < 0 ? '-' : ''}${formatMoney(Math.abs(acc.balance))}
                        </div>
                    </div>
                    <div className="flex border-t border-[var(--border)] bg-[var(--surface-subtle)]">
                        <button onClick={() => openQuickEntry(acc.id)} className="flex-1 py-2.5 text-xs font-bold text-[var(--text-muted)] hover:bg-emerald-500/10 hover:text-emerald-600 border-r border-[var(--border)] transition-colors flex items-center justify-center gap-1">
                            <Zap size={12}/> Quick Entry
                        </button>
                        <button onClick={() => openAccountModal(acc)} className="flex-1 py-2.5 text-xs font-bold text-[var(--text-muted)] hover:bg-blue-500/10 hover:text-blue-600 transition-colors flex items-center justify-center gap-1">
                            <Edit2 size={12}/> Edit
                        </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RECENT TRANSACTIONS COLUMN */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-xl text-[var(--text-primary)] flex items-center gap-2"><Activity size={20}/> Recent Ledger</h3>
          </div>

          <div className="app-card rounded-3xl shadow-sm border border-[var(--border)] overflow-hidden">
            {recentTransactions.length > 0 ? (
              <div className="divide-y divide-[var(--border)]">
                {recentTransactions.map(txn => (
                    <div key={txn.id} className="p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-4 hover:bg-[var(--surface-hover)] transition-colors cursor-pointer" onClick={() => router.push(`/ledger`)}>
                        <div className="flex items-center gap-4 w-full md:w-1/2">
                            {getTxnIcon(txn.type)}
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <h4 className="font-bold text-[var(--text-primary)] text-lg truncate">{txn.payee || txn.type}</h4>
                                </div>
                                <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5 mt-0.5">
                                    <span className="font-bold flex items-center gap-1 text-[var(--text-muted)]"><Calendar size={10}/> {format(new Date(txn.date), 'MMM d, yyyy')}</span>
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-col md:flex-row md:items-center justify-between w-full md:w-1/2 gap-4 md:gap-0 pl-16 md:pl-0">
                            <div className="flex items-center gap-2 md:gap-4 flex-wrap">
                                <span className="text-[10px] font-bold bg-[var(--surface-subtle)] text-[var(--text-muted)] px-2 py-1 rounded-lg flex items-center gap-1 border border-[var(--border)] truncate max-w-[120px]">
                                    <Wallet size={12} className="shrink-0"/> {txn.accounts?.name}
                                </span>
                            </div>
                            
                            <div className="flex items-center justify-between md:justify-end w-full md:w-auto gap-4">
                                {txn.notes && <span title={txn.notes}><FileText size={16} className="text-[var(--text-muted)]"/></span>}
                                <div className={`font-black text-xl tracking-tight ${txn.type === 'Income' ? 'text-emerald-500' : txn.type === 'Expense' ? 'text-red-500' : 'text-blue-500'}`}>
                                    {txn.type === 'Expense' ? '-' : txn.type === 'Income' ? '+' : ''}${formatMoney(txn.amount)}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-20">
                <div className="w-16 h-16 bg-[var(--surface-subtle)] text-[var(--text-muted)] rounded-full flex items-center justify-center mx-auto mb-4"><Banknote size={32}/></div>
                <h4 className="font-bold text-[var(--text-primary)]">No transactions yet</h4>
                <p className="text-sm text-[var(--text-muted)] mt-1">Once you build your budget, your ledger will appear here.</p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* --- DASHBOARD QUICK ENTRY MODAL --- */}
      {isQuickEntryOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={saveQuickEntry} className="app-modal w-full max-w-lg rounded-3xl p-6 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto hide-scrollbar">
            <div className="flex justify-between items-center mb-6 sticky top-0 bg-[var(--surface-elevated)] z-10 pb-2 border-b border-[var(--border)]">
              <h3 className="font-bold text-xl flex items-center gap-2">
                <Zap size={20} className="text-emerald-500"/> Quick Entry
              </h3>
              <button type="button" onClick={() => setIsQuickEntryOpen(false)} className="p-2 text-[var(--text-muted)] hover:text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] rounded-full transition-colors"><X size={18}/></button>
            </div>

            <div className="space-y-5">
              <div className="flex app-segment-track p-1 rounded-xl">
                  <button type="button" onClick={() => setQuickForm({...quickForm, type: 'Expense'})} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${quickForm.type === 'Expense' ? 'app-segment-active shadow-sm' : 'text-[var(--text-muted)]'}`}>Expense</button>
                  <button type="button" onClick={() => setQuickForm({...quickForm, type: 'Income'})} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${quickForm.type === 'Income' ? 'app-segment-active shadow-sm text-emerald-500' : 'text-[var(--text-muted)]'}`}>Income</button>
                  <button type="button" onClick={() => setQuickForm({...quickForm, type: 'Transfer'})} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${quickForm.type === 'Transfer' ? 'app-segment-active shadow-sm text-blue-500' : 'text-[var(--text-muted)]'}`}>Transfer</button>
              </div>

              <div className="flex gap-4">
                  <div className="w-2/3">
                      <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Amount</label>
                      <div className="relative">
                          <span className={`absolute left-4 top-3.5 font-bold ${quickForm.type === 'Income' ? 'text-emerald-500' : 'text-[var(--text-muted)]'}`}>$</span>
                          <input required autoFocus type="number" step="0.01" placeholder="0.00" className="w-full pl-8 p-3 app-input rounded-xl font-black text-2xl text-[var(--text-primary)] placeholder-[var(--text-muted)] border border-[var(--border)] outline-none focus:border-blue-300 focus:bg-[var(--surface-elevated)] transition-all" value={quickForm.amount} onChange={e => setQuickForm({...quickForm, amount: e.target.value})} />
                      </div>
                  </div>
                  <div className="w-1/3">
                      <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Date</label>
                      <input required type="date" className="w-full p-3 app-input rounded-xl font-bold text-sm text-[var(--text-primary)] border border-[var(--border)] outline-none focus:border-blue-300 focus:bg-[var(--surface-elevated)] transition-all" value={quickForm.date} onChange={e => setQuickForm({...quickForm, date: e.target.value})} />
                  </div>
              </div>

              {quickForm.type !== 'Transfer' && (
                  <div>
                      <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">{quickForm.type === 'Income' ? 'Source / Payer' : 'Payee / Vendor'}</label>
                      <input 
                          required 
                          list="payee-list"
                          placeholder="e.g. Walmart, Chase, Salary" 
                          className="w-full p-3 app-input rounded-xl font-bold text-[var(--text-primary)] placeholder-[var(--text-muted)] border border-[var(--border)] outline-none focus:border-blue-300 focus:bg-[var(--surface-elevated)] transition-all" 
                          value={quickForm.payee} 
                          onChange={e => handlePayeeChange(e.target.value)} 
                      />
                      <datalist id="payee-list">
                          {payeeSuggestions.map((p, i) => <option key={i} value={p} />)}
                      </datalist>
                  </div>
              )}

              <div className="flex gap-4 app-card-subtle p-4 rounded-2xl border border-[var(--border)]">
                  <div className={quickForm.type === 'Transfer' ? 'w-1/2' : 'w-full'}>
                      <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">{quickForm.type === 'Income' ? 'Deposit Into' : 'Pay From Account'}</label>
                      <select required className="w-full p-3 app-card rounded-xl font-bold text-sm text-[var(--text-primary)] border border-[var(--border)] outline-none focus:border-blue-300 cursor-pointer" value={quickForm.account_id} onChange={e => setQuickForm({...quickForm, account_id: e.target.value})}>
                          {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({snapMoney(a.balance) < 0 ? '-' : ''}${formatMoney(Math.abs(a.balance))})</option>)}
                      </select>
                  </div>
                  
                  {quickForm.type === 'Transfer' && (
                      <div className="w-1/2">
                          <label className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-2 block">Transfer To</label>
                          <select required className="w-full p-3 app-card rounded-xl font-bold text-sm text-blue-900 border border-blue-500/30 outline-none focus:border-blue-400 cursor-pointer" value={quickForm.to_account_id} onChange={e => setQuickForm({...quickForm, to_account_id: e.target.value})}>
                              <option value="" disabled>Select Destination...</option>
                              {accounts.filter(a => a.id.toString() !== quickForm.account_id).map(a => <option key={a.id} value={a.id}>{a.name} ({snapMoney(a.balance) < 0 ? '-' : ''}${formatMoney(Math.abs(a.balance))})</option>)}
                          </select>
                      </div>
                  )}
              </div>

              {quickForm.type !== 'Transfer' && (
                  <>
                    <label className="flex items-center gap-3 cursor-pointer app-card-subtle p-3 rounded-xl border border-[var(--border)]">
                      <input
                        type="checkbox"
                        checked={isSplitMode}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setIsSplitMode(on);
                          if (on) {
                            setSmartBillPay({ showToggle: false, advanceCycle: true, deductDebt: true, category: null });
                            const lines =
                              quickForm.category_id && quickForm.amount
                                ? [
                                    { category_id: quickForm.category_id, amount: quickForm.amount },
                                    emptySplitLine(),
                                  ]
                                : [emptySplitLine(), emptySplitLine()];
                            setSplitLines(lines);
                          }
                        }}
                        className="w-4 h-4 rounded"
                      />
                      <span className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Split size={16} className="text-violet-500" />
                        Split across categories
                      </span>
                    </label>

                    {isSplitMode ? (
                      <SplitTransactionFields
                        totalAmount={quickForm.amount}
                        lines={splitLines}
                        onChange={setSplitLines}
                        categories={categories}
                        txnType={quickForm.type as 'Expense' | 'Income'}
                      />
                    ) : (
                      <div>
                        <SearchableDropdown
                          label="Budget Envelope"
                          icon={<Tag size={14}/>}
                          options={[
                            { id: '', name: quickForm.type === 'Income' ? 'Ready to Assign (Uncategorized)' : 'Uncategorized Expense' },
                            ...categories.map(c => ({ id: c.id, name: c.name, emoji: c.emoji, group: 'Envelopes' }))
                          ]}
                          value={quickForm.category_id}
                          onChange={(val) => {
                            setQuickForm({...quickForm, category_id: val});
                            checkSmartBillPay(val);
                          }}
                        />
                      </div>
                    )}
                  </>
              )}

              {/* Feature 6: Smart Bill Pay UI */}
              {!isSplitMode && smartBillPay.showToggle && (
                  <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl space-y-3 animate-in slide-in-from-top-2">
                      <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs uppercase tracking-widest">
                          <Zap size={14}/> Smart Bill Pay
                      </div>
                      <div className="space-y-2">
                          {categorySupportsAdvanceDueDate(smartBillPay.category) && (
                              <label className="flex items-center gap-3 cursor-pointer group">
                                  <div className="relative">
                                      <input type="checkbox" className="sr-only peer" checked={smartBillPay.advanceCycle} onChange={e => setSmartBillPay({...smartBillPay, advanceCycle: e.target.checked})} />
                                      <div className="w-10 h-6 bg-[var(--border)] rounded-full peer peer-checked:bg-emerald-500 transition-colors"></div>
                                      <div className="absolute left-1 top-1 w-4 h-4 app-card rounded-full transition-transform peer-checked:translate-x-4"></div>
                                  </div>
                                  <span className="text-xs font-bold text-[var(--text-primary)] group-hover:text-emerald-600 transition-colors">Advance Due Date to next cycle</span>
                              </label>
                          )}
                          {smartBillPay.category?.is_debt && (
                              <label className="flex items-center gap-3 cursor-pointer group">
                                  <div className="relative">
                                      <input type="checkbox" className="sr-only peer" checked={smartBillPay.deductDebt} onChange={e => setSmartBillPay({...smartBillPay, deductDebt: e.target.checked})} />
                                      <div className="w-10 h-6 bg-[var(--border)] rounded-full peer peer-checked:bg-emerald-500 transition-colors"></div>
                                      <div className="absolute left-1 top-1 w-4 h-4 app-card rounded-full transition-transform peer-checked:translate-x-4"></div>
                                  </div>
                                  <span className="text-xs font-bold text-[var(--text-primary)] group-hover:text-emerald-600 transition-colors">Deduct target amount from debt balance</span>
                              </label>
                          )}
                      </div>
                  </div>
              )}

              <div>
                  <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-2"><AlignLeft size={14}/> Notes (Optional)</label>
                  <textarea placeholder="Write a note..." className="w-full p-3 app-input rounded-xl font-bold text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] border border-[var(--border)] outline-none focus:border-blue-300 focus:bg-[var(--surface-elevated)] transition-all resize-none" rows={2} value={quickForm.notes} onChange={e => setQuickForm({...quickForm, notes: e.target.value})} />
              </div>
            </div>

            <button type="submit" disabled={isSubmittingTxn} className={`w-full text-white py-4 rounded-xl font-bold mt-8 shadow-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 bg-emerald-500 hover:bg-emerald-600 shadow-emerald-200`}>
              {isSubmittingTxn ? <Loader2 className="animate-spin" size={20}/> : <Save size={20}/>} {isSubmittingTxn ? 'Saving...' : 'Log Transaction'}
            </button>
          </form>
        </div>
      )}

      {/* MODAL: ADD/EDIT ACCOUNT */}
      {isAccountModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={saveAccount} className="app-modal w-full max-w-sm rounded-3xl p-6 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-xl flex items-center gap-2"><Landmark size={20}/> {editingAccountId ? 'Edit Account' : 'New Account'}</h3>
              <div className="flex gap-2">
                 {editingAccountId && <button type="button" onClick={deleteAccount} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-500/100/10 rounded-full transition-colors"><Trash2 size={18}/></button>}
                 <button type="button" onClick={() => setIsAccountModalOpen(false)} className="p-2 text-[var(--text-muted)] hover:text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] rounded-full transition-colors"><X size={18}/></button>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Account Name</label>
                <input required autoFocus placeholder="e.g. Primary Checking" className="w-full p-3 app-input rounded-xl font-bold border border-[var(--border)] text-[var(--text-primary)] outline-none focus:border-emerald-300 focus:bg-[var(--surface-elevated)]" value={accountForm.name} onChange={e => setAccountForm({...accountForm, name: e.target.value})} />
              </div>
              <div>
                <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Account Type</label>
                <select className="w-full p-3 app-input rounded-xl font-bold border border-[var(--border)] text-[var(--text-primary)] outline-none focus:border-emerald-300 cursor-pointer" value={accountForm.type} onChange={e => setAccountForm({...accountForm, type: e.target.value})}>
                  <option value="Checking">Checking</option>
                  <option value="Savings">Savings</option>
                  <option value="Credit Card">Credit Card</option>
                  <option value="Cash">Physical Cash</option>
                </select>
              </div>
              {accountForm.type === 'Credit Card' && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                    <div>
                    <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Total Credit Limit</label>
                    <div className="relative">
                      <span className="absolute left-4 top-3.5 font-bold text-[var(--text-muted)]">$</span>
                      <input type="number" step="0.01" placeholder="0.00" className="w-full pl-8 p-3 app-input rounded-xl font-black text-lg border text-[var(--text-primary)] border-[var(--border)] outline-none focus:border-emerald-300" value={accountForm.credit_limit} onChange={e => setAccountForm({...accountForm, credit_limit: e.target.value})} />
                    </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Minimum payment</label>
                      <div className="relative">
                        <span className="absolute left-4 top-3.5 font-bold text-[var(--text-muted)]">$</span>
                        <input type="number" step="0.01" min="0" placeholder="0.00" className="w-full pl-8 p-3 app-input rounded-xl font-black text-lg border text-[var(--text-primary)] border-[var(--border)] outline-none focus:border-emerald-300" value={accountForm.minimum_payment} onChange={e => setAccountForm({...accountForm, minimum_payment: e.target.value})} />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Payment due day (1–31)</label>
                      <input type="number" min={1} max={31} placeholder="e.g. 15" className="w-full p-3 app-input rounded-xl font-bold border border-[var(--border)] text-[var(--text-primary)] outline-none focus:border-emerald-300" value={accountForm.payment_due_day} onChange={e => setAccountForm({...accountForm, payment_due_day: e.target.value})} />
                      <p className="text-[10px] text-[var(--text-muted)] font-medium mt-1">
                        Calendar shows the next due date; mark paid to advance the cycle.
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">
                        Budget envelope (optional)
                      </label>
                      <select
                        className="w-full p-3 app-input rounded-xl font-bold border border-[var(--border)] text-[var(--text-primary)] outline-none focus:border-emerald-300 cursor-pointer"
                        value={accountForm.payment_category_id}
                        onChange={(e) =>
                          setAccountForm({
                            ...accountForm,
                            payment_category_id: e.target.value,
                          })
                        }
                      >
                        <option value="">None — calendar only</option>
                        {categories
                          .filter((c) => !c.is_hidden)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.emoji ? `${c.emoji} ` : ''}
                              {c.name}
                            </option>
                          ))}
                      </select>
                      <p className="text-[10px] text-[var(--text-muted)] font-medium mt-1">
                        Fund this category in Budget; calendar turns gold when assigned ≥
                        minimum.
                      </p>
                    </div>
                  </div>
              )}
              <div>
                <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Current Balance</label>
                <div className="relative">
                  <span className="absolute left-4 top-3.5 font-bold text-[var(--text-muted)]">$</span>
                  <input required type="number" step="0.01" placeholder="0.00" className="w-full pl-8 p-3 app-input rounded-xl font-black text-lg border text-[var(--text-primary)] border-[var(--border)] outline-none focus:border-emerald-300" value={accountForm.balance} onChange={e => setAccountForm({...accountForm, balance: e.target.value})} />
                </div>
                {accountForm.type === 'Credit Card' && <p className="text-[10px] text-orange-500 font-bold mt-2 flex items-center gap-1"><AlertCircle size={10} className="shrink-0"/> Enter balance as a positive number.</p>}
              </div>

              {/* MANUAL ADJUSTMENT OPTIONS */}
              {editingAccountId && (
                  <div className="pt-4 border-t border-[var(--border)] space-y-2 animate-in fade-in">
                      <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">If Balance Changed:</label>
                      <label className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] cursor-pointer hover:bg-[var(--surface-hover)] transition-colors">
                          <input type="radio" name="adj" checked={adjustmentType === 'transaction'} onChange={() => setAdjustmentType('transaction')} className="w-4 h-4 text-emerald-500" />
                          <div className="flex flex-col">
                              <span className="text-sm font-bold text-[var(--text-primary)]">Log Manual Adjustment</span>
                              <span className="text-[10px] text-[var(--text-muted)] font-medium">Calculates difference and adds to ledger.</span>
                          </div>
                      </label>
                      <label className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] cursor-pointer hover:bg-[var(--surface-hover)] transition-colors">
                          <input type="radio" name="adj" checked={adjustmentType === 'silent'} onChange={() => setAdjustmentType('silent')} className="w-4 h-4 text-emerald-500" />
                          <div className="flex flex-col">
                              <span className="text-sm font-bold text-[var(--text-primary)]">Silent Update</span>
                              <span className="text-[10px] text-[var(--text-muted)] font-medium">Changes balance without affecting ledger.</span>
                          </div>
                      </label>
                  </div>
              )}
            </div>

            <button type="submit" className="w-full gradient-positive text-white py-4 rounded-xl font-bold mt-8 shadow-lg hover:brightness-105 transition-colors">
              {editingAccountId ? 'Save Changes' : 'Add Account'}
            </button>
          </form>
        </div>
      )}

      <ProjectedIncomeFormModal
        open={isProjectedFormOpen}
        onOpenChange={setIsProjectedFormOpen}
        editing={editingProjected}
        accounts={accounts}
        categories={categories}
        onSaved={refreshProjectedIncome}
      />
      <ProjectedIncomeReceiveModal
        open={!!receiveProjected}
        onOpenChange={(open) => !open && setReceiveProjected(null)}
        projection={receiveProjected}
        onReceived={refreshProjectedIncome}
      />
      <ProjectedIncomeListModal
        open={isProjectedListOpen}
        onOpenChange={setIsProjectedListOpen}
        items={allProjected}
        onEdit={openEditProjected}
        onReceive={(item) => {
          setReceiveProjected(item);
          setIsProjectedListOpen(false);
        }}
        onCancel={handleCancelProjected}
      />
      <ExportModal
        open={isExportOpen}
        onOpenChange={setIsExportOpen}
        initialPreset="full"
      />

      <Fab
        onClick={() => {
          const first = accounts.find((a) => ['Checking', 'Savings', 'Cash'].includes(a.type)) || accounts[0];
          if (first) openQuickEntry(first.id);
        }}
        visible={accounts.length > 0}
      />
    </>
  );
}
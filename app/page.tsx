'use client';
import { useEffect, useState } from 'react';
import { supabase } from './utils/supabase';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  Wallet, Landmark, CreditCard, Banknote, Plus, 
  ArrowUpRight, ArrowDownRight, ArrowRightLeft, Activity, X, 
  AlertCircle, Trash2, LayoutGrid, PieChart, ListOrdered, 
  Calendar, FileText, Download, Zap, Edit2, Tag, AlignLeft, Save, Loader2
} from 'lucide-react';
import { format } from 'date-fns';

export default function Dashboard() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [payeeSuggestions, setPayeeSuggestions] = useState<string[]>([]);
  const [monthlyStats, setMonthlyStats] = useState({ income: 0, expense: 0 });
  const [totalAssigned, setTotalAssigned] = useState(0);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  
  const [isQuickEntryOpen, setIsQuickEntryOpen] = useState(false);
  const [isSubmittingTxn, setIsSubmittingTxn] = useState(false);

  // Forms
  const [accountForm, setAccountForm] = useState({
    name: '', type: 'Checking', balance: '', credit_limit: ''
  });
  const [adjustmentType, setAdjustmentType] = useState('transaction');

  const [quickForm, setQuickForm] = useState({
    type: 'Expense', date: format(new Date(), 'yyyy-MM-dd'), amount: '', 
    payee: '', category_id: '', account_id: '', to_account_id: '', notes: ''
  });

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
        setTotalAssigned(cats.filter(c => !c.is_hidden).reduce((sum, c) => sum + Number(c.assigned_amount || 0), 0));
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
            if (t.type === 'Income') inc += Number(t.amount);
            if (t.type === 'Expense') exp += Number(t.amount);
        });
    }
    setMonthlyStats({ income: inc, expense: exp });

    setLoading(false);
  }

  // --- ACCOUNT CRUD LOGIC ---
  function openAccountModal(acc: any = null) {
    if (acc) {
      setEditingAccountId(acc.id);
      setAccountForm({
        name: acc.name, type: acc.type, balance: acc.balance.toString(),
        credit_limit: acc.credit_limit ? acc.credit_limit.toString() : ''
      });
    } else {
      setEditingAccountId(null);
      setAccountForm({ name: '', type: 'Checking', balance: '', credit_limit: '' });
    }
    setAdjustmentType('transaction');
    setIsAccountModalOpen(true);
  }

  async function saveAccount(e: React.FormEvent) {
    e.preventDefault();
    const newBalance = parseFloat(accountForm.balance) || 0;
    const oldAcc = accounts.find(a => a.id === editingAccountId);
    const oldBalance = oldAcc ? Number(oldAcc.balance) : 0;
    
    const payload = {
      name: accountForm.name, type: accountForm.type,
      balance: newBalance,
      credit_limit: parseFloat(accountForm.credit_limit) || 0
    };

    if (editingAccountId && adjustmentType === 'transaction' && oldBalance !== newBalance) {
        const diff = newBalance - oldBalance;
        const isCC = accountForm.type === 'Credit Card';
        
        let txnType = 'Expense';
        if (isCC) txnType = diff > 0 ? 'Expense' : 'Income'; 
        else txnType = diff > 0 ? 'Income' : 'Expense';      
        
        const txnPayload = {
            date: format(new Date(), 'yyyy-MM-dd'),
            amount: Math.abs(diff),
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
  function openQuickEntry(accId: number) {
      setQuickForm({
        type: 'Expense', date: format(new Date(), 'yyyy-MM-dd'), amount: '', 
        payee: '', category_id: '', account_id: accId.toString(), to_account_id: '', notes: ''
      });
      setIsQuickEntryOpen(true);
  }

  const handleBalanceAdjustment = async (txn: any) => {
      const amount = Number(txn.amount);
      const sourceAcc = accounts.find(a => a.id === txn.account_id);
      const destAcc = txn.to_account_id ? accounts.find(a => a.id === txn.to_account_id) : null;
      const cat = txn.category_id ? categories.find(c => c.id === txn.category_id) : null;
  
      const getAdj = (isStepInflow: boolean) => isStepInflow ? amount : -amount;
  
      if (sourceAcc) {
          const isCC = sourceAcc.type === 'Credit Card';
          const isInflow = txn.type === 'Income';
          const adjustment = isCC ? (isInflow ? -getAdj(true) : -getAdj(false)) : (isInflow ? getAdj(true) : getAdj(false));
          await supabase.from('accounts').update({ balance: Number(sourceAcc.balance) + adjustment }).eq('id', sourceAcc.id);
      }
  
      if (destAcc) {
          const isCC = destAcc.type === 'Credit Card';
          const adjustment = isCC ? -getAdj(true) : getAdj(true);
          await supabase.from('accounts').update({ balance: Number(destAcc.balance) + adjustment }).eq('id', destAcc.id);
      }
  
      if (cat) {
          const adjustment = txn.type === 'Income' ? getAdj(true) : getAdj(false);
          await supabase.from('categories').update({ assigned_amount: Number(cat.assigned_amount || 0) + adjustment }).eq('id', cat.id);
      }
  };

  async function saveQuickEntry(e: React.FormEvent) {
      e.preventDefault();
      setIsSubmittingTxn(true);

      const amount = parseFloat(quickForm.amount) || 0;
      const payload = {
          date: quickForm.date,
          amount: amount,
          payee: quickForm.type === 'Transfer' ? 'Transfer' : quickForm.payee,
          category_id: quickForm.type === 'Transfer' ? null : (quickForm.category_id ? parseInt(quickForm.category_id) : null),
          account_id: parseInt(quickForm.account_id),
          to_account_id: quickForm.type === 'Transfer' ? parseInt(quickForm.to_account_id) : null,
          type: quickForm.type,
          notes: quickForm.notes || null
      };

      const { data: inserted } = await supabase.from('transactions').insert([payload]).select().single();
      if (inserted) {
          await handleBalanceAdjustment(payload);
          setIsQuickEntryOpen(false);
          await fetchDashboardData(); 
      }
      setIsSubmittingTxn(false);
  }

  function exportAccounts() {
      let text = `FINANCE OS - NET WORTH REPORT\nDate: ${format(new Date(), 'MMM d, yyyy')}\n\n`;
      text += `Total Net Worth: $${netWorth.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`;
      text += `Liquid Cash: $${liquidCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n\n`;
      text += `--- ACCOUNTS ---\n`;
      accounts.forEach(a => {
          text += `${a.name} (${a.type}): $${Math.abs(a.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`;
      });

      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `FinanceOS_Export_${format(new Date(), 'yyyy-MM-dd')}.txt`;
      a.click();
  }

  const netWorth = accounts.reduce((sum, acc) => acc.type === 'Credit Card' ? sum - Math.abs(acc.balance) : sum + acc.balance, 0);
  const liquidCash = accounts.filter(a => ['Checking', 'Savings', 'Cash'].includes(a.type)).reduce((sum, acc) => sum + acc.balance, 0);
  const readyToAssign = liquidCash - totalAssigned;

  const getAccountIcon = (type: string) => {
    switch(type) {
      case 'Checking': return <Landmark className="text-blue-500" size={24} />;
      case 'Savings': return <Wallet className="text-emerald-500" size={24} />;
      case 'Credit Card': return <CreditCard className="text-red-500" size={24} />;
      case 'Cash': return <Banknote className="text-green-600" size={24} />;
      default: return <Landmark className="text-slate-400" size={24} />;
    }
  };

  const getTxnIcon = (type: string) => {
    switch(type) {
      case 'Income': return <div className="p-3 bg-emerald-100 rounded-2xl text-emerald-600 shadow-sm"><ArrowUpRight size={20}/></div>;
      case 'Expense': return <div className="p-3 bg-slate-100 rounded-2xl text-slate-600 shadow-sm"><ArrowDownRight size={20}/></div>;
      case 'Transfer': return <div className="p-3 bg-blue-100 rounded-2xl text-blue-600 shadow-sm"><ArrowRightLeft size={20}/></div>;
      default: return <div className="p-3 bg-slate-100 rounded-2xl text-slate-600 shadow-sm"><Activity size={20}/></div>;
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400 font-bold animate-pulse">Booting Finance OS...</div>;

  return (
    <main className="pb-32">
      
      {/* HEADER & NET WORTH */}
      <div className="mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
            <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Finance<span className="text-emerald-500">OS</span></h1>
            <button onClick={exportAccounts} className="w-full md:w-auto bg-white px-4 py-2 rounded-xl text-slate-600 font-bold border border-slate-200 shadow-sm flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors">
                <Download size={16}/> Export Report
            </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          <div className="col-span-1 md:col-span-2 bg-slate-900 text-white rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 translate-x-20 -translate-y-20"></div>
            <p className="text-slate-400 font-bold text-sm uppercase tracking-widest mb-2">Total Net Worth</p>
            <h2 className="text-5xl md:text-7xl font-black tracking-tighter mb-4">
              ${netWorth.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h2>
            <div className="flex flex-wrap items-center gap-4 text-sm font-medium">
              <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-lg backdrop-blur-md border border-white/5">
                 <Wallet size={16} className="text-emerald-400"/>
                 <span>Liquid Cash: ${liquidCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-lg backdrop-blur-md border border-white/5">
                 <Activity size={16} className="text-blue-400"/>
                 <span>This Month: <span className="text-emerald-400">+${monthlyStats.income.toLocaleString()}</span> / <span className="text-red-400">-${monthlyStats.expense.toLocaleString()}</span></span>
              </div>
            </div>
          </div>

          <div className={`text-white rounded-3xl p-6 shadow-lg flex flex-col justify-center items-center text-center relative overflow-hidden transition-colors ${readyToAssign < 0 ? 'bg-red-500' : 'bg-emerald-500'}`}>
            <div className={`absolute top-0 left-0 w-32 h-32 rounded-full filter blur-2xl opacity-50 -translate-x-10 -translate-y-10 ${readyToAssign < 0 ? 'bg-red-400' : 'bg-emerald-400'}`}></div>
            <h3 className="font-bold text-white/90 uppercase tracking-widest text-xs mb-2 z-10">Ready to Assign</h3>
            <div className="font-black text-4xl tracking-tighter z-10">
               ${readyToAssign.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
            {readyToAssign < 0 && <p className="text-xs bg-red-700/50 text-white px-2 py-1 rounded mt-3 font-bold z-10 flex items-center gap-1 border border-red-400"><AlertCircle size={12}/> Overbudgeted</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* ACCOUNTS COLUMN */}
        <div className="lg:col-span-1 space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-xl text-slate-900 flex items-center gap-2"><Landmark size={20}/> Accounts</h3>
            <button onClick={() => openAccountModal()} className="p-2 bg-slate-200 hover:bg-emerald-100 hover:text-emerald-600 text-slate-500 rounded-full transition-colors"><Plus size={16} /></button>
          </div>

          <div className="space-y-3">
            {accounts.map(acc => (
              <div key={acc.id} className="bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col hover:border-emerald-200 transition-all group overflow-hidden">
                <div className="p-4 flex items-center gap-4 cursor-pointer" onClick={() => router.push(`/ledger?account=${acc.id}`)}>
                    <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center shrink-0 border border-slate-100">{getAccountIcon(acc.type)}</div>
                    <div className="flex-grow min-w-0">
                    <h4 className="font-bold text-slate-800 truncate">{acc.name}</h4>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">{acc.type}</p>
                    {acc.type === 'Credit Card' && acc.credit_limit > 0 && <div className="text-xs font-bold text-emerald-600">Avail: ${(acc.credit_limit - Math.abs(acc.balance)).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>}
                    </div>
                    <div className={`font-black text-lg ${acc.type === 'Credit Card' ? 'text-red-500' : 'text-slate-900'}`}>
                    ${Math.abs(acc.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                </div>
                <div className="flex border-t border-slate-50 bg-slate-50/50">
                    <button onClick={() => openQuickEntry(acc.id)} className="flex-1 py-2.5 text-xs font-bold text-slate-500 hover:bg-emerald-50 hover:text-emerald-600 border-r border-slate-100 transition-colors flex items-center justify-center gap-1">
                        <Zap size={12}/> Quick Entry
                    </button>
                    <button onClick={() => openAccountModal(acc)} className="flex-1 py-2.5 text-xs font-bold text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition-colors flex items-center justify-center gap-1">
                        <Edit2 size={12}/> Edit
                    </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RECENT TRANSACTIONS COLUMN */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-xl text-slate-900 flex items-center gap-2"><Activity size={20}/> Recent Ledger</h3>
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
            {recentTransactions.length > 0 ? (
              <div className="divide-y divide-slate-50">
                {recentTransactions.map(txn => (
                    <div key={txn.id} className="p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-4 hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => router.push(`/ledger`)}>
                        <div className="flex items-center gap-4 w-full md:w-1/2">
                            {getTxnIcon(txn.type)}
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <h4 className="font-bold text-slate-800 text-lg truncate">{txn.payee || txn.type}</h4>
                                </div>
                                <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                                    <span className="font-bold flex items-center gap-1 text-slate-400"><Calendar size={10}/> {format(new Date(txn.date), 'MMM d, yyyy')}</span>
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-col md:flex-row md:items-center justify-between w-full md:w-1/2 gap-4 md:gap-0 pl-16 md:pl-0">
                            <div className="flex items-center gap-2 md:gap-4 flex-wrap">
                                <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-lg flex items-center gap-1 border border-slate-200 truncate max-w-[120px]">
                                    <Wallet size={12} className="shrink-0"/> {txn.accounts?.name}
                                </span>
                            </div>
                            
                            <div className="flex items-center justify-between md:justify-end w-full md:w-auto gap-4">
                                {txn.notes && <span title={txn.notes}><FileText size={16} className="text-slate-300"/></span>}
                                <div className={`font-black text-xl tracking-tight ${txn.type === 'Income' ? 'text-emerald-500' : txn.type === 'Expense' ? 'text-slate-900' : 'text-blue-500'}`}>
                                    {txn.type === 'Expense' ? '-' : txn.type === 'Income' ? '+' : ''}${Number(txn.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-20">
                <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4"><Banknote size={32}/></div>
                <h4 className="font-bold text-slate-700">No transactions yet</h4>
                <p className="text-sm text-slate-500 mt-1">Once you build your budget, your ledger will appear here.</p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* --- DASHBOARD QUICK ENTRY MODAL --- */}
      {isQuickEntryOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={saveQuickEntry} className="bg-white w-full max-w-lg rounded-3xl p-6 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto hide-scrollbar">
            <div className="flex justify-between items-center mb-6 sticky top-0 bg-white z-10 pb-2 border-b border-slate-50">
              <h3 className="font-bold text-xl flex items-center gap-2">
                <Zap size={20} className="text-emerald-500"/> Quick Entry
              </h3>
              <button type="button" onClick={() => setIsQuickEntryOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"><X size={18}/></button>
            </div>

            <div className="space-y-5">
              <div className="flex bg-slate-100 p-1 rounded-xl">
                  <button type="button" onClick={() => setQuickForm({...quickForm, type: 'Expense'})} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${quickForm.type === 'Expense' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Expense</button>
                  <button type="button" onClick={() => setQuickForm({...quickForm, type: 'Income'})} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${quickForm.type === 'Income' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-500'}`}>Income</button>
                  <button type="button" onClick={() => setQuickForm({...quickForm, type: 'Transfer'})} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${quickForm.type === 'Transfer' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}>Transfer</button>
              </div>

              <div className="flex gap-4">
                  <div className="w-2/3">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Amount</label>
                      <div className="relative">
                          <span className={`absolute left-4 top-3.5 font-bold ${quickForm.type === 'Income' ? 'text-emerald-500' : 'text-slate-400'}`}>$</span>
                          <input required autoFocus type="number" step="0.01" placeholder="0.00" className="w-full pl-8 p-3 bg-slate-50 rounded-xl font-black text-2xl text-slate-900 placeholder-slate-300 border border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all" value={quickForm.amount} onChange={e => setQuickForm({...quickForm, amount: e.target.value})} />
                      </div>
                  </div>
                  <div className="w-1/3">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Date</label>
                      <input required type="date" className="w-full p-3 bg-slate-50 rounded-xl font-bold text-sm text-slate-900 border border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all" value={quickForm.date} onChange={e => setQuickForm({...quickForm, date: e.target.value})} />
                  </div>
              </div>

              {quickForm.type !== 'Transfer' && (
                  <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">{quickForm.type === 'Income' ? 'Source / Payer' : 'Payee / Vendor'}</label>
                      <input 
                          required 
                          list="payee-list"
                          placeholder="e.g. Walmart, Chase, Salary" 
                          className="w-full p-3 bg-slate-50 rounded-xl font-bold text-slate-900 placeholder-slate-400 border border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all" 
                          value={quickForm.payee} 
                          onChange={e => setQuickForm({...quickForm, payee: e.target.value})} 
                      />
                      <datalist id="payee-list">
                          {payeeSuggestions.map((p, i) => <option key={i} value={p} />)}
                      </datalist>
                  </div>
              )}

              <div className="flex gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <div className={quickForm.type === 'Transfer' ? 'w-1/2' : 'w-full'}>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">{quickForm.type === 'Income' ? 'Deposit Into' : 'Pay From Account'}</label>
                      <select required className="w-full p-3 bg-white rounded-xl font-bold text-sm text-slate-900 border border-slate-200 outline-none focus:border-blue-300 cursor-pointer" value={quickForm.account_id} onChange={e => setQuickForm({...quickForm, account_id: e.target.value})}>
                          {accounts.map(a => <option key={a.id} value={a.id}>{a.name} (${Math.abs(Number(a.balance)).toFixed(2)})</option>)}
                      </select>
                  </div>
                  
                  {quickForm.type === 'Transfer' && (
                      <div className="w-1/2">
                          <label className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-2 block">Transfer To</label>
                          <select required className="w-full p-3 bg-white rounded-xl font-bold text-sm text-blue-900 border border-blue-200 outline-none focus:border-blue-400 cursor-pointer" value={quickForm.to_account_id} onChange={e => setQuickForm({...quickForm, to_account_id: e.target.value})}>
                              <option value="" disabled>Select Destination...</option>
                              {accounts.filter(a => a.id.toString() !== quickForm.account_id).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                      </div>
                  )}
              </div>

              {quickForm.type !== 'Transfer' && (
                  <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2"><Tag size={14}/> Budget Envelope</label>
                      <select className="w-full p-3 bg-slate-50 rounded-xl font-bold text-slate-900 border border-slate-100 outline-none focus:border-blue-300 cursor-pointer" value={quickForm.category_id} onChange={e => setQuickForm({...quickForm, category_id: e.target.value})}>
                          <option value="">{quickForm.type === 'Income' ? 'Ready to Assign (Uncategorized)' : 'Uncategorized Expense'}</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.emoji || ''} {c.name}</option>)}
                      </select>
                  </div>
              )}

              <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2"><AlignLeft size={14}/> Notes (Optional)</label>
                  <textarea placeholder="Write a note..." className="w-full p-3 bg-slate-50 rounded-xl font-bold text-sm text-slate-900 placeholder-slate-400 border border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all resize-none" rows={2} value={quickForm.notes} onChange={e => setQuickForm({...quickForm, notes: e.target.value})} />
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
          <form onSubmit={saveAccount} className="bg-white w-full max-w-sm rounded-3xl p-6 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-xl flex items-center gap-2"><Landmark size={20}/> {editingAccountId ? 'Edit Account' : 'New Account'}</h3>
              <div className="flex gap-2">
                 {editingAccountId && <button type="button" onClick={deleteAccount} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"><Trash2 size={18}/></button>}
                 <button type="button" onClick={() => setIsAccountModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"><X size={18}/></button>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Account Name</label>
                <input required autoFocus placeholder="e.g. Primary Checking" className="w-full p-3 bg-slate-50 rounded-xl font-bold border border-slate-100 text-slate-900 outline-none focus:border-emerald-300 focus:bg-white" value={accountForm.name} onChange={e => setAccountForm({...accountForm, name: e.target.value})} />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Account Type</label>
                <select className="w-full p-3 bg-slate-50 rounded-xl font-bold border border-slate-100 text-slate-900 outline-none focus:border-emerald-300 cursor-pointer" value={accountForm.type} onChange={e => setAccountForm({...accountForm, type: e.target.value})}>
                  <option value="Checking">Checking</option>
                  <option value="Savings">Savings</option>
                  <option value="Credit Card">Credit Card</option>
                  <option value="Cash">Physical Cash</option>
                </select>
              </div>
              {accountForm.type === 'Credit Card' && (
                  <div className="animate-in fade-in slide-in-from-top-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Total Credit Limit</label>
                    <div className="relative">
                      <span className="absolute left-4 top-3.5 font-bold text-slate-400">$</span>
                      <input type="number" step="0.01" placeholder="0.00" className="w-full pl-8 p-3 bg-slate-50 rounded-xl font-black text-lg border text-slate-900 border-slate-100 outline-none focus:border-emerald-300" value={accountForm.credit_limit} onChange={e => setAccountForm({...accountForm, credit_limit: e.target.value})} />
                    </div>
                  </div>
              )}
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Current Balance</label>
                <div className="relative">
                  <span className="absolute left-4 top-3.5 font-bold text-slate-400">$</span>
                  <input required type="number" step="0.01" placeholder="0.00" className="w-full pl-8 p-3 bg-slate-50 rounded-xl font-black text-lg border text-slate-900 border-slate-100 outline-none focus:border-emerald-300" value={accountForm.balance} onChange={e => setAccountForm({...accountForm, balance: e.target.value})} />
                </div>
                {accountForm.type === 'Credit Card' && <p className="text-[10px] text-orange-500 font-bold mt-2 flex items-center gap-1"><AlertCircle size={10} className="shrink-0"/> Enter balance as a positive number.</p>}
              </div>

              {/* MANUAL ADJUSTMENT OPTIONS */}
              {editingAccountId && (
                  <div className="pt-4 border-t border-slate-100 space-y-2 animate-in fade-in">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">If Balance Changed:</label>
                      <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors">
                          <input type="radio" name="adj" checked={adjustmentType === 'transaction'} onChange={() => setAdjustmentType('transaction')} className="w-4 h-4 text-emerald-500" />
                          <div className="flex flex-col">
                              <span className="text-sm font-bold text-slate-800">Log Manual Adjustment</span>
                              <span className="text-[10px] text-slate-500 font-medium">Calculates difference and adds to ledger.</span>
                          </div>
                      </label>
                      <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors">
                          <input type="radio" name="adj" checked={adjustmentType === 'silent'} onChange={() => setAdjustmentType('silent')} className="w-4 h-4 text-emerald-500" />
                          <div className="flex flex-col">
                              <span className="text-sm font-bold text-slate-800">Silent Update</span>
                              <span className="text-[10px] text-slate-500 font-medium">Changes balance without affecting ledger.</span>
                          </div>
                      </label>
                  </div>
              )}
            </div>

            <button type="submit" className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold mt-8 shadow-lg hover:bg-slate-800 transition-colors">
              {editingAccountId ? 'Save Changes' : 'Add Account'}
            </button>
          </form>
        </div>
      )}

    </main>
  );
}
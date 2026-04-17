'use client';
import { useEffect, useState } from 'react';
import { supabase } from './utils/supabase';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  Wallet, Landmark, CreditCard, Banknote, Plus, 
  ArrowUpRight, ArrowDownRight, ArrowRightLeft, Activity, X, 
  AlertCircle, Trash2, LayoutGrid, PieChart, ListOrdered, 
  Calendar, FileText, Smile, Frown, Meh, Download, Zap, Edit2
} from 'lucide-react';
import { format } from 'date-fns';

export default function Dashboard() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [monthlyStats, setMonthlyStats] = useState({ income: 0, expense: 0 });
  const [totalAssigned, setTotalAssigned] = useState(0);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  
  // Forms
  const [accountForm, setAccountForm] = useState({
    name: '', type: 'Checking', balance: '', credit_limit: ''
  });
  const [adjustmentType, setAdjustmentType] = useState('transaction'); // 'transaction' or 'silent'

  useEffect(() => {
    fetchDashboardData();
  }, []);

  async function fetchDashboardData() {
    setLoading(true);
    
    const { data: accs } = await supabase.from('accounts').select('*').order('type').order('name');
    if (accs) setAccounts(accs);

    const { data: cats } = await supabase.from('categories').select('assigned_amount, is_hidden');
    if (cats) setTotalAssigned(cats.filter(c => !c.is_hidden).reduce((sum, c) => sum + Number(c.assigned_amount || 0), 0));

    const { data: txns } = await supabase
      .from('transactions')
      .select('*, categories(name, emoji), accounts!account_id(name, type)')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10);
    if (txns) setRecentTransactions(txns);

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

    // MANUAL ADJUSTMENT LOGIC
    if (editingAccountId && adjustmentType === 'transaction' && oldBalance !== newBalance) {
        const diff = newBalance - oldBalance;
        const isCC = accountForm.type === 'Credit Card';
        
        // Determine if it's an expense or income based on account type
        let txnType = 'Expense';
        if (isCC) txnType = diff > 0 ? 'Expense' : 'Income'; // CC goes up = Expense
        else txnType = diff > 0 ? 'Income' : 'Expense';      // Cash goes up = Income
        
        const txnPayload = {
            date: format(new Date(), 'yyyy-MM-dd'),
            amount: Math.abs(diff),
            payee: 'Manual Balance Adjustment',
            account_id: editingAccountId,
            type: txnType,
            purchase_rating: txnType === 'Expense' ? 'Neutral' : null,
            notes: 'Auto-generated via account edit.'
        };
        await supabase.from('transactions').insert([txnPayload]);
    }

    if (editingAccountId) {
      const { error } = await supabase.from('accounts').update(payload).eq('id', editingAccountId);
      if (!error) setAccounts(accounts.map(a => a.id === editingAccountId ? { ...a, ...payload } : a));
    } else {
      const { data } = await supabase.from('accounts').insert([payload]).select().single();
      if (data) setAccounts([...accounts, data]);
    }
    
    setIsAccountModalOpen(false);
    fetchDashboardData(); // Refresh UI
  }

  async function deleteAccount() {
    if (!editingAccountId) return;
    if (!confirm("Are you sure you want to delete this account? This will break associated transactions.")) return;
    await supabase.from('accounts').delete().eq('id', editingAccountId);
    setAccounts(accounts.filter(a => a.id !== editingAccountId));
    setIsAccountModalOpen(false);
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

  // Math
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

  const getRatingIcon = (rating: string) => {
      if (rating === 'Good') return <span className="flex items-center gap-1 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold uppercase"><Smile size={10}/> Good</span>;
      if (rating === 'Regret') return <span className="flex items-center gap-1 text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold uppercase"><Frown size={10}/> Regret</span>;
      return <span className="flex items-center gap-1 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-bold uppercase"><Meh size={10}/> Neutral</span>;
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400 font-bold animate-pulse">Booting Finance OS...</div>;

  return (
    <main className="p-4 md:p-8 min-h-screen bg-slate-50 pb-32">
      

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
                    <button onClick={() => router.push(`/ledger?account=${acc.id}&new=true`)} className="flex-1 py-2.5 text-xs font-bold text-slate-500 hover:bg-emerald-50 hover:text-emerald-600 border-r border-slate-100 transition-colors flex items-center justify-center gap-1">
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
                                    {txn.type === 'Expense' && getRatingIcon(txn.purchase_rating)}
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
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import Link from 'next/link';
import { 
  ArrowUpRight, ArrowDownRight, ArrowRightLeft, Activity, X, 
  Search, Plus, PieChart, LayoutGrid, ListOrdered, Calendar, Tag, 
  FileText, Smile, Frown, Meh, Trash2, AlignLeft, Save, Loader2, Wallet, Edit2
} from 'lucide-react';
import { format, parseISO } from 'date-fns';

export default function LedgerPage() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [payeeSuggestions, setPayeeSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAccount, setFilterAccount] = useState('All');
  const [filterType, setFilterType] = useState('All');

  // Modal & Edit State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingTxn, setEditingTxn] = useState<any>(null);
  
  // Form
  const [txnForm, setTxnForm] = useState({
    type: 'Expense',
    date: format(new Date(), 'yyyy-MM-dd'),
    amount: '',
    payee: '',
    category_id: '',
    account_id: '',
    to_account_id: '',
    purchase_rating: 'Neutral',
    notes: ''
  });

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    const { data: accs } = await supabase.from('accounts').select('*').order('name');
    const { data: cats } = await supabase.from('categories').select('id, name, group_id, emoji, assigned_amount').order('name');
    
    if (accs) setAccounts(accs);
    if (cats) setCategories(cats);

    if (accs && accs.length > 0 && !txnForm.account_id) {
        setTxnForm(prev => ({ ...prev, account_id: accs[0].id.toString() }));
    }

    const { data: txns } = await supabase
      .from('transactions')
      .select('*, categories(name, emoji), accounts!account_id(name, type)')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });
      
    if (txns) {
        setTransactions(txns);
        const unique = Array.from(new Set(txns.map(t => t.payee).filter(Boolean)));
        setPayeeSuggestions(unique as string[]);
    }
    setLoading(false);
  }

  // --- THE MASTER BRAIN: BALANCE ADJUSTMENT ---
  // mode: 'apply' (adds txn impact) or 'reverse' (undoes txn impact)
  const handleBalanceAdjustment = async (txn: any, mode: 'apply' | 'reverse') => {
    const amount = Number(txn.amount);
    const sourceAcc = accounts.find(a => a.id === txn.account_id);
    const destAcc = txn.to_account_id ? accounts.find(a => a.id === txn.to_account_id) : null;
    const cat = txn.category_id ? categories.find(c => c.id === txn.category_id) : null;

    const getAdj = (isStepInflow: boolean) => {
        if (mode === 'reverse') return isStepInflow ? -amount : amount;
        return isStepInflow ? amount : -amount;
    };

    // 1. Source Account Math
    if (sourceAcc) {
        const isCC = sourceAcc.type === 'Credit Card';
        const isInflow = txn.type === 'Income';
        // For CC: Inflow decreases balance. For Cash: Inflow increases balance.
        const adjustment = isCC ? (isInflow ? -getAdj(true) : -getAdj(false)) : (isInflow ? getAdj(true) : getAdj(false));
        await supabase.from('accounts').update({ balance: Number(sourceAcc.balance) + adjustment }).eq('id', sourceAcc.id);
    }

    // 2. Destination Account Math (Transfers)
    if (destAcc) {
        const isCC = destAcc.type === 'Credit Card';
        const adjustment = isCC ? -getAdj(true) : getAdj(true);
        await supabase.from('accounts').update({ balance: Number(destAcc.balance) + adjustment }).eq('id', destAcc.id);
    }

    // 3. Category Envelope Math
    if (cat) {
        const adjustment = txn.type === 'Income' ? getAdj(true) : getAdj(false);
        await supabase.from('categories').update({ assigned_amount: Number(cat.assigned_amount || 0) + adjustment }).eq('id', cat.id);
    }
  };

  async function saveTransaction(e: React.FormEvent) {
      e.preventDefault();
      setIsSubmitting(true);

      const amount = parseFloat(txnForm.amount) || 0;
      const payload = {
          date: txnForm.date,
          amount: amount,
          payee: txnForm.type === 'Transfer' ? 'Transfer' : txnForm.payee,
          category_id: txnForm.type === 'Transfer' ? null : (txnForm.category_id ? parseInt(txnForm.category_id) : null),
          account_id: parseInt(txnForm.account_id),
          to_account_id: txnForm.type === 'Transfer' ? parseInt(txnForm.to_account_id) : null,
          type: txnForm.type,
          purchase_rating: txnForm.type === 'Expense' ? txnForm.purchase_rating : null,
          notes: txnForm.notes || null
      };

      if (editingTxn) {
          // REVERSE OLD MATH FIRST
          await handleBalanceAdjustment(editingTxn, 'reverse');
          const { data: updated, error } = await supabase.from('transactions').update(payload).eq('id', editingTxn.id).select('*, categories(name, emoji), accounts!account_id(name, type)').single();
          if (updated) {
              await handleBalanceAdjustment(updated, 'apply');
              setTransactions(transactions.map(t => t.id === updated.id ? updated : t));
          }
      } else {
          const { data: inserted, error } = await supabase.from('transactions').insert([payload]).select('*, categories(name, emoji), accounts!account_id(name, type)').single();
          if (inserted) {
              await handleBalanceAdjustment(inserted, 'apply');
              setTransactions([inserted, ...transactions]);
          }
      }

      closeModal();
      await fetchData(); // Refresh local state to ensure balances match DB
      setIsSubmitting(false);
  }

  async function deleteTransaction(txn: any) {
      if (!confirm("Permanently delete and reverse all math for this transaction?")) return;
      await handleBalanceAdjustment(txn, 'reverse');
      await supabase.from('transactions').delete().eq('id', txn.id);
      setTransactions(transactions.filter(t => t.id !== txn.id));
      await fetchData();
  }

  const openEdit = (txn: any) => {
      setEditingTxn(txn);
      setTxnForm({
          type: txn.type,
          date: txn.date,
          amount: txn.amount.toString(),
          payee: txn.payee || '',
          category_id: txn.category_id?.toString() || '',
          account_id: txn.account_id.toString(),
          to_account_id: txn.to_account_id?.toString() || '',
          purchase_rating: txn.purchase_rating || 'Neutral',
          notes: txn.notes || ''
      });
      setIsModalOpen(true);
  };

  const closeModal = () => {
      setIsModalOpen(false);
      setEditingTxn(null);
      setTxnForm({ ...txnForm, amount: '', payee: '', notes: '' });
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

  const processedTxns = transactions.filter(t => {
      if (filterType !== 'All' && t.type !== filterType) return false;
      if (filterAccount !== 'All' && t.account_id?.toString() !== filterAccount && t.to_account_id?.toString() !== filterAccount) return false;
      if (searchQuery) {
          const q = searchQuery.toLowerCase();
          return (t.payee?.toLowerCase().includes(q) || t.notes?.toLowerCase().includes(q) || t.categories?.name?.toLowerCase().includes(q));
      }
      return true;
  });

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400 font-bold animate-pulse">Syncing Ledger...</div>;

  return (
    <main className="p-4 md:p-8 min-h-screen bg-slate-50 pb-32">
      
      {/* NAVIGATION */}
      <div className="flex flex-wrap justify-center md:justify-start gap-2 mb-8 bg-white p-2 rounded-2xl shadow-sm border border-slate-100 w-fit mx-auto md:mx-0">
        <Link href="/" className="px-5 py-2.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl font-bold text-sm flex items-center gap-2 transition-colors">
          <PieChart size={16}/> Dashboard
        </Link>
        <Link href="/budget" className="px-5 py-2.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl font-bold text-sm flex items-center gap-2 transition-colors">
          <LayoutGrid size={16}/> Budget Planner
        </Link>
        <Link href="/ledger" className="px-5 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm flex items-center gap-2 shadow-md">
          <ListOrdered size={16}/> Ledger
        </Link>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
              Master Ledger
          </h1>
          <p className="text-slate-500 font-bold mt-1 text-sm">{transactions.length} total entries</p>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="w-full md:w-auto px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 transition-colors">
            <Plus size={18}/> Log Transaction
        </button>
      </div>

      {/* FILTERS */}
      <div className="flex flex-col md:flex-row gap-3 mb-6 bg-white p-3 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex-grow relative">
              <Search className="absolute left-3 top-3 text-slate-400" size={16}/>
              <input 
                  placeholder="Search payees, notes, or categories..." 
                  className="w-full pl-9 p-2.5 bg-slate-50 rounded-xl font-bold text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-blue-300 border border-slate-50 transition-all"
                  value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              />
          </div>
          <div className="flex gap-2">
              <select className="w-full md:w-auto p-2.5 bg-slate-50 rounded-xl font-bold text-sm text-slate-800 outline-none cursor-pointer border border-slate-50" value={filterType} onChange={e => setFilterType(e.target.value)}>
                  <option value="All">All Types</option>
                  <option value="Expense">Expenses Only</option>
                  <option value="Income">Income Only</option>
                  <option value="Transfer">Transfers Only</option>
              </select>
              <select className="w-full md:w-auto p-2.5 bg-slate-50 rounded-xl font-bold text-sm text-slate-800 outline-none cursor-pointer border border-slate-50" value={filterAccount} onChange={e => setFilterAccount(e.target.value)}>
                  <option value="All">All Accounts</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
          </div>
      </div>

      {/* TRANSACTIONS LIST */}
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
          {processedTxns.length > 0 ? (
              <div className="divide-y divide-slate-50">
                  {processedTxns.map(txn => (
                      <div key={txn.id} className="p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-4 hover:bg-slate-50 transition-colors group">
                          <div className="flex items-center gap-4 w-full md:w-2/5">
                              {getTxnIcon(txn.type)}
                              <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                      <h4 className="font-bold text-slate-800 text-lg truncate">{txn.payee || txn.type}</h4>
                                      {txn.type === 'Expense' && getRatingIcon(txn.purchase_rating)}
                                  </div>
                                  <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                                      <span className="font-bold flex items-center gap-1 text-slate-400"><Calendar size={10}/> {format(parseISO(txn.date), 'MMM d, yyyy')}</span>
                                  </p>
                              </div>
                          </div>

                          <div className="flex flex-col md:flex-row md:items-center justify-between w-full md:w-3/5 gap-4 md:gap-0 pl-16 md:pl-0">
                              <div className="flex items-center gap-2 md:gap-4 flex-wrap">
                                  <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-lg flex items-center gap-1 border border-slate-200">
                                      <Wallet size={12}/> {txn.accounts?.name}
                                  </span>
                                  {txn.type === 'Transfer' ? (
                                      <span className="text-xs font-bold bg-blue-50 text-blue-600 px-2 py-1 rounded-lg border border-blue-100 flex items-center gap-1">
                                          To: {accounts.find(a => a.id === txn.to_account_id)?.name}
                                      </span>
                                  ) : txn.categories ? (
                                      <span className="text-xs font-bold bg-purple-50 text-purple-600 px-2 py-1 rounded-lg border border-purple-100 flex items-center gap-1">
                                          <Tag size={12}/> {txn.categories.emoji} {txn.categories.name}
                                      </span>
                                  ) : (
                                      <span className="text-xs font-bold bg-emerald-50 text-emerald-600 px-2 py-1 rounded-lg border border-emerald-100">
                                          Ready to Assign
                                      </span>
                                  )}
                              </div>
                              
                              <div className="flex items-center justify-between md:justify-end w-full md:w-auto gap-4">
                                  {txn.notes && <span title={txn.notes}><FileText size={16} className="text-slate-300"/></span>}
                                  <div className={`font-black text-xl md:text-2xl tracking-tight ${txn.type === 'Income' ? 'text-emerald-500' : txn.type === 'Expense' ? 'text-slate-900' : 'text-blue-500'}`}>
                                      {txn.type === 'Expense' ? '-' : txn.type === 'Income' ? '+' : ''}${Number(txn.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                  </div>
                                  <div className="flex items-center gap-1">
                                      <button onClick={() => openEdit(txn)} className="md:opacity-0 group-hover:opacity-100 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all">
                                          <Edit2 size={16}/>
                                      </button>
                                      <button onClick={() => deleteTransaction(txn)} className="md:opacity-0 group-hover:opacity-100 p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all">
                                          <Trash2 size={16}/>
                                      </button>
                                  </div>
                              </div>
                          </div>
                      </div>
                  ))}
              </div>
          ) : (
              <div className="text-center py-24">
                  <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
                      <ListOrdered size={32}/>
                  </div>
                  <h4 className="font-bold text-slate-700 text-lg">Ledger is clear</h4>
                  <p className="text-sm text-slate-500 mt-1">Record an expense or income to see it here.</p>
              </div>
          )}
      </div>

      {/* --- TRANSACTION MODAL (ADD & EDIT) --- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={saveTransaction} className="bg-white w-full max-w-lg rounded-3xl p-6 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto hide-scrollbar">
            <div className="flex justify-between items-center mb-6 sticky top-0 bg-white z-10 pb-2 border-b border-slate-50">
              <h3 className="font-bold text-xl flex items-center gap-2">
                {editingTxn ? <Edit2 size={20} className="text-blue-500"/> : <Plus size={20} className="text-emerald-500"/>} 
                {editingTxn ? 'Edit Transaction' : 'Log Transaction'}
              </h3>
              <button type="button" onClick={closeModal} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"><X size={18}/></button>
            </div>

            <div className="space-y-5">
              <div className="flex bg-slate-100 p-1 rounded-xl">
                  <button type="button" onClick={() => setTxnForm({...txnForm, type: 'Expense'})} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${txnForm.type === 'Expense' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Expense</button>
                  <button type="button" onClick={() => setTxnForm({...txnForm, type: 'Income'})} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${txnForm.type === 'Income' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-500'}`}>Income</button>
                  <button type="button" onClick={() => setTxnForm({...txnForm, type: 'Transfer'})} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${txnForm.type === 'Transfer' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}>Transfer</button>
              </div>

              <div className="flex gap-4">
                  <div className="w-2/3">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Amount</label>
                      <div className="relative">
                          <span className={`absolute left-4 top-3.5 font-bold ${txnForm.type === 'Income' ? 'text-emerald-500' : 'text-slate-400'}`}>$</span>
                          <input required autoFocus type="number" step="0.01" placeholder="0.00" className="w-full pl-8 p-3 bg-slate-50 rounded-xl font-black text-2xl text-slate-900 placeholder-slate-300 border border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all" value={txnForm.amount} onChange={e => setTxnForm({...txnForm, amount: e.target.value})} />
                      </div>
                  </div>
                  <div className="w-1/3">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Date</label>
                      <input required type="date" className="w-full p-3 bg-slate-50 rounded-xl font-bold text-sm text-slate-900 border border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all" value={txnForm.date} onChange={e => setTxnForm({...txnForm, date: e.target.value})} />
                  </div>
              </div>

              {txnForm.type !== 'Transfer' && (
                  <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">{txnForm.type === 'Income' ? 'Source / Payer' : 'Payee / Vendor'}</label>
                      <input 
                          required 
                          list="payee-list"
                          placeholder="e.g. Walmart, Chase, Salary" 
                          className="w-full p-3 bg-slate-50 rounded-xl font-bold text-slate-900 placeholder-slate-400 border border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all" 
                          value={txnForm.payee} 
                          onChange={e => setTxnForm({...txnForm, payee: e.target.value})} 
                      />
                      <datalist id="payee-list">
                          {payeeSuggestions.map((p, i) => <option key={i} value={p} />)}
                      </datalist>
                  </div>
              )}

              <div className="flex gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <div className={txnForm.type === 'Transfer' ? 'w-1/2' : 'w-full'}>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">{txnForm.type === 'Income' ? 'Deposit Into' : 'Pay From Account'}</label>
                      <select required className="w-full p-3 bg-white rounded-xl font-bold text-sm text-slate-900 border border-slate-200 outline-none focus:border-blue-300 cursor-pointer" value={txnForm.account_id} onChange={e => setTxnForm({...txnForm, account_id: e.target.value})}>
                          {accounts.map(a => <option key={a.id} value={a.id}>{a.name} (${Math.abs(Number(a.balance)).toFixed(2)})</option>)}
                      </select>
                  </div>
                  
                  {txnForm.type === 'Transfer' && (
                      <div className="w-1/2">
                          <label className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-2 block">Transfer To Account</label>
                          <select required className="w-full p-3 bg-white rounded-xl font-bold text-sm text-blue-900 border border-blue-200 outline-none focus:border-blue-400 cursor-pointer" value={txnForm.to_account_id} onChange={e => setTxnForm({...txnForm, to_account_id: e.target.value})}>
                              <option value="" disabled>Select Destination...</option>
                              {accounts.filter(a => a.id.toString() !== txnForm.account_id).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                      </div>
                  )}
              </div>

              {txnForm.type !== 'Transfer' && (
                  <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2"><Tag size={14}/> Budget Envelope</label>
                      <select className="w-full p-3 bg-slate-50 rounded-xl font-bold text-slate-900 border border-slate-100 outline-none focus:border-blue-300 cursor-pointer" value={txnForm.category_id} onChange={e => setTxnForm({...txnForm, category_id: e.target.value})}>
                          <option value="">{txnForm.type === 'Income' ? 'Ready to Assign (Uncategorized)' : 'Uncategorized Expense'}</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.emoji || ''} {c.name}</option>)}
                      </select>
                  </div>
              )}

              {txnForm.type === 'Expense' && (
                  <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Purchase Rating</label>
                      <div className="flex gap-2">
                          {['Good', 'Neutral', 'Regret'].map(rating => (
                             <button key={rating} type="button" onClick={() => setTxnForm({...txnForm, purchase_rating: rating})} className={`flex-1 py-2 rounded-xl text-sm font-bold flex flex-col items-center justify-center gap-1 border-2 transition-all ${txnForm.purchase_rating === rating ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-transparent bg-slate-50 text-slate-400 hover:bg-slate-100'}`}>
                                {rating === 'Good' && <Smile size={18}/>}
                                {rating === 'Neutral' && <Meh size={18}/>}
                                {rating === 'Regret' && <Frown size={18}/>}
                                {rating}
                             </button>
                          ))}
                      </div>
                  </div>
              )}

              <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2"><AlignLeft size={14}/> Notes (Optional)</label>
                  <textarea placeholder="Write a note..." className="w-full p-3 bg-slate-50 rounded-xl font-bold text-sm text-slate-900 placeholder-slate-400 border border-slate-100 outline-none focus:border-blue-300 focus:bg-white transition-all resize-none" rows={2} value={txnForm.notes} onChange={e => setTxnForm({...txnForm, notes: e.target.value})} />
              </div>
            </div>

            <button type="submit" disabled={isSubmitting} className={`w-full text-white py-4 rounded-xl font-bold mt-8 shadow-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${editingTxn ? 'bg-blue-500 hover:bg-blue-600 shadow-blue-200' : 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-200'}`}>
              {isSubmitting ? <Loader2 className="animate-spin" size={20}/> : <Save size={20}/>} {isSubmitting ? 'Saving...' : editingTxn ? 'Update Transaction' : 'Log Transaction'}
            </button>
          </form>
        </div>
      )}

    </main>
  );
}
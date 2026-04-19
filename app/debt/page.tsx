'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { 
  TrendingDown, Snowflake, Flame, Trophy, 
  Calendar, Activity, AlertCircle 
} from 'lucide-react';
import { format, addMonths } from 'date-fns';

export default function DebtEngine() {
  const [debts, setDebts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [extraPayment, setExtraPayment] = useState('');
  const [strategy, setStrategy] = useState<'snowball' | 'avalanche'>('snowball');

  useEffect(() => {
    fetchDebts();
  }, []);

  async function fetchDebts() {
    setLoading(true);
    const { data } = await supabase
      .from('categories')
      .select('*')
      .eq('is_debt', true)
      .gt('balance', 0);
      
    if (data) setDebts(data);
    setLoading(false);
  }

  const totalDebt = debts.reduce((sum, d) => sum + Number(d.balance), 0);
  const totalMinimums = debts.reduce((sum, d) => sum + (Number(d.target_amount) || 0), 0);
  const totalMonthlyPower = totalMinimums + (parseFloat(extraPayment) || 0);

  // --- THE DEBT SIMULATOR ENGINE ---
  const simulatePayoff = () => {
    let simulation = debts.map(d => ({
      ...d,
      currentBalance: Number(d.balance),
      minPayment: Number(d.target_amount) || 0,
      payoffMonth: -1
    }));

    let monthsPassed = 0;
    let activeDebts = simulation.length;
    const MAX_MONTHS = 1200; 

    if (totalMonthlyPower <= 0) return simulation;

    while (activeDebts > 0 && monthsPassed < MAX_MONTHS) {
        monthsPassed++;
        
        let remaining = simulation.filter(d => d.currentBalance > 0);
        
        if (strategy === 'snowball') {
            remaining.sort((a, b) => a.currentBalance - b.currentBalance); 
        } else {
            remaining.sort((a, b) => b.currentBalance - a.currentBalance); 
        }

        let availablePower = totalMonthlyPower;

        // Step A: Minimum Payments
        remaining.forEach(d => {
            if (availablePower <= 0) return;
            let payment = Math.min(d.minPayment, d.currentBalance, availablePower);
            d.currentBalance -= payment;
            availablePower -= payment;
            
            if (d.currentBalance <= 0 && d.payoffMonth === -1) {
                d.payoffMonth = monthsPassed;
            }
        });

        // Step B: The Snowball (Leftover funds hit priority debt)
        let priorityRemaining = remaining.filter(d => d.currentBalance > 0);
        for (let i = 0; i < priorityRemaining.length; i++) {
            if (availablePower <= 0) break;
            
            let targetDebt = priorityRemaining[i];
            let payment = Math.min(targetDebt.currentBalance, availablePower);
            
            targetDebt.currentBalance -= payment;
            availablePower -= payment;
            
            if (targetDebt.currentBalance <= 0 && targetDebt.payoffMonth === -1) {
                targetDebt.payoffMonth = monthsPassed;
            }
        }

        activeDebts = simulation.filter(d => d.currentBalance > 0).length;
    }

    return simulation.sort((a, b) => {
        if (a.payoffMonth === -1) return 1;
        if (b.payoffMonth === -1) return -1;
        return a.payoffMonth - b.payoffMonth;
    });
  };

  const simulationResults = simulatePayoff();
  
  const finalDebt = simulationResults.length > 0 ? simulationResults.reduce((latest, current) => current.payoffMonth > latest.payoffMonth ? current : latest) : null;
  const debtFreeDate = finalDebt && finalDebt.payoffMonth !== -1 ? addMonths(new Date(), finalDebt.payoffMonth) : null;

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400 font-bold animate-pulse">Running Debt Algorithms...</div>;

  if (debts.length === 0) {
      return (
          <main className="p-4 md:p-8 min-h-screen bg-slate-50 pb-32 flex flex-col items-center justify-center text-center">
              <div className="w-24 h-24 bg-emerald-100 text-emerald-500 rounded-full flex items-center justify-center mb-6 shadow-sm"><Trophy size={48}/></div>
              <h1 className="text-4xl font-extrabold text-slate-900 mb-2">You are Debt Free!</h1>
              <p className="text-slate-500 font-medium">No categories are currently tracking an outstanding balance.</p>
              <Link href="/budget" className="mt-8 bg-slate-900 text-white px-6 py-3 rounded-xl font-bold shadow-lg hover:bg-slate-800">Return to Budget</Link>
          </main>
      );
  }

  return (
    <main className="p-4 md:p-8 min-h-screen bg-slate-50 pb-32">
      
      {/* HEADER */}
      <div className="mb-8">
        <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3 mb-2">
            Debt<span className="text-red-500">Engine</span>
        </h1>
        <p className="text-slate-500 font-bold text-sm">Visualize your path to becoming completely debt-free.</p>
      </div>

      {/* HERO STATS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2 bg-slate-900 text-white rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden flex flex-col justify-center">
            <div className="absolute top-0 right-0 w-64 h-64 bg-red-500 rounded-full mix-blend-screen filter blur-3xl opacity-20 translate-x-20 -translate-y-20"></div>
            <p className="text-slate-400 font-bold text-sm uppercase tracking-widest mb-2">Total Liabilities</p>
            <h2 className="text-5xl md:text-7xl font-black tracking-tighter mb-6 text-red-400">
              ${totalDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h2>
            
            <div className="flex flex-wrap items-center gap-4 text-sm font-medium">
              <div className="flex items-center gap-2 bg-white/10 px-4 py-2.5 rounded-xl backdrop-blur-md border border-white/5">
                 <Calendar size={18} className="text-emerald-400"/>
                 <span>Debt Free Date: <span className="font-black text-white">{debtFreeDate ? format(debtFreeDate, 'MMMM yyyy') : 'Never'}</span></span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 px-4 py-2.5 rounded-xl backdrop-blur-md border border-white/5">
                 <Flame size={18} className="text-orange-400"/>
                 <span>Simulation Power: <span className="font-black text-white">${totalMonthlyPower.toLocaleString('en-US', { minimumFractionDigits: 2 })}/mo</span></span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 flex flex-col justify-center">
              <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2"><Activity size={18}/> Financial Power</h3>
              
              <div className="space-y-4">
                  <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                      <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Minimums</span>
                      <span className="font-black text-lg">${totalMinimums.toLocaleString('en-US', { minimumFractionDigits: 2 })}/mo</span>
                  </div>
                  
                  <div>
                      <label className="text-xs font-bold text-emerald-500 uppercase tracking-wider mb-2 block">Extra Monthly Fuel</label>
                      <div className="relative">
                          <span className="absolute left-3 top-3 font-bold text-emerald-500">$</span>
                          <input 
                              type="number" 
                              placeholder="0.00" 
                              className="w-full pl-7 p-3 bg-emerald-50 rounded-xl font-black text-lg text-emerald-700 border border-emerald-200 outline-none focus:border-emerald-400 transition-all" 
                              value={extraPayment} 
                              onChange={e => setExtraPayment(e.target.value)} 
                          />
                      </div>
                  </div>
              </div>
          </div>
      </div>

      {/* STRATEGY TOGGLE */}
      <div className="flex bg-slate-200 p-1 rounded-2xl w-full max-w-md mb-8 mx-auto md:mx-0 shadow-inner">
          <button 
              onClick={() => setStrategy('snowball')} 
              className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${strategy === 'snowball' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
          >
              <Snowflake size={16} className={strategy === 'snowball' ? 'text-blue-500' : ''}/> Snowball
          </button>
          <button 
              onClick={() => setStrategy('avalanche')} 
              className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${strategy === 'avalanche' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
          >
              <Flame size={16} className={strategy === 'avalanche' ? 'text-orange-500' : ''}/> Avalanche
          </button>
      </div>

      {/* TIMELINE LIST */}
      <div className="space-y-4">
          <h3 className="font-bold text-lg text-slate-800 mb-4 flex items-center gap-2">
             <TrendingDown size={20}/> Payoff Plan Priority
          </h3>
          
          {simulationResults.map((debt, index) => {
              const payoffDate = debt.payoffMonth !== -1 ? addMonths(new Date(), debt.payoffMonth) : null;
              
              return (
                  <div key={debt.id} className="bg-white p-5 md:p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:border-blue-200 transition-colors group">
                      <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-xl shrink-0 font-bold text-slate-400 group-hover:bg-blue-50 group-hover:border-blue-200 group-hover:text-blue-500 transition-colors">
                              {index + 1}
                          </div>
                          <div>
                              <h4 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                                  {debt.emoji} {debt.name}
                              </h4>
                              <div className="flex items-center gap-3 mt-1">
                                  <span className="text-xs font-bold bg-red-50 text-red-600 px-2 py-0.5 rounded border border-red-100">
                                      Balance: ${Number(debt.balance).toLocaleString()}
                                  </span>
                                  <span className="text-xs font-bold text-slate-400">
                                      Min: ${debt.minPayment.toLocaleString()}
                                  </span>
                              </div>
                          </div>
                      </div>

                      <div className="flex items-center md:justify-end gap-3 w-full md:w-auto">
                          {index === 0 && (
                              <span className="text-[10px] font-black uppercase tracking-wider bg-blue-100 text-blue-700 px-2 py-1 rounded hidden md:block">
                                  Current Focus
                              </span>
                          )}
                          <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${payoffDate ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                              {payoffDate ? <Trophy size={16}/> : <AlertCircle size={16}/>}
                              <span className="font-black text-sm">
                                  {payoffDate ? format(payoffDate, 'MMM yyyy') : 'Stagnant (Increase Payment)'}
                              </span>
                          </div>
                      </div>
                  </div>
              );
          })}
      </div>

    </main>
  );
}
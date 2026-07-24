'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { 
  ArrowUpRight, ArrowDownRight, ArrowRightLeft, ArrowUpDown, Activity, X, 
  Plus, PieChart, LayoutGrid, ListOrdered, Calendar, Tag, 
  FileText, Trash2, AlignLeft, Save, Loader2, Wallet, Edit2, CheckCircle2, AlertTriangle, Zap, Split
} from 'lucide-react';
import { format, parseISO, addWeeks, addMonths, addYears } from 'date-fns';
import SearchableDropdown from '@/app/components/SearchableDropdown';
import { formatMoney, roundMoney, snapMoney } from '@/lib/money';
import { applySmartBillPay } from '@/lib/balance-adjustment';
import {
  categorySupportsAdvanceDueDate,
  categorySupportsSmartBillPay,
} from '@/lib/smart-bill-pay';
import { applyTransactionBalances, reverseTransactionBalances } from '@/lib/transaction-balance';
import {
  attachSplitsToTransactions,
  fetchLastDefaultsForPayee,
} from '@/lib/queries/transactions';
import {
  deleteSplitsForTransaction,
  replaceTransactionSplits,
} from '@/lib/queries/transaction-splits';
import {
  resolveOpeningAccountId,
  resolveTransferDefaults,
  saveLastTransferPair,
  saveLastTxnAccountId,
} from '@/lib/transaction-defaults';
import {
  emptySplitLine,
  isSplitTransaction,
  parseSplitLines,
  splitsMatchTotal,
  type SplitFormLine,
} from '@/lib/transaction-splits';
import { SplitTransactionFields } from '@/features/ledger/split-transaction-fields';
import {
  LedgerFiltersBar,
  LedgerSummaryStrip,
} from '@/features/ledger/ledger-filters-bar';
import {
  computeLedgerTotals,
  filterLedgerTransactions,
  hasActiveLedgerFilters,
  LEDGER_VISIBLE_BATCH,
} from '@/lib/ledger/filters';
import { useLedgerFilters } from '@/hooks/use-ledger-filters';
import {
  useAccounts,
  useCategories,
  useCategoryGroups,
  useInvalidateFinance,
  useTransactions,
  useVentures,
} from '@/hooks/use-finance-queries';
import { PageSkeleton } from '@/components/ui/skeleton';
import type { Transaction } from '@/lib/types';
import { useEntity } from '@/app/providers/entity-provider';
import { VentureSelect } from '@/features/ventures/venture-select';
import { VentureFilterPills } from '@/features/ventures/venture-filter-pills';
import { OwnerFlowModal } from '@/features/owner-flow/owner-flow-modal';
import { ReceiptAttachments } from '@/features/receipts/receipt-attachments';

export function LedgerView() {
  const searchParams = useSearchParams();
  const { entityId, isBusiness } = useEntity();
  const { filters, patch, reset, initialized } = useLedgerFilters();
  const invalidate = useInvalidateFinance();
  const { data: transactions = [], isLoading: transactionsLoading } = useTransactions();
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const { data: categories = [], isLoading: categoriesLoading } = useCategories();
  const { data: categoryGroups = [], isLoading: groupsLoading } = useCategoryGroups();
  const { data: ventures = [] } = useVentures();
  const [ventureFilter, setVentureFilter] = useState<'all' | 'overhead' | number>('all');
  const [ownerFlowOpen, setOwnerFlowOpen] = useState(false);

  const payeeSuggestions = useMemo(
    () =>
      Array.from(new Set(transactions.map((t) => t.payee).filter(Boolean))) as string[],
    [transactions]
  );

  const loading =
    transactionsLoading || accountsLoading || categoriesLoading || groupsLoading;

  // Modal & Edit State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingTxn, setEditingTxn] = useState<any>(null);

  // Smart Bill Pay Logic States
  const [smartBillPay, setSmartBillPay] = useState({
      showToggle: false,
      advanceCycle: true,
      deductDebt: true,
      category: null as any
  });
  
  // Form
  const [txnForm, setTxnForm] = useState({
    type: 'Expense',
    date: format(new Date(), 'yyyy-MM-dd'),
    amount: '',
    payee: '',
    category_id: '',
    account_id: '',
    to_account_id: '',
    notes: '',
    venture_id: '',
  });

  const [isSplitMode, setIsSplitMode] = useState(false);
  const [splitLines, setSplitLines] = useState<SplitFormLine[]>([
    emptySplitLine(),
    emptySplitLine(),
  ]);

  useEffect(() => {
    const urlAccountId = searchParams.get('account');
    const isNew = searchParams.get('new') === 'true';
    if (isNew) setIsModalOpen(true);
    if (accounts.length === 0) return;

    const accountId =
      urlAccountId ||
      (filters.filterAccount !== 'All' ? filters.filterAccount : null);
    if (accountId) {
      setTxnForm((prev) => ({ ...prev, account_id: accountId }));
    } else if (!txnForm.account_id) {
      setTxnForm((prev) => ({ ...prev, account_id: accounts[0].id.toString() }));
    }
  }, [searchParams, accounts, filters.filterAccount]);

  async function refreshLedger() {
    await invalidate.invalidateAfterTransaction();
  }

  async function txnWithSplits(txn: Transaction): Promise<Transaction> {
    const [enriched] = await attachSplitsToTransactions([txn]);
    return enriched;
  }

  async function saveTransaction(e: React.FormEvent) {
      e.preventDefault();
      setIsSubmitting(true);

      const amount = roundMoney(parseFloat(txnForm.amount) || 0);
      const useSplit = isSplitMode && txnForm.type !== 'Transfer';
      const parsedSplits = useSplit ? parseSplitLines(splitLines) : [];

      if (useSplit) {
        if (parsedSplits.length < 2) {
          alert('Add at least two categories with amounts for a split transaction.');
          setIsSubmitting(false);
          return;
        }
        if (!splitsMatchTotal(amount, splitLines)) {
          alert('Split amounts must equal the transaction total.');
          setIsSubmitting(false);
          return;
        }
      }

      const payload = {
          date: txnForm.date,
          amount: amount,
          payee: txnForm.type === 'Transfer' ? 'Transfer' : txnForm.payee,
          category_id:
            txnForm.type === 'Transfer'
              ? null
              : useSplit
                ? null
                : txnForm.category_id
                  ? parseInt(txnForm.category_id)
                  : null,
          account_id: parseInt(txnForm.account_id),
          to_account_id: txnForm.type === 'Transfer' ? parseInt(txnForm.to_account_id) : null,
          type: txnForm.type,
          notes: txnForm.notes || null,
          entity_id: entityId,
          venture_id:
            txnForm.type === 'Transfer' || !isBusiness
              ? null
              : txnForm.venture_id
                ? parseInt(txnForm.venture_id)
                : null,
      };

      if (editingTxn) {
          await reverseTransactionBalances(editingTxn);
          const { data: updated, error } = await supabase.from('transactions').update(payload).eq('id', editingTxn.id).select('*, categories(name, emoji), accounts!account_id(name, type)').single();
          if (error || !updated) {
              await applyTransactionBalances(editingTxn);
          } else {
              if (useSplit) {
                await replaceTransactionSplits(updated.id, parsedSplits);
              } else {
                await deleteSplitsForTransaction(updated.id);
              }
              const fullTxn = await txnWithSplits(updated);
              await applyTransactionBalances(fullTxn);
          }
      } else {
          const { data: inserted, error } = await supabase.from('transactions').insert([payload]).select('*, categories(name, emoji), accounts!account_id(name, type)').single();
          if (inserted) {
              if (useSplit) {
                await replaceTransactionSplits(inserted.id, parsedSplits);
              }
              const fullTxn = await txnWithSplits(inserted);
              await applyTransactionBalances(fullTxn);

              if (!useSplit && smartBillPay.showToggle && smartBillPay.category) {
                  await applySmartBillPay(smartBillPay.category, {
                      advanceCycle: smartBillPay.advanceCycle,
                      deductDebt: smartBillPay.deductDebt,
                  });
              }
          }
      }

      if (payload.type === 'Transfer' && payload.to_account_id) {
        saveLastTransferPair(String(payload.account_id), String(payload.to_account_id));
      } else {
        saveLastTxnAccountId(String(payload.account_id));
      }

      closeModal();
      await refreshLedger(); 
      setIsSubmitting(false);
  }

  async function deleteTransaction(txn: Transaction) {
      if (!confirm("Permanently delete and reverse all math for this transaction?")) return;
      await reverseTransactionBalances(txn);
      await supabase.from('transactions').delete().eq('id', txn.id);
      await refreshLedger();
  }

  const openNewTransactionModal = () => {
      setEditingTxn(null);
      setIsSplitMode(false);
      setSplitLines([emptySplitLine(), emptySplitLine()]);
      const accountIds = accounts.map((a) => String(a.id));
      const preferred =
        filters.filterAccount !== 'All' ? filters.filterAccount : null;
      setTxnForm({
          type: 'Expense',
          date: format(new Date(), 'yyyy-MM-dd'),
          amount: '',
          payee: '',
          category_id: '',
          account_id: resolveOpeningAccountId(accountIds, preferred),
          to_account_id: '',
          notes: '',
          venture_id: '',
      });
      setIsModalOpen(true);
  };

  const setTxnType = (type: 'Expense' | 'Income' | 'Transfer') => {
      if (type === 'Transfer') {
          const accountIds = accounts.map((a) => String(a.id));
          const pair = resolveTransferDefaults(accountIds, txnForm.account_id);
          setTxnForm((prev) => ({
              ...prev,
              type,
              payee: '',
              category_id: '',
              account_id: pair.fromAccountId || prev.account_id,
              to_account_id: pair.toAccountId,
          }));
          setIsSplitMode(false);
          setSmartBillPay({ showToggle: false, advanceCycle: true, deductDebt: true, category: null });
          return;
      }
      setTxnForm((prev) => ({
          ...prev,
          type,
          to_account_id: '',
      }));
  };

  const swapTxnTransferAccounts = () => {
      setTxnForm((prev) => {
          if (!prev.to_account_id) return prev;
          return {
              ...prev,
              account_id: prev.to_account_id,
              to_account_id: prev.account_id,
          };
      });
  };

  const openEdit = (txn: Transaction) => {
      setEditingTxn(txn);
      const splits = txn.transaction_splits || [];
      if (splits.length > 0) {
        setIsSplitMode(true);
        setSplitLines(
          splits.map((s) => ({
            category_id: String(s.category_id),
            amount: String(s.amount),
          }))
        );
      } else {
        setIsSplitMode(false);
        setSplitLines([emptySplitLine(), emptySplitLine()]);
      }
      setTxnForm({
          type: txn.type,
          date: txn.date,
          amount: txn.amount.toString(),
          payee: txn.payee || '',
          category_id: txn.category_id?.toString() || '',
          account_id: txn.account_id.toString(),
          to_account_id: txn.to_account_id?.toString() || '',
          notes: txn.notes || '',
          venture_id: txn.venture_id?.toString() || '',
      });
      setIsModalOpen(true);
  };

  const closeModal = () => {
      setIsModalOpen(false);
      setEditingTxn(null);
      setIsSplitMode(false);
      setSplitLines([emptySplitLine(), emptySplitLine()]);
      setSmartBillPay({ showToggle: false, advanceCycle: true, deductDebt: true, category: null });
      window.history.replaceState({}, document.title, window.location.pathname);
      setTxnForm({ ...txnForm, amount: '', payee: '', notes: '' });
  };

  const handlePayeeChange = async (val: string) => {
      setTxnForm((prev) => ({ ...prev, payee: val }));

      if (!val || editingTxn) return;
      if (txnForm.type !== 'Income' && txnForm.type !== 'Expense') return;

      const defaults = await fetchLastDefaultsForPayee(entityId, val, txnForm.type);
      if (!defaults) return;

      setTxnForm((prev) => ({
          ...prev,
          category_id: defaults.categoryId,
          account_id:
              accounts.some((a) => String(a.id) === defaults.accountId)
                  ? defaults.accountId
                  : prev.account_id,
          venture_id: defaults.ventureId || prev.venture_id,
      }));
      checkSmartBillPay(defaults.categoryId);
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

  const getTxnIcon = (type: string) => {
    switch(type) {
      case 'Income': return <div className="p-3 bg-emerald-500/15 rounded-2xl text-emerald-600 shadow-sm"><ArrowUpRight size={20}/></div>;
      case 'Expense': return <div className="p-3 bg-[var(--surface-subtle)] rounded-2xl text-[var(--text-muted)] shadow-sm"><ArrowDownRight size={20}/></div>;
      case 'Transfer': return <div className="p-3 bg-blue-500/15 rounded-2xl text-blue-600 shadow-sm"><ArrowRightLeft size={20}/></div>;
      default: return <div className="p-3 bg-[var(--surface-subtle)] rounded-2xl text-[var(--text-muted)] shadow-sm"><Activity size={20}/></div>;
    }
  };

  const processedTxns = useMemo(() => {
    let list = filterLedgerTransactions(transactions, filters, accounts, categories);
    if (isBusiness && ventureFilter !== 'all') {
      list = list.filter((t) => {
        if (ventureFilter === 'overhead') return t.venture_id == null;
        return t.venture_id === ventureFilter;
      });
    }
    return list;
  }, [transactions, filters, accounts, categories, isBusiness, ventureFilter]);

  const [visibleCount, setVisibleCount] = useState(LEDGER_VISIBLE_BATCH);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  useEffect(() => {
    setVisibleCount(LEDGER_VISIBLE_BATCH);
  }, [filterKey]);

  const visibleTxns = useMemo(
    () => processedTxns.slice(0, visibleCount),
    [processedTxns, visibleCount]
  );

  const remainingCount = processedTxns.length - visibleTxns.length;

  const ledgerTotals = useMemo(
    () => computeLedgerTotals(processedTxns),
    [processedTxns]
  );

  const filtersActive = hasActiveLedgerFilters(filters);

  if (loading || !initialized) return <PageSkeleton />;

  return (
    <>

      <div className="mb-6 flex flex-col gap-4 md:mb-8 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--text-primary)] sm:text-3xl md:text-4xl">
              Master Ledger
          </h1>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <p className="text-sm font-bold text-[var(--text-muted)]">
              {visibleTxns.length < processedTxns.length
                ? `Showing ${visibleTxns.length} of ${processedTxns.length} entries`
                : filtersActive || processedTxns.length !== transactions.length
                  ? `${processedTxns.length} of ${transactions.length} entries`
                  : `${transactions.length} total entries`}
            </p>
            {(() => {
              const filteredAccount =
                filters.filterAccount !== 'All'
                  ? accounts.find((a) => a.id.toString() === filters.filterAccount)
                  : undefined;
              if (!filteredAccount) return null;
              return (
              <div className="flex w-fit items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-black glass-card shadow-sm">
                <span className="text-[10px] font-bold uppercase text-[var(--text-muted)]">Balance</span>
                <span>
                  {snapMoney(filteredAccount.balance) < 0 ? '-' : ''}
                  ${formatMoney(Math.abs(filteredAccount.balance))}
                </span>
              </div>
              );
            })()}
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row">
          <button
            type="button"
            onClick={() => setOwnerFlowOpen(true)}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-bold text-[var(--entity-accent)] touch-manipulation md:w-auto"
          >
            <ArrowRightLeft size={16} />
            {entityId === 'business' ? 'Pay yourself' : 'Fund business'}
          </button>
          <button onClick={openNewTransactionModal} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 py-3 font-bold text-white shadow-lg shadow-emerald-200 transition-colors touch-manipulation hover:bg-emerald-600 md:w-auto">
              <Plus size={18}/> Log Transaction
          </button>
        </div>
      </div>

      {isBusiness && (
        <div className="mb-4">
          <VentureFilterPills
            ventures={ventures}
            value={ventureFilter}
            onChange={setVentureFilter}
          />
        </div>
      )}

      <LedgerFiltersBar
        filters={filters}
        onPatch={patch}
        onReset={reset}
        accounts={accounts}
        categories={categories}
        categoryGroups={categoryGroups}
        payeeSuggestions={payeeSuggestions}
      />

      <LedgerSummaryStrip
        totals={ledgerTotals}
        totalCount={transactions.length}
        filteredCount={processedTxns.length}
        active={filtersActive}
      />

      {/* TRANSACTIONS LIST */}
      <div className="app-card rounded-3xl shadow-sm border border-[var(--border)] overflow-hidden">
          {processedTxns.length > 0 ? (
              <>
              <div className="divide-y divide-[var(--border)]">
                  {visibleTxns.map(txn => (
                      <div key={txn.id} className="p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-4 hover:bg-[var(--surface-hover)] transition-colors group">
                          <div className="flex items-center gap-4 w-full md:w-2/5">
                              {getTxnIcon(txn.type)}
                              <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                      <h4 className="font-bold text-[var(--text-primary)] text-lg truncate">{txn.payee || txn.type}</h4>
                                  </div>
                                  <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5 mt-0.5">
                                      <span className="font-bold flex items-center gap-1 text-[var(--text-muted)]"><Calendar size={10}/> {format(parseISO(txn.date), 'MMM d, yyyy')}</span>
                                  </p>
                              </div>
                          </div>

                          <div className="flex w-full flex-col justify-between gap-3 pl-16 md:flex-row md:items-center md:gap-0 md:pl-0 md:w-3/5">
                              <div className="flex items-center gap-2 md:gap-4 flex-wrap">
                                  <span className="text-xs font-bold bg-[var(--surface-subtle)] text-[var(--text-muted)] px-2 py-1 rounded-lg flex items-center gap-1 border border-[var(--border)]">
                                      <Wallet size={12}/> {txn.accounts?.name}
                                  </span>
                                  {txn.type === 'Transfer' ? (
                                      <span className="text-xs font-bold bg-blue-50 text-blue-600 px-2 py-1 rounded-lg border border-blue-100 flex items-center gap-1">
                                          To: {accounts.find(a => a.id === txn.to_account_id)?.name}
                                      </span>
                                  ) : isSplitTransaction(txn) ? (
                                      <span className="text-xs font-bold bg-violet-500/10 text-violet-700 px-2 py-1 rounded-lg border border-violet-500/30 flex items-center gap-1">
                                          <Split size={12}/> Split · {txn.transaction_splits!.length} categories
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
                                  {txn.notes && <span title={txn.notes}><FileText size={16} className="text-[var(--text-muted)]"/></span>}
                                  <div className={`font-black text-xl md:text-2xl tracking-tight ${
                                      txn.type === 'Income' 
                                      ? 'text-emerald-500' 
                                      : txn.type === 'Expense' 
                                      ? 'text-red-500' 
                                      : filters.filterAccount !== 'All' 
                                      ? (txn.account_id?.toString() === filters.filterAccount ? 'text-red-500' : 'text-emerald-500')
                                      : 'text-blue-500'
                                  }`}>
                                      {txn.type === 'Expense' ? '-' : txn.type === 'Income' ? '+' : ''}${formatMoney(txn.amount)}
                                  </div>
                                  <div className="flex items-center gap-1">
                                      <button onClick={() => openEdit(txn)} className="p-2 text-[var(--text-muted)] hover:text-[var(--text-muted)] hover:bg-[var(--border)] rounded-lg transition-all touch-manipulation min-h-10 min-w-10">
                                          <Edit2 size={16}/>
                                      </button>
                                      <button onClick={() => deleteTransaction(txn)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-500/100/100/10 rounded-lg transition-all touch-manipulation min-h-10 min-w-10">
                                          <Trash2 size={16}/>
                                      </button>
                                  </div>
                              </div>
                          </div>
                      </div>
                  ))}
              </div>
              {remainingCount > 0 && (
                <div className="border-t border-[var(--border)] p-4 md:p-5">
                  <button
                    type="button"
                    onClick={() =>
                      setVisibleCount((count) =>
                        Math.min(count + LEDGER_VISIBLE_BATCH, processedTxns.length)
                      )
                    }
                    className="flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-6 py-3 text-sm font-bold text-[var(--text-primary)] transition-colors touch-manipulation hover:bg-[var(--surface-hover)]"
                  >
                    Show {Math.min(LEDGER_VISIBLE_BATCH, remainingCount)} more
                    {remainingCount > LEDGER_VISIBLE_BATCH
                      ? ` (${remainingCount} remaining)`
                      : ''}
                  </button>
                </div>
              )}
              </>
          ) : (
              <div className="text-center py-24">
                  <div className="w-16 h-16 bg-[var(--surface-subtle)] text-[var(--text-muted)] rounded-full flex items-center justify-center mx-auto mb-4">
                      <ListOrdered size={32}/>
                  </div>
                  <h4 className="font-bold text-[var(--text-primary)] text-lg">
                    {filtersActive ? 'No matching transactions' : 'Ledger is clear'}
                  </h4>
                  <p className="text-sm text-[var(--text-muted)] mt-1">
                    {filtersActive
                      ? 'Try adjusting your filters or search query.'
                      : 'Record an expense or income to see it here.'}
                  </p>
              </div>
          )}
      </div>

      {/* --- TRANSACTION MODAL (ADD & EDIT) --- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={saveTransaction} className="app-modal w-full max-w-lg rounded-3xl p-6 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto hide-scrollbar">
            <div className="flex justify-between items-center mb-6 sticky top-0 bg-[var(--surface-elevated)] z-10 pb-2 border-b border-[var(--border)]">
              <h3 className="font-bold text-xl flex items-center gap-2">
                {editingTxn ? <Edit2 size={20} className="text-blue-500"/> : <Plus size={20} className="text-emerald-500"/>} 
                {editingTxn ? 'Edit Transaction' : 'Log Transaction'}
              </h3>
              <button type="button" onClick={closeModal} className="p-2 text-[var(--text-muted)] hover:text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] rounded-full transition-colors"><X size={18}/></button>
            </div>

            <div className="space-y-5">
              <div className="flex app-segment-track p-1 rounded-xl">
                  <button type="button" onClick={() => setTxnType('Expense')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${txnForm.type === 'Expense' ? 'app-segment-active shadow-sm' : 'text-[var(--text-muted)]'}`}>Expense</button>
                  <button type="button" onClick={() => setTxnType('Income')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${txnForm.type === 'Income' ? 'app-segment-active shadow-sm text-emerald-500' : 'text-[var(--text-muted)]'}`}>Income</button>
                  <button type="button" onClick={() => setTxnType('Transfer')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${txnForm.type === 'Transfer' ? 'app-segment-active shadow-sm text-blue-500' : 'text-[var(--text-muted)]'}`}>Transfer</button>
              </div>

              <div className="flex gap-4">
                  <div className="w-2/3">
                      <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Amount</label>
                      <div className="relative">
                          <span className={`absolute left-4 top-3.5 font-bold ${txnForm.type === 'Income' ? 'text-emerald-500' : 'text-[var(--text-muted)]'}`}>$</span>
                          <input required autoFocus type="number" step="0.01" placeholder="0.00" className="w-full pl-8 p-3 app-input rounded-xl font-black text-2xl text-[var(--text-primary)] placeholder-[var(--text-muted)] border border-[var(--border)] outline-none focus:border-blue-300 focus:bg-[var(--surface-elevated)] transition-all" value={txnForm.amount} onChange={e => setTxnForm({...txnForm, amount: e.target.value})} />
                      </div>
                  </div>
                  <div className="w-1/3">
                      <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Date</label>
                      <input required type="date" className="w-full p-3 app-input rounded-xl font-bold text-sm text-[var(--text-primary)] border border-[var(--border)] outline-none focus:border-blue-300 focus:bg-[var(--surface-elevated)] transition-all" value={txnForm.date} onChange={e => setTxnForm({...txnForm, date: e.target.value})} />
                  </div>
              </div>

              {txnForm.type !== 'Transfer' && (
                  <div>
                      <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">{txnForm.type === 'Income' ? 'Source / Payer' : 'Payee / Vendor'}</label>
                      <input 
                          required 
                          list="payee-list"
                          placeholder="e.g. Walmart, Chase, Salary" 
                          className="w-full p-3 app-input rounded-xl font-bold text-[var(--text-primary)] placeholder-[var(--text-muted)] border border-[var(--border)] outline-none focus:border-blue-300 focus:bg-[var(--surface-elevated)] transition-all" 
                          value={txnForm.payee} 
                          onChange={e => handlePayeeChange(e.target.value)} 
                      />
                      <datalist id="payee-list">
                          {payeeSuggestions.map((p, i) => <option key={i} value={p} />)}
                      </datalist>
                  </div>
              )}

              {txnForm.type === 'Transfer' ? (
                <div className="flex flex-col gap-2 app-card-subtle p-4 rounded-2xl border border-[var(--border)]">
                  <div>
                    <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">Pay From Account</label>
                    <select required className="w-full p-3 app-card rounded-xl font-bold text-sm text-[var(--text-primary)] border border-[var(--border)] outline-none focus:border-blue-300 cursor-pointer" value={txnForm.account_id} onChange={e => setTxnForm({...txnForm, account_id: e.target.value})}>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name} (${formatMoney(Math.abs(a.balance))})</option>)}
                    </select>
                  </div>

                  <div className="flex justify-center -my-1 relative z-10">
                    <button
                      type="button"
                      onClick={swapTxnTransferAccounts}
                      disabled={!txnForm.to_account_id}
                      className="app-card p-2 rounded-full border border-[var(--border)] shadow-sm text-[var(--text-muted)] hover:text-blue-500 hover:border-blue-500/30 transition-all hover:bg-blue-500/10 disabled:opacity-40 disabled:pointer-events-none"
                      title="Swap transfer direction"
                    >
                      <ArrowUpDown size={16} />
                    </button>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-2 block">Transfer To Account</label>
                    <select required className="w-full p-3 app-card rounded-xl font-bold text-sm text-blue-900 border border-blue-500/30 outline-none focus:border-blue-400 cursor-pointer" value={txnForm.to_account_id} onChange={e => setTxnForm({...txnForm, to_account_id: e.target.value})}>
                      <option value="" disabled>Select Destination...</option>
                      {accounts.filter(a => a.id.toString() !== txnForm.account_id).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="app-card-subtle p-4 rounded-2xl border border-[var(--border)]">
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">{txnForm.type === 'Income' ? 'Deposit Into' : 'Pay From Account'}</label>
                  <select required className="w-full p-3 app-card rounded-xl font-bold text-sm text-[var(--text-primary)] border border-[var(--border)] outline-none focus:border-blue-300 cursor-pointer" value={txnForm.account_id} onChange={e => setTxnForm({...txnForm, account_id: e.target.value})}>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name} (${formatMoney(Math.abs(a.balance))})</option>)}
                  </select>
                </div>
              )}

              {txnForm.type !== 'Transfer' && (
                  <>
                    <label className="flex items-center gap-3 cursor-pointer app-card-subtle p-3 rounded-xl border border-[var(--border)]">
                      <input
                        type="checkbox"
                        checked={isSplitMode}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setIsSplitMode(on);
                          if (on) {
                            const lines =
                              txnForm.category_id && txnForm.amount
                                ? [
                                    { category_id: txnForm.category_id, amount: txnForm.amount },
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
                        totalAmount={txnForm.amount}
                        lines={splitLines}
                        onChange={setSplitLines}
                        categories={categories}
                        txnType={txnForm.type as 'Expense' | 'Income'}
                      />
                    ) : (
                      <div>
                        <SearchableDropdown
                          label="Budget Envelope"
                          icon={<Tag size={14} />}
                          options={[
                            {
                              id: '',
                              name:
                                txnForm.type === 'Income'
                                  ? 'Ready to Assign (Uncategorized)'
                                  : 'Uncategorized Expense',
                            },
                            ...categories.map((c) => ({
                              id: c.id,
                              name: c.name,
                              emoji: c.emoji ?? undefined,
                              group: 'Envelopes',
                            })),
                          ]}
                          value={txnForm.category_id}
                          onChange={(val) => {
                            const cat = categories.find((c) => String(c.id) === val);
                            setTxnForm({
                              ...txnForm,
                              category_id: val,
                              venture_id:
                                cat?.venture_id != null
                                  ? String(cat.venture_id)
                                  : txnForm.venture_id,
                            });
                            checkSmartBillPay(val);
                          }}
                        />
                      </div>
                    )}
                    {isBusiness && txnForm.type !== 'Transfer' && (
                      <VentureSelect
                        ventures={ventures}
                        value={txnForm.venture_id}
                        onChange={(val) =>
                          setTxnForm({ ...txnForm, venture_id: val })
                        }
                      />
                    )}
                  </>
              )}

              {editingTxn && (
                <ReceiptAttachments transactionId={editingTxn.id} />
              )}

              {/* Feature 6: Smart Bill Pay UI */}
              {!editingTxn && !isSplitMode && smartBillPay.showToggle && (
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
                  <textarea placeholder="Write a note..." className="w-full p-3 app-input rounded-xl font-bold text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] border border-[var(--border)] outline-none focus:border-blue-300 focus:bg-[var(--surface-elevated)] transition-all resize-none" rows={2} value={txnForm.notes} onChange={e => setTxnForm({...txnForm, notes: e.target.value})} />
              </div>
            </div>

            <button type="submit" disabled={isSubmitting} className={`w-full text-white py-4 rounded-xl font-bold mt-8 shadow-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${editingTxn ? 'bg-blue-500 hover:bg-blue-600 shadow-blue-200' : 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-200'}`}>
              {isSubmitting ? <Loader2 className="animate-spin" size={20}/> : <Save size={20}/>} {isSubmitting ? 'Saving...' : editingTxn ? 'Update Transaction' : 'Log Transaction'}
            </button>
          </form>
        </div>
      )}

      <OwnerFlowModal open={ownerFlowOpen} onOpenChange={setOwnerFlowOpen} />
    </>
  );
}
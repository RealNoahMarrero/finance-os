import { format } from 'date-fns';
import { formatMoney, snapMoney } from '@/lib/money';
import { isSplitTransaction } from '@/lib/transaction-splits';
import type { Account, Category, ProjectedIncome, Transaction } from '@/lib/types';

export interface FinanceExportInput {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  projectedIncome: ProjectedIncome[];
  netWorth: number;
  liquidCash: number;
  readyToAssign: number;
  projectedReadyToAssign: number;
  pendingInflow: number;
}

function formatCategoryLabel(txn: Transaction): string {
  const splits = txn.transaction_splits || [];
  if (splits.length > 0) {
    return splits
      .map((s) => {
        const name = s.categories?.name || `Category #${s.category_id}`;
        return `${name} $${formatMoney(s.amount)}`;
      })
      .join('; ');
  }
  if (txn.categories?.name) return txn.categories.name;
  if (txn.type === 'Income') return 'Ready to Assign';
  if (txn.type === 'Expense') return 'Uncategorized';
  return '';
}

export function buildFinanceOsExportText(input: FinanceExportInput): string {
  const exportDate = format(new Date(), 'MMM d, yyyy h:mm a');
  let text = `FINANCE OS — FULL EXPORT\nGenerated: ${exportDate}\n\n`;

  text += `=== SUMMARY ===\n`;
  text += `Net Worth: $${formatMoney(input.netWorth)}\n`;
  text += `Liquid Cash: $${formatMoney(input.liquidCash)}\n`;
  text += `Ready to Assign: $${formatMoney(input.readyToAssign)}\n`;
  if (input.pendingInflow > 0) {
    text += `Pending Expected Income: $${formatMoney(input.pendingInflow)}\n`;
    text += `Projected RTA (if pending arrives): $${formatMoney(input.projectedReadyToAssign)}\n`;
  }
  text += '\n';

  text += `=== ACCOUNTS ===\n`;
  input.accounts.forEach((a) => {
    const bal = snapMoney(a.balance);
    text += `${a.name} (${a.type}): ${bal < 0 ? '-' : ''}$${formatMoney(Math.abs(bal))}`;
    if (a.type === 'Credit Card') {
      if (a.credit_limit > 0) text += ` | Limit: $${formatMoney(a.credit_limit)}`;
      const minPay = Number(a.minimum_payment) || 0;
      if (minPay > 0) text += ` | Min pay: $${formatMoney(minPay)}`;
      if (a.payment_due_day != null) text += ` | Due day: ${a.payment_due_day}`;
    }
    text += '\n';
  });
  text += '\n';

  const pending = input.projectedIncome.filter((p) => p.status === 'pending');
  const received = input.projectedIncome.filter((p) => p.status === 'received');
  const cancelled = input.projectedIncome.filter((p) => p.status === 'cancelled');

  text += `=== EXPECTED INCOME (PENDING) ===\n`;
  if (pending.length === 0) {
    text += '(none)\n\n';
  } else {
    pending.forEach((p) => {
      text += `${p.label} | $${formatMoney(p.amount)} | ${p.expected_date}`;
      text += ` | ${p.source_type}`;
      if (p.accounts?.name) text += ` | → ${p.accounts.name}`;
      if (p.categories?.name) text += ` | ${p.categories.name}`;
      text += '\n';
    });
    text += '\n';
  }

  if (received.length > 0 || cancelled.length > 0) {
    text += `=== EXPECTED INCOME (HISTORY) ===\n`;
    [...received, ...cancelled].forEach((p) => {
      text += `[${p.status}] ${p.label} | $${formatMoney(p.amount)} | ${p.expected_date}\n`;
    });
    text += '\n';
  }

  text += `=== TRANSACTIONS ===\n`;
  text += 'Date | Type | Amount | Payee | Account | Category / Split | Notes\n';
  input.transactions.forEach((txn) => {
    const acct = txn.accounts?.name || '';
    const cat = isSplitTransaction(txn) ? `SPLIT: ${formatCategoryLabel(txn)}` : formatCategoryLabel(txn);
    const amt = snapMoney(txn.amount);
    const sign = txn.type === 'Expense' ? '-' : txn.type === 'Income' ? '+' : '';
    text += `${txn.date} | ${txn.type} | ${sign}$${formatMoney(amt)} | ${txn.payee || ''} | ${acct} | ${cat} | ${txn.notes || ''}\n`;
  });
  text += '\n';

  const splitLines = input.transactions.flatMap((txn) =>
    (txn.transaction_splits || []).map((s) => ({
      txn,
      split: s,
    }))
  );
  if (splitLines.length > 0) {
    text += `=== TRANSACTION SPLITS (DETAIL) ===\n`;
    text += 'Date | Payee | Total | Category | Split Amount\n';
    splitLines.forEach(({ txn, split }) => {
      const catName = split.categories?.name || `Category #${split.category_id}`;
      text += `${txn.date} | ${txn.payee || ''} | $${formatMoney(txn.amount)} | ${catName} | $${formatMoney(split.amount)}\n`;
    });
    text += '\n';
  }

  text += `=== CATEGORIES (BUDGET) ===\n`;
  const visible = input.categories.filter((c) => !c.is_hidden);
  visible.forEach((c) => {
    text += `${c.emoji ? c.emoji + ' ' : ''}${c.name}\n`;
    text += `  Assigned: $${formatMoney(c.assigned_amount)}`;
    if (Number(c.target_amount) > 0) {
      text += ` | Goal: $${formatMoney(c.target_amount)} (${c.target_type})`;
    }
    if (c.due_date) text += ` | Due: ${c.due_date}`;
    if (c.is_debt && Number(c.balance) > 0) text += ` | Debt: $${formatMoney(c.balance)}`;
    text += '\n';
  });

  return text;
}

export function downloadTextFile(contents: string, filename: string) {
  const blob = new Blob([contents], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

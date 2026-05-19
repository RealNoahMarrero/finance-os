'use client';

import { Plus, Trash2, Tag } from 'lucide-react';
import SearchableDropdown from '@/app/components/SearchableDropdown';
import { formatMoney } from '@/lib/money';
import {
  emptySplitLine,
  sumSplitAmounts,
  splitsMatchTotal,
  type SplitFormLine,
} from '@/lib/transaction-splits';

export function SplitTransactionFields({
  totalAmount,
  lines,
  onChange,
  categories,
  txnType,
}: {
  totalAmount: string;
  lines: SplitFormLine[];
  onChange: (lines: SplitFormLine[]) => void;
  categories: { id: number; name: string; emoji: string | null }[];
  txnType: 'Expense' | 'Income';
}) {
  const splitSum = sumSplitAmounts(lines);
  const total = parseFloat(totalAmount) || 0;
  const matched = splitsMatchTotal(totalAmount, lines);
  const remaining = Math.max(0, total - splitSum);

  const categoryOptions = [
    {
      id: '',
      name: txnType === 'Income' ? 'Ready to Assign (Uncategorized)' : 'Uncategorized',
    },
    ...categories.map((c) => ({
      id: c.id,
      name: c.name,
      emoji: c.emoji ?? undefined,
      group: 'Envelopes',
    })),
  ];

  function updateLine(index: number, patch: Partial<SplitFormLine>) {
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  return (
    <div className="space-y-3 app-card-subtle p-4 rounded-2xl border border-[var(--border)]">
      <div className="flex justify-between items-center">
        <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1">
          <Tag size={12} /> Split across categories
        </p>
        <p className={`text-xs font-bold ${matched ? 'text-emerald-600' : 'text-amber-600'}`}>
          {matched ? 'Balanced' : `$${formatMoney(remaining)} left`}
        </p>
      </div>

      {lines.map((line, index) => (
        <div key={index} className="flex gap-2 items-end">
          <div className="flex-grow min-w-0">
            <SearchableDropdown
              label={index === 0 ? 'Category' : ''}
              icon={<Tag size={12} />}
              options={categoryOptions}
              value={line.category_id}
              onChange={(val) => updateLine(index, { category_id: val })}
            />
          </div>
          <div className="w-28 shrink-0">
            {index === 0 && (
              <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1 block">
                Amount
              </label>
            )}
            <div className="relative">
              <span className="absolute left-2 top-2.5 text-xs font-bold text-[var(--text-muted)]">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0"
                className="w-full pl-5 p-2 app-input rounded-lg font-bold text-sm border border-[var(--border)]"
                value={line.amount}
                onChange={(e) => updateLine(index, { amount: e.target.value })}
              />
            </div>
          </div>
          {lines.length > 2 && (
            <button
              type="button"
              onClick={() => onChange(lines.filter((_, i) => i !== index))}
              className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg mb-0.5"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...lines, emptySplitLine()])}
        className="w-full py-2 text-xs font-bold text-emerald-600 hover:bg-emerald-500/10 rounded-lg flex items-center justify-center gap-1"
      >
        <Plus size={14} /> Add split line
      </button>
    </div>
  );
}

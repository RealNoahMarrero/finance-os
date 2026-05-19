'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Save, Loader2, Tag, ArrowDownLeft } from 'lucide-react';
import SearchableDropdown from '@/app/components/SearchableDropdown';
import { ResponsiveModal } from '@/components/ui/responsive-modal';
import { Select } from '@/components/ui/select';
import { formatMoney, roundMoney } from '@/lib/money';
import { PROJECTED_INCOME_SOURCE_LABELS } from '@/lib/projected-income';
import {
  insertProjectedIncome,
  projectedIncomeErrorMessage,
  receiveProjectedIncome,
  updateProjectedIncome,
} from '@/lib/queries/projected-income';
import type {
  Account,
  Category,
  ProjectedIncome,
  ProjectedIncomePayload,
  ProjectedIncomeRepeatPeriod,
  ProjectedIncomeSourceType,
} from '@/lib/types';

type FormState = {
  label: string;
  amount: string;
  expected_date: string;
  account_id: string;
  category_id: string;
  source_type: ProjectedIncomeSourceType;
  is_repeating: boolean;
  repeat_period: ProjectedIncomeRepeatPeriod;
  notes: string;
};

function makeDefaultForm(accountId: string): FormState {
  return {
    label: '',
    amount: '',
    expected_date: format(new Date(), 'yyyy-MM-dd'),
    account_id: accountId,
    category_id: '',
    source_type: 'other',
    is_repeating: false,
    repeat_period: 'Monthly',
    notes: '',
  };
}

export function ProjectedIncomeFormModal({
  open,
  onOpenChange,
  editing,
  accounts,
  categories,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ProjectedIncome | null;
  accounts: Account[];
  categories: Pick<Category, 'id' | 'name' | 'emoji'>[];
  onSaved: () => void;
}) {
  const liquidAccounts = accounts.filter((a) =>
    ['Checking', 'Savings', 'Cash'].includes(a.type)
  );
  const defaultAccId = liquidAccounts[0] ? String(liquidAccounts[0].id) : '';

  const [form, setForm] = useState<FormState>(() => makeDefaultForm(defaultAccId));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        label: editing.label,
        amount: String(editing.amount),
        expected_date: editing.expected_date,
        account_id: String(editing.account_id),
        category_id: editing.category_id ? String(editing.category_id) : '',
        source_type: editing.source_type,
        is_repeating: editing.is_repeating,
        repeat_period:
          editing.repeat_period && editing.repeat_period !== 'None'
            ? editing.repeat_period
            : 'Monthly',
        notes: editing.notes || '',
      });
    } else {
      setForm(makeDefaultForm(defaultAccId));
    }
  }, [open, editing, defaultAccId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload: ProjectedIncomePayload = {
      label: form.label.trim(),
      amount: roundMoney(parseFloat(form.amount) || 0),
      expected_date: form.expected_date,
      account_id: Number(form.account_id),
      category_id: form.category_id ? Number(form.category_id) : null,
      source_type: form.source_type,
      is_repeating: form.is_repeating,
      repeat_period: form.is_repeating ? form.repeat_period : 'None',
      notes: form.notes.trim() || null,
    };

    const { error } = editing
      ? await updateProjectedIncome(editing.id, payload)
      : await insertProjectedIncome(payload);

    setSaving(false);
    if (!error) {
      onSaved();
      onOpenChange(false);
    } else {
      alert(projectedIncomeErrorMessage(error));
    }
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit expected income' : 'Add expected income'}
    >
      <form onSubmit={handleSubmit} className="space-y-4 pb-2">
        <div>
          <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">
            Label
          </label>
          <input
            required
            placeholder="e.g. Paycheck, Invoice #12"
            className="w-full p-3 app-input rounded-xl font-bold border border-[var(--border)]"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
        </div>

        <div>
          <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">
            Amount
          </label>
          <div className="relative">
            <span className="absolute left-4 top-3.5 font-bold text-emerald-500">$</span>
            <input
              required
              type="number"
              step="0.01"
              placeholder="0.00"
              className="w-full pl-8 p-3 app-input rounded-xl font-black text-2xl border border-[var(--border)]"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">
              Expected date
            </label>
            <input
              required
              type="date"
              className="w-full p-3 app-input rounded-xl font-bold border border-[var(--border)]"
              value={form.expected_date}
              onChange={(e) => setForm({ ...form, expected_date: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">
              Source
            </label>
            <Select
              className="w-full p-3 rounded-xl font-bold"
              value={form.source_type}
              onChange={(e) =>
                setForm({
                  ...form,
                  source_type: e.target.value as ProjectedIncomeSourceType,
                })
              }
            >
              {Object.entries(PROJECTED_INCOME_SOURCE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">
            Deposit into
          </label>
          <Select
            required
            className="w-full p-3 rounded-xl font-bold"
            value={form.account_id}
            onChange={(e) => setForm({ ...form, account_id: e.target.value })}
          >
            <option value="" disabled>
              Select account…
            </option>
            {liquidAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.type})
              </option>
            ))}
          </Select>
        </div>

        <SearchableDropdown
          label="Budget envelope (optional)"
          icon={<Tag size={14} />}
          options={[
            { id: '', name: 'Ready to Assign (Uncategorized)' },
            ...categories.map((c) => ({
              id: c.id,
              name: c.name,
              emoji: c.emoji ?? undefined,
              group: 'Envelopes',
            })),
          ]}
          value={form.category_id}
          onChange={(val) => setForm({ ...form, category_id: val })}
        />

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_repeating}
            onChange={(e) => setForm({ ...form, is_repeating: e.target.checked })}
            className="w-4 h-4 rounded"
          />
          <span className="text-sm font-bold text-[var(--text-primary)]">Repeating income</span>
        </label>

        {form.is_repeating && (
          <div>
            <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">
              Repeat
            </label>
            <Select
              className="w-full p-3 rounded-xl font-bold"
              value={form.repeat_period}
              onChange={(e) =>
                setForm({
                  ...form,
                  repeat_period: e.target.value as ProjectedIncomeRepeatPeriod,
                })
              }
            >
              <option value="Weekly">Weekly</option>
              <option value="Biweekly">Biweekly</option>
              <option value="Monthly">Monthly</option>
            </Select>
          </div>
        )}

        <div>
          <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">
            Notes (optional)
          </label>
          <textarea
            rows={2}
            className="w-full p-3 app-input rounded-xl font-bold border border-[var(--border)] resize-none"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-emerald-500 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Add expected income'}
        </button>
      </form>
    </ResponsiveModal>
  );
}

export function ProjectedIncomeReceiveModal({
  open,
  onOpenChange,
  projection,
  onReceived,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projection: ProjectedIncome | null;
  onReceived: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && projection) {
      setAmount(String(projection.amount));
      setDate(format(new Date(), 'yyyy-MM-dd'));
    }
  }, [open, projection]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projection) return;
    setSaving(true);
    const { error } = await receiveProjectedIncome(projection, {
      amount: roundMoney(parseFloat(amount) || 0),
      date,
    });
    setSaving(false);
    if (!error) {
      onReceived();
      onOpenChange(false);
    } else {
      alert('Could not mark as received.');
    }
  }

  if (!projection) return null;

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} title="Mark as received">
      <form onSubmit={handleSubmit} className="space-y-4 pb-2">
        <p className="text-sm text-[var(--text-muted)]">
          Logs an Income transaction for <strong>{projection.label}</strong>.
        </p>
        <div>
          <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">
            Amount received
          </label>
          <div className="relative">
            <span className="absolute left-4 top-3.5 font-bold text-emerald-500">$</span>
            <input
              required
              type="number"
              step="0.01"
              className="w-full pl-8 p-3 app-input rounded-xl font-black text-2xl border border-[var(--border)]"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 block">
            Date received
          </label>
          <input
            required
            type="date"
            className="w-full p-3 app-input rounded-xl font-bold border border-[var(--border)]"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="w-full bg-emerald-500 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin" size={20} /> : <ArrowDownLeft size={20} />}
          {saving ? 'Saving…' : 'Confirm received'}
        </button>
      </form>
    </ResponsiveModal>
  );
}

export function ProjectedIncomeListModal({
  open,
  onOpenChange,
  items,
  onEdit,
  onReceive,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ProjectedIncome[];
  onEdit: (item: ProjectedIncome) => void;
  onReceive: (item: ProjectedIncome) => void;
  onCancel: (id: number) => void;
}) {
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const pending = items.filter((i) => i.status === 'pending');
  const history = items.filter((i) => i.status !== 'pending');
  const list = tab === 'pending' ? pending : history;

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} title="Expected income">
      <div className="flex app-segment-track p-1 rounded-xl mb-4">
        <button
          type="button"
          onClick={() => setTab('pending')}
          className={`flex-1 py-2 rounded-lg text-sm font-bold ${tab === 'pending' ? 'app-segment-active shadow-sm' : 'text-[var(--text-muted)]'}`}
        >
          Pending ({pending.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          className={`flex-1 py-2 rounded-lg text-sm font-bold ${tab === 'history' ? 'app-segment-active shadow-sm' : 'text-[var(--text-muted)]'}`}
        >
          History
        </button>
      </div>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto pb-2">
        {list.length === 0 ? (
          <p className="text-center text-sm text-[var(--text-muted)] py-8">Nothing here yet.</p>
        ) : (
          list.map((item) => (
            <div
              key={item.id}
              className="app-card-subtle p-3 rounded-xl border border-[var(--border)]"
            >
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-[var(--text-primary)] truncate">{item.label}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {format(new Date(item.expected_date + 'T00:00:00'), 'MMM d, yyyy')}
                    {item.accounts?.name ? ` · ${item.accounts.name}` : ''}
                  </p>
                  {item.status !== 'pending' && (
                    <p className="text-[10px] font-bold uppercase text-[var(--text-muted)] mt-1">
                      {item.status}
                    </p>
                  )}
                </div>
                <p className="font-black text-emerald-600 shrink-0">+${formatMoney(item.amount)}</p>
              </div>
              {tab === 'pending' && (
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => onReceive(item)}
                    className="flex-1 py-2 text-xs font-bold bg-emerald-500 text-white rounded-lg"
                  >
                    Received
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(item)}
                    className="px-3 py-2 text-xs font-bold app-card-subtle border border-[var(--border)] rounded-lg"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onCancel(item.id)}
                    className="px-3 py-2 text-xs font-bold text-red-500 app-card-subtle border border-[var(--border)] rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </ResponsiveModal>
  );
}

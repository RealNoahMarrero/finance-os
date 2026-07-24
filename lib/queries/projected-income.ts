import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { applyBalanceAdjustment } from '@/lib/balance-adjustment';
import { roundMoney } from '@/lib/money';
import {
  advanceProjectedExpectedDate,
  clampProjectedExpectedDateToToday,
  isProjectedExpectedDateStale,
  todayDateString,
} from '@/lib/projected-income';
import type { EntityId, ProjectedIncome, ProjectedIncomePayload } from '@/lib/types';
import { fetchLastDefaultsForPayee, insertTransaction } from '@/lib/queries/transactions';

const SELECT_WITH_RELATIONS =
  '*, accounts!account_id(id, name, type), categories!category_id(name, emoji), ventures(id, name)';

function projectedIncomeErrorMessage(error: { message?: string; code?: string } | null) {
  if (!error) return 'Unknown error';
  if (error.code === '42501' || error.message?.toLowerCase().includes('row-level security')) {
    return 'Permission denied. Run supabase/migrations/003_projected_income_rls.sql in the Supabase SQL editor.';
  }
  if (
    error.message?.includes('entity_id') ||
    error.message?.includes('ventures') ||
    error.code === '42703'
  ) {
    return 'Schema outdated. Run supabase/migrations/009_entities_and_ventures.sql in the Supabase SQL editor.';
  }
  if (error.code === '42P01' || error.message?.includes('projected_income')) {
    return 'Table missing. Run supabase/migrations/001_projected_income.sql in the Supabase SQL editor.';
  }
  return error.message || 'Could not save expected income';
}

async function fetchProjectedRow(id: number) {
  const withRelations = await supabase
    .from('projected_income')
    .select(SELECT_WITH_RELATIONS)
    .eq('id', id)
    .single();

  if (!withRelations.error) return withRelations;

  return supabase.from('projected_income').select('*').eq('id', id).single();
}

async function fetchProjectedRows(
  applyFilters: (
    q: ReturnType<ReturnType<typeof supabase.from>['select']>
  ) => ReturnType<ReturnType<typeof supabase.from>['select']>
) {
  const base = supabase.from('projected_income');
  const withRelations = await applyFilters(base.select(SELECT_WITH_RELATIONS));
  if (!withRelations.error) return withRelations;
  return applyFilters(base.select('*'));
}

async function bumpStalePendingProjectedDates(entityId: EntityId) {
  const today = todayDateString();
  await supabase
    .from('projected_income')
    .update({ expected_date: today })
    .eq('entity_id', entityId)
    .eq('status', 'pending')
    .lt('expected_date', today);
}

function applyStaleDateBump(rows: ProjectedIncome[]): ProjectedIncome[] {
  const today = todayDateString();
  return rows.map((p) =>
    p.status === 'pending' && isProjectedExpectedDateStale(p.expected_date)
      ? { ...p, expected_date: today }
      : p
  );
}

function normalizeProjectedPayload(
  payload: Partial<ProjectedIncomePayload>
): Partial<ProjectedIncomePayload> {
  if (payload.expected_date == null) return payload;
  return {
    ...payload,
    expected_date: clampProjectedExpectedDateToToday(payload.expected_date),
  };
}

export async function fetchPendingProjectedIncome(entityId: EntityId) {
  await bumpStalePendingProjectedDates(entityId);
  const { data, error } = await fetchProjectedRows((q) =>
    q
      .eq('entity_id', entityId)
      .eq('status', 'pending')
      .order('expected_date', { ascending: true })
  );
  const rows = (data || []) as ProjectedIncome[];
  return { data: error ? rows : applyStaleDateBump(rows), error };
}

export async function fetchProjectedIncomeForMonth(
  entityId: EntityId,
  monthStart: string,
  monthEnd: string
) {
  await bumpStalePendingProjectedDates(entityId);
  const { data, error } = await fetchProjectedRows((q) =>
    q
      .eq('entity_id', entityId)
      .eq('status', 'pending')
      .gte('expected_date', monthStart)
      .lte('expected_date', monthEnd)
      .order('expected_date', { ascending: true })
  );
  const rows = (data || []) as ProjectedIncome[];
  return { data: error ? rows : applyStaleDateBump(rows), error };
}

export async function fetchAllProjectedIncome(entityId: EntityId, limit = 100) {
  const { data, error } = await fetchProjectedRows((q) =>
    q
      .eq('entity_id', entityId)
      .order('expected_date', { ascending: false })
      .limit(limit)
  );
  return { data: (data || []) as ProjectedIncome[], error };
}

export async function insertProjectedIncome(payload: ProjectedIncomePayload) {
  const normalized = normalizeProjectedPayload(payload) as ProjectedIncomePayload;
  const { data: row, error: insertError } = await supabase
    .from('projected_income')
    .insert([normalized])
    .select('id')
    .single();

  if (insertError) return { data: null, error: insertError };

  return fetchProjectedRow(row.id);
}

export async function updateProjectedIncome(
  id: number,
  payload: Partial<ProjectedIncomePayload>
) {
  const normalized = normalizeProjectedPayload(payload);
  const { error: updateError } = await supabase
    .from('projected_income')
    .update(normalized)
    .eq('id', id);

  if (updateError) return { data: null, error: updateError };

  return fetchProjectedRow(id);
}

export async function cancelProjectedIncome(id: number) {
  const { error: updateError } = await supabase
    .from('projected_income')
    .update({ status: 'cancelled' })
    .eq('id', id);

  if (updateError) return { data: null, error: updateError };

  return fetchProjectedRow(id);
}

export { projectedIncomeErrorMessage };

export interface ReceiveProjectedIncomeOptions {
  amount?: number;
  date?: string;
}

export async function receiveProjectedIncome(
  projection: ProjectedIncome,
  options: ReceiveProjectedIncomeOptions = {}
) {
  const amount = roundMoney(options.amount ?? projection.amount);
  const date = options.date ?? format(new Date(), 'yyyy-MM-dd');

  const txnPayload = {
    date,
    amount,
    payee: projection.label,
    category_id: projection.category_id,
    account_id: projection.account_id,
    to_account_id: null as number | null,
    type: 'Income' as const,
    notes: projection.notes,
    entity_id: projection.entity_id,
    venture_id: projection.venture_id ?? null,
  };

  const { data: txn, error: txnError } = await insertTransaction(txnPayload);
  if (txnError || !txn) {
    return { data: null, error: txnError };
  }

  await applyBalanceAdjustment(
    {
      amount: txn.amount,
      type: 'Income',
      account_id: txn.account_id,
      category_id: txn.category_id,
    },
    'apply'
  );

  const { data: updated, error: updateError } = await supabase
    .from('projected_income')
    .update({
      status: 'received',
      transaction_id: txn.id,
      received_at: new Date().toISOString(),
    })
    .eq('id', projection.id)
    .select('id')
    .single();

  if (updateError || !updated) {
    return { data: null, error: updateError };
  }

  const { data: fullProjection, error: fetchError } = await fetchProjectedRow(projection.id);
  if (fetchError) {
    return { data: null, error: fetchError };
  }

  if (
    projection.is_repeating &&
    projection.repeat_period &&
    projection.repeat_period !== 'None'
  ) {
    const nextPayload: ProjectedIncomePayload = {
      label: projection.label,
      amount: projection.amount,
      expected_date: clampProjectedExpectedDateToToday(
        advanceProjectedExpectedDate(
          projection.expected_date,
          projection.repeat_period
        )
      ),
      account_id: projection.account_id,
      category_id: projection.category_id,
      source_type: projection.source_type,
      certainty: projection.certainty ?? 'guaranteed',
      is_repeating: projection.is_repeating,
      repeat_period: projection.repeat_period,
      notes: projection.notes,
      entity_id: projection.entity_id,
      venture_id: projection.venture_id ?? null,
    };
    await insertProjectedIncome(nextPayload);
  }

  return {
    data: { projection: fullProjection as ProjectedIncome, transaction: txn },
    error: null,
  };
}

/** Last expected-income (or Income txn) defaults for a label within entity. */
export async function fetchLastDefaultsForProjectedLabel(
  entityId: EntityId,
  label: string
): Promise<{ categoryId: string; accountId: string; ventureId: string } | null> {
  if (!label.trim()) return null;

  const { data } = await supabase
    .from('projected_income')
    .select('category_id, account_id, venture_id')
    .eq('entity_id', entityId)
    .eq('label', label)
    .order('expected_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);

  const row = data?.[0];
  if (row?.account_id) {
    return {
      categoryId: row.category_id != null ? String(row.category_id) : '',
      accountId: String(row.account_id),
      ventureId: row.venture_id != null ? String(row.venture_id) : '',
    };
  }

  return fetchLastDefaultsForPayee(entityId, label, 'Income');
}

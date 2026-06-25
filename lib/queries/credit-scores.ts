import { supabase } from '@/lib/supabase';
import type { CreditScoreEntry, CreditScorePayload } from '@/lib/types';

function creditScoreErrorMessage(error: { message?: string; code?: string } | null) {
  if (!error) return 'Unknown error';
  if (error.code === '42501' || error.message?.toLowerCase().includes('row-level security')) {
    return 'Permission denied. Run supabase/migrations/008_credit_scores.sql in the Supabase SQL editor.';
  }
  if (error.code === '42P01' || error.message?.includes('credit_score_entries')) {
    return 'Table missing. Run supabase/migrations/008_credit_scores.sql in the Supabase SQL editor.';
  }
  return error.message || 'Could not save credit score';
}

export { creditScoreErrorMessage };

export async function fetchAllCreditScoreEntries() {
  const { data, error } = await supabase
    .from('credit_score_entries')
    .select('*')
    .order('recorded_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('fetchAllCreditScoreEntries', error);
    return { data: [] as CreditScoreEntry[], error };
  }
  return { data: (data ?? []) as CreditScoreEntry[], error: null };
}

export async function insertCreditScoreEntry(payload: CreditScorePayload) {
  const { data, error } = await supabase
    .from('credit_score_entries')
    .insert(payload)
    .select('*')
    .single();

  if (error) return { data: null, error: creditScoreErrorMessage(error) };
  return { data: data as CreditScoreEntry, error: null };
}

export async function insertCreditScoreBatch(payloads: CreditScorePayload[]) {
  if (payloads.length === 0) return { data: [] as CreditScoreEntry[], error: null };

  const { data, error } = await supabase
    .from('credit_score_entries')
    .insert(payloads)
    .select('*');

  if (error) return { data: null, error: creditScoreErrorMessage(error) };
  return { data: (data ?? []) as CreditScoreEntry[], error: null };
}

export async function updateCreditScoreEntry(id: number, payload: Partial<CreditScorePayload>) {
  const { data, error } = await supabase
    .from('credit_score_entries')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return { data: null, error: creditScoreErrorMessage(error) };
  return { data: data as CreditScoreEntry, error: null };
}

export async function deleteCreditScoreEntry(id: number) {
  const { error } = await supabase.from('credit_score_entries').delete().eq('id', id);
  if (error) return { error: creditScoreErrorMessage(error) };
  return { error: null };
}

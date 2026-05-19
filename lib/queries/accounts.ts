import { supabase } from '@/lib/supabase';
import type { Account } from '@/lib/types';

export async function fetchAccounts() {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .order('type')
    .order('name');
  return { data: (data || []) as Account[], error };
}

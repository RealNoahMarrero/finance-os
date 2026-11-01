import { supabase } from '@/lib/supabase';
import type { Account, EntityId } from '@/lib/types';

export async function fetchAccounts(entityId: EntityId) {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('entity_id', entityId)
    .order('type')
    .order('name');
  return { data: (data || []) as Account[], error };
}

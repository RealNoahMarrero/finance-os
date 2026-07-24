import { supabase } from '@/lib/supabase';
import type { Category, CategoryGroup, EntityId } from '@/lib/types';

export async function fetchCategoryGroups(entityId: EntityId) {
  const { data, error } = await supabase
    .from('category_groups')
    .select('*')
    .eq('entity_id', entityId)
    .order('sort_order', { ascending: true })
    .order('id');
  return { data: (data || []) as CategoryGroup[], error };
}

export async function fetchCategories(entityId: EntityId) {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('entity_id', entityId)
    .order('sort_order', { ascending: true })
    .order('id');
  return { data: (data || []) as Category[], error };
}

export async function fetchCategoriesForCalendar(entityId: EntityId) {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('entity_id', entityId)
    .eq('is_hidden', false)
    .not('due_date', 'is', null);
  return { data: (data || []) as Category[], error };
}

export async function fetchDebtCategories(entityId: EntityId) {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('entity_id', entityId)
    .eq('is_debt', true)
    .gt('balance', 0);
  return { data: (data || []) as Category[], error };
}

import { supabase } from '@/lib/supabase';
import type { Category, CategoryGroup } from '@/lib/types';

export async function fetchCategoryGroups() {
  const { data, error } = await supabase
    .from('category_groups')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('id');
  return { data: (data || []) as CategoryGroup[], error };
}

export async function fetchCategories() {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('id');
  return { data: (data || []) as Category[], error };
}

export async function fetchCategoriesForCalendar() {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('is_hidden', false)
    .not('due_date', 'is', null);
  return { data: (data || []) as Category[], error };
}

export async function fetchDebtCategories() {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('is_debt', true)
    .gt('balance', 0);
  return { data: (data || []) as Category[], error };
}

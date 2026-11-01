import { supabase } from '@/lib/supabase';
import type { EntityId, Venture } from '@/lib/types';

export type VenturePayload = {
  name: string;
  notes?: string | null;
  color?: string | null;
  is_active?: boolean;
  sort_order?: number;
};

export async function fetchVentures(entityId: EntityId, activeOnly = true) {
  let query = supabase
    .from('ventures')
    .select('*')
    .eq('entity_id', entityId)
    .order('sort_order', { ascending: true })
    .order('id');

  if (activeOnly) query = query.eq('is_active', true);

  const { data, error } = await query;
  return { data: (data || []) as Venture[], error };
}

export async function insertVenture(entityId: EntityId, payload: VenturePayload) {
  return supabase
    .from('ventures')
    .insert([
      {
        entity_id: entityId,
        name: payload.name.trim(),
        notes: payload.notes ?? null,
        color: payload.color ?? null,
        is_active: payload.is_active ?? true,
        sort_order: payload.sort_order ?? 0,
      },
    ])
    .select('*')
    .single();
}

export async function updateVenture(id: number, payload: Partial<VenturePayload>) {
  const next: Record<string, unknown> = {};
  if (payload.name != null) next.name = payload.name.trim();
  if (payload.notes !== undefined) next.notes = payload.notes;
  if (payload.color !== undefined) next.color = payload.color;
  if (payload.is_active !== undefined) next.is_active = payload.is_active;
  if (payload.sort_order !== undefined) next.sort_order = payload.sort_order;

  return supabase.from('ventures').update(next).eq('id', id).select('*').single();
}

export async function archiveVenture(id: number) {
  return updateVenture(id, { is_active: false });
}

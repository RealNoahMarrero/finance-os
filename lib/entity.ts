import type { EntityId } from '@/lib/types';

export const ENTITY_STORAGE_KEY = 'finance_os_entity';

export const ENTITY_IDS: EntityId[] = ['personal', 'business'];

export const ENTITY_LABELS: Record<EntityId, string> = {
  personal: 'Personal',
  business: 'Business',
};

export function isEntityId(value: unknown): value is EntityId {
  return value === 'personal' || value === 'business';
}

export function readStoredEntityId(): EntityId {
  if (typeof window === 'undefined') return 'personal';
  try {
    const raw = localStorage.getItem(ENTITY_STORAGE_KEY);
    if (isEntityId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return 'personal';
}

export function writeStoredEntityId(entityId: EntityId) {
  try {
    localStorage.setItem(ENTITY_STORAGE_KEY, entityId);
  } catch {
    /* ignore */
  }
}

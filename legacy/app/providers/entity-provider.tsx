'use client';

import * as React from 'react';
import {
  ENTITY_LABELS,
  readStoredEntityId,
  writeStoredEntityId,
} from '@/lib/entity';
import type { EntityId } from '@/lib/types';

type EntityContextValue = {
  entityId: EntityId;
  entityLabel: string;
  isBusiness: boolean;
  setEntityId: (id: EntityId) => void;
  toggleEntity: () => void;
};

const EntityContext = React.createContext<EntityContextValue | null>(null);

function applyEntityAttr(entityId: EntityId) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-entity', entityId);
}

export function EntityProvider({ children }: { children: React.ReactNode }) {
  const [entityId, setEntityIdState] = React.useState<EntityId>('personal');
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    const stored = readStoredEntityId();
    setEntityIdState(stored);
    applyEntityAttr(stored);
    setReady(true);
  }, []);

  const setEntityId = React.useCallback((id: EntityId) => {
    setEntityIdState(id);
    writeStoredEntityId(id);
    applyEntityAttr(id);
  }, []);

  const toggleEntity = React.useCallback(() => {
    setEntityId(entityId === 'personal' ? 'business' : 'personal');
  }, [entityId, setEntityId]);

  const value = React.useMemo<EntityContextValue>(
    () => ({
      entityId,
      entityLabel: ENTITY_LABELS[entityId],
      isBusiness: entityId === 'business',
      setEntityId,
      toggleEntity,
    }),
    [entityId, setEntityId, toggleEntity]
  );

  // Avoid flashing wrong entity on first paint after hydration
  if (!ready) {
    return (
      <EntityContext.Provider value={value}>{children}</EntityContext.Provider>
    );
  }

  return <EntityContext.Provider value={value}>{children}</EntityContext.Provider>;
}

export function useEntity() {
  const ctx = React.useContext(EntityContext);
  if (!ctx) {
    throw new Error('useEntity must be used within EntityProvider');
  }
  return ctx;
}

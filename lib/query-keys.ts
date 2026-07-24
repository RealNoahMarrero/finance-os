import type { EntityId } from '@/lib/types';

export const financeKeys = {
  all: ['finance'] as const,
  entity: (entityId: EntityId) => [...financeKeys.all, entityId] as const,
  accounts: (entityId: EntityId) =>
    [...financeKeys.entity(entityId), 'accounts'] as const,
  categories: (entityId: EntityId) =>
    [...financeKeys.entity(entityId), 'categories'] as const,
  categoryGroups: (entityId: EntityId) =>
    [...financeKeys.entity(entityId), 'categoryGroups'] as const,
  transactions: (entityId: EntityId) =>
    [...financeKeys.entity(entityId), 'transactions'] as const,
  recentTransactions: (entityId: EntityId, limit: number) =>
    [...financeKeys.entity(entityId), 'transactions', 'recent', limit] as const,
  monthTransactions: (entityId: EntityId, monthStart: string) =>
    [...financeKeys.entity(entityId), 'transactions', 'month', monthStart] as const,
  debtCategories: (entityId: EntityId) =>
    [...financeKeys.entity(entityId), 'debtCategories'] as const,
  calendarBills: (entityId: EntityId) =>
    [...financeKeys.entity(entityId), 'calendarBills'] as const,
  pendingProjected: (entityId: EntityId) =>
    [...financeKeys.entity(entityId), 'projected', 'pending'] as const,
  allProjected: (entityId: EntityId) =>
    [...financeKeys.entity(entityId), 'projected', 'all'] as const,
  projectedMonth: (entityId: EntityId, monthStart: string, monthEnd: string) =>
    [
      ...financeKeys.entity(entityId),
      'projected',
      'month',
      monthStart,
      monthEnd,
    ] as const,
  projected: (entityId: EntityId) =>
    [...financeKeys.entity(entityId), 'projected'] as const,
  ventures: (entityId: EntityId) =>
    [...financeKeys.entity(entityId), 'ventures'] as const,
  attachments: (entityId: EntityId, transactionId: number) =>
    [...financeKeys.entity(entityId), 'attachments', transactionId] as const,
};

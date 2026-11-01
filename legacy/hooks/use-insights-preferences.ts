'use client';

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import type { ReportPeriod } from '@/lib/reports/aggregations';
import type { PayoffStrategy } from '@/lib/reports/debt-simulator';

export type InsightsTab = 'overview' | 'spending' | 'income' | 'debt';
export type SpendingView = 'groups' | 'categories';

export interface InsightsPreferences {
  period: ReportPeriod;
  selectedMonth: string;
  activeTab: InsightsTab;
  extraPayment: string;
  strategy: PayoffStrategy;
  spendingView: SpendingView;
  selectedGroupId: number | 'all';
  expandedGroupIds: number[];
}

const STORAGE_KEY = 'finance_os_insights_prefs';

const DEFAULTS: InsightsPreferences = {
  period: '12mo',
  selectedMonth: format(new Date(), 'yyyy-MM'),
  activeTab: 'overview',
  extraPayment: '',
  strategy: 'snowball',
  spendingView: 'groups',
  selectedGroupId: 'all',
  expandedGroupIds: [],
};

function isReportPeriod(v: unknown): v is ReportPeriod {
  return (
    v === '30d' ||
    v === '90d' ||
    v === 'ytd' ||
    v === '12mo' ||
    v === 'month'
  );
}

function isInsightsTab(v: unknown): v is InsightsTab {
  return v === 'overview' || v === 'spending' || v === 'income' || v === 'debt';
}

function isSpendingView(v: unknown): v is SpendingView {
  return v === 'groups' || v === 'categories';
}

function isStrategy(v: unknown): v is PayoffStrategy {
  return v === 'snowball' || v === 'avalanche';
}

export function loadInsightsPreferences(): InsightsPreferences {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<InsightsPreferences>;
    return {
      period: isReportPeriod(parsed.period) ? parsed.period : DEFAULTS.period,
      selectedMonth:
        typeof parsed.selectedMonth === 'string' && /^\d{4}-\d{2}$/.test(parsed.selectedMonth)
          ? parsed.selectedMonth
          : DEFAULTS.selectedMonth,
      activeTab: isInsightsTab(parsed.activeTab) ? parsed.activeTab : DEFAULTS.activeTab,
      extraPayment:
        typeof parsed.extraPayment === 'string' ? parsed.extraPayment : DEFAULTS.extraPayment,
      strategy: isStrategy(parsed.strategy) ? parsed.strategy : DEFAULTS.strategy,
      spendingView: isSpendingView(parsed.spendingView)
        ? parsed.spendingView
        : DEFAULTS.spendingView,
      selectedGroupId:
        parsed.selectedGroupId === 'all' ||
        (typeof parsed.selectedGroupId === 'number' && Number.isFinite(parsed.selectedGroupId))
          ? parsed.selectedGroupId
          : DEFAULTS.selectedGroupId,
      expandedGroupIds: Array.isArray(parsed.expandedGroupIds)
        ? parsed.expandedGroupIds.filter((id) => typeof id === 'number')
        : DEFAULTS.expandedGroupIds,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveInsightsPreferences(prefs: InsightsPreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota / private mode */
  }
}

export function useInsightsPreferences() {
  const [prefs, setPrefs] = useState<InsightsPreferences>(() => loadInsightsPreferences());

  useEffect(() => {
    saveInsightsPreferences(prefs);
  }, [prefs]);

  const patch = useCallback((partial: Partial<InsightsPreferences>) => {
    setPrefs((prev) => ({ ...prev, ...partial }));
  }, []);

  return { prefs, patch };
}

export function hasStoredInsightsPreferences(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STORAGE_KEY) != null;
}

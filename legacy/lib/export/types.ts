import { getPeriodRange, type ReportPeriod } from '@/lib/reports/aggregations';
import type { InsightsExportInput } from '@/lib/reports/build-insights-export';

export type ExportFormat = 'txt' | 'csv';

export type ExportPreset = 'full' | 'insights' | 'budget' | 'transactions';

export interface ExportSections {
  summary: boolean;
  accounts: boolean;
  categories: boolean;
  transactions: boolean;
  splitDetails: boolean;
  projectedIncome: boolean;
}

export interface ExportFilters {
  dateStart: string | null;
  dateEnd: string | null;
  includeHiddenCategories: boolean;
  includeCancelledProjected: boolean;
  projectedCertainty: 'all' | 'guaranteed' | 'anticipated';
}

export interface ExportOptions {
  format: ExportFormat;
  preset: ExportPreset;
  sections: ExportSections;
  filters: ExportFilters;
}

export interface ExportModalPreset {
  id: ExportPreset;
  label: string;
  defaults: Partial<ExportOptions>;
}

export interface InsightsExportContext {
  input: InsightsExportInput;
  periodLabel: string;
}

export const EXPORT_PRESETS: ExportModalPreset[] = [
  {
    id: 'full',
    label: 'Full backup',
    defaults: {
      preset: 'full',
      sections: {
        summary: true,
        accounts: true,
        categories: true,
        transactions: true,
        splitDetails: true,
        projectedIncome: true,
      },
      filters: {
        dateStart: null,
        dateEnd: null,
        includeHiddenCategories: false,
        includeCancelledProjected: false,
        projectedCertainty: 'all',
      },
    },
  },
  {
    id: 'insights',
    label: 'Insights report',
    defaults: {
      preset: 'insights',
      sections: {
        summary: true,
        accounts: false,
        categories: false,
        transactions: false,
        splitDetails: false,
        projectedIncome: false,
      },
    },
  },
  {
    id: 'budget',
    label: 'Budget snapshot',
    defaults: {
      preset: 'budget',
      sections: {
        summary: true,
        accounts: false,
        categories: true,
        transactions: false,
        splitDetails: false,
        projectedIncome: true,
      },
    },
  },
  {
    id: 'transactions',
    label: 'Transactions',
    defaults: {
      preset: 'transactions',
      sections: {
        summary: false,
        accounts: false,
        categories: false,
        transactions: true,
        splitDetails: true,
        projectedIncome: false,
      },
    },
  },
];

export function defaultExportOptions(
  preset: ExportPreset = 'full',
  insightsPeriod?: { period: ReportPeriod; monthKey?: string }
): ExportOptions {
  const presetDef = EXPORT_PRESETS.find((p) => p.id === preset) ?? EXPORT_PRESETS[0];
  const base: ExportOptions = {
    format: 'txt',
    preset,
    sections: {
      summary: true,
      accounts: true,
      categories: true,
      transactions: true,
      splitDetails: true,
      projectedIncome: true,
    },
    filters: {
      dateStart: null,
      dateEnd: null,
      includeHiddenCategories: false,
      includeCancelledProjected: false,
      projectedCertainty: 'all',
    },
  };
  const merged = {
    ...base,
    ...presetDef.defaults,
    sections: { ...base.sections, ...presetDef.defaults.sections },
    filters: { ...base.filters, ...presetDef.defaults.filters },
  };
  if (insightsPeriod && preset === 'insights') {
    const range = getPeriodRange(insightsPeriod.period, insightsPeriod.monthKey);
    merged.filters.dateStart = range.start;
    merged.filters.dateEnd = range.end;
  }
  return merged;
}

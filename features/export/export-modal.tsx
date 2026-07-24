'use client';

import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { ResponsiveModal } from '@/components/ui/responsive-modal';
import { downloadFinanceExport } from '@/lib/export/run-export';
import { formatCurrency } from '@/lib/money';
import {
  defaultExportOptions,
  EXPORT_PRESETS,
  type ExportFormat,
  type ExportOptions,
  type ExportPreset,
  type InsightsExportContext,
} from '@/lib/export/types';
import { loadInsightsPreferences } from '@/hooks/use-insights-preferences';
import { loadInsightsExportContext } from '@/lib/reports/insights-export-context';
import type { ReportPeriod } from '@/lib/reports/aggregations';
import { useEntity } from '@/app/providers/entity-provider';

export function ExportModal({
  open,
  onOpenChange,
  initialPreset = 'full',
  insightsContext: insightsContextProp,
  insightsPeriod,
  insightsPage = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPreset?: ExportPreset;
  /** Pre-built report data (Insights page — matches on-screen filters). */
  insightsContext?: InsightsExportContext;
  insightsPeriod?: { period: ReportPeriod; monthKey?: string };
  /** Insights page: Insights report preset only. */
  insightsPage?: boolean;
}) {
  const { entityId } = useEntity();
  const insightsPrefs = loadInsightsPreferences();
  const resolvedPeriod = insightsPeriod ?? {
    period: insightsPrefs.period,
    monthKey: insightsPrefs.selectedMonth,
  };
  const [options, setOptions] = useState<ExportOptions>(() =>
    defaultExportOptions(initialPreset, resolvedPeriod)
  );
  const [exporting, setExporting] = useState(false);
  const [insightsContext, setInsightsContext] = useState<InsightsExportContext | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const effectiveInsightsContext = insightsContextProp ?? insightsContext;

  useEffect(() => {
    if (open) {
      const period =
        insightsPeriod ??
        (() => {
          const prefs = loadInsightsPreferences();
          return { period: prefs.period, monthKey: prefs.selectedMonth };
        })();
      setOptions(defaultExportOptions(initialPreset, period));
    }
  }, [open, initialPreset, insightsPeriod?.period, insightsPeriod?.monthKey]);

  useEffect(() => {
    if (!open || options.preset !== 'insights' || insightsContextProp) {
      setInsightsContext(null);
      setInsightsLoading(false);
      return;
    }
    let cancelled = false;
    setInsightsLoading(true);
    const prefs = loadInsightsPreferences();
    loadInsightsExportContext(prefs.period, prefs.selectedMonth, entityId)
      .then((ctx) => {
        if (!cancelled) setInsightsContext(ctx);
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setInsightsContext(null);
      })
      .finally(() => {
        if (!cancelled) setInsightsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, options.preset, options.filters.dateStart, options.filters.dateEnd, insightsContextProp, entityId]);

  function setPreset(preset: ExportPreset) {
    const period =
      insightsPeriod ??
      (() => {
        const prefs = loadInsightsPreferences();
        return { period: prefs.period, monthKey: prefs.selectedMonth };
      })();
    setOptions(defaultExportOptions(preset, period));
  }

  function toggleSection(key: keyof ExportOptions['sections']) {
    setOptions((o) => ({
      ...o,
      sections: { ...o.sections, [key]: !o.sections[key] },
    }));
  }

  async function handleExport() {
    setExporting(true);
    try {
      await downloadFinanceExport(
        options,
        options.preset === 'insights' ? effectiveInsightsContext ?? undefined : undefined,
        entityId
      );
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      alert('Export failed. Please try again.');
    }
    setExporting(false);
  }

  const isInsightsExport = options.preset === 'insights';
  const showInsightsPreview = isInsightsExport && !!effectiveInsightsContext;

  if (!open) return null;

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange} title="Export data">
      <div className="space-y-5 pb-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Preset
          </p>
          <div className="flex flex-wrap gap-2">
            {(insightsPage
              ? EXPORT_PRESETS.filter((p) => p.id === 'insights')
              : EXPORT_PRESETS
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={`min-h-9 rounded-xl px-3 text-xs font-bold touch-manipulation ${
                  options.preset === p.id
                    ? 'bg-[var(--text-primary)] text-[var(--canvas)]'
                    : 'glass-card text-[var(--text-muted)]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Format
          </p>
          <div className="flex gap-2">
            {(['txt', 'csv'] as ExportFormat[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setOptions((o) => ({ ...o, format: f }))}
                className={`flex-1 min-h-10 rounded-xl text-sm font-bold uppercase ${
                  options.format === f
                    ? 'bg-[var(--text-primary)] text-[var(--canvas)]'
                    : 'glass-card text-[var(--text-muted)]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {!isInsightsExport && (
          <>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                Include
              </p>
              <div className="space-y-2">
                {(
                  [
                    ['summary', 'Summary & RTA'],
                    ['accounts', 'Accounts'],
                    ['categories', 'Categories / budget'],
                    ['transactions', 'Transactions'],
                    ['splitDetails', 'Split detail lines'],
                    ['projectedIncome', 'Expected income'],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-3 cursor-pointer app-card-subtle p-3 rounded-xl border border-[var(--border)]"
                  >
                    <input
                      type="checkbox"
                      checked={options.sections[key]}
                      onChange={() => toggleSection(key)}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm font-bold text-[var(--text-primary)]">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {options.preset !== 'budget' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase text-[var(--text-muted)] mb-1 block">
                    From date
                  </label>
                  <input
                    type="date"
                    className="w-full p-2.5 app-input rounded-lg text-sm font-bold border border-[var(--border)]"
                    value={options.filters.dateStart ?? ''}
                    onChange={(e) =>
                      setOptions((o) => ({
                        ...o,
                        filters: {
                          ...o.filters,
                          dateStart: e.target.value || null,
                        },
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-[var(--text-muted)] mb-1 block">
                    To date
                  </label>
                  <input
                    type="date"
                    className="w-full p-2.5 app-input rounded-lg text-sm font-bold border border-[var(--border)]"
                    value={options.filters.dateEnd ?? ''}
                    onChange={(e) =>
                      setOptions((o) => ({
                        ...o,
                        filters: {
                          ...o.filters,
                          dateEnd: e.target.value || null,
                        },
                      }))
                    }
                  />
                </div>
              </div>
            )}

            {options.sections.projectedIncome && (
              <div>
                <label className="text-[10px] font-bold uppercase text-[var(--text-muted)] mb-1 block">
                  Expected income
                </label>
                <select
                  className="w-full p-2.5 app-input rounded-lg text-sm font-bold border border-[var(--border)]"
                  value={options.filters.projectedCertainty}
                  onChange={(e) =>
                    setOptions((o) => ({
                      ...o,
                      filters: {
                        ...o.filters,
                        projectedCertainty: e.target.value as ExportOptions['filters']['projectedCertainty'],
                      },
                    }))
                  }
                >
                  <option value="all">All pending</option>
                  <option value="guaranteed">Guaranteed only</option>
                  <option value="anticipated">Anticipated only</option>
                </select>
              </div>
            )}

            <label className="flex items-center gap-3 cursor-pointer text-sm font-bold">
              <input
                type="checkbox"
                checked={options.filters.includeHiddenCategories}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    filters: { ...o.filters, includeHiddenCategories: e.target.checked },
                  }))
                }
                className="w-4 h-4 rounded"
              />
              Include hidden categories
            </label>
            <label className="flex items-center gap-3 cursor-pointer text-sm font-bold">
              <input
                type="checkbox"
                checked={options.filters.includeCancelledProjected}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    filters: {
                      ...o.filters,
                      includeCancelledProjected: e.target.checked,
                    },
                  }))
                }
                className="w-4 h-4 rounded"
              />
              Include cancelled expected income
            </label>
          </>
        )}

        {isInsightsExport && (
          <p className="text-sm text-[var(--text-muted)]">
            {insightsPage
              ? 'Exports the report for the period and filters shown on this page.'
              : 'Insights report uses your saved Insights filters (30D / 90D / YTD / 12M / Month).'}
          </p>
        )}

        {isInsightsExport && insightsLoading && !insightsContextProp && (
          <div className="app-card-subtle rounded-2xl border border-[var(--border)] p-4 flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <Loader2 className="animate-spin" size={16} />
            Loading report preview…
          </div>
        )}

        {showInsightsPreview && effectiveInsightsContext && (
          <div className="app-card-subtle rounded-2xl border border-[var(--border)] p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Report preview
            </p>
            <p className="text-sm font-bold text-[var(--text-primary)]">
              {effectiveInsightsContext.input.range.label}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {effectiveInsightsContext.input.range.start} →{' '}
              {effectiveInsightsContext.input.range.end}
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-[var(--surface-subtle)] p-2">
                <p className="text-[10px] font-bold text-[var(--text-muted)]">Income</p>
                <p className="text-sm font-black text-emerald-600">
                  {formatCurrency(effectiveInsightsContext.input.totals.income)}
                </p>
              </div>
              <div className="rounded-xl bg-[var(--surface-subtle)] p-2">
                <p className="text-[10px] font-bold text-[var(--text-muted)]">Expenses</p>
                <p className="text-sm font-black text-red-500">
                  {formatCurrency(effectiveInsightsContext.input.totals.expense)}
                </p>
              </div>
              <div className="rounded-xl bg-[var(--surface-subtle)] p-2">
                <p className="text-[10px] font-bold text-[var(--text-muted)]">Net</p>
                <p className="text-sm font-black text-[var(--text-primary)]">
                  {formatCurrency(effectiveInsightsContext.input.totals.net)}
                </p>
              </div>
            </div>
            <ul className="text-xs font-bold text-[var(--text-muted)] space-y-1">
              <li>· {effectiveInsightsContext.input.cashflow.length} month(s) cashflow</li>
              <li>· {effectiveInsightsContext.input.spending.length} spending categories</li>
              <li>· {effectiveInsightsContext.input.groups.length} category groups</li>
              <li>· {effectiveInsightsContext.input.income.length} income categories</li>
              <li>· {effectiveInsightsContext.input.topPayees.length} top payees</li>
            </ul>
          </div>
        )}

        <button
          type="button"
          disabled={
            exporting || (isInsightsExport && insightsLoading && !insightsContextProp)
          }
          onClick={handleExport}
          className="w-full bg-emerald-500 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {exporting ? (
            <Loader2 className="animate-spin" size={20} />
          ) : (
            <Download size={20} />
          )}
          {exporting ? 'Exporting…' : 'Download export'}
        </button>
      </div>
    </ResponsiveModal>
  );
}

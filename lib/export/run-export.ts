import { format } from 'date-fns';
import { formatMoney } from '@/lib/money';
import { isSplitTransaction } from '@/lib/transaction-splits';
import {
  computeLiquidCash,
  computeNetWorth,
  computeReadyToAssign,
  computeTotalAllocated,
} from '@/lib/reports/aggregations';
import {
  computePendingInflowBreakdown,
  computeProjectedPlanning,
  PROJECTED_INCOME_CERTAINTY_LABELS,
} from '@/lib/projected-income';
import { fetchAccounts } from '@/lib/queries/accounts';
import { fetchCategories, fetchCategoryGroups } from '@/lib/queries/categories';
import { fetchAllProjectedIncome } from '@/lib/queries/projected-income';
import { fetchTransactions } from '@/lib/queries/transactions';
import { buildFinanceOsExportText } from '@/lib/export/build-finance-export';
import {
  buildInsightsExportCsv,
  buildInsightsExportText,
} from '@/lib/reports/build-insights-export';
import { loadInsightsExportContext } from '@/lib/reports/insights-export-context';
import { csvRow, csvSection } from '@/lib/export/csv';
import { downloadTextFile } from '@/lib/export/build-finance-export';
import type { ExportOptions, InsightsExportContext } from '@/lib/export/types';
import type { Category, ProjectedIncome, Transaction } from '@/lib/types';

function filterProjected(
  rows: ProjectedIncome[],
  filters: ExportOptions['filters']
) {
  return rows.filter((p) => {
    if (!filters.includeCancelledProjected && p.status === 'cancelled') return false;
    if (filters.projectedCertainty === 'all') return true;
    const tier = p.certainty === 'anticipated' ? 'anticipated' : 'guaranteed';
    return tier === filters.projectedCertainty;
  });
}

function filterTransactions(txns: Transaction[], filters: ExportOptions['filters']) {
  return txns.filter((t) => {
    if (filters.dateStart && t.date < filters.dateStart) return false;
    if (filters.dateEnd && t.date > filters.dateEnd) return false;
    return true;
  });
}

function formatCategoryLabel(txn: Transaction): string {
  const splits = txn.transaction_splits || [];
  if (splits.length > 0) {
    return splits
      .map((s) => {
        const name = s.categories?.name || `Category #${s.category_id}`;
        return `${name} $${formatMoney(s.amount)}`;
      })
      .join('; ');
  }
  if (txn.categories?.name) return txn.categories.name;
  if (txn.type === 'Income') return 'Ready to Assign';
  if (txn.type === 'Expense') return 'Uncategorized';
  return '';
}

async function loadExportData() {
  const [accs, cats, groups, txns, proj] = await Promise.all([
    fetchAccounts(),
    fetchCategories(),
    fetchCategoryGroups(),
    fetchTransactions(),
    fetchAllProjectedIncome(500),
  ]);
  return {
    accounts: accs.data || [],
    categories: cats.data || [],
    groups: groups.data || [],
    transactions: txns.data || [],
    projectedIncome: proj.data || [],
  };
}

function buildCsvExport(
  options: ExportOptions,
  data: Awaited<ReturnType<typeof loadExportData>>
): string {
  const sections: string[] = [];
  const generated = format(new Date(), 'yyyy-MM-dd HH:mm');
  sections.push(csvRow(['Finance OS Export', generated, options.preset]));

  const visibleCats = data.categories.filter(
    (c) => options.filters.includeHiddenCategories || !c.is_hidden
  );
  const txns = filterTransactions(data.transactions, options.filters);
  const proj = filterProjected(data.projectedIncome, options.filters);
  const liquidCash = computeLiquidCash(data.accounts);
  const netWorth = computeNetWorth(data.accounts);
  const readyToAssign = computeReadyToAssign(liquidCash, data.categories);
  const pending = proj.filter((p) => p.status === 'pending');
  const inflow = computePendingInflowBreakdown(pending, data.accounts);
  const assigned = computeTotalAllocated(data.categories);
  const { projectedReadyToAssign } = computeProjectedPlanning(
    liquidCash,
    assigned,
    inflow.total
  );
  const { projectedReadyToAssign: conservativeRta } = computeProjectedPlanning(
    liquidCash,
    assigned,
    inflow.guaranteed
  );

  if (options.sections.summary) {
    sections.push('');
    sections.push(
      csvSection('SUMMARY', csvRow(['Metric', 'Value']).split(','), [
        csvRow(['Net Worth', netWorth]).split(','),
        csvRow(['Liquid Cash', liquidCash]).split(','),
        csvRow(['Ready to Assign', readyToAssign]).split(','),
        csvRow(['Pending Income (Total)', inflow.total]).split(','),
        csvRow(['Pending Income (Guaranteed)', inflow.guaranteed]).split(','),
        csvRow(['Pending Income (Anticipated)', inflow.anticipated]).split(','),
        csvRow(['Projected RTA (All Pending)', projectedReadyToAssign]).split(','),
        csvRow(['Projected RTA (Guaranteed Only)', conservativeRta]).split(','),
      ])
    );
  }

  if (options.sections.accounts) {
    sections.push('');
    sections.push(
      csvSection(
        'ACCOUNTS',
        ['Name', 'Type', 'Balance', 'Credit Limit', 'Min Payment', 'Due Day'].map(String),
        data.accounts.map((a) =>
          csvRow([
            a.name,
            a.type,
            a.balance,
            a.type === 'Credit Card' ? a.credit_limit : '',
            a.type === 'Credit Card' ? a.minimum_payment : '',
            a.payment_due_day ?? '',
          ]).split(',')
        )
      )
    );
  }

  if (options.sections.projectedIncome) {
    sections.push('');
    sections.push(
      csvSection(
        'EXPECTED_INCOME',
        [
          'Label',
          'Amount',
          'Expected Date',
          'Status',
          'Certainty',
          'Source',
          'Account',
          'Category',
          'Repeating',
        ],
        proj.map((p) =>
          csvRow([
            p.label,
            p.amount,
            p.expected_date,
            p.status,
            PROJECTED_INCOME_CERTAINTY_LABELS[p.certainty ?? 'guaranteed'],
            p.source_type,
            p.accounts?.name ?? '',
            p.categories?.name ?? '',
            p.is_repeating ? p.repeat_period : 'No',
          ]).split(',')
        )
      )
    );
  }

  if (options.sections.categories) {
    const groupMap = Object.fromEntries(data.groups.map((g) => [g.id, g.name]));
    sections.push('');
    sections.push(
      csvSection(
        'CATEGORIES',
        ['Group', 'Name', 'Available', 'Budgeted', 'Goal', 'Due Date', 'Is Debt', 'Debt Balance'],
        visibleCats.map((c) =>
          csvRow([
            groupMap[c.group_id] || '',
            c.name,
            c.assigned_amount,
            c.budgeted_amount ?? 0,
            c.target_amount,
            c.due_date ?? '',
            c.is_debt ? 'Yes' : 'No',
            c.is_debt ? c.balance : '',
          ]).split(',')
        )
      )
    );
  }

  if (options.sections.transactions) {
    sections.push('');
    sections.push(
      csvSection(
        'TRANSACTIONS',
        ['Date', 'Type', 'Amount', 'Payee', 'Account', 'Category', 'Is Split', 'Notes'],
        txns.map((txn) =>
          csvRow([
            txn.date,
            txn.type,
            txn.amount,
            txn.payee ?? '',
            txn.accounts?.name ?? '',
            formatCategoryLabel(txn),
            isSplitTransaction(txn) ? 'Yes' : 'No',
            txn.notes ?? '',
          ]).split(',')
        )
      )
    );
  }

  if (options.sections.splitDetails) {
    const splitRows = txns.flatMap((txn) =>
      (txn.transaction_splits || []).map((s) => ({ txn, split: s }))
    );
    if (splitRows.length > 0) {
      sections.push('');
      sections.push(
        csvSection(
          'TRANSACTION_SPLITS',
          ['Date', 'Payee', 'Total', 'Category', 'Split Amount'],
          splitRows.map(({ txn, split }) =>
            csvRow([
              txn.date,
              txn.payee ?? '',
              txn.amount,
              split.categories?.name || split.category_id,
              split.amount,
            ]).split(',')
          )
        )
      );
    }
  }

  return sections.join('\n');
}

function buildBudgetCsv(
  data: Awaited<ReturnType<typeof loadExportData>>,
  liquidCash: number,
  readyToAssign: number,
  inflow: ReturnType<typeof computePendingInflowBreakdown>,
  projectedRta: number,
  conservativeRta: number
) {
  const visibleCats = data.categories.filter((c) => !c.is_hidden);
  const groupMap = Object.fromEntries(data.groups.map((g) => [g.id, g.name]));
  const lines = [
    csvRow(['Finance OS Budget Export', format(new Date(), 'yyyy-MM-dd')]),
    '',
    csvRow(['Liquid Cash', liquidCash]),
    csvRow(['Ready to Assign', readyToAssign]),
    csvRow(['Pending Guaranteed', inflow.guaranteed]),
    csvRow(['Pending Anticipated', inflow.anticipated]),
    csvRow(['Projected RTA (All)', projectedRta]),
    csvRow(['Projected RTA (Guaranteed)', conservativeRta]),
    '',
    csvSection(
      'ENVELOPES',
      ['Group', 'Category', 'Available', 'Budgeted', 'Goal', 'Due Date'],
      visibleCats.map((c) =>
        csvRow([
          groupMap[c.group_id] || '',
          c.name,
          c.assigned_amount,
          c.budgeted_amount ?? 0,
          c.target_amount,
          c.due_date ?? '',
        ]).split(',')
      )
    ),
  ];
  return lines.join('\n');
}

export async function runFinanceExport(
  options: ExportOptions,
  insights?: InsightsExportContext
): Promise<{ filename: string; mime: string; content: string }> {
  const data = await loadExportData();
  const liquidCash = computeLiquidCash(data.accounts);
  const netWorth = computeNetWorth(data.accounts);
  const readyToAssign = computeReadyToAssign(liquidCash, data.categories);
  const pending = filterProjected(
    data.projectedIncome.filter((p) => p.status === 'pending'),
    options.filters
  );
  const inflow = computePendingInflowBreakdown(pending, data.accounts);
  const assigned = computeTotalAllocated(data.categories);
  const { projectedReadyToAssign } = computeProjectedPlanning(
    liquidCash,
    assigned,
    inflow.total
  );
  const { projectedReadyToAssign: conservativeRta } = computeProjectedPlanning(
    liquidCash,
    assigned,
    inflow.guaranteed
  );

  const dateSlug = format(new Date(), 'yyyy-MM-dd');

  if (options.preset === 'insights') {
    const ctx = insights ?? (await loadInsightsExportContext());
    if (options.format === 'csv') {
      return {
        filename: `finance-os-insights-${dateSlug}.csv`,
        mime: 'text/csv;charset=utf-8',
        content: buildInsightsExportCsv(ctx.input),
      };
    }
    return {
      filename: `finance-os-insights-${dateSlug}.txt`,
      mime: 'text/plain;charset=utf-8',
      content: buildInsightsExportText(ctx.input),
    };
  }

  if (options.format === 'csv') {
    let content: string;
    if (options.preset === 'budget') {
      content = buildBudgetCsv(
        data,
        liquidCash,
        readyToAssign,
        inflow,
        projectedReadyToAssign,
        conservativeRta
      );
    } else {
      content = buildCsvExport(options, data);
    }
    return {
      filename: `finance-os-${options.preset}-${dateSlug}.csv`,
      mime: 'text/csv;charset=utf-8',
      content: '\uFEFF' + content,
    };
  }

  const filteredTxns = filterTransactions(data.transactions, options.filters);
  const filteredProj = filterProjected(data.projectedIncome, options.filters);

  let content = buildFinanceOsExportText({
    accounts: options.sections.accounts ? data.accounts : [],
    categories: options.sections.categories
      ? data.categories.filter(
          (c) => options.filters.includeHiddenCategories || !c.is_hidden
        )
      : [],
    transactions: options.sections.transactions ? filteredTxns : [],
    projectedIncome: options.sections.projectedIncome ? filteredProj : [],
    netWorth,
    liquidCash,
    readyToAssign,
    projectedReadyToAssign,
    pendingInflow: inflow.total,
    guaranteedInflow: inflow.guaranteed,
    anticipatedInflow: inflow.anticipated,
    conservativeProjectedRta: conservativeRta,
  });

  if (options.preset === 'budget') {
    const visibleCats = data.categories.filter((c) => !c.is_hidden);
    const groupMap = Object.fromEntries(data.groups.map((g) => [g.id, g.name]));
    let text = `FINANCE OS — BUDGET EXPORT\nGenerated: ${format(new Date(), 'MMM d, yyyy')}\n\n`;
    text += `Liquid Cash: $${formatMoney(liquidCash)}\n`;
    text += `Ready to Assign: $${formatMoney(readyToAssign)}\n`;
    if (inflow.total > 0) {
      text += `Pending (Guaranteed): $${formatMoney(inflow.guaranteed)}\n`;
      text += `Pending (Anticipated): $${formatMoney(inflow.anticipated)}\n`;
      text += `Projected RTA (all pending): $${formatMoney(projectedReadyToAssign)}\n`;
      text += `Projected RTA (guaranteed only): $${formatMoney(conservativeRta)}\n`;
    }
    text += '\n';
    data.groups.forEach((g) => {
      const groupCats = visibleCats.filter((c) => c.group_id === g.id);
      if (groupCats.length === 0) return;
      text += `--- ${g.name.toUpperCase()} ---\n`;
      groupCats.forEach((c) => {
        text += `${c.emoji ? c.emoji + ' ' : ''}${c.name}: $${formatMoney(c.assigned_amount)} available | $${formatMoney(c.budgeted_amount ?? 0)} budgeted\n`;
      });
      text += '\n';
    });
    content = text;
  }

  if (options.preset === 'transactions') {
    let text = `FINANCE OS — TRANSACTIONS\nGenerated: ${format(new Date(), 'MMM d, yyyy')}\n`;
    if (options.filters.dateStart || options.filters.dateEnd) {
      text += `Range: ${options.filters.dateStart ?? '…'} to ${options.filters.dateEnd ?? '…'}\n`;
    }
    text += '\nDate | Type | Amount | Payee | Account | Category\n';
    filteredTxns.forEach((txn) => {
      const sign = txn.type === 'Expense' ? '-' : txn.type === 'Income' ? '+' : '';
      text += `${txn.date} | ${txn.type} | ${sign}$${formatMoney(txn.amount)} | ${txn.payee || ''} | ${txn.accounts?.name || ''} | ${formatCategoryLabel(txn)}\n`;
    });
    content = text;
  }

  return {
    filename: `finance-os-${options.preset}-${dateSlug}.txt`,
    mime: 'text/plain',
    content,
  };
}

export async function downloadFinanceExport(
  options: ExportOptions,
  insights?: InsightsExportContext
) {
  const { filename, content, mime } = await runFinanceExport(options, insights);
  downloadTextFile(content, filename, mime);
}

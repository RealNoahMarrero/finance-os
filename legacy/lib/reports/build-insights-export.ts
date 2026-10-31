import { format } from 'date-fns';
import { formatMoney } from '@/lib/money';
import { csvRow } from '@/lib/export/csv';
import type {
  CategorySpend,
  GroupSpend,
  MonthlyCashflow,
  PayeeSpend,
  PeriodRange,
  PeriodTotals,
} from '@/lib/reports/aggregations';

export interface InsightsExportInput {
  range: PeriodRange;
  totals: PeriodTotals;
  cashflow: MonthlyCashflow[];
  spending: CategorySpend[];
  income: CategorySpend[];
  groups: GroupSpend[];
  topPayees: PayeeSpend[];
  topIncomeSources: PayeeSpend[];
  netWorth: number;
  liquidCash: number;
  readyToAssign: number;
}

export function buildInsightsExportText(input: InsightsExportInput): string {
  const generated = format(new Date(), 'MMM d, yyyy h:mm a');
  let text = `FINANCE OS — INSIGHTS EXPORT\nGenerated: ${generated}\n`;
  text += `Period: ${input.range.label} (${input.range.start} to ${input.range.end})\n\n`;

  text += `=== SUMMARY ===\n`;
  text += `Income: $${formatMoney(input.totals.income)}\n`;
  text += `Expenses: $${formatMoney(input.totals.expense)}\n`;
  text += `Net: $${formatMoney(input.totals.net)}\n`;
  text += `Net Worth: $${formatMoney(input.netWorth)}\n`;
  text += `Liquid Cash: $${formatMoney(input.liquidCash)}\n`;
  text += `Ready to Assign: $${formatMoney(input.readyToAssign)}\n\n`;

  text += `=== MONTHLY CASHFLOW ===\n`;
  if (input.cashflow.length === 0) {
    text += '(no activity)\n\n';
  } else {
    input.cashflow.forEach((m) => {
      text += `${m.month} | Income: $${formatMoney(m.income)} | Expense: $${formatMoney(m.expense)} | Net: $${formatMoney(m.income - m.expense)}\n`;
    });
    text += '\n';
  }

  text += `=== SPENDING BY CATEGORY ===\n`;
  input.spending.forEach((s) => {
    text += `${s.emoji ? s.emoji + ' ' : ''}${s.name}: $${formatMoney(s.total)}\n`;
  });
  text += '\n';

  text += `=== SPENDING BY CATEGORY GROUP ===\n`;
  input.groups.forEach((g) => {
    text += `${g.name}: $${formatMoney(g.total)}\n`;
  });
  text += '\n';

  text += `=== INCOME BY CATEGORY ===\n`;
  input.income.forEach((s) => {
    text += `${s.emoji ? s.emoji + ' ' : ''}${s.name}: $${formatMoney(s.total)}\n`;
  });
  text += '\n';

  text += `=== TOP EXPENSE PAYEES ===\n`;
  input.topPayees.forEach((p) => {
    text += `${p.payee}: $${formatMoney(p.total)}\n`;
  });
  text += '\n';

  text += `=== TOP INCOME SOURCES ===\n`;
  input.topIncomeSources.forEach((p) => {
    text += `${p.payee}: $${formatMoney(p.total)}\n`;
  });

  return text;
}

function insightsCsvBlock(title: string, headers: string[], rows: (string | number)[][]) {
  const lines = [`# ${title}`, csvRow(headers), ...rows.map((r) => csvRow(r)), ''];
  return lines.join('\n');
}

export function buildInsightsExportCsv(input: InsightsExportInput): string {
  const generated = format(new Date(), 'yyyy-MM-dd HH:mm');
  const blocks: string[] = [
    csvRow(['Finance OS Insights Export', generated]),
    csvRow(['Period', input.range.label, input.range.start, input.range.end]),
    '',
    insightsCsvBlock('SUMMARY', ['Metric', 'Amount'], [
      ['Income', input.totals.income],
      ['Expenses', input.totals.expense],
      ['Net', input.totals.net],
      ['Net Worth', input.netWorth],
      ['Liquid Cash', input.liquidCash],
      ['Ready to Assign', input.readyToAssign],
    ]),
  ];

  if (input.cashflow.length > 0) {
    blocks.push(
      insightsCsvBlock(
        'MONTHLY_CASHFLOW',
        ['Month', 'Income', 'Expense', 'Net'],
        input.cashflow.map((m) => [
          m.month,
          m.income,
          m.expense,
          m.income - m.expense,
        ])
      )
    );
  }

  if (input.spending.length > 0) {
    blocks.push(
      insightsCsvBlock(
        'SPENDING_BY_CATEGORY',
        ['Category', 'Amount'],
        input.spending.map((s) => [
          `${s.emoji ? s.emoji + ' ' : ''}${s.name}`,
          s.total,
        ])
      )
    );
  }

  if (input.groups.length > 0) {
    blocks.push(
      insightsCsvBlock(
        'SPENDING_BY_GROUP',
        ['Group', 'Amount'],
        input.groups.map((g) => [g.name, g.total])
      )
    );
  }

  if (input.income.length > 0) {
    blocks.push(
      insightsCsvBlock(
        'INCOME_BY_CATEGORY',
        ['Category', 'Amount'],
        input.income.map((s) => [
          `${s.emoji ? s.emoji + ' ' : ''}${s.name}`,
          s.total,
        ])
      )
    );
  }

  if (input.topPayees.length > 0) {
    blocks.push(
      insightsCsvBlock(
        'TOP_PAYEES',
        ['Payee', 'Amount'],
        input.topPayees.map((p) => [p.payee, p.total])
      )
    );
  }

  if (input.topIncomeSources.length > 0) {
    blocks.push(
      insightsCsvBlock(
        'TOP_INCOME_SOURCES',
        ['Source', 'Amount'],
        input.topIncomeSources.map((p) => [p.payee, p.total])
      )
    );
  }

  return '\uFEFF' + blocks.join('\n');
}

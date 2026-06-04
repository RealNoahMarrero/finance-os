/** Escape a value for CSV (RFC-style, quoted when needed). */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(',');
}

export function csvSection(title: string, headerRow: string[], dataRows: string[][]): string {
  const lines = [`# ${title}`, headerRow.join(',')];
  dataRows.forEach((row) => lines.push(row.join(',')));
  return lines.join('\n');
}

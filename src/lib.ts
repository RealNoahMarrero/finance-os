// Formatting + date helpers. All money is integer cents.


const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayISO = () => iso(new Date());
export const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const diffDays = (a: string, b: string) => Math.round((parse(a).getTime() - parse(b).getTime()) / 86400000); // a - b
export const monthKey = (s: string) => s.slice(0, 7);
export const daysInMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};
export const monthShift = (key: string, n: number) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1, 12);
  return iso(d).slice(0, 7);
};
export const monthLabel = (key: string, long = false) => {
  const [y, m] = key.split('-').map(Number);
  return long ? `${MONTHS_LONG[m - 1]} ${y}` : MONTHS[m - 1];
};
export const fmtDate = (s: string, style: 'short' | 'long' | 'day' | 'dow' = 'short') => {
  const d = parse(s);
  if (style === 'day') return String(d.getDate());
  if (style === 'dow') return DOW[d.getDay()];
  if (style === 'long') return `${DOW[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
export const mon = (s: string) => MONTHS[parse(s).getMonth()];
export const relDay = (s: string, today = todayISO()) => {
  const n = diffDays(s, today);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1) return `In ${n} days`;
  return `${-n} days ago`;
};
export const dayHeading = (s: string, today = todayISO()) => {
  const n = diffDays(s, today);
  if (n === 0) return 'Today';
  if (n === -1) return 'Yesterday';
  return `${DOW[parse(s).getDay()]}, ${fmtDate(s)}`;
};

const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const money = (c: number, opts: { sign?: boolean; cents?: boolean } = {}) => {
  const abs = Math.abs(c) / 100;
  const body = opts.cents === false ? nf0.format(Math.round(abs)) : nf.format(abs);
  const s = c < 0 ? '−' : opts.sign && c > 0 ? '+' : '';
  return `${s}$${body}`;
};
export const compact = (c: number) => {
  const a = Math.abs(c) / 100;
  const s = c < 0 ? '−' : '';
  if (a >= 10000) return `${s}$${Math.round(a / 1000)}k`;
  if (a >= 1000) return `${s}$${(a / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${s}$${Math.round(a)}`;
};
export const toCents = (s: string) => {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
export const centsToInput = (c: number) => (Math.abs(c) / 100).toFixed(2);
export const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
export const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
export const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');
export const plural = (n: number, w: string, p = w + 's') => `${n} ${n === 1 ? w : p}`;

// SYNTHETIC demo dataset. Invented people/places/amounts only - never real financial records.
const TODAY = '2026-11-10';
const d = (n) => { const x = new Date(2026, 10, 10, 12); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const P = 'personal';
const accounts = [
  { id: 1, name: 'Everyday Checking', type: 'Checking', balance: 4820.15, credit_limit: 0, entity_id: P },
  { id: 2, name: 'High-Yield Savings', type: 'Savings', balance: 2400, credit_limit: 0, entity_id: P },
  { id: 3, name: 'Cash Wallet', type: 'Cash', balance: 140, credit_limit: 0, entity_id: P },
  { id: 4, name: 'Rewards Visa', type: 'Credit Card', balance: 1240.5, credit_limit: 8000, payment_category_id: 6, entity_id: P },
  { id: 5, name: 'Travel Card', type: 'Credit Card', balance: 3900, credit_limit: 5000, entity_id: P },
  { id: 6, name: 'Old Savings', type: 'Savings', balance: 0, credit_limit: 0, entity_id: P, is_archived: true },
];
const groups = [
  { id: 1, name: 'Bills & Subscriptions', sort_order: 1, entity_id: P }, { id: 2, name: 'Needs', sort_order: 2, entity_id: P },
  { id: 3, name: 'Wants', sort_order: 3, entity_id: P }, { id: 4, name: 'Goals', sort_order: 4, entity_id: P },
];
const cat = (id, group_id, name, emoji, target, assigned, extra = {}) => ({ id, group_id, name, emoji, target_amount: target, assigned_amount: assigned, is_hidden: false, bill_paused: false, bill_archived: false, is_debt: false, balance: 0, due_date: null, is_repeating: false, target_period: 'Monthly', bill_mode: 'reminder', sort_order: id, entity_id: P, ...extra });
const categories = [
  cat(1, 1, 'Rent', 'home', 1500, 1500, { due_date: '2026-12-01', is_repeating: true, bill_anchor: '2026-12-01' }),
  cat(2, 1, 'Electric', 'zap', 120, 80, { due_date: d(4), is_repeating: true, bill_amount: 118.4 }),
  cat(3, 1, 'Phone', 'phone', 85, 85, { due_date: d(12), is_repeating: true }),
  cat(4, 1, 'Streaming', 'tv', 30, 0, { due_date: d(-14), is_repeating: true, bill_mode: 'prepare' }),
  cat(5, 1, 'Car Loan', 'car', 320, 320, { is_debt: true, balance: 8400, due_date: d(-44), is_repeating: true, bill_mode: 'prepare' }),
  cat(6, 1, 'Rewards Visa payment', 'card', 0, 600),
  cat(7, 2, 'Groceries', 'cart', 600, 210), cat(8, 2, 'Gas', 'fuel', 150, -35),
  cat(9, 3, 'Dining Out', 'utensils', 200, 55), cat(10, 4, 'Vacation Fund', 'plane', 250, 900),
  cat(11, 3, 'Old Gym', '', 0, -45, { is_hidden: true }),
  cat(12, 1, 'Old Internet', 'wifi', 60, 0, { bill_archived: true, bill_paused: true, due_date: d(-60), is_repeating: true }),
];
let tid = 100; const txns = []; const splits = [];
const tx = (date, payee, amount, type, account_id, category_id, extra = {}) => { txns.push({ id: ++tid, date, payee, amount, type, account_id, category_id: category_id ?? null, to_account_id: null, notes: null, is_adjustment: false, entity_id: P, ...extra }); return tid; };
const spend = [['Trader Joe’s', 7, 62.4], ['Shell', 8, 41.2], ['Chipotle', 9, 14.8], ['Whole Foods', 7, 88.15], ['Costco', 7, 140.0], ['Sushi Palace', 9, 56.0], ['Chevron', 8, 52.3], ['Safeway', 7, 47.9]];
for (let i = 0; i < 44; i++) { const [p, c, a] = spend[i % spend.length]; tx(d(-i * 1.6 | 0), p, +(a + (i % 5)).toFixed(2), 'Expense', i % 3 === 0 ? 4 : 1, c); }
tx(d(-3), 'Acme Payroll', 2410.0, 'Income', 1, null); tx(d(-17), 'Acme Payroll', 2410.0, 'Income', 1, null); tx(d(-31), 'Acme Payroll', 2410.0, 'Income', 1, null);
const rentTx = tx(d(-9), 'Landlord LLC', 1500, 'Expense', 1, 1);
const phoneTx = tx(d(-19), 'Phone Co', 85, 'Expense', 1, 3);
tx(d(-5), 'Transfer to Rewards Visa', 600, 'Transfer', 1, 6, { to_account_id: 4 });
tx(d(-12), 'Transfer to High-Yield Savings', 400, 'Transfer', 1, null, { to_account_id: 2 });
const big = tx(d(-2), 'Target', 120, 'Expense', 4, 7); splits.push({ id: 1, transaction_id: big, category_id: 7, amount: 80, sort_order: 1 }, { id: 2, transaction_id: big, category_id: 9, amount: 40, sort_order: 2 });
tx(d(-9), 'Reconciliation adjustment', 12.35, 'Expense', 1, null, { is_adjustment: true });
const income = [
  { id: 1, label: 'Acme Payroll', amount: 2410, expected_date: d(3), status: 'pending', certainty: 'guaranteed', is_repeating: true, repeat_period: 'Biweekly', account_id: 1, entity_id: P },
  { id: 2, label: 'Freelance invoice', amount: 900, expected_date: d(10), status: 'pending', certainty: 'anticipated', is_repeating: false, repeat_period: 'None', account_id: 1, entity_id: P },
  { id: 3, label: 'Client refund', amount: 150, expected_date: d(-5), status: 'pending', certainty: 'anticipated', is_repeating: false, repeat_period: 'None', account_id: 1, entity_id: P },
];
const baselines = [{ id: 1, account_id: 1, cutover_date: '2026-10-31', opening_balance: 4000, superseded_at: null }, { id: 2, account_id: 2, cutover_date: '2026-10-31', opening_balance: 2000, superseded_at: null }, { id: 3, account_id: 4, cutover_date: '2026-10-31', opening_balance: 1000, superseded_at: null }];
const recons = [{ id: 1, account_id: 1, reconciled_on: d(-9), recorded_balance: 4832.5, actual_balance: 4820.15, difference: -12.35, adjustment_transaction_id: null }];
const billPayments = [{ id: 1, category_id: 1, due_date: '2026-11-01', paid_on: d(-9), amount: 1500, transaction_id: rentTx, mode: 'prepare' }, { id: 2, category_id: 3, due_date: d(-19), paid_on: d(-19), amount: 85, transaction_id: phoneTx, mode: 'prepare' }];
const audit = [{ account_id: 1, derived_balance: 4801.1 }, { account_id: 2, derived_balance: 2400 }, { account_id: 4, derived_balance: 1240.5 }];
const creditScores = [{ id: 1, bureau: 'Experian', score: 742, model: 'FICO 8', observed_on: d(-40) }, { id: 2, bureau: 'Experian', score: 751, model: 'FICO 8', observed_on: d(-8) }, { id: 3, bureau: 'Equifax', score: 738, model: 'VantageScore 3.0', observed_on: d(-8) }];
const tables = { accounts, category_groups: groups, categories, transactions: txns, transaction_splits: splits, projected_income: income, account_baselines: baselines, account_reconciliations: recons, bill_payments: billPayments, account_balance_audit: audit, credit_scores: creditScores, credit_card_meta: [{ account_id: 4, active: true, statement_closing_date: d(6), statement_repeats: true }], credit_reported_balances: [{ id: 1, account_id: 4, balance: 980, reported_on: d(-20), bureau: 'Experian' }] };
export const TODAY_FIXED = TODAY;
export { tables };

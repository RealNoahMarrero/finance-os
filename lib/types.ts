export type AccountType = 'Checking' | 'Savings' | 'Credit Card' | 'Cash';
export type TransactionType = 'Income' | 'Expense' | 'Transfer';

export interface Account {
  id: number;
  created_at?: string;
  name: string;
  type: AccountType;
  balance: number;
  credit_limit: number;
  minimum_payment: number;
  payment_due_day: number | null;
  next_payment_due_date: string | null;
  payment_category_id: number | null;
}

export interface CategoryGroup {
  id: number;
  name: string;
  sort_order: number;
}

export interface Category {
  id: number;
  group_id: number;
  name: string;
  emoji: string | null;
  target_type: string;
  target_amount: number;
  target_period: string;
  due_date: string | null;
  is_repeating: boolean;
  end_date: string | null;
  notes: string | null;
  is_debt: boolean;
  balance: number;
  is_asap: boolean;
  /** Envelope available balance (budgeted minus activity). Can go negative when overspent. */
  assigned_amount: number;
  /** YNAB-style assigned amount from RTA; unchanged by spending. */
  budgeted_amount: number;
  sort_order: number;
  is_hidden: boolean;
}

export interface TransactionSplit {
  id?: number;
  transaction_id?: number;
  category_id: number;
  amount: number;
  sort_order?: number;
  categories?: { name: string; emoji: string | null } | null;
}

export interface Transaction {
  id: number;
  created_at?: string;
  date: string;
  amount: number;
  payee: string | null;
  category_id: number | null;
  account_id: number;
  to_account_id: number | null;
  type: TransactionType;
  notes: string | null;
  categories?: { name: string; emoji: string | null } | null;
  accounts?: { name: string; type: AccountType } | null;
  transaction_splits?: TransactionSplit[];
}

export interface TransactionPayload {
  date: string;
  amount: number;
  payee: string | null;
  category_id: number | null;
  account_id: number;
  to_account_id: number | null;
  type: TransactionType;
  notes: string | null;
}

export type ProjectedIncomeStatus = 'pending' | 'received' | 'cancelled';
export type ProjectedIncomeSourceType =
  | 'paycheck'
  | 'gig'
  | 'invoice'
  | 'transfer_in'
  | 'other';
export type ProjectedIncomeCertainty = 'guaranteed' | 'anticipated';
export type ProjectedIncomeRepeatPeriod = 'None' | 'Weekly' | 'Biweekly' | 'Monthly';

export interface ProjectedIncome {
  id: number;
  created_at?: string;
  label: string;
  amount: number;
  expected_date: string;
  account_id: number;
  category_id: number | null;
  status: ProjectedIncomeStatus;
  source_type: ProjectedIncomeSourceType;
  certainty: ProjectedIncomeCertainty;
  is_repeating: boolean;
  repeat_period: ProjectedIncomeRepeatPeriod;
  notes: string | null;
  transaction_id: number | null;
  received_at: string | null;
  accounts?: { id: number; name: string; type: string } | null;
  categories?: { name: string; emoji: string | null } | null;
}

export interface ProjectedIncomePayload {
  label: string;
  amount: number;
  expected_date: string;
  account_id: number;
  category_id: number | null;
  source_type: ProjectedIncomeSourceType;
  certainty: ProjectedIncomeCertainty;
  is_repeating: boolean;
  repeat_period: ProjectedIncomeRepeatPeriod;
  notes: string | null;
}

export type CreditScorePerson = 'me' | 'teria';
export type CreditScoreProvider = 'experian' | 'credit_karma' | 'chase' | 'capital_one';
export type CreditScoreVariant = '1' | '2' | '3' | 'transunion' | 'equifax';

export interface CreditScoreEntry {
  id: number;
  created_at?: string;
  person: CreditScorePerson;
  provider: CreditScoreProvider;
  variant: CreditScoreVariant | null;
  score: number;
  recorded_date: string;
  notes: string | null;
}

export interface CreditScorePayload {
  person: CreditScorePerson;
  provider: CreditScoreProvider;
  variant: CreditScoreVariant | null;
  score: number;
  recorded_date: string;
  notes: string | null;
}

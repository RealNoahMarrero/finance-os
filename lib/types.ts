export type EntityId = 'personal' | 'business';
export type AccountType = 'Checking' | 'Savings' | 'Credit Card' | 'Cash';
export type TransactionType = 'Income' | 'Expense' | 'Transfer';
export type OwnerFlow = 'owner_draw' | 'owner_contribution';

export interface Entity {
  id: EntityId;
  name: string;
  sort_order: number;
  created_at?: string;
}

export interface Venture {
  id: number;
  entity_id: EntityId;
  name: string;
  notes: string | null;
  color: string | null;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
}

export interface Account {
  id: number;
  created_at?: string;
  name: string;
  type: AccountType;
  balance: number;
  credit_limit: number;
  entity_id: EntityId;
}

export interface CategoryGroup {
  id: number;
  name: string;
  sort_order: number;
  entity_id: EntityId;
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
  entity_id: EntityId;
  venture_id: number | null;
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
  entity_id: EntityId;
  venture_id: number | null;
  linked_transaction_id: number | null;
  owner_flow: OwnerFlow | null;
  categories?: { name: string; emoji: string | null } | null;
  accounts?: { name: string; type: AccountType } | null;
  ventures?: { id: number; name: string } | null;
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
  entity_id: EntityId;
  venture_id?: number | null;
  linked_transaction_id?: number | null;
  owner_flow?: OwnerFlow | null;
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
  entity_id: EntityId;
  venture_id: number | null;
  accounts?: { id: number; name: string; type: string } | null;
  categories?: { name: string; emoji: string | null } | null;
  ventures?: { id: number; name: string } | null;
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
  entity_id: EntityId;
  venture_id?: number | null;
}

export interface TransactionAttachment {
  id: number;
  transaction_id: number;
  entity_id: EntityId;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  created_at?: string;
}

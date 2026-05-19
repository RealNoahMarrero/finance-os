export type AccountType = 'Checking' | 'Savings' | 'Credit Card' | 'Cash';
export type TransactionType = 'Income' | 'Expense' | 'Transfer';

export interface Account {
  id: number;
  created_at?: string;
  name: string;
  type: AccountType;
  balance: number;
  credit_limit: number;
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
  assigned_amount: number;
  sort_order: number;
  is_hidden: boolean;
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

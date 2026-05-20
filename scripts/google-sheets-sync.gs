/**
 * Finance OS → Google Sheets sync (Apps Script)
 *
 * Setup:
 * 1. Extensions → Apps Script — paste this file
 * 2. Set SUPABASE_URL and SUPABASE_KEY below (Project Settings → API → anon/publishable key)
 * 3. Create sheets: Accounts, Transactions, Categories, ExpectedIncome, TransactionSplits
 * 4. Reload spreadsheet — Finance OS menu → Sync Latest Data
 *
 * Do NOT commit real API keys to git.
 */

const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY';

function syncFinanceOS() {
  syncAccounts();
  syncCategories();
  syncTransactions();
  syncTransactionSplits();
  syncProjectedIncome();
  SpreadsheetApp.getActiveSpreadsheet().toast('Finance OS sync complete.', 'Finance OS', 5);
}

function supabaseHeaders_() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
  };
}

function supabaseGet_(path) {
  const url = SUPABASE_URL + '/rest/v1/' + path;
  const response = UrlFetchApp.fetch(url, { headers: supabaseHeaders_() });
  return JSON.parse(response.getContentText());
}

function getOrCreateSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  sheet.clear();
  sheet.appendRow(headers);
  return sheet;
}

function syncAccounts() {
  const data = supabaseGet_('accounts?select=name,type,balance,credit_limit&order=type');

  const sheet = getOrCreateSheet_( 'Accounts', [
    'Account Name', 'Type', 'Balance', 'Credit Limit',
  ]);

  const rows = data.map(function (acc) {
    return [acc.name, acc.type, acc.balance, acc.credit_limit || 0];
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function syncCategories() {
  const data = supabaseGet_(
    'categories?select=name,target_amount,assigned_amount,is_debt,balance,due_date,is_repeating,target_period&is_hidden=eq.false&order=name'
  );

  const sheet = getOrCreateSheet_( 'Categories', [
    'Category Name',
    'Target Goal',
    'Available Cash',
    'Is Debt?',
    'Total Debt Owed',
    'Due Date',
    'Repeating',
    'Period',
  ]);

  const rows = data.map(function (cat) {
    return [
      cat.name,
      cat.target_amount,
      cat.assigned_amount,
      cat.is_debt ? 'Yes' : 'No',
      cat.balance,
      cat.due_date || '',
      cat.is_repeating ? 'Yes' : 'No',
      cat.target_period || '',
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function syncTransactions() {
  const data = supabaseGet_(
    'transactions?select=id,date,type,amount,payee,notes,category_id,' +
      'accounts!account_id(name),categories!category_id(name),' +
      'transaction_splits(amount,categories!category_id(name))' +
      '&order=date.desc'
  );

  const sheet = getOrCreateSheet_( 'Transactions', [
    'Date',
    'Type',
    'Amount',
    'Payee',
    'Account',
    'Category',
    'Is Split',
    'Split Detail',
    'Notes',
  ]);

  const rows = data.map(function (txn) {
    const splits = txn.transaction_splits || [];
    const isSplit = splits.length > 0;
    let category = txn.categories ? txn.categories.name : '';
    let splitDetail = '';

    if (isSplit) {
      category = 'SPLIT';
      splitDetail = splits
        .map(function (s) {
          var catName = s.categories ? s.categories.name : 'Category';
          return catName + ' $' + s.amount;
        })
        .join('; ');
    } else if (!category && txn.type === 'Income') {
      category = 'Ready to Assign';
    } else if (!category && txn.type === 'Expense') {
      category = 'Uncategorized';
    }

    return [
      txn.date,
      txn.type,
      txn.amount,
      txn.payee || '',
      txn.accounts ? txn.accounts.name : '',
      category,
      isSplit ? 'Yes' : 'No',
      splitDetail,
      txn.notes || '',
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function syncTransactionSplits() {
  const data = supabaseGet_(
    'transaction_splits?select=transaction_id,amount,sort_order,' +
      'categories!category_id(name),' +
      'transactions!transaction_id(date,payee,type,amount)' +
      '&order=transaction_id.desc'
  );

  const sheet = getOrCreateSheet_( 'TransactionSplits', [
    'Transaction ID',
    'Date',
    'Payee',
    'Txn Type',
    'Txn Total',
    'Category',
    'Split Amount',
    'Sort',
  ]);

  const rows = data.map(function (s) {
    var txn = s.transactions || {};
    return [
      s.transaction_id,
      txn.date || '',
      txn.payee || '',
      txn.type || '',
      txn.amount || '',
      s.categories ? s.categories.name : '',
      s.amount,
      s.sort_order || 0,
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function syncProjectedIncome() {
  const data = supabaseGet_(
    'projected_income?select=label,amount,expected_date,status,source_type,is_repeating,repeat_period,notes,' +
      'accounts!account_id(name),categories!category_id(name)' +
      '&order=expected_date.asc'
  );

  const sheet = getOrCreateSheet_( 'ExpectedIncome', [
    'Label',
    'Amount',
    'Expected Date',
    'Status',
    'Source',
    'Repeating',
    'Period',
    'Deposit Account',
    'Envelope',
    'Notes',
  ]);

  const rows = data.map(function (p) {
    return [
      p.label,
      p.amount,
      p.expected_date,
      p.status,
      p.source_type || 'other',
      p.is_repeating ? 'Yes' : 'No',
      p.repeat_period || 'None',
      p.accounts ? p.accounts.name : '',
      p.categories ? p.categories.name : '',
      p.notes || '',
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Finance OS')
    .addItem('🔄 Sync Latest Data', 'syncFinanceOS')
    .addToUi();
}

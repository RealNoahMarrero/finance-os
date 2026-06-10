/**
 * Finance OS → Google Sheets sync (Apps Script)
 *
 * Setup:
 * 1. Extensions → Apps Script — paste this file
 * 2. Set SUPABASE_URL and SUPABASE_KEY below (Project Settings → API → anon/publishable key)
 * 3. Reload spreadsheet — Finance OS menu → Sync Latest Data
 *
 * Sheets (compact for AI): Summary, Accounts, Categories, Transactions, ExpectedIncome, TransactionSplits
 * Do NOT commit real API keys to git.
 */

const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY';

const LIQUID_TYPES = ['Checking', 'Savings', 'Cash'];

const SOURCE_LABELS = {
  paycheck: 'Paycheck',
  gig: 'Gig / app balance',
  invoice: 'Invoice',
  transfer_in: 'Transfer in',
  other: 'Other',
};

function syncFinanceOS() {
  syncSummary();
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
  if (headers && headers.length) {
    sheet.appendRow(headers);
  }
  return sheet;
}

function round2_(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isLiquidAccount_(type) {
  return LIQUID_TYPES.indexOf(type) !== -1;
}

function computeSummaryMetrics_(accounts, categories, pendingIncome) {
  var liquidCash = 0;
  var netWorth = 0;

  accounts.forEach(function (acc) {
    var bal = Number(acc.balance) || 0;
    if (acc.type === 'Credit Card') {
      netWorth -= Math.abs(bal);
    } else {
      netWorth += bal;
    }
    if (isLiquidAccount_(acc.type)) {
      liquidCash += bal;
    }
  });

  var totalInEnvelopes = 0;
  categories.forEach(function (cat) {
    totalInEnvelopes += Math.max(0, Number(cat.assigned_amount) || 0);
  });

  var guaranteedInflow = 0;
  var anticipatedInflow = 0;
  pendingIncome.forEach(function (p) {
    var acct = p.accounts || {};
    if (!isLiquidAccount_(acct.type)) return;
    var amt = Number(p.amount) || 0;
    if (p.certainty === 'anticipated') {
      anticipatedInflow += amt;
    } else {
      guaranteedInflow += amt;
    }
  });

  liquidCash = round2_(liquidCash);
  netWorth = round2_(netWorth);
  totalInEnvelopes = round2_(totalInEnvelopes);
  var readyToAssign = round2_(liquidCash - totalInEnvelopes);
  guaranteedInflow = round2_(guaranteedInflow);
  anticipatedInflow = round2_(anticipatedInflow);
  var totalPending = round2_(guaranteedInflow + anticipatedInflow);

  return {
    liquidCash: liquidCash,
    netWorth: netWorth,
    totalInEnvelopes: totalInEnvelopes,
    readyToAssign: readyToAssign,
    guaranteedInflow: guaranteedInflow,
    anticipatedInflow: anticipatedInflow,
    projectedRtaGuaranteed: round2_(readyToAssign + guaranteedInflow),
    projectedRtaAllPending: round2_(readyToAssign + totalPending),
  };
}

/** Compact headline metrics + definitions (read this first for AI). */
function syncSummary() {
  var accounts = supabaseGet_('accounts?select=type,balance');
  var categories = supabaseGet_(
    'categories?select=assigned_amount&is_hidden=eq.false'
  );
  var pending = supabaseGet_(
    'projected_income?select=amount,certainty,accounts!account_id(type)&status=eq.pending'
  );

  var m = computeSummaryMetrics_(accounts, categories, pending);
  var syncedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

  var sheet = getOrCreateSheet_('Summary', ['Metric', 'Value']);

  var rows = [
    ['Synced At', syncedAt],
    ['Net Worth', m.netWorth],
    ['Liquid Cash', m.liquidCash],
    ['In Envelopes (positive only)', m.totalInEnvelopes],
    ['Ready to Assign', m.readyToAssign],
    ['Pending Income — Guaranteed', m.guaranteedInflow],
    ['Pending Income — Anticipated', m.anticipatedInflow],
    ['Projected RTA (guaranteed only)', m.projectedRtaGuaranteed],
    ['Projected RTA (all pending)', m.projectedRtaAllPending],
    ['', ''],
    ['— How to read this —', ''],
    [
      'Ready to Assign',
      'Liquid cash minus money sitting in positive envelopes. Overspent (negative) categories do not inflate RTA.',
    ],
    [
      'Guaranteed income',
      'Reliable inflows (paycheck, salary). Counts toward conservative Projected RTA.',
    ],
    [
      'Anticipated income',
      'Uncertain inflows (invoice, gig, other). Optimistic Projected RTA only — not in guaranteed row.',
    ],
    [
      'ExpectedIncome sheet',
      'Pending rows only. Mark received → becomes Income in Transactions; cancelled rows omitted.',
    ],
    [
      'Categories “Available”',
      'Envelope balance after spending. Negative = overspent; fix via Budget transfers.',
    ],
  ];

  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 420);
}

function syncAccounts() {
  var data = supabaseGet_(
    'accounts?select=name,type,balance,credit_limit,minimum_payment,payment_due_day,next_payment_due_date,' +
      'payment_category:categories!payment_category_id(name)&order=type,name'
  );

  var sheet = getOrCreateSheet_('Accounts', [
    'Account Name',
    'Type',
    'Balance',
    'Credit Limit',
    'Minimum Payment',
    'Payment Due Day',
    'Next Payment Due',
    'Budget Envelope',
  ]);

  var rows = data.map(function (acc) {
    return [
      acc.name,
      acc.type,
      acc.balance,
      acc.credit_limit || 0,
      acc.minimum_payment || 0,
      acc.payment_due_day || '',
      acc.next_payment_due_date || '',
      acc.payment_category ? acc.payment_category.name : '',
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function syncCategories() {
  var data = supabaseGet_(
    'categories?select=name,target_amount,assigned_amount,is_debt,balance,due_date,is_repeating,target_period&is_hidden=eq.false&order=name'
  );

  var sheet = getOrCreateSheet_('Categories', [
    'Category Name',
    'Target Goal',
    'Available',
    'Overspent?',
    'Is Debt?',
    'Total Debt Owed',
    'Due Date',
    'Repeating',
    'Period',
  ]);

  var rows = data.map(function (cat) {
    var available = Number(cat.assigned_amount) || 0;
    return [
      cat.name,
      cat.target_amount,
      available,
      available < 0 ? 'Yes' : 'No',
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
  var data = supabaseGet_(
    'transactions?select=id,date,type,amount,payee,notes,category_id,' +
      'accounts!account_id(name),categories!category_id(name),' +
      'transaction_splits(amount,categories!category_id(name))' +
      '&order=date.desc'
  );

  var sheet = getOrCreateSheet_('Transactions', [
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

  var rows = data.map(function (txn) {
    var splits = txn.transaction_splits || [];
    var isSplit = splits.length > 0;
    var category = txn.categories ? txn.categories.name : '';
    var splitDetail = '';

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
  var data = supabaseGet_(
    'transaction_splits?select=transaction_id,amount,sort_order,' +
      'categories!category_id(name),' +
      'transactions!transaction_id(date,payee,type,amount)' +
      '&order=transaction_id.desc'
  );

  var sheet = getOrCreateSheet_('TransactionSplits', [
    'Transaction ID',
    'Date',
    'Payee',
    'Txn Type',
    'Txn Total',
    'Category',
    'Split Amount',
    'Sort',
  ]);

  var rows = data.map(function (s) {
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
  // Pending only — received/cancelled omitted (received shows as Income in Transactions)
  var data = supabaseGet_(
    'projected_income?select=label,amount,expected_date,source_type,certainty,is_repeating,repeat_period,notes,' +
      'accounts!account_id(name),categories!category_id(name)' +
      '&status=eq.pending&order=expected_date.asc'
  );

  var sheet = getOrCreateSheet_('ExpectedIncome', [
    'Label',
    'Amount',
    'Expected Date',
    'Certainty',
    'Source',
    'Repeating',
    'Period',
    'Deposit Account',
    'Envelope',
    'Notes',
  ]);

  var rows = data.map(function (p) {
    var certainty = p.certainty === 'anticipated' ? 'Anticipated' : 'Guaranteed';
    return [
      p.label,
      p.amount,
      p.expected_date,
      certainty,
      SOURCE_LABELS[p.source_type] || p.source_type || 'Other',
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

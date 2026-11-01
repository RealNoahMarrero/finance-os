/**
 * Finance OS → Google Sheets sync (Apps Script) — token version
 *
 * Uses a narrow, read-only, revocable SYNC TOKEN (limited to the "personal" book). Your Finance OS password is NOT used or stored.
 * Revoke at any time: `node tools/supabase-admin.mjs sync-token revoke personal`, or delete the row in Supabase table sync_tokens.
 *
 * Setup (once):
 * 1. Extensions → Apps Script — replace the old code with this file, Save.
 * 2. Project Settings (gear) → Script properties → Add these three (never put them in the code):
 *      SUPABASE_URL       https://<your-project>.supabase.co
 *      SUPABASE_ANON_KEY  the public anon/publishable key (not a secret)
 *      SYNC_TOKEN         the token printed by: node tools/supabase-admin.mjs sync-token personal
 * 3. Run `testSupabaseAuth` once and approve Google's permission prompt.
 * 4. Reload the spreadsheet — Finance OS menu → Sync Latest Data
 *
 * Do NOT commit the token to git.
 */

// Credentials live in Script properties (see above) — never in this file.
function prop_(name) {
  var v = PropertiesService.getScriptProperties().getProperty(name);
  if (!v) throw new Error('Missing script property ' + name + ' (Project Settings → Script properties).');
  return v;
}

/** Personal household books — use google-sheets-sync-business.gs for Marrero LLC */
const ENTITY_ID = 'personal';

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
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Finance OS (' + ENTITY_ID + ') sync complete.',
    'Finance OS',
    5
  );
}

/** Reads every row of one dataset through the token-checked database function (pages of 1000). */
function supabaseGet_(resource) {
  var all = [];
  for (var offset = 0; ; offset += 1000) {
    var response = UrlFetchApp.fetch(prop_('SUPABASE_URL') + '/rest/v1/rpc/fos_sheets_data', {
      method: 'post',
      contentType: 'application/json',
      headers: { apikey: prop_('SUPABASE_ANON_KEY'), Authorization: 'Bearer ' + prop_('SUPABASE_ANON_KEY') },
      payload: JSON.stringify({ tok: prop_('SYNC_TOKEN'), resource: resource, off: offset, lim: 1000 }),
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) {
      var msg = response.getContentText().slice(0, 200);
      throw new Error(/invalid or revoked/.test(msg)
        ? 'The sync token was rejected (revoked or mistyped). Check SYNC_TOKEN in Script properties.'
        : 'Supabase read failed (' + response.getResponseCode() + '): ' + msg);
    }
    var page = JSON.parse(response.getContentText());
    all = all.concat(page);
    if (page.length < 1000) break;
  }
  return all;
}

/** Run once from the editor to confirm sign-in and read access work. */
function testSupabaseAuth() {
  var rows = supabaseGet_('summary_accounts');
  SpreadsheetApp.getActiveSpreadsheet().toast('Token accepted. Can read ' + rows.length + ' accounts.', 'Finance OS', 8);
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
  var totalOverspent = 0;
  categories.forEach(function (cat) {
    var assigned = Number(cat.assigned_amount) || 0;
    totalInEnvelopes += assigned;
    if (assigned < 0) {
      totalOverspent += Math.abs(assigned);
    }
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
  totalOverspent = round2_(totalOverspent);
  var readyToAssign = round2_(liquidCash - totalInEnvelopes);
  var assignableReadyToAssign = round2_(liquidCash - (totalInEnvelopes + totalOverspent));
  guaranteedInflow = round2_(guaranteedInflow);
  anticipatedInflow = round2_(anticipatedInflow);
  var totalPending = round2_(guaranteedInflow + anticipatedInflow);

  return {
    liquidCash: liquidCash,
    netWorth: netWorth,
    totalInEnvelopes: totalInEnvelopes,
    totalOverspent: totalOverspent,
    readyToAssign: readyToAssign,
    assignableReadyToAssign: assignableReadyToAssign,
    guaranteedInflow: guaranteedInflow,
    anticipatedInflow: anticipatedInflow,
    projectedRtaGuaranteed: round2_(readyToAssign + guaranteedInflow),
    projectedRtaAllPending: round2_(readyToAssign + totalPending),
    projectedAssignableGuaranteed: round2_(assignableReadyToAssign + guaranteedInflow),
    projectedAssignableAllPending: round2_(assignableReadyToAssign + totalPending),
  };
}

/** Compact headline metrics + definitions (read this first for AI). */
function syncSummary() {
  var accounts = supabaseGet_('summary_accounts');
  var categories = supabaseGet_('summary_categories');
  var pending = supabaseGet_('summary_pending');

  var m = computeSummaryMetrics_(accounts, categories, pending);
  var syncedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

  var sheet = getOrCreateSheet_('Summary', ['Metric', 'Value']);

  var rows = [
    ['Synced At', syncedAt],
    ['Net Worth', m.netWorth],
    ['Liquid Cash', m.liquidCash],
    ['In Envelopes (net Available)', m.totalInEnvelopes],
    ['Overspent (needs coverage)', m.totalOverspent],
    ['Ready to Assign (before coverage)', m.readyToAssign],
    ['Assignable (after overspend)', m.assignableReadyToAssign],
    ['Pending Income — Guaranteed', m.guaranteedInflow],
    ['Pending Income — Anticipated', m.anticipatedInflow],
    ['Projected RTA (guaranteed only)', m.projectedRtaGuaranteed],
    ['Projected RTA (all pending)', m.projectedRtaAllPending],
    ['Projected Assignable (guaranteed)', m.projectedAssignableGuaranteed],
    ['Projected Assignable (all pending)', m.projectedAssignableAllPending],
    ['', ''],
    ['— How to read this —', ''],
    [
      'Ready to Assign (before coverage)',
      'Liquid cash minus net envelope Available (YNAB-style; overspent lowers net assigned).',
    ],
    [
      'Assignable',
      'Liquid cash minus positive envelopes only — money you can assign after mentally covering overspent categories.',
    ],
    [
      'Projected RTA (guaranteed only)',
      'RTA before coverage plus guaranteed pending income (YNAB-style base).',
    ],
    [
      'Projected RTA (all pending)',
      'RTA before coverage plus all pending income.',
    ],
    [
      'Projected Assignable (guaranteed)',
      'Assignable plus guaranteed pending — matches app banner when overspent.',
    ],
    [
      'Projected Assignable (all pending)',
      'Assignable plus all pending income — optimistic assignable forecast.',
    ],
    [
      'Guaranteed income',
      'Reliable inflows (paycheck, salary). Counts toward conservative projected Assignable / RTA.',
    ],
    [
      'Anticipated income',
      'Uncertain inflows (invoice, gig, other). Optimistic projected rows only — not in guaranteed row.',
    ],
    [
      'ExpectedIncome sheet',
      'Pending rows only. Mark received → becomes Income in Transactions; cancelled rows omitted.',
    ],
    [
      'Categories “Available”',
      'Envelope balance after spending. Negative = overspent; fix via Budget transfers.',
    ],
    [
      'Categories “Notes”',
      'Envelope notes from Budget (e.g. disconnect warnings, account numbers).',
    ],
  ];

  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 420);
}

function syncAccounts() {
  var data = supabaseGet_('accounts');

  var sheet = getOrCreateSheet_('Accounts', [
    'Account Name',
    'Type',
    'Balance',
    'Credit Limit',
  ]);

  var rows = data.map(function (acc) {
    return [
      acc.name,
      acc.type,
      acc.balance,
      acc.credit_limit || 0,
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function syncCategories() {
  var data = supabaseGet_('categories');

  var sheet = getOrCreateSheet_('Categories', [
    'Category Name',
    'Venture',
    'Target Goal',
    'Available',
    'Overspent?',
    'Is Debt?',
    'Total Debt Owed',
    'Due Date',
    'Repeating',
    'Period',
    'Notes',
  ]);

  var rows = data.map(function (cat) {
    var available = Number(cat.assigned_amount) || 0;
    return [
      cat.name,
      cat.ventures ? cat.ventures.name : '',
      cat.target_amount,
      available,
      available < 0 ? 'Yes' : 'No',
      cat.is_debt ? 'Yes' : 'No',
      cat.balance,
      cat.due_date || '',
      cat.is_repeating ? 'Yes' : 'No',
      cat.target_period || '',
      cat.notes || '',
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function syncTransactions() {
  var data = supabaseGet_('transactions');

  var sheet = getOrCreateSheet_('Transactions', [
    'Date',
    'Type',
    'Amount',
    'Payee',
    'Account',
    'Category',
    'Venture',
    'Owner Flow',
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
      txn.ventures ? txn.ventures.name : '',
      txn.owner_flow || '',
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
  var data = supabaseGet_('transaction_splits');

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

  var rows = data
    .filter(function (s) {
      return s.transactions && s.transactions.entity_id === ENTITY_ID;
    })
    .map(function (s) {
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
  var data = supabaseGet_('projected_income');

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
    'Venture',
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
      p.ventures ? p.ventures.name : '',
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

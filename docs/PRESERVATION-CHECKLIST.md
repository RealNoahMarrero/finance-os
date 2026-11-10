# Preservation checklist

Everything below exists in the current app (baseline `3d017ca`). Tick `[x]` when verified in the 2.0 UI.

**Data**
- [ ] Accounts and opening balances
- [ ] Transactions, transfers, splits
- [ ] Reconciliation history and adjustments
- [ ] Category allocations / available balances
- [ ] Scheduled bills and recorded payments
- [ ] Debts and loans
- [ ] Credit cards, limits, utilization
- [ ] Expected and received income
- [ ] Imported historical summaries
- [ ] Credit scores and reported balances
- [ ] Archived accounts, bills, categories
- [ ] Hidden Business records (loaded, hidden, exported)

**Features**
- [ ] Search and filters (account, category, type, date); income/spend/net summaries
- [ ] Add / edit / delete / undo transaction; payee autofill; split
- [ ] Reconcile; opening balances (cutover)
- [ ] Account add / edit / archive / restore / delete-if-unused
- [ ] Ready to Assign and overspend cover
- [ ] Assign, move, Cover, Swap, Move all, Shortfall
- [ ] Targets and funding priority
- [ ] Bill add / edit / pause / archive / restore
- [ ] Guided payment and the already-paid exception
- [ ] Debt edit
- [ ] Expected income add / edit / receive / skip / delete (this vs series)
- [ ] Calendar
- [ ] Forecast (conservative / optimistic)
- [ ] Insights charts
- [ ] Credit tracker
- [ ] Export all data (including Business)
- [ ] Theme light / dark / auto; keyboard N / Esc
- [ ] PWA install and update

**Platform**
- [ ] Owner-only auth and RLS
- [ ] `fos_*` functions owner-checked
- [ ] Google Sheets read-only sync and token
- [ ] Production URL unchanged
- [ ] Old `#/…` links still resolve

# Finances — Onboarding & Comprehensive Audit

Date: 2026-11-10 · Repo: `finance-os-deploy` @ `3d017ca` · Scope: audit and planning only.
Nothing was redesigned, refactored, committed, pushed, deployed or migrated. No production data was read or written (see §1.4).

**How to read evidence labels.** Each finding says how I know it:
- **Observed (screen)** — seen in a screenshot of the running app on *synthetic* data (`screens/`).
- **Confirmed (code)** — read directly in the source or SQL; behaviour follows from the code but I did not execute that exact path.
- **Plausible** — a risk that follows from the design; needs a test or real data to confirm.
- **UX** — a usability judgement, not a defect.

Screenshots in `screens/` use a made-up dataset (5 accounts, 12 categories, ~50 transactions) shaped to include an overdue debt bill, an overspent category, an archived bill and an unverified account. Numbers in them are fictional.

---

## 1. Current project and test status

### 1.1 Repository
| Check | Result |
|---|---|
| Path | `C:\Users\Noah Marrero\Projects\Finance\finance-os-deploy` (the real repo, no copy) |
| Branch / remote | `main` → `origin` `github.com/RealNoahMarrero/finance-os` |
| HEAD vs origin | `3d017ca` = `origin/main` (after `git fetch`) |
| Working tree | clean except untracked `CLAUDE-CODE-HANDOFF.md` (and this `docs/audit-2026-11/` folder) |
| Recent commits | match the handoff (`3d017ca`, `0585ac3`, `1506a05`, `ed8e06e`) |
| Secrets in git | None found. `.env.admin` and `sync-tokens.local` are git-ignored and absent from history. Pattern scan matched only the word `service_role` in admin tooling and an integrity hash in `legacy/package-lock.json`. |

### 1.2 Checks run
| Command | Result |
|---|---|
| `npm ci` | OK. 0 vulnerabilities (`npm audit --omit=dev`). Warning: esbuild postinstall scripts not approved (harmless). |
| `npm run typecheck` | **Pass** |
| `npm test` | **49/49 pass**, 0.7 s (2 files: `engine.test.ts`, `credit.test.ts`) |
| `npm run build` | **Pass**, 4.6 s. One JS chunk of **756 KB** (208 KB gzip), no code-splitting. |

### 1.3 Differences from the handoff (all minor)
1. **Node version.** This PC runs Node 26.3 / npm 11; Netlify builds on Node 22. Build passes locally, but nothing pins the local version (no `.nvmrc`, no `engines`).
2. **No `.env.local`** exists, so the app cannot talk to Supabase from this checkout until Noah supplies the public URL/anon key. (Handoff step 3 anticipated this.)
3. **`README.md` is stale** (says 12 engine tests and names `011_security_and_ledger_engine.sql`, which no longer exists; it is `011a`/`011b`). Handoff already flags the README.
4. **`PRODUCTION-STATE.md` still says "sidebar entry" for Credit.** The current sidebar has no Credit link; it is reachable only from Insights (desktop) or More (mobile).
5. Handoff names `FINANCES-NOTION-UPDATE.md`; the file one level up is `NOTION-APP-REGISTRY-UPDATE.md`. Reference only.
6. Not verified (no access / not asked to touch): Netlify deploy state, production site contents, Supabase state, whether the Apps Script hourly trigger runs. I relied on the handoff for these.

### 1.4 Safe local preview (how I did it, and how you can)
- The repo has no data mode that is safe by default; the app always talks to whatever `VITE_/NEXT_PUBLIC_SUPABASE_URL` points to.
- I built a **separate bundle outside the repo** with `VITE_SUPABASE_URL=http://localhost:54399`, served by a throwaway mock (in the session scratchpad) that returns a synthetic dataset and **rejects every write**. After the full run, the mock logged zero writes (only the read-only `is_owner` check).
- Recommended permanent approach for the implementation phase: a committed **demo/fixture mode** (see §7), so the app can be previewed, screenshotted and tested with no Supabase at all.
- Never point a dev build at production: all UI actions write through live RPCs.

### 1.5 Tests and Cowork-only infrastructure
- **Works anywhere:** typecheck, Vitest (data math and credit math only), build.
- **Cowork-only / currently broken:** `tests/e2e/*.js` (≈15 scripts) need local Postgres 16 :5433, PostgREST :3000, Playwright and a restored DB copy. `reset.sh` hard-codes `/home/claude/...` paths and applies `011_security_and_ledger_engine.sql`, **a file that no longer exists**. `income.js` and `credit.js` have stale hard-coded dates; `billedit.js` takes ~100 s. `bill-edit.js` and `billedit.js` look like duplicates.
- `db/test_ledger.sql` + `db/load.sh` (37 SQL checks) need a Postgres with a restored backup; not run here.
- **Coverage gaps:** no tests for `db.ts` (row mapping, the multi-step writes), any React component, the service worker, or routing. All e2e coverage of UI flows is unusable outside Cowork. One test title contains corrupted characters (`âˆ’` for `−`).
- No CI: no `.github/`, no lint config. The only gate is Netlify's build.

### 1.6 Deployment, backup and rollback
- Release = `git push origin main` → Netlify builds `npm run build`, publishes `dist`. No evidence of PR deploy previews being used. Rollback = Netlify "Publish previous deploy".
- Database changes use `tools/supabase-admin.mjs` (`backup` → `migrate --dry` → `migrate` → `verify`). Migrations 011a–017 are additive. Backups live in `Projects\Finance\backups\` on this PC only.
- **Risks:** backups are a single local copy (no off-device copy); `.env.admin` holds a Supabase **management-API access token** (project-wide power, including the other apps in the shared project) in plaintext on disk; there is no automated test that a deploy still reads data correctly.

---

## 2. Feature inventory

Stack: Vite 6 + React 19 + TypeScript, hash routing, Supabase (Auth + Postgres RLS + `fos_*` SQL functions). Money is integer cents in the UI, dollars in the DB. Every write goes through one lock, then a **full reload of 10+ tables** (`store.tsx` `run()` → `db.loadAll()`).

### 2.1 Routes and screens
| Area | Route | What it does | Discoverability |
|---|---|---|---|
| Overview | `#/` | Greeting, setup banner, Ready to Assign card, 3 summary totals, account tiles, upcoming bills (5), recent transactions (5), budget summary, expected income | Nav item |
| Transactions | `#/transactions[?cat=]` | Search (payee/notes/category), type, 30/90/all days, account chips, income/spend/net, day groups, show more | Nav item. `?cat=` filter reachable only from Insights category rows |
| Accounts | `#/accounts` | Net worth chart, reconciliation status list, account cards with sparkline, credit utilization bar, archived accounts, **Loans** list (from debt categories) | Nav item |
| Account detail | `#/accounts/:id` | Balance, 30-day delta, history with "before opening balance" divider, reconcile, edit/archive/delete, drift explanation, bills from this account | Card click |
| Bills | `#/plan/bills` | Overdue/due-7/to-fund stats, grouped occurrences, All bills list (edit), Archived bills (restore) | Nav item "Bills & Budget" (default tab) |
| Budget | `#/plan/budget` (`#/budget`) | RTA card, month stats, "Advanced: funding order", filters, grouped category table, Cover buttons, archived categories | Sub-tab |
| Income | `#/plan/income` | Conservative/anticipated/optimistic totals, "Did it arrive?", upcoming, recently received | Sub-tab |
| Calendar | `#/plan/calendar` | Month grid of bills/income, day detail | Sub-tab (4th) |
| Forecast | `#/plan/forecast` | 30D/90D/12M chart (actual, conservative, optimistic), low points, shortfall callout, event list | **Only via Insights card** |
| Insights | `#/insights` | 4 health tiles, income vs spending, net worth, spend by category, weekly spend, Credit/Forecast cards, "Worth knowing" | Nav item |
| Credit | `#/credit` | Scores by bureau/model, utilization per card, reported balances, statement dates | **Only via Insights card / mobile More** |
| Login/denied/offline | gate in `main.tsx` | Email+password; owner check via `is_owner` RPC | — |

### 2.2 Sheets (modals) — 23 types
Transaction (add/view/edit, split, payee autofill, "advance bill?" follow-up), Assign (batch, "fund by priority"), Move money (From/To/Amount, searchable pickers, Swap, Shortfall/Move all), Category (detail, target, debt, bill section, archive), Category add/edit, Add scheduled bill, Bill (mark paid / review & post, mode toggle), Bill edit, Bill archive, Expected income add/view/edit/receive/delete(this vs series), Reconcile (3 steps), Opening balances (cutover), Account add/edit/archive/delete, Debt edit, Credit score / card / reported balance, Menu (mobile). A `forecast-detail` modal type exists but has no renderer.

### 2.3 Cross-cutting
- **Navigation:** desktop sidebar (5 items + Add transaction + theme + export + sign out); mobile bottom bar (Home, Accounts, +, Activity, Bills) plus a "More" sheet.
- **Theme:** Light/Dark/Auto, persisted in `localStorage`, meta theme-color updated.
- **Keyboard:** `N` opens Add transaction; Esc closes sheets; payee list supports ↑/↓/Enter/Tab.
- **Undo toasts:** add/delete transaction, assign, move, account archive, income removal, score/reported delete.
- **Export:** "Export all data" (JSON, includes hidden Business records) — small link in the sidebar footer / More sheet.
- **Business (Marrero LLC):** loaded, hidden, preserved, exported.
- **Google Sheets mirror:** two Apps Scripts → `fos_sheets_data` with revocable, SHA-256-hashed token; read-only.
- **PWA:** manifest + service worker `fos-shell-v2` (shell cached; data never cached). **Offline:** shell opens, data does not — the app is online-only and shows "Can't reach the database".
- **Auth/permissions:** Supabase password login; RLS `owner_all` on every Finance table; `fos_*` functions check `is_owner()`; anon revoked (except token-checked `fos_sheets_data`). The client `is_owner` gate is cosmetic; RLS is the real control.
- **Sync:** none beyond "reload after each write" and "refresh when tab becomes visible after 90 s". No realtime, no conflict detection.

### 2.4 Valuable but hidden / hard to find
Forecast and Credit (Insights cards only) · Calendar (4th sub-tab under a "Bills & Budget" label) · Export all data · Debts filter and "Track as debt" · Fund by priority · Shortfall/Move-all chips · Keyboard `N` · payee autofill · undo toasts · archive/restore for bills, categories and accounts (collapsed `<details>` at page bottoms) · "Edit bill" (only via All-bills list or bill sheet) · opening balances (Accounts header, setup banner, More) · per-account reconcile.
**Not missing, just buried:** I found no feature that is absent; every function the audit prompt lists exists.

### 2.5 Dead or unused code
`attentionItems()` / `AttnRow` (shared.tsx) are never used · `forecast-detail` modal type · `data.planned` is always `[]` (so "Planned one-offs in the forecast" renders an empty card — **Observed (screen)**) · `void` statements at the end of `sheets.tsx` and `db.ts` to silence unused imports · `Kind`/`MoneyLegend` partly unused · `src/pages/Plan.tsx` carries an unreachable `Budget` fallthrough.

---

## 3. UX and navigation findings

Format: **Evidence → Likely cause → Impact → Recommendation.**

### U1. "Bills & Budget" is one nav item hiding five different things — High
- **Evidence (screen):** the nav label opens Bills; Budget, Income and Calendar are sub-tabs; Forecast is a sixth page reached from Insights with a "Back to Insights" link yet highlighted under Bills & Budget. Page subtitle says "What's coming due, what's coming in, and your monthly plan".
- **Cause:** the earlier 5-item simplification folded old tabs under one parent without rethinking what belongs together.
- **Impact:** "pages within pages"; Calendar/Income are not budget concepts; Forecast has no stable home.
- **Rec:** group by user intent, e.g. **Home · Activity (transactions) · Accounts · Plan (bills + income + calendar as one timeline) · Budget (envelopes) · Insights (+ Forecast, Credit)** or merge Plan/Budget into one screen with a Bills ⇄ Categories toggle (see §7).

### U2. Bills and budget categories feel disconnected — High
- **Evidence (screen/code):** a bill *is* a category row with a due date, but the app presents them as two lists. Five separate states exist: *category without bill*, *bill*, *paused bill*, *archived bill* (category stays), *archived category*. "Old Internet" (archived bill) still appears in the Budget table as "$0 / $60 **Funded**" (**Observed**); `Pays from` on a bill is not a bill setting at all (see B10).
- **Impact:** users must understand "envelope", "funding target", "payment amount", "mode", "pause" vs "archive" vs "archive category".
- **Rec:** one object in the UI — a **Category** that optionally has a **Schedule** — with one status (Active / Paused / Archived) and a single "Pay" action that also draws from its envelope.

### U3. One operation, many different doors (Move Money / Assign) — High
- **Evidence (screen/code):** Budget page alone has **five** entry points: header *Assign money*, header *Move money*, RTA card *Assign money*, RTA card *Cover overspending*, per-row *Cover*. Plus Category sheet (*Move money*, *Assign money*), Bill sheet (*Fund it*), Overview RTA card.
  - *Assign money* (Budget/Overview) opens the **batch Assign sheet**; *Assign money* inside a category opens the **Move sheet pre-filled from Ready to Assign**; *Fund it* opens Move; *Cover* opens Move with a suggested source and amount; plain *Move money* opens Move **blank** with the "From" search list already open.
  - On **mobile** the Budget header buttons are desktop-only (my harness could not find "Move money"); to move money between two categories you open a category first.
- **Impact:** different layouts and defaults for the same intent, which is the inconsistency Noah described.
- **Rec:** one **Move money** sheet (RTA is just another source/destination) with an optional multi-line "Assign many" mode; every entry point passes only prefill values; same bottom-sheet pattern on mobile.

### U4. Overview shows everything once and the same things twice — Medium
- **Evidence (screen):** Overview is 1,855 px tall on desktop and ~3,150 px on a phone with 11 sections: setup banner, RTA, totals, accounts (again as tiles), bills, recent, budget summary, expected income. "Cash & savings" is shown in the totals *and* as tiles; RTA, "Left in your budget categories" and "Overall" are three different "how much do I have" numbers. Greeting hard-codes "Noah".
- **Rec:** one hero (what's safe to spend / what needs attention), 3–4 modules max, with the rest one tap away. Show net position once.

### U5. Dense, repetitive explanatory copy — Medium
- **Evidence (screen/code):** every screen carries a static sentence explaining itself, e.g. "Balances are what you've recorded — not a live bank connection", "Money set aside for a bill isn't counted as paid", "Entries past their date are still marked pending…", "Excludes transfers", "Money set aside, not bank cash", the Budget "What do these mean?" panel, a Callout on nearly every sheet, "Nothing was changed automatically/nothing is deleted" boilerplate on ~10 sheets. Roughly 100+ explanatory strings.
- **Cause:** each earlier bug fix added a reassurance sentence.
- **Rec:** keep **one** persistent trust line (manual balances) and the permanent-record warning on reconciliation; move the rest to tooltips / a Help drawer; use plainer labels so the text isn't needed.

### U6. Terminology drift — Medium
Same number, different names: **Available / Set aside / Left in categories / Funded / Assigned / Remaining**; **category / envelope / bill / debt / loan** (the Accounts page "Loans" list is built from budget categories); **Reconciled / Verified / Opening balance / Cutover**; **Guaranteed / Anticipated / Conservative / Optimistic**; **Reminder vs Prepares / Prepare a transaction**. "Ready to Assign" flips to "Over-assigned".
**Rec:** a short glossary of ≤8 terms, used verbatim everywhere; drop "cutover/baseline/envelope" from the UI.

### U7. Technical distinctions leak into the interface — Medium
- Bill **mode** (Reminder vs Prepare) is a per-bill setting whose only effect is whether *Mark paid* also posts a transaction — a user cannot tell that they are choosing between "remember" and "record".
- **Payment amount vs funding target** are two fields on every bill.
- **Pause vs Archive bill vs Archive category** (three retirement paths).
- **Mark paid without a transaction** advances the due date but leaves the envelope money in place (code: `fos_pay_bill` reminder path), which looks "still funded" next cycle.
- **Rec:** one "Paid" action that records the payment *and* spends from the envelope; one "Stop this bill" action (pause/archive as a single choice with restore).

### U8. Task efficiency (taps from the home screen)
| Task | Today | Note |
|---|---|---|
| Add an expense | + → amount → payee → category → Add = **5** | Good; autofill helps |
| Pay a bill and keep everything consistent | Bills → tap bill → Mark paid & review → Post = **4** (debt bills only reflect balance this way) | Paying via Add Transaction can leave the bill overdue (B4) |
| Cover overspending | Overview RTA → Cover overspending → Move = **2** | Good |
| Move between two categories (mobile) | Bills → Budget tab → category → Move money → From → To → Amount → Move = **7+** | |
| Create a bill (mobile) | Menu → New category → name → group → "A scheduled bill" → amount → date → Add = **8+** | |
| Reconcile an account | Accounts → Reconcile → enter → Preview → Record = **4** | Good |
| See the forecast / credit | Insights → card = **2**, undiscoverable | |
| Export data | small footer link | |

### U9. Desktop space and mobile fit — Medium
- **Desktop (screen):** content is capped near 1,100 px beside a 250 px sidebar; account tiles occupy only 3 of ~4 columns and leave a blank right side; Forecast event list stretches full width with a lot of empty row space; Calendar page is short while Overview is long. No side panels, master/detail or keyboard-first layouts.
- **Mobile (screen):** no horizontal overflow on any of the 11 pages (checked programmatically). Primary actions are bottom-sheet based and thumb-friendly. Weak spots: Budget header actions missing (U3), very long single-column scrolling pages, small tap targets in the Budget "Cover" pill and filter chips.
- **Rec:** two-pane layouts on desktop (list + detail instead of sheets), denser tables; on mobile, fewer sections per page and persistent primary action.

### U10. Visual hierarchy and status colour — Low/Medium
- **Observed:** good type scale and calm palette; both themes render. But green "funded" pills, blue progress bars, red overspent rows and the primary green button all compete on the Budget screen; the **"Target"** and **"Monthly target"** columns show the same value twice; "Needs a look: 2" is an unlabeled count. Dark mode screenshots for Overview/Budget/Bills render without errors (not reviewed for contrast ratios).
- **Rec:** run an accessibility pass (contrast, focus order, aria on `role="button"` rows, reduced motion); only one primary action per screen.

### U11. Accessibility — baseline noted
Positive: semantic nav/main, `aria-current`, `aria-pressed` on chips, dialogs have `role="dialog" aria-modal`, errors use `role="alert"`, labels on most inputs. Gaps: no focus trap/return focus in sheets (Escape only), clickable `div role="button"` rows, colour as the only status signal in places, no skip link, no documented contrast checks. (**Confirmed (code)**; not tested with a screen reader.)

---

## 4. Financial integrity and security findings

Nothing below was fixed or changed. No production record was read.

### 4.1 What is sound (verified in code + existing tests)
- **Ready to Assign** = liquid cash (checking, savings, cash) − sum of visible envelope balances; archived envelopes excluded; credit cards are not cash; expected income never counted. Covered by 11 unit tests including "Move money never changes RTA".
- **Money movement:** Move Money edits only `categories.assigned_amount` (`fos_move_money`/`fos_assign`); it never creates a transaction or changes an account balance. Account transfers are a separate transaction type. ✔ matches the stated safeguard.
- **Transactions** apply to account balance and envelope atomically in SQL (`fos_apply_effect`), reversal on edit/delete, idempotent create via `client_request_id`, locked rows in id order.
- **Linked records protected:** transactions that confirm a bill or income cannot be deleted; reconciliation adjustments cannot be edited/deleted; accounts with history cannot be deleted.
- **Recurring bills:** month-end anchoring is implemented identically in SQL (`fos_bill_next`) and TS (`nextDueDate`) with tests for 31st/leap/December.
- **Archive/restore:** bills and categories keep all history; restore rolls the date forward.
- **Security:** RLS owner-only on all Finance tables; anon revoked; sync tokens stored hashed and revocable; no secrets in git; `X-Frame-Options`, `nosniff`, `Referrer-Policy`, restrictive `Permissions-Policy` set.

### 4.2 Confirmed bugs (code and/or screen)
| # | Finding | Evidence | Impact | Recommendation |
|---|---|---|---|---|
| **B1** | Forecast shortfall callout contains hard-coded sample text: "for example **rent leaves on Dec 1** before the next paycheck lands" | `Plan.tsx:228` (Confirmed code) | Shown to the user whenever *any* shortfall exists, regardless of what actually causes it → misleading | Generate from the real first-shortfall event |
| **B2** | One overdue recurring bill is shown as several overdue rows, each claiming the *same* funding; totals double-count | **Observed (screen):** Car Loan appears 3× (44d overdue, 14d overdue, upcoming) all "$320 of $320 funded"; Overdue stat $670; "Still to fund $98" counts Streaming twice; Forecast lists Car Loan twice on Nov 11 | Real data has a 44-day-overdue bill (Dave – Teria): the overdue number is inflated and funding looks better than it is | One row per bill with "N payments missed"; allocate one envelope balance across occurrences |
| **B3** | Chart vs event list may disagree for bills overdue >30 days | Confirmed code: `buildForecast` looks back only 30 days (`billOccurrences(today−30, today−1)`), `cashEvents` uses a different rule. Screen shows both overdue occurrences in the list; I did not compute the chart line | Low point/chart may omit a missed payment the list shows | Single shared obligations function for chart and list; add test |
| **B4** | Paying a **debt** bill through *Add transaction* never reduces the debt or clears the bill; only the Bill sheet's "Prepare" path does. UI copy on Accounts and Debt sheets says the balance drops "when you post its payment with a transaction" | Confirmed code: `billForNewTxn` excludes `isDebt`; `linkBillPayment` (client) never touches `categories.balance`, `fos_pay_bill` does | Debt stays owed and the bill stays overdue after a normal payment — a plausible root cause of the 44-day-overdue item | One payment path (server function) for every entry point; test it |
| **B5** | `fos_next_income_date` monthly: `d + interval '1 month'` **drifts** (Jan 31 → Feb 28 → Mar 28 …), unlike bills; semimonthly spawns the **1st** with no weekend shift, while the client projects the **2nd** with weekend shift | Confirmed code (`011a` vs `data.ts incomeOccurrences`) | Wrong projected dates after a month-end paycheck is received | Reuse the anchor logic for income |
| **B6** | "Pays from" on the Bill sheet shows the default checking account for every bill; no such setting exists | Confirmed code (`db.ts toBill: accountId: defaultAcct`) | Displays a fact that isn't recorded | Make it a real field or remove the row |
| **B7** | Paused/archived bill category displays "Funded" with $0 and an empty bar | **Observed (screen):** Old Internet | Misleading status | Show "Paused/Archived" |
| **B8** | Transactions dated in the future are hidden from the Transactions list and account detail, but they already change balances | Confirmed code (`t.date > data.today` filters) | A post-dated entry can alter a balance with nowhere to see it | Show "Upcoming" group |
| **B9** | Group "kind" (bills/needs/wants/goals) is inferred from **group name text** (`kindOf`: "bill", "subscription", "need", "want") | Confirmed code `db.ts` | Renaming or adding a group silently changes funding priority and the forecast's "everyday spending" average | Store kind explicitly (needs a migration, planned later) |
| **B10** | `Insights` "Cash runway" divides by average monthly spend; zero spend → "Infinity days"; static note "Older months are imported summaries from before your fresh start" is always shown | Confirmed code | Edge cases / stale copy | Guard and drop the note |
| **B11** | Hard-coded "Good morning, **Noah**" | Confirmed code | Fine today; wrong if ever multi-user | Use profile name |
| **B12** | Dead code and an empty "Planned one-offs in the forecast" card | **Observed (screen)** / Confirmed code | Clutter | Remove |

### 4.3 Plausible concerns (need a test or real data to confirm)
- **P1 Non-atomic client sequences.** Several multi-step writes are done from the browser as separate calls: `linkBillPayment` / `unlinkBillPayment` (insert then update; undo does update *then* delete), `setCutovers` (one call per account), `addAccount` (insert account, then set opening balance), `archiveBill` + hide category, edit-this-occurrence of income (skip + new row). A dropped connection mid-sequence can leave half-done state (e.g., an account with no opening balance, a payment row without the advanced due date). `linkBillPayment` has a manual rollback; the others do not. **Rec:** move each into a single SQL function.
- **P2 Guessing a database row.** `skipOccurrence` identifies the newly created next income as "highest pending id greater than this id", and **undo deletes that row**. If another pending income is created in between (another device), undo could delete the wrong, unrelated expected income. **Rec:** return the new id from the SQL function.
- **P3 No conflict handling.** Last write wins. Data loads once, refreshes only when the tab regains focus after 90 s. Example: *Pause/Resume bill* in the Category sheet sends the whole bill (name, amount, date…) from cached data, so a stale tab can overwrite edits made on another device. No `updated_at` checks, no realtime. **Rec:** version column or compare-and-set in the SQL functions; refresh on focus.
- **P4 Server trusts the client for budget rules.** `fos_assign` accepts negative amounts (its header comment says "positive only") and neither it nor `fos_move_money` checks that the source has money; "Undo assign" can therefore push an envelope negative if it was spent. Owner-only, so low risk, but the safeguard exists only in the UI. **Rec:** enforce in SQL.
- **P5 Plain-row edits bypass the ledger functions** (`updateBill`, `setDebt`, `setTarget`, `updateAccountRow`, income edits) — RLS limits them to the owner, but nothing validates, audits or logs them. There is **no audit trail** of who/what changed a budget figure. **Rec:** audit table for non-ledger edits.
- **P6 Whole-database reload per write.** Every action refetches ~10 tables (all 2,000+ transactions and splits) and recomputes charts (some O(days × transactions)). Fine today; slows with years of data and on mobile networks. Also a single 756 KB bundle with no code-splitting.
- **P7 Net worth history is approximate.** It walks back from today using income and expenses only; loan balances are held constant in every past month and archived accounts are excluded, so older points can't be trusted as a record. The Accounts chart presents it as "Recorded". **Rec:** label as estimate or store monthly snapshots.
- **P8 Unreconciled drift is explained, never resolved.** The Daily Operations $9.00 (TikTok Shop, Oct 31) is a known open decision; not touched.
- **P9 Overspending carried in totals.** RTA correctly subtracts negative envelopes, but an overspent category plus `Undo` flows can change RTA unexpectedly; behaviour is tested but unusual to explain to users.

### 4.4 Security and access
- **Good:** owner-only RLS, anon blocked, token-hashed Sheets sync, no secrets in history.
- **S1 (Medium)** `.env.admin` holds a Supabase **management** token in plaintext, usable against the whole shared project (other apps too). Recommend using a short-lived/scoped token, storing it in a password manager, and rotating it now that Claude Code on this PC can read it.
- **S2 (Medium)** Public sign-ups remain enabled in the shared project; RLS protects Finance data, but enabling Supabase **MFA** for the owner and email allow-list/CAPTCHA would add protection.
- **S3 (Low)** No `Content-Security-Policy` header in `netlify.toml`; no HSTS declared there. Small risk for a private app, cheap to add.
- **S4 (Low)** Service worker pre-caches `/` and caches successful navigations as `/` (an authenticated app shell with no data). No data is cached; no issue found. Cache name is bumped by hand (`fos-shell-v2`).
- **S5 (Info)** Sync token for Sheets is long-lived; revocation exists. The Apps Script hourly trigger is **unconfirmed**.
- **S6 (Info)** Sessions persist in `localStorage` (`fos-auth`), the Supabase default. Acceptable; "Sign out" exists only in a footer link.

---

## 5. Existing-issue reconciliation

| Item from handoff / docs | Status after this audit |
|---|---|
| $9.00 TikTok Shop vs Daily Operations gap | **Open – Noah's decision.** Not touched. |
| Apps Script hourly trigger | **Unverified.** Needs Noah. |
| e2e `income.js`, `credit.js` stale dates; `billedit.js` slow | **Confirmed**; and the whole e2e suite is additionally blocked by missing `011_…sql` and cloud-only paths. Replace rather than repair. |
| README stale | **Confirmed** (also names a deleted file). |
| GO-LIVE.md historical | Confirmed; move to `docs/archive/`. |
| Dave – Teria 44 days overdue "is real data, not a bug" | **Partly.** The bill is real; how it is *displayed* (B2) and why payments don't clear it (B4) are app issues. Note: handoff says it is a plain bill (not a debt); B4 then applies only to true debts, but the overdue display issue (B2) applies to both. |
| Overspent category is "real data" | Agree; but Ready to Assign wording around it is wordy (U5). |
| Credit/Debt not top-level by design | Acceptable, but Forecast and Credit discoverability is a UX issue (U1). |
| Archive/restore (3d017ca), Move Money, RTA cards, account edit | **Previously fixed, no further work needed** functionally; UX unification still needed (U2, U3). |
| Debt categories restored (UI-only) | Fine; consider promoting Loans/Debts to a real concept (§7). |
| `legacy/` Next.js code (118 tracked files, 1.2 MB) | Technical debt: remove from `main` once archived elsewhere. |
| `tests` mojibake, duplicate e2e files, dead code, `void` hacks | Minor debt. |

**Technical debt worth addressing:** (1) server-side atomic functions for the remaining multi-step writes; (2) one obligations model shared by lists, calendar, forecast and attention; (3) a demo/fixture mode and a real test pyramid; (4) explicit group kind; (5) code-split bundle; (6) CI. **Not worth doing:** rewriting the money math (it is tested and consistent), changing the DB schema broadly, replacing hash routing.

**Risky or unnecessary features to simplify:** Bill "mode" toggle; separate payment amount vs funding target UI; "Advanced: funding order" panel; the Priority labels derived from group names; three ways to retire a bill/category; "Planned one-offs" (always empty); Insights "health" tiles that are heuristics (runway, adherence %).

---

## 6. Prioritized improvement opportunities

**P0 — correctness and trust (do before/with any redesign)**
1. B2/B3/B4: a single payment-and-obligation model (one overdue row per bill, allocate envelope funding across occurrences, one pay path incl. debt reduction).
2. B1, B7, B8, B12: remove misleading static text/labels, show future-dated transactions.
3. P1/P2: move multi-step writes into SQL functions (needs migration; must follow the backup procedure).
4. Demo/fixture mode + working test harness so changes can be verified without production.

**P1 — usability overhaul (the core of the project)**
5. Information architecture reset (U1) and a single Category+Schedule concept (U2).
6. One Move/Assign sheet and consistent entry points on desktop and mobile (U3).
7. Rework Overview and Budget for hierarchy and less copy (U4, U5, U6, U10).
8. Surface Forecast, Credit, Calendar and Export predictably (U1, U8).

**P2 — quality**
9. Desktop layouts that use space (two-pane, tables); mobile page-length reduction (U9).
10. Accessibility pass (U11); CSP and HSTS (S3); MFA (S2); rotate/scope admin token (S1).
11. Performance: code-split, incremental refresh instead of full reload.

**P3 — housekeeping**
12. README/handoff docs, remove `legacy/`, `.nvmrc`, CI (typecheck+tests+build).

---

## 7. Recommended redesign approach

Preserve every capability and all data; change structure, language and layout.

1. **Phase 0 — Safety net (no visible change).** Add fixture/demo mode (synthetic data, writes disabled or in-memory), screenshot script, CI, replace broken e2e with Playwright tests that run against the fixture mode. Extract one `obligations` module (bills/debts/overdue/funding) with unit tests before touching UI.
2. **Phase 1 — Model fixes** (B2–B5, P1–P2, P4) with a single backup-first migration and SQL tests. No UI redesign yet.
3. **Phase 2 — Information architecture.** Proposed top level (5 items, same on desktop and mobile): **Home · Activity · Accounts · Plan · Insights**, where **Plan** = one screen with three views — *Bills & schedule* (timeline/calendar), *Budget* (categories), *Income* — and Forecast/Credit become sections of Insights (or Plan). Settings/Export/Theme move to a real Settings page.
4. **Phase 3 — One vocabulary and one interaction set.** "Category (with optional schedule)", "Ready to assign", "Move money" (one sheet), "Mark paid" (one flow), "Pause/Archive" (one choice).
5. **Phase 4 — Screens.** Overview as a calm summary of *what needs attention*; Budget as a table with inline edit; Bills as a timeline with one row per bill; desktop two-pane detail instead of modals; mobile bottom-sheet patterns.
6. **Phase 5 — Polish.** Dark/light tokens review, accessibility, motion, empty states, performance, PWA update flow.

Ship each phase to production separately behind unchanged URLs; keep `#/` routes with redirects for old hashes.

---

## 8. High-risk areas needing extra safeguards

1. **Any migration** (shared Supabase project with other apps): backup → `--dry` → apply → `verify` → confirm 2,051+ transactions and 18 debts; test first against a restored local copy.
2. **Payment/obligation unification** (B2–B4): touches bills, debts, envelopes and transactions together; require SQL tests plus before/after snapshot comparison on a restored backup.
3. **Group-kind change** (B9): changes funding priority and forecast math; make backwards-compatible and snapshot-test.
4. **Cutover/reconcile/opening balances:** permanent records; keep the existing flows read-only-safe, never "auto-fix" balances.
5. **Undo features** (re-create, negative assign): easiest place to create silent inconsistencies.
6. **Service-worker changes:** a stale installed PWA can serve old shells; plan cache bump and an in-app "update available" prompt.
7. **Netlify auto-deploys `main`:** introduce a branch + deploy-preview workflow so redesign work never lands on production by accident.
8. **`.env.admin`:** treat as production credential (S1).

---

## 9. Decisions needed from Noah before implementation

1. **Navigation:** OK with a new 5-item top level (Home, Activity, Accounts, Plan, Insights)? Or keep today's names? Where should Forecast, Credit and Calendar live?
2. **Bills vs budget:** unify into "Category with optional schedule" (recommended)? Keep Reminder vs Prepare as a user-visible choice, or make "Mark paid" always record the payment?
3. **Overdue bills:** when a monthly bill is 2+ months behind, show one row ("2 missed") or one row per missed month?
4. **Debts/loans:** make "Debts" a first-class section (with payoff progress) or keep them as flagged categories?
5. **Marking paid without a transaction:** keep allowing it? If yes, should it also release the envelope's money?
6. **Future-dated transactions:** should they change balances immediately (today) or only on their date?
7. **Budgeting is "optional":** should the app default to a simple mode (accounts, bills, transactions) with envelopes switched on explicitly?
8. **Database changes allowed?** (atomic payment/skip functions, group kind column, audit table, version columns). Each needs a backup-first migration.
9. **Demo mode and tests:** OK to add a committed fixture mode, CI, and Playwright (new dev dependencies)?
10. **Security:** rotate `.env.admin` token, enable MFA, add CSP? Do you want sign-ups restricted?
11. **Personalisation:** name in greeting from profile? Currency/locale fixed to USD?
12. **$9.00 TikTok Shop item** and **Apps Script trigger** — your call / confirmation.
13. **Repo hygiene:** commit `CLAUDE-CODE-HANDOFF.md` (and copy to `CLAUDE.md`)? Remove `legacy/`? Move to PR-based releases?
14. **Scope of redesign visuals:** keep the current green/neutral palette and Inter typeface, or open to a new visual identity? (Image assets only via ChatGPT prompts, per your rule.)

---

## Appendix A — Screenshot index (`screens/`)
Desktop light: overview, transactions, accounts, account-detail, bills, budget, income, calendar, forecast, insights, credit. Desktop dark: overview, budget, bills. Mobile light: same 11 pages. Mobile dark: overview, budget, bills. Modals (desktop and mobile): add-transaction, move-from-budget, move-cover-overspent, move-from-overview-rta, assign-from-budget, category-sheet, bill-sheet, bill-edit*, reconcile, cutover, income-sheet, menu (mobile). *\*bill-edit captured the Bills page because my script's click target missed.*
Key references: `desktop-light-bills.png` (B2 triple Car Loan), `desktop-light-budget.png` (B7, five Move/Assign entry points, duplicated Target columns), `desktop-light-forecast.png` (duplicate event rows, empty planned card), `desktop-modal-move-*.png` (U3), `mobile-light-budget.png` (no header actions on mobile).
Note: full-page mobile captures show the fixed bottom tab bar in the middle of the page; that is a capture artifact, not a layout bug. Run metrics are in `run-report.json` (no JS errors, no horizontal overflow, 0 writes).

## Appendix B — What was not done
No production login, Netlify, Supabase or Sheets check · no screen-reader or contrast test · no execution of SQL tests or e2e suites · no load/performance profiling · no review of `legacy/` or the Apps Script files beyond their existence · Credit page and Credit sheets read at a high level only.

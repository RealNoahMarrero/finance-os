# Issue tracker

IDs refer to `docs/audit-2026-11/FINANCES-AUDIT.md` §4. Status: open · fixed · deferred · needs-decision.

| ID | Issue | Status | Milestone |
|---|---|---|---|
| B1 | Hard-coded forecast shortfall text | open | B/E |
| B2 | Overdue bill shown per occurrence; funding double-counted | open | B |
| B3 | Forecast chart vs event list use different obligation rules | open | B |
| B4 | Debt payment via normal transaction doesn't update debt/bill | open | B |
| B5 | Income recurrence: SQL month-end drift; semimonthly SQL vs client | open | B (migration) |
| B6 | "Pays from" not backed by a setting | open | D |
| B7 | Paused/archived bill category shows "Funded" | open | D |
| B8 | Future-dated transactions hidden but affecting balances | open | B (inventory and design first) |
| B9 | Group kind inferred from group name | open | B (migration) |
| B10 | Cash runway "Infinity"; static import note | open | E |
| B11 | Hard-coded name in greeting | open | C |
| B12 | Dead code; empty planned-items card | open | D |
| P1–P2 | Non-atomic client writes; guessed row id on income undo | open | B (migration) |
| P3 | Stale-tab overwrite, no conflict check | open | B (migration) |
| P4–P5 | Server trusts client budget rules; non-ledger edits unaudited | open | B (migration) |
| P6 | Full reload per write; single 756 KB bundle | open | E |
| P7 | Net-worth history approximated but labelled "Recorded" | open | E |
| S1 | Management token in plaintext on disk | needs-decision (rotation plan; no unilateral revoke) | — |
| S2 | MFA / sign-up restriction | needs-decision (shared auth settings) | — |
| S3 | No CSP/HSTS header | open | E |
| T1 | e2e suite obsolete (Cowork paths, missing 011 file) | fixed — replaced by `test:browser`; old scripts removed in F | A |
| T2 | No safe local preview | fixed — `npm run demo` | A |
| — | $9.00 TikTok Shop reconciliation | deferred (bank-record decision; not touched) | — |
| — | Apps Script hourly trigger unverified | deferred (separate check) | — |

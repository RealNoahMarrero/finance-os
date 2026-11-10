# Issue tracker

IDs refer to `docs/audit-2026-11/FINANCES-AUDIT.md` §4. Status: open · fixed · deferred · needs-decision.

| ID | Issue | Status | Milestone |
|---|---|---|---|
| B1 | Hard-coded forecast shortfall text | **fixed (local, migration 018)** | B/E |
| B2 | Overdue bill shown per occurrence; funding double-counted | **fixed (local, migration 018)** | B |
| B3 | Forecast chart vs event list use different obligation rules | **fixed (local, migration 018)** | B |
| B4 | Debt payment via normal transaction doesn't update debt/bill | **fixed (local, migration 018)** | B |
| B5 | Income recurrence: SQL month-end drift; semimonthly SQL vs client | **fixed (local, migration 018)** | B (migration) |
| B6 | "Pays from" not backed by a setting | **fixed (local, migration 018)** | D |
| B7 | Paused/archived bill category shows "Funded" | **fixed (local, migration 018)** | D |
| B8 | Future-dated transactions hidden but affecting balances | **fixed (local, migration 018)** | B (inventory and design first) |
| B9 | Group kind inferred from group name | **fixed (local, migration 018)** | B (migration) |
| B10 | Cash runway "Infinity"; static import note | **fixed (local, migration 018)** | E |
| B11 | Hard-coded name in greeting | **fixed (local, migration 018)** | C |
| B12 | Dead code; empty planned-items card | **fixed (local, migration 018)** | D |
| P1–P2 | Non-atomic client writes; guessed row id on income undo | **fixed (local, migration 018)** | B (migration) |
| P3 | Stale-tab overwrite, no conflict check | partly fixed (pause/resume); general edits deferred | — |
| P4 | Server trusts client budget rules | **fixed (local, migration 018)** | B |
| P5 | Non-ledger edits unaudited | deferred | — |
| P6 | Full reload per write; single 756 KB bundle | partly fixed (bundle 698 KB, lazy screens); reload-per-write deferred | E |
| P7 | Net-worth history approximated but labelled "Recorded" | **fixed** (labelled Estimate) | E |
| S1 | Management token in plaintext on disk | needs-decision (rotation plan; no unilateral revoke) | — |
| S2 | MFA / sign-up restriction | needs-decision (shared auth settings) | — |
| S3 | No CSP/HSTS header | open (not done) | — |
| T1 | e2e suite obsolete (Cowork paths, missing 011 file) | fixed — replaced by `test:browser`; old scripts removed in F | A |
| T2 | No safe local preview | fixed — `npm run demo` | A |
| — | $9.00 TikTok Shop reconciliation | deferred (bank-record decision; not touched) | — |
| — | Apps Script hourly trigger unverified | deferred (separate check) | — |

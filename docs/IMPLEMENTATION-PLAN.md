# Finances 2.0 — implementation plan (living document)

Branch: `finances-2.0` (from `main` @ `3d017ca`). Nothing is pushed or deployed. Production database untouched.
Evidence: `docs/audit-2026-11/FINANCES-AUDIT.md`. Issues: `docs/ISSUES.md`. Preservation: `docs/PRESERVATION-CHECKLIST.md`. Design: `docs/design/proposal/`.

## Status
| Milestone | State |
|---|---|
| A — Safe foundation | **Done**, except the isolated real-database test environment (needs your OK, below) |
| B — Financial integrity | Not started |
| C — Visual system & IA | **Design proposal ready for approval.** No implementation yet |
| D–F | Not started |

## Milestone A — what exists
- `npm run demo`: synthetic read-only backend (`tools/demo/`) plus the app on the pinned date 2026-11-10. Sign in with any credentials. The fixture contains no real data.
- **No accidental production writes**: (1) `npm run dev` refuses any non-local Supabase URL (`VITE_ALLOW_REMOTE=1` to override deliberately); (2) the demo backend binds to 127.0.0.1, holds no credentials, rejects every write; (3) the browser test fails if any write is attempted.
- `npm run test:browser`: builds a throwaway bundle, loads all 11 routes at desktop and phone width, fails on JS/console errors, empty pages, horizontal overflow, or any attempted write. 22 checks, 0 failures. Uses `puppeteer-core` (new devDependency; drives the Chrome/Edge already installed, no browser download).
- Baseline still green: typecheck, 49 unit tests, production build.
- `VITE_DEMO_TODAY` pins the clock for demo/tests; it is never set in production builds.

## Risk boundaries
Shared Supabase project: Finance tables/functions only. No production writes, migrations, pushes or deploys without explicit approval. Fresh backup before any migration. `.env.admin` is never read by tests or the demo.

## Needs from you
1. **Design approval** (`docs/design/proposal/README.md`, 5 grouped decisions).
2. **OK to pull container images** (`postgres:16`, PostgREST; roughly 200 MB) via Docker, which is installed. They would host a *synthetic* schema built from `db/*.sql` for real-SQL tests. Restoring a real backup into it is a separate, later approval.

## Order of work
1. Milestone B, each fix test-first: (a) obligations model — one row per bill, missed count, envelope funding allocated once; (b) one payment path including debts; (c) income recurrence in SQL and client; (d) scheduled future-dated transactions (inventory existing future-dated rows first; compatibility mode if not provably safe); (e) atomic server functions for multi-step writes; (f) concurrency/version checks. Every migration needs your approval and a fresh backup.
2. Milestones C–F per the brief.

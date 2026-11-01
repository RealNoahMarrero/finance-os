# Finance OS v2

Private personal-finance command center. Vite + React + TypeScript single-page app, Supabase (Auth + Postgres), deployed as static files on the existing Netlify site.

- `src/` — app. `db.ts` maps database rows to the UI; `data.ts` is all the money math; `store.tsx` runs every write through one atomic server function and reloads.
- `db/011_security_and_ledger_engine.sql` — owner-only access (RLS), atomic ledger functions, cutover/reconciliation, bill & income confirmation. **Apply to production only after a verified backup.**
- `db/test_ledger.sql` + `db/load.sh` — 37 database checks against a restored copy of your data.
- `tests/engine.test.ts` — 12 calculation checks (`npm test`). `tests/e2e/` — mock Supabase + real-browser flow checks (need local Postgres/PostgREST; used during development).
- `scripts/` — secure Google Sheets sync scripts (Apps Script).
- `netlify.toml` — build `npm run build`, publish `dist`, SPA redirect, security headers.

Develop: `npm install`, create `.env.local` (see `.env.example`), `npm run dev`. Never commit `.env*`.

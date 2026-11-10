# Finances

Private personal-finance app. Vite + React + TypeScript single-page app; Supabase (Auth + Postgres with row-level security and `fos_*` SQL functions); deployed as static files on Netlify.

## Run Finances 2.0 locally (synthetic data — safe)

```bash
npm install
npm run demo
```

Opens http://localhost:5180. Sign in with **any** email and password. The app talks to a local stand-in for Supabase that runs the **real SQL migrations** in `db/` on an in-memory Postgres loaded with invented data. Changes are saved only in memory and vanish when you stop it. It never connects to production.

`npm run dev` refuses to start against a remote database (set `VITE_ALLOW_REMOTE=1` only if you really mean it).

## Checks
| Command | What it covers |
|---|---|
| `npm run typecheck` | TypeScript |
| `npm test` | Calculation tests, Finances 2.0 model tests, and real-SQL tests of every migration (`tests/sql.test.mjs`, in-process Postgres) |
| `npm run test:browser` | Every route at desktop and phone width on read-only synthetic data (errors, overflow, saved-link redirects, zero writes). `SHOTS=dir` also saves screenshots |
| `npm run test:flows` | Click-through workflows against the live synthetic backend (add expense, cover overspending, bills, More menu, settings) |
| `npm run build` | Production bundle (`dist/`) |

Browser tests need Chrome or Edge (set `CHROME_PATH` if it is not in a default location).

## Layout
- `src/data.ts` money math · `src/db.ts` row mapping and RPC calls · `src/store.tsx` actions · `src/sheets.tsx` dialogs · `src/pages/*` screens
- `db/` migrations (additive; never applied to production without a verified backup) · `tools/supabase-admin.mjs` backup/migrate CLI · `tools/demo/` synthetic backend
- `docs/` audit, design proposal, screenshots, issue tracker

Production: https://marrero-finance.netlify.app/ (GitHub `main` auto-deploys). Never commit `.env*` files.

## Preview with your real data (read-only)
Create `.env.realpreview.local` (git-ignored) containing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the same public values Netlify uses) and `VITE_READONLY=1`, then `npm run preview:real` and sign in. All writes are blocked in the browser; see `docs/RELEASE-READINESS.md`.

// `npm run demo`: synthetic backend + Vite dev server pinned to the demo clock. Sign in with any email/password.
import { spawn } from 'node:child_process';
import { start } from './server.mjs';
await start();
const env = { ...process.env, VITE_SUPABASE_URL: 'http://127.0.0.1:54399', VITE_SUPABASE_ANON_KEY: 'demo', VITE_DEMO_TODAY: '2026-11-10' };
console.log('Demo backend on :54399 (synthetic, read-only). Starting the app - sign in with any email and password.');
spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5180', '--open'], { stdio: 'inherit', env });

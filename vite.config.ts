import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static single-page app. Reads the existing Netlify variables (NEXT_PUBLIC_SUPABASE_*) as well as VITE_*.
export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'NEXT_PUBLIC_SUPABASE_'],
  build: { outDir: 'dist', chunkSizeWarningLimit: 900 },
});

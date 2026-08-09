import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Static single-page app. No server-side anything.
// Builds to /dist, deployable as-is to Cloudflare Pages / Netlify.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Strip console.* and debugger from PRODUCTION builds so .bib/result contents are
  // never printed to devtools in prod. The dev server keeps them for local debugging.
  esbuild: mode === 'production' ? { drop: ['console', 'debugger'] } : {},
}))

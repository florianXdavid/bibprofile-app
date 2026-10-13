import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Static single-page app. No server-side anything.
// Builds to /dist, deployable as-is to Cloudflare Pages / Netlify.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Strip console.* and debugger from PRODUCTION builds so .bib/result contents are
  // never printed to devtools in prod. The dev server keeps them for local debugging.
  // (F-07: Vite 8 bundles and minifies with Rolldown/Oxc, so this moved from the old
  // `esbuild: { drop }` option to the minifier's compress options.)
  build: mode === 'production'
    ? { rolldownOptions: { output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } } }
    : {},
}))

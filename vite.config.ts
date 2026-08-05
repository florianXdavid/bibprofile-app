import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Static single-page app. No server-side anything.
// Builds to /dist, deployable as-is to Cloudflare Pages / Netlify.
export default defineConfig({
  plugins: [react()],
})

// Audit 2026-10-13 — F-10 privacy notice, F-11 legal notice, and the footer links to
// both from the app and every static page.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { GUIDES } from '../src/guides'
import { SOURCE_CODE_URL } from '../src/config'

const repo = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string) => readFileSync(join(repo, p), 'utf8')
const staticPages = [...GUIDES.map(g => g.slug), 'compare-reference-checkers', 'privacy', 'mentions-legales']
  .map(s => `public/${s}/index.html`)

describe('privacy and legal notice pages', () => {
  it('the app and every static page link both pages', () => {
    for (const f of ['src/App.tsx', ...staticPages]) {
      const html = read(f)
      expect(html, f).toContain('href="/privacy/"')
      expect(html, f).toContain('href="/mentions-legales/"')
    }
    expect(read('src/components/About.tsx')).toContain('href="/privacy/"')
  })
  it('both pages carry the source link, the contact address and a date', () => {
    for (const s of ['privacy', 'mentions-legales']) {
      const html = read(`public/${s}/index.html`)
      expect(html, s).toContain(SOURCE_CODE_URL)
      expect(html, s).toContain('contact@bibprofile.com')
      expect(html, s).toMatch(/(Last updated|mise à jour)[^<]*<\/span>?[^<]*\d{1,2} \w+ 20\d\d|Last updated: \d{1,2} \w+ 20\d\d/)
    }
  })
  it('the privacy notice names every party that receives data', () => {
    const html = read('public/privacy/index.html')
    for (const s of ['Crossref', 'OpenAlex', 'Google', 'Cloudflare', 'api.bibprofile.com', 'Data Privacy Framework', 'CNIL', '6(1)(f)']) expect(html).toContain(s)
  })
  it('the legal notice names publisher, publication director and host', () => {
    const html = read('public/mentions-legales/index.html')
    for (const s of ['Éditeur', 'Directeur de la publication', 'Hébergeur', 'Cloudflare, Inc., 101 Townsend St', 'AGPL-3.0']) expect(html).toContain(s)
  })
  it('neither page is in the sitemap', () => {
    const sitemap = read('public/sitemap.xml')
    expect(sitemap).not.toContain('/privacy/')
    expect(sitemap).not.toContain('/mentions-legales/')
  })
})

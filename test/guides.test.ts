// v1.6.1 — the static guide pages (public/<slug>/index.html) stay consistent with
// src/guides.ts, the sitemap, llms.txt and index.html, and stay script-free.
// v1.6.2 — the same for the comparison page (deliberately NOT linked from the app),
// plus /.well-known/ai-catalog.json.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EXAMPLE_FOCUS, GUIDES, isExampleFocus } from '../src/guides'

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))
const read = (p: string) => readFileSync(root(p), 'utf8')
const COMPARE = 'compare-reference-checkers'
const internalPages = [...GUIDES.map(g => `/${g.slug}/`), `/${COMPARE}/`]
const legalPages = ['/privacy/', '/mentions-legales/'] // audit 2026-10-13 — linked from every footer, not guides
const decode = (s: string) => s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

describe('guide pages (v1.6.1)', () => {
  const sitemap = read('public/sitemap.xml')
  const llms = read('public/llms.txt')
  const index = read('index.html')

  for (const g of GUIDES) {
    describe(g.slug, () => {
      const file = `public/${g.slug}/index.html`
      it('exists', () => expect(existsSync(root(file))).toBe(true))
      const html = existsSync(root(file)) ? read(file) : ''
      const url = `https://bibprofile.com/${g.slug}/`

      it('has its own title, description, canonical URL and one h1', () => {
        expect(html).toMatch(/<title>[^<]{20,}\| BibProfile<\/title>/)
        expect(html).toMatch(/<meta name="description" content="[^"]{80,}"/)
        expect(html).toContain(`<link rel="canonical" href="${url}" />`)
        expect(html.match(/<h1>/g)).toHaveLength(1)
      })
      it('ships no executable script (only JSON-LD)', () => {
        const scripts = html.match(/<script[^>]*>/g) ?? []
        expect(scripts).toEqual(['<script type="application/ld+json">'])
      })
      it('its FAQ JSON-LD matches the visible FAQ', () => {
        const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1])
        expect(ld['@type']).toBe('FAQPage')
        const faq = html.split('<h2>FAQ</h2>')[1]
        const visible = [...faq.matchAll(/<h3>(.*?)<\/h3>\s*<p>(.*?)<\/p>/g)].map(m => [decode(m[1]), decode(m[2])])
        expect(ld.mainEntity.map((q: { name: string; acceptedAnswer: { text: string } }) => [q.name, q.acceptedAnswer.text])).toEqual(visible)
      })
      it('links to the example on the right card, and to the app', () => {
        expect(html).toContain(`href="/?example=${g.example}"`)
        expect(isExampleFocus(g.example)).toBe(true)
        expect(html).toContain('href="/"')
      })
      it('links only to pages that exist', () => {
        for (const [, href] of html.matchAll(/href="(\/[^"?#]*)"/g)) {
          if (href === '/' || href === '/guides.css') continue
          expect([...internalPages, ...legalPages]).toContain(href)
        }
      })
      it('is listed in the sitemap, llms.txt and the home page’s static HTML', () => {
        expect(sitemap).toContain(`<loc>${url}</loc>`)
        expect(llms).toContain(`(${url})`)
        expect(index).toContain(`href="/${g.slug}/"`)
      })
    })
  }

  describe('the comparison page (v1.6.2)', () => {
    const file = `public/${COMPARE}/index.html`
    const html = read(file)
    const url = `https://bibprofile.com/${COMPARE}/`
    it('has its own title, description, canonical URL and one h1', () => {
      expect(html).toMatch(/<title>[^<]{20,}\| BibProfile<\/title>/)
      expect(html).toMatch(/<meta name="description" content="[^"]{80,}"/)
      expect(html).toContain(`<link rel="canonical" href="${url}" />`)
      expect(html.match(/<h1>/g)).toHaveLength(1)
    })
    it('ships no executable script, and its FAQ JSON-LD matches the visible FAQ', () => {
      expect(html.match(/<script[^>]*>/g)).toEqual(['<script type="application/ld+json">'])
      const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1])
      const faq = html.split('<h2>FAQ</h2>')[1]
      const visible = [...faq.matchAll(/<h3>(.*?)<\/h3>\s*<p>(.*?)<\/p>/g)].map(m => [decode(m[1]), decode(m[2])])
      expect(ld.mainEntity.map((q: { name: string; acceptedAnswer: { text: string } }) => [q.name, q.acceptedAnswer.text])).toEqual(visible)
    })
    it('links every competitor to the page its facts came from (F-13)', () => {
      const rows = html.match(/<tr[^>]*><th scope="row">[\s\S]*?<\/tr>/g) ?? []
      expect(rows.length).toBeGreaterThanOrEqual(8)
      for (const r of rows) {
        if (r.includes('>BibProfile</a>')) continue
        expect(r).toMatch(/<div class="src">source: <a href="https:\/\/[^"]+">/)
      }
    })
    it('says when it was checked and how to report a mistake', () => {
      expect(html).toMatch(/Checked on \d{1,2} \w+ 20\d\d/)
      expect(html).toContain('contact@bibprofile.com')
    })
    it('internal links exist; every guide links to it', () => {
      for (const [, href] of html.matchAll(/href="(\/[^"?#]*)"/g)) {
        if (href === '/' || href === '/guides.css') continue
        expect([...internalPages, ...legalPages]).toContain(href)
      }
      for (const g of GUIDES) expect(read(`public/${g.slug}/index.html`)).toContain(`href="/${COMPARE}/"`)
    })
    it('is in the sitemap and llms.txt, but not linked from the app (user’s choice)', () => {
      expect(sitemap).toContain(`<loc>${url}</loc>`)
      expect(llms).toContain(`(${url})`)
      expect(GUIDES.map(g => g.slug)).not.toContain(COMPARE)
      for (const f of ['src/App.tsx', 'src/components/About.tsx']) expect(read(f)).not.toContain(COMPARE)
    })
  })

  describe('/.well-known/ai-catalog.json (v1.6.2, draft AI Catalog spec)', () => {
    const cat = JSON.parse(read('public/.well-known/ai-catalog.json'))
    it('has the required fields', () => {
      expect(cat.specVersion).toMatch(/^\d+\.\d+$/)
      expect(cat.host.displayName).toBe('BibProfile')
      for (const e of cat.entries) {
        expect(typeof e.identifier).toBe('string')
        expect(typeof e.type).toBe('string')
        expect(e.url).toMatch(/^https:\/\/bibprofile\.com\//)
      }
      expect(new Set(cat.entries.map((e: { identifier: string }) => e.identifier)).size).toBe(cat.entries.length)
    })
    it('lists llms.txt, the app, every guide and the comparison — and only pages that exist', () => {
      const urls: string[] = cat.entries.map((e: { url: string }) => e.url)
      expect(urls).toContain('https://bibprofile.com/llms.txt')
      expect(urls).toContain('https://bibprofile.com/')
      for (const p of internalPages) expect(urls).toContain(`https://bibprofile.com${p}`)
      for (const u of urls) {
        const path = u.replace('https://bibprofile.com/', '')
        if (path === '') continue
        expect(existsSync(root(`public/${path}${path.endsWith('/') ? 'index.html' : ''}`))).toBe(true)
      }
    })
    it('is advertised from the home page', () => {
      expect(index).toContain('<link rel="ai-catalog" href="/.well-known/ai-catalog.json"')
    })
  })

  it('every example focus lands on a known tab', () => {
    for (const f of Object.values(EXAMPLE_FOCUS)) expect(['report', 'cleaned']).toContain(f.view)
    expect(isExampleFocus('nope')).toBe(false)
    expect(isExampleFocus(null)).toBe(false)
  })
})

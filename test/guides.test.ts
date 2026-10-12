// v1.6.1 — the static guide pages (public/<slug>/index.html) stay consistent with
// src/guides.ts, the sitemap, llms.txt and index.html, and stay script-free.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EXAMPLE_FOCUS, GUIDES, isExampleFocus } from '../src/guides'

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url))
const read = (p: string) => readFileSync(root(p), 'utf8')
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
          expect(GUIDES.map(o => `/${o.slug}/`)).toContain(href)
        }
      })
      it('is listed in the sitemap, llms.txt and the home page’s static HTML', () => {
        expect(sitemap).toContain(`<loc>${url}</loc>`)
        expect(llms).toContain(`(${url})`)
        expect(index).toContain(`href="/${g.slug}/"`)
      })
    })
  }

  it('every example focus lands on a known tab', () => {
    for (const f of Object.values(EXAMPLE_FOCUS)) expect(['report', 'cleaned']).toContain(f.view)
    expect(isExampleFocus('nope')).toBe(false)
    expect(isExampleFocus(null)).toBe(false)
  })
})

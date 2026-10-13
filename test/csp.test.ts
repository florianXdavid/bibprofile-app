// F-02 (audit 2026-10-13) — the Content-Security-Policy is ENFORCED, and nothing in
// index.html or public/**/*.html would be blocked by it.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const repo = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string) => readFileSync(join(repo, p), 'utf8')
function* htmlFiles(dir: string): Generator<string> {
  for (const name of readdirSync(join(repo, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(repo, rel)).isDirectory()) yield* htmlFiles(rel)
    else if (name.endsWith('.html')) yield rel
  }
}

describe('Content-Security-Policy (F-02)', () => {
  const headers = read('public/_headers')
  const csp = headers.match(/^\s*Content-Security-Policy:\s*(.+)$/m)?.[1] ?? ''
  it('is enforced, not report-only, with the agreed directives', () => {
    expect(headers).not.toMatch(/Content-Security-Policy-Report-Only:/)
    for (const d of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'",
      "frame-ancestors 'none'", "form-action 'none'", 'upgrade-insecure-requests']) expect(csp).toContain(d)
    expect(csp).toContain('connect-src \'self\' https://api.bibprofile.com https://api.openalex.org https://api.crossref.org')
  })
  it('no page carries an inline script, an inline event handler or a javascript: URL', () => {
    for (const f of ['index.html', ...htmlFiles('public')]) {
      const html = read(f)
      for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
        if (/type="application\/ld\+json"/.test(tag)) continue
        expect(tag, f).toMatch(/\bsrc="\/[^"]*"/) // only our own bundle
      }
      expect(html, f).not.toMatch(/<[^>]+\son[a-z]+\s*=/i)
      expect(html, f).not.toMatch(/javascript:/i)
    }
  })
})

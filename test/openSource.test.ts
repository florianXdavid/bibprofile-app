// v1.6.2 — BibProfile is open source (AGPL-3.0), published as a public mirror. Guards:
// the licence is in place, every page offers the same source link (AGPL §13), and no
// personal e-mail address sits in any file of the repository.

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { SOURCE_CODE_URL } from '../src/config'
import { GUIDES } from '../src/guides'

const repo = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string) => readFileSync(join(repo, p), 'utf8')

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(join(repo, dir))) {
    if (['node_modules', 'dist', '.git', '.env', '.env.local'].includes(name)) continue
    const rel = dir ? `${dir}/${name}` : name
    if (statSync(join(repo, rel)).isDirectory()) yield* files(rel)
    else if (/\.(ts|tsx|js|mjs|json|md|html|css|txt|xml|bib)$/.test(name) || name === 'LICENSE') yield rel
  }
}

describe('open source (v1.6.2)', () => {
  it('ships the AGPL-3.0 licence', () => {
    expect(read('LICENSE')).toMatch(/^GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/)
    expect(JSON.parse(read('package.json')).license).toBe('AGPL-3.0-only')
    expect(read('SECURITY.md')).toContain('contact@bibprofile.com')
  })

  it('offers the same source link everywhere (AGPL §13)', () => {
    expect(SOURCE_CODE_URL).toMatch(/^https:\/\/github\.com\/[\w-]+\/[\w.-]+$/)
    expect(read('src/components/About.tsx')).toContain('SOURCE_CODE_URL')
    expect(read('src/App.tsx')).toContain('SOURCE_CODE_URL')
    const pages = [...GUIDES.map(g => `public/${g.slug}/index.html`), 'public/compare-reference-checkers/index.html',
      'public/privacy/index.html', 'public/mentions-legales/index.html']
    for (const f of ['index.html', 'public/llms.txt', ...pages]) expect(read(f), f).toContain(SOURCE_CODE_URL)
  })

  it('no personal e-mail address in any file (only contact@bibprofile.com and test placeholders)', () => {
    const allowed = new Set(['contact@bibprofile.com', 'me@x.org', 'you@example.com'])
    for (const f of files('')) {
      for (const m of read(f).matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[a-z]{2,}/g)) {
        const addr = m[0]
        if (allowed.has(addr) || addr.endsWith('.noreply.github.com') || /@\d/.test(addr) || /^[\w.-]+@[\w.-]*\.(tsx?|js|css|json)$/.test(addr)) continue
        expect.soft(addr, `${f}`).toBe('(no personal address)')
      }
    }
  })

  it('the files a public repository needs are present', () => {
    for (const f of ['LICENSE', 'SECURITY.md', 'README.md', '.gitignore', '.env.example']) expect(existsSync(join(repo, f)), f).toBe(true)
    expect(read('.gitignore')).toMatch(/^\.env$/m)
  })
})

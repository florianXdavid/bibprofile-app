// F-14 (audit 2026-10-13) — /.well-known/security.txt (RFC 9116).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SOURCE_CODE_URL } from '../src/config'

const txt = readFileSync(fileURLToPath(new URL('../public/.well-known/security.txt', import.meta.url)), 'utf8')
const field = (k: string) => txt.match(new RegExp(`^${k}: (.+)$`, 'm'))?.[1]

describe('security.txt (F-14)', () => {
  it('has the required and agreed fields', () => {
    expect(field('Contact')).toBe('mailto:contact@bibprofile.com')
    expect(field('Preferred-Languages')).toBe('en, fr')
    expect(field('Canonical')).toBe('https://bibprofile.com/.well-known/security.txt')
    expect(field('Policy')).toBe(`${SOURCE_CODE_URL}/blob/main/SECURITY.md`)
  })
  it('has not expired (RFC 9116: renew before the date; at most a year ahead is recommended)', () => {
    const exp = Date.parse(field('Expires') ?? '')
    expect(Number.isNaN(exp)).toBe(false)
    expect(exp).toBeGreaterThan(Date.now())
  })
  it('is mentioned in SECURITY.md', () => {
    expect(readFileSync(fileURLToPath(new URL('../SECURITY.md', import.meta.url)), 'utf8')).toContain('/.well-known/security.txt')
  })
})

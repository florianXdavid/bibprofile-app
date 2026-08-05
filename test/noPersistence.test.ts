import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// W4 secret rule (and the standing no-persistence constraint): the user's key —
// and everything else — is memory-only. This is a static guard that no source
// file reaches for a storage API. If a future change tries to persist the key
// (or anything), this fails loudly.
function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...tsFiles(p))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

describe('memory-only: no persistence anywhere in src', () => {
  const srcDir = fileURLToPath(new URL('../src', import.meta.url))
  const forbidden = ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']

  it('no src file references a browser storage API', () => {
    const offenders: string[] = []
    for (const file of tsFiles(srcDir)) {
      const text = readFileSync(file, 'utf8')
      for (const api of forbidden) {
        if (text.includes(api)) offenders.push(`${file.replace(srcDir, 'src')}: ${api}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

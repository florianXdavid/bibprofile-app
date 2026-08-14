import { describe, it, expect } from 'vitest'
import ErrorBoundary from '../src/components/ErrorBoundary'

// The crash itself (React + Google Translate) is only reproducible in a real
// browser (see the manual recipe). These cheap, DOM-free checks pin the boundary's
// core contract: on a thrown child it flips to the fallback; otherwise it passes
// children through. No new deps, no jsdom needed.
describe('ErrorBoundary', () => {
  it('flags hasError when a child throws (getDerivedStateFromError)', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ hasError: true })
  })

  it('passes children through normally, and renders the fallback once errored', () => {
    const eb = new ErrorBoundary({ children: 'CHILD' })
    expect(eb.render()).toBe('CHILD') // no error -> transparent

    eb.state = { hasError: true }
    const fallback = eb.render() as { props: { className: string; role: string } }
    expect(fallback.props.className).toContain('crash-fallback')
    expect(fallback.props.role).toBe('alert')
  })
})

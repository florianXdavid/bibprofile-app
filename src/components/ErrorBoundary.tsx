import { Component, type ErrorInfo, type ReactNode } from 'react'

// Root error boundary — a safety net so a render/commit crash renders a graceful
// fallback instead of a blank white page. The motivating case is the known
// React + Google-Translate DOM conflict: Translate moves/wraps text nodes outside
// React's knowledge, and a later removeChild/insertBefore throws NotFoundError,
// unmounting the whole tree. Presentational only — NO persistence.
//
// This does NOT swallow the app's own error handling: budget exhaustion, auth
// failure and bad-upload errors are caught inside App and surfaced via UI state —
// they never throw up to React, so they never reach this boundary.
interface State { hasError: boolean }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // console.* is stripped from production builds; kept for local debugging.
    console.error('BibProfile crashed:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app crash-fallback" role="alert">
          <h1>BibProfile</h1>
          <p>Something went wrong displaying the page. Please reload.</p>
          <p className="muted">
            If your browser is translating this page, turning translation off for
            bibprofile.com usually fixes it — that's a known cause.
          </p>
          <button type="button" className="primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

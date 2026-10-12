// W4 — bring-your-own OpenAlex key. A quiet, always-available affordance (never
// an ambush): a small link that opens a helper + paste field. The key is held
// only in App's in-memory state — this component just collects it and reports
// set/clear up. The trust sentence is load-bearing; keep it verbatim.
//
// The key input is plain text with autocomplete OFF on purpose: a `password`
// input can prompt the browser's password manager to SAVE the key, which would
// be a form of persistence we don't want. Nothing here writes to any storage.

import { useState } from 'react'
import { isPlausibleKey } from '../lib/credential'

interface Props {
  active: boolean // a user key is currently set
  error: string // auth-failure message from App (key rejected by OpenAlex)
  onSet: (apiKey: string) => void
  onClear: () => void
}

export default function KeyControl({ active, error, onSet, onClear }: Props) {
  const [open, setOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [shapeError, setShapeError] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!isPlausibleKey(apiKey)) {
      setShapeError('That doesn’t look like a key — paste your OpenAlex API key.')
      return
    }
    setShapeError('')
    onSet(apiKey.trim())
    setApiKey('')
    setOpen(false)
  }

  // Active: a compact indicator + Clear, plus any auth-rejection message.
  if (active) {
    return (
      <div className="keyctl active">
        <span className="key-badge">Using your own OpenAlex key</span>
        <button type="button" className="key-link" onClick={onClear}>Clear</button>
        {error && (
          <p className="err-text key-error">
            {error} <button type="button" className="key-link" onClick={onClear}>Clear key</button>
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="keyctl">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}>
          Use your own free OpenAlex key
        </button>
      ) : (
        <form className="key-form" onSubmit={submit}>
          <p className="key-why">
            BibProfile runs on a shared OpenAlex pool. If it’s busy, or you have a lot to process, use
            your own free key to get your own daily credits. Get one at{' '}
            <a href="https://openalex.org/settings/api" target="_blank" rel="noreferrer">openalex.org/settings/api</a>,
            then paste it below.
          </p>
          <p className="key-trust">
            Your key stays in your browser, is never stored, and is sent only to OpenAlex. It’s cleared
            when you reload the page.
          </p>
          <label>
            OpenAlex API key
            <input
              type="text" autoComplete="off" spellCheck={false}
              value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="paste your key"
            />
          </label>
          {shapeError && <p className="err-text">{shapeError}</p>}
          <div className="key-actions">
            <button type="submit" className="primary">Use this key</button>
            <button type="button" className="key-link" onClick={() => { setOpen(false); setShapeError('') }}>Cancel</button>
          </div>
          <p className="muted key-note">
            You’ll re-enter this next visit — it’s never saved. You can see your usage anytime on{' '}
            <a href="https://openalex.org/settings/api" target="_blank" rel="noreferrer">OpenAlex</a>.
          </p>
        </form>
      )}
    </div>
  )
}

import { useRef, useState } from 'react'

interface Props {
  onText: (text: string, filename: string) => void
  disabled: boolean
}

export default function FileDrop({ onText, disabled }: Props) {
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // The ONE file-handling path — drag-drop and the picker both funnel here, so
  // the size guard downstream in App.run() has a single home (W3.2 Item 4).
  async function handleFile(file: File) {
    const text = await file.text()
    onText(text, file.name)
  }

  // Open the native picker. Clear the input's value FIRST so re-selecting the
  // SAME file still fires `onChange` (a file input emits no change event when the
  // value is unchanged — the intermittent "picker did nothing" cause). We also
  // clear it after handling, belt-and-suspenders.
  function openPicker() {
    const el = inputRef.current
    if (!el) return
    el.value = ''
    el.click()
  }

  return (
    <div
      className={`dropzone${drag ? ' drag' : ''}`}
      onDragOver={e => { e.preventDefault(); if (!disabled) setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => {
        e.preventDefault()
        setDrag(false)
        if (disabled) return
        const file = e.dataTransfer.files?.[0]
        if (file) void handleFile(file)
      }}
    >
      <div>Drop a <code>.bib</code> file here</div>
      <div className="actions">
        <button type="button" className="primary" disabled={disabled} onClick={openPicker}>
          Choose .bib file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".bib,text/plain"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
            e.target.value = '' // allow re-selecting the same file next time
          }}
        />
      </div>
      <div className="hint">Everything runs in your browser. The only network calls are to the OpenAlex API.</div>
    </div>
  )
}

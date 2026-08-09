// W4.2 — the About panel. Presentational; App toggles it from a top-right button.

export default function About({ onClose }: { onClose: () => void }) {
  return (
    <div className="about">
      <h2>BibProfile</h2>
      <p>
        Upload your BibTeX reference list and see the shape of your bibliography — its recency,
        venues, open-access mix, duplicates, retractions and possible gaps — then get a cleaned copy
        back. It's handy to run right before you submit a paper to a journal or conference, as a
        final sanity-check and tidy-up of your reference list.
      </p>

      <h3>What it does</h3>
      <ul className="about-list">
        <li>
          <strong>Match &amp; inspect</strong> — parses your <code>.bib</code>, matches each reference
          against OpenAlex, and shows an honest match rate with a sortable, filterable table.
        </li>
        <li>
          <strong>Report</strong> — analysis cards: recency profile, journal concentration,
          self-citation (for you or any author), open access, reference-list shape, retractions, and
          duplicates. Every card is descriptive — never a score or a judgement.
        </li>
        <li>
          <strong>Missing citations</strong> — finds works your references collectively point to but
          you haven't cited (missing <em>foundations</em>), and recent work that cites your set
          (<em>adjacent work</em>).
        </li>
        <li>
          <strong>Preprint → published</strong> — detects preprints (arXiv, bioRxiv, medRxiv, SSRN, …)
          and looks up their published versions.
        </li>
        <li>
          <strong>Cleaned <code>.bib</code></strong> — suggests fixes (missing DOIs, venues,
          volume/pages from OpenAlex) as a reviewable diff and a downloadable file. It never changes
          your cite keys, drops entries, or edits text you already wrote.
        </li>
      </ul>

      <h3>Privacy</h3>
      <p>
        Everything runs in your browser. To match your references, their titles and DOIs are sent to
        OpenAlex. On the shared pool (the default), they pass through BibProfile's own proxy at{' '}
        <code>api.bibprofile.com</code>, which forwards them to OpenAlex and stores nothing; if you use
        your own key, queries go straight to OpenAlex and your key never touches our proxy. Nothing is
        stored, there's no account, and there's no tracking.
      </p>

      <h3>The shared pool &amp; your own key</h3>
      <p>
        BibProfile uses a shared pool of OpenAlex credits, so you can just upload a <code>.bib</code>
        and go — no account, no key needed. That pool is limited, though, and can run dry on a busy
        day. If that happens, come back tomorrow — or use your own OpenAlex key, for free: get one at{' '}
        <a href="https://openalex.org/settings/api" target="_blank" rel="noreferrer">openalex.org/settings/api</a>
        {' '}and click the <strong>“Use your own OpenAlex key”</strong> button to run on your own
        budget. Your key stays in your browser, is never stored, and is cleared when you reload.
      </p>

      <h3>Credits</h3>
      <ul className="about-list">
        <li>Bibliographic data from <a href="https://openalex.org" target="_blank" rel="noreferrer">OpenAlex</a>.</li>
        <li>Built with React, Vite, and <code>@retorquere/bibtex-parser</code>.</li>
        <li>Built with the assistance of Claude (Anthropic's AI).</li>
        <li>
          Built by Florian David (ORCID:{' '}
          <a href="https://orcid.org/0009-0001-7990-3186" target="_blank" rel="noreferrer">0009-0001-7990-3186</a>).
        </li>
      </ul>

      <button type="button" className="primary" onClick={onClose}>Back to the tool</button>
    </div>
  )
}

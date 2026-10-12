// W4.2 / v1.1 — the About tab. Presentational; rendered as one of the four tabs
// (About · Report · Cleaned .bib · Table), so it no longer needs a close button.

import { VERSIONS } from '../versions'
import { SOURCE_CODE_URL } from '../config'

export default function About() {
  return (
    <div className="about">
      <h2>BibProfile</h2>
      <p>
        <strong>Check your references before the reviewers do.</strong> Upload or paste your BibTeX
        reference list to see how many references could be verified to exist, which ones to check by hand, and
        which papers were retracted. Then see the shape of your bibliography — its recency, venues,
        open-access mix and duplicates — the citations you may have missed, and get a cleaned copy
        back. Run it right before you submit a paper to a journal or conference.
      </p>

      <h3>What it does</h3>
      <ul className="about-list">
        <li>
          <strong>Is every reference real?</strong> — “X of Y references verified to exist”, with the
          references that could not be verified (each with a Google Scholar search link), DOIs that
          point to another work, and retracted papers. “Could not verify” isn’t proof of fabrication:
          some real works are missing from OpenAlex.
        </li>
        <li>
          <strong>Share with co-authors</strong> — download a one-page report (HTML, or PDF through your
          browser's print dialog) and copy a one-line message to send with it. Both are made in your
          browser; nothing is uploaded. No <code>.bib</code> at hand? <em>Try with an example</em> shows a
          saved run on a 30-reference example.
        </li>
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
          you haven't cited (missing <em>foundations</em>), and later work that cites your set
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
        Everything runs in your browser. To match your references, their titles and identifiers (DOI, arXiv or PubMed ID) are sent to
        OpenAlex. On the shared pool (the default), they pass through BibProfile's own proxy at{' '}
        <code>api.bibprofile.com</code>, which forwards them to OpenAlex and stores nothing; if you use
        your own key, queries go straight to OpenAlex and your key never touches our proxy. To find each
        reference, its title, first author and year are sent to Crossref (<code>api.crossref.org</code>);
        matched records are then fetched from OpenAlex. DOIs are also checked against Crossref for
        retractions (Crossref includes the Retraction Watch database). A “search Google Scholar” link
        sends that reference's title to Google only when you click it. Nothing is stored, there's no
        account, and there's no tracking.
      </p>

      <h3>The shared pool &amp; your own key</h3>
      <p>
        BibProfile uses a shared pool of OpenAlex credits, so you can just upload a <code>.bib</code>
        and go — no account, no key needed. That pool is limited, though, and can run dry on a busy
        day. It’s free for you either way: lookups by DOI or another identifier cost nothing, and a
        title search on OpenAlex uses 1 credit. If the pool runs out, come back tomorrow — or use your
        own OpenAlex key, for free: get one at{' '}
        <a href="https://openalex.org/settings/api" target="_blank" rel="noreferrer">openalex.org/settings/api</a>
        {' '}and click <strong>“Use your own free OpenAlex key”</strong> at the bottom of the page to get
        your own daily credits. Your key stays in your browser, is never stored, and is cleared when you reload.
      </p>

      <h3>Credits</h3>
      <ul className="about-list">
        <li>Bibliographic data from <a href="https://openalex.org" target="_blank" rel="noreferrer">OpenAlex</a>.</li>
        <li>Reference lookup and retraction data from <a href="https://www.crossref.org" target="_blank" rel="noreferrer">Crossref</a>, including <a href="https://retractionwatch.com" target="_blank" rel="noreferrer">Retraction Watch</a>.</li>
        <li>Built with React, Vite, and <code>@retorquere/bibtex-parser</code>.</li>
        <li>Built with the assistance of Claude (Anthropic's AI).</li>
        <li>
          Built by Florian David (ORCID:{' '}
          <a href="https://orcid.org/0009-0001-7990-3186" target="_blank" rel="noreferrer">0009-0001-7990-3186</a>).
        </li>
      </ul>

      <details className="version-history">
        <summary>Version history</summary>
        <ul className="about-list">
          {VERSIONS.map(v => (
            <li key={v.version}>
              <strong>{v.version}</strong> — {v.date} — {v.note}
            </li>
          ))}
        </ul>
      </details>

      <p className="about-contact muted">
        Questions or feedback? <a href="mailto:contact@bibprofile.com">contact@bibprofile.com</a>
      </p>
      <p className="about-contact muted">
        BibProfile is open source under the{' '}
        <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer">AGPL-3.0</a> licence, so
        anyone can check what it does with your file:{' '}
        <a href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">source code on GitHub</a>.
      </p>
    </div>
  )
}

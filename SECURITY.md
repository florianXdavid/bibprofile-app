# Security

BibProfile runs in the browser: your `.bib` file is never uploaded, and nothing is
stored. The only network calls are lookups to Crossref and OpenAlex (on the shared
pool through BibProfile's own proxy, `api.bibprofile.com`, which stores nothing).

If you find a security or privacy problem — for example a way the app could leak a
file's contents, or a user's own OpenAlex key, to anyone other than OpenAlex — please
write to **contact@bibprofile.com** rather than opening a public issue. You'll get an
answer, and credit if you'd like it.

This repository never contains secrets: the shared OpenAlex key lives only in the
proxy (a separate, private project), and `.env` is gitignored.

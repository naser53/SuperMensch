# SuperMensch: notes for Claude

Read `docs/handoff-en.md` first. It holds the rules, UI, effects, code map, decisions and
backlog. The Farsi version is `docs/handoff-fa.md`. Full Farsi rules: `docs/rules-fa.md`.

Working rules:
* Talk to the owner in **Farsi**. Write everything in Git (commits, README, comments, docs) in **English**.
* Plain JavaScript only (ES modules, Three.js). Never add Python.
* All rule numbers live in `js/config.js` (server only); the page's own numbers (animation, sound,
  colors, voice) in `js/look.js`. The page has no rules engine: see handoff section 12.3.
* Run `npm test` before every commit. After a deliberate rule change, run
  `node tests/golden.mjs --record`, and update `docs/rules-fa.*` and both handoff files.
* `npm run build` makes `server/public/index.html`, the game page of the server. Pushing to `main` deploys the
  server: on Cloudflare, and on the owner's Linux server (it pulls `main`; handoff 12.4). Keep
  `server/node/` working when the server code changes (`tests/linux-server.test.mjs`). The game is online only (owner, 2026-11-06): no offline file, nothing in the releases but notes.
* Keep screenshots and scratch files out of the repo.
* Ask the owner before expensive or ambiguous changes; small clear ones, just do.

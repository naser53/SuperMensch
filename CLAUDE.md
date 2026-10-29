# SuperMensch: notes for Claude

Read `docs/handoff-en.md` first. It holds the rules, UI, effects, code map, decisions and
backlog. The Farsi version is `docs/handoff-fa.md`. Full Farsi rules: `docs/rules-fa.md`.

Working rules:
* Talk to the owner in **Farsi**. Write everything in Git (commits, README, comments, docs) in **English**.
* Plain JavaScript only (ES modules, Three.js). Never add Python.
* All game numbers live in `js/config.js`.
* Run `npm test` before every commit. After a deliberate rule change, run
  `node tests/golden.mjs --record`, and update `docs/rules-fa.*` and both handoff files.
* `npm run build` makes `dist/supermensch.html`. Pushing to `main` publishes it to the `latest` release.
* Keep screenshots and scratch files out of the repo.
* Ask the owner before expensive or ambiguous changes; small clear ones, just do.

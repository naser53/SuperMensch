# SuperMensch

A multi-color *Mensch ärgere dich nicht*–style board game with a 3D board, written in
plain JavaScript. It runs completely in the browser — no server, no install, works offline.

Choose a **6-color six-arm board** (60 fields, 10 per corridor, shaped like the wooden
6-player boards) or the **4-color classic cross** (40 fields), played with **two colors per
player** or **one color per player**, against people at the same screen or the computer.

Languages: **English** (default), **فارسی** (right-to-left) and **Deutsch**.

## Play

* **One file:** download `supermensch.html` from the **Releases** page and open it in Chrome,
  Edge, Firefox or Safari. **v1.0.0** is the first finished version; `latest` is the newest build
  of `main`. What each version holds: [`CHANGELOG.md`](CHANGELOG.md). Code and font are inside that one file.
* **Online:** GitHub Pages publishes the same page (one-time setup: repository
  **Settings → Pages → Source: GitHub Actions**).

Move by clicking: click a die and then a piece, or a piece first (its possible fields show
yellow rings with the die value) and then a ring or a die. Use **Undo** to take back the first
move of a throw. The **View** button in the ribbon at the top has view presets and a
*Turn the board* mode for turning and zooming. **Info** shows the scoring tables and the move
log; **Scores** shows each piece's points over the board.

**Debug** in the ribbon is for testing the rules: every throw waits until you
set the dice on the board (click a die: +1, right-click: −1, or *Random*) and press *Continue*; computer
moves are shown first and wait for *Continue* too.

## Rules in the game

Two-color dice play (free split, burnt die, full use of both dice, sum moves, six first),
bonus throws for doubles, help for a stuck player (three dice, gift six), triple-dice cards,
the hunter, walls and castles (with castle-break declarations), scoring and piece ranks
(soldier, general, marshal; a hit general or marshal drops one rank instead of dying), tunnels (declared before the roll, paid with points, with
the debt rule at the threshold), and two dice levels (beginner, intermediate).

Not yet in the game: the castle-breaker special piece and point loans.
The fortress (four pieces in a row) is planned for the Pro version.

## Development

```
npm ci
npm test            # rule tests and the fixed-game regression check
npm run simulate    # computer-vs-computer games
npm run build       # dist/supermensch.html, the single-file game
```

While working on the code, serve the folder (`npx serve .` or any static server) and open
`index.html`; it loads the modules from `js/` directly. Every push runs the tests, builds the
page and publishes it to the `latest` release.

**Versions:** raise the version in `package.json` (and `package-lock.json`) and `js/version.js`,
add a section to `CHANGELOG.md` and push to `main`. When CI sees a version with no release yet,
it tags that commit `v<version>` and publishes a release with the built page and the changelog section.

After a deliberate rule change, record the fixed games again with
`node tests/golden.mjs --record`.

| Path | Purpose |
| --- | --- |
| `js/config.js` | All game parameters |
| `js/engine.js` | Rules engine (no graphics) |
| `js/ai.js` | Simple computer player |
| `js/boards.js` | Board geometry (six arms, classic cross) |
| `js/strings.js`, `js/i18n.js` | Texts and translation |
| `js/render3d.js` | 3D board with Three.js |
| `js/main.js` | Setup screen, ribbon, game loop |
| `js/debugcmd.js` | Debug console commands |
| `js/version.js` | The game version |
| `tests/` | Rule tests, fixed-game regression, simulations |
| `tools/build.mjs` | Builds the single-file page |
| `docs/rules-fa.docx`, `docs/rules-fa.md` | The rules document (Farsi) |
| `docs/handoff-en.md`, `docs/handoff-fa.md` | Project summary: rules, UI, effects, code, decisions, backlog |

The full game rules (Farsi, with diagrams) are in [`docs/rules-fa.docx`](docs/rules-fa.docx).

Font: Vazirmatn (SIL Open Font License, in `fonts/`).

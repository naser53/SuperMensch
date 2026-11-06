# SuperMensch

A multi-color *Mensch ärgere dich nicht*–style board game with a 3D board, written in
plain JavaScript. It runs completely in the browser — no server, no install, works offline.

Choose a **6-color six-arm board** (60 fields, 10 per corridor, shaped like the wooden
6-player boards) or the **4-color classic cross** (40 fields), played with **two colors per
player** or **one color per player**, against people at the same screen or the computer.

Languages: **English** (default), **فارسی** (right-to-left) and **Deutsch**.

## Play

* **One file:** download `supermensch.html` from the **Releases** page and open it in Chrome,
  Edge, Firefox or Safari. **v2.1.0** is the newest version (v1.0.4 was the first finished one); `latest` is the newest build
  of `main`. What each version holds: [`CHANGELOG.md`](CHANGELOG.md). Code and font are inside that one file.
* **Online with family (v2):** https://supermensch-dev.ndaneshi.workers.dev: pick a user and
  a room, the server throws the dice and everybody sees every throw live.

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
(soldier, general, marshal; a hit general or marshal drops one rank instead of dying), tunnels
(declared before the roll, paid with points, with the debt rule at the threshold), and three dice levels (beginner, intermediate, difficult).

The one-color game is the traditional game: no ranks, no tunnels, no walls and no castles
(so no castle-break declarations). The game with several colors per player has all of them.

Not in version 1 (planned for later versions): the castle-breaker special piece and point loans.
The fortress (four pieces in a row) is planned for the Pro version.

## Development

```
npm ci
npm test            # rule tests and the fixed-game regression check
npm run simulate    # computer-vs-computer games
npm run build       # server/public/index.html, the game page of the online server
```

While working on the code, serve the folder (`npx serve .` or any static server) and open
`index.html`; it loads the modules from `js/` directly. Every push runs the tests and builds the
page; a push to `main` deploys the online server. The game is online only (since v3.2.0).

**Versions:** raise the version in `package.json` (and `package-lock.json`) and `js/version.js`,
add a section to `CHANGELOG.md` and push to `main`. When CI sees a version with no release yet,
it tags that commit `v<version>` and publishes a release with the changelog section (no game file).

After a deliberate rule change, record the fixed games again with
`node tests/golden.mjs --record`.

**Voice chat (online server, v3.0.0):** in the Cloudflare dashboard open *Realtime*, create an
**SFU** application and a **TURN** key, and add their ids and tokens as repository secrets
`REALTIME_APP_ID`, `REALTIME_APP_TOKEN`, `TURN_KEY_ID`, `TURN_KEY_TOKEN` (the TURN pair is optional
but helps behind strict filters). The server deploy puts them on the Worker. Then tick **Voice** for
the players who may talk on the admin page. Cloudflare's free allowance is 1,000 GB a month for SFU
and TURN together; a speaker uses about 15 MB an hour.

| Path | Purpose |
| --- | --- |
| `js/config.js` | All rule parameters (server only) |
| `js/look.js` | The page's own numbers (animation, sound, colors) |
| `js/view.js` | The game as the page sees it, from the server's views and frames |
| `js/engine.js` | Rules engine (no graphics; server only) |
| `js/ai.js` | Simple computer player (server only) |
| `js/boards.js` | Board geometry (six arms, classic cross) |
| `js/strings.js`, `js/i18n.js` | Texts and translation |
| `js/render3d.js` | 3D board with Three.js |
| `js/main.js` | Room list, ribbon, online game loop |
| `js/debugcmd.js` | Debug console commands (for `tools/replay.mjs`) |
| `js/table.js` | A game plus its event list, for replay and the online game |
| `js/voice.js` | Voice chat in online games (WebRTC through Cloudflare Realtime) |
| `server/` | The online server (Cloudflare Worker); `server/voice.js` talks to Cloudflare Realtime |
| `js/version.js` | The game version |
| `tests/` | Rule tests, fixed-game regression, simulations |
| `tools/build.mjs` | Builds the single-file page |
| `docs/rules-fa.docx`, `docs/rules-fa.md` | The rules document (Farsi) |
| `docs/handoff-en.md`, `docs/handoff-fa.md` | Project summary: rules, UI, effects, code, decisions, backlog |

The full game rules (Farsi, with diagrams) are in [`docs/rules-fa.docx`](docs/rules-fa.docx).

Font: Vazirmatn (SIL Open Font License, in `fonts/`).

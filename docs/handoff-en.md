# SuperMensch: project handoff (English)

This file sums up everything decided while building SuperMensch: the rules, the interface,
the effects, the code layout, the reasoning behind choices, and what is still open.
Read it before you change anything. The Farsi version is [`handoff-fa.md`](handoff-fa.md).
The full rules in Farsi, section by section, are in [`rules-fa.md`](rules-fa.md) (same text as
`rules-fa.docx`).

State as of 2026-10-29, commit after `5bd6051`.

---

## 1. Project at a glance

* A multi-color *Mensch ärgere dich nicht*-style board game with a 3D board, in **plain
  JavaScript** (ES modules, Three.js 0.160.0). No server, works offline.
* Repo: https://github.com/naser53/SuperMensch (branch `main`).
* Deliverable: one self-contained file, `dist/supermensch.html`, with the code and the
  Vazirmatn font inlined (esbuild 0.20.2).
* Boards: **6 colors** (six arms, 60 fields, 10 per corridor) and **4 colors** (classic cross,
  40 fields).
* Modes: **two colors per player** (two dice) or **one color per player** (one die). People at
  the same screen and/or computer players.
* Languages: English (default), Farsi (right to left), German.

## 2. Working agreements

* **Language:** chat with the owner in **Farsi**. Everything in Git (commit messages, README,
  code comments, docs except the `-fa` files) in **English**.
* **JavaScript only.** The project once had a Python version; it was removed and the history
  rewritten so it never existed. Do not add Python.
* Commit and push after each finished feature; CI must pass.
* After a **deliberate** rule change, re-record the fixed games:
  `node tests/golden.mjs --record`. Never re-record to hide an unintended change.
* Every game number lives in `js/config.js`. Do not hard-code numbers elsewhere.
* Before a change that is expensive or ambiguous, ask the owner. Small, clear changes: just do them.
* When a rule changes, update the rules doc as well: the source is `content.js` (see §9),
  then `docs/rules-fa.docx`, `docs/rules-fa.md`, and these handoff files.
* The owner tests on Windows (local folder `C:\Claude\PRJ\SuperMensch`; it still has old
  Python leftovers and should be re-cloned) and his kids will use Android tablets.

## 3. Rules summary

Field numbers are for the 6-color board unless noted. Positions in code are relative to each
color's gate: `YARD = -1`, `TUN = -2`, `0..L-1` the track, `L..L+3` the nest.

### 3.1 Board and names
* Each color: a **yard** (H), a **gate** (first track field), a **threshold** (last track
  field, just before its own gate) and a **nest** Z1..Z4 (Z4 deepest). 4 pieces per color.
* **Corridors:** each run of 10 track fields, numbered per color: start (1), 2..5, final (6).
  The middle of a corridor is its field 5 (used by tunnels). The 4-color board has corridors
  start, 2, 3, final.
* Move notation: `R, 6, R1: H → 1`, `B, 4, B1: 13 → 17`, `R, 3, R1: 59 → R-Z2`.

### 3.2 Basics (both modes)
* A die is used only for a legal move. A piece leaves the yard only with a **6**, onto its own gate.
* Jumping over any piece is allowed (on the track and in the nest), except over an opponent's
  **castle**.
* One piece per field. Landing on an opponent **captures** it. Capturing your own pieces is
  never allowed (not even between your two colors); if nothing else is possible, that die burns.
* **Win and places:** the first player with all pieces of all colors in the nest wins. The game
  goes on until one player is left; the finishing order gives the places.

### 3.3 Dice in the two-color game
* Two dice per turn; use both if at all possible.
* **Free split:** give each die to a color, both dice to two pieces of one color, or the sum to one piece.
* **Burnt die:** if one color cannot move with either die, play one die (free choice) for the
  other color; the other die burns.
* **Full use:** if any way uses both dice, one of those ways must be chosen.
* **Sum move:** two steps in either order (even with a 6). The middle field must be legal; an
  opponent there is captured.
* **Six first:** only when an own piece of that color stands on its gate and one die is a 6, and
  the two dice go to two different pieces of that same color: the 6 is played first. This stops
  emptying the gate with the other die and then bringing in a new piece with the 6. It does not
  apply to two different colors, nor to a sum move, nor when the gate is empty.

### 3.4 Bonus throws
| Throw | Bonus | Chain |
| --- | --- | --- |
| 6 with another number | none | — |
| Non-6 pair (e.g. 3-3) | one throw of one die | goes on if the bonus die equals the pair number or is a 6; after a 6, only a 6 continues |
| A single 6 (bonus die, or one-color game) | one throw of one die | goes on while 6s come |
| 6-6 | one throw of two dice | goes on with another 6-6 |
| Three of a kind (castle-break declaration) | one throw of three dice | goes on with another triple |

* A bonus is given even when it cannot be used, or when a castle break fails.
* A single bonus die can be used by any piece of any color of the player; a 6 brings a piece in.
* An unusable bonus die that still matches the pair number earns the next throw.
* With three or four dice, a partial match gives the bonus for that many dice.

### 3.5 Help for a stuck player
A player is **stuck** when no piece is "alive" (none can move; hunters do not count).
* **Three dice:** throw three, keep two. An optional **second try** discards the first entirely.
  Kept dice play like a normal pair (a pair earns its bonus).
* **Gift six:** after `GIFT_SIX_N` = 6 stuck throws without a 6, a single 6 is given; bring a
  piece in, then the turn passes. Every 6 resets the counter. Each non-6 pair bonus die counts as
  a throw. If the count reaches N on the first try, the second try is played first.

### 3.6 One-color game
One die per turn; two-color-only rules do not apply. Every 6 throws again. Gift six after N
throws without a 6.

### 3.7 Triple-dice card
`TRIPLE_DICE_CARDS` = 3 per player per game. Declare before the roll; throw three, keep two, no
second try. A kept pair earns its bonus. Not for bonus throws. The free stuck triple does not
use a card.

### 3.8 Hunter
* When one color is complete and the other still has a live piece, the player may bring in a
  **hunter** in place of the complete color, so both dice are useful again.
* Enters only with a real 6, on the complete color's gate (not via triple or gift six). One at a time.
* On each entry the player declares **forward** or **backward**.
* Moves and captures like a normal piece and can be captured. Always circles, never enters a
  nest, builds no walls, uses no tunnels, does not take part in breaks by default
  (`HUNTER_CAN_BREAK`).
* Removed automatically when the other color has no live piece; can come back with a 6 later.

### 3.9 Walls and castles
* Same-color pieces on consecutive fields: 2 = **wall**, 3 or more = **castle** (a fortress of 4
  is Pro-only, off). Two colors of one player do not combine.
* **Breaking:** all pieces of the structure must be captured at once, each by its own die and its
  own piece; none of the single moves is legal alone. Breakers may be any color of the player.
* **Wall break:** only with the two dice of the same throw (no sum move).
* **Castle-break declaration:** before the roll; three dice; unlimited; does not use a card. A
  failure loses the turn but the triple bonus is still given. A long castle (4+) breaks by
  capturing any three of its pieces at once; the rest stay as whatever they now form.
* Opponents cannot jump over a castle; its owner can.
* **Gate right:** if a structure piece stands on an opponent's gate, that gate's owner may
  capture it by coming out of the yard with a 6.
* Structures change form as pieces are captured or move away.

### 3.10 Scoring and ranks
| Source | Points (6-color) | Points (4-color) |
| --- | --- | --- |
| Capture in the victim's corridor start / 2 / 3 / 4 / 5 / final | 1 / 3 / 6 / 10 / 15 / 23 | 1 / 4 / 8 / 10 |
| Extra: victim on its own gate | +5 | +5 |
| Extra: victim on its own threshold | +20 | +20 |
| Break a wall / castle (once per structure, plus the best captured piece) | +15 / +40 | +15 / +40 |
| Clean piece reaches the nest (never captured) | +5 | +5 |
| A nest is full (a color complete; the nest glows) | +60 | +25 |
| Finishing first / second | +100 / +50 | +40 / +20 |

* Hunter captures and capturing a hunter both score; the hunter's corridor counts from its
  complete color.
* **Ranks come from rank points**, the points a piece wins with its own captures since it last
  came in (rank multiplier included): **general** from `GENERAL_POINTS` = 15, **marshal** from
  `MARSHAL_POINTS` = 25. Stars over the pawn show the rank (general one, marshal two).
* A general's captures score ×2, a marshal's ×3 (from the capture after promotion).
* **Bounty:** capturing a general gives the capturer +10 and the owner −10; a marshal +15 / −15,
  on top of the normal points.
* Breaks do not count towards rank points, and the multiplier does not apply to break bonuses
  (`RANK_MULT_ON_BREAK` = false).
* **Ranked pieces survive a hit** (newest rule):
  * A soldier that is hit goes back to the yard.
  * A hit **general becomes a soldier**, a hit **marshal becomes a general**. The piece stays on
    the board and is pushed back to the first free field behind it; the attacker takes its
    field. Rank points reset to the start of the new rank (general 15, soldier 0). If no field
    behind is free, it goes to the yard.
  * Scoring is unchanged: the capturer gets normal points plus the bounty; the owner loses the bounty.
  * Applies everywhere: normal captures, wall and castle breaks, tunnel exits, and hunters
    (a hunter is pushed back against its running direction).
  * A blast and a board shake mark the hit (§5).
* The final score is what is left; points spent on tunnels stay spent. A finished player has no
  more turns; pending bonus dice are dropped.

### 3.11 Tunnels
* Each color has its own tunnels, from the middle (field 5) of one corridor to the middle of a
  later one. Up to `TUNNEL_MAX_SKIP` corridors (6-color: 3, up to corridor 4, or 5 by setting;
  4-color: 2, pairs 1→2, 1→3, 2→3). Never to the final corridor.
* Length is a quarter of the real path, rounded down: 1 corridor 10→2 fields, 2 corridors 20→5,
  3 corridors 30→7.
* **Cost** 80 / 120 / 160 for 1 / 2 / 3 corridors. Fully paid, no failure.
* **Declare** before the roll when the piece is at most 6 fields before the entrance
  (`TUNNEL_DECLARE_RANGE`). No cancelling. The chosen tunnel is shown; other players' tunnels
  appear paler.
* **Entering:** the piece moves to the entrance and uses the rest of the die inside. A die that
  does not reach the entrance burns; the declaration stays for later turns.
* **Inside:** one die at a time, no sum moves, no captures inside.
* **Exit:** leftover steps continue in the corridor. The exit captures any opponent, even pieces
  in walls and castles. After the exit the tunnel is gone.
* At most 2 active tunnels per player (`MAX_ACTIVE_TUNNELS`). Hunters never use tunnels.
* **Debt:** a player with 0 or more points may take a tunnel even if the score goes negative
  (debt up to that tunnel's cost). All points earned pay the debt. A tunnel piece that reaches
  its threshold while its owner is in debt does not enter the nest and makes one more full lap;
  wherever the debt is paid, it may enter again. Only that piece is held back.

### 3.12 Dice levels
Same dice for everybody at the table, chosen on the setup screen:
* **Beginner:** fair dice.
* **Intermediate:** a 6 comes with chance 0.1, each other number 0.18 (`six_chance`).

### 3.13 Not implemented yet (designed, in the rules doc)
* **Castle-breaker piece:** unlocks at 300 points; a precise strike (exact landing on the first
  castle piece with a die or the sum, about 40% chance) breaks the whole castle. Success costs
  300, failure 70% (210). The game shows the risk before the declaration.
* **Point loans** between players (lender agrees, up to own points, optional interest; repayment
  modes: settle in this game, open debt (Pro), on demand, by agreement). Only preset chat messages.
* **Pro version:** fortress of 4 (four dice to break, +100), fortress-breaker piece (500, fail
  350), permanent accounts, debts across games, tournaments.
* **Advanced dice level.**

## 4. Interface and interaction

### Setup screen
Language, board (6 or 4 colors), game type (two colors / one color per player), number of
players, where a player's two colors sit (opposite / next to each other), seats (click to switch
human/computer), **player names** typed in, dice level. *Start game*.

### Ribbon (top of the screen)
The old side panel is gone; the board takes the whole screen under a ribbon.
* Row 1: **player chips** (color dots, name, score, cards left, an hourglass when stuck, the place
  when finished; the current player is highlighted) and the **tools**: View, Scores, Info,
  Debug, language, computer speed, Menu (icons with tooltips; labels on wide screens).
* Row 2: whose turn and the round, and the **actions** of the moment: a big **die button** to
  roll (a small 3D die that turns slowly, so no face reads as a value), triple-dice card, castle-break declaration, **Tunnels (n)** (opens the
  list), Undo and *List of all moves* while moving, *Second try* / *Take the gift six*,
  *Continue* / *Random* in debug.
* Longer lists (all moves, which move, the tunnel declarations, the computer's plan, the final
  places) open in a card at the top left of the board (`#drop`).
* **Hints and warnings** (which die, which piece, keep two...) appear in a card at the bottom
  middle of the board when they change and fade after a few seconds (longer for longer text), so
  they never make the ribbon grow or scroll on a phone. The scores legend stays while the scores
  are shown.
* The rows wrap on narrow screens (phones get more rows). The View menu opens against the ribbon
  and is never wider than the screen.
* The dice are on the board (below). The move log is at the end of **Info** (scrollable).

### Dice on the board
* A throw lands in the **middle of the board**, tumbles, then hops to a free row **between the yard
  and the gate** (away from the yard pawns and the name) of the player whose turn it is (of a two-color player's yards, the one nearest the camera). The
  spots are fixed per color in `js/boards.js` (`dice`), chosen to keep clear of every field.
* The dice are clicked **there**. A die is never drawn smaller than about 28 px on the screen and
  has a larger invisible touch area (1.7× the die).
* States: usable dice have a pale yellow ring, the chosen die lifts and glows with a pulsing ring,
  a die the selected piece cannot use dims, a played die dims more, a **burnt** die gets a red
  cross. The kept two of three dice close up and the third fades. When the turn has passed (after
  the move animation) the dice fade out.
* The engine always decides the numbers; the animation only lands on them, so the engine stays
  deterministic.
* Computer throws follow the speed slider.

### Moving by clicks
Two orders work, and you can switch at any time:
* **Die first:** click a die (it alone is highlighted), then a piece. A piece that cannot move
  with it shows a "not allowed" sign that fades in half a second. If you click a piece before
  rolling or choosing, the piece stays highlighted and "First choose a die" appears.
* **Piece first:** click a piece. Only the dice it can use stay active, and **yellow target
  rings** with the die value appear on its possible fields. Click a ring or a die to move.
* After the first die is played, the **remaining die is selected automatically**.
* **Three dice** (stuck, card, castle break): click the two dice to keep; *Second try* where allowed.
* **Hunter:** with a 6, a pale waiting hunter with "?" stands on the gate; click it, then choose
  forward / backward.
* **Undo:** always visible; active only after the first move of a two-dice throw and before the
  second; greyed otherwise.
* **Debug:** every throw waits for you to set the dice on the board (click a die +1, right-click −1,
  or *Random*), then *Continue*; the dice are then thrown with those numbers. Computer moves are shown first and wait for *Continue*.
* Every legal option is reachable by clicks (verified on 10,000 decisions).

### View
* **View** button in the ribbon opens a menu that grows out of the button and folds
  back into it. Presets: Top, Angled, Low, Turn left, Turn right, My side, Turn the board to the
  player (follow).
* Board rotation and zoom work only in **Turn the board** mode, so clicking a piece never turns
  the board by accident. Pieces and dice cannot be clicked in that mode.
* The **player names** printed on the board turn with the camera, so they always read the right
  way up for the viewer.
* Responsive layout for landscape and portrait tablets and phones.

### Info
Scoring tables for the current board (corridor points, gate/threshold extras, breaks, ranks and
bounties, end bonuses, tunnel costs), a line with the dice level, and the move log. Signed Farsi
numbers are wrapped in `<bdi dir="ltr">`.

### Pieces
* Pawns in color with a number. Rank stars over the pawn: general ★, marshal ★★.
* The **hunter** is a pawn holding a bow; the arrow points in its running direction (forward or
  backward).

## 5. Effects and animations
* **Moves:** pieces hop field by field. Computer players wait for the animations.
* **Captures:** the victim flies back to its yard in a high arc. A demoted general or marshal
  flies to its pushed-back field instead.
* **Ranked hit (blast):** on the capture field an orange flash ball and a shock ring spread
  (about 0.8 s), 26 sparks fly out, and the camera shakes for about 0.55 s, fading out.
  Code: `Board3D.boom()`, `stepBoom()`, the shake in `frame()`.
* **Dice:** 3D dice thrown in the middle of the board (about 0.55 s of tumbling and bouncing),
  a short pause, then a hop to the player's yard (about 0.4 s). Not repeated after keeping two of
  three dice. Code: `Board3D.throwDice()`, `stepDice()`.
* **Triple-dice card:** a card with the three dice flies in over the board, and the three dice on
  the board glow for 2 s.
* **Full nest:** a burst of golden sparkles over the nest, then a lasting glow on its fields.
* **"Not allowed" sign** at the click point, fading in 0.5 s.
* **Scores view:** a card over every pawn with the points it has won and × captures; the game is
  locked until *Scores* is pressed again.
* **View menu:** grows out of the button and folds back into it.

## 6. Code map

| Path | Purpose |
| --- | --- |
| `js/config.js` | All game parameters; `Config.forBoard(n, level)`, `Config.LEVELS` |
| `js/engine.js` | Rules engine, no graphics |
| `js/ai.js` | Simple computer player (saves its triple-dice cards for good moments) |
| `js/boards.js` | Board geometry (six arms, classic cross), dice spots between yard and gate |
| `js/strings.js`, `js/i18n.js` | Texts in en / fa / de, translation; `shape()` and `num()` for Farsi digits |
| `js/render3d.js` | `Board3D`: 3D board with Three.js, animations, effects |
| `js/main.js` | `App`: setup screen, ribbon, click state machine, game loop |
| `css/style.css` | Layout, ribbon, card, menus, responsive rules |
| `tests/rules.test.mjs` | 37 rule tests (`node:test`) |
| `tests/golden.mjs`, `tests/golden.json` | Fingerprints of fixed games (regression) |
| `tests/simulate.mjs` | Computer-vs-computer games |
| `tools/build.mjs` | Builds `dist/supermensch.html` |
| `docs/` | Rules (docx, md) and these handoff files |
| `.github/workflows/ci.yml` | Tests, simulation, build, publish to the `latest` release |
| `.github/workflows/pages.yml` | GitHub Pages; fails until Pages is enabled |

### Engine model
* A state machine. `Game.pending` is the current Decision; its kinds are `pre_roll`, `keep`,
  `play`, `dice`. `Game.choose(option)` applies a choice. `Game.manual` turns on debug dice.
  `Game.sequences()` lists every legal click order. The engine is deterministic: the same dice
  and choices always give the same state (the basis for the online plan).
* State: `pos`, `kills` (rank points), `hunters` (`[color, abs, dir, rankPts]`), `scores`,
  `tunnels`, `tmark`, `hit`, `earned`, `hits`. Also `Game.over`, `places`, `winner`.
* Scoring: `_applyScore` → `_applyScoreCore`; `_credit()`; `_finalBonuses`; `rank(pts)`,
  `bounty(pts)`, `rankName(pts)`. Captures: `_capture()` (demotion and push-back, `cap.demoted`).
* Dice: `_die()` uses `six_chance`.

### UI model
* `Board3D`: pieces, hunter figures and ghost (`hunterFigure`, `aimHunter`, `turnToAim`),
  tunnels, target rings (`showTargets`), `pick()` returns `{target}` / `{piece}` / `{field}`,
  animations (`animateSteps`, `playMove`, `moverPath`), shine (`celebrate`, `stepShine`), blast
  (`boom`, `stepBoom`), scores sprites (`showScores`), `forbid(ev)`, views (`setView`,
  `setViewMode`). Dice: `throwDice`, `placeDice` (debug), `keepDice`, `clearDice`, `diceStates`,
  `glowDice`, `diceRolling`, `stepDice`; `pick()` also returns `{die}`. Upright names:
  `flatText(..., upright)`, turned in `frame()`.
* `App`: selection state `sel`, `boardClick`, `clickDie`, `movePiece`, `pieceDice`,
  `pieceTargets`, `replay(play)`, `busy()` (locks while animations, the dice throw, the card or the
  scores view run), `syncDice` (which dice the board shows and their states), `dieClick`, `cardEffect`, `toggleScores`, `checkNests`, `showInfo`,
  `openViewMenu`.

## 7. Build, test, release
```
npm ci
npm test            # 37 rule tests + fixed-game check
npm run simulate    # computer-vs-computer games
npm run build       # dist/supermensch.html
```
* During development serve the folder (`npx serve .`) and open `index.html`.
* Every push to `main` runs CI: tests, 3 simulated games, build, then publishes
  `supermensch.html` to the **latest** GitHub release (download and open it in a browser).
* GitHub Pages needs a one-time switch by the owner: Settings → Pages → Source: GitHub Actions.
* Browser checks were done with Playwright + Chromium (swiftshader WebGL); keep screenshots out
  of the repo (`*.png` is in `.gitignore`).

## 8. Decision log (why things are the way they are)
* **Click order:** first die-first only; then piece-first was added because players reach for
  pieces first. Both stay.
* **Six-first** was first too broad; the owner narrowed it to "an own piece of that color on its gate".
* **Single six:** a lone 6 always gives a bonus; a 6 paired with another number never does.
* **Ranks by points** (15 / 25) instead of capture counts (it started at 4 captures for marshal),
  so captures deep in the corridors count more.
* **Bounties** went 50/70 → 40/60 → **10/15**, in proportion to the rank thresholds.
* **Tunnel costs** 80 / 120 / 160.
* **End bonuses, option C:** simulations showed the end bonuses dominated on the 4-color board.
  Per-board numbers were chosen so captures stay 60–80% of the points and finishing first is
  worth more than one full nest.
* **Dice levels:** intermediate games were shorter in simulation (about 224 vs 325 rounds).
* **Dice on the board:** the owner wants the panel to shrink so the board can grow; the dice went
  first, then the whole panel became a ribbon on top. The dice settle between the yard and the
  gate, not on the yard (it is full of pawns; the owner asked for them a third of the way to the
  gate), and touch
  areas are larger than the dice so children can hit them on tablets.
* **Computer cards:** the computer used its three triple-dice cards in the first rounds. It now
  measures how much a third die would help this turn (the best kept pair of three against two
  dice, over all throws) and plays a card only when that is well above what it has seen so far.
  The bar drops as its cards run low or its pawns get home.
* **Upright names:** names turn smoothly with the camera instead of flipping by 180°.
* **Ranked survival:** dying as a general or marshal felt unfair; one rank down and a push back
  keeps the piece in play while the attacker still gets the full points.

## 9. Rules document
* Source: `content.js` + `build.js` (docx-js) + `diagrams.py`, kept in the working scratchpad,
  **not in the repo**. Output copied to `docs/rules-fa.docx`. `docs/rules-fa.md` is the same
  text as markdown (no diagrams).
* Online Claude Docs: "قوانین بازی — نسخه‌ی نهایی ۱" (the rules) and "SuperMensch — طرح
  نسخه‌ی آنلاین" (the online plan), in the owner's claude.ai artifacts.

## 10. Known limitations
* The computer player never breaks walls or castles, overspends on tunnels, and does not weigh
  the demotion rule.
* `pages.yml` fails until Pages is enabled.

## 11. Backlog
1. Done: the side panel became the ribbon on top (dice on the board first, then the ribbon).
2. Castle-breaker piece (§3.13).
3. Point loans.
4. Advanced dice level.
5. Smarter computer player (breaks, tunnel budget, ranked targets).
6. Online version (below). Not started; the owner said "not now".

## 12. Online plan (not started)
For about 10 trusted people (family; kids on Android tablets), free plans only.
* Game page on GitHub Pages; server on **Cloudflare Workers + Durable Objects** (one object per
  room, WebSocket, built-in SQLite). The rules engine runs in each browser; the server only holds
  rooms, relays moves (dice values + choices) and keeps the move list, so a refresh replays it.
  The player whose turn it is throws the dice (same path as debug dice). Later, for the public:
  server-side dice and move checking with the same engine.
* Accounts: a fixed list of about 10 users made by an admin (e.g. `Baran95`), pick a name from
  an icon list plus a 4-digit PIN **at every login, no auto-login**, nothing remembered on the
  tablet, idle logout (about 15 min), a logout button, no password saving in the browser,
  hashed PINs, temporary lock after wrong PINs, HTTPS only, a simple admin page.
* Tablets: "Add to Home screen" in Chrome, runs like an app.
* Updates: CI publishes page and server; the build stamps the commit id; the app checks for a
  new version every few minutes and on focus; reload silently outside a game, otherwise "new
  version after this game"; the server refuses old versions in rooms; a started game finishes
  on its version.
* Open questions: idle timeout, icon list vs typed name, lock rules, computer players online,
  stats and rankings, computer taking over for an absent player.

# SuperMensch: project handoff (English)

This file sums up everything decided while building SuperMensch: the rules, the interface,
the effects, the code layout, the reasoning behind choices, and what is still open.
Read it before you change anything. The Farsi version is [`handoff-fa.md`](handoff-fa.md).
The full rules in Farsi, section by section, are in [`rules-fa.md`](rules-fa.md) (same text as
`rules-fa.docx`).

State as of 2026-10-31: **version 2.0.0** (tag `v2.0.0`): the online family version (section 12) on top of
version 1.0.4, which the owner closed. The one-color game is
the traditional game (no ranks, tunnels, walls or castles); the game with several colors per player has
everything. The castle-breaker piece and point loans go into later versions.

---

## 1. Project at a glance

* A multi-color *Mensch ärgere dich nicht*-style board game with a 3D board, in **plain
  JavaScript** (ES modules, Three.js 0.160.0). No server, works offline.
* Repo: https://github.com/naser53/SuperMensch (branch `main`).
* Deliverable: one self-contained file, `dist/supermensch.html`, with the code and the
  Vazirmatn font inlined (esbuild 0.20.2).
* Boards: **6 colors** (six arms, 60 fields, 10 per corridor; or 84 fields, 14 per corridor, chosen per
  game as `setup.corridor` in admin and offline setup, `Config.CORRIDORS`, geometry `boardFor()` in
  `js/boards.js`) and **4 colors** (classic cross, 40 fields).
* Modes: **two colors per player** (two dice) or **one color per player** (one die). People at
  the same screen and/or computer players.
* Languages: English (default), Farsi (right to left), German.

## 2. Working agreements

* **Language:** chat with the owner in **Farsi**. Everything in Git (commit messages, README,
  code comments, docs except the `-fa` files) in **English**.
* **JavaScript only.** The project once had a Python version; it was removed and the history
  rewritten so it never existed. Do not add Python.
* Commit and push after each finished feature; CI must pass.
* **Versions:** `package.json` / `package-lock.json` and `js/version.js` (a test keeps them
  equal; the setup screen shows it), a section per version in `CHANGELOG.md`, and a tag
  `v<version>` on `main`. CI makes the tag itself: on a push to `main` with a version that has no
  release yet, it tags the commit and publishes the release (built page, changelog section). `latest` stays the newest build of `main`.
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
  Kept dice play like a normal pair (a pair earns its bonus). On the second try of a stuck player,
  with no 6 and no pair (nothing to keep could move), the dice show crossed out and the turn passes
  by itself (owner's request); the app holds the burnt dice (`Game.noMove`, `App.hold`) before
  the next player's throw.
* **Gift six:** after `GIFT_SIX_N` = 6 stuck throws without a 6, a single 6 is given; bring a
  piece in, then the turn passes. Every 6 resets the counter. Each non-6 pair bonus die counts as
  a throw. If the count reaches N on the first try, the second try is played first.

### 3.6 One-color game
One die per turn; two-color-only rules do not apply. Every 6 throws again. Gift six after N
throws without a 6.
* **Color choice:** each seat picks its own color on the setup screen (tap a color dot; a color
  another seat holds swaps the two seats). Stored in `setup.picks` (`App.fixPicks`, `App.pickColor`).
* **One-color game = the traditional game** (one color per player, both boards; owner's
  decision): no generals or marshals (`RANKS`), so no nest swap (`NEST_SWAP`); no tunnels
  (`TUNNELS` / `tunnels_on`); no walls or castles (`WALLS` off: pieces in a row protect nothing and
  block nothing; `CASTLES` off too, and on its own it would split a run of 3+ into walls of two) and so no castle-break declarations (`BREAK_DECL` /
  `break_decl_on`). All are config flags set by `Config.forBoard(n, level, "one")`. The game where
  a player has several colors keeps all of them. Scores stay. The hunter, cards and the three-dice
  stuck help are two-color only anyway: a stuck player throws one die, with the gift six (owner confirmed).

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
  is Pro-only, off). Two colors of one player do not combine. A color's threshold and its own gate
  are not consecutive: a piece on each makes no wall (owner, 2026-11-01).
* **Breaking:** all pieces of the structure must be captured at once, each by its own die and its
  own piece; none of the single moves is legal alone. Breakers may be any color of the player.
* **Wall break:** only with the two dice of the same throw (no sum move).
* **Castle-break declaration** (two-color game only; the one-color game has no castles): before the roll; three dice; unlimited; does not use a card. A
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
  `MARSHAL_POINTS` = 25. A star over the pawn shows the rank (general silver, marshal bright gold).
* A general's captures score ×2, a marshal's ×3 (from the capture after promotion).
* **Bounty:** capturing a general gives the capturer +10 and the owner −10; a marshal +15 / −15,
  on top of the normal points.
* Breaks do not count towards rank points, and the multiplier does not apply to break bonuses
  (`RANK_MULT_ON_BREAK` = false).
* **Ranked pieces survive a hit** (newest rule):
  * A soldier that is hit goes back to the yard.
  * A hit **general becomes a soldier**, a hit **marshal becomes a general**. The piece stays on
    the board and is pushed back at least `PUSHBACK_MIN` = 7 fields: to that field, or the first
    free field behind it, never past its own gate; the attacker takes its field. Rank points reset
    to the start of the new rank (general 15, soldier 0). If every field back to its gate is taken,
    it goes to the yard **keeping its rank and points** (owner's call). The yard piece with the
    most points is the one that enters first.
  * Scoring is unchanged: the capturer gets normal points plus the bounty; the owner loses the bounty.
  * Applies everywhere: normal captures, wall and castle breaks, tunnel exits, and hunters
    (a hunter is pushed back against its running direction).
  * A blast and a board shake mark the hit (§5).
* **Nest swap** (`NEST_SWAP`, newest rule, the owner's idea): a soldier in the nest with rank points
  (1..14), while its color has a piece in the yard, may spend a 6 instead of bringing a piece in:
  it comes out on its gate with its points and the yard piece takes its place in the nest. Hit
  later, it goes to the yard and its points go back to 0 as for any soldier. Neither piece gets
  the clean-piece bonus from a swap (both are marked as hit). Generals and marshals do not swap.
  In the move list: "Red 1 swaps with Red 2 and comes out on 1 with its points (6)"; by clicks:
  the 6, then the nest pawn. The computer values rank points a pawn in play carries
  (`AI_WEIGHTS.points`), so it swaps.
* The final score is what is left; points spent on tunnels stay spent. A finished player has no
  more turns; pending bonus dice are dropped.

### 3.11 Tunnels
Only in the game with several colors per player (`TUNNELS` / `tunnels_on` is off in the one-color
game: no declarations, no Tunnels button, no info table).
* Each color has its own tunnels, from the middle (field 5) of one corridor to the middle of a
  later one. Up to `TUNNEL_MAX_SKIP` corridors (6-color: 3, up to corridor 4, or 5 by setting;
  4-color: 2, pairs 1→2, 1→3, 2→3). Never to the final corridor.
* Length is a quarter of the real path, rounded down: 1 corridor 10→2 fields, 2 corridors 20→5,
  3 corridors 30→7.
* **Cost** 80 / 120 / 160 for 1 / 2 / 3 corridors. Fully paid, no failure.
* **Declare** before the roll when the piece is at most 6 fields before the entrance
  (`TUNNEL_DECLARE_RANGE`). Until the dice are rolled that turn it can be taken back with Undo
  (cost refunded; option `["untunnel", ...]`, owner's request); after the roll no cancelling. The chosen tunnel is shown; other players' tunnels
  appear paler.
* **Tunnels buttons:** one per color of the player, its icon in that color, with that color's count.
  It opens that color's list (each line with a color dot) and draws its tunnels on the board, faint, in
  the color; the one under the mouse is drawn full and thicker. A tap on a drawn tunnel (its tube, or
  the exit disc where tunnels from one entrance overlap) declares it, for phones without hover. A
  color with nothing to declare gets a dashed line with the reason (`Game.tunnelBlockers`: no piece
  on the track, no piece in range, the active-tunnel limit, or a negative score); the button opens
  even at (0), to read why.
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
human/computer), **player names** typed in, dice level. *Start game*. In the one-color game each
seat also shows the board's color dots to pick its color.

### Ribbon (top of the screen)
The old side panel is gone; the board takes the whole screen under a ribbon.
* Row 1: **player chips** (color dots, name, score, cards left, an hourglass when stuck, the place
  when finished; the current player is highlighted) and the **tools**: View, Scores, Info,
  Debug, language, animation speed (Slow / Medium / Fast; Fast is the v1 speed; `Config.ANIM_SPEEDS`), Menu (icons with tooltips; labels on wide screens). Menu (and
  Esc) asks first while a game is running: *Leave* or *Keep playing*; the computer waits meanwhile.
* Row 2: whose turn and the round, and the **actions** of the moment: a big **die button** to
  roll (a small 3D die that turns slowly, so no face reads as a value; it always stays in its
  place and is greyed out, standing still, until it is the human's time to roll), triple-dice card,
  castle-break declaration and tunnels (these three are also always shown, greyed out when they
  cannot be used; card and castle break only in the two-color game; on phones as icon + count), castle-break declaration, **Tunnels (n)** (opens the
  list), Undo while moving (the *List of all moves* button is hidden for now; the owner will
  decide later), *Second try* / *Take the gift six*,
  *Continue* / *Random* in debug.
* Longer lists (all moves, which move, the tunnel declarations, the computer's plan, the final
  places) open in a card at the top left of the board (`#drop`).
* **Hints and warnings** (which die, which piece, keep two...): on wide screens (over 900 px)
  under the status line in the ribbon. On narrow screens they appear in a small card at the top
  of the board, under the ribbon (at the bottom while a list card is open), when they change, and
  fade after a few seconds (longer for longer text), so the ribbon never grows or scrolls on a
  phone. The card lets clicks through. The scores legend stays while the scores are shown.
* The rows wrap on narrow screens (phones get more rows). The View menu opens against the ribbon
  and is never wider than the screen.
* The dice are on the board (below). The move log is at the end of **Info** (scrollable).

### Dice on the board
* A throw lands in the **middle of the board**, tumbles, then hops to a **straight row** in the free
  strip **between the yard and the corridor out of the gate**, parallel to the corridor, of the
  player whose turn it is (of a two-color player's yards, the one nearest the camera). The spots
  are fixed per color in `js/boards.js` (`dice`), chosen so the row keeps clear of every field and
  the yard pawns even at the largest die size (`max`: 1.6 on the cross, 1.25 on the narrower
  six-arm strip). The player names moved out of that strip.
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
* When an opponent's **wall or castle** stops the move, a wall or castle sign with a small "not
  allowed" badge pops up above that structure and shakes, and red rings pulse under its pieces
  (owner, 2026-11-01: signs and effects instead of written messages; `Game.blockerOf`,
  `Board3D.forbidStructure`).
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
* **Debug console** (a text box at the bottom left in debug mode, `js/debugcmd.js`; commands defined by
  the owner): `score 1 50` / `score 1 -50` adds or takes points from player 1; `move 1 s2R 33` puts
  player 1's Red pawn 2 on field 33 (color letters R B G Y P T; fields 1..L on the track, L+1..L+4
  in the nest, `y` = yard; a taken field is refused; the current decision is offered again);
  `dice 6 3 4` sets the dice: thrown at once before the roll (three dice use a card), set at once
  while the dice are being set, otherwise kept for the next throw with that many dice (`Game.queuedDice`).
* Every legal option is reachable by clicks (verified on 10,000 decisions).

### View
* **View** button in the ribbon opens a menu that grows out of the button and folds
  back into it. Presets: Top, Angled, Low, Turn left, Turn right, My side, Turn the board to the
  player (follow).
* Board rotation and zoom work fully in **Turn the board** mode, so clicking a piece never turns
  the board by accident. Pieces and dice cannot be clicked in that mode. Outside it, a drag that
  starts on a free spot (anything but a die, a piece or a target field, `freeSpot`) turns the
  board too, and the mouse wheel always zooms; only moving (right-drag) needs the mode. A plain
  click on a field still counts (hunter gate). The cursor shows a hand on free spots.
* A new game starts with the camera behind the (first) human player's yards, so their pieces are in
  front (`fitView(colors)`, `sideAz`); the square board seen over a corner gets a little more distance.
* The **player names** printed on the board turn with the camera, so they always read the right
  way up for the viewer.
* Responsive layout for landscape and portrait tablets and phones.

### Info
Scoring tables for the current board (corridor points, gate/threshold extras, breaks, ranks and
bounties, end bonuses, tunnel costs), a line with the dice level, and the move log. Signed Farsi
numbers are wrapped in `<bdi dir="ltr">`. A **Copy** button by the move log copies a game report for
debugging: version, board, mode, level, players and colors, online room and seats, debug mode, the
moves in English, and a JSON line with the setup, events and debug edits (`score`/`move` commands).
`node tools/replay.mjs <file> [N]` rebuilds that game (optionally stopping after N events) and checks
the fingerprint.

### Pieces
* Pawns in color with a number. A **progress line** up the front of the pawn (it turns with the
  camera) gets longer with every point the pawn has won itself, from its foot to its head at
  marshal (25); no empty track. Its color stands out on that pawn (light turquoise on red, yellow
  on blue, light pink on green, navy on orange, yellow on purple, coral on teal), with a thin dark
  edge. Rank star
  over the pawn: a general's is silver and turns gold as it nears marshal; a marshal's is bright
  gold with a small, soft glow (made smaller at the owner's request). The base ring is silver for a general, gold (with a second ring) for a marshal.
* The **hunter** is a pawn holding a bow; the arrow points in its running direction (forward or
  backward).

## 5. Effects and animations
* **Moves:** pieces hop field by field. Computer players wait for the animations.
* **Fireworks:** when the game is over, about 14 rockets rise from around the board and burst into
  colored sparks, all within about four seconds (`fireworks()`).
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
| `js/debugcmd.js` | Debug console commands: score, move, dice |
| `js/table.js` | `Table`: a game plus its event list (`{dice}`, `{pick}`); `Table.replay`, `fingerprint` (v2 online groundwork) |
| `js/ai.js` | Simple computer player (saves its triple-dice cards for good moments; `AI_WEIGHTS`) |
| `js/boards.js` | Board geometry (six arms, classic cross), name spots, dice rows between yard and corridor |
| `js/strings.js`, `js/i18n.js` | Texts in en / fa / de, translation; `shape()` and `num()` for Farsi digits |
| `js/render3d.js` | `Board3D`: 3D board with Three.js, animations, effects |
| `js/main.js` | `App`: setup screen, ribbon, click state machine, game loop |
| `css/style.css` | Layout, ribbon, card, menus, responsive rules |
| `tests/rules.test.mjs` | 37 rule tests (`node:test`) |
| `tests/table.test.mjs` | Table tests: events rebuild the same game |
| `server/` | v2 online server (section 12) |
| `tests/server.test.mjs` | Server logic tests |
| `tests/golden.mjs`, `tests/golden.json` | Fingerprints of fixed games (regression) |
| `tests/simulate.mjs` | Computer-vs-computer games |
| `tools/build.mjs` | Builds `dist/supermensch.html` |
| `tools/replay.mjs` | Rebuilds a game from the report of the Copy button in Info |
| `docs/` | Rules (docx, md) and these handoff files |
| `.github/workflows/ci.yml` | Tests, simulation, build, publish to the `latest` release |
| `.github/workflows/pages.yml` | GitHub Pages; fails until Pages is enabled |

### Engine model
* A state machine. `Game.pending` is the current Decision; its kinds are `pre_roll`, `keep`,
  `play`, `dice`. `Game.choose(option)` applies a choice. `Game.manual` makes every throw a `dice` decision.
  The app plays through a `Table` (`js/table.js`), whose engine is always manual: the table
  throws the dice itself (`autoDice`), except in debug mode, and logs every answer as an event.
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
npm test            # 37 rule tests + fixed-game check + table and server tests
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
  corridor, not on the yard (it is full of pawns), in a straight row parallel to the corridor (a
  slanted row let the third die land on the corridor), and touch
  areas are larger than the dice so children can hit them on tablets.
* **Computer reach and second color:** every pawn used to count the same, so with a 6 the
  computer often brought out another pawn of its first color instead of the first of its second.
  The owner pointed out that two colors in play reach and hit far more. The position value now
  adds, per opponent pawn one of ours can hit next turn, `reach` (half for 7..12 fields ahead),
  and `colors` per own color in play (`AI_WEIGHTS` in `js/ai.js`). In simulation (two-color
  game, 4-board, 200 games, seats switched) the new computer won 60% against the old one; an
  aggressive test player (twice the weights, 1.6× capture bonus) won 62% against the old one
  and about even (49%) against the new one.
* **Computer cards:** the computer used its three triple-dice cards in the first rounds. It now
  measures how much a third die would help this turn (the best kept pair of three against two
  dice, over all throws) and plays a card only when that is well above what it has seen so far.
  The bar drops as its cards run low or its pawns get home. The owner saw it stuck behind a castle
  at round 26 with three cards left: the bar now drops by `cardBlocked` (5) while one of its pawns
  has an opponent castle within six fields ahead (three dice give more 6s and more choices). In the
  castle scenario it went from 0/20 to 20/20 cards used. Spending simply because rounds pass
  (`cardPace`) lost in simulation (about 35% against 44% on the six-color board), so it stays 0.
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
6. Online version (section 12), in progress on the `v2` branch.

## 12. Online version (v2, in progress on the `v2` branch)
Agreed plan (2026-10-31): the claude.ai doc "طرح نسخه ۲ سوپرمنش: آنلاین خانوادگی". It replaces the
earlier sketch (browser dice, PINs).
* Family use, free plan, light security: no passwords; 10 users `user1`..`user10` made at the
  first start, renamed by the owner with the admin key (secret `ADMIN_KEY`). Only the admin makes
  rooms (owner, 2026-10-31: the room-maker role is gone; the old `can_create` column is unused).
* Pages (owner's redesign for children, 2026-10-31): `/` is the game itself. Its first page lists
  the open rooms with their players (`GET /api/games` adds `held`, the seats in play now); a child
  taps a room's names (several on one device) and Start, and plays without leaving the page. A tick
  "Offline game" shows the usual setup instead. `/admin` (`server/public/admin.html`) is settings
  only, behind the admin key: rename players, make rooms, delete rooms (two presses), and edit a
  room's players (a test aid: replace, add up to the board's places, remove; `editSetup` in
  `server/core.js`). The same number of players keeps the moves; another number starts the game
  again. Connected devices are closed with code 4001 (4000 = deleted) and go back to the first page. `/play?…`
  redirects to `/?…`. The game finds the server through `apiBase()`: its own host on workers.dev,
  else `Config.SERVER_URL` (the API sends CORS headers, so the downloaded file can reach it).
* **Cloudflare Workers + Durable Objects** (SQLite): `Lobby` (users, games, results) and one
  `GameRoom` per game. Each game has a GameID (`K7QX-42`, made by the server) and a GameName
  (typed by its creator); the lobby lists open games (idle 24 h → off the list, kept in history).
* **The server throws the dice** (crypto) and checks every move with the same engine (`Room` in
  `server/core.js`); computer seats are played by the server. Devices send `{pick}`, the server
  sends the new events to every device, which replays them (`Table`), so everybody sees the
  opponents' throws live. Several seats can sit at one device. A seat stays with the connected
  device that holds it until that device leaves (Exit sends `{t:"leave"}`, or its connection
  closes); then anyone may take it. The same browser (random token in localStorage
  `supermensch-device`) takes its seats back after a break (`claimSeats` in `server/core.js`;
  owner's rule for now, password login and moving a game to another device come in M3).
* Steps: M0 table layer (done) · M1 server, lobby, admin, dev page, deploy (done) ·
  M2 the 3D game on the server (`play?game=ID&seats=0,2`: `App.startOnline`; seats played elsewhere count
  as computer players on this device; server events are played one by one in `tick` → `nextEvent`) · M3 seats on one device, reconnect · M4 scores and history pages ·
  M5 lobby in the panel. Released early as v2.0.0 (owner) after M2 plus room makers and admin delete;
  M3 to M5 come as v2.x.
* Code: `server/worker.js` (routes, both Durable Objects, WebSocket protocol in its comments),
  `server/core.js` (no Cloudflare parts, tested in `tests/server.test.mjs`), `server/public/`
  (pages), `wrangler.toml`, `.github/workflows/server.yml` (deploys from `v2`; secrets
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ADMIN_KEY`).
* Local: put `ADMIN_KEY=...` in `.dev.vars`, run `npx wrangler dev`, open http://localhost:8787.
* **Colors on the first page** (owner, 2026-11-01): after tapping a name, a child picks the
  seat's colors on a small picture of the board (`roomColorsHtml`: each yard is a button, as the
  3D view first shows the board) (two in the two-color game; a tap replaces the older one) until a person makes
  the first move. First come, first served: colors of seats that picked already are grey; a color
  of a seat that has not picked (or of a computer) is swapped. `POST /api/games/<ID>/colors
  {seat, colors}` (`pickColors`, `colorsKeep`, `Room.recolor` in `server/core.js`): the
  throws before the first move stay, the rest is played again; devices in the game get
  `{t:"recolor"}` and load the new state. The admin page has no color choice.
* Git (owner, 2026-11-01, from v2.1.0): one long-lived branch, `main`. Each piece of work is a
  short branch with a PR into `main`; the branch is deleted after the merge. A push to `main`
  publishes `latest`, makes a release when the version is new, and deploys the server. The old
  `v2` branch is no longer used.

### 12.1 Reading a live game from a Claude thread (owner, 2026-11-01)
`GET /api/games/<ID>` returns `{ setup, events, fp, ... }` with no key (fine by the owner: anyone
with the GameID may read the moves). A thread fetches it and rebuilds the game with `Table.replay`
(as `tools/replay.mjs` does) to answer the owner's questions. The cloud environment allows the host
`supermensch-dev.ndaneshi.workers.dev`. No timestamps, connection or browser logs are stored, and
the owner does not want them. Debug mode stays off by default and hidden in the online game.

The owner and Claude talk about a game with these commands. They run on a **local copy**; the game
on the server never changes.
* `game ID` read that game · `at N` go to event N (none = the end) · `show` pieces, scores, turn,
  legal moves
* `dice 4 5` the dice of the current throw (always for the player whose turn it is)
* `play s2B 4` move Blue piece 2 with the die 4. In the two-color game one option is the whole
  throw, so `play s2B 4 s1R 5` names both steps; with one step, Claude lists the options left.
* `move 1 s2B 33`, `score 1 50` as in the debug console (`js/debugcmd.js`).
Pieces are written `s` + number + color letter (R B G Y P T), as in the debug console: `P` is
Purple, so it cannot also mean "piece".

# SuperMensch: project handoff (English)

This file sums up everything decided while building SuperMensch: the rules, the interface,
the effects, the code layout, the reasoning behind choices, and what is still open.
Read it before you change anything. The Farsi version is [`handoff-fa.md`](handoff-fa.md).
The full rules in Farsi, section by section, are in [`rules-fa.md`](rules-fa.md) (same text as
`rules-fa.docx`).

State as of 2026-11-04: **version 3.0.2** (3.0.0 was the voice chat release, section 12.2; see `CHANGELOG.md`). Version 2.0.0 was the online family version (section 12) on top of
version 1.0.4, which the owner closed. The one-color game is
the traditional game (no ranks, tunnels, walls or castles); the game with several colors per player has
everything. The castle-breaker piece and point loans go into later versions.

---

## 1. Project at a glance

* A multi-color *Mensch ärgere dich nicht*-style board game with a 3D board, in **plain
  JavaScript** (ES modules, Three.js 0.160.0). **Online only since v3.2.0** (section 12.3): the server
  throws the dice, checks the moves and plays the computers.
* Repo: https://github.com/naser53/SuperMensch (branch `main`).
* Deliverable: the online server; its game page `server/public/index.html` is one self-contained file
  with the code and the Vazirmatn font inlined (esbuild 0.20.2). No offline file any more.
* Boards: **6 colors** (six arms, 60 fields, 10 per corridor; or 84 fields, 14 per corridor, chosen per
  game as `setup.corridor` in admin and offline setup, `Config.CORRIDORS`, geometry `boardFor()` in
  `js/boards.js`), **8 colors** (eight arms, 80 fields, or 112 with 14 per corridor; owner, 2026-11-02:
  every rule of the 6-color board, only more corridors; 2 to 4 players with two colors, 2 to 8 with one)
  and **4 colors** (classic cross, 40 fields).
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
* Every game number lives in `js/config.js`. Do not hard-code numbers elsewhere. Its values are the defaults:
  the admin may change most of them for the whole server ("Game rules", section 12).
* Before a change that is expensive or ambiguous, ask the owner. Small, clear changes: just do them.
* When a rule changes, update the rules doc as well: the source is `docs/rules-fa.md` (see §9),
  then `docs/rules-fa.docx`, and these handoff files.
* The owner tests on Windows (local folder `C:\Claude\PRJ\SuperMensch`; it still has old
  Python leftovers and should be re-cloned) and his kids will use Android tablets.

## 3. Rules summary

Field numbers are for the 6-color board unless noted. Positions in code are relative to each
color's gate: `YARD = -1`, `TUN = -2`, `0..L-1` the track, `L..L+3` the nest.

### 3.1 Board and names
* Each color: a **yard** (H), a **gate** (first track field), a **threshold** (last track
  field, just before its own gate) and a **nest** Z1..Z4 (Z4 deepest; the nest fields show faint numbers 1..4). 4 pieces per color.
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
* **Burnt die:** if one color cannot move with either die, the other color plays one die (free
  choice) and the other die burns. Exception (`SIX_PRIZE`, owner, 2026-11-03): when the throw
  has a 6, that color plays both dice when it can (a piece that entered with the 6 goes on with
  the other die). When only one die can be played, the choice is free, except for a 6.
* **Six prize:** a 6 never burns when it can be played; then only the plays that use the 6 stay
  (`Game._sixPrize`, applied to every two-dice list in `playsFor`).
* **Full use:** if any way uses both dice, one of those ways must be chosen.
  Exception: a 6 that takes a piece from the track into its nest may be played alone; the other
  die burns (`SIX_INTO_NEST`, owner, 2026-11-02). These options come after the two-dice ones, so
  the option numbers of games in progress do not change.
* **Sum move:** two steps in either order (even with a 6). The middle field must be legal; an
  opponent there is captured.
* **Six first:** only when an own piece of that color stands on its gate and one die is a 6, and
  the two dice go to two different pieces of that same color, one of them the piece on the gate:
  the 6 is played first. This stops
  emptying the gate with the other die and then bringing in a new piece with the 6. It does not
  apply to two different colors, nor to a sum move, nor when the gate is empty, nor when neither
  of the two pieces stands on the gate, nor when the 6 does not bring a new piece in from the yard
  (the order changes nothing then; owner, 2026-11-02). Plays that only this last change allows are
  listed after the others, so games in progress keep their option numbers.

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
  the next player's throw. From v3.2.14 (owner; rooms with `setup.autoRetry`, Config `auto_retry`): a first
  try with no 6 and no pair where nothing can move throws the second try by itself (log "No 6 and no
  pair: second try."; `noMove.retry` shows the first dice crossed out for a moment). Older rooms
  replay without it.
* **Gift six:** after `GIFT_SIX_TURNS` = 4 stuck turns without a 6, a single 6 is given; bring a
  piece in, then the turn passes (owner's change in v2.1: counted per turn, it was 6 throws). The
  first try of a turn counts it; the second try only resets it on a 6. Every 6 resets the counter.
  In the 4th turn the second try is played first; still no 6, the gift comes.

### 3.6 One-color game
One die per turn; two-color-only rules do not apply. Every 6 throws again. Gift six after
`GIFT_SIX_N` = 6 throws without a 6.
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
* When one color is complete and the other still has a live piece out on the track (not only in
  the nest or the yard; owner, 2026-11-01), the player may bring in a
  **hunter** in place of the complete color, so both dice are useful again.
* Enters only with a real 6, on the complete color's gate (not via triple or gift six). One at a time.
* On each entry the player declares **forward** or **backward**.
* Moves and captures like a normal piece and can be captured. Always circles, never enters a
  nest, builds no walls, uses no tunnels, does not take part in breaks by default
  (`HUNTER_CAN_BREAK`).
* Removed automatically when the other color has no live piece out on the track (pieces that can
  still move inside the nest do not keep it; owner, 2026-11-05); can come back with a 6 later.

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
| Capture on the victim's own field 2 ... 59 (4-color: 2 ... 39) | the field's number | the field's number |
| Capture on the victim's own gate (field 1) | 6 | 6 |
| Capture on the victim's own threshold (last field) | 60 + 20 | 40 + 20 |
| Break a wall / castle (once per structure, plus the best captured piece) | +15 / +40 | +15 / +40 |
| Clean piece reaches the nest (never captured) | +5 | +5 |
| A nest is full (a color complete; the nest glows) | +60 | +25 |
| Finishing first / second | +100 / +50 | +40 / +20 |

Square points (`SQUARE_POINTS`, owner 2026-11-06): every color counts the track from its own gate
(field 1) to its own threshold (the last field: 40, 60, 80 or 112). A capture gives the field's
number in the victim's count, except `GATE_POINTS` = 6 on the gate, and on the threshold its number
plus `THRESHOLD_EXTRA` = 20 (4-color 60, 6-color 80, 8-color 100). The old corridor table (1 / 3 / 6 / 10 / 15 / 23, 8-color 1 ... 36, gate +5,
threshold +20) is still in `config.js` and comes back with `square_points: false`.

* Hunter captures and capturing a hunter both score; the hunter's corridor counts from its
  complete color.
* **Ranks come from rank points**, the points a piece wins with its own captures since it last
  came in (rank multiplier included): **general** from `GENERAL_POINTS` = 70, **marshal** from
  `MARSHAL_POINTS` = 100. A star over the pawn shows the rank (general silver, marshal bright gold).
* A general's captures score ×2, a marshal's ×3 (from the capture after promotion).
* **Bounty:** capturing a general gives the capturer +35 and the owner −35; a marshal +50 / −50,
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
  later one. Up to `TUNNEL_MAX_SKIP` corridors (6-color: 3, up to corridor 4, or 5 by setting; 8-color: 3, up to corridor 6;
  4-color: 2, pairs 1→2, 1→3, 2→3). Never to the final corridor.
* Length is a quarter of the real path, rounded down: 1 corridor 10→2 fields, 2 corridors 20→5,
  3 corridors 30→7.
* **Cost** 80 / 120 / 160 for 1 / 2 / 3 corridors. Fully paid, no failure.
* **Declare** before the roll when the piece is at most 6 fields before the entrance
  (`TUNNEL_DECLARE_RANGE`). Until the dice are rolled that turn it can be taken back with Undo
  (cost refunded; option `["untunnel", ...]`, owner's request); after the roll no cancelling. While choosing (Tunnels list open), the tunnels on offer are drawn as lines
  only; a declared tunnel shows its line with the circles of its fields. The chosen tunnel is shown; other players' tunnels
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
* **Exit:** leftover steps continue in the corridor. From the exit on the piece is a normal one: it
  breaks a wall or castle only together with other pieces (section 3.9) and cannot jump a castle (owner,
  2026-11-09, game YJET-19; before, the exit hit even pieces in walls and castles). After the exit the tunnel is gone.
* **Shown through the tube** (owner, 2026-11-09): a move that uses a tunnel walks to the entrance, then
  through the tube's cells, and out along the corridor (`Board3D.tunnelPath`), not over the fields in between.
* At most 2 active tunnels per player (`MAX_ACTIVE_TUNNELS`). Hunters never use tunnels.
* **Debt:** a player with 0 or more points may take a tunnel even if the score goes negative
  (debt up to that tunnel's cost). All points earned pay the debt. A tunnel piece that reaches
  its threshold while its owner is in debt does not enter the nest and makes one more full lap;
  wherever the debt is paid, it may enter again. Only that piece is held back.

### 3.12 Dice levels
Same dice for everybody at the table, chosen on the setup screen:
* **Beginner:** fair dice.
* **Intermediate:** a 6 comes with chance 0.1, each other number 0.18 (`six_chance`).
* **Difficult** (owner, 2026-11-02): half of intermediate. Two dice are thrown together from one
  table (`TWO_DICE`): at least one 6 9.5% (intermediate 19%), 6-6 0.5%, each other pair 1.62%
  (all pairs 8.6% against 17.2%); the other throws share the rest. A single die (bonus) and three
  dice use `six_chance` = 0.05. Chosen on the setup screen and in the admin page.

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
Language, board (6, 8 or 4 colors), game type (two colors / one color per player), number of
players, where a player's two colors sit (opposite / next to each other), seats (click to switch
human/computer), **player names** typed in, dice level. *Start game*. In the one-color game each
seat also shows the board's color dots to pick its color.

### Panel (floating over the board, v2.3.0)
The board takes the whole screen; the panel floats over it (layout B, *dock*; owner's trial of three layouts, 2026-11-02).
* Top, floating on the board (owner: no separate bar): the player chips (they wrap; on narrow screens only the colors and the score), a **Scores** button (star; it took the place of the old View button, owner, 2026-11-04) and one **menu button**; its drawer holds Info, Debug, language, speed, sound and Menu (leave).
* Under them: whose turn, in a pill. Hints show in the fading card under it.
* Bottom: a dock with the tunnel buttons and the card on the left, the big round **die button** raised in the middle, then Second try, the other buttons (gift six, continue...) and undo.
* **Tunnels** (owner, 2026-11-02): a Tunnels button opens no written list; its color's tunnels are drawn on the board with the cost over each exit (−80 / −120 / −160, `Board3D.textSprite`), and a tap on one declares it. A color with none gets a short message at the top for 2 s (`App.flash`, `tun_short_*`).
* **Points over the pieces** (owner): once a move has landed, what each capturing piece won pops up over its head in green (+), and a hit general or marshal shows its player's loss (the bounty) in red (−); they stay about half a second and fade (`App.scorePops`, `Board3D.popOver`, CSS `.pop`). Each step shows its own effects (points, a new general or marshal look) as soon as that piece lands, not after the last die (owner, 2026-11-07, game VHQK-75): the server's step states carry the points of the captures so far (`scoredStates` in `server/frames.js`, for the frames' steps and the click-by-click sequences; the engine still scores the play as a whole). A wall or castle break shows its points with its last step.
* **Winner** (owner, 2026-11-04): with the fireworks (in the winner's first color), all the winner's pieces rise and fall slowly one after the other, like a wave (`Board3D.wave` / `waveY`; `WAVE_HEIGHT`, `WAVE_SPEED`, `WAVE_STEP` in `js/render3d.js`; the winner is the first of `places`). It replaced the big pawn in the middle. No card with the final places opens any more (the chips show the places).
* **Play again** (owner, 2026-11-02): the game-over panel has "Play again" next to "New game". Offline it starts a new game with the same setup. Online (only a device that holds seats) it sends `{t:"again"}`; the room makes one next game, once, with the same players, colors and settings and the name plus " (2)" (`nextName`), keeps its id in meta `next`, and sends `{t:"again", id}` to every device, which moves there with its own seats.

The notes below are from the ribbon on top; what each part does still holds, only where it sits changed. The code keeps the old names (`#ribbon`, `rb-*`): the ribbon is now a see-through layer.
* Row 1: **player chips** (color dots, name, score, cards left, an hourglass when stuck, the place
  when finished; the current player is highlighted) and the **tools**: View, Scores, Info,
  Debug, language, animation speed (Slow / Medium / Fast; Fast is the v1 speed; `Config.ANIM_SPEEDS`), sound on/off, Menu (icons with tooltips; labels on wide screens). Menu (and
  Esc) asks first while a game is running: *Leave* or *Keep playing*; the computer waits meanwhile.
* Row 2: whose turn and the round, and the **actions** of the moment: a big **die button** to
  roll (the owner's Dice3D die: a rounded 3D die in a small glass orb that turns slowly, so no face reads as a value, faster on hover; `js/rolldie.js` keeps the button's round face, its colour, pulse and die, in one layer laid over the see-through button, so it is never rebuilt with the ribbon and on/off eases with a spring instead of jumping; without WebGL the old CSS cube shows; it always stays in its
  place and is greyed out, standing still, until it is the human's time to roll), triple-dice card,
  **Second try** right beside it (an icon only, a turning arrow open at its start; always shown, greyed out
  when it cannot be used), triple-dice card and tunnels (also always shown, greyed out when they
  cannot be used; the card only in the two-color game; on phones as icon + count). The tunnel
  buttons show only the tunnel icon and the count (the word "Tunnels" is in the tooltip) and open
  the list. The **castle-break button is hidden for now** (owner's call; `SHOW_BREAK_BTN` in
  `js/main.js`, its code stays). Undo while moving (the *List of all moves* button is hidden for
  now; the owner will decide later), *Take the gift six*,
  *Continue* / *Random* in debug.
* Longer lists (all moves, which move, the tunnel declarations, the computer's plan, the final
  places) open in a card at the top left of the board (`#drop`).
* **Hints and warnings** (which die, which piece, keep two...): on wide screens (over 900 px)
  under the status line in the ribbon. On narrow screens they appear in a small card at the top
  of the board, under the ribbon (at the bottom while a list card is open), when they change, and
  fade after a few seconds (longer for longer text), so the ribbon never grows or scrolls on a
  phone. The card lets clicks through. The scores legend stays while the scores are shown.
* The rows wrap on narrow screens (phones get more rows).
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
* After the first die is played, the **remaining die is selected automatically**. Then a tap on a
  piece moves it with that die, and so does a tap on the **field where a piece lands** with it
  (owner, 2026-11-03: tapping field 12 after 9 to 10 did nothing). Keeping the moved piece selected
  with its next field in yellow was tried and dropped the same day: on the phone no tap was taken.
* **Three dice** (stuck, card, castle break): click the two dice to keep; *Second try* where allowed.
* **Hunter:** with a 6, a pale waiting hunter with "?" stands on the gate; click it, then choose
  forward / backward.
* **Undo:** always visible; active only after the first move of a two-dice throw and before the
  second; greyed otherwise.
* **Debug:** every throw waits for you to set the dice on the board (click a die +1, right-click −1,
  or *Random*), then *Continue*; the dice are then thrown with those numbers. Computer moves are shown first and wait for *Continue*.
* (Offline only, removed in v3.2.0; `js/debugcmd.js` stays for `tools/replay.mjs`.) **Debug console** (a text box at the bottom left in debug mode, `js/debugcmd.js`; commands defined by
  the owner): `score 1 50` / `score 1 -50` adds or takes points from player 1; `move 1 s2R 33` puts
  player 1's Red pawn 2 on field 33 (color letters R B G Y P T, and N K for pink and black on the 8-color board; fields 1..L on the track, L+1..L+4
  in the nest, `y` = yard; a taken field is refused; the current decision is offered again);
  `dice 6 3 4` sets the dice: thrown at once before the roll (three dice use a card), set at once
  while the dice are being set, otherwise kept for the next throw with that many dice (`Game.queuedDice`).
* Every legal option is reachable by clicks (verified on 10,000 decisions).

### View
* The **View** button (camera icon) and its menu of presets were removed (owner, 2026-11-03).
  The board turns by dragging a free spot and zooms with the wheel or a pinch.
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
Scoring tables for the current board (capture points by field number with the gate and threshold
exceptions, or the old corridor points, breaks, ranks and
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
  on blue, light pink on green, navy on yellow, yellow on purple, coral on teal, light green on pink, light
  sky blue on black), with a thin dark edge. The 8-color board adds **pink** and **black** (owner's
  pick, 2026-11-02: both stand apart from the six colors; orange was left out, it read as brown). Rank star
  over the pawn: a general's is silver and turns gold as it nears marshal; a marshal's is bright
  gold with a small, soft glow (made smaller at the owner's request). The base ring is silver for a general, gold (with a second ring) for a marshal.
* The **hunter** is a pawn carrying an arrow at its side (no bow, owner 2026-11-02; short and thick, at head height, through the
  middle of the pawn, moved 5% of its length towards the tip, 2026-11-03); the arrow points in
  its running direction (forward or backward).
* **Hunter's way in:** when the hunter can enter both ways, a small bubble pops up over the waiting
  hunter on the board (not a list in the panel) with two buttons, Forward and Back; each button's
  arrow points, on screen, the way the hunter would run from its gate (`Board3D.hunterChoice`).

## 5. Effects and animations
* **Moves:** pieces hop field by field. Computer players wait for the animations.
* **Rank look after the move:** the points bar, star, rings and halo of a pawn change only once
  its move and captures have been shown (`queueLook`/`stepLooks`); a demoted victim loses its look
  when it lands.
* **Fireworks:** when the game is over, 8 rockets rise near the edge of the board and burst into
  sparks in the winner's first color and two lighter tints, all within about three seconds (`fireworks(color)`).
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
* **Short messages** (owner, 2026-11-03; `flashBanner`, CSS `.card-fx-card.quick`): a smaller card of
  the same look pops up and fades within 1 s, blocking nothing. On every device: a stuck player's
  three dice ("Naser is stuck: three dice!" with the dice) and the gift six (`throwBanners`, from the
  new `log_stuck` / `log_gift` entries of a move). A tap on a player chip at the top shows that
  player's colors and name in a small card right under that chip, for 1.5 s. The Info page names the online game (name and code).
* **Wall or castle built** (owner, 2026-11-04; `Board3D.buildFx`, CSS `.build-fx`, `.build-ring`): when a
  move makes a new wall, or turns pieces into a castle, the wall sign (bricks) or a castle picture with
  a flag in the builder's color pops up above its pieces once the mover has landed, golden rings glow
  under them, and all fades out within about 1.5 s. On every device (it runs from `animateSteps`).
* **Tunnel declared** (owner, 2026-11-07; `Board3D.tunnelFx`, same CSS): a tunnel sign (a stone arch
  with a rim in the piece's color) pops up above the piece that declared a tunnel, with a golden ring
  under it, and fades within about 1.5 s. On every device (from `App.choose`).
* **Full nest:** a burst of golden sparkles over the nest, then a lasting glow on its fields.
* **"Not allowed" sign** at the click point, fading in 0.5 s.
* **Scores view:** a card over every pawn with the points it has won and × captures; the game is
  locked until *Scores* is pressed again. A piece that loses its points (a soldier captured to the
  yard, a general pushed back as a soldier) starts again from 0 and × 0; a general or marshal that
  goes to the yard with its rank keeps them (owner, 2026-11-06; `_capture` resets `earned`, `hits`).
* **Sound effects** (`js/sound.js`, Web Audio API): the dice throw is a recording the owner chose,
  one for a single die (`sounds/dice-one.mp3`, 0.8 s) and one for two or three dice
  (`sounds/dice-many.mp3`, 1.25 s), carried as base64 in `js/dicesound.js` and played once per
  throw so the first hit meets the first bounce (owner, 2026-11-02); the rest is synthesized: a wooden clack
  like a chess piece when a piece lands; a small blast when a piece is captured, a stronger one
  with a rumble when a general or marshal is hit; three knocks on a door when a triple-dice card is
  played; a rising chime when a piece comes out of the yard onto its gate (also a hunter); a whistle
  and a crackling burst for each firework rocket at the end. A speaker button in the ribbon
  (before Menu) switches them on or off, saved in the browser; loudness `Config.SOUND_VOLUME`.
  Browsers start audio only after the first click or key.

## 6. Code map

| Path | Purpose |
| --- | --- |
| `js/config.js` | All rule parameters (defaults); `Config.forBoard(n, level, mode, corridor, rules)`, `Config.LEVELS`, `Config.RULES` (what the admin may set) (server only) |
| `js/look.js` | The page's own numbers: animation, sound, colors, server address, voice (`Look`) |
| `js/view.js` | The page's game: `ViewGame`, `RemoteTable`, `decode`; reads the server's views and frames (section 12.3) |
| `js/engine.js` | Rules engine, no graphics (server only since v3.2.0) |
| `js/debugcmd.js` | Debug console commands: score, move, dice (`tools/replay.mjs` only) |
| `js/table.js` | `Table`: a game plus its event list (`{dice}`, `{pick}`); `Table.replay`, `fingerprint` (v2 online groundwork) |
| `js/ai.js` | Simple computer player (server only) (saves its triple-dice cards for good moments; `AI_WEIGHTS`) |
| `js/boards.js` | Board geometry (six or eight arms, classic cross), name spots, dice rows between yard and corridor |
| `js/strings.js`, `js/i18n.js` | Texts in en / fa / de, translation; `shape()` and `num()` for Farsi digits |
| `js/sound.js` | Sound effects: the dice recording, the rest synthesized (move, capture, knock, gate, fireworks) |
| `js/dicesound.js` | The dice-throw recordings (`sounds/dice-one.mp3`, `sounds/dice-many.mp3`) as base64 |
| `js/rolldie.js` | The roll button's Dice3D die: one persistent face layer over the button, one animation loop, spring-eased on/off |
| `js/render3d.js` | `Board3D`: 3D board with Three.js, animations, effects |
| `js/main.js` | `App`: room list, ribbon, click state machine, online game loop |
| `css/style.css` | Layout, ribbon, card, menus, responsive rules |
| `tests/rules.test.mjs` | 37 rule tests (`node:test`) |
| `tests/table.test.mjs` | Table tests: events rebuild the same game |
| `server/` | v2 online server (section 12) |
| `tests/server.test.mjs` | Server logic tests |
| `tests/golden.mjs`, `tests/golden.json` | Fingerprints of fixed games (regression) |
| `tests/simulate.mjs` | Computer-vs-computer games |
| `tools/build.mjs` | Builds `server/public/index.html` |
| `tools/replay.mjs` | Rebuilds a game from the report of the Copy button in Info |
| `docs/` | Rules (docx, md) and these handoff files |
| `.github/workflows/ci.yml` | Tests, simulation, build, a notes-only release for a new version |
| `server/frames.js` | Views and frames for the page: the game as the page reads it, with the rules' answers worked out |

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
npm run build       # server/public/index.html (the game page of the server)
```
* During development serve the folder (`npx serve .`) and open `index.html`.
* Every push to `main` runs CI: tests, 3 simulated games, build; a new version gets a release with its
  notes only (no game file, no `latest` release since v3.2.0). `server.yml` deploys the server.
* No GitHub Pages: its workflow was removed (owner, 2026-11-05); the game is the release file and the online server.
* Browser checks were done with Playwright + Chromium (swiftshader WebGL); keep screenshots out
  of the repo (`*.png` is in `.gitignore`).

## 8. Decision log (why things are the way they are)
* **Click order:** first die-first only; then piece-first was added because players reach for
  pieces first. Both stay.
* **Six-first** was first too broad; the owner narrowed it to "an own piece of that color on its gate",
  and on 2026-11-01 to "one of the two moving pieces is that piece on the gate".
* **Single six:** a lone 6 always gives a bonus; a 6 paired with another number never does.
* **Ranks by points** (70 / 100 since v3.2.9, owner; 90 / 140 in v3.2.4 to v3.2.8; 40 / 60 before, 15 / 25 before field points) instead of capture counts (it started at 4 captures for marshal),
  so captures deep in the corridors count more.
* **Bounties** went 50/70 → 40/60 → 10/15 → 20/30 (v3.2.5) → **35/50** (v3.2.9, half of each rank threshold, owner).
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
* Source (from 2026-11-03): **`docs/rules-fa.md`**. `docs/rules-fa.docx` is built from that text
  (a docx-js script in the working scratchpad, **not in the repo**, Vazirmatn embedded) plus 10
  figures: the 6-, 8- and 4-color boards (drawn from the geometry in `js/boards.js`), piece life
  cycle, turn flow, hunter forward/backward, walls and castles, ranks, precise strike and tunnels.
  On a rule change, edit the md first, then rebuild the docx. The section numbers (§1 to §17) are
  used in code and tests and do not change.
* Online Claude Docs: "قوانین بازی — نسخه‌ی نهایی ۱" (the rules) and "SuperMensch — طرح
  نسخه‌ی آنلاین" (the online plan), in the owner's claude.ai artifacts.

## 10. Known limitations
* The computer player never breaks walls or castles, overspends on tunnels, and does not weigh
  the demotion rule. Since v3.2.11 it declares a tunnel only for a pawn at most 3 fields before the
  entrance (`AI_WEIGHTS.tunnelReach`) and values a declared pawn by most of the fields its tunnel
  saves (`AI_WEIGHTS.tunnelHope`), so it uses the tunnels it paid for (game RBEM-40).
* **Computer levels** (owner, 2026-11-07; v3.2.13): each room has one, set by the admin (`setup.engine`,
  `ENGINE_LEVELS` / `engineFor` in `js/ai.js`). Beginner: the computer of v3.2.11. Intermediate: a general
  or marshal keeps its points value in the nest (`nestKeep`), and the danger from an opponent 1..6 fields
  behind grows with the pawn's rank points and bounty (`risk`), so it no longer leaves a marshal next to the
  nest (game RBEM-40, turns 104 and 112). Hard: intermediate plus the next player's best answer to each of
  its 4 best plays, averaged over every throw (`look`, `_afterReply`).

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
  again. Connected devices are closed with code 4001 (4000 = deleted) and go back to the first page.
  **Tabs** (owner, 2026-11-09): the admin page has four tabs, Rooms (the default), Players (with
  voice chat), Initial settings (the game rules, one group of `Config.RULES` after the other) and
  Look (colors, points look, hunter); the last one open is kept in localStorage `adminTab`. Inside
  a tab each group has its title and a short note on one side and its controls on the other.
  **Admin languages** (owner, 2026-11-07; v3.2.12): the admin page speaks the game's languages (en, fa, de)
  with a menu at the top; it reads and writes the game page's saved language (localStorage
  `supermensch`.lang), so both follow one choice. Texts in `js/admin-strings.js` (rule labels
  `rule_<key>`, groups `grp_<group>`, known server errors `err_<message>`; a missing one falls back to
  English). A finished room shows a 🏁 "Finished" badge and its winner in the room list.
  **Hunter weapon** (owner, 2026-11-03): the admin page chooses what the hunter carries, Arrow or
  Sword, for the whole server (`POST /api/admin/hunter`, Lobby `settings` key `hunter`, sent with
  `/api/settings` as `hunter`; `setHunterWeapon` / `Board3D.hunterWeapon` in `js/render3d.js`).
  **Points look** (owner, 2026-11-03): the admin page chooses how a pawn shows its own points, for the
  whole server: Bar (`progressBar`) or Ring (the default since 2026-11-04, owner; a thin ring that touches the body all round, the
  owner wants no band; it climbs from the foot to two thirds of the pawn's height up to general,
  then from the foot again up to marshal; a marshal has no ring but a bigger halo and a golden
  glow) or Stacked rings (`stack`, owner, 2026-11-09: STACK_N = 12 rings that pile up from the foot
  to the neck, just under the collar, each a share of the way to general and overlapping the one below by
  about a third, see-through at 60% opacity, `Look.STACK_OPACITY`, which the admin may set from 20 to 100% next to the points look (settings key `opacity`, sent with `/api/settings` as `opacity`, with `opacityDefault`); then they pile up again to marshal; a marshal glows like with Ring). `POST /api/admin/points`, Lobby `settings` key `points`, `/api/settings` as `points`;
  `setPointsLook` / `applyLook` / `pawnRadius` in `js/render3d.js`.
  **One Debug panel** (owner, 2026-11-04): Place pieces and Debug are one button, **Debug**, with one
  large text box (one command per line, run in order: piece lines go to `admin/place`, `rewind` /
  `roll dice` / `reset` to `admin/debug`, `rename Name` to `admin/renamegame`, which sets the room's
  name in the Lobby and in the room's meta and reloads the devices), an **i** button with a popup of
  the commands, and the pieces and dice turns shown under it. The text box keeps the text on an error.
  **Place pieces** (owner, 2026-11-03; a test aid): a room's pieces can be put anywhere from the admin
  page, one line per color (`R: 4 z1 y y`) or per piece (`R2 23`, `R2z 3` = red 2 to nest field 3;
  owner, 2026-11-04): 1..L track as on the board, z1..z4 the color's nest (z1 just inside; L+1.. still
  works), y yard; `parsePlace`/`placeText` in `server/core.js`, `POST /api/admin/place`). It is stored as the
  event `{ place: [...] }` (`Game.place`): the pieces move and the current turn starts again; open
  pages load the game again.
  **Debug commands** (owner, 2026-11-03; a test aid): a room's Debug button lists its dice turns
  (`#3 Naser 6 2 / 5 5`; a second try belongs to the turn of its first throw, after the slash) and runs
  `rewind N` (owner, 2026-11-04; `go drop N` still works) (back to dice turn N, 0 = the first, -1 = the one before the last; thrown again with the
  same dice, and the computers play on as before up to the next decision of a person) or
  `roll dice 3,6` / `roll dice 4,2,5` (the last dice turn again with these dice, as many as it had;
  `drop dice` still works) or `reset` (the game from the beginning with the same players; also the
  Reset game button, pressed twice).
  The events after that are dropped; open pages load the game again (`{t:"recolor"}`).
  `parseDebug`/`diceTurns`/`Room.debug` in `server/core.js`, `POST /api/admin/debug`.
  **Replay mode** (owner, 2026-11-03; since v3.2.0 for the admin only, section 12.3): five quick taps on the turn pill
  switch it on, five more switch it off. The page rebuilds the game from the events it has
  (`Table.replay`) and shows arrows over the dock: back jumps to the start of the turn before, forward
  plays the next whole turn with the usual animations; between them "Turn n of m", the player of
  the turn just shown and its dice. Nothing can be played there and nothing is sent but
  `{t:"debug", on}`; the room then refuses every move ("debug") and tells the other devices
  `{t:"debug", by:[names]}`, which show "X is debugging" in the pill and are locked. A device that
  closes leaves the mode. `App.enterReplay` / `replayStep` / `replayTick` in `js/main.js`,
  `GameRoom._debugBy` in `server/worker.js`.
  **Continue** (owner, 2026-11-05): a green play icon (no ring) after the forward arrow goes on
  from the position shown. The first tap asks (the button pulses), a second within 4 s sends
  `{t:"rewind", at}`; the room (`Room.rewind`, `GameRoom._replace`) drops the later events, throws
  anew and plays the computers, and every device loads the game again, this one back live.
  At the live end it just leaves the mode. The bar keeps one width: the widest of "Turn n of m"
  and each player's line with four dice, measured once per game and language (`fitReplayBar`).
  The arrows are small and ringless; a turn with more than four dice draws them smaller (`--ds`), so
  the line never wraps, and a long name is cut with "…".
  **Computer level** (owner, 2026-11-07; v3.2.13): a select when making a room and one in each room's line
  (rooms with a computer). `POST /api/admin/engine {id, engine}` (`withEngine` in `server/core.js`,
  `GameRoom.setEngine`, Lobby `updateSetup`); the game goes on, the next computer move uses the new level.
  **Game rules** (owner, 2026-11-06; v3.2.10): the admin page's "Game rules" section sets the rule values of
  `js/config.js` for the whole server (not per room yet). `Config.RULES` lists what may be set (kind, range,
  label; `board: true` for values whose defaults differ per board, set for 6, 8 and 4 colors). Not there: the
  board itself (colors, corridor length, pieces, nest) and the dice level. `POST /api/admin/rules {rules?}`
  (`cleanRules` in `server/core.js` checks every value and drops those equal to the default; Lobby
  `settings` key `rules` = `{ all, 6, 8, 4 }`). A new room (and "Play again") copies the values of its board
  into `setup.rules` (`rulesFor`); `Table` passes them to `Config.forBoard`, over the board's defaults and under
  the one-color game's fixed rules. A running game keeps the rules it started with, so its events still replay.
  **Piece colors** (owner, 2026-11-02): the admin page has a color picker per piece color and saves them
  for the whole server (`POST /api/admin/colors`, `cleanColors` in `server/core.js`, the Lobby's
  `settings` table; null = the default `Config.PIECE_COLORS`). Every game page reads `GET /api/settings`
  on load and on each room-list refresh (`loadColors` in `js/main.js`, kept in localStorage), and
  `setColors` in `js/render3d.js` applies them (a changed color's nest fields get a pale tint of it);
  a board already drawn keeps its colors until the next game. Default yellow is 15% darker (`#cea70d`).
  The board's own colors too (surface and edge, `Config.BOARD_COLORS`, `cleanBoard`, settings key
  `board`; the 4-color board keeps its cream and red while they are at default). The points ring
  and bar of a pawn per color too (owner, 2026-11-09: `Look.RING_COLORS` = `Config.RING_COLORS`,
  `cleanRings`, settings key `rings`, defaults sent as `ringDefaults`). `/play?…`
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
  owner's rule for now, password login and moving a game to another device come in M3). A held
  name stays clickable in the room list ("playing"); the server decides (owner, 2026-11-02).
  **Room passkey** (owner, 2026-11-07; v3.2.14): four digits per room (Lobby `games.passkey`, random
  at creation, kept by "Play again", shown and set in the admin page, `POST /api/admin/passkey`). The
  first page asks for it under the picked room and keeps it per room in localStorage
  `supermensch-keys`; `hello` with seats and the color pick send it, `GameRoom.passkeyOk` checks it
  (wrong: close 4002 or error "passkey"; 5 wrong in 5 minutes: "passkey wait", `PasskeyGate` in
  `server/core.js`). Looking and reading the moves need no passkey. The player list of open rooms
  (`GET /api/games`) never carries it.
* Steps: M0 table layer (done) · M1 server, lobby, admin, dev page, deploy (done) ·
  M2 the 3D game on the server (`play?game=ID&seats=0,2`: `App.startOnline`; seats played elsewhere count
  as computer players on this device; server events are played one by one in `tick` → `nextEvent`) · M3 seats on one device, reconnect · M4 scores and history pages ·
  M5 lobby in the panel. Released early as v2.0.0 (owner) after M2 plus room makers and admin delete;
  M3 to M5 come as v2.x.
* Code: `server/worker.js` (routes, both Durable Objects, WebSocket protocol in its comments),
  `server/admin.js` (the `/api/admin/*` routes, called by the worker after the admin key check),
  `server/core.js` (no Cloudflare parts, tested in `tests/server.test.mjs`), `server/public/`
  (pages; the admin page is `admin.html`; its script `js/admin-page.js` is bundled by `npm run build` into `server/public/admin-page.js`, not in Git), `wrangler.toml`, `.github/workflows/server.yml` (deploys from `v2`; secrets
  `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ADMIN_KEY`).
* Local: put `ADMIN_KEY=...` in `.dev.vars`, run `npx wrangler dev`, open http://localhost:8787.
* **Colors on the first page** (owner, 2026-11-01): after tapping a name, a child picks the
  seat's colors on a small picture of the board (`roomColorsHtml`: each yard is a button, as the
  3D view first shows the board) (two in the two-color game; a tap replaces the older one) until a person makes
  the first move. First come, first served: colors of seats that picked already are grey; a color
  of a seat that has not picked (or of a computer) is swapped. `POST /api/games/<ID>/colors
  {seat, colors}` (`pickColors`, `colorsKeep`, `Room.recolor` in `server/core.js`): the
  throws before the first move stay, the rest is played again; devices in the game get
  `{t:"recolor"}` and load the new state. The admin page has no per-room color choice (only the server-wide piece colors).
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

### 12.2 Voice chat (v3.0.0; owner, 2026-11-04)
The owner wanted group voice like WhatsApp, also from countries that block direct internet calls
(Iran, UAE, China). The version is 3.0.0 to mark it (owner).
* **Relay:** every device sends its microphone once to **Cloudflare Realtime SFU**, which passes it on
  to the other devices (lighter than every device calling every other one, and it works where direct
  calls are blocked). With a **Realtime TURN** key the page also gets TURN servers (UDP, TCP and TLS on
  443, which looks like ordinary HTTPS); no promise for Iran or China. Free allowance: 1,000 GB a month
  for SFU and TURN together; Opus at about 32 kbit/s is about 15 MB an hour per speaker.
* **Secrets** (repository secrets, put on the Worker by `server.yml`): `REALTIME_APP_ID`,
  `REALTIME_APP_TOKEN` (needed), `TURN_KEY_ID`, `TURN_KEY_TOKEN` (optional). `REALTIME_API` is for
  tests only (another SFU address).
* **Admin:** a **Voice** tick per player (Lobby `users.voice`, `POST /api/admin/uservoice {id, on}`)
  and a server-wide switch, on by default (`settings` key `voice`, `POST /api/admin/voice {on}`;
  `/api/settings` gives `voice: {on, ready}`, ready = the SFU secrets are there). A change reaches the
  open rooms at once (`GameRoom.voiceRefresh`): microphones no longer allowed are closed.
* **Who:** a device may talk when the switch is on and one of its seats belongs to a ticked player
  (`voiceCan` in `server/voice.js`). Every device in the room hears the others (owner's plan: the tick
  is about talking).
* **Game:** a mic button next to the Scores star (`micHtml` in `js/main.js`) for a device that may
  talk. It starts closed; a tap asks the browser for the microphone and opens it, the next mutes it
  (`{t:"mute"}` tells the room). Exit and closing the page stop it; a new WebSocket starts voice clean.
  A green ring (`.chip.speaking`) shows who speaks (own microphone: Web Audio level; others: the
  packets' audio level, `getSynchronizationSources`), thresholds in `Config.VOICE`. A small speaker on
  another talker's chip mutes them on this device only (grey when they muted themselves).
* **Code:** `js/voice.js` (the page's WebRTC: one sendonly connection for the microphone, one for
  listening; pulls with immediate renegotiation), `server/voice.js` (Cloudflare calls, `voiceCan`,
  tested in `tests/server.test.mjs`), `GameRoom.voice` in `server/worker.js` (`POST /api/games/<ID>/voice`
  with the device token: `ice`, `session`, `push`, `pull`, `renegotiate`; a device may use only the SFU
  sessions it made; the room lists open microphones as `{t:"voices"}`).
* **Tested** with two browsers and a stand-in SFU (a browser page that answers the same API): sound
  arrives, the ring lights, mute and local mute work, and the admin's tick takes effect at once. Not
  yet tried against the real Cloudflare service or from the countries above.
* **v3.0.1** (first real test, two Samsung phones with Chrome: one stopped hearing after ~10 s). A
  dropped WebSocket makes the server close that device's microphone; the page now opens it again
  by itself after it reconnects (`Voice.reset` keeps `resume`). A paused voice is played again
  (`replay`, also every `Config.VOICE.RETRY_MS`), a failed or long-disconnected listening connection
  is made again (`relisten`). A **Speaker** button (on by default, kept in localStorage
  `supermensch-speaker`) sets `navigator.audioSession.type` (iOS) and `setSinkId` to a loudspeaker
  where offered. `Voice.log` keeps the last voice events; Info > Copy adds them to the report.
* **v3.0.2**: still one Samsung (Android 10, Chrome) hears nothing although its log shows the voice
  arriving ("sound from"). `Voice.stats` adds a line every `Config.VOICE.STATS_MS` (KB in and level,
  each player's state, KB out, AudioContext state) and the sound outputs, to find where it stops.

### 12.3 Online only, logic on the server (v3.2.0; owner, 2026-11-06)
The owner learned that the page source shows all client code and wants as much as possible on the
server; the offline game is dropped. The plan (in phases) is in the project note
`notes/server-side-plan-fa.md`.
* **Phase 0 (v3.2.0, done):** no offline setup, no debug console and no computer player (`SimpleAI`) in
  the page; `npm run build` makes only `server/public/index.html`; releases carry notes only.
  **Replay mode is the admin's:** the page enters it only when this browser keeps the admin key (the
  admin page stores it in localStorage `adminKey`, same origin) and sends it with `{t:"debug", on, key}`;
  the room refuses it otherwise (`refused`, "admin only"), so nobody else can rewind and throw again.
* **Phases 1 and 2 (v3.2.0, done): the page has no rules engine.** `js/engine.js`, `js/table.js`, `js/ai.js`
  and `js/config.js` are not in the page any more (the page's own numbers moved to `js/look.js`).
  * `server/frames.js`: `gameView(g)` is the game as the page reads it (players, config, log, state,
    turn, cards, places, pending decision ...). Every state is written once in a table (`{ $s: n }`)
    and carries `x`: `he` (`hunterEligible` per player), `cc` (`_completedColor` per player), `s`
    (`structures`), and for a state the player clicks through `b` (`blockerOf` for each own piece and
    die). A person's decision also carries its options, `seqs` (`Game.sequences`, each step with its
    words `desc`) and `tblock` (`tunnelBlockers`) before the roll.
  * `FrameRecorder` (`Table.observer`) makes one frame per event while the server applies them:
    `o` the chosen option, `e` the steps to animate (`playEntries`), `log` the new lines, `view` the game
    after it; only the last frame of a batch carries the options. `{t:"events"}` has `frames` next to
    `events`; `{t:"state"}` has `game` (the whole view).
  * `js/view.js`: `ViewGame` has the fields and methods the page and the board always used
    (`state`, `pending`, `structures(st)`, `hunterEligible(p, st)`, `blockerOf`, `sequences()` ...), but
    they only read what the server sent; geometry (`absOf`, `tunnelGeom`) and the rank thresholds stay.
    `RemoteTable.apply(ev, frame)` follows the game. A missed event loads the game again from `{t:"state"}`.
  * Replay mode asks the room `{t:"history", n, m}` (debugging devices only): the game after n events,
    the frames of the events n..m and the turns (`Room.history`, `Room.turns`).
  * Sizes (6-color game, measured): a move with the computers' answers about 30 KB (at most about
    90 KB); the whole view on connecting up to about 350 KB late in a game (mostly the move log).
    Server work per move at most about 20 ms in Node.
* What must stay in the page: drawing and effects (`render3d.js`, `rolldie.js`), sounds, voice chat
  (`js/voice.js`; its keys stay on the server).

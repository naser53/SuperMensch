# Changelog

Versions follow `MAJOR.MINOR.PATCH`. The version lives in `package.json` and `js/version.js`
(a test keeps them equal); each release is a Git tag `v<version>` with the changelog section.
Up to v3.0.13 the releases carried `supermensch.html`; since v3.2.0 there is no game file (online only).

## v3.2.18 (2026-11-09)

* Tunnel moves are shown through the tunnel (owner, game YJET-19): a piece that uses a tunnel walks to the entrance, through the tube, and out along the corridor, instead of hopping over every field in between. Display only; the rules are unchanged.

## v3.2.17 (2026-11-09)

* Tunnel exit (owner, game YJET-19): a piece coming out of a tunnel is a normal piece. It hits a lone opponent, but a piece in a wall or castle only as part of a break with other pieces (§9), and the rest of its die cannot jump an opponent's castle. Before, the exit hit even pieces in walls and castles. A running game where an exit hit a structure piece replays differently from that move on.

## v3.2.16 (2026-11-07)

* Effects on each move (owner, game VHQK-75): a capture with the first die shows its points (+n over the piece) and a new general or marshal look as soon as that piece lands, not after the second die. The server's step states carry the points of the captures so far (`scoredStates` in `server/frames.js`); the engine still scores the play as a whole, so games replay as before. A wall or castle break shows its points with its last step.

## v3.2.14 (2026-11-07)

* Room passkey (owner): every room has four digits that a player types on the first page to play in it (the room's own passkey, set at random when the room is made; "Play again" keeps it). The admin page shows each room's passkey and sets another (empty: a new one at random; `POST /api/admin/passkey {id, passkey?}`). The server checks it before a device gets seats (`hello`; a wrong one closes the connection with 4002) and before a color pick. After 5 wrong passkeys a room takes none for 5 minutes (`PasskeyGate`). The browser keeps a typed passkey per room (localStorage `supermensch-keys`). Watching and reading a game (`GET /api/games/<ID>`) need none. Rooms made before get a passkey when the admin page lists them.
* Stuck help (owner): a stuck first try with no 6 and no pair, where no two dice can move anything, throws the second try by itself; the first dice show crossed out for a moment. With a 6 or a pair the player chooses as before. Only in rooms made from this version on (`setup.autoRetry`, Config `auto_retry`), so older games still replay.
* Admin, new room: the computer's level follows the dice level when that changes (it can still be set apart).

## v3.2.13 (2026-11-07)

* Computer levels per room (owner): beginner, intermediate and hard (`ENGINE_LEVELS`, `engineFor` in `js/ai.js`), chosen when the admin makes a room and changed for each room in the admin page's room list (`POST /api/admin/engine {id, engine}`; `setup.engine`, left out for beginner, so older rooms play as before). A change counts from the computer's next move; "Play again" keeps the level. Labels in English, Farsi and German.
  * Beginner: the computer as in v3.2.11.
  * Intermediate (game RBEM-40, turns 104 and 112): a general or marshal keeps the value of its rank points in the nest, so it goes in when it can, and an opponent 1..6 fields behind a pawn costs a share of what that pawn would lose (its rank points and the bounty, `AI_WEIGHTS.risk`). Against beginner it wins 169 of 300 four-color games and 106 of 150 six-color games (fair share 150 and 50).
  * Hard: intermediate that also weighs the next player's best answer to each of its 4 best plays, over every throw (about 5 ms a decision).

## v3.2.12 (2026-11-07)

* Admin page in three languages (owner): English, Farsi and German, the game's own languages, with a language menu at the top. It shares the game page's saved choice (the same browser shows both in the same language), Farsi reads right to left with Persian digits, and every section is translated, the "Game rules" table included (`js/admin-strings.js`; a rule without a translation shows its English label from `Config.RULES`). Debug commands stay as they are. The admin page's script is now `js/admin-page.js`, bundled by `npm run build` into `server/public/admin-page.js`.
* Admin rooms (owner): a finished game is marked with a 🏁 "Finished" badge and its winner in the room list (`allGames` sends the result).

## v3.2.11 (2026-11-07)

* Tunnel declared (owner): as for a new wall, a tunnel sign in the piece's color pops up above the piece that declared a tunnel, with a golden ring under it, and fades within about 1.5 s (`Board3D.tunnelFx`, called from `App.choose`). On every device.
* Computer player: it paid for tunnels it then did not use (game RBEM-40: a tunnel declared 6 fields before the entrance, where only a 6 reaches it, and nothing in the move value for the tunnel already paid). It now declares a tunnel only for a pawn at most 3 fields before the entrance (`AI_WEIGHTS.tunnelReach`), and a declared pawn not yet inside counts most of the fields the tunnel saves (`AI_WEIGHTS.tunnelHope`), so it takes the tunnel when it can. Against the old computer player it wins 164 of 300 four-color games. No rule changes.

## v3.2.10 (2026-11-06)

* Admin (owner): a "Game rules" section sets the rule values of `js/config.js` (points, ranks and bounties, walls and castles, tunnels, gift sixes, cards, and the rule switches) for the whole server. Values whose defaults differ per board (corridor points, nest bonus, finish bonus, tunnel reach) are set for the 6-, 8- and 4-color boards. Every value is checked on the server (`cleanRules`, `Config.RULES`). A new room keeps the values of its board in its setup (`setup.rules`), so a running game keeps its rules when they change; "Play again" takes the current ones. The defaults and the golden records do not change. Tests added.

## v3.2.9 (2026-11-06)

* Rule change (owner): ranks come sooner and bounties are half of each threshold. General from 70 (was 90), marshal from 100 (was 140); bounty 35 for a general (was 20), 50 for a marshal (was 30): `GENERAL_POINTS`, `MARSHAL_POINTS`, `GENERAL_BOUNTY`, `MARSHAL_BOUNTY` in `js/config.js`. Golden records re-recorded.

## v3.2.8 (2026-11-06)

* Fix: the Scores view kept showing the points and captures of a soldier that had been captured and sent back to its yard. A piece that loses its points (a soldier captured to the yard, a general pushed back as a soldier) now starts again from 0 and × 0 in the Scores view; a general or marshal that goes to the yard with its rank keeps them. Player scores do not change (`_capture` in `js/engine.js`). Test added.

## v3.2.7 (2026-11-06)

* Fix: in replay mode each step forward threw the dice of the turn before again, crossed out, beside the next player (v3.2.6 fixed only the jump). The server numbers every throw anew when it builds the game again for the frames (also when a room wakes from sleep), so the page took the old throw for a new one. Now only a dice event can bring a new throw: after any other event the page keeps the dice it already shows (`RemoteTable.apply`, `ViewGame._dice` in `js/view.js`). Test added.

## v3.2.6 (2026-11-06)

* Fix: after a jump in replay mode (and on opening a game) the last throw of the player before was thrown again beside the player whose turn it is, every die crossed out, as if that player could not move. The page now takes the last throw as already seen (`showTable`, `openOnline` in `js/main.js`).

## v3.2.5 (2026-11-06)

* Rule change (owner): bounties up with the new rank thresholds. Capturing a general gives +20 / −20 (was 10), a marshal +30 / −30 (was 15): `GENERAL_BOUNTY` / `MARSHAL_BOUNTY` in `js/config.js`. Golden records re-recorded.

## v3.2.4 (2026-11-06)

* Rule change (owner): ranks need more rank points. General from 90 (was 40), marshal from 140 (was 60): `GENERAL_POINTS` / `MARSHAL_POINTS` in `js/config.js`, which the server uses. Golden records re-recorded.
* The machine players are called **Engine** (owner), not Computer: just "Engine" when a game has one, "Engine 1", "Engine 2" ... when it has more (`checkSetup` in `server/core.js`, `js/strings.js`, admin page).

## v3.2.3 (2026-11-06)

* The Second try button shows only a turning arrow (no die), open at its start and 50% larger than before.

## v3.2.2 (2026-11-06)

* Fix: after a throw with no move (burnt dice), the next throws showed those burnt dice again instead of the new ones (seen in game SSZY-19). The engine keeps `noMove` until the next one; the page used to clear it before each event, and since v3.2.0 the server does (`FrameRecorder.before`).

## v3.2.1 (2026-11-06)

* Fix: the dice were thrown again after every move (and at the start of the next turn) since v3.2.0. The page tells a new throw from the same dice by the array itself; the server now numbers each dice array (`diceId` in `server/frames.js`) and the page keeps one array per throw (`ViewGame._dice`).

## v3.2.0 (2026-11-06)

* Online only (owner): the offline game is gone. The first page lists the rooms; the offline setup, the
  debug console and the computer players of the page are no longer in it (the server plays the computers).
* No game file in the releases any more, and no `latest` release: the game is played on the server, so its
  code is not handed out. `npm run build` makes only `server/public/index.html`.
* Replay mode (five taps on the turn pill) needs the admin key now, the one the admin page keeps in the
  same browser. The server refuses `{t:"debug"}` without it, so a player can no longer rewind a game and
  throw the dice again.
* **The rules live on the server only.** The page has no rules engine, no computer player and no rule
  numbers any more: after every move the server sends the game as the page shows it, with the legal
  moves, the click-by-click steps, the walls and castles, the hunter and the reasons a move or a tunnel
  is not allowed already worked out (`server/frames.js`, read by `js/view.js`). Replay mode gets the
  past positions from the server. The page's own numbers moved to `js/look.js`.

## v3.1.1 (2026-11-06)

* **Capture points by field number** (owner's rule change). Every color counts the track from its own gate (1) to its own threshold (40 / 60 / 80); a capture gives the capturer the field's number in the victim's count, except 6 on the gate and the threshold's number + 20 on the threshold (4-color 60, 6-color 80; `SQUARE_POINTS`, `GATE_POINTS`, `THRESHOLD_EXTRA`). Ranks: general from 40 rank points, marshal from 60 (were 15 / 25). The old corridor points come back with `square_points: false`. The info table shows the new rule. Golden games re-recorded.

## v3.0.13 (2026-11-06)

* Board: the nest field numbers are 30% fainter (ink alpha 0.2 to 0.14), as the owner asked.

## v3.0.12 (2026-11-06)

* Board: the nest fields of every color now carry faint numbers 1 to 4 (1 at the nest entrance, 4 deepest), drawn like the faint numbers on the track fields.

## v3.0.11 (2026-11-06)

* Tapping the roll die (or any dock button) on a phone no longer flashes a square box around it: the browser's tap highlight and the mouse-focus ring are off for the round dock buttons; keyboard focus still shows a ring.

## v3.0.10 (2026-11-05)

* Panel dock: the Undo button keeps its place even when it is not shown (an invisible slot), so the dock has one fixed width and the tunnel, card, die and Second try icons no longer shift when Undo comes and goes during a two-dice move.

## v3.0.9 (2026-11-05)

* Roll button: the Dice3D die is back, built the way it was tested in the owner's "Dice lab" page. The round face of the button (red or grey, the pulse and the die) is one layer that is never rebuilt, so turning the button on or off changes its colour, speed and brightness smoothly (about half a second) with no jump. Without WebGL the old turning cube is shown.

## v3.0.8 (2026-11-05)

* Roll button: back to the earlier turning cube (as in 3.0.5). The Dice3D die of 3.0.6 and 3.0.7 still jolted when the button turned on or off, so the owner chose to restore the old one.

## v3.0.7 (2026-11-05)

* Roll button die: no more jolt when the button turns on or off. The die now speeds up and slows down smoothly and fades between full color and greyed out (about half a second), instead of switching at once; its first frame could also turn it a little backwards, which is fixed.

## v3.0.6 (2026-11-05)

* The roll button's die is now the Dice3D design: a real 3D die with rounded edges and red one-pip inside a small glass orb. It turns slowly while you can roll (faster on hover) and stands still, greyed out, otherwise. Dice results, sounds and the panel layout are unchanged.

## v3.0.5 (2026-11-05)

* Hunter: it now leaves the board when its second color has no piece out on the track (or in a tunnel). Pieces that can still move inside the nest no longer keep it; this is the same condition as for bringing it in.

## v3.0.4 (2026-11-05)

* Debug replay bar takes less room: the back and forward arrows are small and have no ring, and Continue is a plain green play icon.
* A turn with more than four dice (a second throw) shows them smaller, so the line no longer wraps; a long name is cut with "…".

## v3.0.3 (2026-11-05)

* Debug replay (five taps on the turn pill): a green **Run** button continues the game from the position shown. Tap it twice (the first tap asks); the later moves are deleted and every device loads the game again.
* The replay bar keeps one width (from the longest player name and three dice), so the back and forward arrows no longer move.

## v3.0.2 (2026-11-04)

* Voice report: every 10 seconds the voice log notes what arrives (KB, audio level), whether each voice plays, what is sent, and the sound outputs the phone offers. One Android phone still hears nothing while the other hears it; the next report shows where the sound stops.

## v3.0.1 (2026-11-04)

Voice chat fixes after the first test on two Android phones (Samsung, Chrome): one player stopped hearing the other after about 10 seconds.
* A microphone that was open opens again by itself when the phone's connection drops for a moment and comes back (before, the server closed it and it stayed closed).
* A voice that stops playing is played again, and a broken listening connection is made again.
* **Speaker** button next to the microphone (on by default): asks the phone to play the others on the loudspeaker, where the browser allows it.
* The last voice events are added to the game report (menu, Info, Copy), to find the cause if sound stops again.

## v3.0.0 (2026-11-04): voice chat

The voice chat release. Players in an online game talk to each other, like a group call.

**Voice chat**
* Each device sends its microphone once to a relay (Cloudflare Realtime SFU), which passes it on to the other devices of the room. A relay, and TURN over TLS on port 443 when it is set up, give the best chance in countries that block direct calls.
* Echo cancellation and noise suppression are on; Opus at about 32 kbit/s (about 15 MB an hour per speaker).
* **Admin page:** a **Voice** tick per player (may talk), and one **Voice chat on** switch for the whole server. Turning either off stops the microphones in open games at once.
* **In the game:** a microphone button next to the Scores star, for a device with a ticked player. The microphone starts closed; a tap opens it, the next mutes it. It goes off when the player leaves the game or closes the page.
* A green ring glows around the chip of the player who is speaking.
* Every player hears the others. A small speaker on a player's chip mutes that player on this device only.
* The server keeps the Cloudflare token; the page asks `/api/games/<ID>/voice`, and only devices that hold a seat in the room are answered.

**Setup:** the Cloudflare secrets `REALTIME_APP_ID` and `REALTIME_APP_TOKEN` (and, for better reach, `TURN_KEY_ID` and `TURN_KEY_TOKEN`), see the README.

## v2.4.0 (2026-11-04)

The dock layout of v2.3.0 stays. Rules, game over, the hunter and the admin page.

**Rules**
* **Six prize:** a 6 never burns. When only one die can be played, it is the 6. When one color cannot move, the other color plays both dice only if one of them is a 6; otherwise it plays one die.
* Six first only when the 6 brings a new piece in.
* Second step: tap the landing field; the moved piece stays selected for its second step.

**Game**
* **Game over:** no ranking card and no big golden pawn; the winner's pieces rise and fall in a slow wave. A Scores (star) button sits next to the menu. Play again after a game.
* A wall or castle sign shows when a move builds one.
* Short messages for stuck throws and the gift six; the game name in Info.
* Tapping a player chip shows the player's name card under it for 1.5 s.
* **Points on a pawn:** bar or ring, chosen on the admin page; ring is the default.
* **Hunter:** a shorter, thicker arrow through the middle of the pawn at head height (or a sword, chosen on the admin page). The Forward / Back choice is a small bubble over the waiting hunter.
* Tunnels on offer are drawn as lines only; a declared tunnel shows its field circles.
* Sound: one recording for a single die, another for several.
* **Replay mode for debugging online games:** five quick taps on the turn pill; arrows over the dock step one whole turn back or forward; the other devices are locked and see who is debugging.
* The View (camera) button and its menu are gone; the board still turns by dragging and zooms.
* Yellow is 15% darker by default (`#cea70d`).

**Admin page**
* Piece colors and board colors (surface and edge) for every game on the server.
* **One Debug panel** for a room: one command per line, run in order: place pieces (`R2 23`, `R3z 2` for the nest, `R1 y` for the yard), `rewind N`, `roll dice 3,6`, `reset`, and `rename <name>` for the room. An **i** button shows a summary of the commands.
* The admin API has its own file, `server/admin.js`, and the admin page's script is `admin-page.js`.

**Docs**
* `docs/rules-fa.md` and `rules-fa.docx` rewritten (8-color board and more).

## v2.3.0 (2026-11-02)

Panel layout **B: dock**. One of three trial layouts (v2.2.0 corners, v2.3.0 dock, v2.4.0 on the board); the owner keeps one.
* The board takes the whole screen; the panel floats over it.
* On top, floating on the board (no bar): the players, the camera and a menu button (scores, info, debug, language, speed, sound and leave are in the menu); whose turn in a pill under them.
* A dock at the bottom: the tunnels and the card, the big die raised in the middle, Second try, undo and the other buttons.
* A phone held upright shows the whole board, larger than before.
* **Tunnels:** a Tunnels button only draws its color's tunnels on the board (no written list); the cost
  is written over each tunnel's exit (−80, −120, −160). A color with no tunnel gets a short message at
  the top for 2 s.
* **Points over the pieces:** after a capture the points the piece won pop up over its head (+) and
  fade within a second; a hit general or marshal shows what its player loses (−, the bounty).
* **Winner:** at the end a big golden pawn turns in a glow in the middle of the board, with the
  winner's name and total score.
* Tests: 72 -> 63, about twice as fast.

* **8-color board:** eight arms, 80 fields (or 112 with 14 fields per corridor), with every rule of
  the 6-color board. Two new colors, pink and black. 2 to 4 players with two colors each, 2 to 8 with
  one. The corridors give 1 / 3 / 6 / 10 / 15 / 21 / 28 / 36; tunnels reach corridor 6. Offline and
  in the admin page.
* **Dice sound:** the dice click on the board as they tumble and land.
* **Sound effects:** a wooden clack when a piece lands (like a chess piece), a small blast for a
  capture and a stronger one for a hit general or marshal, three knocks on a door for a
  triple-dice card, a rising chime when a piece comes in on its gate, and fireworks with whistles
  and crackles at the end. A speaker button in the ribbon switches them off and on.

## v2.1.0 (2026-11-01)

The online and the offline game come from one branch again (`main`); the server deploys from it.
* **Colors online:** on the first page a child taps their name and picks the seat's colors on a
  small picture of the board, until the first move. First come, first served.
* **Wall and castle sign:** when an opponent's wall or castle stops a move, its sign pops up over
  that structure and shakes, instead of the plain "not allowed" sign.
* **Rule fix:** a piece on its threshold and one on its own gate are not a wall.
* **Copy button** in Info > Moves: copies the setup, the moves and a replay line, for debugging.
* **Board:** turn it from any free spot; zoom with the wheel.

## v2.0.0 (2026-10-31)

The online family version (owner). The offline game in `supermensch.html` plays as before.
* **Online server** on Cloudflare (free plan): https://supermensch-dev.ndaneshi.workers.dev.
  The server throws the dice and checks every move; every device sees the others' throws live
  (WebSocket push, no polling). Computer seats are played by the server.
* **Users:** ten users (user1 to user10), no passwords; the admin renames them.
* **Rooms:** each game has a GameID and a GameName. Only the admin, or a user the admin made a
  room maker, creates rooms; the admin can delete rooms.
* **3D board online:** `/play?game=ID&seats=…` plays the room on the 3D board; several seats can
  sit at one device.
* Under the hood: every game is a list of events (`js/table.js`), replayed the same way on the
  server and on every device.

**Planned next:** smooth reconnect and seat picking (M3), scores and history pages (M4), the
lobby inside the panel (M5).

## v1.0.4 (2026-10-30)

The one-color game has no walls either (owner): pieces in a row protect nothing and block
nothing (new `WALLS` flag, off in the one-color game; the break table in Info is hidden there).
The game with several colors per player is unchanged.

## v1.0.3 (2026-10-30)

Corrects v1.0.1 and v1.0.2, which turned tunnels and castle-break declarations off everywhere.
The owner's intent: the **one-color game** (one color per player, both boards) is the
traditional game, and the **game with several colors per player** keeps everything.
* One-color game, by default: no generals or marshals (and so no nest swap), no tunnels, no
  castles (a run of three or more is walls of two and a lone piece, so nothing blocks), and so
  no castle-break declarations. Config flags: `RANKS`, `NEST_SWAP`, `TUNNELS` (`tunnels_on`),
  `CASTLES` (`castles`), `BREAK_DECL` (`break_decl_on`), set by `Config.forBoard(n, level, mode)`.
* Several colors per player: ranks, nest swap, tunnels, castles and castle-break declarations,
  as in v1.0.0.

**Planned for later versions:** the castle-breaker piece, point loans between players; Pro
version (fortress of 4, fortress-breaker, accounts, tournaments) and the online version.

## v1.0.2 (2026-10-30)

Version 1 as the traditional game: no castle-break declarations either (owner's decision).
Castles cannot be broken in v1; the castle-break button and the castle bonus row in Info are
hidden (`BREAK_DECL` / `break_decl_on` is off; the code stays for a later version). Walls still
break as before. No tunnels (since v1.0.1).

**Planned for later versions:** castle-break declarations, tunnels, the castle-breaker piece,
point loans between players; Pro version (fortress of 4, fortress-breaker, accounts,
tournaments) and the online version.

## v1.0.1 (2026-10-30)

Version 1 without tunnels (owner's decision): no tunnel can be declared, and the Tunnels button
and the tunnel table in Info are hidden (`TUNNELS` / `tunnels_on` is off; the rules and code
stay for a later version). Everything else is as in v1.0.0.

**Planned for later versions:** tunnels, the castle-breaker piece, point loans between players;
Pro version (fortress of 4, fortress-breaker, accounts, tournaments) and the online version.

## v1.0.0 (2026-10-30)

The first complete version, closed by the owner.

**Boards and modes:** 6-color six-arm board (60 fields) and 4-color cross (40 fields); two
colors per player (two dice) or one color per player (one die); people at the same screen and
computer players; in the one-color game each seat picks its color, and the classic
4-color one-color game has no ranks and no nest swap; English, Farsi (right to left) and German;
beginner and intermediate dice.

**Rules:** two-color dice play (free split, burnt die, full use, sum moves, six first); bonus
throws for doubles; help for a stuck player (three dice, a second try that passes the turn by
itself when nothing can be kept, gift six); triple-dice cards; the hunter; walls and castles
with castle-break declarations; scoring and ranks (soldier, general, marshal) with ranked
pieces surviving a hit (one rank down, pushed back at least 7 fields, or to the yard with rank
and points); nest swap; tunnels (declared before the roll, can be taken back until the roll,
paid with points, debt rule at the threshold).

**Interface:** 3D board with dice on the board, a ribbon with the actions of the moment, view
presets and turning the board by dragging beside it, start view on the player's own side,
progress line and rank stars on pawns, scores view, info with scoring tables and the move log,
confirmation before leaving a game, fireworks at the end, debug mode with a command console
(`score`, `move`, `dice`).

**Computer player:** values reach and a second color in play, saves triple-dice cards for good
moments (and plays them behind an opponent's castle), uses the nest swap.

**Planned for later versions** (designed in `docs/rules-fa.md`, not in v1):
* Castle-breaker piece (§3.13 of the handoff).
* Point loans between players (§14 of the rules).
* Pro version: fortress of 4, fortress-breaker, accounts, tournaments; the online version.

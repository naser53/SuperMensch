# Changelog

Versions follow `MAJOR.MINOR.PATCH`. The version lives in `package.json` and `js/version.js`
(a test keeps them equal); each release is a Git tag `v<version>` with `supermensch.html`
attached. The `latest` release is always the newest build of `main`.

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

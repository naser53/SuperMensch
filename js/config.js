// Game parameters. Every number in the rules document lives here. The page never loads this
// file (owner, 2026-11-06: the rules stay on the server); its own numbers are in js/look.js.
import { Look } from "./look.js";

export class Config {
  constructor(o = {}) {
    Object.assign(this, {
      n_colors: 6,              // colors on the board
      corridor_len: 10,         // fields per corridor
      pieces_per_color: 4,
      home_len: 4,              // Z1..Z4

      gift_six_n: 6,            // GIFT_SIX_N: one-color game, throws without a 6
      gift_six_turns: 4,
      auto_retry: false,        // AUTO_RETRY: two-color game, a stuck first try with no 6 and no pair goes on to the
                                // second try by itself; on for rooms made from v3.2.14 (setup.autoRetry), so older games replay        // GIFT_SIX_TURNS: two-color game, stuck turns without a 6
      triple_dice_cards: 3,     // TRIPLE_DICE_CARDS
      hunter_can_break: false,  // HUNTER_CAN_BREAK
      six_into_nest: true,      // SIX_INTO_NEST: two-color game, a 6 that takes a piece into its nest may
                                // be played alone even when the other die then burns (owner, 2026-11-02)
      six_prize: true,          // SIX_PRIZE: two-color game, a 6 never burns when it can be played, and with
                                // a 6 a color that alone can move plays both dice when it can (owner, 2026-11-03)

      // SQUARE_POINTS (owner, 2026-11-06): a capture is worth the number of the field in the captured
      // piece's own count, from 1 on its gate to the track length on its threshold, except
      // GATE_POINTS on the gate, and on the threshold its number plus THRESHOLD_EXTRA (4-color 40 + 20,
      // 6-color 60 + 20). Off: the corridor points below.
      square_points: true,      // SQUARE_POINTS
      gate_points: 6,           // GATE_POINTS
      threshold_extra: 20,      // THRESHOLD_EXTRA (owner, 2026-11-06)
      corridor_points: [1, 3, 6, 10, 15, 23],  // CORRIDOR_POINTS (when SQUARE_POINTS is off)
      gate_bonus: 5,            // GATE_BONUS
      threshold_bonus: 20,      // THRESHOLD_BONUS
      wall_break: 15,           // WALL_BREAK
      castle_break: 40,         // CASTLE_BREAK
      color_bonus: 60,          // COLOR_BONUS: a nest is full (a color's last piece reaches it)
      finish_bonus: [100, 50],  // FINISH_BONUS: first and second player to finish (others 0)
      clean_piece_bonus: 5,     // CLEAN_PIECE_BONUS: a piece reaches the nest without ever being captured

      ranks: true,              // RANKS: generals and marshals (off by default in the one-color game)
      general_points: 70,       // GENERAL_POINTS: a piece's own capture points to become a general
      marshal_points: 100,      // MARSHAL_POINTS: ... to become a marshal
      general_mult: 2,          // GENERAL_MULT
      marshal_mult: 3,          // MARSHAL_MULT
      general_bounty: 35,       // GENERAL_BOUNTY
      marshal_bounty: 50,       // MARSHAL_BOUNTY
      rank_mult_on_break: false,
      pushback_min: 7,          // PUSHBACK_MIN: a hit general or marshal is pushed back at least this far
      nest_swap: true,          // NEST_SWAP: with a 6, a soldier in the nest with rank points swaps
                                // with a yard piece and enters with its points

      walls: true,                    // WALLS: two or more in a row protect each other (walls, castles); off: none
      castles: true,                  // CASTLES: 3+ in a row is a castle; off: runs are split into walls of 2
      break_decl_on: true,            // BREAK_DECL: castle-break declarations (two-color game only)
      tunnels_on: true,               // TUNNELS; the rules stay
      tunnel_costs: [80, 120, 160],  // TUNNEL_COST_1 / _2 / _3
      tunnel_max_skip: 3,             // TUNNEL_MAX_SKIP
      tunnel_last_corridor: 4,        // TUNNEL_LAST_CORRIDOR: 4, or 5 to allow corridor 5 (8-color board: 6)
      max_active_tunnels: 2,          // MAX_ACTIVE_TUNNELS
      tunnel_declare_range: 6,        // TUNNEL_DECLARE_RANGE

      // Dice level: chance of a 6 on one die. null = fair dice (1/6, beginner);
      // 0.1 = intermediate (a 6 comes one time in ten, the other numbers share the rest)
      six_chance: null,               // SIX_CHANCE
      // Two dice thrown together on the difficult level (null = two separate dice): chance of at
      // least one 6, of a 6-6, and of each other pair (1-1 ... 5-5); the other throws share the rest
      two_dice: null,                 // TWO_DICE
      level: "beginner",
    }, o);
  }

  // Defaults for the 6-color (six arms), 8-color (eight arms) or 4-color (classic cross) board.
  // The 8-color board keeps every rule of the 6-color board; only the corridors are more: the
  // corridor points go on in the same steps, and tunnels may reach corridor 6 (two before the final).
  // The one-color game (one color per player) is the traditional game: no tunnels, no walls or
  // castles (so no castle-break declarations), no generals or marshals and so no nest swap (it only
  // carries rank points back into play). The game where a player has several colors keeps them all.
  // rules: the admin's values for this board (server/core.js rulesFor, kept in the room's setup);
  // they go over the board's defaults, and the one-color game stays the traditional game anyway.
  static forBoard(n, level = "beginner", mode = "two", corridor = 10, rules = null) {
    const lv = level in Config.LEVELS ? level : "beginner";
    const dice = { six_chance: Config.LEVELS[lv], two_dice: Config.TWO_DICE[lv] || null, level: lv };
    const long = (n === 6 || n === 8) && Config.CORRIDORS.includes(corridor) ? { corridor_len: corridor } : {};
    const classic = mode === "one"
      ? { ranks: false, nest_swap: false, tunnels_on: false, walls: false, castles: false, break_decl_on: false } : {};
    // the 4-color board: end bonuses in proportion to its smaller corridor points
    const board = n === 4 ? { n_colors: 4, corridor_points: [1, 4, 8, 10], tunnel_max_skip: 2, tunnel_last_corridor: 3,
                              color_bonus: 25, finish_bonus: [40, 20] }
      : n === 8 ? { n_colors: 8, corridor_points: [1, 3, 6, 10, 15, 21, 28, 36], tunnel_last_corridor: 6, ...long }
      : { n_colors: 6, ...long };
    return new Config({ ...board, ...(rules || {}), ...classic, ...dice });
  }

  // The values the admin may set for the whole server (admin page "Game rules", server/core.js
  // cleanRules). kind: int, bool, or list of ints (len, or "n": one per corridor of the board).
  // board: set per board (6, 8, 4), because the boards' defaults differ. Not here: the board itself
  // (colors, corridor length, pieces, nest) and the dice level, which every room picks.
  static RULES = [
    { group: "Dice", key: "gift_six_n", kind: "int", min: 1, max: 30, label: "One-color game: throws without a 6 before a gift 6" },
    { group: "Dice", key: "gift_six_turns", kind: "int", min: 1, max: 30, label: "Two-color game: stuck turns without a 6 before a gift 6" },
    { group: "Dice", key: "triple_dice_cards", kind: "int", min: 0, max: 20, label: "Triple-dice cards per player" },
    { group: "Dice", key: "six_into_nest", kind: "bool", label: "A 6 into the nest may be played alone" },
    { group: "Dice", key: "six_prize", kind: "bool", label: "A playable 6 never burns" },
    { group: "Points", key: "square_points", kind: "bool", label: "A capture is worth its field number (off: corridor points)" },
    { group: "Points", key: "gate_points", kind: "int", min: 0, max: 1000, label: "Capture on the gate" },
    { group: "Points", key: "threshold_extra", kind: "int", min: 0, max: 1000, label: "Extra for a capture on the threshold" },
    { group: "Points", key: "corridor_points", kind: "list", len: "n", min: 0, max: 1000, board: true, label: "Corridor points (field numbers off)" },
    { group: "Points", key: "gate_bonus", kind: "int", min: 0, max: 1000, label: "Gate bonus (field numbers off)" },
    { group: "Points", key: "threshold_bonus", kind: "int", min: 0, max: 1000, label: "Threshold bonus (field numbers off)" },
    { group: "Points", key: "color_bonus", kind: "int", min: 0, max: 1000, board: true, label: "A nest is full" },
    { group: "Points", key: "finish_bonus", kind: "list", len: 2, min: 0, max: 1000, board: true, label: "First and second to finish" },
    { group: "Points", key: "clean_piece_bonus", kind: "int", min: 0, max: 1000, label: "A piece reaches the nest never captured" },
    { group: "Ranks", key: "ranks", kind: "bool", label: "Generals and marshals" },
    { group: "Ranks", key: "general_points", kind: "int", min: 1, max: 1000, label: "Own points to become a general" },
    { group: "Ranks", key: "marshal_points", kind: "int", min: 1, max: 1000, label: "Own points to become a marshal" },
    { group: "Ranks", key: "general_mult", kind: "int", min: 1, max: 10, label: "General's multiplier" },
    { group: "Ranks", key: "marshal_mult", kind: "int", min: 1, max: 10, label: "Marshal's multiplier" },
    { group: "Ranks", key: "general_bounty", kind: "int", min: 0, max: 1000, label: "Head bounty of a general" },
    { group: "Ranks", key: "marshal_bounty", kind: "int", min: 0, max: 1000, label: "Head bounty of a marshal" },
    { group: "Ranks", key: "rank_mult_on_break", kind: "bool", label: "Multiplier on wall and castle breaks too" },
    { group: "Ranks", key: "pushback_min", kind: "int", min: 0, max: 30, label: "A hit general or marshal goes back at least" },
    { group: "Ranks", key: "nest_swap", kind: "bool", label: "Nest swap with a 6" },
    { group: "Walls", key: "walls", kind: "bool", label: "Walls" },
    { group: "Walls", key: "castles", kind: "bool", label: "Castles (3 or more in a row)" },
    { group: "Walls", key: "wall_break", kind: "int", min: 0, max: 1000, label: "Breaking a wall" },
    { group: "Walls", key: "castle_break", kind: "int", min: 0, max: 1000, label: "Breaking a castle" },
    { group: "Walls", key: "break_decl_on", kind: "bool", label: "Castle-break declarations" },
    { group: "Walls", key: "hunter_can_break", kind: "bool", label: "The hunter may break walls" },
    { group: "Tunnels", key: "tunnels_on", kind: "bool", label: "Tunnels" },
    { group: "Tunnels", key: "tunnel_costs", kind: "list", len: 3, min: 0, max: 1000, label: "Cost to skip 1, 2, 3 corridors" },
    { group: "Tunnels", key: "tunnel_max_skip", kind: "int", min: 1, max: 3, board: true, label: "Most corridors a tunnel skips" },
    { group: "Tunnels", key: "tunnel_last_corridor", kind: "int", min: 2, max: 7, board: true, label: "Last corridor a tunnel reaches" },
    { group: "Tunnels", key: "max_active_tunnels", kind: "int", min: 1, max: 10, label: "Open tunnels per player" },
    { group: "Tunnels", key: "tunnel_declare_range", kind: "int", min: 1, max: 20, label: "Fields before the entrance to declare" },
  ];

  // dice levels for everybody at the table (same dice for people and computers)
  // (chance of a 6 on one die; null = fair). Difficult is half of intermediate (owner, 2026-11-02):
  // one die 0.05; two dice: at least one 6 9.5% (19% / 2), 6-6 0.5%, each other pair 1.62%.
  static LEVELS = { beginner: null, intermediate: 0.1, difficult: 0.05 };
  static TWO_DICE = { difficult: { six_any: 0.095, six_pair: 0.005, pair: 0.0162 } };
  // boards (colors on the board) and fields per corridor on the 6- and 8-color boards
  // (14: every arm two fields longer)
  static BOARDS = [6, 8, 4];
  static CORRIDORS = [10, 14];
  // the page's own numbers (animation, sound, colors, server address, voice) are in js/look.js
  static ANIM_PAUSE = Look.ANIM_PAUSE;
  static ANIM_SPEEDS = Look.ANIM_SPEEDS;
  static HOP_SHARE = Look.HOP_SHARE;
  static SOUND_VOLUME = Look.SOUND_VOLUME;
  static PIECE_COLORS = Look.PIECE_COLORS;
  static BOARD_COLORS = Look.BOARD_COLORS;
  static RING_COLORS = Look.RING_COLORS;
  static HEAD_RING = Look.HEAD_RING;
  static SERVER_URL = Look.SERVER_URL;
  static VOICE = Look.VOICE;

  // (entry corridor, exit corridor) pairs; corridors 1..n, the final one is never an exit.
  tunnels() {
    const out = [], final = this.n_colors;
    for (let a = 1; a < final; a++)
      for (let b = a + 1; b < final; b++)
        if (b - a <= this.tunnel_max_skip && b <= this.tunnel_last_corridor) out.push([a, b]);
    return out;
  }

  get track_len() { return this.n_colors * this.corridor_len; }
  get last_rel() { return this.track_len + this.home_len - 1; }
}

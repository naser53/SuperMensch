// Game parameters. Every number in the rules document lives here.

export class Config {
  constructor(o = {}) {
    Object.assign(this, {
      n_colors: 6,              // colors on the board
      corridor_len: 10,         // fields per corridor
      pieces_per_color: 4,
      home_len: 4,              // Z1..Z4

      gift_six_n: 6,            // GIFT_SIX_N
      triple_dice_cards: 3,     // TRIPLE_DICE_CARDS
      hunter_can_break: false,  // HUNTER_CAN_BREAK

      corridor_points: [1, 3, 6, 10, 15, 23],  // CORRIDOR_POINTS
      gate_bonus: 5,            // GATE_BONUS
      threshold_bonus: 20,      // THRESHOLD_BONUS
      wall_break: 15,           // WALL_BREAK
      castle_break: 40,         // CASTLE_BREAK
      color_bonus: 60,          // COLOR_BONUS: a nest is full (a color's last piece reaches it)
      finish_bonus: [100, 50],  // FINISH_BONUS: first and second player to finish (others 0)
      clean_piece_bonus: 5,     // CLEAN_PIECE_BONUS: a piece reaches the nest without ever being captured

      ranks: true,              // RANKS: generals and marshals (off by default in the one-color game)
      general_points: 15,       // GENERAL_POINTS: a piece's own capture points to become a general
      marshal_points: 25,       // MARSHAL_POINTS: ... to become a marshal
      general_mult: 2,          // GENERAL_MULT
      marshal_mult: 3,          // MARSHAL_MULT
      general_bounty: 10,       // GENERAL_BOUNTY
      marshal_bounty: 15,       // MARSHAL_BOUNTY
      rank_mult_on_break: false,
      pushback_min: 7,          // PUSHBACK_MIN: a hit general or marshal is pushed back at least this far
      nest_swap: true,          // NEST_SWAP: with a 6, a soldier in the nest with rank points swaps
                                // with a yard piece and enters with its points

      castles: true,                  // CASTLES: 3+ in a row is a castle; off: runs are split into walls of 2
      break_decl_on: true,            // BREAK_DECL: castle-break declarations (two-color game only)
      tunnels_on: true,               // TUNNELS; the rules stay
      tunnel_costs: [80, 120, 160],  // TUNNEL_COST_1 / _2 / _3
      tunnel_max_skip: 3,             // TUNNEL_MAX_SKIP
      tunnel_last_corridor: 4,        // TUNNEL_LAST_CORRIDOR: 4, or 5 to allow corridor 5
      max_active_tunnels: 2,          // MAX_ACTIVE_TUNNELS
      tunnel_declare_range: 6,        // TUNNEL_DECLARE_RANGE

      // Dice level: chance of a 6 on one die. null = fair dice (1/6, beginner);
      // 0.1 = intermediate (a 6 comes one time in ten, the other numbers share the rest)
      six_chance: null,               // SIX_CHANCE
    }, o);
  }

  // Defaults for the 6-color (six arms) or 4-color (classic cross) board.
  // The one-color game (one color per player) is the traditional game: no tunnels, no castles
  // (so no castle-break declarations), no generals or marshals and so no nest swap (it only
  // carries rank points back into play). The game where a player has several colors keeps them all.
  static forBoard(n, level = "beginner", mode = "two") {
    const dice = { six_chance: Config.LEVELS[level] ?? null };
    const classic = mode === "one"
      ? { ranks: false, nest_swap: false, tunnels_on: false, castles: false, break_decl_on: false } : {};
    if (n === 4) {
      // end bonuses in proportion to the smaller corridor points of this board
      return new Config({ n_colors: 4, corridor_points: [1, 4, 8, 10],
                          tunnel_max_skip: 2, tunnel_last_corridor: 3,
                          color_bonus: 25, finish_bonus: [40, 20], ...classic, ...dice });
    }
    return new Config({ n_colors: 6, ...classic, ...dice });
  }

  // dice levels for everybody at the table (same dice for people and computers)
  static LEVELS = { beginner: null, intermediate: 0.1 };

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

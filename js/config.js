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
      color_bonus: 20,          // COLOR_BONUS: a color's last piece reaches the nest
      finish_bonus: [50, 25],   // FINISH_BONUS: first and second player to finish (others 0)
      clean_piece_bonus: 5,     // CLEAN_PIECE_BONUS: a piece reaches the nest without ever being captured

      general_at: 3,            // GENERAL_AT
      marshal_at: 7,            // MARSHAL_AT
      general_mult: 2,          // GENERAL_MULT
      marshal_mult: 3,          // MARSHAL_MULT
      general_bounty: 50,       // GENERAL_BOUNTY
      marshal_bounty: 70,       // MARSHAL_BOUNTY
      rank_mult_on_break: false,

      tunnel_costs: [100, 175, 275],  // TUNNEL_COST_1 / _2 / _3
      tunnel_max_skip: 3,             // TUNNEL_MAX_SKIP
      tunnel_last_corridor: 4,        // TUNNEL_LAST_CORRIDOR: 4, or 5 to allow corridor 5
      max_active_tunnels: 2,          // MAX_ACTIVE_TUNNELS
      tunnel_declare_range: 6,        // TUNNEL_DECLARE_RANGE
    }, o);
  }

  // Defaults for the 6-color (six arms) or 4-color (classic cross) board.
  static forBoard(n) {
    if (n === 4) {
      return new Config({ n_colors: 4, corridor_points: [1, 4, 8, 10],
                          tunnel_max_skip: 2, tunnel_last_corridor: 3 });
    }
    return new Config({ n_colors: 6 });
  }

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

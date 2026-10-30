// Debug console commands (typed in the box shown in debug mode):
//   score 1 50        add 50 points to player 1 (score 1 -50 takes 50 away)
//   move 1 s2R 33     move player 1's Red pawn number 2 to field 33
//                     (fields 1..L on the track, L+1..L+4 in the nest, y = yard)
//   dice 6 3 4        the dice: now if they are being set, otherwise for the next throw
// Color letters: R B G Y P T (Red, Blue, Green, Yellow, Purple, Teal).
import { Option, YARD } from "./engine.js";

export const COLOR_LETTERS = "RBGYPT";

// Returns { key, params } for the reply line; `choose` makes a choice the way the app does.
export function runCommand(g, text, choose) {
  const w = text.trim().split(/\s+/).filter(Boolean);
  const cmd = (w[0] || "").toLowerCase();
  const player = s => {
    const p = parseInt(s, 10) - 1;
    return Number.isInteger(p) && p >= 0 && p < g.players.length ? p : null;
  };
  if (cmd === "score") {
    const p = player(w[1]), n = parseInt(w[2], 10);
    if (p === null || !Number.isInteger(n)) return { key: "cmd_usage" };
    g.state.scores[p] += n;
    return { key: "cmd_score", params: { p: p + 1, n: g.state.scores[p] } };
  }
  if (cmd === "move") {
    const p = player(w[1]), m = /^s(\d+)([a-z])$/i.exec(w[2] || ""), f = (w[3] || "").toLowerCase();
    if (p === null || !m || !f) return { key: "cmd_usage" };
    const col = COLOR_LETTERS.indexOf(m[2].toUpperCase()), i = +m[1] - 1;
    if (col < 0 || col >= g.cfg.n_colors || g.owner[col] !== p) return { key: "cmd_not_yours" };
    if (i < 0 || i >= g.state.pos[col].length) return { key: "cmd_no_pawn" };
    const L = g.L, n = parseInt(f, 10);
    let rel;
    if (f === "y" || f === "0") rel = YARD;
    else if (n >= 1 && n <= L) rel = g.relOf(col, n - 1);
    else if (n > L && n <= L + g.state.pos[col].length) rel = n - 1;
    else return { key: "cmd_bad_field" };
    const st = g.state;
    if (rel !== YARD) {
      const taken = rel < L ? g.occupancy(st).get(g.absOf(col, rel)) : null;
      if ((taken && taken.join() !== ["p", col, i].join()) || (rel >= L && st.pos[col].some((r, j) => j !== i && r === rel)))
        return { key: "cmd_taken" };
    }
    st.pos[col][i] = rel;
    if (rel === YARD) st.kills[col][i] = 0;
    st.tmark[col][i] = false;
    st.tunnels = st.tunnels.filter(t => !(t[1] === col && t[2] === i));
    refresh(g);
    return { key: "cmd_moved", params: { piece: g.moverName(["p", col, i]), f: g.fieldName(col, rel) } };
  }
  if (cmd === "dice") {
    const vals = w.slice(1).map(x => parseInt(x, 10));
    if (!vals.length || vals.length > 3 || vals.some(v => !(v >= 1 && v <= 6))) return { key: "cmd_usage" };
    const dec = g.pending;
    if (dec && dec.kind === "pre_roll") {
      const want = vals.length === 3 ? "triple" : "roll";
      const o = dec.options.find(x => x.payload === want);
      if (!o) return { key: "cmd_no_three" };
      g.queuedDice = vals;
      choose(o);
      return { key: "cmd_dice", params: { d: vals.join(" ") } };
    }
    if (dec && dec.kind === "dice") {
      if (dec.dice.length !== vals.length) return { key: "cmd_dice_count", params: { n: dec.dice.length } };
      choose(new Option(null, ["dice", vals]));
      return { key: "cmd_dice", params: { d: vals.join(" ") } };
    }
    g.queuedDice = vals;
    return { key: "cmd_dice_next", params: { d: vals.join(" ") } };
  }
  return { key: "cmd_usage" };
}

// The board changed under the current decision: offer it again.
function refresh(g) {
  const dec = g.pending;
  if (!dec || dec.player !== g.turn) return;
  if (dec.kind === "play") g._offerPlays(dec.dice);
  else if (dec.kind === "pre_roll") g._preRoll();
  else if (dec.kind === "keep") g._startTurn();      // a stuck throw: the turn starts again (stuck or not now)
}

// Computer-vs-computer games.   node tests/simulate.mjs [games]
import { pathToFileURL } from "node:url";
import { Config } from "../js/config.js";
import { Game, Player } from "../js/engine.js";
import { SimpleAI } from "../js/ai.js";

export function playOne(seed, mode = "two", n = 3, colors = 6, maxDecisions = 20000) {
  const ps = Array.from({ length: n }, (_, i) =>
    Player(`P${i + 1}`, mode === "two" ? [i, i + colors / 2] : [i], true));
  const g = new Game(ps, mode, Config.forBoard(colors, "beginner", mode), seed);
  const ais = ps.map((_, i) => new SimpleAI(seed * 10 + i));
  for (let k = 0; !g.over && g.pending && k < maxDecisions; k++) g.choose(ais[g.turn].choose(g));
  return g;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const N = +(process.argv[2] || 10);
  for (const [colors, mode, n] of [[6, "two", 3], [6, "one", 6], [4, "two", 2], [4, "one", 4]]) {
    let rounds = 0, done = 0;
    const wins = {};
    const t0 = Date.now();
    for (let s = 0; s < N; s++) {
      const g = playOne(s, mode, n, colors);
      if (g.over) { done++; rounds += g.turnNo; wins[g.places[0]] = (wins[g.places[0]] || 0) + 1; }
    }
    console.log(`${colors} colors, ${mode}, ${n} players: ${done}/${N} finished, mean ${Math.round(rounds / done)} rounds,` +
      ` wins by seat ${JSON.stringify(wins)}, ${((Date.now() - t0) / N).toFixed(0)} ms/game`);
  }
}

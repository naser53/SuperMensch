// Regression check: plays fixed games (seeded dice and choices, every board and game
// type) and compares a fingerprint of every state with tests/golden.json.
//   node tests/golden.mjs           check
//   node tests/golden.mjs --record  write tests/golden.json again (only after a wanted rule change)
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { Config } from "../js/config.js";
import { Game, Option, Player, mulberry32 } from "../js/engine.js";
import { tr } from "../js/i18n.js";

const FILE = new URL("./golden.json", import.meta.url);

function sig(dec, o) {
  if (dec.kind === "play") {
    const st = o.payload.state;
    return JSON.stringify([st.pos, st.hunters.map(h => (h ? h.slice(0, 3) : null)), st.tunnels]);
  }
  return JSON.stringify(o.payload);
}

function fnv(s, h = 2166136261) {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

export function playFixed(seed, mode, n, colors, maxDec = 2500) {
  const rng = mulberry32(seed * 7919 + 1);
  const ps = Array.from({ length: n }, (_, i) => Player(`P${i + 1}`, mode === "two" ? [i, i + colors / 2] : [i], true));
  const g = new Game(ps, mode, Config.forBoard(colors, "beginner", mode), seed, true);
  let h = 2166136261, k = 0;
  while (!g.over && g.pending && k < maxDec) {
    const dec = g.pending;
    if (dec.kind === "dice") {
      g.choose(new Option(null, ["dice", dec.dice.map(() => [1, 2, 3, 4, 5, 6, 6][Math.floor(rng() * 7)])]));
    } else {
      const sigs = dec.options.map(o => sig(dec, o)).sort();
      h = fnv(sigs.join("|"), h);
      const chosen = dec.kind === "pre_roll" && rng() < 0.6 ? JSON.stringify("roll") : sigs[Math.floor(rng() * sigs.length)];
      g.choose(dec.options.find(o => sig(dec, o) === chosen));
    }
    const s = g.state;
    h = fnv(JSON.stringify([s.pos, s.kills, s.hunters, s.scores, s.tunnels, s.tmark, g.cards, g.turn, g.turnNo, g.noSix]), h);
    k++;
  }
  h = fnv(g.log.map(m => tr("en", m)).join("\n"), h);
  return { seed, mode, n, colors, decisions: k, places: g.places, scores: g.state.scores, rounds: g.turnNo, hash: h };
}

export function allGames() {
  const out = [];
  for (const colors of [6, 4])
    for (const mode of ["two", "one"]) {
      const ns = mode === "two" ? (colors === 6 ? [2, 3] : [2]) : [2, 4, colors];
      for (const n of ns) for (let s = 0; s < 5; s++) out.push(playFixed(s * 31 + n, mode, n, colors));
    }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const games = allGames();
  if (process.argv.includes("--record")) {
    fs.writeFileSync(FILE, JSON.stringify(games, null, 1) + "\n");
    console.log(`recorded ${games.length} games`);
  } else {
    const want = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const bad = games.filter((g, i) => JSON.stringify(g) !== JSON.stringify(want[i]));
    console.log(`${games.length} games, ${bad.length} differ`);
    for (const g of bad.slice(0, 5)) console.log("  ", JSON.stringify(g));
    process.exit(bad.length ? 1 : 0);
  }
}

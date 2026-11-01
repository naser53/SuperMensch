// Rebuild a game from the report that the Copy button of the move log (Info window) makes.
//   node tools/replay.mjs report.txt          print the moves and check the final fingerprint
//   node tools/replay.mjs report.txt 120      stop after event 120 and print the state there
// The report's last JSON line holds { version, setup, events, edits, fp }. Debug edits
// (the "score" and "move" commands) are applied again at the point where they were typed.
import { readFileSync } from "node:fs";
import { Table, fingerprint } from "../js/table.js";
import { runCommand } from "../js/debugcmd.js";
import { tr } from "../js/i18n.js";

const [file, stopArg] = process.argv.slice(2);
if (!file) { console.error("usage: node tools/replay.mjs <report file> [stop after N events]"); process.exit(1); }
const line = readFileSync(file, "utf8").split(/\r?\n/).reverse().find(l => l.trim().startsWith("{"));
if (!line) { console.error("no replay data (JSON line) in this file"); process.exit(1); }
const data = JSON.parse(line);
const stop = stopArg === undefined ? data.events.length : Math.min(+stopArg, data.events.length);

const t = new Table(data.setup, { autoDice: false });
const edits = (data.edits || []).slice();
const runEdits = at => {
  while (edits.length && edits[0].at === at) runCommand(t.game, edits.shift().cmd, o => t.choose(o));
};
for (let i = 0; i < stop; i++) {
  runEdits(i);
  t.apply(data.events[i]);
}
if (stop === data.events.length) runEdits(stop);

const g = t.game;
g.log.forEach((m, i) => console.log(`${i + 1}. ${tr("en", m)}`));
console.log("");
console.log(`events ${stop}/${data.events.length} · round ${g.turnNo} · turn of player ${g.turn + 1} · pending ${g.pending ? g.pending.kind : "none"}`);
console.log(`scores ${g.state.scores.join(" / ")}`);
const fp = fingerprint(g);
if (stop === data.events.length && data.fp) console.log(fp === data.fp ? `fingerprint ${fp} matches the report` : `fingerprint ${fp} DIFFERS from the report (${data.fp})`);
else console.log(`fingerprint ${fp}`);

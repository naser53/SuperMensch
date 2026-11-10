// Copy every room, user and setting from one SuperMensch server to another (owner, 2026-11-10:
// the game runs on Cloudflare and on a Linux server). The target's lobby is replaced by the copy.
//   FROM_KEY=... TO_KEY=... node tools/linux/copy-games.mjs <from-url> <to-url>
// e.g. from https://supermensch-dev.ndaneshi.workers.dev to http://localhost (on the Linux server:
// `sudo supermensch-copy`, which asks for the keys). Uses the admin routes export and import.
const [from, to] = process.argv.slice(2);
const { FROM_KEY, TO_KEY } = process.env;
if (!from || !to || !FROM_KEY || !TO_KEY) {
  console.error("usage: FROM_KEY=... TO_KEY=... node tools/linux/copy-games.mjs <from-url> <to-url>");
  process.exit(2);
}
const post = async (base, key, what, body) => {
  const r = await fetch(`${base.replace(/\/$/, "")}/api/admin/${what}`, {
    method: "POST", headers: { "content-type": "application/json", "x-admin-key": key }, body: JSON.stringify(body || {}) });
  const out = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || out.error) throw new Error(`${base} ${what}: ${out.error || r.status}`);
  return out;
};
const dump = await post(from, FROM_KEY, "export");
const n = Object.keys(dump.rooms).length, events = Object.values(dump.rooms).reduce((s, r) => s + r.events.length, 0);
console.log(`from ${from}: ${n} rooms, ${events} moves, ${dump.lobby.users.length} users`);
const r = await post(to, TO_KEY, "import", dump);
console.log(`to ${to}: ${r.rooms} rooms copied`);

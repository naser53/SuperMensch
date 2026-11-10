// The admin API (/api/admin/<what>). The worker checks the admin key, then calls adminApi.
// Every route here is a setting for the whole server or a test aid for one room.
// Returns a Response, or null when <what> is not an admin route (the worker answers 404).

import { Config } from "../js/config.js";
import { cleanBoard, cleanRings, cleanColors, cleanName, cleanPasskey, cleanRules, editSetup, isGameId, newPasskey, ruleDefaults, withEngine } from "./core.js";

export async function adminApi(what, body, { env, lobby, settings, json, fail }) {
  if (what === "check") return json({ ok: true });
  if (what === "rename" && body) return json(await lobby.rename(body.id, body.name));
  if (what === "games") return json(await lobby.allGames());
  // voice chat: the server-wide switch, and the tick per player; the open rooms hear of it at once
  if (what === "voice" && body) {
    await lobby.setVoiceOn(!!body.on);
    await voiceRefresh(env, lobby);
    return json(await settings());
  }
  if (what === "voicemode" && body) {       // "relay" or "p2p" (server/voice.js)
    await lobby.setVoiceMode(body.mode);
    await voiceRefresh(env, lobby);
    return json(await settings());
  }
  if (what === "uservoice" && body) {
    const users = await lobby.setUserVoice(body.id, !!body.on);
    await voiceRefresh(env, lobby);
    return json(users);
  }
  if (what === "colors" && body) {
    const colors = cleanColors(body.colors), board = body.board === undefined ? null : cleanBoard(body.board);
    await lobby.setColors(colors);
    if (board) await lobby.setBoard(board);
    if (body.rings !== undefined) await lobby.setRings(cleanRings(body.rings));
    return json(await settings());
  }
  if (what === "points" && body) {          // how a pawn shows its own points: "ring" or "headring"
    await lobby.setPoints(body.points);
    if (body.headring !== undefined) await lobby.setHeadring(body.headring); // the rings on the head
    if (body.rankrings !== undefined) await lobby.setRankrings(body.rankrings); // "metal" or "ring"
    return json(await settings());
  }
  if (what === "opendays" && body) {        // days without a move a room stays on the first page (0 = always)
    await lobby.setOpenDays(body.days);
    return json(await settings());
  }
  if (what === "hunter" && body) {          // what the hunter carries: "arrow" or "sword"
    await lobby.setHunter(body.hunter);
    return json(await settings());
  }
  // the game rules (Config.RULES) for every room made from now on; no rules in the body: just read them
  if (what === "rules" && body) {
    if (body.rules !== undefined) await lobby.setRules(cleanRules(body.rules));
    return json({ rules: await lobby.rules(), list: Config.RULES, defaults: ruleDefaults() });
  }
  if (what === "edit" && body && isGameId(body.id)) {        // who plays in a room (a test aid)
    const old = await lobby.setupOf(body.id);
    if (!old) return fail("no such game", 404);
    const { setup, keep } = editSetup(old, body.seats, await lobby.users());
    await env.ROOM.get(env.ROOM.idFromName(body.id)).edit(setup, keep);
    return json(await lobby.setSetup(body.id, setup));
  }
  if (what === "engine" && body && isGameId(body.id)) {      // the computer's level in a room
    const old = await lobby.setupOf(body.id);
    if (!old) return fail("no such game", 404);
    const setup = withEngine(old, body.engine);
    await env.ROOM.get(env.ROOM.idFromName(body.id)).setEngine(setup.engine || "beginner");
    return json(await lobby.updateSetup(body.id, setup));
  }
  if (what === "passkey" && body && isGameId(body.id)) {     // a room's passkey: four digits, none = a new one
    if (!(await lobby.setupOf(body.id))) return fail("no such game", 404);
    const given = body.passkey === undefined || body.passkey === "" ? newPasskey() : cleanPasskey(body.passkey);
    if (!given) return fail("passkey: four digits");
    await lobby.setPasskey(body.id, given);
    return json(await lobby.allGames());
  }
  if (what === "place" && body && isGameId(body.id)) {       // put the pieces somewhere (a test aid); no text: just show them
    const room = env.ROOM.get(env.ROOM.idFromName(body.id));
    return json({ text: await room.place(typeof body.text === "string" && body.text.trim() ? body.text : null) });
  }
  if (what === "debug" && body && isGameId(body.id)) {       // rewind N · roll dice 3,6 (a test aid); no text: the dice turns
    const room = env.ROOM.get(env.ROOM.idFromName(body.id));
    return json(await room.debug(typeof body.text === "string" && body.text.trim() ? body.text : null));
  }
  if (what === "renamegame" && body && isGameId(body.id)) {  // a new name for a room
    const name = cleanName(body.name);
    if (!name) return fail("the game needs a name");
    if (!(await lobby.setupOf(body.id))) return fail("no such game", 404);
    await env.ROOM.get(env.ROOM.idFromName(body.id)).setName(name);
    return json(await lobby.renameGame(body.id, name));
  }
  // Copy the whole server (owner, 2026-11-10: the game runs on Cloudflare and on a Linux server):
  // export gives the lobby's tables and every room's; import replaces this server's with them
  // (tools/linux/copy-games.mjs). Rooms not in the copy stay as they are.
  if (what === "export") {
    const lobbyDump = await lobby.dump();
    const rooms = {};
    for (const g of lobbyDump.games) rooms[g.id] = await env.ROOM.get(env.ROOM.idFromName(g.id)).dump();
    return json({ version: 1, lobby: lobbyDump, rooms });
  }
  if (what === "import" && body) {
    if (body.version !== 1 || !body.lobby || !body.rooms) return fail("not an export of this server");
    for (const [id, d] of Object.entries(body.rooms)) if (isGameId(id)) await env.ROOM.get(env.ROOM.idFromName(id)).restore(d);
    await lobby.restore(body.lobby);
    return json({ ok: true, rooms: Object.keys(body.rooms).length });
  }
  if (what === "delete" && body && isGameId(body.id)) {      // a test room: gone from the lists and the server
    await env.ROOM.get(env.ROOM.idFromName(body.id)).remove();
    return json(await lobby.removeGame(body.id));
  }
  return null;
}

// tell every open room that who may talk has changed (GameRoom.voiceRefresh)
async function voiceRefresh(env, lobby) {
  const games = await lobby.openGames();
  await Promise.all(games.map(g => env.ROOM.get(env.ROOM.idFromName(g.id)).voiceRefresh().catch(() => {})));
}

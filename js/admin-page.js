// The admin page (admin.html): the admin key, users, settings, rooms and the Debug panel.
// It talks to /api/admin/* (server/admin.js). npm run build bundles it into server/public/admin-page.js.
// Languages: the game's own (js/i18n.js), and the same choice: the game page's saved language
// (localStorage "supermensch".lang) is the admin page's too, and a switch here changes both.
// The texts are in js/admin-strings.js.
import { COLOR_NAMES, LANGS, LANG_NAMES, RTL, num } from "./i18n.js";
import { ADMIN_STR } from "./admin-strings.js";

const $ = s => document.querySelector(s);
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } },
                set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let key = "", users = [];

// the language, shared with the game page
const gameSettings = () => { try { return JSON.parse(store.get("supermensch") || "{}") || {}; } catch { return {}; } };
let lang = LANGS.includes(gameSettings().lang) ? gameSettings().lang : "en";
// T: a text in the page's language; params are put in as they come (numbers go through N first,
// for Persian digits; codes, ids and commands stay as they are)
const T = (k, p = {}) => String(ADMIN_STR[lang][k] ?? ADMIN_STR.en[k] ?? k)
  .replace(/\{(\w+)\}/g, (_, x) => (x in p ? p[x] : `{${x}}`));
const E = (k, p = {}) => {                                   // the same with the params escaped (for innerHTML)
  const q = {};
  for (const [x, v] of Object.entries(p)) q[x] = esc(v);
  return T(k, q);
};
const N = n => num(lang, n);
const errText = m => (ADMIN_STR[lang]["err_" + m] || ADMIN_STR.en["err_" + m] || m);
const dateText = ms => new Date(ms).toLocaleString(lang === "fa" ? "fa-IR" : lang);
// the page's fixed texts: data-t (text), data-th (our own markup), data-tp (placeholder)
function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL.has(lang) ? "rtl" : "ltr";
  document.title = T("title");
  document.querySelectorAll("[data-t]").forEach(x => { x.textContent = T(x.dataset.t); });
  document.querySelectorAll("[data-th]").forEach(x => { x.innerHTML = T(x.dataset.th); });
  document.querySelectorAll("[data-tp]").forEach(x => { x.placeholder = T(x.dataset.tp); });
  const b = $("#gColors").value || "6";
  $("#gColors").innerHTML = [4, 6, 8].map(n => `<option value="${n}" ${String(n) === b ? "selected" : ""}>${E("n_colors", { n: N(n) })}</option>`).join("");
}
$("#lang").innerHTML = LANGS.map(l => `<option value="${l}">${LANG_NAMES[l]}</option>`).join("");
$("#lang").value = lang;
$("#lang").onchange = async () => {
  lang = $("#lang").value;
  store.set("supermensch", JSON.stringify({ ...gameSettings(), lang }));
  applyLang();
  if (!$("#panel").hidden) await redraw();
};
applyLang();

// the tabs (owner, 2026-11-09): Rooms, Players, Initial settings (the rules), Look; the last one open is kept
function showTab(name) {
  if (!document.querySelector(`.tab[data-tab="${name}"]`)) name = "rooms";
  document.querySelectorAll(".tab").forEach(t => { t.hidden = t.dataset.tab !== name; });
  document.querySelectorAll("#tabs [data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  store.set("adminTab", name);
}
document.querySelectorAll("#tabs [data-tab]").forEach(b => { b.onclick = () => showTab(b.dataset.tab); });
showTab(store.get("adminTab") || "rooms");
const api = async (path, body) => {
  const r = await fetch("/api/" + path, body === undefined ? {} :
    { method: "POST", headers: { "content-type": "application/json", "x-admin-key": key }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(errText(d.error || r.status));
  return d;
};
const show = (el, msg, bad) => { $(el).className = bad ? "err" : "ok"; $(el).textContent = msg; };
// draw the lists again in the new language (the fixed texts change in applyLang)
async function redraw() {
  await loadUsers();
  await loadColors();
  if (rulesInfo) showRules(rulesInfo);
  seatRows();
  await loadRooms();
}

async function loadUsers() {
  users = await api("users");
  $("#users").innerHTML = users.map(u => `<div class="row"><code>${u.id}</code>
    <input data-uid="${u.id}" value="${esc(u.name)}" size="20"><button data-ren="${u.id}">${E("rename")}</button>
    <label title="${E("voice_tip")}"><input type="checkbox" data-uvoice="${u.id}" ${u.voice ? "checked" : ""}> ${E("voice")}</label></div>`).join("") +
    `<div id="renMsg"></div>`;
  document.querySelectorAll("[data-ren]").forEach(b => b.onclick = async () => {
    const id = +b.dataset.ren;
    try { await api("admin/rename", { id, name: document.querySelector(`[data-uid="${id}"]`).value }); await loadUsers(); seatRows(); show("#renMsg", T("saved")); }
    catch (e) { show("#renMsg", e.message, true); }
  });
  document.querySelectorAll("[data-uvoice]").forEach(x => x.onchange = async () => {
    try { users = await api("admin/uservoice", { id: +x.dataset.uvoice, on: x.checked }); show("#renMsg", T("saved")); }
    catch (e) { x.checked = !x.checked; show("#renMsg", e.message, true); }
  });
}

// voice chat: the server-wide switch, and whether Cloudflare Realtime is set up (server/voice.js)
const showVoice = d => {
  const v = d.voice || {};
  $("#voiceOn").checked = !!v.on;
  $("#voiceReady").innerHTML = T(v.ready ? "voice_ready" : "voice_not_ready");
};
$("#voiceOn").onchange = async () => {
  try { showVoice(await api("admin/voice", { on: $("#voiceOn").checked })); show("#voiceMsg", T("saved_dot")); }
  catch (e) { show("#voiceMsg", e.message, true); }
};

// the piece colors of every game (server settings): a color picker each, and a way back to the default
const BOARD_NAMES = ["surface", "edge"];
// one color picker with a Default button; kind "col" (pieces), "rng" (points ring and bar) or "brd" (board)
const picker = (kind, i, name, value, def) => `<label><input type="color" data-${kind}="${i}" data-def="${def}" value="${value || def}">
    ${esc(name)} <button data-todef title="${E("back_to", { c: def })}">${E("default")}</button></label>`;
async function loadColors(d) {
  d = d || await api("settings");
  showHunter(d);
  showPoints(d);
  showVoice(d);
  $("#colors").innerHTML = d.defaults.map((def, i) => picker("col", i, COLOR_NAMES[lang][i] || T("color_n", { n: N(i + 1) }), d.colors[i], def)).join("");
  $("#ringColors").innerHTML = (d.ringDefaults || []).map((def, i) => picker("rng", i, COLOR_NAMES[lang][i] || T("color_n", { n: N(i + 1) }), (d.rings || [])[i], def)).join("");
  $("#boardColors").innerHTML = (d.boardDefaults || []).map((def, i) => picker("brd", i, T(BOARD_NAMES[i]), (d.board || [])[i], def)).join("");
  document.querySelectorAll("[data-todef]").forEach(b => b.onclick = e => {
    e.preventDefault();
    const x = b.parentElement.querySelector("input"); x.value = x.dataset.def;
  });
}
$("#colorsBtn").onclick = async () => {
  const colors = [...document.querySelectorAll("[data-col]")].map(x => x.value);
  const board = [...document.querySelectorAll("[data-brd]")].map(x => x.value);
  const rings = [...document.querySelectorAll("[data-rng]")].map(x => x.value);
  try { await loadColors(await api("admin/colors", { colors, board, ...(rings.length ? { rings } : {}) })); show("#colorsMsg", T("colors_saved")); }
  catch (e) { show("#colorsMsg", e.message, true); }
};
const showHunter = d => { const x = document.querySelector(`[name=hunter][value=${d.hunter === "sword" ? "sword" : "arrow"}]`); x.checked = true; };
$("#hunterBtn").onclick = async () => {
  try { showHunter(await api("admin/hunter", { hunter: document.querySelector("[name=hunter]:checked").value })); show("#hunterMsg", T("saved_dot")); }
  catch (e) { show("#hunterMsg", e.message, true); }
};
const showPoints = d => {
  document.querySelector(`[name=points][value=${["bar", "stack", "headsize"].includes(d.points) ? d.points : "ring"}]`).checked = true;
  $("#opacity").value = d.opacity || d.opacityDefault || 60;
};
$("#pointsBtn").onclick = async () => {
  try { showPoints(await api("admin/points", { points: document.querySelector("[name=points]:checked").value, opacity: Math.round(+$("#opacity").value) })); show("#pointsMsg", T("saved_dot")); }
  catch (e) { show("#pointsMsg", e.message, true); }
};
$("#colorsReset").onclick = () => document.querySelectorAll("[data-def]").forEach(x => { x.value = x.dataset.def; });

// the game rules for the whole server (Config.RULES; server/core.js cleanRules): a row per rule, one box
// for every board where the boards' defaults differ (6, 8, 4 colors), else one box for all
const BOARDS = [6, 8, 4];
let rulesInfo = null;
const ruleText = (r, v) => (r.kind === "list" ? v.join(", ") : String(v));
const ruleBox = (r, where, value, def) => {
  const at = `data-rule="${r.key}" data-at="${where}" data-def='${esc(JSON.stringify(def))}'`;
  if (r.kind === "bool") return `<input type="checkbox" ${at} ${value ? "checked" : ""}>`;
  if (r.kind === "int") return `<input type="number" ${at} min="${r.min}" max="${r.max}" step="1" value="${value}" title="${E("range_def", { min: N(r.min), max: N(r.max), def: N(def) })}">`;
  return `<input type="text" dir="ltr" ${at} value="${esc(ruleText(r, value))}" title="${E("def_is", { def: ruleText(r, def) })}">`;
};
const ruleValue = x => {
  const r = rulesInfo.list.find(q => q.key === x.dataset.rule);
  if (r.kind === "bool") return x.checked;
  if (r.kind === "int") return x.value.trim() === "" ? null : Number(x.value);
  return x.value.split(/[\s,،]+/).filter(Boolean).map(Number);
};
const markRule = x => x.classList.toggle("chg", JSON.stringify(ruleValue(x)) !== x.dataset.def);
function showRules(d) {
  rulesInfo = d;
  // one group (Config.RULES group) after the other, each with its own title and table
  let grp = null, rows = "", html = "";
  const close = () => { if (grp !== null) html += `<div style="overflow-x:auto"><table class="rules"><col class="n">${BOARDS.map(() => '<col class="b">').join("")}${rows}</table></div></div></div>`; };
  for (const r of d.list) {
    if (r.group !== grp) {
      close();
      grp = r.group;
      html += `<div class="grp wide"><div class="gh"><h3>${esc(ADMIN_STR[lang]["grp_" + grp] || grp)}</h3></div><div class="gb">`;
      rows = `<tr><th></th>${BOARDS.map(n => `<th>${E("n_colors", { n: N(n) })}</th>`).join("")}</tr>`;
    }
    const cell = where => {
      const n = where === "all" ? 6 : where, def = d.defaults[n][r.key];
      const v = ((d.rules[where] || {})[r.key]) ?? def;
      return ruleBox(r, where, v, def);
    };
    rows += `<tr><td>${esc(ADMIN_STR[lang]["rule_" + r.key] || r.label)} <code>${r.key}</code></td>` +
      (r.board ? BOARDS.map(n => `<td>${cell(n)}</td>`).join("") : `<td colspan="3">${cell("all")}</td>`) + "</tr>";
  }
  close();
  $("#rules").innerHTML = html;
  document.querySelectorAll("[data-rule]").forEach(x => { markRule(x); x.oninput = x.onchange = () => markRule(x); });
}
async function loadRules() { showRules(await api("admin/rules", {})); }
$("#rulesBtn").onclick = async () => {
  const rules = { all: {} };
  for (const n of BOARDS) rules[n] = {};
  document.querySelectorAll("[data-rule]").forEach(x => { rules[x.dataset.at][x.dataset.rule] = ruleValue(x); });
  try { showRules(await api("admin/rules", { rules })); show("#rulesMsg", T("rules_saved")); }
  catch (e) { show("#rulesMsg", e.message, true); }
};
$("#rulesReset").onclick = () => document.querySelectorAll("[data-rule]").forEach(x => {
  const def = JSON.parse(x.dataset.def);
  if (x.type === "checkbox") x.checked = def; else x.value = Array.isArray(def) ? def.join(", ") : def;
  markRule(x);
});

// a new seat: the first is the computer (owner, 2026-11-02), the others the players in turn
const seatDefault = i => (i === 0 ? "ai" : users[i - 1] ? String(users[i - 1].id) : "ai");

function seatRows() {
  const colors = +$("#gColors").value, two = $("#gMode").value === "two", max = two ? colors / 2 : colors;
  const n = Math.min(+$("#gN").value || 2, max);
  $("#gN").innerHTML = Array.from({ length: max - 1 }, (_, i) => `<option value="${i + 2}" ${i + 2 === n ? "selected" : ""}>${N(i + 2)}</option>`).join("");
  const old = [...document.querySelectorAll("[data-seat]")].map(s => s.value);
  const opts = sel => users.map(u => `<option value="${u.id}" ${String(u.id) === sel ? "selected" : ""}>${esc(u.name)}</option>`).join("") +
    `<option value="ai" ${sel === "ai" ? "selected" : ""}>${E("engine")}</option>`;
  $("#seats").innerHTML = Array.from({ length: n }, (_, i) =>
    `<div class="row">${E("seat_n", { n: N(i + 1) })} <select data-seat="${i}">${opts(old[i] || seatDefault(i))}</select></div>`).join("");
}
for (const id of ["#gColors", "#gMode", "#gN"]) $(id).onchange = seatRows;
const corrShown = () => { $("#gCorr").disabled = $("#gColors").value === "4"; if ($("#gCorr").disabled) $("#gCorr").value = "10"; };
$("#gColors").addEventListener("change", corrShown);
// the computer's level follows the dice level (owner, 2026-11-07); it can still be set apart
$("#gLevel").addEventListener("change", () => { $("#gEngine").value = { difficult: "hard" }[$("#gLevel").value] || $("#gLevel").value; });

$("#createBtn").onclick = async () => {
  const colors = +$("#gColors").value, mode = $("#gMode").value, half = colors / 2;
  const seats = [...document.querySelectorAll("[data-seat]")].map((s, i) => {
    const cols = mode === "two" ? [i, i + half] : [i];
    return s.value === "ai" ? { ai: true, colors: cols } : { user: +s.value, colors: cols };
  });
  try {
    const r = await api("games", { name: $("#gName").value, setup: { mode, colors, level: $("#gLevel").value, engine: $("#gEngine").value, corridor: +$("#gCorr").value, seats } });
    show("#createMsg", T("room_made", { name: r.name, id: r.id }));
    $("#gName").value = "";
    loadRooms();
  } catch (e) { show("#createMsg", e.message, true); }
};

// a player's name as the room keeps it: the engine's in the page's language
const playerName = n => String(n).replace(/^Engine\b/, T("engine"));

// the computer's level of a room with a computer player (owner, 2026-11-07); none: beginner
const ENGINES = [["beginner", "lv_beginner"], ["intermediate", "lv_intermediate"], ["hard", "lv_difficult"]];
const engineSel = g => !g.setup.players.some(p => p.isAi) ? "" :
  `<span title="${E("engine_tip")}">${E("engine_lbl")} <select data-eng="${g.id}">` +
  ENGINES.map(([v, k]) => `<option value="${v}" ${(g.setup.engine || "beginner") === v ? "selected" : ""}>${E(k)}</option>`).join("") + "</select></span>";

// every room, with a button to delete it (a second press deletes). A finished game keeps its
// place in the list with a finish mark and its winner (owner, 2026-11-07).
async function loadRooms(list) {
  const gs = list || await api("admin/games", {});
  const state = g => {
    if (g.status !== "over") return esc(T("st_open"));
    const r = g.result, w = r && r.places && r.places.length ? r.names[r.places[0]] : null;
    return `<span class="over" title="${E("finished_tip")}">🏁 ${E("finished")}</span>` +
      (w !== null && w !== undefined ? ` ${E("winner", { p: playerName(w) })}` : "");
  };
  $("#rooms").innerHTML = (gs.length ? gs.map(g => `<div class="row"><b>${esc(g.name)}</b>
    <code>${g.id}</code> <span class="muted">${g.setup.corridor ? E("n_fields", { n: N(g.setup.corridor) }) + " · " : ""}${state(g)} · ${esc(dateText(g.updated))}</span>
    ${engineSel(g)}
    <span title="${E("passkey_tip")}">${E("passkey_lbl")} <input data-pk="${g.id}" value="${esc(g.passkey || "")}" size="4" maxlength="4" inputmode="numeric"> <button data-pks="${g.id}">${E("passkey_save")}</button></span>
    <button data-edit="${g.id}">${E("edit_players")}</button> <button data-dbg="${g.id}">${E("debug")}</button> <button data-del="${g.id}">${E("delete")}</button></div>
    <div id="edit-${g.id}"></div>`).join("") : `<div class="muted">${E("no_rooms")}</div>`) + `<div id="delMsg"></div>`;
  document.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editRoom(gs.find(g => g.id === b.dataset.edit)));
  document.querySelectorAll("[data-pks]").forEach(b => b.onclick = async () => {
    const id = b.dataset.pks;
    try { await loadRooms(await api("admin/passkey", { id, passkey: document.querySelector(`[data-pk="${id}"]`).value.trim() })); show("#delMsg", T("saved_dot")); }
    catch (e) { show("#delMsg", e.message, true); }
  });
  document.querySelectorAll("[data-eng]").forEach(s => s.onchange = async () => {
    try { await loadRooms(await api("admin/engine", { id: s.dataset.eng, engine: s.value })); show("#delMsg", T("saved_dot")); }
    catch (e) { show("#delMsg", e.message, true); }
  });
  document.querySelectorAll("[data-dbg]").forEach(b => b.onclick = () => debugRoom(gs.find(g => g.id === b.dataset.dbg)));
  document.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = T("sure_delete"); return; }
    try { await loadRooms(await api("admin/delete", { id: b.dataset.del })); }
    catch (e) { show("#delMsg", e.message, true); }
  });
}

// change who plays in a room (a test aid): replace, add or remove players. The same number
// of players keeps the game going; another number starts it again.
function editRoom(g) {
  const box = $("#edit-" + g.id), su = g.setup, max = su.mode === "two" ? su.colors / 2 : su.colors;
  let seats = su.players.map(p => (p.isAi ? "ai" : String(p.user)));
  const opts = sel => users.map(u => `<option value="${u.id}" ${String(u.id) === sel ? "selected" : ""}>${esc(u.name)}</option>`).join("") +
    `<option value="ai" ${sel === "ai" ? "selected" : ""}>${E("engine")}</option>`;
  const draw = () => {
    const full = seats.length >= max;
    box.innerHTML = `<section style="margin:6px 0 10px"><div class="muted">${E("places_of", { n: N(seats.length), max: N(max) })}${full ? E("full_note") : ""}</div>` +
      seats.map((v, i) => `<div class="row">${E("seat_n", { n: N(i + 1) })} <select data-es="${i}">${opts(v)}</select>
        ${seats.length > 2 ? `<button data-rm="${i}">${E("remove")}</button>` : ""}</div>`).join("") +
      `<div class="row"><button data-add ${full ? "disabled" : ""}>${E("add_player")}</button>
        <button class="primary" data-save>${E("save")}</button> <button data-cancel>${E("cancel")}</button></div>
      <div class="muted">${E(seats.length === su.players.length ? "same_n" : "other_n")}
        ${E("pick_again")}</div><div data-msg></div></section>`;
    box.querySelectorAll("[data-es]").forEach(x => x.onchange = () => { seats[+x.dataset.es] = x.value; });
    box.querySelectorAll("[data-rm]").forEach(x => x.onclick = () => { seats.splice(+x.dataset.rm, 1); draw(); });
    box.querySelector("[data-add]").onclick = () => {
      const free = users.find(u => !seats.includes(String(u.id)));
      seats.push(free ? String(free.id) : "ai"); draw();
    };
    box.querySelector("[data-cancel]").onclick = () => { box.innerHTML = ""; };
    box.querySelector("[data-save]").onclick = async () => {
      try {
        const list = await api("admin/edit", { id: g.id, seats: seats.map(v => (v === "ai" ? { ai: true } : { user: +v })) });
        await loadRooms(list);
        show("#delMsg", T("players_saved", { name: g.name }));
      } catch (e) { box.querySelector("[data-msg]").className = "err"; box.querySelector("[data-msg]").textContent = e.message; }
    };
  };
  draw();
}

// Debug a room (a test aid): one box for every command, one per line, run in order. The i button
// shows the commands (the text "debug_help"). Piece lines go to admin/place, rewind / roll dice /
// reset to admin/debug, rename to admin/renamegame. The players' pages load the game again.
// The commands themselves stay English in every language.
const DEBUG_CMD = /^\s*(reset|rewind\b|go\s+drop\b|roll\s+dice\b|drop\s+dice\b)/i;
const RENAME_CMD = /^\s*rename\s+(.+)$/i;

async function debugRoom(g, note = null, keep = "") {
  const box = $("#edit-" + g.id);
  let d, p;
  try { [d, p] = await Promise.all([api("admin/debug", { id: g.id }), api("admin/place", { id: g.id })]); }
  catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  box.innerHTML = `<section style="margin:6px 0 10px;position:relative">
    <div class="row"><b>${E("debug")}</b> <button data-help title="${E("commands")}" aria-label="${E("commands")}" style="border-radius:50%;width:26px;height:26px;padding:0;font-weight:bold;font-style:italic;font-family:serif">i</button></div>
    <pre data-helpbox hidden style="position:absolute;z-index:5;top:40px;left:12px;right:12px;margin:0;padding:10px 12px;background:#fffbe6;border:1px solid #e0c96b;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.18);white-space:pre-wrap;unicode-bidi:plaintext;font-size:12.5px">${T("debug_help")}</pre>
    <textarea data-dc dir="ltr" spellcheck="false" style="display:block;box-sizing:border-box;width:100%;min-height:7em;resize:vertical;font:14px/1.4 monospace;padding:6px 8px">${esc(keep)}</textarea>
    <div class="row"><button class="primary" data-drun>${E("run")}</button> <button data-dreset>${E("reset_game")}</button> <button data-dclose>${E("close")}</button>
      <span class="muted">${E("run_hint")}</span></div>
    <div data-msg></div>
    <div class="muted">${E("pieces_now")}</div><pre dir="ltr" style="margin:2px 0 8px;font-size:12px">${esc(p.text)}</pre>
    <div class="muted">${E("dice_turns")}</div><pre data-dt dir="ltr" style="margin:2px 0;max-height:16em;overflow:auto;font-size:12px">${esc(d.turns || T("no_dice"))}</pre></section>`;
  const msg = box.querySelector("[data-msg]"), ta = box.querySelector("[data-dc]"), help = box.querySelector("[data-helpbox]");
  if (note) { msg.className = note.err ? "err" : "ok"; msg.textContent = note.text; }
  box.querySelector("[data-help]").onclick = () => { help.hidden = !help.hidden; };
  help.onclick = () => { help.hidden = true; };
  box.querySelector("[data-dclose]").onclick = () => { box.innerHTML = ""; };
  const doneText = done => T("done_list", { list: done.join(" · ") });
  const run = async text => {
    const lines = text.split("\n").map(s => s.trim()).filter(Boolean), done = [];
    let pieces = [], renamed = false;
    const flush = async () => {
      if (!pieces.length) return;
      await api("admin/place", { id: g.id, text: pieces.join("\n") });
      done.push(pieces.length === 1 ? T("placed_one", { x: pieces[0] }) : T("placed_n", { n: N(pieces.length) }));
      pieces = [];
    };
    try {
      for (const line of lines) {
        const rn = RENAME_CMD.exec(line);
        if (rn) {
          await flush();
          await api("admin/renamegame", { id: g.id, name: rn[1].trim() });
          g.name = rn[1].trim(); renamed = true;
          done.push(T("renamed_to", { name: g.name }));
        } else if (DEBUG_CMD.test(line)) {
          await flush();
          const r = await api("admin/debug", { id: g.id, text: line });
          done.push(r.turn === null ? T("starts_again") : T("back_turn", { n: N(r.turn) }));
        } else pieces.push(line);
      }
      await flush();
      if (renamed) await loadRooms();
      await debugRoom(g, { text: done.length ? doneText(done) : T("nothing_run") });
    } catch (e) {
      if (renamed) await loadRooms();
      await debugRoom(g, { err: true, text: (done.length ? doneText(done) + " " : "") + e.message }, text);   // keep the text to fix it
    }
  };
  box.querySelector("[data-drun]").onclick = () => run(ta.value);
  ta.onkeydown = e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(ta.value); };
  const rb = box.querySelector("[data-dreset]");          // a second press resets
  rb.onclick = () => { if (rb.dataset.sure !== "1") { rb.dataset.sure = "1"; rb.textContent = T("sure_reset"); return; } run("reset"); };
  const pre = box.querySelector("[data-dt]");
  pre.scrollTop = pre.scrollHeight;
}

async function open() {
  key = $("#adminKey").value;
  try { await api("admin/check", {}); } catch (e) { show("#loginErr", e.message, true); return; }
  store.set("adminKey", key);
  $("#login").hidden = true;
  $("#panel").hidden = false;
  await loadUsers();
  await loadColors();
  await loadRules();
  seatRows();
  await loadRooms();
}
$("#adminBtn").onclick = open;
$("#adminKey").value = store.get("adminKey") || "";
if ($("#adminKey").value) open();

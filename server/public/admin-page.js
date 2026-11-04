// The admin page (admin.html): the admin key, users, settings, rooms and the Debug panel.
// It talks to /api/admin/* (server/admin.js).
const $ = s => document.querySelector(s);
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } },
                set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let key = "", users = [];
const api = async (path, body) => {
  const r = await fetch("/api/" + path, body === undefined ? {} :
    { method: "POST", headers: { "content-type": "application/json", "x-admin-key": key }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || r.status);
  return d;
};
const show = (el, msg, bad) => { $(el).className = bad ? "err" : "ok"; $(el).textContent = msg; };

async function loadUsers() {
  users = await api("users");
  $("#users").innerHTML = users.map(u => `<div class="row"><code>${u.id}</code>
    <input data-uid="${u.id}" value="${esc(u.name)}" size="20"><button data-ren="${u.id}">Rename</button>
    <label title="May talk in voice chat"><input type="checkbox" data-uvoice="${u.id}" ${u.voice ? "checked" : ""}> Voice</label></div>`).join("") +
    `<div id="renMsg"></div>`;
  document.querySelectorAll("[data-ren]").forEach(b => b.onclick = async () => {
    const id = +b.dataset.ren;
    try { await api("admin/rename", { id, name: document.querySelector(`[data-uid="${id}"]`).value }); await loadUsers(); seatRows(); show("#renMsg", "Saved"); }
    catch (e) { show("#renMsg", e.message, true); }
  });
  document.querySelectorAll("[data-uvoice]").forEach(x => x.onchange = async () => {
    try { users = await api("admin/uservoice", { id: +x.dataset.uvoice, on: x.checked }); show("#renMsg", "Saved"); }
    catch (e) { x.checked = !x.checked; show("#renMsg", e.message, true); }
  });
}

// voice chat: the server-wide switch, and whether Cloudflare Realtime is set up (server/voice.js)
const showVoice = d => {
  const v = d.voice || {};
  $("#voiceOn").checked = !!v.on;
  $("#voiceReady").innerHTML = v.ready ? "Cloudflare Realtime is set up."
    : '<span class="err">Cloudflare Realtime is not set up yet</span>: add the secrets <code>REALTIME_APP_ID</code> and <code>REALTIME_APP_TOKEN</code> (see the README). Until then nobody can talk.';
};
$("#voiceOn").onchange = async () => {
  try { showVoice(await api("admin/voice", { on: $("#voiceOn").checked })); show("#voiceMsg", "Saved."); }
  catch (e) { show("#voiceMsg", e.message, true); }
};

// the piece colors of every game (server settings): a color picker each, and a way back to the default
const COLOR_NAMES = ["Red", "Blue", "Green", "Yellow", "Purple", "Teal", "Pink", "Black"];
const BOARD_NAMES = ["Surface", "Edge"];
// one color picker with a Default button; kind "col" (pieces) or "brd" (board)
const picker = (kind, i, name, value, def) => `<label><input type="color" data-${kind}="${i}" data-def="${def}" value="${value || def}">
    ${name} <button data-todef title="Back to ${def}">Default</button></label>`;
async function loadColors(d) {
  d = d || await api("settings");
  showHunter(d);
  showPoints(d);
  showVoice(d);
  $("#colors").innerHTML = d.defaults.map((def, i) => picker("col", i, COLOR_NAMES[i] || "Color " + (i + 1), d.colors[i], def)).join("");
  $("#boardColors").innerHTML = (d.boardDefaults || []).map((def, i) => picker("brd", i, BOARD_NAMES[i], (d.board || [])[i], def)).join("");
  document.querySelectorAll("[data-todef]").forEach(b => b.onclick = e => {
    e.preventDefault();
    const x = b.parentElement.querySelector("input"); x.value = x.dataset.def;
  });
}
$("#colorsBtn").onclick = async () => {
  const colors = [...document.querySelectorAll("[data-col]")].map(x => x.value);
  const board = [...document.querySelectorAll("[data-brd]")].map(x => x.value);
  try { await loadColors(await api("admin/colors", { colors, board })); show("#colorsMsg", "Saved. Every game uses these colors now."); }
  catch (e) { show("#colorsMsg", e.message, true); }
};
const showHunter = d => { const x = document.querySelector(`[name=hunter][value=${d.hunter === "sword" ? "sword" : "arrow"}]`); x.checked = true; };
$("#hunterBtn").onclick = async () => {
  try { showHunter(await api("admin/hunter", { hunter: document.querySelector("[name=hunter]:checked").value })); show("#hunterMsg", "Saved."); }
  catch (e) { show("#hunterMsg", e.message, true); }
};
const showPoints = d => { document.querySelector(`[name=points][value=${d.points === "bar" ? "bar" : "ring"}]`).checked = true; };
$("#pointsBtn").onclick = async () => {
  try { showPoints(await api("admin/points", { points: document.querySelector("[name=points]:checked").value })); show("#pointsMsg", "Saved."); }
  catch (e) { show("#pointsMsg", e.message, true); }
};
$("#colorsReset").onclick = () => document.querySelectorAll("[data-def]").forEach(x => { x.value = x.dataset.def; });

// a new seat: the first is the computer (owner, 2026-11-02), the others the players in turn
const seatDefault = i => (i === 0 ? "ai" : users[i - 1] ? String(users[i - 1].id) : "ai");

function seatRows() {
  const colors = +$("#gColors").value, two = $("#gMode").value === "two", max = two ? colors / 2 : colors;
  const n = Math.min(+$("#gN").value || 2, max);
  $("#gN").innerHTML = Array.from({ length: max - 1 }, (_, i) => `<option ${i + 2 === n ? "selected" : ""}>${i + 2}</option>`).join("");
  const old = [...document.querySelectorAll("[data-seat]")].map(s => s.value);
  const opts = sel => users.map(u => `<option value="${u.id}" ${String(u.id) === sel ? "selected" : ""}>${esc(u.name)}</option>`).join("") +
    `<option value="ai" ${sel === "ai" ? "selected" : ""}>Computer</option>`;
  $("#seats").innerHTML = Array.from({ length: n }, (_, i) =>
    `<div class="row">Seat ${i + 1} <select data-seat="${i}">${opts(old[i] || seatDefault(i))}</select></div>`).join("");
}
for (const id of ["#gColors", "#gMode", "#gN"]) $(id).onchange = seatRows;
const corrShown = () => { $("#gCorr").disabled = $("#gColors").value === "4"; if ($("#gCorr").disabled) $("#gCorr").value = "10"; };
$("#gColors").addEventListener("change", corrShown);

$("#createBtn").onclick = async () => {
  const colors = +$("#gColors").value, mode = $("#gMode").value, half = colors / 2;
  const seats = [...document.querySelectorAll("[data-seat]")].map((s, i) => {
    const cols = mode === "two" ? [i, i + half] : [i];
    return s.value === "ai" ? { ai: true, colors: cols } : { user: +s.value, colors: cols };
  });
  try {
    const r = await api("games", { name: $("#gName").value, setup: { mode, colors, level: $("#gLevel").value, corridor: +$("#gCorr").value, seats } });
    show("#createMsg", `Room "${r.name}" made (${r.id}). It shows on the game page now.`);
    $("#gName").value = "";
    loadRooms();
  } catch (e) { show("#createMsg", e.message, true); }
};

// every room, with a button to delete it (a second press deletes)
async function loadRooms(list) {
  const gs = list || await api("admin/games", {});
  $("#rooms").innerHTML = (gs.length ? gs.map(g => `<div class="row"><b>${esc(g.name)}</b>
    <code>${g.id}</code> <span class="muted">${g.setup.corridor ? g.setup.corridor + " fields · " : ""}${g.status} · ${new Date(g.updated).toLocaleString()}</span>
    <button data-edit="${g.id}">Edit players</button> <button data-dbg="${g.id}">Debug</button> <button data-del="${g.id}">Delete</button></div>
    <div id="edit-${g.id}"></div>`).join("") : `<div class="muted">No rooms.</div>`) + `<div id="delMsg"></div>`;
  document.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editRoom(gs.find(g => g.id === b.dataset.edit)));
  document.querySelectorAll("[data-dbg]").forEach(b => b.onclick = () => debugRoom(gs.find(g => g.id === b.dataset.dbg)));
  document.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Sure? Delete"; return; }
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
    `<option value="ai" ${sel === "ai" ? "selected" : ""}>Computer</option>`;
  const draw = () => {
    const full = seats.length >= max;
    box.innerHTML = `<section style="margin:6px 0 10px"><div class="muted">${seats.length} of ${max} places${full ? " (full: change a player, or remove one first)" : ""}</div>` +
      seats.map((v, i) => `<div class="row">Seat ${i + 1} <select data-es="${i}">${opts(v)}</select>
        ${seats.length > 2 ? `<button data-rm="${i}">Remove</button>` : ""}</div>`).join("") +
      `<div class="row"><button data-add ${full ? "disabled" : ""}>Add player</button>
        <button class="primary" data-save>Save</button> <button data-cancel>Cancel</button></div>
      <div class="muted">${seats.length === su.players.length ? "Same number of players: the game goes on." : "Another number of players: the game starts again."}
        Players in this room go back to the first page and pick their names again.</div><div data-msg></div></section>`;
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
        show("#delMsg", `Players of "${g.name}" saved.`);
      } catch (e) { box.querySelector("[data-msg]").className = "err"; box.querySelector("[data-msg]").textContent = e.message; }
    };
  };
  draw();
}

// Debug a room (a test aid): one box for every command, one per line, run in order. The i button
// shows the commands. Piece lines go to admin/place, rewind / roll dice / reset to admin/debug,
// rename to admin/renamegame. The players' pages load the game again.
const DEBUG_HELP = `<b>Pieces</b> (the current turn starts again)
  R2 23          red 2 on field 23
  R2z 3          red 2 on nest field 3 (also R2 z3)
  R1 y           red 1 in the yard
  R: 5 z1 y y    all the pieces of a color
  colors R B G Y P T N K · fields 1..L as on the board · z1 just inside the nest, z4 at the back
<b>Dice turns</b>
  rewind N       back to dice turn N (0 = the first, -1 = one before the last), same dice
  roll dice 3,6  the last dice turn again with these dice (as many as it had)
  reset          the game from the beginning
<b>Room</b>
  rename Name    a new name for the room`;
const DEBUG_CMD = /^\s*(reset|rewind\b|go\s+drop\b|roll\s+dice\b|drop\s+dice\b)/i;
const RENAME_CMD = /^\s*rename\s+(.+)$/i;

async function debugRoom(g, note = null, keep = "") {
  const box = $("#edit-" + g.id);
  let d, p;
  try { [d, p] = await Promise.all([api("admin/debug", { id: g.id }), api("admin/place", { id: g.id })]); }
  catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  box.innerHTML = `<section style="margin:6px 0 10px;position:relative">
    <div class="row"><b>Debug</b> <button data-help title="Commands" aria-label="Commands" style="border-radius:50%;width:26px;height:26px;padding:0;font-weight:bold;font-style:italic;font-family:serif">i</button></div>
    <pre data-helpbox hidden style="position:absolute;z-index:5;top:40px;left:12px;right:12px;margin:0;padding:10px 12px;background:#fffbe6;border:1px solid #e0c96b;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.18);white-space:pre-wrap;font-size:12.5px">${DEBUG_HELP}</pre>
    <textarea data-dc spellcheck="false" style="display:block;box-sizing:border-box;width:100%;min-height:7em;resize:vertical;font:14px/1.4 monospace;padding:6px 8px">${esc(keep)}</textarea>
    <div class="row"><button class="primary" data-drun>Run</button> <button data-dreset>Reset game</button> <button data-dclose>Close</button>
      <span class="muted">one command per line; Ctrl+Enter runs</span></div>
    <div data-msg></div>
    <div class="muted">Pieces now</div><pre style="margin:2px 0 8px;font-size:12px">${esc(p.text)}</pre>
    <div class="muted">Dice turns</div><pre data-dt style="margin:2px 0;max-height:16em;overflow:auto;font-size:12px">${esc(d.turns || "No dice yet.")}</pre></section>`;
  const msg = box.querySelector("[data-msg]"), ta = box.querySelector("[data-dc]"), help = box.querySelector("[data-helpbox]");
  if (note) { msg.className = note.err ? "err" : "ok"; msg.textContent = note.text; }
  box.querySelector("[data-help]").onclick = () => { help.hidden = !help.hidden; };
  help.onclick = () => { help.hidden = true; };
  box.querySelector("[data-dclose]").onclick = () => { box.innerHTML = ""; };
  const run = async text => {
    const lines = text.split("\n").map(s => s.trim()).filter(Boolean), done = [];
    let pieces = [], renamed = false;
    const flush = async () => {
      if (!pieces.length) return;
      await api("admin/place", { id: g.id, text: pieces.join("\n") });
      done.push(`placed ${pieces.length === 1 ? pieces[0] : pieces.length + " lines"}`);
      pieces = [];
    };
    try {
      for (const line of lines) {
        const rn = RENAME_CMD.exec(line);
        if (rn) {
          await flush();
          await api("admin/renamegame", { id: g.id, name: rn[1].trim() });
          g.name = rn[1].trim(); renamed = true;
          done.push(`renamed to "${g.name}"`);
        } else if (DEBUG_CMD.test(line)) {
          await flush();
          const r = await api("admin/debug", { id: g.id, text: line });
          done.push(r.turn === null ? "the game starts again" : `back to dice turn #${r.turn}`);
        } else pieces.push(line);
      }
      await flush();
      if (renamed) await loadRooms();
      await debugRoom(g, { text: done.length ? "Done: " + done.join(" · ") + "." : "Nothing to run." });
    } catch (e) {
      if (renamed) await loadRooms();
      await debugRoom(g, { err: true, text: (done.length ? "Done: " + done.join(" · ") + ". " : "") + e.message }, text);   // keep the text to fix it
    }
  };
  box.querySelector("[data-drun]").onclick = () => run(ta.value);
  ta.onkeydown = e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(ta.value); };
  const rb = box.querySelector("[data-dreset]");          // a second press resets
  rb.onclick = () => { if (rb.dataset.sure !== "1") { rb.dataset.sure = "1"; rb.textContent = "Sure? Reset"; return; } run("reset"); };
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
  seatRows();
  await loadRooms();
}
$("#adminBtn").onclick = open;
$("#adminKey").value = store.get("adminKey") || "";
if ($("#adminKey").value) open();

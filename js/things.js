"use strict";
// VLS editor - js/things.js: things: A/B/C codes, panel, sector attach
// ================= THINGS =================
// Creatures are always attached to a sector (sectorId). The stored position is absolute,
// but moving a sector moves its creatures too, so they stay in their places.
// The number (id) is the technical code letter+3 digits (A000 — player, A/B/C — category),
// issued automatically and not editable: the engine uses it to tell instances apart,
// to bind lifts (call buttons), keys and the player spawn point.
// ID (name) — what the creature is (player, zombie…), free and repeatable.

// Parse a creature code: A001, 'A 001', b12, C000 → {letter,num,code} or null
// (inner spaces are ignored, at most 3 digits)
function parseThingCode(s) {
  const m = String(s == null ? "" : s).trim().toUpperCase().replace(/\s+/g, "").match(/^([ABC])([0-9]{1,3})$/);
  if (!m) return null;
  const num = m[2].padStart(3, "0");
  return { letter: m[1], num, code: m[1] + num };
}
function isValidThingId(id) { return parseThingCode(id) != null; }

// Unique INSTANCE label (uid) — the editor's internal identity.
// The id itself (A001, B012…) is what creature it is, the type. It legally repeats on many
// instances, so you cannot select, move or delete by it — only by uid.
// uid is not written to .vls: the file stores the code, and the engine identifies a creature by code.
function ensureThingUids() {
  for (const t of mapData.things) if (t.uid == null) t.uid = mapData._idc++;
}
function thingByUid(uid) {
  if (uid == null) return null;
  return _lookup("t", mapData.things, t => t.uid).get(uid) || null;
}
// First free code of a category (A000 is never issued automatically — only by hand)
function nextThingId(prefix) {
  prefix = "ABC".indexOf(prefix) >= 0 ? prefix : "A";
  const used = new Set();
  for (const t of mapData.things) {
    const p = parseThingCode(t.id);
    if (p && p.letter === prefix) used.add(p.code);
  }
  for (let n = (prefix === "A" ? 1 : 0); n <= 999; n++) {
    const c = prefix + String(n).padStart(3, "0");
    if (!used.has(c)) return c;
  }
  return null;
}
// ================= EDITING A CREATURE CODE (letter + number separately) =================
// Check a code from a letter + raw input WITHOUT changes.
// Raw input is either 1–3 digits (5 → letter+005) or a full code (B012, the letter from the select is ignored).
// Returns {ok, code, same, msg}.
function previewThingCode(t, letter, numRaw) {
  numRaw = String(numRaw == null ? "" : numRaw).trim().replace(/\s+/g, "");
  let code = null;
  if (/^[0-9]{1,3}$/.test(numRaw) && "ABC".indexOf(letter) >= 0) {
    code = letter + numRaw.padStart(3, "0");
  } else {
    const p = parseThingCode(numRaw);
    if (p) code = p.code;
  }
  if (!code) return { ok: false, msg: tr("thing_code_bad") };
  if (code === "A000") return { ok: false, msg: tr("thing_id_player_reserved") };
  if (code === String(t.id).toUpperCase()) return { ok: true, code, same: true };
  // A repeated code is NOT forbidden: the id is the creature's type, not its serial number.
  // Several A003 on a map is normal (three identical technicians, three keys).
  return { ok: true, code };
}

// Re-point all lift bindings from the old code to the new one
function remapThingRefs(fromId, toId) {
  for (const L of (mapData.lifts || [])) {
    for (const f of L.floors) if (f.entityId === fromId) f.entityId = toId;
    if (L.zeroEntityId === fromId) L.zeroEntityId = toId;
  }
}

// Apply the checked code (the caller writes history — BEFORE the call).
// uid does not change — it does not depend on the code, so the selection and the multi-selection stay valid.
// But lift bindings store the CODE, they must be moved to the new one.
function applyThingCode(t, code) {
  const old = t.id;
  t.id = code;
  // A name that still equals the old code follows the code (otherwise creature A003 would keep the name A003)
  if (!t.name || String(t.name).toUpperCase() === String(old).toUpperCase()) t.name = code;
  remapThingRefs(old, code);
  toast(tr("thing_id_changed", old, code));
  log(tr("thing_id_changed", old, code));
}

// Step an existing creature's code with the ▲▼ buttons / ↑↓ arrow keys: exactly ±1.
// Duplicates are allowed, so the step never swaps anything — it just sets a new code.
function stepThingCode(t, dir, numEl, letterEl) {
  if (!t) return;
  const norm = s => String(s).toUpperCase();
  const raw = numEl ? String(numEl.value == null ? "" : numEl.value).trim().replace(/\s+/g, "") : "";
  let letter = (letterEl && "ABC".indexOf(letterEl.value) >= 0) ? letterEl.value : null;
  let n = null;
  if (/^[0-9]{1,3}$/.test(raw) && letter) n = parseInt(raw, 10);
  else {
    const p = parseThingCode(raw);
    if (p) { n = parseInt(p.num, 10); letter = p.letter; if (letterEl) letterEl.value = letter; }
  }
  if ((n == null || isNaN(n) || !letter)) {
    const p0 = parseThingCode(t.id);
    if (!p0) { toast(tr("thing_code_corrupt")); return; }
    letter = p0.letter; if (letterEl) letterEl.value = letter;
    n = parseInt(p0.num, 10);
  }
  n += dir;
  if (n < 0 || n > 999) { toast(tr("thing_step_limit", letter)); return; }
  const cand = letter + String(n).padStart(3, "0");
  if (norm(t.id) === cand) return;
  histPush();
  applyThingCode(t, cand);
  if (numEl) numEl.value = String(n).padStart(3, "0");
  updateThingPanel(); updateLiftPanel(); updateChecks(); draw(); saveMap();
  const ctm = document.getElementById("ctm");
  if (ctm && ctm.style.display !== "none") renderCtx();
}

// Apply the code from the left panel fields
function commitThingCode() {
  const t = thingByUid(sel.thing);
  if (!t) return;
  const r = previewThingCode(t, document.getElementById("thingLetter").value, document.getElementById("thingNum").value);
  if (!r.ok) {
    toast(r.msg);
    syncThingCodeInputs(t);
    return;
  }
  if (!r.same) { histPush(); applyThingCode(t, r.code); }
  updateThingPanel(); updateLiftPanel(); updateChecks(); draw(); saveMap();
}

// Step the selected creature's code (left panel)
function stepSelectedThing(dir) {
  const t = thingByUid(sel.thing);
  if (!t) return;
  stepThingCode(t, dir, document.getElementById("thingNum"), document.getElementById("thingLetter"));
}

// HTML escaping for inserting an id
function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Default name for a new entity — by category (follows the interface language)
function defaultThingName(letter) {
  return tr(({ A: "dflt_A", B: "dflt_B", C: "dflt_C" })[letter] || "dflt_A");
}
// Re-issue a creature with a broken id: coordinates stay, the id is re-issued, the name → default
function resetThingCode(t) {
  if (!t) return false;
  const oldId = t.id;
  const p = parseThingCode(oldId);
  const letter = p && "ABC".indexOf(p.letter) >= 0 ? p.letter : "A";
  const nid = nextThingId(letter);
  if (!nid) { toast(tr("thing_hud_full", letter)); return false; }
  t.id = nid;
  t.name = defaultThingName(letter);
  // uid does not change — the selection stays valid; bindings are cleaned (a broken code cannot be bound)
  for (const L of (mapData.lifts || [])) {
    for (const f of L.floors) if (f.entityId === oldId) { delete f.entityId; delete f.entityType; }
    if (L.zeroEntityId === oldId) { delete L.zeroEntityId; delete L.zeroEntityType; }
  }
  log(tr("thing_reset_ok") + " (" + t.x + ";" + t.y + ")");
  return true;
}
// Step the toolbar number (▲▼ / arrow keys): exactly ±1 within the category.
// Duplicate codes are allowed, so the step freely passes over taken numbers.
function stepCodeNumber(numEl, letter, dir) {
  if (!numEl) return;
  letter = "ABC".indexOf(letter) >= 0 ? letter : "A";
  const raw = String(numEl.value == null ? "" : numEl.value).trim().replace(/\s+/g, "");
  let l = letter, n = null;
  if (/^[0-9]{1,3}$/.test(raw)) n = parseInt(raw, 10);
  else {
    const p = parseThingCode(raw);
    if (p) { n = parseInt(p.num, 10); l = p.letter; }
  }
  if (n == null || isNaN(n)) n = dir > 0 ? -1 : 1000;
  n += dir;
  if (n < 0 || n > 999) { toast(tr("thing_step_limit", l)); return; }
  if (l === "A" && n === 0) { toast(tr("thing_id_player_reserved")); return; }
  numEl.value = String(n).padStart(3, "0");
}
function tryPlaceThing(wx, wy) {
  const catEl = document.getElementById("toolThingCat");
  const numEl = document.getElementById("toolThingNum");
  const letter = (catEl && "ABC".indexOf(catEl.value) >= 0) ? catEl.value : "A";
  // A manually typed number is the exact code (5 → A005, B012 → as-is);
  // an empty field — the next free one. The toolbar name is not set here: it is edited later.
  const typed = numEl ? numEl.value.trim() : "";
  let code = null;
  if (typed) {
    const r = previewThingCode({ id: null }, letter, typed);
    if (r.ok) code = r.code;
    else { toast(r.msg); return null; }
  }
  if (!code) code = nextThingId(letter);
  if (!code) {
    hudText = tr("thing_hud_full", letter);
    log(tr("thing_hud_full", letter));
    return null;
  }
  const sector = pickSectorAt(wx, wy);
  if (!sector) {
    hudText = tr("thing_hud_no_sector");
    log(tr("thing_hud_no_sector") + " (" + Math.round(wx) + ";" + Math.round(wy) + ")");
    return null;
  }
  const thing = {
    uid: mapData._idc++,   // instance uniqueness; the code (id) may repeat
    id: code,
    type: code,
    name: defaultThingName(letter),
    x: Math.round(wx),
    y: Math.round(wy),
    slot: 1,
    sectorId: sector.id
  };
  mapData.things.push(thing);
  // Suggest the next free code — so serial placement goes without duplicates.
  // This is only a default: the field is edited by hand and a duplicate may be typed.
  const nxt = nextThingId(letter);
  if (numEl) numEl.value = nxt ? nxt.slice(1) : "";
  hudText = tr("thing_hud_placed", thing.name, sector.id);
  log(tr("thing_hud_placed", thing.name, sector.id) + " (" + thing.x + ";" + thing.y + ")");
  return thing;
}

// Attaching creatures to sectors: for things without a sectorId we find a sector by coordinates
function attachThingsToSectors() {
  for (const t of mapData.things) {
    if (t.sectorId == null) {
      const s = pickSectorAt(t.x, t.y);
      if (s) t.sectorId = s.id;
    }
  }
}

// A creature belongs to the sector it PHYSICALLY ended up in.
// Belonging follows the position, not the previous sector: drag the player into the neighbouring
// room — it belongs to that room, and moving the old one will not drag it away.
// If there is no sector under the point (dragged into the void), the previous binding is kept:
// the sector is needed by lifts, call buttons and the renderer, it must not be lost.
function rebindThingSector(t) {
  if (!t) return;
  const s = pickSectorAt(t.x, t.y);
  if (s) t.sectorId = s.id;
}

// The same for a set of moved creatures (by uid)
function rebindMovedThings(uids) {
  for (const uid of uids) rebindThingSector(thingByUid(uid));
}

// Is there a player spawn point on the map: the number A000; legacy — ID 1 / 1 / 01 / Player 01 etc.
// The id (name) igrok/player also counts as a player point.
function isPlayerThing(t) {
  if (!t) return false;
  if (String(t.id == null ? "" : t.id).trim().toUpperCase() === "A000") return true;
  if (t.id === 1 || t.id === "1") return true;
  const norm = s => String(s || "").trim().replace(/^0+(?=\d)/, "").replace(/\s+/g, "").toLowerCase();
  const type = norm(t.type), name = norm(t.name);
  return type === "1" || type === "player" || type === "player1" || type === "player01" ||
         type === "игрок" || type === "igrok" ||
         name === "1" || name === "player" || name === "player1" || name === "player01" ||
         name === "игрок" || name === "igrok";
}

// Highlight the creatures panel when a diamond is picked
function updateThingPanel() {
  const t = thingByUid(sel.thing);
  const panel = document.getElementById("thingPanel");
  const empty = document.getElementById("thingEmpty");
  const fields = document.getElementById("thingFields");
  if (t) {
    panel.classList.add("on");
    empty.style.display = "none";
    fields.style.display = "block";
    syncThingCodeInputs(t);
    document.getElementById("thingName").value = t.name || "";
  } else {
    panel.classList.remove("on");
    empty.style.display = "block";
    fields.style.display = "none";
  }
}

// Fill the code fields (letter+number) from a creature; a broken id — highlight it and show the re-issue button
function syncThingCodeInputs(t) {
  const letterEl = document.getElementById("thingLetter");
  const numEl = document.getElementById("thingNum");
  const badRow = document.getElementById("thingCorrupt");
  if (!letterEl || !numEl) return;
  const p = parseThingCode(t.id);
  if (p) {
    letterEl.value = p.letter;
    numEl.value = p.num;
    numEl.classList.remove("bad");
    if (badRow) badRow.style.display = "none";
  } else {
    letterEl.value = "A";
    numEl.value = String(t.id == null ? "" : t.id).slice(0, 3);
    numEl.classList.add("bad");
    if (badRow) {
      badRow.style.display = "block";
      const cid = document.getElementById("thingCorruptId");
      if (cid) cid.textContent = String(t.id == null ? "—" : t.id);
    }
  }
}


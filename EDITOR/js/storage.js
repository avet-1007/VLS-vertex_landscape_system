"use strict";
// VLS editor - js/storage.js: autosave, projects, .vls export
// ================= AUTOSAVE (localStorage) =================
// After the site restarts, what you drew stays. If saving failed
// (say, file mode/a lock), the browser asks before reloading:
// 'Do you want to reload the site?' — if yes, everything drawn will be lost.
const AUTOSAVE_KEY = "vls_editor_autosave";
let persistOk = true;

function saveMap() {
  try {
    if (typeof localStorage === "undefined") { persistOk = false; return; }
    // along with the map we also save the camera (position + zoom)
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ data: mapData, view: { x: cam.x, y: cam.y, zoom: cam.zoom } }));
    persistOk = true;
  } catch (err) {
    persistOk = false;
  }
}
// Deferred autosave for hot paths (key repeat, dragging): one save per burst instead of one per tick.
let _saveTimer = null;
function saveMapSoon() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => { _saveTimer = null; saveMap(); }, 350);
}
function flushSave() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; saveMap(); }
}
window.addEventListener("pagehide", flushSave);
function restoreMap() {
  try {
    if (typeof localStorage === "undefined") return false;
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return false;
    let data = JSON.parse(raw);
    // new format: a {data, view} wrapper; the old one — mapData itself
    if (data && data.data && Array.isArray(data.data.vertices)) {
      const view = data.view || {};
      if (view.x != null && view.y != null) { cam.x = view.x; cam.y = view.y; }
      if (view.zoom != null) cam.zoom = Math.max(CAM_ZOOM_MIN, Math.min(CAM_ZOOM_MAX, view.zoom));
      data = data.data;
    }
    if (!data || !Array.isArray(data.vertices)) return false;
    mapData = data;
    if (!Array.isArray(mapData.lifts)) mapData.lifts = [];
    if (!Array.isArray(mapData.triggers)) mapData.triggers = [];
    if (!Array.isArray(mapData.connects)) mapData.connects = [];
    if (typeof texData === "function") { texData(); if (typeof texNormalize === "function") texNormalize(); }
    ensureIdc();
    normalizeLiftFloors();
    attachThingsToSectors();
    const strippedRestore = stripLiftConnects();
    if (strippedRestore) { const li = mapData.lifts.length; log(tr("log_lift_stripped_restore", strippedRestore, li)); }
    histReset();
    return true;
  } catch (err) {
    persistOk = false;
    return false;
  }
}
// The zero floor is the lift sector itself (not stored in floors[]).
function normalizeLiftFloors() {
  for (const L of mapData.lifts || []) {
    if (!L.floors) L.floors = [];
    // migration: if floors[0] is the old zero floor, move the key up to the lift and delete it
    if (L.floors.length && L.floors[0].name === "0") {
      if (!L.zeroEntityId && L.floors[0].entityId != null) { L.zeroEntityId = L.floors[0].entityId; L.zeroEntityType = L.floors[0].entityType; }
      L.floors.splice(0, 1);
    }
  }
}
// Before reloading: if autosave is impossible and there is something to lose — we ask.
window.addEventListener("beforeunload", e => {
  const hasData = mapData.vertices.length || mapData.lines.length || mapData.sectors.length || mapData.things.length || mapData.triggers.length;
  if (!persistOk && hasData) {
    e.preventDefault();
    e.returnValue = tr("beforeunload_msg");
  }
});

// ================= SAVE / LOAD PROJECT =================
function saveProject() {
  const view = { x: cam.x, y: cam.y, zoom: cam.zoom };
  mapData.__view = view;
  const data = JSON.stringify(mapData);
  delete mapData.__view;
  download(data, (mapData.name || "map") + ".vls", "text/plain");
}
// Recompute the id counter: not below max+1 across all collections (creatures excluded — they use A000 codes).
// Here we also issue uids to old/loaded creatures: the code repeats, so an instance can only be
// identified by its internal label. uid is not written to .vls — the file stores the code and the engine works by code.
function ensureIdc() {
  let mx = 1;
  const bump = v => { if (typeof v === "number" && v >= mx) mx = v + 1; };
  for (const v of mapData.vertices) bump(v.id);
  for (const l of mapData.lines) bump(l.id);
  for (const s of mapData.sectors) bump(s.id);
  for (const c of mapData.connects) bump(c.id);
  for (const tr of mapData.triggers) bump(tr.id);
  for (const L of mapData.lifts) bump(L.id);
  if ((mapData._idc || 1) <= mx) mapData._idc = mx;
  if (typeof ensureThingUids === "function") ensureThingUids();
  // guards against uid repeats in historically saved projects
  const seen = new Set();
  for (const t of mapData.things) {
    if (t.uid == null || seen.has(t.uid)) t.uid = mapData._idc++;
    else seen.add(t.uid);
    if ((mapData._idc || 1) <= t.uid) mapData._idc = t.uid + 1;
  }
}

// Common post-processing of a loaded map (both for a JSON project and for a text .vls)
function applyLoadedProject(data, srcKind) {
  if (!data || !Array.isArray(data.vertices)) throw new Error("no data");
  mapData = data;
  if (!Array.isArray(mapData.lifts)) mapData.lifts = [];
  if (!Array.isArray(mapData.triggers)) mapData.triggers = [];
  if (!Array.isArray(mapData.connects)) mapData.connects = [];
  if (typeof texData === "function") { texData(); if (typeof texNormalize === "function") texNormalize(); }
  ensureIdc();
  normalizeLiftFloors();
  attachThingsToSectors();
  const strippedLoad = stripLiftConnects();
  if (strippedLoad) log(tr("log_lift_stripped_load", strippedLoad));
  histReset();
  document.getElementById("mapName").value = mapData.name || "map01";
  updateThingPanel();
  updateLiftPanel();
  updateTriggerPanel();
  updateChecks(); draw(); saveMap();
  hudText = tr("hud_loaded", srcKind);
  updateHud();
  log(tr("log_loaded", srcKind.toLowerCase(), (mapData.name || tr("no_name")), mapData.vertices.length,
      mapData.lines.length, mapData.sectors.length, mapData.connects.length,
      mapData.things.length, mapData.triggers.length, mapData.lifts.length));
}

// Parser for the text .vls format (the very one exportMap writes).
// Tolerant of missing fields/comments. Returns mapData with continuous idc.
function parseVlsText(text) {
  const m = {
    name: "map01",
    version: "VLS.1",
    vertices: [], lines: [], sectors: [], connects: [], things: [], triggers: [], lifts: [],
    tex: { sectors: {}, world: [] },
    _idc: 1
  };
  let section = null, idcMax = 1;
  const texLayers = [];
  const bump = id => { if (typeof id === "number" && id >= idcMax) idcMax = id + 1; };
  const read = txt => String(txt).split(/\r?\n/);
  for (const raw of read(text)) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;
    const hdr = line.match(/^\[(\w+)\]$/);
    if (hdr) { section = hdr[1]; continue; }
    if (!section) {
      const kv = line.split("=", 2);
      if (kv.length === 2) {
        const k = kv[0].trim(), v = kv[1].trim();
        if (k === "name") m.name = v;
        else if (k === "version") m.version = v;
      }
      continue;
    }
    const parts = line.split(",");
    try {
      if (section === "vertices") {
        const id = +parts[0];
        m.vertices.push({ id, x: vlsNum(parts[1]), y: vlsNum(parts[2]) });
        bump(id);
      } else if (section === "lines") {
        const id = +parts[0];
        const ln = { id, a: +parts[1], b: +parts[2], tex: parts[3] || "wall_01", flags: parts[4] != null ? parts[4] : "0" };
        if (parts.indexOf("free") >= 0) ln.free = true;
        if (parts.indexOf("step") >= 0) ln.step = true;
        m.lines.push(ln);
        bump(id);
      } else if (section === "sectors") {
        const id = +parts[0];
        // old maps without modifiers wrote things straight after fragile (10th position)
        const legacy = parts[10] != null && parts[10].indexOf("things") === 0;
        const s = {
          id, verts: [], floorTex: parts[2] || "floor_01", wallTex: parts[3] || "wall_01",
          height: +parts[4] || 128, flags: +parts[5] || 0,
          offset: { x: +(parts[6] || 0) || 0, y: +(parts[7] || 0) || 0 },
          stone: parts[8] === "1", fragile: parts[9] === "1",
          close: legacy ? "" : (parts[10] || ""),
          finish: !legacy && (parts[11] === "1"),
          neighbors: []
        };
        const vs = parts[1];
        if (vs && vs.indexOf("v:") === 0) s.verts = vs.slice(2).split(":").map(n => +n);
        m.sectors.push(s);
        bump(id);
        const tik = legacy ? parts[10] : (parts[12] != null ? parts[12] : "");
        if (tik && tik.indexOf("things") === 0) {
          const body = tik.slice(6);
          if (body) for (const one of body.split(";")) {
            const f = one.split(":");
            const tid = (f[0] || "").trim();
            if (!tid) continue;
            m.things.push({
              id: tid, type: f[1] || "", x: vlsNum(f[2]), y: vlsNum(f[3]),
              slot: +(f[4] || 1) || 1, name: f[5] || "", sectorId: id
            });
          }
        }
      } else if (section === "connects") {
        const id = +parts[0];
        m.connects.push({ id, lineId: +parts[1], line2Id: +parts[2], fromSector: null, toSector: null });
        bump(id);
      } else if (section === "things") {
        const tid = (parts[0] || "").trim();
        if (!tid) continue;
        m.things.push({
          id: tid, type: parts[1] || "", name: parts[2] || "", x: vlsNum(parts[3]), y: vlsNum(parts[4]),
          slot: +(parts[5] || 1) || 1, sectorId: +(parts[6] || 0) || 0
        });
      } else if (section === "triggers") {
        const id = +parts[0];
        m.triggers.push({
          id, tid: parts[1] || "", type: parts[2] || "inner", ticks: +(parts[3] || 5) || 5,
          x1: vlsNum(parts[4]), y1: vlsNum(parts[5]), x2: vlsNum(parts[6]), y2: vlsNum(parts[7])
        });
        bump(id);
      } else if (section === "lifts") {
        const id = +parts[0];
        const L = { id, sectorId: +parts[1], curve: parts[2] || "sin", sec: +(parts[3] || 3) || 3, floors: [] };
        const zk = parts[4] || "";
        if (zk.indexOf("zero:") === 0) {
          const zf = zk.slice(5).split(":");
          if ((zf[0] || "").trim()) { L.zeroEntityId = zf[0].trim(); if (zf[1]) L.zeroEntityType = zf[1]; }
        }
        const floorStr = parts[5] || "";
        for (const one of floorStr.split("|")) {
          if (!one) continue;
          const f = one.split(":");
          const fl = { x: vlsNum(f[0]), y: vlsNum(f[1]), name: f[2] || "" };
          if (f[3] != null && (f[3] || "").trim() !== "") { fl.entityId = f[3].trim(); if (f[4] != null && f[4] !== "") fl.entityType = f[4]; }
          L.floors.push(fl);
        }
        m.lifts.push(L);
        bump(id);
      } else if (section === "textures") {
        // Sector layers and world rectangles. The `atlas = WxH` header line carries no
        // comma, so its kind is not "sec"/"world" and it is skipped here on purpose —
        // the engine uses it to check that its t-map.png matches the editor's.
        const kind = (parts[0] || "").trim();
        if (kind === "sec") {
          const sid = (parts[1] || "").trim();
          const li = +parts[2] || 0;
          const L = {
            id: +parts[3] || 0,
            name: (parts[4] || "").trim(),
            color: (parts[5] || "#4a7fd4").trim(),
            visible: parts[6] !== "0",
            items: []
          };
          const body = (parts[7] || "").trim();
          // item = id|x|y|rx|ry|rw|rh|pw|ph — the source rectangle and the placed size in
          // pixels; a file written before pw/ph existed simply falls back to rw/rh
          if (body) for (const one of body.split(";")) {
            const f = one.split("|");
            if (f.length < 7) continue;
            const rw = vlsNum(f[5]), rh = vlsNum(f[6]);
            L.items.push({
              id: +f[0] || 0,
              x: vlsNum(f[1]), y: vlsNum(f[2]),
              rx: vlsNum(f[3]), ry: vlsNum(f[4]),
              rw: rw, rh: rh,
              pw: f[7] != null && +f[7] > 0 ? +f[7] : rw,
              ph: f[8] != null && +f[8] > 0 ? +f[8] : rh
            });
          }
          bump(L.id);
          texLayers.push({ sid: sid, li: li, layer: L });
        } else if (kind === "world") {
          // world = id, x, y, w, h, rx, ry, rw, rh, name, visible
          m.tex.world.push({
            id: +parts[1] || 0,
            x: vlsNum(parts[2]), y: vlsNum(parts[3]),
            w: vlsNum(parts[4]), h: vlsNum(parts[5]),
            rx: vlsNum(parts[6]), ry: vlsNum(parts[7]),
            rw: vlsNum(parts[8]), rh: vlsNum(parts[9]),
            name: (parts[10] || "").trim(),
            visible: parts[11] !== "0"
          });
          bump(+parts[1]);
        }
      } else if (section === "summary") {
        const kv = line.split("=", 2);
        if (kv.length === 2 && kv[0].trim() === "idc") {
          const mx = +kv[1].trim();
          if (mx > idcMax) idcMax = mx;
        }
      }
    } catch (err) { /* skip the broken line */ }
  }
  // normalize creature codes to upper case (A001, not a001) — before dedup
  for (const t of m.things) { const p = parseThingCode(t.id); if (p) t.id = p.code; }
  for (const L of m.lifts) {
    if (L.zeroEntityId != null) { const p0 = parseThingCode(L.zeroEntityId); if (p0) L.zeroEntityId = p0.code; }
    for (const f of L.floors) if (f.entityId != null) { const p1 = parseThingCode(f.entityId); if (p1) f.entityId = p1.code; }
  }
  // Double-count removal: the export writes creatures BOTH into the sector inline field and into [things],
  // so the same record arrives twice on read.
  // The key is code + position, NOT code alone: different creatures legally share a code,
  // and gluing them together by code alone would simply destroy the map's duplicates.
  const tbl = new Map();
  for (const t of m.things) {
    const k = t.id + "|" + vlsNum(t.x) + "|" + vlsNum(t.y);
    tbl.set(k, t);   // last one wins: [things] comes after [sectors] and overrides the inline
  }
  m.things = Array.from(tbl.values());
  // texture layers arrive per sector, but the file may list them out of order
  texLayers.sort((a, b) => (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : (a.li - b.li)));
  for (const e of texLayers) {
    if (!Array.isArray(m.tex.sectors[e.sid])) m.tex.sectors[e.sid] = [];
    m.tex.sectors[e.sid].push(e.layer);
  }
  m._idc = Math.max(idcMax, 1);
  return m;
}

function applyLoadedMap(content) {
  const clean = content.replace(/^\ufeff/, "").trim();
  if (!clean) { alert(tr("err_empty_file")); return; }
  if (clean.charAt(0) === "{") {
    const data = JSON.parse(clean);
    // project camera (if saved)
    if (data.__view) {
      const view = data.__view;
      if (view.x != null && view.y != null) { cam.x = view.x; cam.y = view.y; }
      if (view.zoom != null) cam.zoom = Math.max(CAM_ZOOM_MIN, Math.min(CAM_ZOOM_MAX, view.zoom));
      delete data.__view;
    }
    applyLoadedProject(data, tr("src_project"));
  } else {
    applyLoadedProject(parseVlsText(clean), tr("src_vls"));
  }
}

document.getElementById("fileInput").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { applyLoadedMap(reader.result); }
    catch (err) { alert(tr("err_load", (err && err.message ? err.message : tr("err_bad_format")))); console.error(err); }
  };
  reader.readAsText(f);
  e.target.value = "";
};

// ================= EXPORT =================
// Strip separators of the text .vls format from a name/string
function vlsSanitize(s) {
  return String(s == null ? "" : s).replace(/[\r\n\t,;:|]/g, " ").trim();
}
function vlsNum(v) { return v == null || isNaN(v) ? 0 : +v; }

function exportMap() {
  const name = vlsSanitize(document.getElementById("mapName").value.trim() || "map01");
  // The export works on a snapshot: the live mapData is not touched (stripLiftConnects etc.
  // would be applied to the working session and eat the lift connections).
  const liveMap = mapData;
  const snap = cloneMap();
  snap.name = name;
  mapData = snap;
  // safety: lift line connections are never written to the file (only free passages)
  stripLiftConnects();
  // the A000 player is mandatory in the file: if it is missing — add an observer at (0,0) (export only)
  let observerAdded = false;
  if (!mapData.things.some(isPlayerThing)) {
    const sec0 = pickSectorAt(0, 0);
    mapData.things.push({ id: "A000", type: "Player", name: "Observer", x: 0, y: 0, slot: 1, sectorId: sec0 ? sec0.id : 0 });
    observerAdded = true;
    log(tr("log_observer_added"));
  }
  let out = "";

  out += "// VLS MAP v1 (.vls)\n";
  out += "// Vertex Landscape System — editor export\n";
  out += "// txt-like plain-text format with the .vls extension (the engine reads by content, not by extension)\n\n";

  out += "name = " + name + "\n";
  out += "version = " + (mapData.version || "VLS.1") + "\n";
  out += "units_per_cell = " + GRID_SIZE + "\n\n";

  // VERTICES
  out += "[vertices]\n";
  out += "// id, x, y\n";
  mapData.vertices.forEach(v => { out += v.id + "," + vlsNum(v.x) + "," + vlsNum(v.y) + "\n"; });
  out += "\n";

  // LINES
  out += "[lines]\n";
  out += "// id, vertexA, vertexB, texture, flags\n";
  out += "// flags: 0 = wall (collision), 1 = sector wall, 2 = portal/connection (passable), free = free passage, step = lift joint\n";
  mapData.lines.forEach(l => {
    let f = l.flags != null ? l.flags : "0";
    if (l.free) f += ",free";
    if (l.step) f += ",step";
    out += l.id + "," + l.a + "," + l.b + "," + (l.tex || "wall_01") + "," + f + "\n";
  });
  out += "\n";

  // SECTORS
  out += "[sectors]\n";
  out += "// id, vertices(v:id:id...), floor_tex, wall_tex, height, flags, offset_x, offset_y, stone, fragile, close(\"\"|\"0\"|\"1\" = door key), finish(1 = level end), things(id:type:x:y:slot:name;...)\n";
  mapData.sectors.forEach(s => {
    const thingsInS = mapData.things.filter(t => t.sectorId === s.id);
    out += s.id + ",v:" + s.verts.join(":") + "," + (s.floorTex || "floor_01") + "," + (s.wallTex || "wall_01") + "," + (s.height || 128) + "," + (s.flags || 0) + "," + ((s.offset && s.offset.x) || 0) + "," + ((s.offset && s.offset.y) || 0) + "," + (s.stone ? "1" : "0") + "," + (s.fragile ? "1" : "0") + "," + (s.close || "") + "," + (s.finish ? "1" : "");
    if (thingsInS.length) {
      out += ",things" + thingsInS.map(t => t.id + ":" + vlsSanitize(t.type) + ":" + vlsNum(t.x) + ":" + vlsNum(t.y) + ":" + (t.slot || 1) + ":" + vlsSanitize(t.name)).join(";");
    }
    out += "\n";
  });
  out += "\n";

  // CONNECTS
  out += "[connects]\n";
  out += "// id, line_id, line2_id\t// two lines of two sectors behaving as one passage\n";
  mapData.connects.forEach(c => out += c.id + "," + c.lineId + "," + (c.line2Id != null ? c.line2Id : "") + "\n");
  out += "\n";

  // THINGS
  out += "[things]\n";
  out += "// id (code: A000 player, A-machines/call buttons/keys, B-pickups, C-enemies/NPC), type, name, x, y, slot, sector_id\n";
  mapData.things.forEach(t => out += t.id + "," + vlsSanitize(t.type) + "," + vlsSanitize(t.name) + "," + vlsNum(t.x) + "," + vlsNum(t.y) + "," + (t.slot || 1) + "," + (t.sectorId || 0) + "\n");
  out += "\n";

  // TRIGGERS
  out += "[triggers]\n";
  out += "// id, tid, type, ticks, x1, y1, x2, y2\n";
  mapData.triggers.forEach(tr => {
    out += tr.id + "," + (tr.tid || "") + "," + (tr.type || "inner") + "," + (tr.ticks || 5) + "," + vlsNum(tr.x1) + "," + vlsNum(tr.y1) + "," + vlsNum(tr.x2) + "," + vlsNum(tr.y2) + "\n";
  });
  out += "\n";

  // LIFTS
  out += "[lifts]\n";
  out += "// id, sector_id, curve, sec, zeroKey[:entity_type]| floor(x:y:name[:caller_id[:caller_type]])\n";
  out += "// zero - key of the zero floor (the sector itself): 'zero:<id>[:<type>]' or '-' if none\n";
  mapData.lifts.forEach(L => {
    out += L.id + "," + L.sectorId + "," + (L.curve || "sin") + "," + (L.sec || 3) + ",";
    // the zero floor is the sector itself; the key that lowers the lift to the zero floor is written in the header
    const zType = L.zeroEntityType != null
      ? L.zeroEntityType
      : ((mapData.things.find(x => x.id === L.zeroEntityId) || {}).type || "");
    out += (L.zeroEntityId != null ? "zero:" + L.zeroEntityId + ":" + vlsSanitize(zType) : "-") + ",";
    out += L.floors.map(f => {
      let fs = vlsNum(f.x) + ":" + vlsNum(f.y) + ":" + vlsSanitize(f.name || "");
      if (f.entityId != null) {
        const ct = f.entityType != null ? f.entityType : ((mapData.things.find(x => x.id === f.entityId) || {}).type || "");
        fs += ":" + f.entityId + ":" + vlsSanitize(ct);
      }
      return fs;
    }).join("|") + "\n";
  });
  out += "\n";

  // TEXTURES — sector layers and world rectangles (web-editor extension).
  // Godot reads this section (vls_parser.gd): a sector with sprites gets a textured fill
  // and a thin black outline, everything else keeps its old look. The atlas header pins
  // the picture the regions were taken from, so the engine can warn on a mismatch.
  out += "[textures]\n";
  const atlasSz = (typeof texAtlasSize === "function") ? texAtlasSize() : null;
  if (atlasSz) out += "atlas = " + atlasSz.w + "x" + atlasSz.h + "\n";
  out += "// sec, sector_id, layer_index, layer_id, name, color, visible, items(id|x|y|rx|ry|rw|rh|pw|ph;...)\n";
  out += "// world, id, x, y, w, h, rx, ry, rw, rh, name, visible\n";
  const texOut = (mapData.tex && typeof mapData.tex === "object") ? mapData.tex : { sectors: {}, world: [] };
  for (const sid of Object.keys(texOut.sectors || {})) {
    const layers = texOut.sectors[sid];
    if (!Array.isArray(layers)) continue;
    layers.forEach((L, li) => {
      if (!L) return;
      const items = (Array.isArray(L.items) ? L.items : [])
        .filter(it => it && it.rw && it.rh)
        .map(it => it.id + "|" + vlsNum(it.x) + "|" + vlsNum(it.y)
                 + "|" + vlsNum(it.rx) + "|" + vlsNum(it.ry)
                 + "|" + vlsNum(it.rw) + "|" + vlsNum(it.rh)
                 + "|" + vlsNum(it.pw || it.rw) + "|" + vlsNum(it.ph || it.rh))
        .join(";");
      out += "sec," + sid + "," + li + "," + (L.id != null ? L.id : 0) + ","
           + vlsSanitize(L.name != null ? L.name : (li + 1)) + ","
           + vlsSanitize(L.color || "#4a7fd4") + ","
           + (L.visible === false ? "0" : "1") + "," + items + "\n";
    });
  }
  for (const r of (texOut.world || [])) {
    if (!r) continue;
    out += "world," + (r.id != null ? r.id : 0) + "," + vlsNum(r.x) + "," + vlsNum(r.y)
         + "," + vlsNum(r.w) + "," + vlsNum(r.h)
         + "," + vlsNum(r.rx) + "," + vlsNum(r.ry) + "," + vlsNum(r.rw) + "," + vlsNum(r.rh)
         + "," + vlsSanitize(r.name || "") + "," + (r.visible === false ? "0" : "1") + "\n";
  }
  out += "\n";

  // SUMMARY / help
  out += "[summary]\n";
  out += "vertices=" + mapData.vertices.length + "\n";
  out += "lines=" + mapData.lines.length + "\n";
  out += "sectors=" + mapData.sectors.length + "\n";
  out += "connects=" + mapData.connects.length + "\n";
  out += "things=" + mapData.things.length + "\n";
  out += "triggers=" + mapData.triggers.length + "\n";
  out += "lifts=" + mapData.lifts.length + "\n";
  out += "idc=" + mapData._idc + "\n";

  log(tr("log_exported", name, mapData.vertices.length,
      mapData.lines.length, mapData.sectors.length, mapData.connects.length,
      mapData.things.length, (mapData.triggers||[]).length, mapData.lifts.length));
  mapData = liveMap;
  download(out, name + ".vls", "text/plain");
  hudText = tr("hud_exported", name) + (observerAdded ? tr("hud_observer_add") : "");
  updateHud();
}

function download(content, filename, mime) {
  const blob = new Blob([content], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}


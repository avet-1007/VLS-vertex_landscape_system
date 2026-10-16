"use strict";
// VLS editor - js/clipboard.js: clipboard Ctrl+C/V, select all Ctrl+A
// ================= CLIPBOARD (Ctrl+C / Ctrl+V) =================
// Copies the selection together with all of its dependencies (line vertices, sector edges).
function copySelection() {
  const items = selItems();
  if (!items.length) { toast(tr("cb_nothing")); return; }
  const cb = { verts: [], lines: [], sectors: [], things: [], triggers: [], lifts: [], minX: Infinity, minY: Infinity };
  const vset = new Set(), lset = new Set(), sset = new Set(), tset = new Set(), trset = new Set(), liftIds = new Set();
  for (const m of items) {
    if (m.kind === "vertex") vset.add(m.id);
    else if (m.kind === "line") { lset.add(m.id); const l = getLineById(m.id); if (l) { vset.add(l.a); vset.add(l.b); } }
    else if (m.kind === "sector") { sset.add(m.id); const s = getSector(m.id); if (s) s.verts.forEach(id => vset.add(id)); }
    else if (m.kind === "thing") tset.add(m.id);
    else if (m.kind === "trigger") trset.add(m.id);
    else if (m.kind === "floor") { const lf = liftFloorByKey(m.id); if (lf) liftIds.add(lf.L.sectorId); }
  }
  // sector edges (lines between its vertices) and lifts of the selected sectors
  for (const s of mapData.sectors) {
    if (!sset.has(s.id)) continue;
    for (const l of mapData.lines) {
      if (s.verts.includes(l.a) && s.verts.includes(l.b)) lset.add(l.id);
    }
  }
  for (const L of mapData.lifts || []) if (sset.has(L.sectorId)) liftIds.add(L.sectorId);
  // creatures lying inside the copied sectors are copied together with the sector
  if (sset.size) for (const t of mapData.things) if (sset.has(t.sectorId)) tset.add(t.uid);
  for (const id of vset) { const v = getV(id); if (v) { cb.verts.push(v); cb.minX = Math.min(cb.minX, v.x || 0); cb.minY = Math.min(cb.minY, v.y || 0); } }
  for (const id of lset) { const l = getLineById(id); if (l) cb.lines.push(l); }
  for (const id of sset) { const s = getSector(id); if (s) cb.sectors.push(s); }
  // paste anchor — over the whole geometry of the buffer, not only its vertices
  // (otherwise a creature/trigger was pasted far from the cursor or on top of the original)
  for (const uid of tset) { const t = thingByUid(uid); if (t) { cb.things.push(t); cb.minX = Math.min(cb.minX, t.x || 0); cb.minY = Math.min(cb.minY, t.y || 0); } }
  for (const id of trset) { const t = mapData.triggers.find(x => x.id === id); if (t) { cb.triggers.push(t); cb.minX = Math.min(cb.minX, t.x1 || 0, t.x2 || 0); cb.minY = Math.min(cb.minY, t.y1 || 0, t.y2 || 0); } }
  for (const sid of liftIds) { const L = (mapData.lifts || []).find(x => x.sectorId === sid); if (L) { cb.lifts.push(L); for (const f of L.floors) { cb.minX = Math.min(cb.minX, f.x || 0); cb.minY = Math.min(cb.minY, f.y || 0); } } }
  if (!isFinite(cb.minX)) cb.minX = 0;
  if (!isFinite(cb.minY)) cb.minY = 0;
  clipboard = cb;
  toast(tr("cb_copied", cb.verts.length, cb.lines.length, cb.sectors.length, cb.things.length, cb.triggers.length));
  log(tr("cb_copy_log", cb.verts.length, cb.lines.length, cb.sectors.length, cb.things.length, cb.triggers.length));
}

// Paste the buffer offset to the current cursor position (GRID_SIZE step).
function pasteSelection() {
  if (!clipboard) { toast(tr("cb_empty")); return; }
  const w = preview || { x: cam.x, y: cam.y };
  const sx = snap(w.x), sy = snap(w.y);
  const offX = sx - Math.round(clipboard.minX / GRID_SIZE) * GRID_SIZE;
  const offY = sy - Math.round(clipboard.minY / GRID_SIZE) * GRID_SIZE;
  histPush(); // paste — one undo step
  const idMap = {};
  const sidMap = {};
  const pasted = [];
  let skippedThings = 0;
  for (const v of clipboard.verts) {
    const nid = mapData._idc++;
    idMap[v.id] = nid;
    mapData.vertices.push({ id: nid, x: v.x + offX, y: v.y + offY });
    pasted.push({ kind: "vertex", id: nid });
  }
  for (const l of clipboard.lines) {
    const nid = mapData._idc++;
    mapData.lines.push({ id: nid, a: idMap[l.a] != null ? idMap[l.a] : l.a, b: idMap[l.b] != null ? idMap[l.b] : l.b, tex: l.tex || "wall_01", flags: l.flags || "0", free: !!l.free, step: !!l.step });
    pasted.push({ kind: "line", id: nid });
  }
  for (const s of clipboard.sectors) {
    const nid = mapData._idc++;
    sidMap[s.id] = nid;
    mapData.sectors.push({ id: nid, verts: s.verts.map(v => idMap[v] != null ? idMap[v] : v), floorTex: s.floorTex || "floor_01", wallTex: s.wallTex || "wall_01", height: s.height || 128, flags: s.flags || 0, stone: !!s.stone, fragile: !!s.fragile, close: s.close || "", finish: !!s.finish, neighbors: [], offset: { x: 0, y: 0 } });
    pasted.push({ kind: "sector", id: nid });
  }
  for (const th of clipboard.things) {
    // The code is the creature's TYPE, so the copy keeps the code as-is (including a duplicate one).
    // The new one only gets a uid — the internal instance label, otherwise the copy would merge with the original.
    const code = th.id;
    if (code == null) { skippedThings++; continue; }
    const nuid = mapData._idc++;
    mapData.things.push({ uid: nuid, id: code, type: th.type || code, name: th.name || code, x: th.x + offX, y: th.y + offY, slot: th.slot || 1, sectorId: sidMap[th.sectorId] != null ? sidMap[th.sectorId] : (pickSectorAt(th.x + offX, th.y + offY) || { id: null }).id });
    pasted.push({ kind: "thing", id: nuid });
  }
  for (const tr of clipboard.triggers) {
    const nid = mapData._idc++;
    mapData.triggers.push({ id: nid, tid: tr.tid || "trigger_" + nid, type: tr.type || "inner", ticks: tr.ticks || 5, x1: tr.x1 + offX, y1: tr.y1 + offY, x2: tr.x2 + offX, y2: tr.y2 + offY });
    pasted.push({ kind: "trigger", id: nid });
  }
  // lifts: bind them to the newly created copied sector
  for (const L of clipboard.lifts) {
    const targetSid = sidMap[L.sectorId];
    if (targetSid == null) continue;
    const nid = mapData._idc++;
    const nl = { id: nid, sectorId: targetSid, curve: L.curve || "sin", sec: L.sec || 3, floors: L.floors.map(f => {
      const nf = { name: f.name, x: f.x + offX, y: f.y + offY };
      // a binding stores the CODE and copies keep their codes — there is nothing to re-bind, idMap only hurts here
      if (f.entityId != null) nf.entityId = f.entityId;
      if (f.entityType != null) nf.entityType = f.entityType;
      return nf;
    }) };
    if (L.zeroEntityId != null) nl.zeroEntityId = L.zeroEntityId;
    if (L.zeroEntityType != null) nl.zeroEntityType = L.zeroEntityType;
    mapData.lifts.push(nl);
  }
  multiSel = pasted;
  sel.vertex = null; sel.line = null; sel.sector = null; sel.thing = null; sel.trigger = null; sel.triggerCorner = null; sel.floor = null;
  if (pasted.length) { const lb = pasted[pasted.length - 1]; sel[lb.kind === "line" ? "line" : lb.kind] = lb.id; }
  updateThingPanel(); updateLiftPanel(); updateChecks(); updateHud();
  draw(); saveMap();
  toast(tr("cb_pasted", pasted.length) + (skippedThings ? tr("cb_pasted_skip", skippedThings) : ""));
  log(tr("cb_paste_log", pasted.length, offX, offY) + (skippedThings ? tr("cb_paste_skip", skippedThings) : ""));
}

// Select literally everything: points, lines, sectors, creatures, triggers, lift floors
function selectAll() {
  multiSel = [];
  for (const v of mapData.vertices) multiSel.push({ kind: "vertex", id: v.id });
  for (const l of mapData.lines) multiSel.push({ kind: "line", id: l.id });
  for (const s of mapData.sectors) multiSel.push({ kind: "sector", id: s.id });
  for (const t of mapData.things) multiSel.push({ kind: "thing", id: t.uid });
  for (const t of mapData.triggers) multiSel.push({ kind: "trigger", id: t.id });
  for (const L of (mapData.lifts || [])) for (let fi = 0; fi < L.floors.length; fi++) multiSel.push({ kind: "floor", id: "L" + L.id + "@" + fi });
  sel.vertex = null; sel.line = null; sel.sector = null; sel.thing = null; sel.trigger = null; sel.triggerCorner = null; sel.floor = null;
  hudText = tr("sel_count", multiSel.length);
  updateThingPanel(); updateTriggerPanel(); updateLiftPanel(); updateHud(); updateChecks();
  draw(); saveMap();
  log(tr("sel_all_log", multiSel.length));
}


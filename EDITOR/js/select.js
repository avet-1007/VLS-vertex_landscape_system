"use strict";
// VLS editor - js/select.js: selection, deletion
// ================= SELECT =================
// The select tool only picks the object type
// that matches the last used tool:
// point -> selectTarget=vertex, line -> line, sector -> sector.
function pickAt(wx, wy, target) {
  // Returns {kind, id} or null
  // Lift floors always have priority — so the first floor can be picked with any sub-selection
  // (in texture mode they are not drawn at all, so they must not steal the click from the sector)
  const tm = texMode();
  for (const L of (tm ? [] : (mapData.lifts || []))) {
    const sL = getSector(L.sectorId);
    if (!sL) continue;
    const poly = sL.verts.map(id => getV(id)).filter(Boolean);
    for (let fi = 0; fi < (L.floors||[]).length; fi++) {
      const f = L.floors[fi];
      const dx = (f.x||0) - wx, dy = (f.y||0) - wy;
      if (dx*dx + dy*dy <= 12*12) return { kind: "floor", id: "L" + L.id + "@" + fi, liftId: L.id, floorIndex: fi };
      const fp = liftFloorPoly(L, fi, poly);
      if (fp && pointInPoly(wx, wy, fp)) return { kind: "floor", id: "L" + L.id + "@" + fi, liftId: L.id, floorIndex: fi };
    }
  }
  if (target === "vertex") {
    const v = findVertex(wx, wy) || findVertex(wx, wy, 4);
    if (v) return { kind: "vertex", id: v.id };
    const l = findLineNear(wx, wy);
    if (l) return { kind: "line", id: l.id };
  } else if (target === "line") {
    const l = findLineNear(wx, wy);
    if (l) return { kind: "line", id: l.id };
  } else if (target === "sector") {
    for (const s of mapData.sectors) {
      const poly = s.verts.map(id => getV(id)).filter(Boolean);
      if (poly.length >= 3 && pointInPoly(wx, wy, poly)) return { kind: "sector", id: s.id };
    }
  } else if (target === "thing") {
    let best = null, bd = 10;
    for (const t of mapData.things) {
      const d = Math.hypot(t.x - wx, t.y - wy);
      if (d < bd) { bd = d; best = t; }
    }
    if (best) return { kind: "thing", id: best.uid };
  } else if (target === "trigger") {
    // corner diamonds have priority: so the size can be changed
    for (const t of mapData.triggers) {
      const c1 = Math.hypot(wx - t.x1, wy - t.y1);
      const c2 = Math.hypot(wx - t.x2, wy - t.y2);
      if (c1 <= 12) return { kind: "trigger", id: t.id, corner: "tl" };
      if (c2 <= 12) return { kind: "trigger", id: t.id, corner: "br" };
    }
    // otherwise — inside/on the border of the rectangle (drag it whole)
    for (const t of mapData.triggers) {
      const x1 = Math.min(t.x1, t.x2), x2 = Math.max(t.x1, t.x2);
      const y1 = Math.min(t.y1, t.y2), y2 = Math.max(t.y1, t.y2);
      const pad = 8;
      if (wx >= x1 - pad && wx <= x2 + pad && wy >= y1 - pad && wy <= y2 + pad) {
        return { kind: "trigger", id: t.id, corner: null };
      }
    }
  }
  return null;
}

// Look for a nested sector: if under the cursor, inside the already selected sector,
// there is a smaller sector (stone/fragile box or just a room inside a room),
// — return the smallest of those lying entirely inside the outer one.
// Nesting is checked by the candidate's CENTRE, not by all of its vertices: a box
// pushed right against a wall has vertices on the outer sector's border.
function pickNestedSector(wx, wy, outerId) {
  const outer = getSector(outerId);
  if (!outer) return null;
  const outerPoly = outer.verts.map(id => getV(id)).filter(Boolean);
  if (outerPoly.length < 3) return null;
  const outerArea = Math.abs(polySignedArea(outerPoly)) / 2;
  let best = null, bestArea = Infinity;
  for (const s of mapData.sectors) {
    if (s.id === outerId) continue;
    const poly = s.verts.map(id => getV(id)).filter(Boolean);
    if (poly.length < 3) continue;
    // the candidate must accept the click point
    if (!pointInPoly(wx, wy, poly)) continue;
    const area = Math.abs(polySignedArea(poly)) / 2;
    // it must be smaller than the outer one and its centre inside the outer one
    if (area >= outerArea) continue;
    const cx = poly.reduce((a, v) => a + v.x, 0) / poly.length;
    const cy = poly.reduce((a, v) => a + v.y, 0) / poly.length;
    if (!pointInPoly(cx, cy, outerPoly)) continue;
    if (area < bestArea) { bestArea = area; best = s.id; }
  }
  return best;
}

// Signed area of a polygon (shoelace formula)
function polySignedArea(poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}
function liftFloorByKey(key) {
  const m = /^L(\d+)@(\d+)$/.exec(key || "");
  if (!m) return null;
  const L = (mapData.lifts || []).find(x => x.id === Number(m[1]));
  if (!L || !((L.floors||[])[Number(m[2])])) return null;
  return { L, fi: Number(m[2]) };
}

// Lift floor pick under the cursor (marker or phantom polygon) — for the RMB floor menu
function pickFloorAt(wx, wy) {
  for (const L of mapData.lifts || []) {
    const sL = getSector(L.sectorId);
    if (!sL) continue;
    const poly = sL.verts.map(id => getV(id)).filter(Boolean);
    for (let fi = 0; fi < (L.floors||[]).length; fi++) {
      const f = L.floors[fi];
      const dx = (f.x||0) - wx, dy = (f.y||0) - wy;
      if (dx*dx + dy*dy <= 12*12) return { kind: "floor", id: "L" + L.id + "@" + fi, liftId: L.id, floorIndex: fi };
      const fp = liftFloorPoly(L, fi, poly);
      if (fp && pointInPoly(wx, wy, fp)) return { kind: "floor", id: "L" + L.id + "@" + fi, liftId: L.id, floorIndex: fi };
    }
  }
  return null;
}

function pickByTarget(wx, wy, target) {
  sel.vertex = null; sel.line = null; sel.sector = null; sel.thing = null; sel.trigger = null; sel.triggerCorner = null; sel.floor = null;
  const hit = pickAt(wx, wy, target);
  if (hit) {
    if (hit.kind === "trigger") { sel.trigger = hit.id; sel.triggerCorner = hit.corner || null; }
    else sel[hit.kind === "line" ? "line" : hit.kind] = hit.id;
  }
}
// Is the object (hit) part of the current selection
function isInSelection(hit) {
  if (!hit) return false;
  if (multiSel.length) return multiSel.some(m => m.kind === hit.kind && m.id === hit.id);
  if (hit.kind === "vertex") return sel.vertex === hit.id;
  if (hit.kind === "line") return sel.line === hit.id;
  if (hit.kind === "sector") return sel.sector === hit.id;
  if (hit.kind === "thing") return sel.thing === hit.id;
  if (hit.kind === "trigger") return sel.trigger === hit.id;
  if (hit.kind === "floor") return sel.floor === hit.id;
  return false;
}

// Current selection list: multiSel or the single sel (fallback)
function selItems() {
  // Live preview of the rectangular selection: while RMB is dragged, highlight what will fall inside
  if (rightDrag && rectPreview) return rectPreview;
  if (multiSel.length) return multiSel;
  const out = [];
  if (sel.vertex != null) out.push({ kind: "vertex", id: sel.vertex });
  if (sel.line != null) out.push({ kind: "line", id: sel.line });
  if (sel.sector != null) out.push({ kind: "sector", id: sel.sector });
  if (sel.thing != null) out.push({ kind: "thing", id: sel.thing });
  if (sel.trigger != null) out.push({ kind: "trigger", id: sel.trigger });
  if (sel.floor != null) out.push({ kind: "floor", id: sel.floor });
  return out;
}

function deleteSelection() {
  const list = selItems();
  if (!list.length) return;
  let count = 0;
  const deleteSectors = [];
  for (const m of list) {
    if (m.kind === "line") {
      mapData.lines = mapData.lines.filter(l => l.id !== m.id);
      mapData.connects = mapData.connects.filter(c => c.lineId !== m.id && c.line2Id !== m.id);
      count++;
    } else if (m.kind === "vertex") {
      if (mapData.lines.some(l => l.a === m.id || l.b === m.id)) {
        hudText = tr("sel_vertex_busy", m.id);
        continue;
      }
      mapData.vertices = mapData.vertices.filter(v => v.id !== m.id);
      count++;
    } else if (m.kind === "thing") {
      const victim = thingByUid(m.id);
      const code = victim ? victim.id : null;
      mapData.things = mapData.things.filter(t => t.uid !== m.id);
      // Lift bindings store the CODE, not the instance. If after deleting the creature with that code
      // none is left — the binding is orphaned, drop it. If the code remains (duplicate id) — the binding
      // still points at a live type, everything is fine.
      if (code != null && !mapData.things.some(t => String(t.id).toUpperCase() === String(code).toUpperCase())) {
        for (const L of (mapData.lifts || [])) {
          for (const f of L.floors) {
            if (String(f.entityId).toUpperCase() === String(code).toUpperCase()) { delete f.entityId; delete f.entityType; }
          }
          if (L.zeroEntityId != null && String(L.zeroEntityId).toUpperCase() === String(code).toUpperCase()) { delete L.zeroEntityId; delete L.zeroEntityType; }
        }
      }
      count++;
    } else if (m.kind === "trigger") {
      mapData.triggers = mapData.triggers.filter(t2 => t2.id !== m.id);
      if (sel.trigger === m.id) { sel.trigger = null; sel.triggerCorner = null; }
      count++;
    } else if (m.kind === "sector") {
      deleteSectors.push(m.id);
      count++;
    } else if (m.kind === "floor") {
      const lf = liftFloorByKey(m.id);
      if (lf) {
        lf.L.floors.splice(lf.fi, 1);
        if (pendingFloorBind && pendingFloorBind.liftId === lf.L.id && pendingFloorBind.floorIndex === lf.fi) pendingFloorBind = null;
        count++;
      }
    }
  }
  if (deleteSectors.length) deleteSectorAndOrphans(deleteSectors);
  pruneOrphans();
  multisel_cleanup();
  hudText = tr("sel_deleted", count);
  log(tr("sel_deleted_log", count));
  updateThingPanel();
  updateLiftPanel();
}
function multisel_cleanup() {
  // drop vanished objects from the group and sync sel
  const alive = [];
  for (const m of multiSel) {
    if (m.kind === "line" && getLineById(m.id)) alive.push(m);
    else if (m.kind === "vertex" && getV(m.id)) alive.push(m);
    else if (m.kind === "sector" && getSector(m.id)) alive.push(m);
    else if (m.kind === "thing" && thingByUid(m.id)) alive.push(m);
    else if (m.kind === "trigger" && mapData.triggers.some(t2 => t2.id === m.id)) alive.push(m);
    else if (m.kind === "floor" && liftFloorByKey(m.id)) alive.push(m);
  }
  multiSel = alive;
  sel.vertex = null; sel.line = null; sel.sector = null; sel.thing = null; sel.trigger = null; sel.triggerCorner = null; sel.floor = null;
  if (multiSel.length) {
    const last = multiSel[multiSel.length - 1];
    sel[last.kind === "line" ? "line" : last.kind] = last.id;
  }
}
function pruneOrphans() {
  // remove vertices not used by any line
  const usedSet = new Set();
  for (const l of mapData.lines) { usedSet.add(l.a); usedSet.add(l.b); }
  mapData.vertices = mapData.vertices.filter(v => usedSet.has(v.id));
  // remove sectors referencing missing vertices
  mapData.sectors = mapData.sectors.filter(s => s.verts.every(id => usedSet.has(id)));
}

// Lines that are sector edges: both ends in the verts ring and adjacent along the ring
// (last and first are neighbours too). Interior lines (not on the ring) never land here.
function sectorEdgeLines(sector) {
  const res = new Set();
  const vs = sector.verts;
  const n = vs.length;
  if (n < 3) return res;
  const idx = new Map();
  vs.forEach((v, i) => idx.set(v, i));
  for (const l of mapData.lines) {
    if (!idx.has(l.a) || !idx.has(l.b)) continue;
    const d = Math.abs(idx.get(l.a) - idx.get(l.b));
    if (d === 1 || d === n - 1) res.add(l.id);
  }
  return res;
}

// Delete sectors together with their creatures/lifts, lines and points.
// Only lines left without an owner are deleted: shared ones with neighbours (one object
// across two sectors — makeLinesFromPoly reuses it) stay, as do their points.
// Points that ended up unneeded are cleaned up by pruneOrphans().
function deleteSectorAndOrphans(sectorIds) {
  const del = new Set(sectorIds);
  let edges = new Set();
  const kept = new Set();
  for (const s of mapData.sectors) {
    for (const lid of sectorEdgeLines(s)) {
      if (del.has(s.id)) edges.add(lid);
      else kept.add(lid);
    }
  }
  const toRemove = new Set();
  for (const lid of edges) if (!kept.has(lid)) toRemove.add(lid);
  mapData.sectors = mapData.sectors.filter(s => !del.has(s.id));
  mapData.things = mapData.things.filter(t => !del.has(t.sectorId));
  mapData.lifts = (mapData.lifts || []).filter(L => !del.has(L.sectorId));
  for (const sid of del) {
    if (selLift === sid) selLift = null;
    if (pendingFloorBind && pendingFloorBind.liftId === sid) pendingFloorBind = null;
  }
  if (toRemove.size) {
    mapData.lines = mapData.lines.filter(l => !toRemove.has(l.id));
    mapData.connects = mapData.connects.filter(c => !toRemove.has(c.lineId) && !toRemove.has(c.line2Id));
  }
  pruneOrphans();
}

// Snapping on LMB release: a single point lands exactly on a grid node.
// Groups and shared edges (lines/sectors) move by the quantized delta only — the shape is preserved.
// Shift at release time = exact movement without snapping.
function snapDrop() {
  if (!selDrag || shiftHeld) return;
  if (selDrag.kind === "floor") {
    const fl = selDrag.L.floors[selDrag.fi];
    if (fl) { fl.x = snapGrid(fl.x); fl.y = snapGrid(fl.y); }
  } else if (selDrag.kind === "trigger") {
    const tr = mapData.triggers.find(t2 => t2.id === selDrag.id);
    if (tr) {
      if (!selDrag.corner) {
        // a whole trigger: moved whole, size preserved
        const dx = snapGrid(tr.x1) - tr.x1, dy = snapGrid(tr.y1) - tr.y1;
        tr.x1 += dx; tr.y1 += dy; tr.x2 += dx; tr.y2 += dy;
      }       else if (selDrag.corner === "tl") { tr.x1 = snapGrid(tr.x1); tr.y1 = snapGrid(tr.y1); }
      else if (selDrag.corner === "br") { tr.x2 = snapGrid(tr.x2); tr.y2 = snapGrid(tr.y2); }
      // guards against degeneration (corners must not collapse/invert)
      if (tr.x2 <= tr.x1) tr.x2 = tr.x1 + MOVE_STEP;
      if (tr.y2 <= tr.y1) tr.y2 = tr.y1 + MOVE_STEP;
    }
  } else if (selDrag.kind === "group") {
    const items = selItems();
    if (items.length === 1) {
      const m = items[0];
      if (m.kind === "vertex") { const v = getV(m.id); if (v) { v.x = snapGrid(v.x); v.y = snapGrid(v.y); } }
      else if (m.kind === "thing") {
        const t = thingByUid(m.id);
        // snapping to a grid node can also move a creature across a sector border
        if (t) { t.x = snapGrid(t.x); t.y = snapGrid(t.y); rebindThingSector(t); }
      }
    }
  }
}

// Move the selected objects: it moves the vertices themselves,
// so lines and sectors update automatically.
function moveSelection(dx, dy) {
  // Trigger corner: move only it
  if (sel.trigger != null && sel.triggerCorner) {
    const tr = mapData.triggers.find(t => t.id === sel.trigger);
    if (tr) {
      if (sel.triggerCorner === "tl") { tr.x1 += dx; tr.y1 += dy; }
      else { tr.x2 += dx; tr.y2 += dy; }
    }
    return;
  }
  const list = selItems();
  // Vertices move exactly once, even if mentioned several times
  // (as a vertex, as part of a line and as part of a sector) — otherwise the construction folds up.
  const vset = new Set();
  for (const m of list) {
    if (m.kind === "vertex") vset.add(m.id);
    else if (m.kind === "line") {
      const l = getLineById(m.id);
      if (l) { vset.add(l.a); vset.add(l.b); }
    } else if (m.kind === "sector") {
      const s = getSector(m.id);
      if (s) for (const id of s.verts) vset.add(id);
    }
  }
  for (const id of vset) {
    const v = getV(id);
    if (v) { v.x += dx; v.y += dy; }
  }
  // Creatures move together with their sectors (they stay in the same place inside)
  const movedThingUids = new Set();
  for (const m of list) if (m.kind === "thing") movedThingUids.add(m.id);
  const movedFloorKeys = new Set();
  for (const m of list) if (m.kind === "floor") movedFloorKeys.add(m.id);
  // index the creatures by sector once, instead of scanning every creature for every selected sector
  let thingsBySec = null;
  for (const m of list) {
    if (m.kind === "sector") {
      if (!thingsBySec) {
        thingsBySec = new Map();
        for (const t of mapData.things) {
          let arr = thingsBySec.get(t.sectorId);
          if (!arr) { arr = []; thingsBySec.set(t.sectorId, arr); }
          arr.push(t);
        }
      }
      const arr = thingsBySec.get(m.id);
      if (arr) for (const t of arr) {
        if (!movedThingUids.has(t.uid)) {
          t.x += dx; t.y += dy;
          movedThingUids.add(t.uid);
        }
      }
      // a lift moves together with its sector as a whole; floors already in the selection are not moved twice
      const liftMoved = (mapData.lifts || []).find(L => L.sectorId === m.id);
      if (liftMoved) {
        for (let fi = 0; fi < liftMoved.floors.length; fi++) {
          const key = "L" + liftMoved.id + "@" + fi;
          if (movedFloorKeys.has(key)) continue;
          liftMoved.floors[fi].x += dx; liftMoved.floors[fi].y += dy;
          movedFloorKeys.add(key);
        }
      }
    }
  }
  for (const m of list) {
    if (m.kind === "thing") {
      const t = thingByUid(m.id);
      if (t) { t.x += dx; t.y += dy; }
    } else if (m.kind === "trigger") {
      const t = mapData.triggers.find(x => x.id === m.id);
      if (t) { t.x1 += dx; t.y1 += dy; t.x2 += dx; t.y2 += dy; }
    } else if (m.kind === "floor") {
      const lf = liftFloorByKey(m.id);
      if (lf) { lf.L.floors[lf.fi].x += dx; lf.L.floors[lf.fi].y += dy; }
    }
  }
  // Belonging follows the position: every moved creature takes the sector
  // it now lies in (dragged into the neighbouring room — there it belongs too)
  rebindMovedThings(movedThingUids);
}

// ================= MARQUEE DELETE (RMB) =================
function rectContains(r, x, y) {
  const x1 = Math.min(r.sx,r.ex), x2 = Math.max(r.sx,r.ex);
  const y1 = Math.min(r.sy,r.ey), y2 = Math.max(r.sy,r.ey);
  return x >= x1 && x <= x2 && y >= y1 && y <= y2;
}
function deleteInsideRect(r) {
  const thingsBefore = mapData.things.length, linesBefore = mapData.lines.length, sectorsBefore = mapData.sectors.length;
  // delete triggers with center inside
  mapData.triggers = mapData.triggers.filter(t => {
    const cx = (t.x1 + t.x2) / 2, cy = (t.y1 + t.y2) / 2;
    return !rectContains(r, cx, cy);
  });
  // collect vertices inside
  const insideVerts = new Set();
  for (const v of mapData.vertices) {
    if (rectContains(r, v.x, v.y)) insideVerts.add(v.id);
  }
  // delete lines where BOTH vertices are inside (fully enclosed)
  mapData.lines = mapData.lines.filter(l => !(insideVerts.has(l.a) && insideVerts.has(l.b)));
  // delete sectors whose ALL vertices are inside
  const deletedSectorIds = new Set();
  mapData.sectors = mapData.sectors.filter(s => {
    if (s.verts.length && s.verts.every(id => insideVerts.has(id))) { deletedSectorIds.add(s.id); return false; }
    return true;
  });
  // delete things inside OR belonging to deleted sectors
  mapData.things = mapData.things.filter(t => !rectContains(r, t.x, t.y) && !deletedSectorIds.has(t.sectorId));
  // delete lifts whose sector was deleted
  if (deletedSectorIds.size) {
    mapData.lifts = (mapData.lifts || []).filter(L => !deletedSectorIds.has(L.sectorId));
    if (selLift != null && deletedSectorIds.has(selLift)) { selLift = null; selLiftFloor = 0; }
    if (pendingFloorBind && deletedSectorIds.has(pendingFloorBind.liftId)) pendingFloorBind = null;
    updateLiftPanel();
  }
  // remove connects referencing deleted lines
  const lineIds = new Set(mapData.lines.map(l => l.id));
  mapData.connects = mapData.connects.filter(c => lineIds.has(c.lineId) && lineIds.has(c.line2Id));
  // now prune vertices that became orphaned
  pruneOrphans();
  dropOrphanBind();
  hudText = tr("sel_rect_cleared");
  log(tr("sel_rect_clear_log", thingsBefore - mapData.things.length, linesBefore - mapData.lines.length, sectorsBefore - mapData.sectors.length));
  saveMap();
}

// RMB drag in the Select mode: select EVERYTHING inside the rectangle
// (regardless of the sub-mode: point/line/sector/creature/trigger)
// A pure collection of the objects inside the rectangle (no side effects) — for the preview and for applying
function rectSelection(r) {
    const tm = texMode();   // texture mode: only sectors are pickable here
    const picked = [];
    const insideVerts = new Set();
    for (const v of mapData.vertices) {
      if (rectContains(r, v.x, v.y)) { insideVerts.add(v.id); if (!tm) picked.push({ kind: "vertex", id: v.id }); }
    }
    if (!tm) {
      for (const t of mapData.things) if (rectContains(r, t.x, t.y)) picked.push({ kind: "thing", id: t.uid });
      for (const t of mapData.triggers) {
        const cx = (t.x1 + t.x2) / 2, cy = (t.y1 + t.y2) / 2;
        if (rectContains(r, cx, cy)) picked.push({ kind: "trigger", id: t.id });
      }
      for (const l of mapData.lines) if (insideVerts.has(l.a) && insideVerts.has(l.b)) picked.push({ kind: "line", id: l.id });
    }
    for (const s of mapData.sectors) if (s.verts.length && s.verts.every(id => insideVerts.has(id))) picked.push({ kind: "sector", id: s.id });
    if (tm) return picked;
    // lift floors: selected if their landmark points are inside the area
    for (const L of mapData.lifts || []) {
    for (let fi = 0; fi < (L.floors||[]).length; fi++) {
      const f = L.floors[fi];
      if (f && rectContains(r, f.x||0, f.y||0)) picked.push({ kind: "floor", id: "L" + L.id + "@" + fi });
    }
  }
  return picked;
}

function selectInsideRect(r) {
  const picked = rectSelection(r);
  multiSel = picked;
  sel.vertex = null; sel.line = null; sel.sector = null; sel.thing = null; sel.trigger = null; sel.triggerCorner = null; sel.floor = null;
  if (picked.length) {
    const last = picked[picked.length - 1];
    if (last.kind === "trigger") sel.trigger = last.id;
    else sel[last.kind === "line" ? "line" : last.kind] = last.id;
  }
  hudText = tr("sel_rect_picked", picked.length);
  log(tr("sel_rect_log", picked.length));
  updateThingPanel();
  updateTriggerPanel();
}


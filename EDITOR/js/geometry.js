"use strict";
// VLS editor - js/geometry.js: points, lines, sectors, boxes, triggers, connects, lift barrier
// ================= POINT MANAGEMENT =================
function addVertex(x, y) {
  const v = { id: mapData._idc++, x: Math.round(x), y: Math.round(y) };
  mapData.vertices.push(v);
  log(tr("log_vertex", v.id, v.x, v.y));
  return v;
}
function findVertex(x, y, tol = 8) {
  for (const v of mapData.vertices) {
    const dx = v.x - x, dy = v.y - y;
    if (dx*dx + dy*dy <= tol*tol) return v;
  }
  return null;
}
function findLineNear(x, y, tol = 8) {
  let best = null, bestDist = tol;
  for (const l of mapData.lines) {
    const a = getV(l.a), b = getV(l.b);
    if (!a || !b) continue;
    const d = pointSegDist(x, y, a, b);
    if (d < bestDist) {
      bestDist = d;
      best = l;
    }
  }
  return best;
}
function getV(id) {
  return _lookup("v", mapData.vertices, v => v.id).get(id) || null;
}
function pointSegDist(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) return Math.hypot(px-a.x, py-a.y);
  let t = ((px-a.x)*dx + (py-a.y)*dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t*dx, y = a.y + t*dy;
  return Math.hypot(px-x, py-y);
}
function snap(val) {
  // snap to 1-unit steps (fallback)
  return Math.round(val);
}

// Snap a point to the most convenient anchor:
//  - intersection of grid (nodes, multiples of 40)
//  - center of a grid cell (n*40 + 20)
//  - midpoint of a grid LINE (edge between two nodes): one coord = n*40,
//    the other coord = n*40 + 20  -> e.g. (20,0), (0,20), (40,20)
//  - center (midpoint) of an existing line
// With Shift held -> exact 1-unit placement.
function snapPoint(w) {
  const raw = { x: w.x, y: w.y };
  if (shiftHeld) { return { x: Math.round(raw.x), y: Math.round(raw.y) }; }

  let best = { x: Math.round(raw.x), y: Math.round(raw.y) };
  let bestDist = Infinity;
  const tol = 12 / Math.max(cam.zoom, 0.5);

  const half = GRID_SIZE / 2; // 20

  // 1) grid node (both coords multiples of 40)
  const nx = Math.round(raw.x/GRID_SIZE)*GRID_SIZE;
  const ny = Math.round(raw.y/GRID_SIZE)*GRID_SIZE;
  let d = Math.hypot(raw.x-nx, raw.y-ny);
  if (d < bestDist) { bestDist = d; best = {x:nx, y:ny}; }

  // 2) cell center (n*40 + 20, n*40 + 20)
  const cx = Math.round((raw.x-half)/GRID_SIZE)*GRID_SIZE + half;
  const cy = Math.round((raw.y-half)/GRID_SIZE)*GRID_SIZE + half;
  d = Math.hypot(raw.x-cx, raw.y-cy);
  if (d < bestDist) { bestDist = d; best = {x:cx, y:cy}; }

  // 3) horizontal grid-line midpoint: y on a grid line (n*40), x at n*40+20
  const hx = Math.round((raw.x-half)/GRID_SIZE)*GRID_SIZE + half;
  const hy = Math.round(raw.y/GRID_SIZE)*GRID_SIZE;
  d = Math.hypot(raw.x-hx, raw.y-hy);
  if (d < bestDist) { bestDist = d; best = {x:hx, y:hy}; }

  // 4) vertical grid-line midpoint: x on a grid line (n*40), y at n*40+20
  const vx = Math.round(raw.x/GRID_SIZE)*GRID_SIZE;
  const vy = Math.round((raw.y-half)/GRID_SIZE)*GRID_SIZE + half;
  d = Math.hypot(raw.x-vx, raw.y-vy);
  if (d < bestDist) { bestDist = d; best = {x:vx, y:vy}; }

  // 5) midpoint of an existing line
  for (const l of mapData.lines) {
    const a = getV(l.a), b = getV(l.b);
    if (!a || !b) continue;
    const mx = (a.x+b.x)/2, my = (a.y+b.y)/2;
    const dm = Math.hypot(raw.x-mx, raw.y-my);
    if (dm < bestDist) { bestDist = dm; best = {x:mx, y:my}; }
  }

  // If we landed on a special anchor but it's not "close enough",
  // fall back to the nearest 1-unit step.
  if (bestDist > tol) {
    best = { x: Math.round(raw.x), y: Math.round(raw.y) };
  }
  return { x: Math.round(best.x), y: Math.round(best.y) };
}

// ================= SECTOR LOGIC =================
// Find closed loops in connected lines (same as Godot: group + closed check)
function getLineGroups() {
  // Connected components by shared vertex. Same grouping and the same order as the old
  // O(lines^2) scan, but only O(lines): lines are indexed by their endpoint vertices once.
  const groups = [];
  const used = new Set();
  const lines = mapData.lines;
  const byVert = new Map();          // vertex id -> indices of lines touching it (ascending)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    for (const k of [l.a, l.b]) {
      let arr = byVert.get(k);
      if (!arr) { arr = []; byVert.set(k, arr); }
      arr.push(i);
    }
  }
  const seen = new Set();
  for (let si = 0; si < lines.length; si++) {
    const l = lines[si];
    if (used.has(l.id)) continue;
    const group = [];
    const stack = [si];
    used.add(l.id);
    seen.add(si);
    while (stack.length) {
      const cur = lines[stack.pop()];
      group.push(cur);
      const cand = [];
      const la = byVert.get(cur.a), lb = byVert.get(cur.b);
      if (la) for (const i of la) cand.push(i);
      if (lb) for (const i of lb) cand.push(i);
      cand.sort((p, q) => p - q);
      let prev = -1;
      for (const i of cand) {
        if (i === prev) continue;      // the same line sits on both endpoints of cur
        prev = i;
        const other = lines[i];
        if (seen.has(i) || used.has(other.id)) continue;
        used.add(other.id);
        seen.add(i);
        stack.push(i);
      }
    }
    groups.push(group);
  }
  return groups;
}
function sharesPoint(l1, l2) {
  return l1.a === l2.a || l1.a === l2.b || l1.b === l2.a || l1.b === l2.b;
}
function isClosed(group) {
  if (group.length < 3) return false;
  const c = {};
  for (const l of group) {
    c[l.a] = (c[l.a]||0)+1;
    c[l.b] = (c[l.b]||0)+1;
  }
  for (const k in c) if (c[k] !== 2) return false;
  return true;
}
function buildPolygon(group) {
  // returns ordered vertex list, or [] if not closed
  const pts = [];
  const used = [];
  const first = group[0];
  pts.push(getV(first.a), getV(first.b));
  let cur = first.b;
  used.push(first.id);
  while (true) {
    let found = false;
    for (const l of group) {
      if (used.includes(l.id)) continue;
      if (l.a === cur) { pts.push(getV(l.b)); cur = l.b; used.push(l.id); found = true; break; }
      else if (l.b === cur) { pts.push(getV(l.a)); cur = l.a; used.push(l.id); found = true; break; }
    }
    if (!found) break;
    if (cur === first.a) break;
  }
  // dedupe last point == first
  const pl = pts.filter(Boolean);
  if (pl.length >= 3 && pl[0].x === pl[pl.length-1].x && pl[0].y === pl[pl.length-1].y) pl.pop();
  if (pl.length < 3) return [];
  // verify all vertices have degree 2 (closed polygon)
  const counts = {};
  for (const l of group) { counts[l.a]=(counts[l.a]||0)+1; counts[l.b]=(counts[l.b]||0)+1; }
  for (const k in counts) if (counts[k] !== 2) return [];
  return pl;
}
function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length-1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const inters = ((yi > py) !== (yj > py)) &&
      (px < (xj-xi) * (py-yi) / (yj-yi) + xi);
    if (inters) inside = !inside;
  }
  return inside;
}

// Try to create a sector from a closed group of lines
function tryMakeSector(lines) {
  const poly = buildPolygon(lines);
  if (poly.length < 3) {
    warnings.push(tr("warn_sector_unclosed"));
    return false;
  }
  const vertIds = poly.map(v => v.id);
  const sector = {
    id: mapData._idc++,
    verts: vertIds,
    floorTex: DEFAULT_FLOOR_TEX,
    wallTex: DEFAULT_WALL_TEX,
    height: DEFAULT_SECTOR_HEIGHT,
    flags: 0,
    stone: false,
    fragile: false,
    close: "",
    finish: false,
    neighbors: [],
    offset: { x: 0, y: 0 }
  };
  mapData.sectors.push(sector);
  sel.sector = sector.id;
  for (const l of lines) l.flags = "1";
  return true;
}

// ================= PRESET BOX SECTOR =================
// Creates a rectangular sector from two corners (anchor, cur).
// smooth=true -> every vertex gets a 40-unit chamfer (as in the VLS description).
function makeLinesFromPoly(ids) {
  const lineIds = [];
  for (let i=0;i<ids.length;i++) {
    const a = ids[i], b = ids[(i+1)%ids.length];
    let l = mapData.lines.find(ll => (ll.a===a&&ll.b===b)||(ll.a===b&&ll.b===a));
    if (!l) {
      l = { id:mapData._idc++, a, b, tex:"wall_01", flags:"0" };
      mapData.lines.push(l);
    }
    lineIds.push(l);
  }
  return lineIds;
}
function createBoxSector(anchor, cur, smooth) {
  const x1 = Math.min(anchor.x, cur.x), x2 = Math.max(anchor.x, cur.x);
  const y1 = Math.min(anchor.y, cur.y), y2 = Math.max(anchor.y, cur.y);
  const minSize = smooth ? GRID_SIZE*2 : GRID_SIZE;
  if (x2-x1 < minSize || y2-y1 < minSize) {
    hudText = tr("hud_sector_small", minSize, minSize);
    return false;
  }

  let verts;
  if (!smooth) {
    // plain rectangle corners
    verts = [
      {x:x1,y:y1}, {x:x2,y:y1}, {x:x2,y:y2}, {x:x1,y:y2}
    ];
  } else {
    // chamfer every corner inward by 40 units (VLS smooth corner)
    const g = GRID_SIZE; // 40
    const topY = y1, botY = y2, leftX = x1, rightX = x2;
    verts = [
      {x:leftX+g,  y:topY},     // top-left sloped start
      {x:rightX-g, y:topY},     // top-right sloped start
      {x:rightX,   y:topY+g},   // top-right corner in
      {x:rightX,   y:botY-g},   // bottom-right corner in
      {x:rightX-g, y:botY},     // bottom-right sloped
      {x:leftX+g,  y:botY},     // bottom-left sloped
      {x:leftX,    y:botY-g},   // bottom-left corner in
      {x:leftX,    y:topY+g},   // top-left corner in
    ];
  }

  // create vertices
  const idArr = verts.map(v => addVertex(v.x, v.y).id);
  const lines = makeLinesFromPoly(idArr);
  const ok = tryMakeSector(lines);
  if (ok && smooth) hudText = tr("hud_box_smooth");
  else if (ok) hudText = tr("hud_box_rect");
  if (ok) {
    const s = mapData.sectors[mapData.sectors.length - 1];
    log(tr("log_box_sector", s.id, tr(smooth ? "box_kind_smooth" : "box_kind_rect"), s.verts.length));
  }
  return ok;
}

// ================= TRIGGERS =================
// A trigger is a rectangle. The two corner diamonds (x1;y1) and (x2;y2) are its extreme corners.
// The 'Trigger' tool: hold LMB and stretch the rectangle.
function createTrigger(a, b) {
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  if (x2 - x1 < GRID_SIZE || y2 - y1 < GRID_SIZE) {
    hudText = tr("hud_trigger_small", GRID_SIZE, GRID_SIZE);
    updateHud();
    return false;
  }
  const trg = {
    id: mapData._idc++,
    tid: document.getElementById("triggerID").value.trim() || ("trigger_" + (mapData.triggers.length + 1)),
    type: document.getElementById("triggerType").value || "inner",
    ticks: parseInt(document.getElementById("triggerTicks").value) || 5,
    x1: Math.round(x1), y1: Math.round(y1),
    x2: Math.round(x2), y2: Math.round(y2)
  };
  mapData.triggers.push(trg);
  sel.trigger = trg.id;
  sel.triggerCorner = null;
  hudText = tr("hud_trigger_created", trg.tid);
  log(tr("log_trigger_created", trg.tid, trg.id, trg.x1, trg.y1, trg.x2, trg.y2, trg.ticks));
  updateTriggerPanel();
  updateHud();
  return true;
}

function updateTriggerPanel() {
  const tr = sel.trigger != null ? mapData.triggers.find(t2 => t2.id === sel.trigger) : null;
  const idEl = document.getElementById("triggerID");
  const tyEl = document.getElementById("triggerType");
  const tkEl = document.getElementById("triggerTicks");
  if (!idEl || !tyEl || !tkEl) return;
  if (tr) {
    idEl.value = tr.tid || "";
    tyEl.value = tr.type || "inner";
    tkEl.value = tr.ticks || 5;
  }
}

// ================= CONNECT MODIFIER =================
// Connection modes are chosen in the left panel (#connectModes):
//   free  — free passage: one click on a line (just sealing, no player passage)
//   joint — join: two lines overlapped unit for unit
//   step  — seam: lines overlap partially (a piece of a line — passage/seam)
let connectMode = "joint";

function linesOverlap(l1, l2) {
  // Check that the two segments are collinear and overlap.
  const a = getV(l1.a), b = getV(l1.b), c = getV(l2.a), d = getV(l2.b);
  if (!a || !b || !c || !d) return { overlap: 0, kind: "none" };
  const v1x = b.x - a.x, v1y = b.y - a.y;
  const v2x = d.x - c.x, v2y = d.y - c.y;
  const cross = v1x * v2y - v1y * v2x;
  if (Math.abs(cross) < 1e-6) {
    // collinear (same direction or exactly opposite)
    return { overlap: 1, kind: "collinear" };
  }
  return { overlap: 0, kind: "none" };
}

function fullUncertainOverlap(l1, l2) {
  // true if the ends of line 1 lie on line 2 and vice versa (exact unit-for-unit match)
  const a = getV(l1.a), b = getV(l1.b), c = getV(l2.a), d = getV(l2.b);
  if (!a || !b || !c || !d) return false;
  const eps = 2;
  const near = (p, q) => Math.abs(p.x-q.x) <= eps && Math.abs(p.y-q.y) <= eps;
  const sameAB = near(a, c) && near(b, d);
  const sameBA = near(a, d) && near(b, c);
  return sameAB || sameBA;
}

// Another line laid over this one (the second wall of the adjacent sector)
function findCoincidentLine(l) {
  const a = getV(l.a), b = getV(l.b);
  if (!a || !b) return null;
  const eps = 2;
  const near = (p, q) => Math.abs(p.x-q.x) <= eps && Math.abs(p.y-q.y) <= eps;
  for (const other of mapData.lines) {
    if (other.id === l.id) continue;
    const c = getV(other.a), d = getV(other.b);
    if (!c || !d) continue;
    if ((near(a,c) && near(b,d)) || (near(a,d) && near(b,c))) return other;
  }
  return null;
}

function tryConnect(lineId) {
  const line = getLineById(lineId);
  if (!line) return;

  // --- 'free passage' mode: 1 click. The line only closes the sector, it gives no passage. ---
  if (connectMode === "free") {
    // Lift lines: free passage only (sealing), no joins/seams allowed.
    toggleFreeLine(line);
    return;
  }

  // --- Lift sector lines cannot be connected (join/step are forbidden) ---
  if (isLiftLine(line.id)) {
    hudText = tr("hud_lift_line_lock");
    log(tr("log_lift_line_lock", line.id));
    updateHud();
    return;
  }

  // --- two-line modes ---
  if (!pendingConnect) {
    pendingConnect = line.id;
    hudText = tr("hud_pick_second");
    updateHud();
    return;
  }

  // If we clicked the same wall (two sectors overlapping each other),
  // we look for the second (overlapping) line automatically.
  let line2;
  if (pendingConnect === line.id) {
    line2 = findCoincidentLine(line);
    if (line2 && line2.id !== line.id) {
      pendingConnect = null;
    } else {
      pendingConnect = null; hudText = tr("hud_no_overlay", line.id); updateHud(); return;
    }
  } else {
    line2 = getLineById(pendingConnect);
    pendingConnect = null;
  }
  if (!line2) { updateHud(); return; }

  // Lift sector lines cannot be connected (join/step are forbidden)
  if (isLiftLine(line2.id)) {
    hudText = tr("hud_lift_line_lock");
    log(tr("log_lift_line_lock", line2.id));
    updateHud();
    return;
  }

  if (connectMode === "step") {
    // Seam: for lift seams and steps. We keep the connection but flag it as step
    const c = { id: mapData._idc++, lineId: line.id, line2Id: line2.id, fromSector: null, toSector: null };
    mapData.connects.push(c);
    // A partial overlap is required: at least one end of one line lies ON the other line
    const op = linesOverlap(line, line2);
    if (op.kind === "none") {
      hudText = tr("hud_step_no_overlap");
      log(tr("log_step_no_overlap", c.id, line.id, line2.id));
    } else {
      line.step = true; line2.step = true;
      hudText = tr("hud_step_ok");
      log(tr("log_step_ok", c.id, line.id, line2.id));
    }
  } else {
    // Join: only an exact unit-for-unit line match
    if (!fullUncertainOverlap(line, line2)) {
      const pa = getV(line.a), pb = getV(line.b), p2a = getV(line2.a), p2b = getV(line2.b);
      hudText = tr("hud_join_err");
      log(tr("log_join_err", line.id, (pa?pa.x:"?") + ";" + (pa?pa.y:"?") + "→" + (pb?pb.x:"?") + ";" + (pb?pb.y:"?"), line2.id, (p2a?p2a.x:"?") + ";" + (p2a?p2a.y:"?") + "→" + (p2b?p2b.x:"?") + ";" + (p2b?p2b.y:"?")));
    } else {
      const c = { id: mapData._idc++, lineId: line.id, line2Id: line2.id, fromSector: null, toSector: null };
      mapData.connects.push(c);
      line.flags = "2";   // 2 = portal/connected
      line2.flags = "2";
      hudText = tr("hud_join_ok", c.id);
      log(tr("log_join", c.id, line.id, line2.id));
    }
  }
  updateChecks();
  updateHud();
}

function toggleFreeLine(line) {
  // Free passage: the line seals the sector, but you cannot walk through it.
  // In practice: mark it with flag '5' (free/barrier) — it exists but opens no passage.
  if (line.free) { line.free = false; hudText = tr("hud_free_off"); log(tr("log_free_off", line.id)); }
  else { line.free = true; hudText = tr("hud_free_on"); log(tr("log_free_on", line.id)); }
  updateChecks();
  updateHud();
}
function getLineById(id) { return _lookup("l", mapData.lines, l => l.id).get(id) || null; }
function getSector(id) { return _lookup("s", mapData.sectors, s => s.id).get(id) || null; }

// Is the line an edge of some sector
function isSectorLine(l) {
  for (const s of mapData.sectors) {
    for (let i = 0; i < s.verts.length; i++) {
      const v1 = s.verts[i], v2 = s.verts[(i+1)%s.verts.length];
      if ((v1===l.a && v2===l.b) || (v1===l.b && v2===l.a)) return true;
    }
  }
  return false;
}

// ================= LIFT LINE BARRIER =================
// Lift sectors: their lines are the cab/shaft walls. There must be no holes in them,
// only 'free lines' (sealing without passage). No connections (portal/step) are made.
function liftSectors() {
  return (mapData.lifts || []).map(L => getSector(L.sectorId)).filter(Boolean);
}
function lineInSector(lineId, sector) {
  const l = getLineById(lineId);
  if (!l || !sector) return false;
  const n = sector.verts.length;
  for (let i = 0; i < n; i++) {
    const v1 = sector.verts[i], v2 = sector.verts[(i+1)%n];
    if ((v1===l.a && v2===l.b) || (v1===l.b && v2===l.a)) return true;
  }
  return false;
}
function isLiftLine(lineId) {
  return liftSectors().some(s => lineInSector(lineId, s));
}
// All connections touching lift sector lines are replaced by free lines.
// Returns the number of removed connections.
function stripLiftConnects() {
  if (!Array.isArray(mapData.connects)) return 0;
  let removed = 0;
  mapData.connects = mapData.connects.filter(c => {
    const onLift = isLiftLine(c.lineId) || isLiftLine(c.line2Id);
    if (onLift) {
      for (const lid of [c.lineId, c.line2Id]) {
        const l = getLineById(lid);
        if (l) { l.free = true; l.flags = "0"; delete l.step; }
      }
      removed++;
      return false;
    }
    return true;
  });
  return removed;
}

// Remove the join modifier from line L(lid): delete all connects
// it takes part in, and reset the flags of the pair.
function unlinkLineConnects(lid) {
  if (!Array.isArray(mapData.connects)) return 0;
  const before = mapData.connects.length;
  mapData.connects = mapData.connects.filter(c => {
    if (c.lineId !== lid && c.line2Id !== lid) return true;
    for (const pid of [c.lineId, c.line2Id]) {
      const pl = getLineById(pid);
      if (pl && pl.flags === "2") pl.flags = "0";
      if (pl && pid !== lid) delete pl.step;
    }
    return false;
  });
  const l = getLineById(lid);
  if (l && l.flags === "2") l.flags = "0";
  const removed = before - mapData.connects.length;
  log(removed > 0 ? tr("log_unlink_some", lid, removed) : tr("log_unlink_none", lid));
  return removed;
}

// Cut a sector line at the click point (the 'Point' tool):
// the line is replaced by two, a new vertex is inserted into the sector,
// the overlapping shared wall line is cut too, for consistency.
function splitLineAt(px, py) {
  const l = findLineNear(px, py);
  if (!l || !isSectorLine(l)) return null;
  const a = getV(l.a), b = getV(l.b);
  if (!a || !b) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx*dx + dy*dy;
  if (len2 < 1) return null;
  let t = ((px - a.x)*dx + (py - a.y)*dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const vx = Math.round(a.x + dx*t), vy = Math.round(a.y + dy*t);
  if ((vx===a.x && vy===a.y) || (vx===b.x && vy===b.y)) return null;
  const nv = findVertex(vx, vy) || addVertex(vx, vy);
  const splitIds = new Set([l.id]);
  const partner = findCoincidentLine(l);
  if (partner) splitIds.add(partner.id);
  const mapOldToNew = {};
  for (const lid of splitIds) {
    const ln = getLineById(lid);
    if (!ln) continue;
    const n1 = { id: mapData._idc++, a: ln.a, b: nv.id, tex: ln.tex, flags: ln.flags };
    const n2 = { id: mapData._idc++, a: nv.id, b: ln.b, tex: ln.tex, flags: ln.flags };
    if (ln.step) { n1.step = true; n2.step = true; }
    if (ln.free) { n1.free = true; n2.free = true; }
    const idx = mapData.lines.indexOf(ln);
    mapData.lines.splice(idx, 1, n1, n2);
    mapOldToNew[ln.id] = n1.id;
    for (const s of mapData.sectors) {
      for (let i = 0; i < s.verts.length; i++) {
        const v1 = s.verts[i], v2 = s.verts[(i+1)%s.verts.length];
        if ((v1===ln.a && v2===ln.b) || (v1===ln.b && v2===ln.a)) {
          s.verts.splice(i+1, 0, nv.id);
          break;
        }
      }
    }
  }
  for (const c of mapData.connects) {
    if (mapOldToNew[c.lineId]) c.lineId = mapOldToNew[c.lineId];
    if (mapOldToNew[c.line2Id]) c.line2Id = mapOldToNew[c.line2Id];
  }
  hudText = tr("hud_line_split", l.id, vx, vy);
  log(tr("log_line_split", l.id, vx, vy));
  return nv;
}


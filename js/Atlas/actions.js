"use strict";
// VLS editor - js/Atlas/actions.js: what a click does: place a sprite (one layer each),
// select layers, delete, lay a world rectangle
// Split out of js/textures.js - the very same script, only in pieces; load order matters.
// ================= ACTIONS =================
// Selecting a sector is the whole "mode": its layers open in the panel and the next click
// inside it drops the brush there. Selecting empty ground closes it again.
function texSetCtx(sectorId) {
  if (sectorId == null || !getSector(sectorId)) return false;
  const changed = texCtxSector !== sectorId;
  texCtxSector = sectorId;
  if (changed) { texSel = null; texSelLayers = []; }
  texSelWorld = null;
  sel.vertex = null; sel.line = null; sel.thing = null;
  sel.trigger = null; sel.triggerCorner = null; sel.floor = null;
  sel.sector = sectorId;
  multiSel = [];
  _texSig = null;
  refreshTexPanel();
  updateCursor();
  hudText = tr("hud_tex_ctx", sectorId);
  updateHud();
  draw();
  return true;
}

function texClearCtx() {
  texCtxSector = null;
  texSel = null;
  texSelLayers = [];
  texSelWorld = null;
  _texSig = null;
  refreshTexPanel();
  updateCursor();
  draw();
}

// RIGHT CLICK — selection: every press takes the NEXT sprite down the stack under the
// cursor, so a sprite buried under an opaque overlay stays reachable. Shift adds the
// layer to the group instead of replacing the selection. Empty ground drops the sprite
// selection (the sector stays open). Panning is the drag part of the same button.
function texPickCycle(wx, wy, additive) {
  const stack = texStampsAt(wx, wy);
  if (!stack.length) {
    if (texSel != null || texSelLayers.length) {
      texSel = null; texSelLayers = [];
      _texSig = null;
      hudText = "";
      refreshTexPanel(); updateHud(); draw();
    }
    return false;
  }
  let cur = -1;
  for (let i = 0; i < stack.length; i++) if (stack[i].it.id === texSel) { cur = i; break; }
  const pick = stack[(cur + 1) % stack.length];
  texSelWorld = null;
  if (additive) texToggleLayer(pick.L.id);
  else texSelectLayer(pick.L.id);
  texSel = pick.it.id;
  _texSig = null;
  hudText = tr("hud_tex_picked", pick.L.name || "?", texCtxSector);
  refreshTexPanel(); updateHud(); draw();
  return true;
}

// Drop the current rectangle selection onto the sector. ONE CLICK = ONE NEW LAYER = ONE
// SPRITE: the layer is created together with the sprite it carries, on top of the stack,
// and the position lands on the pixel grid (one pixel = GRID_SIZE/16 world units), never
// on the coarse 40-unit grid.
function texPlaceStamp(wx, wy) {
  if (!texHasSector()) return false;
  const sec = getSector(texCtxSector);
  if (!sec) return false;
  if (!pointInSector(sec, wx, wy)) return false;
  if (!texRegionHas()) { hudText = tr("tex_need_region"); updateHud(); return false; }
  const offx = sec.offset ? sec.offset.x : 0, offy = sec.offset ? sec.offset.y : 0;
  histPush();
  const L = texNewLayer(texCtxSector);
  const it = {
    id: mapData._idc++,
    x: Math.round((wx - offx) / TEX_PX) * TEX_PX,
    y: Math.round((wy - offy) / TEX_PX) * TEX_PX,
    rx: texRegion.x, ry: texRegion.y, rw: texRegion.w, rh: texRegion.h,
    pw: texRegion.w, ph: texRegion.h
  };
  L.items.push(it);
  texSel = it.id;
  _texSig = null;
  hudText = tr("hud_tex_placed", L.name || (texLayerIdx + 1));
  log(tr("log_tex_placed", texCtxSector, L.name || "?", Math.round(wx), Math.round(wy)));
  updateHud();
  draw(); saveMap();
  return true;
}

// DELETE — by layers: one sprite = one layer, so removing the sprite removes the layer it
// came with, and a Shift-built group of layers goes at once (the same way a group of
// sectors goes in vector mode).
function texDeleteStamp() {
  if (!texHasSector()) return false;
  const layers = texLayerList(texCtxSector, false) || [];
  let ids = texSelLayers.slice();
  if (!ids.length && texSel != null) {
    const loc = texFindStamp(texSel);
    if (loc) ids = [loc.L.id];
  }
  const kill = layers.filter(L => L && ids.indexOf(L.id) >= 0);
  if (!kill.length) return false;
  histPush();
  const rest = layers.filter(L => L && ids.indexOf(L.id) < 0);
  texData().sectors[String(texCtxSector)] = rest;
  log(tr("log_tex_del", texCtxSector,
    kill.map(L2 => L2.name || "?").join(", ")));
  texSelLayers = [];
  texSel = null;
  if (texLayerIdx >= rest.length) texLayerIdx = rest.length - 1;
  if (texLayerIdx < 0) texLayerIdx = 0;
  _texSig = null;
  draw(); saveMap();
  return true;
}

// RAISE / LOWER — the stack: index 0 is the bottom, the last layer sits on top.
// With `at` — move exactly that row one step (the arrow buttons of the panel row).
// Without — move every selected layer as a group: each step swaps a selected layer with
// an unselected neighbour, so the group keeps its internal order and never swallows
// the layers around it. dir > 0 raises (towards the top), dir < 0 lowers.
// Returns 0 — nothing selected, 1 — already at the edge, 2 — moved.
function texMoveLayer(dir, at, repeat) {
  if (!texHasSector()) return 0;
  const layers = texLayerList(texCtxSector, false) || [];
  let ids = null;
  if (at != null) {
    if (at < 0 || at >= layers.length || !layers[at]) return 0;
    ids = [layers[at].id];
  } else {
    ids = texSelLayers.slice();
    if (!ids.length && texSel != null) {
      const loc = texFindStamp(texSel);
      if (loc) ids = [loc.L.id];
    }
    if (!ids.length) return 0;
  }
  // a dry run on a shallow copy decides whether anything actually moves —
  // the snapshot for undo is taken only for a real change
  const run = (arr) => {
    let moved = false;
    const has = i => !!(arr[i] && ids.indexOf(arr[i].id) >= 0);
    if (dir > 0) {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (!has(i) || i + 1 >= arr.length || (at == null && has(i + 1))) continue;
        const t = arr[i]; arr[i] = arr[i + 1]; arr[i + 1] = t; moved = true;
      }
    } else {
      for (let i = 0; i < arr.length; i++) {
        if (!has(i) || i - 1 < 0 || (at == null && has(i - 1))) continue;
        const t = arr[i]; arr[i] = arr[i - 1]; arr[i - 1] = t; moved = true;
      }
    }
    return moved;
  };
  if (!run(layers.slice())) return 1;
  if (!repeat) histPush();     // a held key = one snapshot for the whole burst
  run(layers);
  const names = ids.map(id => { const f2 = texLayerById(id); return f2 ? (f2.L.name || "?") : "?"; }).join(", ");
  log(tr(dir > 0 ? "log_tex_up" : "log_tex_down", texCtxSector, names));
  const f = texLayerById(ids[ids.length - 1]);
  if (f) texLayerIdx = f.idx;
  _texSig = null;
  refreshTexPanel(); draw(); saveMap();
  return 2;
}

// ---- world rectangles: pick, move, resize, delete ----
function texFindWorld(id) {
  if (id == null) return null;
  const world = texData().world;
  for (let i = world.length - 1; i >= 0; i--) if (world[i] && world[i].id === id) return { rect: world[i], idx: i };
  return null;
}
// the topmost visible world rectangle covering a world point
function texWorldAt(wx, wy) {
  const world = texData().world;
  for (let i = world.length - 1; i >= 0; i--) {
    const r = world[i];
    if (!r || r.visible === false) continue;
    if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return r;
  }
  return null;
}
// which edge/corner of the selected rectangle the point sits on (screen tolerance ~8px)
function texWorldEdgeAt(wx, wy) {
  const loc = texFindWorld(texSelWorld);
  if (!loc) return null;
  const r = loc.rect;
  const t = 8 / (cam.zoom || 1);
  const x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
  const inX = wx >= x0 - t && wx <= x1 + t, inY = wy >= y0 - t && wy <= y1 + t;
  const l = Math.abs(wx - x0) <= t, rt = Math.abs(wx - x1) <= t;
  const tp = Math.abs(wy - y0) <= t, b = Math.abs(wy - y1) <= t;
  if (l && tp && inX && inY) return "nw";
  if (rt && tp && inX && inY) return "ne";
  if (l && b && inX && inY) return "sw";
  if (rt && b && inX && inY) return "se";
  if (l && inY) return "w";
  if (rt && inY) return "e";
  if (tp && inX) return "n";
  if (b && inX) return "s";
  return null;
}
function texDeleteWorld() {
  const loc = texFindWorld(texSelWorld);
  if (!loc) return false;
  histPush();
  texData().world.splice(loc.idx, 1);
  log(tr("log_tex_world_del", Math.round(loc.rect.w), Math.round(loc.rect.h)));
  texSelWorld = null;
  _texSig = null;
  texRenderWorldList();
  draw(); saveMap();
  return true;
}

// World rectangle: bound to the world, tiled with the current selection, never clipped.
function texAddWorldRect(x0, y0, x1, y1) {
  const x = Math.min(x0, x1), y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  if (w < GRID_SIZE / 2 || h < GRID_SIZE / 2) return false;
  if (!texRegionHas()) { hudText = tr("tex_need_region"); updateHud(); return false; }
  const d = texData();
  histPush();
  const r = {
    id: mapData._idc++, x: Math.round(x), y: Math.round(y),
    w: Math.round(w), h: Math.round(h),
    rx: texRegion.x, ry: texRegion.y, rw: texRegion.w, rh: texRegion.h,
    name: String(d.world.length + 1), visible: true
  };
  d.world.push(r);
  texSelWorld = r.id;   // the rectangle you have just drawn stays selected: move or resize it
  hudText = tr("hud_tex_world_added");
  log(tr("log_tex_world_added", Math.round(w), Math.round(h)));
  updateHud();
  _texSig = null;
  texRenderWorldList();
  draw(); saveMap();
  return true;
}

function texOpt(id, def) {
  const e = document.getElementById(id);
  if (!e) return def;
  return !!e.checked;
}


"use strict";
// VLS editor - js/Atlas/state.js: state, tool registry and the sector/layer data
// Split out of js/textures.js - the very same script, only in pieces; load order matters.
// ================= TEXTURE DEPARTMENT =================
// The department is a host, not a texturing method: a tool registers itself, mounts its
// DOM once, and from then on is called back with the current target whenever the
// selection changes.
const texTools = [];
let texActiveTool = null;
let _texSig = null;
let _texTimer = null;

// --- selection state ---
// There is no separate "painting mode": a sector becomes the context one simply by being
// clicked, and leaving it is just a click on empty ground. Everything keys off these three.
let texCtxSector = null;     // sector whose layers are open in the panel (null = nothing selected)
let texSel = null;           // id of the selected placed piece
let texSelLayers = [];       // ids of the selected LAYERS — the group Shift builds (like multiSel)
let texLayerIdx = 0;         // index of the active layer inside the context sector
let texSelWorld = null;      // id of the selected world rectangle
let texWorldDrag = null;     // {sx,sy,ex,ey} while dragging a NEW world rectangle
let texRectDrag = null;      // {mode:'move'|'resize', dir, id, sx, sy, x0, y0, w0, h0} on a selected one
let texEdgeDrag = null;      // {id, dir:'e'|'w'|'n'|'s'|corners, sx, sy, x0, y0, pw0, ph0} — stretching
let texStampDrag = null;     // {sx, sy, items:[{it,x,y}]} — dragging the selected group by pixels
let texSwapped = false;      // canvas and map swapped places (Alt-Tab between the two views)

// TWO GRIDS, AND THEY COINCIDE EXACTLY:
//   technical — 40 world units per cell (the editor's own grid)
//   visual    — 16 pixels of the canvas per the very same cell
// so one canvas pixel is always GRID_SIZE/16 world units, never more and never less.
const TEX_PX = GRID_SIZE / 16;          // = 2.5 world units per canvas pixel

// Is the texture department the open one? Everything that has to differ between
// geometry editing and texturing keys off this — the render style, the toolbar, the hotkeys.
function texMode() {
  const p = document.getElementById("panelTextures");
  return !!p && !p.hidden;
}

// def = { id, mount(el, tool), update(target, el) }
function registerTexTool(def) {
  if (!def || def.id == null) return null;
  for (const t of texTools) if (t.id === def.id) return t;
  const tool = {
    id: def.id,
    el: null,
    update: typeof def.update === "function" ? def.update : null
  };
  const host = document.getElementById("texTools");
  if (host) {
    tool.el = document.createElement("div");
    tool.el.className = "textool";
    tool.el.dataset.id = String(def.id);
    host.appendChild(tool.el);
    if (typeof def.mount === "function") def.mount(tool.el, tool);
  }
  texTools.push(tool);
  if (!texActiveTool) texActiveTool = tool;
  refreshTexPanel();
  return tool;
}

// What a texture tool would work on right now: a sector always wins, else null.
function texTarget() {
  const items = selItems();
  for (const m of items) if (m.kind === "sector") return m;
  if (items.length) return items[items.length - 1];
  if (sel.sector != null) return { kind: "sector", id: sel.sector };
  return null;
}

// ================= MAP TEXTURE DATA =================
// mapData.tex.sectors[sectorId] = [layer, ...]   (index 0 = bottom of the stack)
// layer  = { id, name, color, visible, items:[piece, ...] }
// ONE SPRITE = ONE LAYER: a layer is created together with the sprite that lives on it,
// so the stack reads bottom-up as the order the sprites were laid down.
// piece  = { id, x, y, rx, ry, rw, rh, pw, ph }
//          x/y  = sector-local world units (on the pixel grid)
//          r*   = source rectangle in t-map.png, in atlas pixels
//          pw/ph = the placed size IN PIXELS (pw>=1, ph>=1); the source repeats inside it
// mapData.tex.world = [{id,x,y,w,h,rx,ry,rw,rh,name,visible}] — bound to the world, not to a sector
function texData() {
  if (!mapData.tex || typeof mapData.tex !== "object") mapData.tex = {};
  if (!mapData.tex.sectors || typeof mapData.tex.sectors !== "object") mapData.tex.sectors = {};
  if (!Array.isArray(mapData.tex.world)) mapData.tex.world = [];
  return mapData.tex;
}
// Once per load: drop records that carry no real pixel rectangle (an older format,
// a half-written line) so nothing half-broken ever reaches the canvas.
function texNormalize() {
  const d = texData();
  for (const k of Object.keys(d.sectors)) {
    const layers = d.sectors[k];
    if (!Array.isArray(layers)) { delete d.sectors[k]; continue; }
    for (const L of layers) {
      if (!L || typeof L !== "object") continue;
      if (!Array.isArray(L.items)) L.items = [];
      L.items = L.items.filter(it => it && it.rw > 0 && it.rh > 0);
      for (const it of L.items) {
        // a piece saved by an older build has no placed size yet: it is its own source size
        if (!(it.pw > 0)) it.pw = it.rw;
        if (!(it.ph > 0)) it.ph = it.rh;
      }
      if (!L.color) L.color = "#4a7fd4";
      if (L.name == null || L.name === "") L.name = "1";
      if (L.visible == null) L.visible = true;
    }
  }
  d.world = (d.world || []).filter(r => r && r.rw > 0 && r.rh > 0 && r.w > 0 && r.h > 0);
}
function texLayerList(sectorId, create) {
  const d = texData();
  const k = String(sectorId);
  if (!Array.isArray(d.sectors[k])) {
    if (!create) return null;
    d.sectors[k] = [];
  }
  return d.sectors[k];
}
// A layer is never invented for a sector just because it got selected: layers are born
// with their sprite (one sprite = one layer) and die with it.
function texNewLayer(sectorId) {
  const list = texLayerList(sectorId, true);
  const L = { id: mapData._idc++, name: String(list.length + 1), color: "#4a7fd4", visible: true, items: [] };
  list.push(L);                 // on top: the newest sprite covers the ones laid before it
  texLayerIdx = list.length - 1;
  texSelLayers = [L.id];
  return L;
}
// find a layer of the current sector by its id (ids survive adding and removing layers)
function texLayerById(id) {
  if (id == null || !texHasSector()) return null;
  const layers = texLayerList(texCtxSector, false) || [];
  for (let i = 0; i < layers.length; i++) if (layers[i] && layers[i].id === id) return { L: layers[i], idx: i };
  return null;
}
// single selection of a layer: it becomes the active one and the only selected one
function texSelectLayer(id) {
  const f = texLayerById(id);
  if (!f) { texSelLayers = []; return false; }
  texLayerIdx = f.idx;
  texSelLayers = [f.L.id];
  _texSig = null;
  return true;
}
// Shift: toggle a layer in the group selection (exactly like multiSel in vector mode)
function texToggleLayer(id) {
  if (id == null) return false;
  const i = texSelLayers.indexOf(id);
  if (i >= 0) texSelLayers.splice(i, 1); else texSelLayers.push(id);
  const f = texLayerById(id);
  if (f) texLayerIdx = f.idx;
  _texSig = null;
  return true;
}
// is this layer part of the group?
function texLayerSelected(id) { return id != null && texSelLayers.indexOf(id) >= 0; }
// every item of the group; falls back to the single selected piece for old habits
function texSelectedItems() {
  const out = [];
  const layers = texLayerList(texCtxSector, false) || [];
  for (const L of layers) {
    if (!L || !texLayerSelected(L.id) || !Array.isArray(L.items)) continue;
    for (const it of L.items) if (it) out.push(it);
  }
  if (out.length) return out;
  const loc = texFindStamp(texSel);
  return loc ? [loc.it] : [];
}
function texHasSector() { return texCtxSector != null; }


"use strict";
// VLS editor - js/Atlas/canvas.js: the atlas picture: region brush, zoom and the view
// Split out of js/textures.js - the very same script, only in pieces; load order matters.
// ================= THE CANVAS (t-map.png) =================
// One atlas image is the canvas for both projects:
//   Godot:  Data/SectorData/t-map.png     editor: textures/t-map.png
// You take a group of pixels out of it with a rectangle — that rectangle is the brush.
const TEX_ATLAS_SRC = "textures/t-map.png";
// the first tile of the atlas (80×80 at (0,32), step 96) — kept as the atlas' own reference
const TEX_REGION_DEFAULT = { x: 0, y: 32, w: 80, h: 80 };
// Nothing is selected until you drag a rectangle yourself: no tile is picked for you.
let texRegion = { x: 0, y: 0, w: 0, h: 0 };
function texRegionHas() { return texRegion.w > 0 && texRegion.h > 0; }
// atlas size for the export header: null until the picture has loaded.
// The engine checks it against its own t-map.png — a mismatch would move every region.
function texAtlasSize() {
  if (!_atlasImg.complete || !_atlasImg.naturalWidth) return null;
  return { w: _atlasImg.naturalWidth, h: _atlasImg.naturalHeight };
}

const _regionCache = {};
let _regionCacheLive = false;
const _atlasImg = new Image();

function regionCanvas(rx, ry, rw, rh) {
  const w = Math.round(rw), h = Math.round(rh);
  if (w < 1 || h < 1) return regionBlank();
  const key = Math.round(rx) + "," + Math.round(ry) + "," + w + "," + h;
  if (_regionCache[key]) return _regionCache[key];
  if (!_regionCacheLive || !_atlasImg.complete || !_atlasImg.naturalWidth) return regionBlank();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").drawImage(_atlasImg, Math.round(rx), Math.round(ry), w, h, 0, 0, w, h);
  _regionCache[key] = c;
  return c;
}
// 1×1 grey pixel while the canvas is still loading (never cached under a real key)
let _regionBlank = null;
function regionBlank() {
  if (_regionBlank) return _regionBlank;
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  c.getContext("2d").fillStyle = "#6a6f7a";
  c.getContext("2d").fillRect(0, 0, 1, 1);
  _regionBlank = c;
  return c;
}

_atlasImg.onload = () => {
  _regionCacheLive = true;
  for (const k in _regionCache) delete _regionCache[k];
  texRegionClamp();
  paintRegionBox();
  updateRegionLabel();
  if (texMode()) refreshTexPanel();
  if (typeof draw === "function") draw();
};
_atlasImg.onerror = () => { _regionCacheLive = false; };
_atlasImg.src = TEX_ATLAS_SRC;

function texRegionClamp() {
  const nw = _atlasImg.naturalWidth || 968, nh = _atlasImg.naturalHeight || 692;
  // an empty selection stays empty — nothing gets picked in its place
  if (texRegion.w < 1 || texRegion.h < 1) { texRegion = { x: 0, y: 0, w: 0, h: 0 }; return; }
  const x = Math.max(0, Math.min(nw - 1, Math.round(texRegion.x)));
  const y = Math.max(0, Math.min(nh - 1, Math.round(texRegion.y)));
  const w = Math.max(1, Math.min(nw - x, Math.round(texRegion.w)));
  const h = Math.max(1, Math.min(nh - y, Math.round(texRegion.h)));
  texRegion = { x: x, y: y, w: w, h: h };
}
// The selection rectangle and its eight handles live OUTSIDE the transformed canvas layer,
// so both stay hard 1px lines at any zoom instead of turning into a soft grey smear.
function paintRegionBox() {
  const box = document.getElementById("texAtlasRect");
  const img = document.getElementById("texAtlasImg");
  const atlas = document.getElementById("texAtlas");
  const handles = document.getElementById("texHandles");
  if (!box || !img || !atlas) return;
  const nw = img.naturalWidth || 968, nh = img.naturalHeight || 692;
  const ar = atlas.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const sx = ir.width / nw, sy = ir.height / nh;
  const L = ir.left - ar.left, T = ir.top - ar.top;
  const has = texRegionHas();
  box.style.display = has ? "" : "none";
  if (handles) handles.style.display = has ? "" : "none";
  if (!has) return;
  const x = Math.round(L + texRegion.x * sx), y = Math.round(T + texRegion.y * sy);
  const w = Math.round(texRegion.w * sx), h = Math.round(texRegion.h * sy);
  box.style.left = x + "px";
  box.style.top = y + "px";
  box.style.width = w + "px";
  box.style.height = h + "px";
  if (!handles) return;
  const cx = x + w / 2, cy = y + h / 2;
  const pos = { n: [cx, y], s: [cx, y + h], e: [x + w, cy], w: [x, cy],
                ne: [x + w, y], nw: [x, y], se: [x + w, y + h], sw: [x, y + h] };
  for (const el of handles.children) {
    const p = pos[el.dataset.d];
    if (!p) continue;
    el.style.left = p[0] + "px";
    el.style.top = p[1] + "px";
  }
}
function updateRegionLabel() {
  const el = document.getElementById("texRegionSize");
  if (!el) return;
  if (!texRegionHas()) { el.textContent = tr("tex_need_region"); return; }
  el.textContent = tr("tex_region_size",
    texRegion.w, texRegion.h,
    Math.round(texRegion.w * TEX_PX), Math.round(texRegion.h * TEX_PX));
}

// ---- looking at the canvas: pan and zoom, exactly like the map camera, but only for viewing ----
// x/y = offset of the canvas inside its window (CSS px), z = scale (1 = the canvas fills the window width)
const texView = { x: 0, y: 0, z: 1 };
const TEX_VIEW_MIN = 0.05, TEX_VIEW_MAX = 48;
function texViewBox() { return document.getElementById("texAtlas"); }
function texViewInner() { return document.getElementById("texAtlasIn"); }
// The view is a sheet of paper on a desk: it may stand at the edge of the window or be
// pushed out of it completely — nothing holds it in place. Only the zoom stays inside a
// range, and the coordinates are checked for nonsense. "Reset view" brings it back.
function texViewClamp() {
  if (!isFinite(texView.x) || !isFinite(texView.y)) { texView.x = 0; texView.y = 0; }
  if (!isFinite(texView.z)) texView.z = 1;
  texView.z = Math.max(TEX_VIEW_MIN, Math.min(TEX_VIEW_MAX, texView.z));
}
// the default: fill the window width, centred if it still fits
function texViewCenter() {
  const box = texViewBox(), img = document.getElementById("texAtlasImg");
  if (!box) return;
  const nw = (img && img.naturalWidth) || 968, nh = (img && img.naturalHeight) || 692;
  const cw = box.clientWidth, ch = box.clientHeight;
  const w = cw * texView.z, h = (cw * nh / nw) * texView.z;
  texView.x = w <= cw ? (cw - w) / 2 : 0;
  texView.y = h <= ch ? (ch - h) / 2 : 0;
}
function texViewApply() {
  const inner = texViewInner();
  if (!inner) return;
  inner.style.transform = "translate(" + texView.x + "px," + texView.y + "px) scale(" + texView.z + ")";
  const zl = document.getElementById("texViewZoom");
  if (zl) zl.textContent = Math.round(texView.z * 100) + "%";
  // pixel art: switch to hard pixels as soon as one canvas pixel is at least one screen pixel
  const img = document.getElementById("texAtlasImg"), box = texViewBox();
  if (img && box) img.classList.toggle("pixelated", (box.clientWidth / (img.naturalWidth || 968)) * texView.z >= 1);
  // the rectangle and the handles are drawn in screen space: they have to follow the canvas
  paintRegionBox();
}
// zoom around a point of the window (the point under the cursor stays under the cursor)
function texViewZoomAt(sx, sy, f) {
  const z0 = texView.z;
  const z = Math.max(TEX_VIEW_MIN, Math.min(TEX_VIEW_MAX, z0 * f));
  if (z === z0) return;
  const ix = (sx - texView.x) / z0, iy = (sy - texView.y) / z0;
  texView.z = z;
  texView.x = sx - ix * z;
  texView.y = sy - iy * z;
  texViewClamp();
  texViewApply();
}
function texViewReset() { texView.x = 0; texView.y = 0; texView.z = 1; texViewCenter(); texViewClamp(); texViewApply(); }
window.addEventListener("resize", () => { texViewClamp(); texViewApply(); });


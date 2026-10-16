"use strict";
// VLS editor - js/Atlas/stamp.js: placed sprites: find, move by pixels, stretch by pixels
// Split out of js/textures.js - the very same script, only in pieces; load order matters.
// ================= SPRITES =================
// The placed size is pw/ph PIXELS (one pixel = TEX_PX world units) and is independent of
// the source: the source rectangle repeats inside it, so a sprite can be pulled longer
// without ever becoming a row of separate copies.
function texStampBox(it) {
  const pw = it.pw > 0 ? it.pw : it.rw, ph = it.ph > 0 ? it.ph : it.rh;
  return { x: it.x, y: it.y, w: pw * TEX_PX, h: ph * TEX_PX };
}
// find a placed sprite by id (searches every layer of the painted sector)
function texFindStamp(id) {
  if (id == null || !texHasSector()) return null;
  const layers = texLayerList(texCtxSector, false) || [];
  for (let li = layers.length - 1; li >= 0; li--) {
    const L = layers[li];
    if (!L || !Array.isArray(L.items)) continue;
    for (let i = L.items.length - 1; i >= 0; i--) {
      if (L.items[i] && L.items[i].id === id) return { layers: layers, li: li, L: L, idx: i, it: L.items[i] };
    }
  }
  return null;
}
// every visible sprite whose body covers the world point, TOP first (draw order reversed).
// The part lying outside the sector is not drawn in the game and is not drawn here either,
// so the body is only pickable inside the outline.
function texStampsAt(wx, wy) {
  const out = [];
  if (!texHasSector()) return out;
  const sec = getSector(texCtxSector);
  if (!sec || !pointInSector(sec, wx, wy)) return out;
  const offx = sec.offset ? sec.offset.x : 0, offy = sec.offset ? sec.offset.y : 0;
  const lx = wx - offx, ly = wy - offy;
  // a click on the very edge must still land on the sprite: rounding can put it a hair
  // outside, so give it a couple of screen pixels of slack instead of dropping it
  const T = Math.max(1, 1.5 / (cam.zoom || 1));
  const layers = texLayerList(texCtxSector, false) || [];
  for (let li = layers.length - 1; li >= 0; li--) {
    const L = layers[li];
    if (!L || L.visible === false || !Array.isArray(L.items)) continue;
    for (let i = L.items.length - 1; i >= 0; i--) {
      const it = L.items[i];
      if (!it || !it.rw || !it.rh) continue;
      const b = texStampBox(it);
      if (lx >= b.x - T && lx < b.x + b.w + T && ly >= b.y - T && ly < b.y + b.h + T) {
        out.push({ li: li, L: L, idx: i, it: it });
      }
    }
  }
  return out;
}
// topmost sprite under a world point (the head of the stack)
function texStampAt(wx, wy) {
  const all = texStampsAt(wx, wy);
  return all.length ? all[0] : null;
}
// is the point inside THIS sprite's body? Selection is decided by the selection itself,
// not by the draw order — a sprite buried under an opaque overlay stays draggable.
function texStampBoxHit(it, wx, wy) {
  if (!it || !it.rw || !it.rh || !texHasSector()) return false;
  const sec = getSector(texCtxSector);
  if (!sec || !pointInSector(sec, wx, wy)) return false;
  const offx = sec.offset ? sec.offset.x : 0, offy = sec.offset ? sec.offset.y : 0;
  const lx = wx - offx, ly = wy - offy;
  const T = Math.max(1, 1.5 / (cam.zoom || 1));
  const b = texStampBox(it);
  return lx >= b.x - T && lx < b.x + b.w + T && ly >= b.y - T && ly < b.y + b.h + T;
}

// Which outline of ONE placed sprite the point sits on (about 6 screen px of slack):
// one of the four edges or one of the four corners — every one of them stretches the
// sprite by whole pixels. Pure geometry: coverage by other sprites plays no role.
function texStampEdgeDir(it, wx, wy) {
  if (!it || !it.rw || !it.rh || !texHasSector()) return null;
  const sec = getSector(texCtxSector);
  if (!sec) return null;
  const offx = sec.offset ? sec.offset.x : 0, offy = sec.offset ? sec.offset.y : 0;
  const lx = wx - offx, ly = wy - offy;
  const T = Math.max(1, 6 / (cam.zoom || 1));
  const b = texStampBox(it);
  const x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.h;
  const inX = lx >= x0 - T && lx <= x1 + T, inY = ly >= y0 - T && ly <= y1 + T;
  const l = Math.abs(lx - x0) <= T, rt = Math.abs(lx - x1) <= T;
  const tp = Math.abs(ly - y0) <= T, btm = Math.abs(ly - y1) <= T;
  if (l && tp && inX && inY) return "nw";
  if (rt && tp && inX && inY) return "ne";
  if (l && btm && inX && inY) return "sw";
  if (rt && btm && inX && inY) return "se";
  if (l && inY) return "w";
  if (rt && inY) return "e";
  if (tp && inX) return "n";
  if (btm && inX) return "s";
  return null;
}

// Which outline of a placed sprite is the point sitting on. Two passes: a point inside
// a sprite only ever claims THAT sprite's outline, so a click deep in the middle never
// gets stolen by a covered one underneath.
function texStampEdgeAt(wx, wy) {
  if (!texHasSector()) return null;
  const sec = getSector(texCtxSector);
  if (!sec) return null;
  const inside = texStampAt(wx, wy);
  if (inside) {
    const d = texStampEdgeDir(inside.it, wx, wy);
    return d ? { it: inside.it, dir: d } : null;
  }
  // nothing under the point: it may still be sitting just outside a sprite's outline
  const layers = texLayerList(texCtxSector, false) || [];
  for (let li = layers.length - 1; li >= 0; li--) {
    const L = layers[li];
    if (!L || L.visible === false || !Array.isArray(L.items)) continue;
    for (let i = L.items.length - 1; i >= 0; i--) {
      const it = L.items[i];
      if (!it || !it.rw || !it.rh) continue;
      const d = texStampEdgeDir(it, wx, wy);
      if (d) return { it: it, dir: d };
    }
  }
  return null;
}

// ARROWS / group nudge — one step is ONE PIXEL, and everything that is selected moves
// together (the same contract as a multi-selection of sectors in vector mode).
function texMoveStamp(dxPx, dyPx, repeat) {
  const items = texSelectedItems();
  if (!items.length || (!dxPx && !dyPx)) return false;
  if (!repeat) histPush();
  const dx = dxPx * TEX_PX, dy = dyPx * TEX_PX;
  for (const it of items) { it.x += dx; it.y += dy; }
  _texSig = null;
  hudText = Math.round(items[0].x / TEX_PX) + ", " + Math.round(items[0].y / TEX_PX);
  updateHud();
  draw(); saveMapSoon();
  return true;
}

"use strict";
// VLS editor - js/Atlas/misc.js: render flags and the panel wiring
// Split out of js/textures.js - the very same script, only in pieces; load order matters.
// ================= RENDER HELPERS =================
// Geometry stays on by default — you have to SEE where you click. The checkboxes only
// take it away when you want the textures alone. (Outside texturing nothing is gated.)
function texShowSectors() { return !texMode() || texOpt("optShowSectors", true); }
function texShowWalls()   { return !texMode() || texOpt("optShowWalls", true); }
function texShowWorld()   { return texMode() && texOpt("optShowWorld", true); }
// The transparency switch: ON — every layer that is not selected is drawn half-transparent
// (with nothing selected that means everything), OFF — exactly as the game will show it.
function texDimUnsel() { return texMode() && texOpt("optDimUnsel", false); }

function pointInSector(sec, wx, wy) {
  const offx = sec.offset ? sec.offset.x : 0, offy = sec.offset ? sec.offset.y : 0;
  let inside = false;
  const vs = sec.verts;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const a = getV(vs[i]), b = getV(vs[j]);
    if (!a || !b) continue;
    const ay = a.y + offy, by = b.y + offy;
    if ((ay > wy) !== (by > wy) &&
        wx < ((b.x + offx) - (a.x + offx)) * (wy - ay) / (by - ay) + (a.x + offx)) inside = !inside;
  }
  return inside;
}

// ================= WIRING =================
(function initTexPanel() {
  const on = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = fn; };
  on("btnTexViewReset", () => texViewReset());
  on("texAtlasSnapImg", () => texSwapView(true));
  on("texMapSnapImg", () => texSwapView(false));
  on("btnTexDel", () => { if (texDeleteStamp()) { _texSig = null; refreshTexPanel(); updateHud(); } });
  on("btnTexWorldDel", () => { if (texDeleteWorld()) { updateHud(); } });
  for (const id of ["optShowSectors", "optShowWalls", "optShowWorld", "optDimUnsel"]) {
    const e = document.getElementById(id);
    if (e) e.onchange = () => { _texSig = null; draw(); };
  }
  paintRegionBox();
  updateRegionLabel();
  texAtlasSnapPaint();   // the panel shows a picture from the very first frame
})();


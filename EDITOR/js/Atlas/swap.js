"use strict";
// VLS editor - js/Atlas/swap.js: Alt-Tab: the canvas and the map trade places
// Split out of js/textures.js - the very same script, only in pieces; load order matters.
// ---- Alt-Tab: the canvas takes the main window, a still picture stays behind ----
// Purely visual: nothing in the map, the layers or the region changes, only where the two
// views sit. The canvas node itself moves, so every listener on it moves along.
// There are no swap buttons anywhere: the picture in the panel is the only switch. The
// canvas is functional only in the main window — in the panel it is a picture, nothing more.
let texSwapHome = null;   // where the canvas block lived before the first swap

// A still picture of the canvas for the panel. A file:// image taints the canvas, so it is
// copied with drawImage: drawing works on a tainted canvas, only the export is forbidden.
function texAtlasSnapPaint() {
  const cv = document.getElementById("texAtlasSnapImg");
  const img = document.getElementById("texAtlasImg");
  if (!cv || !img || !img.naturalWidth) return false;
  const maxW = 720;                       // the panel is narrow: a picture, not a copy
  const k = Math.min(1, maxW / img.naturalWidth);
  try {
    cv.width = Math.max(1, Math.round(img.naturalWidth * k));
    cv.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = cv.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(img, 0, 0, cv.width, cv.height);
    cv.dataset.painted = "1";
    return true;
  } catch (e) { cv.dataset.painted = ""; return false; }
}

// The picture of the map is painted straight into a canvas: a file:// atlas taints the
// main canvas, so toDataURL would throw — drawing works on a tainted canvas, only the
// export is forbidden. Same trick keeps the swap usable without any browser flags.
function texMapPaint() {
  const cv = document.getElementById("texMapSnapImg");
  const src = document.getElementById("canvas");
  if (!cv || !src || !src.width || !src.height) return false;
  const maxW = 720;                       // the sidebar is narrow: a preview, not a copy
  const k = Math.min(1, maxW / src.width);
  const w = Math.max(1, Math.round(src.width * k));
  const h = Math.max(1, Math.round(src.height * k));
  try {
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.clearRect(0, 0, w, h);
    g.drawImage(src, 0, 0, w, h);
    cv.dataset.painted = "1";
    return true;
  } catch (e) { cv.dataset.painted = ""; return false; }
}
function texMapClear() {
  const cv = document.getElementById("texMapSnapImg");
  if (!cv) return;
  cv.width = 1; cv.height = 1;
  cv.dataset.painted = "";
}
function texSwapView(force) {
  const cb = document.getElementById("texCanvasBlock");
  const snap = document.getElementById("texMapSnap");
  const snapA = document.getElementById("texAtlasSnap");
  const box = document.getElementById("texSwapBox");
  const panel = document.getElementById("panelTextures");
  if (!cb || !box || !panel) return false;
  const to = (force === undefined) ? !texSwapped : !!force;
  if (to === texSwapped) return false;
  if (to && !texSwapHome) texSwapHome = { parent: cb.parentNode, next: cb.nextSibling };
  texSwapped = to;
  if (to) {
    texMapPaint();
    if (snap) snap.hidden = false;
    if (snapA) snapA.hidden = true;
    cb.hidden = false;                 // live only in the main window
    box.appendChild(cb);
    box.hidden = false;
  } else {
    if (texSwapHome && texSwapHome.parent) {
      if (texSwapHome.next && texSwapHome.next.parentNode === texSwapHome.parent)
        texSwapHome.parent.insertBefore(cb, texSwapHome.next);
      else texSwapHome.parent.appendChild(cb);
    }
    cb.hidden = true;                  // back in the panel: a picture again, not a canvas
    box.hidden = true;
    if (snap) snap.hidden = true;
    if (snapA) { snapA.hidden = false; texAtlasSnapPaint(); }
    texMapClear();
  }
  texViewClamp(); texViewApply(); paintRegionBox(); updateRegionLabel();
  draw();
  return true;
}

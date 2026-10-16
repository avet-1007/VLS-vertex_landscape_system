"use strict";
// VLS editor - js/Atlas/drag.js: pointer work on the atlas: take, move and resize the rectangle
// Split out of js/textures.js - the very same script, only in pieces; load order matters.
// ---- working the canvas ----
//   drag on empty canvas  -> take a rectangle of pixels (the brush)
//   drag inside that rect  -> move it
//   drag one of its handles -> resize it
//   middle/right button (or Shift+drag) moves the view, the wheel zooms it, double click resets it
(function initAtlasDrag() {
  const box = document.getElementById("texAtlas");
  const img = document.getElementById("texAtlasImg");
  const handles = document.getElementById("texHandles");
  if (!box || !img) return;
  let mode = null;         // 'new' | 'move' | 'resize' | 'pan'
  let anchor = null;       // atlas-pixel anchor of the rectangle being taken
  let dir = null;          // handle under the cursor (n/s/e/w/ne/nw/se/sw)
  let startRegion = null;  // the region as it was when the gesture began
  let startPtr = null;     // the pointer at that moment, in atlas pixels
  let moved = false;
  let panning = null;

  const toPixel = (e) => {
    const r = img.getBoundingClientRect();
    const nw = img.naturalWidth || 968, nh = img.naturalHeight || 692;
    if (!r.width || !r.height) return { x: 0, y: 0 };
    let x = (e.clientX - r.left) * nw / r.width;
    let y = (e.clientY - r.top) * nh / r.height;
    return {
      x: Math.max(0, Math.min(nw, Math.round(x))),
      y: Math.max(0, Math.min(nh, Math.round(y)))
    };
  };
  const insideRegion = (p) => texRegionHas() &&
    p.x >= texRegion.x && p.x <= texRegion.x + texRegion.w &&
    p.y >= texRegion.y && p.y <= texRegion.y + texRegion.h;
  // keep the rectangle inside the atlas while it is being dragged
  function fit(r) {
    const nw = img.naturalWidth || 968, nh = img.naturalHeight || 692;
    const w = Math.max(1, Math.min(nw, Math.round(r.w)));
    const h = Math.max(1, Math.min(nh, Math.round(r.h)));
    return { x: Math.max(0, Math.min(nw - w, Math.round(r.x))),
             y: Math.max(0, Math.min(nh - h, Math.round(r.y))), w: w, h: h };
  }
  function resizeTo(p) {
    const R = startRegion;
    const nw = img.naturalWidth || 968, nh = img.naturalHeight || 692;
    let x0 = R.x, y0 = R.y, x1 = R.x + R.w, y1 = R.y + R.h;
    if (dir.indexOf("w") >= 0) x0 = Math.max(0, Math.min(p.x, x1 - 1));
    else if (dir.indexOf("e") >= 0) x1 = Math.min(nw, Math.max(p.x, x0 + 1));
    if (dir.indexOf("n") >= 0) y0 = Math.max(0, Math.min(p.y, y1 - 1));
    else if (dir.indexOf("s") >= 0) y1 = Math.min(nh, Math.max(p.y, y0 + 1));
    texRegion = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function track(on) {
    if (on) { document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp); }
    else { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); }
  }

  box.addEventListener("mousedown", e => {
    // middle/right button, Shift+drag or Space+drag moves the view — anywhere, no clamping
    const pan = (e.button === 1 || e.button === 2 ||
                 (e.button === 0 && (e.shiftKey || spaceHeld)));
    if (pan) {
      e.preventDefault();
      mode = "pan";
      panning = { mx: e.clientX, my: e.clientY, x: texView.x, y: texView.y };
      box.classList.add("panning");
    } else if (e.button === 0) {
      e.preventDefault();
      const p = toPixel(e);
      startRegion = { x: texRegion.x, y: texRegion.y, w: texRegion.w, h: texRegion.h };
      startPtr = p;
      anchor = p;
      moved = false;
      mode = insideRegion(p) ? "move" : "new";
      if (mode === "new") { texRegion = { x: p.x, y: p.y, w: 0, h: 0 }; paintRegionBox(); }
    } else {
      return;
    }
    // from here on the gesture is followed on the whole document, so it survives
    // leaving the window: the drag does not stop under the cursor
    track(true);
  });
  function onMove(e) {
    if (mode === "pan") {
      texView.x = panning.x + (e.clientX - panning.mx);
      texView.y = panning.y + (e.clientY - panning.my);
      texViewClamp();
      texViewApply();
      return;
    }
    if (!mode) return;
    const p = toPixel(e);
    if (mode === "new") {
      if (Math.abs(p.x - anchor.x) + Math.abs(p.y - anchor.y) < 1) return;
      moved = true;
      texRegion = { x: Math.min(anchor.x, p.x), y: Math.min(anchor.y, p.y),
                    w: Math.abs(p.x - anchor.x), h: Math.abs(p.y - anchor.y) };
    } else if (mode === "move") {
      if (Math.abs(p.x - startPtr.x) + Math.abs(p.y - startPtr.y) < 1) return;
      moved = true;
      texRegion = fit({ x: startRegion.x + (p.x - startPtr.x),
                        y: startRegion.y + (p.y - startPtr.y),
                        w: startRegion.w, h: startRegion.h });
    } else if (mode === "resize") {
      moved = true;
      resizeTo(p);
    } else return;
    paintRegionBox(); updateRegionLabel();
  }
  function onUp() {
    track(false);
    if (mode === "pan") { panning = null; box.classList.remove("panning"); mode = null; return; }
    // a plain click changes nothing: the rectangle you had stays as it was, and it never
    // swaps anything — the picture in the panel is the only switch
    if (mode === "new" && !moved) texRegion = startRegion;
    mode = null; anchor = null; dir = null; startRegion = null; startPtr = null;
    texRegionClamp();
    paintRegionBox(); updateRegionLabel();
    _texSig = null;
    refreshTexPanel();
  }
  if (handles) {
    for (const el of handles.children) {
      el.addEventListener("mousedown", e => {
        if (e.button !== 0 || !texRegionHas()) return;
        e.preventDefault();
        e.stopPropagation();
        mode = "resize";
        dir = el.dataset.d;
        startRegion = { x: texRegion.x, y: texRegion.y, w: texRegion.w, h: texRegion.h };
        startPtr = toPixel(e);
        moved = false;
        track(true);
      });
    }
  }
  box.addEventListener("wheel", e => {
    const r = box.getBoundingClientRect();
    let f = Math.pow(1.0015, -e.deltaY);
    if (f < 0.25) f = 0.25;
    if (f > 4) f = 4;
    texViewZoomAt(e.clientX - r.left, e.clientY - r.top, f);
    e.preventDefault();
  }, { passive: false });
  box.addEventListener("dblclick", () => { texViewReset(); });
  img.addEventListener("load", () => { texViewReset(); texAtlasSnapPaint(); texRegionClamp(); paintRegionBox(); updateRegionLabel(); });
  texViewClamp();
  texViewApply();
})();


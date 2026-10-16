"use strict";
// VLS editor - js/input.js: mouse, clicks, context menu
// ================= INPUT =================
// Suppress the system context menu everywhere except input fields (so two menus never pop up at once)
document.addEventListener("contextmenu", e => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
  e.preventDefault();
});
canvas.addEventListener("contextmenu", e => e.preventDefault());

canvas.addEventListener("mousedown", e => {
  const rect = canvas.getBoundingClientRect();
  lastMouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  const w = screenToWorld(lastMouse.x, lastMouse.y);

  // middle button — or Space held with the left one — moves the camera; nothing is clamped,
  // the map may sit at the edge of the screen or slide off it entirely
  if (e.button === 1 || (e.button === 0 && spaceHeld)) {
    e.preventDefault(); dragging = true;
    // textures: the middle button owns selection — remember the press; a click without a
    // drag picks the sector (or drops the brush) on release
    if (e.button === 1 && texMode()) mmbDown = { x: lastMouse.x, y: lastMouse.y, w: w, moved: false };
    return;
  }

  if (e.button === 0) {
    leftBtnDown = true;
    histBegin(); // state snapshot before the gesture (one gesture = one undo step)
    if (texMode()) {
      // a fresh press starts from scratch: no gesture of the previous one survives
      texEdgeDrag = null; texStampDrag = null;
      // 1) a selected world rectangle resizes by its edge or corner
      const edge = texSelWorld != null ? texWorldEdgeAt(w.x, w.y) : null;
      if (edge) {
        const loc = texFindWorld(texSelWorld);
        if (loc) texRectDrag = { mode: "resize", dir: edge, id: texSelWorld,
                                 sx: w.x, sy: w.y, x0: loc.rect.x, y0: loc.rect.y,
                                 w0: loc.rect.w, h0: loc.rect.h };
      } else {
        // 2) the SELECTED sprite's outline: pull to stretch it. The left button never
        //    selects any more — selection belongs to the right button alone.
        let started = false;
        const locS = texSel != null ? texFindStamp(texSel) : null;
        if (locS && locS.L.visible !== false) {
          const dS = texStampEdgeDir(locS.it, w.x, w.y);
          if (dS) {
            const b0 = texStampBox(locS.it);
            texSelWorld = null;
            texEdgeDrag = { id: locS.it.id, dir: dS, sx: w.x, sy: w.y,
                            x0: locS.it.x, y0: locS.it.y,
                            pw0: Math.round(b0.w / TEX_PX), ph0: Math.round(b0.h / TEX_PX) };
            texStampDrag = null;
            started = true;
            updateHud(); draw();
          } else if (texStampBoxHit(locS.it, w.x, w.y)) {
            // 3) the SELECTED sprite's body: carry it and its group — even when a
            //    covering sprite hides it, the selection decides, not the draw order
            texSelWorld = null;
            texEdgeDrag = null;
            texStampDrag = { sx: w.x, sy: w.y, items: texSelectedItems().map(i2 => ({ it: i2, x: i2.x, y: i2.y })) };
            started = true;
            updateHud(); draw();
          }
        }
        if (!started) {
          // 4-7) no selected sprite under the cursor: place / world / ground —
          //      a click on another sprite simply falls through to the chain
          const sec = pickInnermostSector(w.x, w.y);
          if (sec && texCtxSector === sec.id && texRegionHas()) {
            texPlaceStamp(w.x, w.y);
          } else if (sec) {
            // 5) a foreign sector: the left button changes nothing here
          } else if (texWorldAt(w.x, w.y)) {
            // 6) a world rectangle: select it and drag it where you want it
            const wr = texWorldAt(w.x, w.y);
            texSelWorld = wr.id;
            texSel = null;
            texCtxSector = null;
            texRectDrag = { mode: "move", id: wr.id, sx: w.x, sy: w.y, x0: wr.x, y0: wr.y };
            _texSig = null;
            refreshTexPanel(); updateHud(); draw();
          } else {
            // 7) empty ground: nothing is selected here any more, and a rectangle
            //    drawn from here on belongs to the world (press — drag — release)
            texSel = null; texSelLayers = []; texSelWorld = null; texCtxSector = null;
            sel.vertex = null; sel.line = null; sel.sector = null;
            sel.thing = null; sel.trigger = null; sel.triggerCorner = null; sel.floor = null;
            multiSel = [];
            _texSig = null;
            const p = snapPoint(w);
            texWorldDrag = { sx: p.x, sy: p.y, ex: p.x, ey: p.y };
            refreshTexPanel(); updateHud(); draw();
          }
        }
      }
    } else if (tool === "box" || tool === "boxsmooth") {
      // start dragging a box sector
      const p = snapPoint(w);
      boxAnchor = { x: p.x, y: p.y };
      leftBoxDrag = true;
    } else if (tool === "trigger") {
      // start dragging a trigger rectangle
      const p = snapPoint(w);
      trigAnchor = { x: p.x, y: p.y };
      leftTrigDrag = true;
    } else if (tool === "select" && selectTarget === "trigger") {
      // drag-move: the whole trigger or one of its corner diamonds
      const hit = pickAt(w.x, w.y, "trigger");
      if (hit) {
        const tr0 = mapData.triggers.find(t2 => t2.id === hit.id);
        selDrag = { kind: "trigger", id: hit.id, corner: hit.corner || null, sx: w.x, sy: w.y,
          x1: tr0 ? tr0.x1 : 0, y1: tr0 ? tr0.y1 : 0, x2: tr0 ? tr0.x2 : 0, y2: tr0 ? tr0.y2 : 0 };
      }
      onLeftClick(snapPoint(w), e);
} else if (tool === "select") {
      // LMB drag of the selection and of lift floors
      const hit = pickAt(w.x, w.y, selectTarget);
      if (hit && !shiftHeld && isInSelection(hit)) {
        // click on an already selected object: first give it a chance to drill inside —
        // the same click may select a smaller sector under the cursor (drill),
        // and only if the selection stayed confirmed (unchanged) — we drag the group
        onLeftClick(snapPoint(w), e);
        const hitA = pickAt(w.x, w.y, selectTarget);
        if (hitA && !shiftHeld && isInSelection(hitA)) {
          selDrag = { kind: "group", sx: w.x, sy: w.y, ox: 0, oy: 0 };
        }
      } else if (hit && hit.kind === "floor") {
        // phantom floor: dragging
        const lf = liftFloorByKey(hit.id);
        if (lf) {
          const fl = lf.L.floors[lf.fi];
          selDrag = { kind: "floor", L: lf.L, fi: lf.fi, fx: fl.x, fy: fl.y, sx: w.x, sy: w.y };
        }
        onLeftClick(snapPoint(w), e);
      } else {
        onLeftClick(snapPoint(w), e);
        // after the click the selected object can be dragged right away too
        const hit2 = pickAt(w.x, w.y, selectTarget);
        if (hit2 && !shiftHeld && isInSelection(hit2)) {
          selDrag = { kind: "group", sx: w.x, sy: w.y, ox: 0, oy: 0 };
        }
      }
    } else {
      onLeftClick(snapPoint(w), e);
    }
  }

  if (e.button === 2) {
    if (texMode()) {
      // textures: the right button both pans (drag) and picks the sprite under the
      // cursor (click) — no rectangle, no properties menu here
      e.preventDefault();
      dragging = true;
      rmbDown = { x: lastMouse.x, y: lastMouse.y, w: w, moved: false };
      return;
    }
    // RMB drag = rectangular selection in ANY tool; without movement — context menu
    rightDrag = true;
    rectSel = { sx: w.x, sy: w.y, ex: w.x, ey: w.y };
    rectPreview = null;
    e.preventDefault();
  }
});

canvas.addEventListener("mousemove", e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const w = screenToWorld(mx, my);
  const p = snapPoint(w);
  preview = { x: p.x, y: p.y };
  // a press that slides a few pixels is a pan, not a click (middle and right buttons)
  if (mmbDown && (Math.abs(mx - mmbDown.x) > 4 || Math.abs(my - mmbDown.y) > 4)) mmbDown.moved = true;
  if (rmbDown && (Math.abs(mx - rmbDown.x) > 4 || Math.abs(my - rmbDown.y) > 4)) rmbDown.moved = true;

  document.getElementById("cx").textContent = Math.round(w.x);
  document.getElementById("cy").textContent = Math.round(w.y);
  const cu = Math.round(w.x/GRID_SIZE) + "," + Math.round(w.y/GRID_SIZE);
  document.getElementById("cu").textContent = cu;

  // highlight the line/point under the cursor for the current tool
  if (tool === "connect" || (tool === "select" && selectTarget === "line")) {
    const hl = findLineNear(w.x, w.y);
    hoverLine = hl ? hl.id : null;
  } else {
    hoverLine = null;
  }
  if (tool === "line" || tool === "sector" || tool === "point" || tool === "select") {
    const hv = findVertex(w.x, w.y);
    hoverVertex = hv ? hv.id : null;
  }

  // floor-to-creature bind mode: the target under the cursor and the crosshair cursor
  if (pendingFloorBind) {
    const t = pickBindThing(w.x, w.y);
    bindTargetThing = t ? t.uid : null;
  } else {
    bindTargetThing = null;
  }
  updateCursor();
  // hovering THE SELECTED sprite: its outline says "stretch me", its body says "carry me";
  // other sprites show no affordance — the right button is the one that picks
  if (texMode() && !leftBtnDown && !dragging && texSel != null) {
    const locC = texFindStamp(texSel);
    if (locC && locC.L.visible !== false) {
      const dC = texStampEdgeDir(locC.it, w.x, w.y);
      if (dC) {
        const curs = { e: "ew-resize", w: "ew-resize", n: "ns-resize", s: "ns-resize",
                       nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };
        canvas.style.cursor = curs[dC] || "default";
      } else if (texStampBoxHit(locC.it, w.x, w.y)) {
        canvas.style.cursor = "move";
      }
    }
  }

  if (rightDrag && rectSel) {
    rectSel.ex = w.x;
    rectSel.ey = w.y;
    // live preview: everything inside the rectangle is highlighted at once (like in Photoshop)
    const ddx = rectSel.ex - rectSel.sx, ddy = rectSel.ey - rectSel.sy;
    rectPreview = (ddx*ddx + ddy*ddy) > 6 ? rectSelection(rectSel) : null;
    hudText = rectPreview ? tr("rect_in_box", rectPreview.length) : "";
  }

  if (texWorldDrag && leftBtnDown) {
    const p = snapPoint(w);
    texWorldDrag.ex = p.x;
    texWorldDrag.ey = p.y;
    hudText = Math.abs(texWorldDrag.ex - texWorldDrag.sx) + " × " + Math.abs(texWorldDrag.ey - texWorldDrag.sy);
  }

  // moving or resizing a selected world rectangle (press its edge, drag, release)
  if (texRectDrag && leftBtnDown) {
    const loc = texFindWorld(texRectDrag.id);
    if (loc) {
      const r = loc.rect, d = texRectDrag;
      if (d.mode === "move") {
        r.x = Math.round(d.x0 + snapDelta(w.x, d.sx));
        r.y = Math.round(d.y0 + snapDelta(w.y, d.sy));
      } else {
        let x0 = d.x0, y0 = d.y0, x1 = d.x0 + d.w0, y1 = d.y0 + d.h0;
        const dx = w.x - d.sx, dy = w.y - d.sy;
        if (d.dir.indexOf("w") >= 0) x0 = Math.min(x0 + dx, x1 - 1);
        else if (d.dir.indexOf("e") >= 0) x1 = Math.max(x1 + dx, x0 + 1);
        if (d.dir.indexOf("n") >= 0) y0 = Math.min(y0 + dy, y1 - 1);
        else if (d.dir.indexOf("s") >= 0) y1 = Math.max(y1 + dy, y0 + 1);
        r.x = Math.round(x0); r.y = Math.round(y0);
        r.w = Math.round(x1 - x0); r.h = Math.round(y1 - y0);
      }
      hudText = Math.round(r.w) + " × " + Math.round(r.h);
      saveMapSoon();
    }
  }

  // stretching a sprite's outline: the window grows by whole pixels and the source
  // repeats inside it — one sprite, one layer, no copies ever appear
  if (texEdgeDrag && leftBtnDown) {
    const loc = texFindStamp(texEdgeDrag.id);
    if (loc) {
      const d = texEdgeDrag, it = loc.it;
      const dx = Math.round((w.x - d.sx) / TEX_PX);
      const dy = Math.round((w.y - d.sy) / TEX_PX);
      let x0 = d.x0, y0 = d.y0, pw = d.pw0, ph = d.ph0;
      if (d.dir.indexOf("w") >= 0) { x0 = d.x0 + dx * TEX_PX; pw = d.pw0 - dx; }
      if (d.dir.indexOf("e") >= 0) { pw = d.pw0 + dx; }
      if (d.dir.indexOf("n") >= 0) { y0 = d.y0 + dy * TEX_PX; ph = d.ph0 - dy; }
      if (d.dir.indexOf("s") >= 0) { ph = d.ph0 + dy; }
      if (pw < 1) { if (d.dir.indexOf("w") >= 0) x0 = d.x0 + (d.pw0 - 1) * TEX_PX; pw = 1; }
      if (ph < 1) { if (d.dir.indexOf("n") >= 0) y0 = d.y0 + (d.ph0 - 1) * TEX_PX; ph = 1; }
      it.x = x0; it.y = y0; it.pw = pw; it.ph = ph;
      _texSig = null;
      hudText = pw + " × " + ph;
      updateHud();
      drawSoon();
    }
  }

  // dragging a selected sprite: every selected layer travels together, snapped to pixels
  if (texStampDrag && leftBtnDown) {
    const d = texStampDrag;
    const ddx = Math.round((w.x - d.sx) / TEX_PX) * TEX_PX;
    const ddy = Math.round((w.y - d.sy) / TEX_PX) * TEX_PX;
    if (ddx || ddy) {
      d.moved = true;
      for (const e2 of d.items) { e2.it.x = e2.x + ddx; e2.it.y = e2.y + ddy; }
      _texSig = null;
      hudText = Math.round(ddx / TEX_PX) + ", " + Math.round(ddy / TEX_PX);
      updateHud();
      drawSoon();
    }
  }

  if (selDrag && leftBtnDown) {
    if (selDrag.kind === "trigger") {
      const tr = mapData.triggers.find(t2 => t2.id === selDrag.id);
      if (tr) {
        // movement is snapped to the grid (Shift = 1 unit at a time)
        const dx = snapDelta(w.x, selDrag.sx), dy = snapDelta(w.y, selDrag.sy);
        if (selDrag.corner === "tl") { tr.x1 = selDrag.x1 + dx; tr.y1 = selDrag.y1 + dy; }
        else if (selDrag.corner === "br") { tr.x2 = selDrag.x2 + dx; tr.y2 = selDrag.y2 + dy; }
        else { tr.x1 = selDrag.x1 + dx; tr.y1 = selDrag.y1 + dy; tr.x2 = selDrag.x2 + dx; tr.y2 = selDrag.y2 + dy; }
      }
    } else if (selDrag.kind === "floor") {
      const fl = selDrag.L.floors[selDrag.fi];
      if (fl) {
        fl.x = selDrag.fx + snapDelta(w.x, selDrag.sx);
        fl.y = selDrag.fy + snapDelta(w.y, selDrag.sy);
      }
    } else if (selDrag.kind === "group") {
      // dragging the whole selection by MOVE_STEP (or 1 while Shift is held)
      const step = dragStep();
      const nx = Math.round((w.x - selDrag.sx) / step) * step;
      const ny = Math.round((w.y - selDrag.sy) / step) * step;
      const dx = nx - selDrag.ox, dy = ny - selDrag.oy;
      if (dx || dy) {
        moveSelection(dx, dy);
        selDrag.ox = nx; selDrag.oy = ny;
        saveMapSoon();   // one autosave per burst instead of one per mouse tick
      }
    }
  }

  if (dragging) {
    const dx = mx-lastMouse.x, dy = my-lastMouse.y;
    cam.x -= dx/cam.zoom;
    cam.y -= dy/cam.zoom;
    lastMouse = { x: mx, y: my };
  }
  drawSoon();
});

// One press — drag — release gesture on a texture rectangle: moving keeps it where it was
// left, and a drag on empty ground lays a new rectangle (a plain click lays nothing).
function finishTexDrag() {
  if (texEdgeDrag) {
    // stretching is applied live, pixel by pixel — there is nothing left to commit
    texEdgeDrag = null;
    _texSig = null;
    saveMap();
    draw();
    return true;
  }
  if (texStampDrag) {
    const moved = !!texStampDrag.moved;
    texStampDrag = null;
    _texSig = null;
    if (moved) saveMap();
    draw();
    return moved;
  }
  if (texRectDrag) {
    texRectDrag = null;
    _texSig = null;
    saveMap();
    draw();
    return true;
  }
  if (texWorldDrag) {
    const d = texWorldDrag;
    texWorldDrag = null;
    if (Math.abs(d.ex - d.sx) >= GRID_SIZE / 2 && Math.abs(d.ey - d.sy) >= GRID_SIZE / 2) {
      texAddWorldRect(d.sx, d.sy, d.ex, d.ey);
    } else {
      draw();
    }
    return true;
  }
  return false;
}
// The pointer can leave the canvas before the button comes up — the gesture still has to
// end where it was released, so the very same finaliser listens on the document too.
document.addEventListener("mouseup", e => {
  if (e.button !== 0 || !texMode()) return;
  if (!finishTexDrag()) return;
  snapDrop();
  leftBtnDown = false;
  histCommit();
});
// the hand tool may be released outside the window — end the pan wherever the button comes up
document.addEventListener("mouseup", e => {
  if (e.button === 1) mmbDown = null;
  if (e.button === 2) { rmbDown = null; if (texMode()) dragging = false; }
  if (dragging && e.button !== 2) {
    dragging = false;
    if (typeof updateCursor === "function") updateCursor();
  }
});

// textures: ONE middle click picks the innermost sector under the cursor (nested ones
// included); the SECOND click inside the sector that is already current drops the brush
// there; empty ground closes the current sector.
function texMiddleClick(w) {
  const sec = pickInnermostSector(w.x, w.y);
  if (!sec) {
    if (texHasSector()) { sel.sector = null; texClearCtx(); updateHud(); }
    return;
  }
  if (texCtxSector === sec.id) {
    if (texRegionHas()) texPlaceStamp(w.x, w.y);
    else { hudText = tr("tex_need_region"); updateHud(); }
    return;
  }
  texSetCtx(sec.id);
}

canvas.addEventListener("mouseup", e => {
  if (e.button === 1 || (e.button === 0 && dragging)) dragging = false;

  if (e.button === 1 && mmbDown) {
    // a middle click without a drag: select the sector / drop the brush in tex mode
    const g = mmbDown; mmbDown = null;
    if (!g.moved && texMode()) texMiddleClick(g.w);
  }

  if (e.button === 0) {
    if (leftBoxDrag && boxAnchor) {
      const cur = preview ? { x: preview.x, y: preview.y } : { x: boxAnchor.x, y: boxAnchor.y };
      const moved = Math.abs(cur.x - boxAnchor.x) + Math.abs(cur.y - boxAnchor.y) > 1;
      if (!moved) {
        // click without dragging on a sector — select it right away
        pickByTarget(boxAnchor.x, boxAnchor.y, "sector");
        selLift = null;
        updateThingPanel();
        updateHud();
      } else {
        createBoxSector(boxAnchor, cur, tool === "boxsmooth");
      }
      boxAnchor = null;
      leftBoxDrag = false;
      // box/smooth are one-shot: after use, return to the previous tool
      if (tool === "box" || tool === "boxsmooth") setTool(prevBoxTool || "point");
    } else if (leftTrigDrag && trigAnchor) {
      const cur = preview ? { x: preview.x, y: preview.y } : { x: trigAnchor.x, y: trigAnchor.y };
      const moved = Math.abs(cur.x - trigAnchor.x) + Math.abs(cur.y - trigAnchor.y) > 1;
      if (moved) {
        createTrigger(trigAnchor, cur);
      } else {
        pickByTarget(trigAnchor.x, trigAnchor.y, "trigger");
        updateTriggerPanel();
      }
      trigAnchor = null;
      leftTrigDrag = false;
    } else if (texRectDrag || texWorldDrag || texEdgeDrag || texStampDrag) {
      finishTexDrag();
    }
    snapDrop();
    leftBtnDown = false;
    histCommit(); // end of gesture: if something changed — a step was added
  }

  if (selDrag) {
    selDrag = null;
    leftBtnDown = false;
  }

  if (e.button === 2) {
    if (texMode()) {
      // a right press without a slide: walk one step down the sprite stack under the
      // cursor (or drop the sprite selection on empty ground)
      const g2 = rmbDown; rmbDown = null;
      dragging = false;
      if (g2 && !g2.moved) texPickCycle(g2.w.x, g2.w.y, e.shiftKey);
      if (typeof updateCursor === "function") updateCursor();
    } else if (rightDrag && rectSel) {
      const dx = rectSel.ex - rectSel.sx, dy = rectSel.ey - rectSel.sy;
      const isDrag = (dx*dx + dy*dy) > 6;
      const rect = canvas.getBoundingClientRect();
      const wc = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      if (tildeHeld && isDrag && !texMode()) {
        // tilde + RMB drag — deletion (as before)
        histPush();
        deleteInsideRect(rectSel);
      } else if (isDrag) {
        // RMB drag — select everything inside the rectangle (any tool).
        // One gesture: hold → drag → release. A second press is not needed.
        selectInsideRect(rectSel);
      } else if (tool === "lift" && !texMode()) {
        // RMB in the 'Lift' tool: on empty ground or someone else's sector — add a floor at this point
        const lift2 = mapData.lifts.find(L => L.sectorId === selLift);
        const hitSec = pickSectorAt(wc.x, wc.y);
        if (lift2 && (!hitSec || hitSec.id !== selLift)) {
          histPush();
          const nm = String(lift2.floors.length + 1);
          lift2.floors.push({ name: nm, x: snapGrid(wc.x), y: snapGrid(wc.y) });
          selLiftFloor = lift2.floors.length - 1;
          hudText = tr("hud_floor_added_rmb", nm);
          log(tr("log_floor_added_at", lift2.id, nm, snapGrid(wc.x), snapGrid(wc.y)));
          updateLiftPanel();
          draw(); saveMap();
        } else {
          openCtxMenu(e.clientX, e.clientY, wc);
        }
      } else if (!isDrag) {
        // RMB click — object properties
        openCtxMenu(e.clientX, e.clientY, wc);
      }
    }
    rightDrag = false;
    rectSel = null;
    rectPreview = null;
  }

  updateHud();
  updateChecks();
  draw();
  saveMap();
});

canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  // world point under cursor before zoom
  const px = (mx - W/2) / cam.zoom + cam.x;
  const py = (my - H/2) / cam.zoom + cam.y;
  const factor = e.deltaY > 0 ? 1/1.1 : 1.1;
  const nz = clamp(cam.zoom*factor, CAM_ZOOM_MIN, CAM_ZOOM_MAX);
  cam.zoom = nz;
  // keep that world point fixed under cursor
  cam.x = px - (mx - W/2) / nz;
  cam.y = py - (my - H/2) / nz;
  draw();
});

// ---------- LEFT CLICK ----------
function onLeftClick(w) {
  const wx = snap(w.x), wy = snap(w.y);

  // 'bind floor to creature' mode: waiting for a click on a creature
  if (pendingFloorBind) {
    const lift = (mapData.lifts || []).find(x => x.id === pendingFloorBind.liftId);
    const isZero = pendingFloorBind.floorIndex === -1;
    const floor = isZero ? null : (lift && lift.floors[pendingFloorBind.floorIndex]);
    let bestT = null, bd = bindPickRadius();
    for (const t of mapData.things) {
      const d = Math.hypot(t.x - wx, t.y - wy);
      if (d < bd) { bd = d; bestT = t; }
    }
    if (lift && (isZero || floor) && bestT) {
      histPush();
      if (isZero) { lift.zeroEntityId = bestT.id; lift.zeroEntityType = bestT.type; }
      else { floor.entityId = bestT.id; floor.entityType = bestT.type; }
      log(isZero ? tr("log_bind_zero", lift.id, thingLabelById(bestT.id)) : tr("log_bind_floor", (floor.name || (pendingFloorBind.floorIndex + 1)), lift.id, thingLabelById(bestT.id)));
      hudText = isZero ? tr("hud_bind_zero", lift.sectorId, thingLabelById(bestT.id)) : tr("hud_bind_floor", (floor.name || (pendingFloorBind.floorIndex + 1)), thingLabelById(bestT.id));
    } else {
      hudText = tr("hud_bind_miss");
    }
    pendingFloorBind = null;
    bindTargetThing = null;
    selDrag = null;
    updateCursor();
    updateHud();
    updateLiftPanel();
    draw();
    saveMap();
    return;
  }

  switch (tool) {
    case "point":
      // click on a sector line — cut it in two (at the click point),
      // otherwise — place a free point
      if (!splitLineAt(wx, wy) && !findVertex(wx, wy)) addVertex(wx, wy);
      break;

    case "line": {
      const v = findVertex(wx, wy);
      if (!v) break;
      if (selVertices.length === 0) selVertices.push(v.id);
      else {
        const a = getV(selVertices[0]);
        if (a.id === v.id) { selVertices = []; break; }
        // avoid duplicate line
        const dup = mapData.lines.some(l => (l.a===a.id&&l.b===v.id)||(l.a===v.id&&l.b===a.id));
        if (!dup) {
          const L = { id:mapData._idc++, a:a.id, b:v.id, tex:"wall_01", flags:"0" };
          mapData.lines.push(L);
          log(tr("log_line_created", L.id, a.id, v.id));
        }
        selVertices = [];
      }
      break;
    }

    case "sector": {
      const v = findVertex(wx, wy);
      if (!v) break;
      // Clicking back on the first vertex closes the polygon
      if (selVertices.length >= 3 && v.id === selVertices[0]) {
        makeSectorFromSel();
        break;
      }
      const idx = selVertices.indexOf(v.id);
      if (idx >= 0 && idx !== 0) selVertices.splice(idx, 1);  // toggle off a middle vertex
      else if (idx === -1) selVertices.push(v.id);
      break;
    }

    case "connect": {
      const l = findLineNear(wx, wy);
      if (l) tryConnect(l.id);
      break;
    }

    case "thing": {
      const nt = tryPlaceThing(wx, wy);
      if (nt) {
        // select the freshly placed one right away — the code panel is visible without extra clicks
        multiSel = [{ kind: "thing", id: nt.uid }];
        sel.vertex = null; sel.line = null; sel.sector = null; sel.thing = nt.uid; sel.trigger = null; sel.triggerCorner = null; sel.floor = null;
        updateThingPanel();
      }
      break;
    }

    case "lift": {
      // click on a sector -> create/select a lift (phantom sector as a mirror)
      const sec = pickSectorAt(wx, wy);
      if (sec) {
        selLift = sec.id;
        if (!mapData.lifts.some(L => L.sectorId === sec.id)) {
          const newL = LiftNew(sec.id);
          (mapData.lifts = mapData.lifts || []).push(newL);
          log(tr("log_lift_created", newL.id, sec.id));
        }
        selLiftFloor = 0;
        updateLiftPanel();
        hudText = tr("hud_lift_hint");
        break;
      }
      // click on empty ground -> add a floor here (the zero floor always stays on the sector)
      const lift = mapData.lifts.find(L => L.sectorId === selLift);
      if (lift) {
        histPush();
        const nm = String(lift.floors.length + 1);
        lift.floors.push({ name: nm, x: snapGrid(wx), y: snapGrid(wy) });
        selLiftFloor = lift.floors.length - 1;
        hudText = tr("hud_floor_added", nm);
        log(tr("log_floor_added_at", lift.id, nm, Math.round(wx), Math.round(wy)));
        updateLiftPanel(); draw(); saveMap();
      }
      break;
    }

    case "select": {
      let hit = pickAt(wx, wy, selectTarget);
      if (hit) {
        if (hit.kind === "trigger" && hit.corner && !shiftHeld) {
          // single selection of a corner diamond (to resize the trigger)
          multiSel = [];
          sel.vertex = null; sel.line = null; sel.sector = null; sel.thing = null; sel.trigger = hit.id; sel.triggerCorner = hit.corner; sel.floor = null;
        } else if (shiftHeld) {
          // Shift+click — add to / remove from the multi-selection
          const idx = multiSel.findIndex(m => m.kind === hit.kind && m.id === hit.id);
          if (idx >= 0) multiSel.splice(idx, 1);
          else multiSel.push(hit);
          if (multiSel.length) {
            sel.vertex = null; sel.line = null; sel.sector = null; sel.thing = null; sel.trigger = null; sel.triggerCorner = null; sel.floor = null;
            const last = multiSel[multiSel.length - 1];
            if (last.kind === "trigger") sel.trigger = last.id;
            else sel[last.kind === "line" ? "line" : last.kind] = last.id;
          }
        } else {
          // plain click — single selection
          if (selectTarget === "sector" && hit.kind === "sector" && sel.sector === hit.id) {
            // the sector is already selected — try to drill inside: is there
            // a smaller sector entirely inside the selected one under the cursor
            const nested = pickNestedSector(wx, wy, hit.id);
            if (nested != null) hit = { kind: "sector", id: nested };
          }
          multiSel = [hit];
          sel.vertex = null; sel.line = null; sel.sector = null; sel.thing = null; sel.trigger = null; sel.triggerCorner = null; sel.floor = null;
          if (hit.kind === "trigger") sel.trigger = hit.id;
          else sel[hit.kind === "line" ? "line" : hit.kind] = hit.id;
        }
      } else {
        multiSel = [];
        sel.vertex = null; sel.line = null; sel.sector = null; sel.thing = null; sel.trigger = null; sel.triggerCorner = null; sel.floor = null;
      }
      hudText = tr("sel_count", multiSel.length);
      updateThingPanel();
      updateTriggerPanel();
      break;
    }
  }
  updateHud();
  updateChecks();
  draw();
  saveMap();
}

function makeSectorFromSel() {
  if (selVertices.length < 3) { hudText = tr("hud_need3"); return; }
  // build lines connecting the selected vertices in order
  const lineIds = [];
  for (let i=0;i<selVertices.length;i++) {
    const a = selVertices[i], b = selVertices[(i+1)%selVertices.length];
    let l = mapData.lines.find(ll => (ll.a===a&&ll.b===b)||(ll.a===b&&ll.b===a));
    if (!l) {
      l = { id:mapData._idc++, a, b, tex:"wall_01", flags:"0" };
      mapData.lines.push(l);
    }
    lineIds.push(l);
  }
  const ok = tryMakeSector(lineIds);
  if (ok) {
    const s = mapData.sectors[mapData.sectors.length - 1];
    log(tr("log_sector_from_pts", s.id, s.verts.length));
  } else {
    log(tr("log_sector_bad_pts"));
  }
  selVertices = [];
}

// ---------- RMB: CONTEXT MENU (PROPERTIES) ----------
let ctxTarget = null;  // { kind:'vertex'|'line'|'sector'|'thing'|'lift', ref:id }
let ctxEditPending = false;  // history within the RMB menu session: the first input creates a step, the rest go into it

function openCtxMenu(clientX, clientY, w) {
  if (closeCtxNextRMB) { closeCtxNextRMB = false; return; }
  if (texMode()) return;   // texture mode: the geometry properties menu does not open
  pendingFloorBind = null;
  bindTargetThing = null;
  updateCursor();
  closeCtx();
  // restore the default menu buttons (there is no Apply button anymore — everything applies immediately)
  const dlx = document.getElementById("ctmDelete");
  if (dlx) dlx.style.display = "";
  // 1) the closest creature
  let bestThing = null, bd = 14;
  for (const t of mapData.things) {
    const d = Math.hypot(t.x - w.x, t.y - w.y);
    if (d < bd) { bd = d; bestThing = t; }
  }
  if (bestThing) {
    ctxTarget = { kind: "thing", ref: bestThing.uid };
  } else {
    const floorAt = pickFloorAt(w.x, w.y);
    if (floorAt) {
      ctxTarget = floorAt;
    } else {
        const trigAt = pickAt(w.x, w.y, "trigger");
      if (trigAt) {
        ctxTarget = { kind: "trigger", ref: trigAt.id };
      } else {
        const secAt = pickInnermostSector(w.x, w.y);
        if (secAt) {
          const lift = mapData.lifts.find(L => L.sectorId === secAt.id);
          ctxTarget = lift ? { kind: "lift", ref: lift.sectorId } : { kind: "sector", ref: secAt.id };
        } else {
          const line = findLineNear(w.x, w.y, 14);
          if (line) ctxTarget = { kind: "line", ref: line.id };
          else {
            const v = findVertex(w.x, w.y, 12);
            if (v) ctxTarget = { kind: "vertex", ref: v.id };
          }
        }
      }
    }
  }
  if (!ctxTarget) return;

  renderCtx();
  const m = document.getElementById("ctm");
  m.style.display = "block";
  let px = clientX, py = clientY;
  const mw = m.offsetWidth, mh = m.offsetHeight;
  if (px + mw > innerWidth - 8) px = Math.max(8, innerWidth - mw - 8);
  if (py + mh > innerHeight - 8) py = Math.max(8, innerHeight - mh - 8);
  m.style.left = px + "px";
  m.style.top = py + "px";
}

function renderCtx() {
  const t = document.getElementById("ctmTitle");
  const b = document.getElementById("ctmBody");
  const k = ctxTarget.kind, ref = ctxTarget.ref;
  let title = "", html = "";
  if (k === "vertex") {
    const v = getV(ref); if (!v) return;
    title = tr("ctx_vertex_title", v.id);
    html = '<div class="ctmbox"><div class="muted">' + tr("ctx_coords", v.x, v.y) + '</div></div>';
  } else if (k === "line") {
    const l = getLineById(ref); if (!l) return;
    title = tr("ctx_line_title", l.id);
    const isLiftLn = isLiftLine(l.id);
    html = '<div class="ctmbox">' +
      '<div class="row"><label>' + tr("ctx_texture") + '</label><input type="text" id="ctmLex" value="' + (l.tex || "wall_01") + '"></div>' +
      '<div class="row"><label>' + tr("ctx_type") + '</label><select id="ctmLtype">' +
      '<option value="wall"' + (!l.free && l.flags !== "2" && !l.step ? ' selected' : '') + '>' + tr("ctx_opt_wall") + '</option>' +
      '<option value="free"' + (l.free ? ' selected' : '') + '>' + tr("ctx_opt_free") + '</option>' +
      (isLiftLn ? '' :
        '<option value="portal"' + (l.flags === "2" ? ' selected' : '') + '>' + tr("ctx_opt_portal") + '</option>' +
        '<option value="step"' + (l.step ? ' selected' : '') + '>' + tr("ctx_opt_step") + '</option>') +
      '</select></div>' +
      (isLiftLn ? '<div class="muted">' + tr("ctx_liftline_note") + '</div>' : '') +
      (l.flags === "2" ? '<button class="btn danger" id="ctmLDisconnect" style="margin-top:6px;width:100%">' + tr("ctx_disconnect") + '</button>' : '') +
      '</div>';
  } else if (k === "sector") {
    const s = getSector(ref); if (!s) return;
    title = tr("sector_title", s.id);
    html = '<div class="ctmbox">' +
      '<div class="row"><label>' + tr("menu_floor") + '</label><input type="text" id="ctmFloor" value="' + (s.floorTex || "floor_01") + '"></div>' +
      '<div class="row"><label>' + tr("menu_wall") + '</label><input type="text" id="ctmWall" value="' + (s.wallTex || "wall_01") + '"></div>' +
      '<div class="row"><label>' + tr("menu_height") + '</label><input type="number" id="ctmHeight" value="' + s.height + '"></div>' +
      '<label class="sw"><input type="checkbox" id="ctmStone"' + (s.stone ? ' checked' : '') + ' onclick="toggleSolid(this,true)">' +
      '<span class="swsl"></span><span class="swlabel">' + tr("sw_stone") + ' <small>' + tr("sw_stone_sml") + '</small></span></label>' +
      '<label class="sw"><input type="checkbox" id="ctmFragile"' + (s.fragile ? ' checked' : '') + ' onclick="toggleSolid(this,false)">' +
      '<span class="swsl"></span><span class="swlabel">' + tr("sw_fragile") + ' <small>' + tr("sw_fragile_sml") + '</small></span></label>' +
      '<div class="row"><label>' + tr("menu_door") + '</label><select id="ctmDoor" onchange="doorChange(this)">' +
      '<option value=""' + (s.close ? '' : ' selected') + '>' + tr("door_none") + '</option>' +
      '<option value="0"' + (s.close === "0" ? ' selected' : '') + '>' + tr("door_key0") + '</option>' +
      '<option value="1"' + (s.close === "1" ? ' selected' : '') + '>' + tr("door_key1") + '</option></select></div>' +
      '<label class="sw"><input type="checkbox" id="ctmFinish"' + (s.finish ? ' checked' : '') + ' onclick="finishChange(this)">' +
      '<span class="swsl"></span><span class="swlabel">' + tr("sw_finish") + ' <small>' + tr("sw_finish_sml") + '</small></span></label>' +
      '</div>';
  } else if (k === "thing") {
    const th = thingByUid(ref); if (!th) return;
    title = tr("thing_menu_title", th.name || "—");
    const thSec = mapData.sectors.find(s => s.id === th.sectorId);
    const cp = parseThingCode(th.id);
    const singleThing = !(multiSel.some(m => m.kind === k && m.id === ref) && multiSel.length > 1);
    // The code is only editable for a single creature: the letter separately, the number separately (+▲▼ and arrow keys)
    const codeRow = singleThing
      ? '<div class="row"><label>' + tr("lbl_code") + '</label>' +
        '<select id="ctmTletter" class="codeletter" title="' + tr("thing_letter_tt") + '">' +
        '<option value="A"' + (cp && cp.letter === "A" ? " selected" : "") + '>A</option>' +
        '<option value="B"' + (cp && cp.letter === "B" ? " selected" : "") + '>B</option>' +
        '<option value="C"' + (cp && cp.letter === "C" ? " selected" : "") + '>C</option></select>' +
        '<input type="text" id="ctmTnum" maxlength="8" inputmode="numeric" value="' + escHtml(cp ? cp.num : String(th.id == null ? "" : th.id)) + '" title="' + tr("thing_num_tt") + '">' +
        '<span class="spinbtns"><button class="spinbtn" id="ctmTnumUp" title="' + tr("thing_num_up_tt") + '">▲</button>' +
        '<button class="spinbtn" id="ctmTnumDown" title="' + tr("thing_num_down_tt") + '">▼</button></span></div>'
      : '<div class="row"><label>' + tr("lbl_code") + '</label><input type="text" disabled value="' + escHtml(th.id || "") + '"></div>' +
        '<div class="muted">' + tr("thing_multi_code") + '</div>';
    html = '<div class="ctmbox">' + codeRow +
      '<div class="row"><label>' + tr("lbl_name") + '</label><input type="text" id="ctmTname" value="' + escHtml(th.name || "") + '" maxlength="24" title="' + tr("thing_menu_name_tt") + '"></div>' +
      '<div class="muted">' + tr("ctm_pos", th.x, th.y, thSec ? "S" + thSec.id : "—") + '</div>' +
      '</div>';
  } else if (k === "trigger") {
    const trg = mapData.triggers.find(x => x.id === ref); if (!trg) return;
    title = tr("ctx_trigger_title", (trg.tid || trg.id));
    html = '<div class="ctmbox">' +
      '<div class="row"><label>' + tr("lbl_id") + '</label><input type="text" id="ctmTrigID" value="' + (trg.tid || "") + '"></div>' +
      '<div class="row"><label>' + tr("ctx_ticks") + '</label><input type="number" min="1" id="ctmTrigTicks" value="' + (trg.ticks || 5) + '"></div>' +
      '<div class="muted">' + tr("ctx_area", trg.x1, trg.y1, trg.x2, trg.y2) + '</div>' +
      '<div class="muted">' + tr("ctx_trigger_help") + '</div>' +
      '</div>';
  } else if (k === "lift") {
    const lift = mapData.lifts.find(L => L.sectorId === ref); if (!lift) return;
    const s = getSector(ref);
    title = tr("ctx_lift_title", (s ? "S" + s.id : ref));
    html = '<div class="ctmbox">' +
      '<div class="row"><label>' + tr("ctx_curve") + '</label><select id="ctmLiftCurve">' +
      '<option value="sin"' + (lift.curve === "sin" ? ' selected' : '') + '>' + tr("opt_sin") + '</option>' +
      '<option value="lin"' + (lift.curve === "lin" ? ' selected' : '') + '>' + tr("opt_lin") + '</option>' +
      '<option value="cus"' + (lift.curve === "cus" ? ' selected' : '') + '>' + tr("opt_cus") + '</option>' +
      '</select></div>' +
      '<div class="row"><label>' + tr("ctx_sec_time") + '</label><input type="number" step="0.1" min="0.1" id="ctmLiftSec" value="' + (lift.sec || 3) + '"></div>' +
      '<div style="font-size:11px;color:var(--muted)">' + tr("ctx_diag") + '</div>' +
      '<div class="curvebox"><canvas id="ctmLiftDiag" width="260" height="80"></canvas></div>' +
      '<div style="font-size:11px;color:var(--muted);margin-top:6px">' + tr("ctx_keys_calls") + '</div>' +
      (lift.zeroEntityId != null
        ? '<div style="margin:3px 0;font-size:12px">' + tr("ctx_zero_bound", thingLabelById(lift.zeroEntityId)) +
          '<button class="btn" data-bindzero="1" style="margin-left:6px;padding:2px 8px;font-size:10px">' + tr("ctx_rebind") + '</button>' +
          '<button class="btn" data-unbindzero="1" style="margin-left:2px;padding:2px 6px;font-size:10px;color:var(--danger)">' + tr("ctx_unbind") + '</button></div>'
        : '<div style="margin:3px 0;font-size:12px">' + tr("ctx_zero_unbound") +
          '<button class="btn" data-bindzero="1" style="margin-left:6px;padding:2px 8px;font-size:10px">' + tr("ctx_bind_key") + '</button></div>') +
      lift.floors.map((fl, fi) => {
        const bt = fl.entityId != null ? mapData.things.find(x => x.id === fl.entityId) : null;
        return '<div style="margin:3px 0;font-size:12px">' + tr("lift_floor_word") + ' <b>' + (fl.name || fi + 1) + '</b>' +
          (bt ? ' → <span style="color:#ffd166">' + tr("ctx_call_bound", thingLabelById(fl.entityId)) + '</span>'
             : ' → <span style="color:var(--muted)">' + tr("ctx_no_call") + '</span>') +
          '<button class="btn" data-bindfloor="' + fi + '" style="margin-left:6px;padding:2px 8px;font-size:10px">' +
          (bt ? tr("ctx_rebind_call") : tr("ctx_link_call")) + '</button>' +
          (bt ? '<button class="btn" data-unbindfloor="' + fi + '" style="margin-left:2px;padding:2px 6px;font-size:10px;color:var(--danger)">' + tr("ctx_unbind") + '</button>' : '') +
          '<button class="btn danger" data-delfloor="' + fi + '" title="' + tr("ctx_del_floor") + '" style="margin-left:4px;padding:2px 8px;font-size:10px">✕</button>' +
          '</div>';
      }).join('') +
      '<button class="btn" id="ctmLiftAddFloor" style="margin-top:8px;width:100%">' + tr("ctx_add_floor") + '</button>' +
      '<button class="btn danger" id="ctmLiftToSector" style="margin-top:6px;width:100%">' + tr("ctx_to_sector") + '</button>' +
      '</div>';
  } else if (k === "floor") {
    const lf = liftFloorByKey(ref); if (!lf) return;
    const f = lf.L.floors[lf.fi];
    const span = tr("ctx_floor_title", (f.name || (lf.fi + 1)), lf.L.id);
    const boundThing = f.entityId != null ? mapData.things.find(x => x.id === f.entityId) : null;
    title = span;
    html = '<div class="ctmbox">' +
      '<div class="row"><label>' + tr("lbl_name") + '</label><input type="text" id="ctmFloorName" maxlength="3" value="' + (f.name || "") + '"></div>' +
      '<div class="row"><label>' + tr("ctx_position") + '</label><input type="text" disabled value="' + ((f.x||0) + ' ; ' + (f.y||0)) + '"></div>' +
      '<div class="muted">' + tr("ctx_call") + ' ' + (boundThing
        ? '«' + thingLabelById(f.entityId) + '»'
        : '<i>' + tr("ctx_not_bound") + '</i>') + '</div>' +
      '<div class="muted">' + tr("ctx_call_hint") + '</div>' +
      '<button class="btn" id="ctmFloorBind" style="margin-top:8px;width:100%">' + (boundThing
        ? tr("ctx_rebind_call")
        : tr("ctx_link_call")) + '</button>' +
      (boundThing ? '<button class="btn" id="ctmFloorUnbind" style="margin-top:4px;width:100%">' + tr("ctx_unbind_call") + '</button>' : '') +
      '</div>';
  }
  const inGroup = multiSel.some(m => m.kind === k && m.id === ref) && multiSel.length > 1;
  if (inGroup) title = tr("ctm_group", title, multiSel.length - 1);
  else if (multiSel.length > 1) {
    // RMB on an object outside the group — single for now
  }
  t.textContent = title;
  b.innerHTML = html;
  // Instant apply: any field/toggle change applies immediately.
  // The first input since the menu opened creates a history step, the rest go into the same step.
  ctxEditPending = false;
  if (k === "line") {
    const lnkTex = document.getElementById("ctmLex");
    if (lnkTex) lnkTex.addEventListener("input", applyCtxImmediate);
    const lnkTy = document.getElementById("ctmLtype");
    if (lnkTy) lnkTy.addEventListener("change", applyCtxImmediate);
  } else if (k === "sector") {
    const sf = document.getElementById("ctmFloor");
    if (sf) sf.addEventListener("input", applyCtxImmediate);
    const sw = document.getElementById("ctmWall");
    if (sw) sw.addEventListener("input", applyCtxImmediate);
    const sh = document.getElementById("ctmHeight");
    if (sh) sh.addEventListener("input", applyCtxImmediate);
    const st = document.getElementById("ctmStone");
    if (st) st.addEventListener("change", applyCtxImmediate);
    const fr = document.getElementById("ctmFragile");
    if (fr) fr.addEventListener("change", applyCtxImmediate);
    const dr = document.getElementById("ctmDoor");
    if (dr) dr.addEventListener("change", applyCtxImmediate);
    const fn = document.getElementById("ctmFinish");
    if (fn) fn.addEventListener("change", applyCtxImmediate);
  } else if (k === "thing") {
    const tl2 = document.getElementById("ctmTletter");
    if (tl2) tl2.addEventListener("change", applyCtxImmediate);
    const tn3 = document.getElementById("ctmTnum");
    if (tn3) {
      tn3.addEventListener("change", applyCtxImmediate);
      tn3.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.target.blur(); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); stepCtxThing(+1); }
        if (e.key === "ArrowDown") { e.preventDefault(); stepCtxThing(-1); }
      });
    }
    const tu = document.getElementById("ctmTnumUp");
    if (tu) tu.addEventListener("click", () => stepCtxThing(+1));
    const td = document.getElementById("ctmTnumDown");
    if (td) td.addEventListener("click", () => stepCtxThing(-1));
    const tn2 = document.getElementById("ctmTname");
    if (tn2) tn2.addEventListener("input", applyCtxImmediate);
  } else if (k === "trigger") {
    const ti = document.getElementById("ctmTrigID");
    if (ti) ti.addEventListener("input", applyCtxImmediate);
    const tt3 = document.getElementById("ctmTrigTicks");
    if (tt3) tt3.addEventListener("input", applyCtxImmediate);
  } else if (k === "lift") {
    const lc = document.getElementById("ctmLiftCurve");
    if (lc) lc.addEventListener("change", applyCtxImmediate);
    const ls = document.getElementById("ctmLiftSec");
    if (ls) ls.addEventListener("input", applyCtxImmediate);
  }
  if (k === "lift") {
    redrawLiftDiagram();
    const cv2 = document.getElementById("ctmLiftCurve");
    const sec2 = document.getElementById("ctmLiftSec");
    if (cv2) cv2.addEventListener("change", redrawLiftDiagram);
    if (sec2) sec2.addEventListener("input", redrawLiftDiagram);
    const addFloor = document.getElementById("ctmLiftAddFloor");
    if (addFloor) addFloor.addEventListener("click", () => {
      histPush();
      const lift2 = mapData.lifts.find(L => L.sectorId === ctxTarget.ref);
      if (!lift2) return;
      const last = lift2.floors[lift2.floors.length-1];
      const step = liftFloorStep(lift2.sectorId);
      lift2.floors.push({ name: String(lift2.floors.length + 1), x: snapGrid(last.x||0), y: snapGrid((last.y||0) - step) });
      selLiftFloor = lift2.floors.length-1;
      selLift = lift2.sectorId;
      selectTarget = "sector";
      log(tr("log_floor_added_menu", lift2.id, lift2.floors[selLiftFloor].name));
      updateLiftPanel();
      multiSel = [];
      sel.floor = "L" + lift2.id + "@" + selLiftFloor;
      closeCtx();
      draw(); saveMap();
    });
    // bind the key to the zero floor (from the lift menu)
    document.querySelectorAll("[data-bindzero]").forEach(el => el.addEventListener("click", () => {
      const lift2 = mapData.lifts.find(L => L.sectorId === ctxTarget.ref);
      if (!lift2) return;
      pendingFloorBind = { liftId: lift2.id, floorIndex: -1 };
      closeCtx();
      hudText = tr("hud_bind_key_hint", lift2.id);
      updateCursor();
      updateHud();
    }));
    document.querySelectorAll("[data-unbindzero]").forEach(el => el.addEventListener("click", () => {
      const lift2 = mapData.lifts.find(L => L.sectorId === ctxTarget.ref);
      if (!lift2) return;
      histPush();
      delete lift2.zeroEntityId;
      delete lift2.zeroEntityType;
      updateLiftPanel();
      log(tr("log_key_unbound", lift2.id));
      renderCtx();
      draw(); saveMap();
    }));
    document.querySelectorAll("[data-bindfloor]").forEach(el => el.addEventListener("click", () => {
      const lift2 = mapData.lifts.find(L => L.sectorId === ctxTarget.ref);
      if (!lift2) return;
      const fi = parseInt(el.getAttribute("data-bindfloor"), 10);
      pendingFloorBind = { liftId: lift2.id, floorIndex: fi };
      closeCtx();
      hudText = tr("hud_bind_call_hint", (lift2.floors[fi].name || (fi + 1)));
      updateCursor();
      updateHud();
    }));
    document.querySelectorAll("[data-delfloor]").forEach(el => el.addEventListener("click", () => {
      const lift2 = mapData.lifts.find(L => L.sectorId === ctxTarget.ref);
      if (!lift2) return;
      const fi = parseInt(el.getAttribute("data-delfloor"), 10);
      if (!lift2.floors[fi]) return;
      const key = "L" + lift2.id + "@" + fi;
      histPush();
      const nm = lift2.floors[fi].name || (fi + 1);
      lift2.floors.splice(fi, 1);
      multiSel = multiSel.filter(m => !(m.kind === "floor" && m.id === key));
      if (selLift === lift2.sectorId && selLiftFloor >= lift2.floors.length) selLiftFloor = lift2.floors.length - 1;
      if (sel.floor === key) sel.floor = null;
      if (pendingFloorBind && pendingFloorBind.liftId === lift2.id && pendingFloorBind.floorIndex === fi) pendingFloorBind = null;
      updateLiftPanel();
      log(tr("log_floor_deleted", nm, lift2.id));
      renderCtx();
      draw(); saveMap();
    }));
    document.querySelectorAll("[data-unbindfloor]").forEach(el => el.addEventListener("click", () => {
      const lift2 = mapData.lifts.find(L => L.sectorId === ctxTarget.ref);
      if (!lift2) return;
      const fi = parseInt(el.getAttribute("data-unbindfloor"), 10);
      if (!lift2.floors[fi]) return;
      histPush();
      delete lift2.floors[fi].entityId;
      delete lift2.floors[fi].entityType;
      updateLiftPanel();
      log(tr("log_call_unbound", (lift2.floors[fi].name || (fi + 1)), lift2.id));
      renderCtx();
      draw(); saveMap();
    }));
    const toSectorBtn = document.getElementById("ctmLiftToSector");
    if (toSectorBtn) toSectorBtn.addEventListener("click", () => {
      const lift2 = mapData.lifts.find(L => L.sectorId === ctxTarget.ref);
      if (!lift2) return;
      histPush();
      mapData.lifts = mapData.lifts.filter(L => L.sectorId !== lift2.sectorId);
      if (selLift === lift2.sectorId) selLift = null;
      if (pendingFloorBind && pendingFloorBind.liftId === lift2.id) pendingFloorBind = null;
      multiSel = multiSel.filter(m => !(m.kind === "floor" && m.id.indexOf("L" + lift2.id + "@") === 0));
      if (sel.floor && sel.floor.indexOf("L" + lift2.id + "@") === 0) sel.floor = null;
      updateLiftPanel();
      log(tr("log_lift_to_sector", lift2.id, lift2.sectorId));
      closeCtx();
      draw(); saveMap();
    });
  }
  if (k === "line") {
    const discBtn = document.getElementById("ctmLDisconnect");
    if (discBtn) discBtn.addEventListener("click", () => {
      const l = getLineById(ctxTarget.ref); if (!l) return;
      histPush();
      unlinkLineConnects(l.id);
      closeCtx();
      draw(); saveMap();
    });
  }
  if (k === "floor") {
    const nameInp = document.getElementById("ctmFloorName");
    if (nameInp) nameInp.addEventListener("input", () => {
      const lf = liftFloorByKey(ctxTarget.ref);
      if (!lf) return;
      if (!ctxEditPending) { ctxEditPending = true; histPush(); }
      lf.L.floors[lf.fi].name = nameInp.value.slice(0, 3);
      updateLiftPanel();
      draw();
      saveMap();
    });
    const bindBtn = document.getElementById("ctmFloorBind");
    if (bindBtn) bindBtn.addEventListener("click", () => {
      const lf = liftFloorByKey(ctxTarget.ref);
      if (!lf) return;
      pendingFloorBind = { liftId: lf.L.id, floorIndex: lf.fi };
      closeCtx();
      hudText = tr("hud_bind_call_hint", (lf.L.floors[lf.fi].name || (lf.fi + 1)));
      updateCursor();
      updateHud();
    });
    const unbindBtn = document.getElementById("ctmFloorUnbind");
    if (unbindBtn) unbindBtn.addEventListener("click", () => {
      const lf = liftFloorByKey(ctxTarget.ref);
      if (!lf) return;
      histPush();
      delete lf.L.floors[lf.fi].entityId;
      delete lf.L.floors[lf.fi].entityType;
      updateLiftPanel();
      log(tr("log_call_unbound", (lf.L.floors[lf.fi].name || (lf.fi + 1)), lf.L.id));
      closeCtx();
      draw();
      saveMap();
    });
    const gotoLift = document.getElementById("ctmFloorGotoLift");
    if (gotoLift) gotoLift.addEventListener("click", () => {
      const lf = liftFloorByKey(ctxTarget.ref);
      if (!lf) return;
      ctxTarget = { kind: "lift", ref: lf.L.sectorId };
      renderCtx();
    });
  }
}

function redrawLiftDiagram() {
  const cv = document.getElementById("ctmLiftDiag");
  if (!cv) return;
  const x = cv.getContext("2d");
  const W2 = cv.width, H2 = cv.height;
  x.clearRect(0, 0, W2, H2);
  x.strokeStyle = "#2b2f3a"; x.lineWidth = 1;
  x.beginPath(); x.moveTo(0, H2 - 10); x.lineTo(W2, H2 - 10); x.moveTo(0, 10); x.lineTo(W2, 10); x.stroke();
  const mode = document.getElementById("ctmLiftCurve") ? document.getElementById("ctmLiftCurve").value : "sin";
  const n = 90;
  x.strokeStyle = "#7ad9a0"; x.lineWidth = 2; x.beginPath();
  for (let i = 0; i <= n; i++) {
    const tt = i / n;
    let y;
    if (mode === "lin") y = tt;
    else if (mode === "cus") y = tt * tt * (3 - 2 * tt);
    else y = 0.5 - 0.5 * Math.cos(tt * Math.PI);
    const px = tt * W2, py = H2 - 10 - y * (H2 - 20);
    if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
  }
  x.stroke();
}

// Stone and the fragile box are mutually exclusive: enabling one clears the other.
// Door and finish also exclude stone/the box (their own solid/zone type).
function toggleSolid(cb, isStone) {
  const other = document.getElementById(isStone ? "ctmFragile" : "ctmStone");
  if (cb.checked && other) other.checked = false;
  if (cb.checked) {
    const dr = document.getElementById("ctmDoor");
    const fi = document.getElementById("ctmFinish");
    if (dr) dr.value = "";
    if (fi) fi.checked = false;
  }
}
function doorChange(sel) {
  if (!sel.value) return;
  const st = document.getElementById("ctmStone");
  const fr = document.getElementById("ctmFragile");
  const fi = document.getElementById("ctmFinish");
  if (st) st.checked = false;
  if (fr) fr.checked = false;
  if (fi) fi.checked = false;
}
function finishChange(cb) {
  if (!cb.checked) return;
  const st = document.getElementById("ctmStone");
  const fr = document.getElementById("ctmFragile");
  const dr = document.getElementById("ctmDoor");
  if (st) st.checked = false;
  if (fr) fr.checked = false;
  if (dr) dr.value = "";
}

// apply the current context-menu field values to the target/group (without closing the menu)
function applyCtxFields() {
  const k = ctxTarget.kind, ref = ctxTarget.ref;
  // If the object is part of a multi-selection — apply the properties to the whole group
  const inGroup = multiSel.some(m => m.kind === k && m.id === ref);
  const group = inGroup && multiSel.length > 1
    ? multiSel.filter(m => m.kind === k)
    : [{ kind: k, id: ref }];

  if (k === "line") {
    const texv = document.getElementById("ctmLex").value.trim();
    const ty = document.getElementById("ctmLtype").value;
    for (const m of group) {
      const l = getLineById(m.id); if (!l) continue;
      l.tex = texv || l.tex;
      l.free = false; l.step = false;
      if (ty === "free") { l.free = true; if (l.flags === "2") unlinkLineConnects(l.id); }
      else if (ty === "portal") {
        // Lift sector lines cannot be connected: even an explicit Portal choice gives free passage
        if (isLiftLine(l.id)) { l.free = true; hudText = tr("hud_liftline_portal"); }
        else l.flags = "2";
      }
      else if (ty === "step") {
        if (isLiftLine(l.id)) { l.free = true; hudText = tr("hud_liftline_step"); }
        else { l.step = true; l.flags = "0"; }
        unlinkLineConnects(l.id);
      }
      else { if (l.flags === "2") unlinkLineConnects(l.id); l.flags = "0"; }
    }
    const l0 = getLineById(ref);
    log(tr("log_lines_props", group.length, ty, (texv || (l0 ? l0.tex : ""))));
  } else if (k === "sector") {
    const fv = document.getElementById("ctmFloor").value.trim() || "floor_01";
    const wv = document.getElementById("ctmWall").value.trim() || "wall_01";
    const hv = parseFloat(document.getElementById("ctmHeight").value) || 128;
    const sv = document.getElementById("ctmStone") ? document.getElementById("ctmStone").checked : false;
    const fv2 = document.getElementById("ctmFragile") ? document.getElementById("ctmFragile").checked : false;
    const dv = document.getElementById("ctmDoor") ? (document.getElementById("ctmDoor").value || "") : "";
    const fnv = document.getElementById("ctmFinish") ? document.getElementById("ctmFinish").checked : false;
    const mod = !!dv || fnv; // door/finish exclude stone and the box
    for (const m of group) {
      const s = getSector(m.id); if (!s) continue;
      s.floorTex = fv; s.wallTex = wv; s.height = hv;
      s.stone = sv && !mod;
      s.fragile = fv2 && !mod && !sv; // stone and the wooden box at the same time is not allowed
      s.close = dv;
      s.finish = fnv && !dv;
    }
    const mods = [sv && !mod ? tr("sw_stone") : "", fv2 && !mod && !sv ? tr("sw_fragile") : "", dv ? tr("door_set", dv) : "", fnv && !dv ? tr("sw_finish") : ""].filter(Boolean).join("+");
    log(tr("sector_apply_log", group.length, (mods || tr("door_off"))));
  } else if (k === "thing") {
    const nv = vlsSanitize(document.getElementById("ctmTname").value);
    const single = group.length === 1;
    let finalCode = null, nameChanged = false;
    for (const m of group) {
      const th = thingByUid(m.id); if (!th) continue;
      const nameBefore = th.name || "";
      if (single) {
        const lEl = document.getElementById("ctmTletter"), nEl = document.getElementById("ctmTnum");
        if (lEl && nEl) {
          const r = previewThingCode(th, lEl.value, nEl.value);
          if (!r.ok) { toast(r.msg); renderCtx(); return; }
          if (!r.same) applyThingCode(th, r.code);
        }
      }
      if (nv && nv !== nameBefore && nv !== th.name) { th.name = nv; nameChanged = true; }
      finalCode = th.id;
    }
    // The code changed → move the menu target to the new id and redraw (otherwise the menu loses its reference)
    if (finalCode != null && finalCode !== ref) { ctxTarget.ref = finalCode; renderCtx(); }
    updateThingPanel(); updateLiftPanel(); updateChecks();
    if (nameChanged) log(tr("creature_log_name_applied", nv, group.length));
  } else if (k === "trigger") {
    const trg = mapData.triggers.find(x => x.id === ref); if (!trg) return;
    trg.tid = document.getElementById("ctmTrigID").value.trim() || trg.tid;
    trg.ticks = parseInt(document.getElementById("ctmTrigTicks").value) || 5;
    log(tr("log_trigger_ticks", trg.tid, trg.id, trg.ticks));
  } else if (k === "lift") {
    const lift = mapData.lifts.find(L => L.sectorId === ref); if (!lift) return;
    lift.curve = document.getElementById("ctmLiftCurve").value;
    lift.sec = parseFloat(document.getElementById("ctmLiftSec").value) || 3;
    log(tr("log_lift_props", ref, lift.curve, lift.sec));
  }
}

// Instant apply: called on every field/toggle change.
// The first change since the menu opened creates a history step, the rest write into the same step.
function applyCtxImmediate() {
  if (!ctxEditPending) { ctxEditPending = true; histPush(); }
  applyCtxFields();
  updateChecks(); draw();
  saveMap();
}

// Step a creature's code in the open RMB menu (single only): exactly ±1. Duplicate codes are allowed.
function stepCtxThing(dir) {
  if (!ctxTarget || ctxTarget.kind !== "thing") return;
  const th = thingByUid(ctxTarget.ref);
  if (!th) return;
  stepThingCode(th, dir, document.getElementById("ctmTnum"), document.getElementById("ctmTletter"));
}

function deleteCtx() {
  histPush();
  const k = ctxTarget.kind, ref = ctxTarget.ref;
  if (k === "vertex") {
    const used = mapData.lines.some(l => l.a === ref || l.b === ref);
    if (used) { hudText = tr("hud_vertex_busy"); updateHud(); return; }
    mapData.vertices = mapData.vertices.filter(v => v.id !== ref);
    log(tr("log_vertex_deleted", ref));
  } else if (k === "line") {
    mapData.lines = mapData.lines.filter(l => l.id !== ref);
    mapData.connects = mapData.connects.filter(c => c.lineId !== ref && c.line2Id !== ref);
    pruneOrphans();
    log(tr("log_line_deleted", ref));
  } else if (k === "sector") {
    deleteSectorAndOrphans([ref]);
    if (selLift === ref) selLift = null;
    if (pendingFloorBind && pendingFloorBind.liftId === ref) pendingFloorBind = null;
    updateLiftPanel();
    log(tr("del_sector", ref) + tr("del_keep_edges"));
  } else if (k === "thing") {
    const thName = (thingByUid(ref) || {}).name || "—";
    mapData.things = mapData.things.filter(t => t.uid !== ref);
    // Lift bindings store the code, not the instance: drop them only if the code disappeared completely.
    // If such a code still exists (a duplicate id) — the binding keeps pointing at a live type.
    dropOrphanBind();
    updateThingPanel();
    if (pendingFloorBind) pendingFloorBind = null;
    log(tr("del_thing", thName));
  } else if (k === "trigger") {
    mapData.triggers = mapData.triggers.filter(t => t.id !== ref);
    if (sel.trigger === ref) { sel.trigger = null; sel.triggerCorner = null; }
    updateTriggerPanel();
    log(tr("log_trigger_deleted", ref));
  } else if (k === "lift") {
    mapData.lifts = mapData.lifts.filter(L => L.sectorId !== ref);
    if (selLift === ref) selLift = null;
    if (pendingFloorBind && pendingFloorBind.liftId === ref) pendingFloorBind = null;
    updateLiftPanel();
    log(tr("log_lift_deleted", ref));
  } else if (k === "floor") {
    const lf = liftFloorByKey(ref);
    if (lf) {
      const L = lf.L;
      const nm = L.floors[lf.fi].name || (lf.fi + 1);
      L.floors.splice(lf.fi, 1);
      multiSel = multiSel.filter(m => !(m.kind === "floor" && m.id === ref));
      if (selLift === L.sectorId && selLiftFloor >= L.floors.length) selLiftFloor = L.floors.length - 1;
      if (sel.floor === ref) sel.floor = null;
      if (pendingFloorBind && pendingFloorBind.liftId === L.id && pendingFloorBind.floorIndex === lf.fi) pendingFloorBind = null;
      updateLiftPanel();
      log(tr("log_floor_deleted", nm, L.id));
    }
  }
  closeCtx();
  bindTargetThing = null;
  updateCursor();
  updateChecks(); draw();
  saveMap();
}

function closeCtx() {
  const m = document.getElementById("ctm");
  if (m) m.style.display = "none";
  ctxTarget = null;
}

// Click/RMB outside the context menu — close it right away (no need to press a button)
let closeCtxNextRMB = false; // this RMB gesture = close, do not open a new menu
document.addEventListener("mousedown", e => {
  const m = document.getElementById("ctm");
  const wasOpen = m && m.style.display === "block";
  if (wasOpen && !m.contains(e.target)) {
    closeCtx();
    if (e.button === 2) closeCtxNextRMB = true;
  } else {
    closeCtxNextRMB = false;
  }
});
document.getElementById("ctmDelete").onclick = deleteCtx;
document.getElementById("ctmClose").onclick = closeCtx;

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}


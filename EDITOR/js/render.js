"use strict";
// VLS editor - js/render.js: drawing: grid, sectors, lines, preview
// ================= DRAWING =================
// Glyph size on screen: grows when zooming in (min. 1px, max. 4× base),
// so points/lines do not shrink when the user pushes the camera in.
function gs(base) {
  const s = base * cam.zoom;
  return Math.max(1, Math.min(s, base * 4));
}

// PIXEL ART
// While one canvas pixel is at least one screen pixel the texels stay hard-edged —
// bilinear smoothing would smear them and the art would turn to mush.
// Once the camera pulls far enough back that a texel becomes smaller than a pixel,
// hard edges would shimmer, so only then are they averaged.
function texSmooth() {
  return TEX_PX * cam.zoom < 1;
}

// Texture mode palette: the void turns light, the floors turn dark (inverted).
const TEX_VOID = "#767b85";    // outside every sector
const TEX_FLOOR = "#0d0d11";   // inside a sector
const TEX_EDGE = "#ffffff";    // sector outline and walls — readable on both
const TEX_JOIN = "#8a8a8a";    // a wall shared by two sectors / an explicit join — grey

// World-space viewport rectangle (with padding). Objects outside it are skipped.
function viewBounds(pad) {
  const vw = W / cam.zoom, vh = H / cam.zoom;
  const p = pad || 0;
  return { x0: cam.x - vw/2 - p, y0: cam.y - vh/2 - p, x1: cam.x + vw/2 + p, y1: cam.y + vh/2 + p };
}
function boxInView(v, minX, minY, maxX, maxY) {
  return maxX >= v.x0 && minX <= v.x1 && maxY >= v.y0 && minY <= v.y1;
}
function dotInView(v, x, y) {
  return x >= v.x0 && x <= v.x1 && y >= v.y0 && y <= v.y1;
}

function draw() {
  const tm = texMode();
  ctx.clearRect(0,0,W,H);
  if (tm) {
    // no grid: a flat light void instead
    ctx.fillStyle = TEX_VOID;
    ctx.fillRect(0, 0, W, H);
  } else {
    drawGrid();
  }
  if (texShowWorld()) drawTexWorld();
  if (texShowSectors()) drawSectors();
  drawTexItems();
  if (texShowWalls()) drawLines();
  if (!tm) drawPoints();
  if (!tm) drawConnects();
  drawThings();
  drawTriggers();
  if (!tm) drawLifts();
  if (!tm) drawBindPreview();
  if (!tm) drawPreview();
  drawSelection();
  drawRectSel();
  if (tm) drawTexWorldRect(); else drawBox();
  if (!tm) drawTriggerRect();
}

function drawGrid() {
  const vw = W / cam.zoom, vh = H / cam.zoom;
  const x0 = cam.x - vw/2, y0 = cam.y - vh/2;
  const x1 = cam.x + vw/2, y1 = cam.y + vh/2;

  // minor grid: 1 unit (only when zoomed enough)
  // major grid: 40 units
  ctx.lineWidth = gs(1);
  // major
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.beginPath();
  const kx = cam.zoom, ox0 = -cam.x * cam.zoom + W/2, oy0 = -cam.y * cam.zoom + H/2;
  for (let x = Math.floor(x0/GRID_SIZE)*GRID_SIZE; x <= x1; x += GRID_SIZE) {
    const sx = x * kx + ox0;
    ctx.moveTo(sx,0); ctx.lineTo(sx,H);
  }
  for (let y = Math.floor(y0/GRID_SIZE)*GRID_SIZE; y <= y1; y += GRID_SIZE) {
    const sy = y * kx + oy0;
    ctx.moveTo(0,sy); ctx.lineTo(W,sy);
  }
  ctx.stroke();

  // minor 1-unit grid when zoom large enough
  if (cam.zoom >= 3) {
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    for (let x = Math.floor(x0); x <= x1; x += 1) {
      const sx = x * kx + ox0;
      ctx.moveTo(sx,0); ctx.lineTo(sx,H);
    }
    for (let y = Math.floor(y0); y <= y1; y += 1) {
      const sy = y * kx + oy0;
      ctx.moveTo(0,sy); ctx.lineTo(W,sy);
    }
    ctx.stroke();
  }

  // axes
  ctx.strokeStyle = "rgba(200,120,60,0.5)";
  ctx.lineWidth = gs(2);
  ctx.beginPath();
  const ox = ox0, oy = oy0;
  if (ox >= 0 && ox <= W) { ctx.moveTo(ox,0); ctx.lineTo(ox,H); }
  if (oy >= 0 && oy <= H) { ctx.moveTo(0,oy); ctx.lineTo(W,oy); }
  ctx.stroke();
}

function drawSectors() {
  const pad = 8 / cam.zoom;
  const vb = viewBounds(pad);
  for (const s of mapData.sectors) {
    const poly = s.verts.map(id => getV(id)).filter(Boolean);
    if (poly.length < 3) continue;
    const offx = s.offset ? s.offset.x : 0, offy = s.offset ? s.offset.y : 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of poly) {
      const vx = v.x + offx, vy = v.y + offy;
      if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
      if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
    }
    if (!boxInView(vb, minX, minY, maxX, maxY)) continue;
    const sc = poly.map(v => worldToScreen(v.x + offx, v.y + offy));
    ctx.beginPath();
    ctx.moveTo(sc[0].x, sc[0].y);
    for (let i=1;i<sc.length;i++) ctx.lineTo(sc[i].x, sc[i].y);
    ctx.closePath();
    if (texMode()) {
      // texture mode: every floor is dark, no property hatching
      ctx.fillStyle = TEX_FLOOR;
      ctx.fill();
    } else if (s.stone) {
      hatchSector(ctx, sc, "rgba(60,64,80,0.45)", "rgba(255,255,255,0.4)", gs(14), gs(5));
    } else if (s.close) {
      // closed door: orange fill and vertical bars
      hatchSector(ctx, sc, "rgba(140,74,20,0.5)", "rgba(255,176,92,0.6)", gs(16), gs(5));
    } else if (s.finish) {
      // level end: green fill with diamonds
      hatchSector(ctx, sc, "rgba(40,120,60,0.5)", "rgba(140,255,170,0.55)", gs(18), gs(4));
    } else if (s.fragile) {
      // fragile box (wooden crate): wooden fill and wide crossbars
      hatchSector(ctx, sc, "rgba(96,62,28,0.5)", "rgba(222,176,112,0.55)", gs(16), gs(8));
    } else {
      ctx.fillStyle = "rgba(120,124,150,0.14)";   // blue-grey sector tint
      ctx.fill();
    }
    ctx.strokeStyle = texMode() ? TEX_EDGE : "rgba(122,126,150,0.8)";
    ctx.lineWidth = gs(2);
    ctx.stroke();
  }
}

function hatchSector(ctx, sc, fillColor, lineColor, step, lw) {
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const xs = sc.map(p => p.x), ys = sc.map(p => p.y);
  const minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
  const minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
  const L = Math.hypot(maxX - minX, maxY - minY) + step * 2;
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (let ox = minX - L; ox <= maxX + step; ox += step) {
    ctx.moveTo(ox, minY - L);
    ctx.lineTo(ox + L, minY + L);
  }
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(sc[0].x, sc[0].y);
  for (let i=1;i<sc.length;i++) ctx.lineTo(sc[i].x, sc[i].y);
  ctx.closePath();
}

// --- world rectangles: a constant tiled texture that belongs to the world, not to a sector ---
function drawTexWorld() {
  if (!texMode()) return;
  const d = texData();
  if (!d.world.length) return;
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = texSmooth();
  const vb = viewBounds(8 / cam.zoom);
  for (const r of d.world) {
    if (r.visible === false || !r.rw || !r.rh) continue;
    if (!boxInView(vb, r.x, r.y, r.x + r.w, r.y + r.h)) continue;
    const p = worldToScreen(r.x, r.y);
    // the selection repeats over the rectangle: 1 canvas pixel = TEX_PX world units
    const pat = ctx.createPattern(regionCanvas(r.rx, r.ry, r.rw, r.rh), "repeat");
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(cam.zoom * TEX_PX, cam.zoom * TEX_PX);
    ctx.fillStyle = pat || "#6a6f7a";
    ctx.fillRect(0, 0, r.w / TEX_PX, r.h / TEX_PX);
    ctx.restore();
    // the selected rectangle stands out so its edges can be grabbed
    const on = r.id === texSelWorld;
    if (on) drawMarquee(p.x, p.y, r.w * cam.zoom, r.h * cam.zoom);
    else {
      ctx.strokeStyle = TEX_EDGE;
      ctx.lineWidth = gs(2);
      ctx.strokeRect(p.x, p.y, r.w * cam.zoom, r.h * cam.zoom);
    }
  }
  if (texSelWorld != null) antsTick();
  ctx.imageSmoothingEnabled = smooth;
}

// the rubber-band preview while dragging a world rectangle in the void
function drawTexWorldRect() {
  if (!texWorldDrag) return;
  const x = Math.min(texWorldDrag.sx, texWorldDrag.ex), y = Math.min(texWorldDrag.sy, texWorldDrag.ey);
  const w = Math.abs(texWorldDrag.ex - texWorldDrag.sx), h = Math.abs(texWorldDrag.ey - texWorldDrag.sy);
  if (w < 1 || h < 1) return;
  const p = worldToScreen(x, y);
  // with nothing picked on the canvas yet there is nothing to tile: an outline only
  if (texRegionHas()) {
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = texSmooth();
    const pat = ctx.createPattern(regionCanvas(texRegion.x, texRegion.y, texRegion.w, texRegion.h), "repeat");
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.translate(p.x, p.y);
    ctx.scale(cam.zoom * TEX_PX, cam.zoom * TEX_PX);
    ctx.fillStyle = pat || "#6a6f7a";
    ctx.fillRect(0, 0, w / TEX_PX, h / TEX_PX);
    ctx.restore();
    ctx.imageSmoothingEnabled = smooth;
  }
  ctx.strokeStyle = TEX_EDGE;
  ctx.lineWidth = gs(2);
  ctx.strokeRect(p.x, p.y, w * cam.zoom, h * cam.zoom);
}

// --- placed sprites, per sector layer ---
// ONE SPRITE = ONE LAYER. The sprite is never scaled and never split into copies: it is a
// window of pw×ph pixels in which the source rectangle repeats itself, so pulling an edge
// just makes the window longer and the picture inside keeps repeating.
// Everything hanging outside the sector outline is clipped away — that is exactly what
// the game does with it.
function drawTexItems() {
  if (!texMode()) return;
  const d = texData();
  const dim = typeof texDimUnsel === "function" && texDimUnsel();
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = texSmooth();
  const vb = viewBounds(8 / cam.zoom);
  const selBoxes = [];
  for (const s of mapData.sectors) {
    const layers = d.sectors[String(s.id)];
    if (!Array.isArray(layers) || !layers.length) continue;
    const offx = s.offset ? s.offset.x : 0, offy = s.offset ? s.offset.y : 0;
    ctx.save();
    ctx.beginPath();
    let started = false;
    for (const vid of s.verts) {
      const v = getV(vid);
      if (!v) continue;
      const p = worldToScreen(v.x + offx, v.y + offy);
      if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
    }
    if (started) { ctx.closePath(); ctx.clip(); }
    for (const L of layers) {
      if (!L || L.visible === false || !Array.isArray(L.items)) continue;
      const on = texLayerSelected(L.id);
      if (dim && !on) ctx.globalAlpha = 0.4;
      for (const it of L.items) {
        if (!it || !it.rw || !it.rh) continue;
        const pw = it.pw > 0 ? it.pw : it.rw, ph = it.ph > 0 ? it.ph : it.rh;
        const w = pw * TEX_PX, h = ph * TEX_PX;
        const wx = it.x + offx, wy = it.y + offy;
        if (!boxInView(vb, wx, wy, wx + w, wy + h)) continue;
        const src = regionCanvas(it.rx, it.ry, it.rw, it.rh);
        const pat = ctx.createPattern(src, "repeat");
        if (!pat) continue;
        const p = worldToScreen(wx, wy);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(cam.zoom * TEX_PX, cam.zoom * TEX_PX);
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, pw, ph);
        ctx.restore();
        if (on) selBoxes.push({ x: p.x, y: p.y, w: w * cam.zoom, h: h * cam.zoom });
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  // the outlines of the selected sprites are drawn WITHOUT the clip: their handles have to
  // stay reachable even where the sprite hangs outside its sector
  if (selBoxes.length) {
    for (const b of selBoxes) drawMarquee(b.x, b.y, b.w, b.h);
    antsTick();
  }
  ctx.imageSmoothingEnabled = smooth;
}

// --- the selection marquee (Aseprite style) --------------------------------
// One screen pixel thick: it never grows with the zoom and it sits just OUTSIDE the box,
// so the edge of the picture stays fully visible. The line lives on the boundary between
// pixels and takes no pixel of the picture itself; black and white dashes alternate along
// it and creep slowly, so the border is always easy to tell from the art underneath.
let antsPhase = 0;
let antsTimer = 0;
function drawMarquee(x, y, w, h) {
  const lw = 1;
  const rx = x - lw / 2, ry = y - lw / 2, rw = w + lw, rh = h + lw;
  ctx.save();
  ctx.lineWidth = lw;
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = -antsPhase;
  ctx.strokeStyle = "#000000";
  ctx.strokeRect(rx, ry, rw, rh);
  ctx.lineDashOffset = -antsPhase - 4;
  ctx.strokeStyle = "#ffffff";
  ctx.strokeRect(rx, ry, rw, rh);
  ctx.restore();
}
// while something is selected the dashes keep moving; the chain stops by itself as soon
// as the selection is empty (no tick — no next frame)
function antsTick() {
  if (antsTimer) return;
  antsTimer = setTimeout(() => {
    antsTimer = 0;
    antsPhase = (antsPhase + 1) % 8;
    if (texMode()) draw();
  }, 90);
}

function drawLineWithPerp(a, b, flags, join) {
  const sa = worldToScreen(a.x, a.y), sb = worldToScreen(b.x, b.y);
  const tm = texMode();
  let color = TEX_EDGE;
  if (tm) {
    // in texture mode a shared wall is grey, a lone outline stays white
    if (join) color = TEX_JOIN;
  } else {
    if (flags === "2") color = "#7ad9a0";      // portal/connected (green)
    else if (flags === "ST") color = "#b8ffd8"; // lift seam (greenish)
    else color = "#ffffff";
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = gs(4);
  ctx.beginPath(); ctx.moveTo(sa.x,sa.y); ctx.lineTo(sb.x,sb.y); ctx.stroke();
  // texture mode: no flags, no direction ticks — just the wall itself
  if (tm) return;

  // perpendicular marker (like Godot)
  const mid = { x: (a.x+b.x)/2, y: (a.y+b.y)/2 };
  const dx = b.x-a.x, dy = b.y-a.y;
  const len = Math.hypot(dx,dy) || 1;
  const px = -dy/len, py = dx/len;
  const size = gs(6);
  let markerColor = "#a55d0e";   // brown for open lines
  if (flags === "1") markerColor = "#7ab07a";  // green closed
  if (flags === "2") markerColor = "#7ad9a0";  // portal
  if (flags === "F") markerColor = "#d9b34c";  // free passage (barrier, seals the sector)
  if (flags === "ST") markerColor = "#7affc0"; // step (lift seam)
  const sm = worldToScreen(mid.x, mid.y);
  ctx.strokeStyle = markerColor;
  ctx.lineWidth = gs(2);
  ctx.beginPath();
  ctx.moveTo(sm.x - px*size, sm.y - py*size);
  ctx.lineTo(sm.x + px*size, sm.y + py*size);
  ctx.stroke();
}

function drawLines() {
  // Every sector edge once per frame — the old per-line scan over all sectors was O(lines*sectors*verts).
  // edgeUse = how many sectors touch the edge; >= 2 means a wall shared by two rooms.
  const edgeUse = new Map();
  for (const s of mapData.sectors) {
    const n = s.verts.length;
    for (let i = 0; i < n; i++) {
      const k = edgeKey(s.verts[i], s.verts[(i + 1) % n]);
      edgeUse.set(k, (edgeUse.get(k) || 0) + 1);
    }
  }
  // explicit joins live in mapData.connects — a line referenced there is a connection too
  const joined = new Set();
  for (const c of (mapData.connects || [])) {
    if (c.lineId != null) joined.add(c.lineId);
    if (c.line2Id != null) joined.add(c.line2Id);
  }
  const vb = viewBounds(26 / cam.zoom);
  for (const l of mapData.lines) {
    const a = getV(l.a), b = getV(l.b);
    if (!a || !b) continue;
    if (!boxInView(vb, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))) continue;
    const flags = l.flags || "0";
    const ek = edgeKey(l.a, l.b);
    const isJoin = (flags === "2") || joined.has(l.id) || (edgeUse.get(ek) || 0) >= 2;
    // determine if closed member
    let f = flags;
    if (f === "2") { /* portal — leave the colour as-is */ }
    else {
      if (edgeUse.has(ek)) f = "1";
    }
    if (l.step) f = "ST";
    else if (l.free) f = "F";
    drawLineWithPerp(a, b, f, isJoin);
    if (f === "F" && !texMode()) drawFreeGhost(l);
  }
}
function edgeKey(a, b) { return a < b ? a + ">" + b : b + ">" + a; }

function drawPoints() {
  const vb = viewBounds(14 / cam.zoom);
  for (const v of mapData.vertices) {
    if (!dotInView(vb, v.x, v.y)) continue;
    const s = worldToScreen(v.x, v.y);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(s.x,s.y, gs(3.5), 0, 6.283); ctx.fill();
  }
}

function drawConnects() {
  const vb = viewBounds(56 / cam.zoom);
  for (const c of mapData.connects) {
    const l1 = getLineById(c.lineId);
    const l2 = getLineById(c.line2Id);
    const stepL = (l1 && l1.step) || (l2 && l2.step);
    // in the middle of the first line we draw ONE marker for the pair
    const l = l1 || l2;
    if (!l) continue;
    const a = getV(l.a), b = getV(l.b);
    if (!a || !b) continue;
    const mid = { x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
    if (!dotInView(vb, mid.x, mid.y)) continue;
    const s = worldToScreen(mid.x, mid.y);

    if (stepL) {
      // seam for a lift: bright green dot (like a normal join)
      const r = gs(10);
      ctx.strokeStyle = "#7affc0";
      ctx.lineWidth = gs(3.5);
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 6.283); ctx.stroke();
    } else {
      // normal join: one plain green dot, nothing inside
      const r = gs(11);
      ctx.strokeStyle = "#3fae7f";
      ctx.lineWidth = gs(4);
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 6.283); ctx.stroke();
    }
  }
}

// ghost dot on a free line (dashes: 2° stroke with a gap)
function drawFreeGhost(l) {
  const a = getV(l.a), b = getV(l.b);
  if (!a || !b) return;
  const mid = { x:(a.x+b.x)/2, y:(a.y+b.y)/2 };
  const s = worldToScreen(mid.x, mid.y);
  const r = gs(11);
  ctx.strokeStyle = "rgba(122,217,160,0.5)";
  ctx.lineWidth = gs(2.5);
  const seg = 2 * Math.PI / 90;      // 4° step
  const arcL = (4/360) * 6.283;       // 4° stroke
  const gapL = (2/360) * 6.283;       // 2° gap
  ctx.beginPath();
  for (let a0 = 0; a0 < 6.283; a0 += arcL + gapL) {
    ctx.arc(s.x, s.y, r, a0, Math.min(a0 + arcL, 6.283));
  }
  ctx.stroke();
}

function drawThings() {
  const tm = texMode();
  const vb = viewBounds(160 / cam.zoom);   // wide pad: the name label sticks out to the right
  for (const t of mapData.things) {
    if (!dotInView(vb, t.x, t.y)) continue;
    const s = worldToScreen(t.x, t.y);
    // small creature (diamond)
    ctx.fillStyle = "#d9b34c";
    const r = gs(3);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - r);
    ctx.lineTo(s.x + r, s.y);
    ctx.lineTo(s.x, s.y + r);
    ctx.lineTo(s.x - r, s.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(217,179,76,0.7)";
    ctx.lineWidth = gs(1);
    ctx.stroke();
    if (tm) continue;   // texture mode: no creature name labels
    ctx.fillStyle = "#fff";
    ctx.font = (gs(8)) + "px Consolas";
    ctx.fillText(t.name || t.type, s.x + r + 2, s.y - r + 6);
  }
}

// Triggers: a rectangle plus two bright diamonds at the extreme corners (that IS the two trigger corners)
function drawTriggerDiamond(x, y, chosen) {
  const s = worldToScreen(x, y);
  const r = gs(chosen ? 6 : 5);
  ctx.fillStyle = chosen ? "#66e0ff" : "#4de1ff";
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = gs(1.5);
  ctx.beginPath();
  ctx.moveTo(s.x, s.y - r); ctx.lineTo(s.x + r, s.y); ctx.lineTo(s.x, s.y + r); ctx.lineTo(s.x - r, s.y);
  ctx.closePath(); ctx.fill(); ctx.stroke();
}
function drawTriggers() {
  const vb = viewBounds(26 / cam.zoom);
  for (const t of mapData.triggers) {
    const x1 = Math.min(t.x1, t.x2), x2 = Math.max(t.x1, t.x2);
    const y1 = Math.min(t.y1, t.y2), y2 = Math.max(t.y1, t.y2);
    if (!boxInView(vb, x1, y1, x2, y2)) continue;
    const s1 = worldToScreen(x1, y1), s2 = worldToScreen(x2, y2);
    ctx.fillStyle = "rgba(77,225,255,0.10)";
    ctx.fillRect(s1.x, s1.y, s2.x - s1.x, s2.y - s1.y);
    ctx.strokeStyle = "rgba(77,225,255,0.55)";
    ctx.lineWidth = gs(1.5);
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(s1.x, s1.y, s2.x - s1.x, s2.y - s1.y);
    ctx.setLineDash([]);
    const selT = (sel.trigger === t.id);
    drawTriggerDiamond(t.x1, t.y1, selT && sel.triggerCorner === "tl");
    drawTriggerDiamond(t.x2, t.y2, selT && sel.triggerCorner === "br");
  }
}

// preview of a growing trigger ('Trigger' tool: hold LMB — you stretch the rectangle)
function drawTriggerRect() {
  if (tool !== "trigger" || !trigAnchor || !preview) return;
  const cur = { x: preview.x, y: preview.y };
  const x1 = Math.min(trigAnchor.x, cur.x), x2 = Math.max(trigAnchor.x, cur.x);
  const y1 = Math.min(trigAnchor.y, cur.y), y2 = Math.max(trigAnchor.y, cur.y);
  const s1 = worldToScreen(x1, y1), s2 = worldToScreen(x2, y2);
  ctx.fillStyle = "rgba(77,225,255,0.12)";
  ctx.fillRect(s1.x, s1.y, s2.x - s1.x, s2.y - s1.y);
  ctx.strokeStyle = "rgba(77,225,255,0.9)";
  ctx.lineWidth = gs(2);
  ctx.strokeRect(s1.x, s1.y, s2.x - s1.x, s2.y - s1.y);
  drawTriggerDiamond(x1, y1, false);
  drawTriggerDiamond(x2, y2, false);
}

function drawPreview() {
  if (!preview) return;
  const p = preview;

  // --- highlight the line/point under the cursor ---
  if (hoverLine !== null) {
    const hl = getLineById(hoverLine);
    if (hl) {
      const a = getV(hl.a), b = getV(hl.b);
      if (a && b) {
        const sa = worldToScreen(a.x,a.y), sb = worldToScreen(b.x,b.y);
        ctx.strokeStyle = "rgba(122,217,160,0.9)";
        ctx.lineWidth = gs(9);
        ctx.beginPath(); ctx.moveTo(sa.x,sa.y); ctx.lineTo(sb.x,sb.y); ctx.stroke();
      }
    }
  }
  if (hoverVertex !== null) {
    const hv = getV(hoverVertex);
    if (hv) {
      const sh = worldToScreen(hv.x, hv.y);
      ctx.strokeStyle = "rgba(76,125,217,0.9)";
      ctx.lineWidth = gs(2);
      ctx.beginPath(); ctx.arc(sh.x, sh.y, gs(7), 0, 6.283); ctx.stroke();
      ctx.fillStyle = "rgba(76,125,217,0.25)";
      ctx.fill();
    }
  }

  // --- highlight the first chosen line while joining ---
  if (tool === "connect" && pendingConnect !== null) {
    const pl = getLineById(pendingConnect);
    if (pl) {
      const a = getV(pl.a), b = getV(pl.b);
      if (a && b) {
        const sa = worldToScreen(a.x,a.y), sb = worldToScreen(b.x,b.y);
        ctx.strokeStyle = "#4c7dd9";                     // bright blue
        ctx.lineWidth = gs(9);
        ctx.beginPath(); ctx.moveTo(sa.x,sa.y); ctx.lineTo(sb.x,sb.y); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = gs(2);
        ctx.beginPath(); ctx.moveTo(sa.x,sa.y); ctx.lineTo(sb.x,sb.y); ctx.stroke();
        ctx.fillStyle = "rgba(76,125,217,0.9)";
        ctx.font = (gs(10)) + "px Consolas";
        const sm = worldToScreen((a.x+b.x)/2, (a.y+b.y)/2);
        ctx.fillText("1", sm.x + gs(6), sm.y - gs(4));
      }
    }
  }
  // hover highlight of the second line (while you pick the second one)
  // GREEN — if the line overlaps the first one (click, the join will work).
  // RED — if it does not overlap (the click will fail).
  if (tool === "connect" && pendingConnect !== null && hoverLine !== null && hoverLine !== pendingConnect) {
    const hl = getLineById(hoverLine);
    const pl = getLineById(pendingConnect);
    if (hl && pl) {
      const a = getV(hl.a), b = getV(hl.b);
      if (a && b) {
        const sa = worldToScreen(a.x,a.y), sb = worldToScreen(b.x,b.y);
        const ok = fullUncertainOverlap(pl, hl);
        if (ok) {
          ctx.strokeStyle = "rgba(122,217,160,0.95)";
          ctx.lineWidth = gs(9);
          ctx.beginPath(); ctx.moveTo(sa.x,sa.y); ctx.lineTo(sb.x,sb.y); ctx.stroke();
          ctx.fillStyle = "#7ad9a0";
          ctx.font = (gs(9)) + "px Consolas";
          const sm = worldToScreen((a.x+b.x)/2,(a.y+b.y)/2);
          ctx.fillText(tr("r_overlap_ok"), sm.x + gs(8), sm.y - gs(6));
        } else {
          ctx.strokeStyle = "rgba(255,120,120,0.85)";
          ctx.lineWidth = gs(7);
          ctx.beginPath(); ctx.moveTo(sa.x,sa.y); ctx.lineTo(sb.x,sb.y); ctx.stroke();
          ctx.fillStyle = "#ff7878";
          ctx.font = (gs(9)) + "px Consolas";
          const sm = worldToScreen((a.x+b.x)/2,(a.y+b.y)/2);
          ctx.fillText(tr("r_overlap_no"), sm.x + gs(8), sm.y - gs(6));
        }
      }
    }
  }

  if (tool === "point") {
    const s = worldToScreen(p.x, p.y);
    ctx.strokeStyle = "#7ad9a0";
    ctx.lineWidth = gs(2);
    ctx.beginPath(); ctx.arc(s.x,s.y, gs(6), 0, 6.283); ctx.stroke();
  }
  // Ghost cursor like the point tool for creator tools:
  // shows exactly where the next hover action will be applied
  if ((tool === "line" || tool === "sector" || tool === "box" || tool === "boxsmooth" || tool === "trigger") &&
      !boxAnchor && !trigAnchor) {
    const s = worldToScreen(p.x, p.y);
    const rr = gs(5);
    ctx.strokeStyle = "rgba(122,217,160,0.9)";
    ctx.lineWidth = gs(2);
    ctx.beginPath(); ctx.arc(s.x, s.y, rr, 0, 6.283); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s.x - rr - gs(3), s.y); ctx.lineTo(s.x + rr + gs(3), s.y);
    ctx.moveTo(s.x, s.y - rr - gs(3)); ctx.lineTo(s.x, s.y + rr + gs(3));
    ctx.stroke();
  }
  if (tool === "line" && selVertices.length === 1) {
    const a = getV(selVertices[0]);
    const sa = worldToScreen(a.x,a.y), sb = worldToScreen(p.x,p.y);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = gs(4);
    ctx.beginPath(); ctx.moveTo(sa.x,sa.y); ctx.lineTo(sb.x,sb.y); ctx.stroke();
  }
  if (tool === "sector") {
    // preview of current polygon being built
    if (selVertices.length > 0) {
      ctx.strokeStyle = "rgba(122,217,160,0.5)";
      ctx.lineWidth = gs(2);
      ctx.beginPath();
      for (let i=0;i<selVertices.length;i++) {
        const v = getV(selVertices[i]);
        const s = worldToScreen(v.x,v.y);
        if (i===0) ctx.moveTo(s.x,s.y); else ctx.lineTo(s.x,s.y);
      }
      const pv = worldToScreen(p.x,p.y);
      ctx.lineTo(pv.x,pv.y);
      ctx.stroke();
    }
  }
  if (tool === "thing") {
    const s = worldToScreen(p.x,p.y);
    ctx.strokeStyle = "rgba(217,179,76,0.7)";
    ctx.lineWidth = gs(2);
    const r = gs(6);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - r); ctx.lineTo(s.x + r, s.y); ctx.lineTo(s.x, s.y + r); ctx.lineTo(s.x - r, s.y); ctx.closePath();
    ctx.stroke();
  }
  if (tool === "lift") {
    const sec = pickSectorAt(p.x, p.y);
    if (sec) {
      const poly = sec.verts.map(id => getV(id)).filter(Boolean);
      const sc = poly.map(v => worldToScreen(v.x, v.y));
      ctx.strokeStyle = "rgba(76,125,217,0.8)";
      ctx.setLineDash([6,4]);
      ctx.lineWidth = gs(3);
      ctx.beginPath(); ctx.moveTo(sc[0].x, sc[0].y);
      for (let i=1;i<sc.length;i++) ctx.lineTo(sc[i].x, sc[i].y);
      ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(76,125,217,0.9)";
      ctx.font = (gs(9)) + "px Consolas";
      ctx.fillText(tr("r_lift"), worldToScreen(p.x,p.y).x, worldToScreen(p.x,p.y).y);
    }
  }
}

// RMB rectangular selection: tilde — delete, otherwise — select (works in any tool)
function drawRectSel() {
  if (!rightDrag || !rectSel) return;
  const isDel = tildeHeld;
  const isSel = !isDel;
  const x1 = Math.min(rectSel.sx, rectSel.ex), x2 = Math.max(rectSel.sx, rectSel.ex);
  const y1 = Math.min(rectSel.sy, rectSel.ey), y2 = Math.max(rectSel.sy, rectSel.ey);
  const s1 = worldToScreen(x1, y1), s2 = worldToScreen(x2, y2);
  ctx.fillStyle = isSel ? "rgba(122,217,160,0.16)" : "rgba(76,125,217,0.15)";
  ctx.fillRect(s1.x, s1.y, s2.x-s1.x, s2.y-s1.y);
  ctx.strokeStyle = isSel ? "#7ad9a0" : "#4c7dd9";
  ctx.lineWidth = gs(1.5);
  ctx.strokeRect(s1.x, s1.y, s2.x-s1.x, s2.y-s1.y);
  if (isSel && rectPreview) {
    ctx.fillStyle = "rgba(122,217,160,0.95)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(String(rectPreview.length), s1.x + 5, s1.y - 4);
  }
}

// Preview of a growing sector (rectangle/smooth)
function drawBox() {
  if (!(tool === "box" || tool === "boxsmooth") || !boxAnchor || !preview) return;
  const cur = { x: preview.x, y: preview.y };
  const x1 = Math.min(boxAnchor.x, cur.x), x2 = Math.max(boxAnchor.x, cur.x);
  const y1 = Math.min(boxAnchor.y, cur.y), y2 = Math.max(boxAnchor.y, cur.y);
  const s1 = worldToScreen(x1, y1), s2 = worldToScreen(x2, y2);
  ctx.fillStyle = "rgba(122,217,160,0.15)";
  ctx.fillRect(s1.x, s1.y, s2.x-s1.x, s2.y-s1.y);
  ctx.strokeStyle = "rgba(122,217,160,0.9)";
  ctx.lineWidth = gs(2);
  ctx.strokeRect(s1.x, s1.y, s2.x-s1.x, s2.y-s1.y);
  // preview chamfer lines for smooth corner
  if (tool === "boxsmooth") {
    const g = GRID_SIZE;
    ctx.strokeStyle = "rgba(122,217,160,0.5)";
    ctx.lineWidth = gs(1);
    const tl1 = worldToScreen(x1+g,y1), tl2 = worldToScreen(x1,y1+g);
    const tr1 = worldToScreen(x2-g,y1), tr2 = worldToScreen(x2,y1+g);
    const br1 = worldToScreen(x2,y2-g), br2 = worldToScreen(x2-g,y2);
    const bl1 = worldToScreen(x1+g,y2), bl2 = worldToScreen(x1,y2-g);
    [[tl1,tl2],[tr1,tr2],[br2,br1],[bl1,bl2]].forEach(p => {
      ctx.beginPath(); ctx.moveTo(p[0].x,p[0].y); ctx.lineTo(p[1].x,p[1].y); ctx.stroke();
    });
  }
}

function drawSelection() {
  const items = selItems();
  for (const m of items) {
    if (m.kind === "vertex") {
      const v = getV(m.id);
      if (v) {
        const s = worldToScreen(v.x, v.y);
        ctx.strokeStyle = "#4c7dd9";
        ctx.lineWidth = gs(2);
        ctx.beginPath(); ctx.arc(s.x, s.y, gs(8), 0, 6.283); ctx.stroke();
      }
    } else if (m.kind === "line") {
      const l = getLineById(m.id);
      if (l) {
        const a = getV(l.a), b = getV(l.b);
        if (a && b) {
          const sa = worldToScreen(a.x, a.y), sb = worldToScreen(b.x, b.y);
          ctx.strokeStyle = "#4c7dd9";
          ctx.lineWidth = gs(7);
          ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
        }
      }
    } else if (m.kind === "sector") {
      const s = getSector(m.id);
      if (s) {
        const poly = s.verts.map(id => getV(id)).filter(Boolean);
        const sc = poly.map(v => worldToScreen(v.x + (s.offset && s.offset.x || 0), v.y + (s.offset && s.offset.y || 0)));
        ctx.strokeStyle = "#4c7dd9";
        ctx.lineWidth = gs(3);
        ctx.beginPath(); ctx.moveTo(sc[0].x, sc[0].y);
        for (let i = 1; i < sc.length; i++) ctx.lineTo(sc[i].x, sc[i].y);
        ctx.closePath(); ctx.stroke();
      }
    } else if (m.kind === "thing") {
      const t = thingByUid(m.id);
      if (t) {
        const s = worldToScreen(t.x, t.y);
        const r = gs(5);
        ctx.strokeStyle = "#4c7dd9";
        ctx.lineWidth = gs(2);
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 6.283); ctx.stroke();
      }
    } else if (m.kind === "trigger") {
      const t = mapData.triggers.find(x => x.id === m.id);
      if (t) {
        const x1 = Math.min(t.x1, t.x2), x2 = Math.max(t.x1, t.x2);
        const y1 = Math.min(t.y1, t.y2), y2 = Math.max(t.y1, t.y2);
        const s1 = worldToScreen(x1, y1), s2 = worldToScreen(x2, y2);
        ctx.strokeStyle = "#4c7dd9";
        ctx.lineWidth = gs(2.5);
        ctx.strokeRect(s1.x, s1.y, s2.x - s1.x, s2.y - s1.y);
        drawTriggerDiamond(t.x1, t.y1, sel.triggerCorner === "tl");
        drawTriggerDiamond(t.x2, t.y2, sel.triggerCorner === "br");
      }
    } else if (m.kind === "floor") {
      const lf = liftFloorByKey(m.id);
      if (lf) {
        const sL = getSector(lf.L.sectorId);
        if (sL) {
          const poly = sL.verts.map(id => getV(id)).filter(Boolean);
          const fp = liftFloorPoly(lf.L, lf.fi, poly);
          if (fp) {
            const sc = fp.map(v => worldToScreen(v.x, v.y));
            ctx.strokeStyle = "#7ad9a0";
            ctx.lineWidth = gs(3);
            ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.moveTo(sc[0].x, sc[0].y);
            for (let i = 1; i < sc.length; i++) ctx.lineTo(sc[i].x, sc[i].y);
            ctx.closePath(); ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        const f = lf.L.floors[lf.fi];
        if (f) {
          const a = worldToScreen(f.x || 0, f.y || 0);
          ctx.fillStyle = "#7ad9a0";
          ctx.beginPath(); ctx.arc(a.x, a.y, gs(5), 0, 6.283); ctx.fill();
        }
      }
    }
  }
}

function updateHud() {
  const t = tr("hud_" + tool);
  let extra = "";
  if (tool === "sector" && selVertices.length) extra = tr("hud_pts", selVertices.length);
  if (tool === "line" && selVertices.length === 1) extra = tr("hud_click_second");
  if (pendingConnect) extra = tr("hud_pick_line2");
  if (tool === "box" || tool === "boxsmooth") extra = tr("hud_box_hint");
  if (shiftHeld) extra = tr("hud_precise");
  if (tool === "select") extra = tr("hud_target", tr("tgt_" + selectTarget));
  const hud = document.getElementById("hud");
  const base = tr("hud_base", t, extra);
  hud.textContent = hudText ? hudText + "   ·   " + base : base;
}


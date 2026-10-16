"use strict";
// VLS editor - js/lifts.js: lifts: model, floors, drawing, speed curves
// ================= LIFT =================
function pickSectorAt(wx, wy) {
  let best = null, bestDist = 12 / Math.max(cam.zoom, 0.5);
  for (const s of mapData.sectors) {
    // world bbox first: a sector further than bestDist away can neither contain the point
    // nor be close to it, so its polygon is never built or tested.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, cnt = 0;
    for (const id of s.verts) {
      const v = getV(id);
      if (!v) continue;
      cnt++;
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    if (cnt < 3) continue;
    if (wx < minX - bestDist || wx > maxX + bestDist ||
        wy < minY - bestDist || wy > maxY + bestDist) continue;
    const poly = s.verts.map(id => getV(id)).filter(Boolean);
    if (poly.length >= 3) {
      // inside the polygon
      if (pointInPoly(wx, wy, poly)) { best = s; bestDist = -1; return s; }
      // close to the border
      for (let i=0;i<poly.length;i++) {
        const a = poly[i], b = poly[(i+1)%poly.length];
        const d = pointSegDist(wx, wy, a, b);
        if (d < bestDist) { bestDist = d; best = s; }
      }
    }
  }
  return best;
}

// The deepest sector under a point (smallest by area).
// For RMB: if several nested sectors are under the cursor — take the inner one,
// not the first in the list (which may be the big outer one).
function pickInnermostSector(wx, wy) {
  let best = null, bestArea = Infinity;
  for (const s of mapData.sectors) {
    const poly = s.verts.map(id => getV(id)).filter(Boolean);
    if (poly.length < 3 || !pointInPoly(wx, wy, poly)) continue;
    const area = Math.abs(polySignedArea(poly));
    if (area < bestArea) { bestArea = area; best = s; }
  }
  return best;
}

// step height between floors = height of the lift sector
function liftFloorStep(sectorId) {
  const s = getSector(sectorId);
  return (s && s.height) || 128;
}

function LiftNew(sectorId) {
  const s = getSector(sectorId);
  const cx = s && s.verts.length ? s.verts.reduce((a,id)=>a+(getV(id)?getV(id).x:0),0)/s.verts.length : 0;
  const cy = s && s.verts.length ? s.verts.reduce((a,id)=>a+(getV(id)?getV(id).y:0),0)/s.verts.length : 0;
  const step = liftFloorStep(sectorId);
  return {
    id: mapData._idc++,
    sectorId,
    floors: [{ name: "1", x: snapGrid(cx), y: snapGrid(cy - step) }],
    curve: "sin",
    sec: 3
  };
}

// Phantom polygon of the lift floor in world coordinates (for hit tests and area)
function liftFloorPoly(L, fi, poly) {
  const f = (L.floors||[])[fi];
  if (!f || !poly || poly.length < 3) return null;
  const baseX = poly.reduce((a,v)=>a+(v.x||0),0)/poly.length;
  const baseY = poly.reduce((a,v)=>a+(v.y||0),0)/poly.length;
  const dx = f.x || 0, dy = f.y || 0;
  return poly.map(v => ({ x: (v.x||0) + dx - baseX, y: (v.y||0) + dy - baseY }));
}

// Move the lift phantom floor with the arrow keys
function moveLiftFloor(dx, dy) {
  const lift = mapData.lifts.find(L => L.sectorId === selLift);
  if (!lift) return;
  const floor = lift.floors[selLiftFloor];
  if (floor) { floor.x += dx; floor.y += dy; }
}

function drawLifts() {
  for (const L of mapData.lifts) {
    const s = getSector(L.sectorId);
    if (!s) continue;
    const poly = s.verts.map(id => getV(id)).filter(Boolean);
    if (poly.length < 3) continue;
    const baseX = poly.reduce((a,v)=>a+(v.x||0),0)/poly.length;
    const baseY = poly.reduce((a,v)=>a+(v.y||0),0)/poly.length;

    // floor polygons in world coordinates (with the offset applied)
    const floorPolys = L.floors.map(floor => {
      const dx = floor.x || 0, dy = floor.y || 0;
      return poly.map(v => ({ x: (v.x||0) + dx - baseX, y: (v.y||0) + dy - baseY }));
    });

    // route chain: sector → floor 1 → floor 2 → floor 3 → ...
    // the speed indicator and the arrow join exactly the neighbouring stops,
    // not every one with a star from the base (order: 1→2, 2→3, not 1→2 and 1→3)
    const stops = [{ x: baseX, y: baseY }];
    for (const st of L.floors) stops.push({ x: st.x || 0, y: st.y || 0 });
    for (let i = 0; i + 1 < stops.length; i++) {
      const x0 = stops[i].x, y0 = stops[i].y, x1 = stops[i+1].x, y1 = stops[i+1].y;
      const len2 = (x1-x0)*(x1-x0)+(y1-y0)*(y1-y0);
      const s0w = worldToScreen(x0, y0), s1w = worldToScreen(x1, y1);
      ctx.strokeStyle = "rgba(228,228,232,0.9)";
      ctx.lineWidth = gs(5);
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(s0w.x, s0w.y); ctx.lineTo(s1w.x, s1w.y); ctx.stroke();
      ctx.lineCap = "butt";
      if (len2 > 1) {
        const N = 60;
        ctx.lineWidth = gs(1.7);
        for (let k = 0; k < N; k++) {
          const t0 = k / N, t1 = (k + 1) / N;
          const a = liftPoint(x0, y0, x1, y1, liftEase(t0));
          const b = liftPoint(x0, y0, x1, y1, liftEase(t1));
          const sa = worldToScreen(a.x, a.y), sb = worldToScreen(b.x, b.y);
          const vm = (1 - Math.cos(TAU * (t0 + t1) / 2)) / 2;
          ctx.strokeStyle = liftSpeedColor(vm);
          ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
        }
        // the arrow at the end of the speed indicator — points to the next stop
        drawArrowHead(s0w, s1w);
      }
    }
    // the entry arrow on the sector itself — if the first floor sits right on the base,
    // so the direction to the shaft is visible
    const f0 = L.floors[0];
    if (f0 && Math.hypot((f0.x||0) - baseX, (f0.y||0) - baseY) <= 1) {
      let tx = baseX, ty = baseY;
      for (let j = 0; j < L.floors.length; j++) {
        const flj = L.floors[j];
        if (Math.hypot((flj.x||0) - baseX, (flj.y||0) - baseY) > 1) { tx = flj.x||0; ty = flj.y||0; break; }
      }
      const sc = worldToScreen(baseX, baseY), tr = worldToScreen(tx, ty);
      const dx = tr.x - sc.x, dy = tr.y - sc.y, dl = Math.hypot(dx, dy);
      if (dl > 1) drawArrow(sc, { x: sc.x + dx/dl*gs(16), y: sc.y + dy/dl*gs(16) });
    }

    floorPolys.forEach((fp, fi) => {
      // phantom sector
      const sc = fp.map(v => worldToScreen(v.x, v.y));
      const selPh = (selLift === L.sectorId && selLiftFloor === fi) || (sel.floor === "L" + L.id + "@" + fi);
      ctx.strokeStyle = selPh ? "#4c7dd9" : "rgba(76,125,217,0.55)";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = selPh ? gs(3.5) : gs(2.5);
      ctx.beginPath();
      ctx.moveTo(sc[0].x, sc[0].y);
      for (let i=1;i<sc.length;i++) ctx.lineTo(sc[i].x, sc[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      // floor label
      const cent = fp.reduce((a,v)=>({x:a.x+v.x,y:a.y+v.y}),{x:0,y:0});
      const cs = worldToScreen(cent.x/fp.length, cent.y/fp.length);
      ctx.fillStyle = selPh ? "#7ad9a0" : "rgba(122,217,160,0.8)";
      ctx.font = (gs(9)) + "px Consolas";
      ctx.fillText(tr("lift_floor_tag", (L.floors[fi].name || (fi + 1))) + (L.floors[fi].entityId != null ? " ↦ " + thingLabelById(L.floors[fi].entityId) : ""), cs.x, cs.y - gs(6));
      // snake arrow: from the sector/previous floor to the nearest line of the current one
      const fromPoly = fi === 0 ? poly : floorPolys[fi-1];
      const cp = closestSegs(fromPoly, fp);
      drawArrow(worldToScreen(cp.x1, cp.y1), worldToScreen(cp.x2, cp.y2));
    });

    // constant bind arrows: every floor/zero floor → its own call button/key
    const drawPersist = !(pendingFloorBind && pendingFloorBind.liftId === L.id);
    if (drawPersist) {
      L.floors.forEach((floor, fi) => {
        if (floor.entityId != null) {
          const a = liftFloorAnchor(L, fi), ent = mapData.things.find(x => x.id === floor.entityId);
          if (a && ent) drawBindArrow(a.x, a.y, ent.x, ent.y, "rgba(255,179,71,0.85)");
        }
      });
      if (L.zeroEntityId != null) {
        const a = liftFloorAnchor(L, -1), ent = mapData.things.find(x => x.id === L.zeroEntityId);
        if (a && ent) drawBindArrow(a.x, a.y, ent.x, ent.y, "rgba(255,179,71,0.85)");
      }
    }
  }
}

const TAU = Math.PI * 2;
// position on the path segment with the lift's S-shaped travel
function liftEase(t) { return t - Math.sin(TAU * t) / TAU; }
function liftPoint(x0, y0, x1, y1, t) { return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t }; }
// speed colour: v=0 (slow) — bright blue, v=1 (fast) — dark blue
function liftSpeedColor(v) {
  const B = [120, 232, 255], D = [14, 36, 110];
  const r = Math.round(B[0] + (D[0] - B[0]) * v);
  const g = Math.round(B[1] + (D[1] - B[1]) * v);
  const b = Math.round(B[2] + (D[2] - B[2]) * v);
  return "rgb(" + r + "," + g + "," + b + ")";
}

// closest pair of points between two polygons (along their edges)
function closestSegs(pa, pb) {
  let best = null;
  for (let i = 0; i < pa.length; i++) {
    const a = pa[i], b = pa[(i+1)%pa.length];
    for (let j = 0; j < pb.length; j++) {
      const c = pb[j], d = pb[(j+1)%pb.length];
      // closest points of two segments (approximated by 4 end→segment pairs)
      const opts = [
        [a, projSeg(a, c, d)],
        [b, projSeg(b, c, d)],
        [c, projSeg(c, a, b)],
        [d, projSeg(d, a, b)]
      ];
      for (const o of opts) {
        const dx = o[1].x - o[0].x, dy = o[1].y - o[0].y;
        const dist2 = dx*dx + dy*dy;
        if (!best || dist2 < best.d2) {
          best = { x1:o[0].x, y1:o[0].y, x2:o[1].x, y2:o[1].y, d2:dist2 };
        }
      }
    }
  }
  return best || { x1:pa[Math.floor(pa.length/2)].x, y1:pa[Math.floor(pa.length/2)].y, x2:pb[Math.floor(pb.length/2)].x, y2:pb[Math.floor(pb.length/2)].y, d2:0 };
}
function projSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  let t = ((p.x-a.x)*dx + (p.y-a.y)*dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t*dx, y: a.y + t*dy };
}

function drawArrow(from, to) {
  const f = from, t = to;
  const ang = Math.atan2(t.y - f.y, t.x - f.x);
  const len = gs(12);
  ctx.strokeStyle = "rgba(76,125,217,0.9)";
  ctx.lineWidth = gs(2);
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(t.x, t.y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#4c7dd9";
  ctx.beginPath();
  ctx.moveTo(t.x, t.y);
  ctx.lineTo(t.x - len*Math.cos(ang-0.45), t.y - len*Math.sin(ang-0.45));
  ctx.lineTo(t.x - len*Math.cos(ang+0.45), t.y - len*Math.sin(ang+0.45));
  ctx.closePath();
  ctx.fill();
}

// arrow on the tip of the speed indicator — only the head, no dashed line
function drawArrowHead(from, to) {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const len = gs(9);
  const baseX2 = to.x - len * Math.cos(ang - 0.4) * 0.5, baseY2 = to.y - len * Math.sin(ang - 0.4) * 0.5;
  ctx.fillStyle = "#4c7dd9";
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - len*Math.cos(ang-0.4), to.y - len*Math.sin(ang-0.4));
  ctx.lineTo(to.x - len*Math.cos(ang+0.4), to.y - len*Math.sin(ang+0.4));
  ctx.lineTo(baseX2, baseY2);
  ctx.closePath();
  ctx.fill();
}


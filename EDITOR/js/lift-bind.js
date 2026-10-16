"use strict";
// VLS editor - js/lift-bind.js: floor-to-thing binding, lift panel
// ================= FLOOR TO CREATURE BINDING =================
let bindTargetThing = null; // uid of the creature under the cursor in bind mode

// A lift floor binding stores the creature's CODE, not the instance: the code is a type ('what is it') and it
// may repeat. So the binding stays alive as long as at least one creature with that
// code exists. This pass drops bindings whose code is gone for good (after deleting/clearing the map).
function dropOrphanBind() {
  const alive = new Set(mapData.things.map(t => String(t.id).toUpperCase()));
  let dropped = 0;
  for (const L of (mapData.lifts || [])) {
    if (L.zeroEntityId != null && !alive.has(String(L.zeroEntityId).toUpperCase())) { delete L.zeroEntityId; delete L.zeroEntityType; dropped++; }
    for (const f of (L.floors || [])) {
      if (f.entityId != null && !alive.has(String(f.entityId).toUpperCase())) { delete f.entityId; delete f.entityType; dropped++; }
    }
  }
  return dropped > 0;
}

// miss radius when picking a creature to bind: at least ~24px on screen
function bindPickRadius() { return Math.max(16, 24 / cam.zoom); }

// creature name by id: the editor name, else the type, else the code itself
function thingLabelById(id) {
  if (id == null) return "";
  const t = mapData.things.find(x => x.id === id);
  return t ? (t.name || t.type || t.id) : "";
}

// lift floor anchor in world coordinates: fi=-1 — sector centre, else the d·floor position
function liftFloorAnchor(L, fi) {
  const s = getSector(L.sectorId);
  if (!s) return null;
  const poly = s.verts.map(id => getV(id)).filter(Boolean);
  if (poly.length < 3) return null;
  if (fi < 0) {
    return { x: poly.reduce((a,v)=>a+(v.x||0),0)/poly.length, y: poly.reduce((a,v)=>a+(v.y||0),0)/poly.length };
  }
  const f = (L.floors||[])[fi];
  if (!f) return null;
  return { x: f.x||0, y: f.y||0 };
}

// canvas cursor: bind mode — the copying drag cursor; with a target — a full cross
function updateCursor() {
  if (dragging) { canvas.style.cursor = "grabbing"; return; }
  if (spaceHeld) { canvas.style.cursor = "grab"; return; }
  if (pendingFloorBind) {
    canvas.style.cursor = bindTargetThing != null ? "crosshair" : "copy";
  } else if (typeof texMode === "function" && texMode()) {
    // texturing: crosshair until there is something to drop, copy once there is
    const ready = typeof texHasSector === "function" && texHasSector() &&
                  typeof texRegionHas === "function" && texRegionHas();
    canvas.style.cursor = ready ? "copy" : "crosshair";
  } else {
    canvas.style.cursor = tool === "select" ? "default" : "crosshair";
  }
}

// live creature under the cursor (with some slack for a miss)
function pickBindThing(wx, wy) {
  const br = bindPickRadius();
  let best = null;
  for (const t of mapData.things) {
    const d = Math.hypot(t.x - wx, t.y - wy);
    if (d < br && (!best || d < best.d)) best = t;
  }
  return best;
}

// bind arrow line: floor ⇢ creature (yellow, dashed + arrow head)
function drawBindArrow(fx, fy, tx, ty, color) {
  const a = worldToScreen(fx, fy), b = worldToScreen(tx, ty);
  ctx.strokeStyle = color;
  ctx.lineWidth = gs(2);
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.setLineDash([]);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const len = gs(11);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - len*Math.cos(ang-0.42), b.y - len*Math.sin(ang-0.42));
  ctx.lineTo(b.x - len*Math.cos(ang+0.42), b.y - len*Math.sin(ang+0.42));
  ctx.closePath();
  ctx.fill();
}

// highlight the bind target right on the canvas in drawPreview
function drawBindPreview() {
  if (!pendingFloorBind) return;
  const lift = (mapData.lifts || []).find(L => L.id === pendingFloorBind.liftId);
  const anc = lift ? liftFloorAnchor(lift, pendingFloorBind.floorIndex) : null;
  // outline the floor/sector being bound
  if (anc) {
    const sc = worldToScreen(anc.x, anc.y);
    ctx.strokeStyle = "#7ad9a0";
    ctx.lineWidth = gs(2);
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(sc.x, sc.y, gs(16), 0, 6.283); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(122,217,160,0.15)";
    ctx.beginPath(); ctx.arc(sc.x, sc.y, gs(16), 0, 6.283); ctx.fill();
    ctx.fillStyle = "#7ad9a0";
    ctx.font = (gs(10)) + "px Consolas";
    ctx.textAlign = "center";
    ctx.fillText("CLICK to pair →", sc.x, sc.y - gs(20));
    ctx.textAlign = "left";
  }
  const bt = bindTargetThing != null ? thingByUid(bindTargetThing) : null;
  if (!bt) return;
  if (anc) drawBindArrow(anc.x, anc.y, bt.x, bt.y, "rgba(122,217,160,0.95)");
  const sw = worldToScreen(bt.x, bt.y);
  ctx.strokeStyle = "#7ad9a0";
  ctx.lineWidth = gs(3);
  ctx.beginPath(); ctx.arc(sw.x, sw.y, gs(15), 0, 6.283); ctx.stroke();
  ctx.fillStyle = "rgba(122,217,160,0.2)";
  ctx.beginPath(); ctx.arc(sw.x, sw.y, gs(15), 0, 6.283); ctx.fill();
}

function updateLiftPanel() {
  const lift = mapData.lifts.find(L => L.sectorId === selLift);
  const box = document.getElementById("liftFloorList");
  if (!box) return;
  if (!lift) {
    box.innerHTML = '<div class="muted">' + tr("lift_pick_sector") + '</div>';
    return;
  }
  let html = '<div class="muted">' + tr("lift_floors_help") + '</div>';
  // the zero floor is the lift sector itself, it is not stored as a separate point
  const zeroThing = lift.zeroEntityId != null ? mapData.things.find(t => t.id === lift.zeroEntityId) : null;
  html += '<div class="liftfloor zero' + (selLiftFloor === -1 ? ' act' : '') + '" data-fi="-1" title="' + tr("lift_zero_title") + '">' +
    '<b>' + tr("lift_zero") + '</b> ' + tr("lift_zero_sector", lift.sectorId) + '' +
    (zeroThing ? ' <span class="idx">' + tr("lift_key") + ' ' + thingLabelById(lift.zeroEntityId) + '</span>' : '') +
    (zeroThing
      ? '<button class="lb" data-zunbind="1" title="' + tr("lift_unbind_key") + '" style="color:var(--danger)">✂</button>'
      : '<button class="lb" data-zbind="1" title="' + tr("lift_bind_key") + '">⊕</button>') +
    '</div>';
  lift.floors.forEach((floor, fi) => {
    const nm = (floor.name||(fi+1)) || (fi+1);
    const entTag = floor.entityId != null ? ' <span class="idx">↦ ' + thingLabelById(floor.entityId) + '</span>' : '';
    const bindTag = floor.entityId != null
      ? '<button class="lb" data-unbind="' + fi + '" title="' + tr("lift_unbind_call") + '" style="color:var(--danger)">✂</button>'
      : '<button class="lb" data-bind="' + fi + '" title="' + tr("lift_bind_call") + '">⊕</button>';
    html += '<div class="liftfloor' + (selLiftFloor===fi?' act':'') + '" data-fi="' + fi + '">' +
      tr("lift_floor_word") + ' ' +
      '<input class="lfname" maxlength="3" value="' + nm + '" data-fi="' + fi + '" title="' + tr("lift_floor_name_tt") + '"> · (' + (floor.x||0) + ',' + (floor.y||0) + ')' + entTag + bindTag +
      '<button class="lb" data-del="' + fi + '">✕</button>' + '</div>';
  });
  html += '<div class="liftbtns"><button class="btn" id="liftAddFloor">' + tr("lift_add_floor") + '</button></div>';
  box.innerHTML = html;
  box.querySelectorAll('.liftfloor').forEach(el => {
    const nmInp = el.querySelector(".lfname");
    if (nmInp) {
      nmInp.addEventListener("focus", () => histPush());
      nmInp.addEventListener("input", () => {
        const lift2 = mapData.lifts.find(L=>L.sectorId===selLift);
        if (!lift2) return;
        const f = lift2.floors[+el.dataset.fi];
        if (f) { f.name = nmInp.value.slice(0,3); draw(); saveMap(); }
      });
    }
    el.addEventListener("click", ev => {
      if (ev.target.dataset.zunbind !== undefined) {
        histPush();
        const lift2 = mapData.lifts.find(L=>L.sectorId===selLift);
        if (!lift2) return;
        delete lift2.zeroEntityId;
        delete lift2.zeroEntityType;
        log(tr("log_key_unbound", lift2.id));
        if (pendingFloorBind && pendingFloorBind.liftId === lift2.id && pendingFloorBind.floorIndex === -1) { pendingFloorBind = null; bindTargetThing = null; updateCursor(); }
        updateLiftPanel(); draw(); saveMap();
        return;
      }
      if (ev.target.dataset.zbind !== undefined) {
        const lift2 = mapData.lifts.find(L=>L.sectorId===selLift);
        if (!lift2) return;
        pendingFloorBind = { liftId: lift2.id, floorIndex: -1 };
        hudText = tr("hud_bind_key_hint_sec", lift2.sectorId);
        updateCursor();
        updateHud();
        return;
      }
      if (ev.target.dataset.unbind !== undefined) {
        histPush();
        const lift2 = mapData.lifts.find(L=>L.sectorId===selLift);
        if (!lift2) return;
        const u = +ev.target.dataset.unbind;
        if (!lift2.floors[u]) return;
        delete lift2.floors[u].entityId;
        delete lift2.floors[u].entityType;
        log(tr("log_call_unbound", (lift2.floors[u].name||(u+1)), lift2.id));
        if (pendingFloorBind && pendingFloorBind.liftId === lift2.id && pendingFloorBind.floorIndex === u) { pendingFloorBind = null; bindTargetThing = null; updateCursor(); }
        updateLiftPanel(); draw(); saveMap();
        return;
      }
      if (ev.target.dataset.bind !== undefined) {
        const lift2 = mapData.lifts.find(L=>L.sectorId===selLift);
        if (!lift2) return;
        const fi = +ev.target.dataset.bind;
        pendingFloorBind = { liftId: lift2.id, floorIndex: fi };
        hudText = tr("hud_bind_call_hint", (lift2.floors[fi].name || (fi + 1)));
        updateCursor();
        updateHud();
        return;
      }
      if (ev.target.dataset.del !== undefined || ev.target.classList.contains("lfname")) {
        if (ev.target.dataset.del !== undefined) {
          histPush();
          const lift2 = mapData.lifts.find(L=>L.sectorId===selLift);
          if (!lift2) return;
          const d = +ev.target.dataset.del;
          if (lift2.floors.length) { lift2.floors.splice(d,1); if (selLiftFloor>=lift2.floors.length) selLiftFloor=lift2.floors.length-1; log(tr("log_lift_floor_deleted", lift2.id, (d+1))); }
          updateLiftPanel(); hudText = tr("hud_floor_deleted"); draw(); saveMap(); return;
        }
        return;
      }
      selLiftFloor = +el.dataset.fi;
      updateLiftPanel(); draw();
    });
  });
  const add = document.getElementById("liftAddFloor");
  if (add) add.addEventListener("click", () => {
    histPush();
    const lift2 = mapData.lifts.find(L=>L.sectorId===selLift);
    if (!lift2) return;
    const last = lift2.floors[lift2.floors.length-1];
    const step = liftFloorStep(lift2.sectorId);
    lift2.floors.push({ name: String(lift2.floors.length + 1), x: snapGrid(last.x||0), y: snapGrid((last.y||0) - step) });
    selLiftFloor = lift2.floors.length-1;
    log(tr("log_lift_floor_added", lift2.id, lift2.floors[selLiftFloor].name));
    updateLiftPanel(); draw(); saveMap();
  });
}


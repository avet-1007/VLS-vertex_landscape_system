"use strict";
// VLS editor - js/checks.js: map validation
// ================= CHECKS / HERMETIC =================
function updateChecks() {
  warnings = [];
  const groups = getLineGroups();
  let closedOk = true;
  groups.forEach(g => {
    if (!isClosed(g)) {
      closedOk = false;
      warnings.push(tr("w_closed") +  + g.map(l=>l.a+"-"+l.b).join(", "));
    }
  });
  // every sector must be closed
  mapData.sectors.forEach(s => {
    const poly = s.verts.map(id => getV(id)).filter(Boolean);
    if (poly.length < 3 || !poly.every(v => v)) {
      warnings.push(tr("w_sector_bad", s.id));
    }
  });
  // mandatory player A000 (spawn point; legacy: ID 1 / 'Player 01')
  const hasPlayer = mapData.things.some(isPlayerThing);
  if (!hasPlayer) {
    warnings.push(tr("w_player"));
  }
  // broken creature id: format only (fixed by the ✕ button — re-issue).
  // Duplicate ids are NOT a problem: the code is a type, equal codes on different creatures are legal.
  mapData.things.forEach((t, ti) => {
    if (!isValidThingId(t.id)) {
      warnings.push(tr("w_thing_bad", escHtml(t.id), ti));
    }
  });
  // unconnected sector edges
  // (each sector should have its lines either neighbor a sector or be a portal)
  const w = document.getElementById("warnings");
  if (warnings.length) {
    w.className = "show";
    w.innerHTML = warnings.join("\n");
  } else {
    // no problems — do not show the box at all
    w.className = "";
    w.innerHTML = "";
  }
}

// ✕ buttons in the warning box: re-issue a creature with a broken id
document.getElementById("warnings").addEventListener("click", e => {
  const b = e.target.closest ? e.target.closest("[data-fixthing]") : null;
  if (!b) return;
  const t = mapData.things[+b.getAttribute("data-fixthing")];
  if (!t) return;
  histPush();
  if (resetThingCode(t)) {
    sel.thing = t.uid;
    updateThingPanel(); updateLiftPanel(); updateChecks(); draw(); saveMap();
  }
});


"use strict";
// VLS editor - js/ui.js: toolbar buttons and sidebar fields
// ================= BUTTONS =================
document.getElementById("btnResetView").onclick = () => { cam.x=0;cam.y=0;cam.zoom=1;draw(); };
document.getElementById("btnChecks").onclick = updateChecks;
document.getElementById("btnWiki").onclick = () => toast(tr("wiki_later"));

// ================= SETTINGS (language) =================
function toggleSettingsPopup() {
  const pop = document.getElementById("settingsPop");
  if (!pop) return;
  pop.hidden = !pop.hidden;
  if (!pop.hidden) {
    const se = document.getElementById("langSel");
    if (se) se.value = LANG;
    applyStaticLang();
  }
}
const settingsPop = document.getElementById("settingsPop");
const settingsClose = document.getElementById("settingsClose");
const langSel = document.getElementById("langSel");
if (settingsClose) settingsClose.onclick = () => {
  if (settingsPop) settingsPop.hidden = true;
  // a half-finished hotkey capture must not swallow keys after the popup is gone
  if (typeof keyBindCapture !== "undefined") keyBindCapture = null;
};
if (langSel) langSel.addEventListener("change", (e) => setLang(e.target.value));
document.getElementById("btnPlaceThing").onclick = () => { if (sel.sector!=null){const s=getSector(sel.sector); const poly=s.verts.map(id=>getV(id)).filter(Boolean); if(poly.length){const cx=poly.reduce((a,v)=>a+v.x,0)/poly.length; const cy=poly.reduce((a,v)=>a+v.y,0)/poly.length; histPush(); const nt=tryPlaceThing(cx,cy); if (nt) { sel.thing=nt.uid; multiSel=[{kind:"thing",id:nt.uid}]; updateThingPanel(); } hudText=tr("thing_hud_center"); } draw(); saveMap(); } else hudText=tr("need_sector"); };
document.getElementById("btnClearThings").onclick = () => { if (mapData.things.length) { histPush(); } mapData.things=[]; sel.thing=null; updateThingPanel(); draw(); log(tr("log_all_things_cleared")); saveMap(); };
document.getElementById("btnClearLog").onclick = () => {
  const el = document.getElementById("logList");
  if (el) el.innerHTML = '<div class="muted">' + tr("log_cleared") + '</div>';
};

// ================= CONNECTION MODES =================
function setConnectMode(mode) {
  connectMode = mode;
  document.querySelectorAll("#connectModes .mode").forEach(x => x.classList.toggle("active", x.dataset.mode === mode));
  const sel2 = document.getElementById("toolConnectSel");
  if (sel2 && sel2.value !== mode) sel2.value = mode;
  pendingConnect = null;
  updateHud();
}
document.querySelectorAll("#connectModes .mode").forEach(b => {
  b.addEventListener("click", () => setConnectMode(b.dataset.mode));
});
document.getElementById("toolConnectSel").addEventListener("change", (e) => setConnectMode(e.target.value));

// ================= CREATURES: CATEGORY + NUMBER (toolbar) =================
// The toolbar only has the category letter and the code number — no name here: it is edited in the RMB menu
// and in the left panel. The letter is a square button with an arrow (click expands A/B/C),
// the number is a field, stepped with ▲▼ or the keyboard arrows.
const catHidden = document.getElementById("toolThingCat");
const catBtn = document.getElementById("toolThingCatBtn");
const catMenu = document.getElementById("toolThingCatMenu");
const numInp = document.getElementById("toolThingNum");

function toolbarThingLetter() {
  return (catHidden && "ABC".indexOf(catHidden.value) >= 0) ? catHidden.value : "A";
}
// The number field always shows the next free code of the selected category
function fillToolbarThingNum() {
  if (!numInp) return;
  const nxt = nextThingId(toolbarThingLetter());
  numInp.value = nxt ? nxt.slice(1) : "";
}
function setToolbarThingLetter(l) {
  if ("ABC".indexOf(l) < 0) return;
  if (catHidden) catHidden.value = l;
  const ltr = catBtn && catBtn.querySelector(".ltr");
  if (ltr) ltr.textContent = l;
  if (catMenu) catMenu.querySelectorAll(".letopt").forEach(b => b.classList.toggle("on", b.dataset.letter === l));
  fillToolbarThingNum();
}
function setCatMenu(open) {
  if (!catMenu || !catBtn) return;
  catMenu.hidden = !open;
  catBtn.classList.toggle("open", open);
  catBtn.setAttribute("aria-expanded", open ? "true" : "false");
}
if (catBtn) catBtn.addEventListener("click", e => { e.stopPropagation(); setCatMenu(catMenu.hidden); });
if (catMenu) catMenu.querySelectorAll(".letopt").forEach(b => b.addEventListener("click", e => {
  e.stopPropagation();
  setToolbarThingLetter(b.dataset.letter);
  setCatMenu(false);
}));
document.addEventListener("click", () => setCatMenu(false));
document.addEventListener("keydown", e => { if (e.key === "Escape") setCatMenu(false); });
const numUp = document.getElementById("toolThingNumUp");
const numDown = document.getElementById("toolThingNumDown");
if (numUp) numUp.addEventListener("click", () => stepCodeNumber(numInp, toolbarThingLetter(), +1));
if (numDown) numDown.addEventListener("click", () => stepCodeNumber(numInp, toolbarThingLetter(), -1));
if (numInp) numInp.addEventListener("keydown", e => {
  if (e.key === "Enter") { e.target.blur(); return; }
  if (e.key === "ArrowUp") { e.preventDefault(); stepCodeNumber(numInp, toolbarThingLetter(), +1); }
  if (e.key === "ArrowDown") { e.preventDefault(); stepCodeNumber(numInp, toolbarThingLetter(), -1); }
});
setToolbarThingLetter(toolbarThingLetter());
document.getElementById("thingFixBtn").addEventListener("click", () => {
  const t = thingByUid(sel.thing);
  if (!t) return;
  histPush();
  if (resetThingCode(t)) {
    updateThingPanel(); updateLiftPanel(); updateChecks(); draw(); saveMap();
  }
});
document.getElementById("thingName").addEventListener("input", () => {
  const t = thingByUid(sel.thing);
  if (t) { t.name = vlsSanitize(document.getElementById("thingName").value); draw(); saveMap(); }
});
// Creature code (left panel): the letter and the number apply with a button/Enter, ▲▼ and arrows step by exactly 1
document.getElementById("thingLetter").addEventListener("change", commitThingCode);
document.getElementById("thingNum").addEventListener("change", commitThingCode);
document.getElementById("thingNum").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.target.blur(); return; }
  if (e.key === "ArrowUp") { e.preventDefault(); stepSelectedThing(+1); }
  if (e.key === "ArrowDown") { e.preventDefault(); stepSelectedThing(-1); }
});
document.getElementById("thingNumUp").addEventListener("click", () => stepSelectedThing(+1));
document.getElementById("thingNumDown").addEventListener("click", () => stepSelectedThing(-1));

// ================= TRIGGERS: SELECTED FIELDS (sidebar) =================
document.getElementById("triggerID").addEventListener("input", () => {
  if (sel.trigger != null) {
    const t = mapData.triggers.find(tr => tr.id === sel.trigger);
    if (t) { t.tid = document.getElementById("triggerID").value.trim(); draw(); saveMap(); }
  }
});
document.getElementById("triggerType").addEventListener("change", () => {
  if (sel.trigger != null) {
    const t = mapData.triggers.find(tr => tr.id === sel.trigger);
    if (t) { t.type = document.getElementById("triggerType").value; draw(); saveMap(); }
  }
});
document.getElementById("triggerTicks").addEventListener("input", () => {
  if (sel.trigger != null) {
    const t = mapData.triggers.find(tr => tr.id === sel.trigger);
    if (t) { t.ticks = parseInt(document.getElementById("triggerTicks").value) || 5; draw(); saveMap(); }
  }
});

// ================= SIDEBAR DEPARTMENTS =================
// Two departments in the left panel: geometry editing and geometry texturing.
// Texturing is a separate mode, not another geometry tool: opening it swaps the whole
// look of the map, locks every vertex-editing button and puts the editor into
// "select a sector" — leaving restores whatever was running before.
let _texPrev = null;

function setSidebarPanel(panelId) {
  const panels = document.querySelectorAll("#sidebar .panel");
  for (const p of panels) p.hidden = p.id !== panelId;
  const tabs = document.querySelectorAll("#sidebarTabs .tab");
  for (const b of tabs) b.classList.toggle("active", b.dataset.panel === panelId);

  const tm = (panelId === "panelTextures");
  document.body.classList.toggle("texmode", tm);
  if (tm) {
    if (!_texPrev) _texPrev = { tool: tool, target: selectTarget };
    setToolRaw("select");
    selectTarget = "sector";
  } else if (_texPrev) {
    const prev = _texPrev;
    _texPrev = null;
    setToolRaw(prev.tool || "point");
    selectTarget = prev.target || "vertex";
  }
  updateToolVisual();
  if (!tm) {
    // leaving texturing: the canvas goes back to the panel and no gesture survives
    if (typeof texSwapView === "function") texSwapView(false);
    texCtxSector = null; texSel = null; texSelWorld = null;
    texWorldDrag = null; texRectDrag = null; texEdgeDrag = null;
  }
  updateCursor();
  updateHud();
  // the panel only ever holds a picture of the canvas — refresh it when the tab opens
  if (tm && typeof texAtlasSnapPaint === "function") texAtlasSnapPaint();
  if (typeof refreshTexPanel === "function") refreshTexPanel();
  if (typeof draw === "function") draw();
}
(function initSidebarTabs() {
  const tabs = document.querySelectorAll("#sidebarTabs .tab");
  for (const b of tabs) b.addEventListener("click", () => setSidebarPanel(b.dataset.panel));
})();

// ================= LIFT CURVE =================
function drawCurve() {
  const cv = document.getElementById("curveCanvas");
  const x = cv.getContext("2d");
  const W2 = cv.width, H2 = cv.height;
  x.clearRect(0, 0, W2, H2);
  x.strokeStyle = "#2b2f3a";
  x.lineWidth = 1;
  x.beginPath();
  x.moveTo(0, H2 - 14); x.lineTo(W2, H2 - 14);  // baseline / position 0
  x.moveTo(0, 14);      x.lineTo(W2, 14);       // position 1
  x.stroke();
  x.strokeStyle = "#4c7dd9";
  x.lineWidth = 2;
  x.beginPath();
  const mode = document.getElementById("curveType").value;
  const n = 80;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let y;
    if (mode === "lin") y = t;
    else if (mode === "cus") y = t * t * (3 - 2 * t);
    else y = 0.5 - 0.5 * Math.cos(t * Math.PI);  // sine: 0 -> 1
    const px = t * W2;
    const py = H2 - 14 - y * (H2 - 28);
    if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
  }
  x.stroke();
}
document.getElementById("curveType").addEventListener("change", drawCurve);


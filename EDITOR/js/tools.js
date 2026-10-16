"use strict";
// VLS editor - js/tools.js: tools, toasts, cancel, hotkeys
// ================= TOOLS =================
const toolBtns = document.querySelectorAll(".tool[data-tool]");
const actionBtns = document.querySelectorAll(".tool[data-action]");
toolBtns.forEach(t => {
  t.addEventListener("click", () => setTool(t.dataset.tool));
});
actionBtns.forEach(t => {
  t.addEventListener("click", () => runAction(t.dataset.action));
});

// Tools that have no functionality yet — only locking
const DEAD_TOOLS = { texpick: "tl_texpick" };

let prevBoxTool = "point";   // what to return to after a one-shot box use

// Leave selection mode: go back to the geo tool it is attached to
function deactivateSelectTool() {
  if (tool !== "select") return;
  if (texMode()) return;   // texture mode: the selection never turns itself off
  const back = { vertex:"point", line:"line", sector:"sector", thing:"thing", trigger:"trigger" }[selectTarget] || "point";
  setToolRaw(back);
}

function setTool(t) {
  if (texMode()) return;   // texture mode: the tool is pinned to "select" — geometry tools stay out
  if (DEAD_TOOLS[t]) { toast(tr("tool_dead", tr(DEAD_TOOLS[t]))); return; }

  // Selection as a paired toggle: clicking again fully disables the selection mode
  if (t === "select") {
    if (tool === "select") {
      deactivateSelectTool();
    } else {
      if (tool === "thing") selectTarget = "thing";
      else if (tool === "point") selectTarget = "vertex";
      else if (tool === "line") selectTarget = "line";
      else if (tool === "sector" || tool === "box" || tool === "boxsmooth") selectTarget = "sector";
      else if (tool === "trigger") selectTarget = "trigger";
      setToolRaw("select");
    }
    draw();
    return;
  }

  // In selection mode a click on a point/line/sector/creature/trigger just changes the target (combo pair)
  if (tool === "select" && (t === "point" || t === "line" || t === "sector" || t === "thing" || t === "trigger")) {
    selectTarget = { point:"vertex", line:"line", sector:"sector", thing:"thing", trigger:"trigger" }[t];
    updateToolVisual();
    updateHud();
    return;
  }

  // Box/smooth are one-shot: remember the tool to return after use
  if (t === "box" || t === "boxsmooth") prevBoxTool = tool === "select" ? "point" : tool;

  setToolRaw(t);
}

function setToolRaw(t) {
  tool = t;
  toolBtns.forEach(el => el.classList.toggle("active", el.dataset.tool === t));
  if (t !== "line") selVertices = [];
  if (t !== "connect") pendingConnect = null;
  if (t !== "sector") pendingSector = null;
  hoverLine = null; hoverVertex = null;
  boxAnchor = null;
  rightDrag = false; rectSel = null; rectPreview = null;
  if (t === "point") selectTarget = "vertex";
  else if (t === "line") selectTarget = "line";
  else if (t === "sector" || t === "box" || t === "boxsmooth") selectTarget = "sector";
  else if (t === "thing") selectTarget = "thing";
  else if (t === "trigger") selectTarget = "trigger";
  updateCursor();
  updateToolVisual();
  updateHud();
}

// Shows the pair: with selection active it highlights both the geo button and the target
function updateToolVisual() {
  toolBtns.forEach(el => {
    const isActive = el.dataset.tool === tool || (tool === "select" && ({vertex:"point",line:"line",sector:"sector",thing:"thing",trigger:"trigger"}[selectTarget]) === el.dataset.tool);
    el.classList.toggle("active", isActive);
  });
}

// Top panel actions (map load/save)
function runAction(a) {
  if (a === "loadmap") document.getElementById("fileInput").click();
  else if (a === "exportmap") exportMap();
  else if (a === "settings") toggleSettingsPopup();
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "show";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = ""; }, 2000);
}
document.addEventListener("keydown", e => {
  if (e.key === "Shift") shiftHeld = true;
  if (e.code === "Backquote") tildeHeld = true;
  const c = e.code;
  // the editor runs in its own window for hours: reload has to answer to Ctrl+R
  // even when focus sits in a text field (Ctrl+Shift+R stays with the browser)
  if ((e.ctrlKey || e.metaKey) && c === "KeyR" && !e.shiftKey) { e.preventDefault(); location.reload(); return; }
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
  // Space held down = the hand tool (pan the camera), exactly like Photoshop and Aseprite
  if (c === "Space") {
    e.preventDefault();
    if (!spaceHeld) { spaceHeld = true; if (typeof updateCursor === "function") updateCursor(); }
    return;
  }
  // every hotkey below comes from the rebindable table (js/keybinds.js)
  const act = keyBindHit(e);
  // Texture mode: geometry editing is locked. Only the camera, selection, undo, Delete,
  // Escape and the arrow keys (nudging the selected piece) remain — no tool hotkeys.
  if (texMode()) {
    if (act === "undo") { e.preventDefault(); undo(); return; }
    if (act === "redo") { e.preventDefault(); redo(); return; }
    if (c === "Escape") {
      closeCtx();
      // Escape backs out one step at a time: selection -> world rectangle -> sector -> nothing
      if (texSel != null || texSelLayers.length) {
        texSel = null; texSelLayers = []; _texSig = null;
        refreshTexPanel(); updateHud(); draw(); return;
      }
      if (texSelWorld != null) {
        texSelWorld = null; _texSig = null;
        refreshTexPanel(); updateHud(); draw(); return;
      }
      if (typeof texHasSector === "function" && texHasSector()) { texClearCtx(); updateHud(); draw(); return; }
      multiSel = [];
      sel.vertex = null; sel.line = null; sel.sector = null;
      sel.thing = null; sel.trigger = null; sel.triggerCorner = null; sel.floor = null;
      updateThingPanel();
      updateHud(); draw();
      return;
    }
    // Delete/Backspace: remove the selected piece, or the selected world rectangle
    if (act === "delete" || c === "Backspace") {
      if (texDeleteStamp()) { e.preventDefault(); _texSig = null; refreshTexPanel(); updateHud(); }
      else if (typeof texDeleteWorld === "function" && texDeleteWorld()) { e.preventDefault(); updateHud(); }
      return;
    }
    // Raise / lower the selected layer(s) in the stack (default Alt+Up / Alt+Down)
    if (act === "layer_up" || act === "layer_down") {
      e.preventDefault();
      if (e.repeat) return;
      const mv = texMoveLayer(act === "layer_up" ? 1 : -1, null, false);
      if (mv === 0) { hudText = tr("tex_need_layer"); updateHud(); }
      return;
    }
    // Arrows: nudge the selected sprite — and everything selected with it — by ONE PIXEL
    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (texSel == null && !texSelLayers.length) return;
      e.preventDefault();
      let dx = 0, dy = 0;
      if (e.key === "ArrowUp") dy = -1;
      if (e.key === "ArrowDown") dy = 1;
      if (e.key === "ArrowLeft") dx = -1;
      if (e.key === "ArrowRight") dx = 1;
      texMoveStamp(dx, dy, e.repeat);
      return;
    }
    return;
  }
  // commands (undo/redo/copy/paste/select all) by physical key — works in any layout
  if (act === "undo") { e.preventDefault(); undo(); return; }
  if (act === "redo") { e.preventDefault(); redo(); return; }
  if (act === "copy") { e.preventDefault(); copySelection(); return; }
  if (act === "paste") { e.preventDefault(); pasteSelection(); return; }
  if (act === "selectall") { e.preventDefault(); selectAll(); return; }
  // raise/lower of layers belongs to the texture department only
  if (act === "layer_up" || act === "layer_down") { e.preventDefault(); return; }
  if (act && KEYBIND_TOOL_SET.indexOf(act) >= 0) { setTool(act); return; }
  if (act === "delete" || (!act && c === "Backspace")) {
    if (selItems().length) { histPush(); deleteSelection(); }
    updateThingPanel(); updateHud(); updateChecks(); draw(); saveMap();
    return;
  }
  if (c === "Escape") { closeCtx(); cancelOperation(); deactivateSelectTool(); return; }
  if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    let dx = 0, dy = 0;
    if (e.key === "ArrowUp") dy = -1;
    if (e.key === "ArrowDown") dy = 1;
    if (e.key === "ArrowLeft") dx = -1;
    if (e.key === "ArrowRight") dx = 1;
    const step = dragStep();
    // e.repeat = key auto-repeat: one snapshot / one autosave per burst, not one per tick
    if (tool === "lift") {
      if (selLift != null) { if (!e.repeat) histPush(); moveLiftFloor(dx*step, dy*step); }
    } else {
      if (selItems().length) { if (!e.repeat) histPush(); moveSelection(dx*step, dy*step); }
    }
    updateHud();
    updateChecks();
    draw();
    saveMapSoon();
  }
});
document.addEventListener("keyup", e => {
  if (e.key === "Shift") shiftHeld = false;
  if (e.code === "Backquote") tildeHeld = false;
  if (e.code === "Space") {
    spaceHeld = false;
    if (typeof updateCursor === "function") updateCursor();
  }
});
// a window that loses focus takes the held Space with it, or the hand tool sticks
window.addEventListener("blur", () => {
  spaceHeld = false;
  if (typeof updateCursor === "function") updateCursor();
});

function cancelOperation() {
  selVertices = []; pendingConnect = null; pendingSector = null; pendingFloorBind = null;
  bindTargetThing = null;
  setTool("point");
  updateHud();
}


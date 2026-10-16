"use strict";
// VLS editor - js/history.js: undo/redo history
// ================= HISTORY (Ctrl+Z / Ctrl+Y) =================
function cloneMap() { return JSON.parse(JSON.stringify(mapData)); }

// Remember a snapshot at gesture start (LMB/RMB): one gesture = one undo step
function histBegin() {
  if (histPending == null) histPending = cloneMap();
}
// End of gesture: if the state really changed — push 'before' onto undo
function histCommit() {
  if (histPending == null) return;
  const before = histPending;
  histPending = null;
  if (before.vertices.length !== mapData.vertices.length ||
      before.lines.length !== mapData.lines.length ||
      before.sectors.length !== mapData.sectors.length ||
      before.things.length !== mapData.things.length ||
      before.triggers.length !== mapData.triggers.length ||
      (before.lifts||[]).length !== (mapData.lifts||[]).length ||
      JSON.stringify(before) !== JSON.stringify(mapData)) {
    undoStack.push(before);
    if (undoStack.length > HIST_LIMIT) undoStack.shift();
    redoStack = [];
  }
}
// Explicit history step (keyboard, buttons): call before changing mapData
function histPush() {
  histPending = null;
  undoStack.push(cloneMap());
  if (undoStack.length > HIST_LIMIT) undoStack.shift();
  redoStack = [];
}
function histReset() { undoStack = []; redoStack = []; histPending = null; }

function afterRestore() {
  // after undo/redo — clear the selection and redraw everything
  sel = { vertex: null, line: null, sector: null, thing: null, trigger: null, triggerCorner: null, floor: null };
  multiSel = [];
  selLift = null; selLiftFloor = 0; selVertices = [];
  pendingConnect = null; pendingSector = null; pendingFloorBind = null; bindTargetThing = null;
  selDrag = null; leftBtnDown = false; leftBoxDrag = false; leftTrigDrag = false;
  // after a rollback the _idc counter rolls back together with the snapshot — re-issue labels,
  // so that new creatures never start repeating uids
  ensureIdc();
  updateThingPanel(); updateTriggerPanel(); updateLiftPanel();
  updateChecks(); updateHud(); draw(); saveMap();
}
function undo() {
  if (!undoStack.length) { toast(tr("undo_nothing")); return; }
  redoStack.push(cloneMap());
  if (redoStack.length > HIST_LIMIT) redoStack.shift();
  mapData = undoStack.pop();
  afterRestore();
  log(tr("undo_log", undoStack.length));
}
function redo() {
  if (!redoStack.length) { toast(tr("redo_nothing")); return; }
  undoStack.push(cloneMap());
  if (undoStack.length > HIST_LIMIT) undoStack.shift();
  mapData = redoStack.pop();
  afterRestore();
  log(tr("redo_log", redoStack.length));
}


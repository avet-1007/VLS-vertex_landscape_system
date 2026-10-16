"use strict";
// VLS editor - js/core.js: core: coords, map data, editor state, canvas
// ================= COORDINATE SYSTEM =================
// 1 cell = GRID_SIZE units per side
const GRID_SIZE = 40;

// Snapping: snap any movement to half grid cells (20 units; Shift = exact movement without snapping)
const MOVE_STEP = GRID_SIZE / 2;
function snapGrid(v) { return Math.round(v / MOVE_STEP) * MOVE_STEP; }
function dragStep() { return shiftHeld ? 1 : MOVE_STEP; }
// quantized drag delta from the grab point
function snapDelta(cur, start) {
  const st = dragStep();
  return Math.round((cur - start) / st) * st;
}

// ================= DATA =================
let mapData = {
  name: "map01",
  version: "VLS.1",
  vertices: [],   // {id, x, y}
  lines: [],      // {id, a, b, tex, flags(0 wall /1 portal)}
  sectors: [],    // {id, verts:[], floorTex, wallTex, height, flags, neighbors:[], offset:{x,y}, stone, fragile}
  connects: [],   // {id, lineId, fromSector, toSector}
  things: [],     // {uid, id, type, x, y, slot, sectorId} — always attached to a sector. id = TYPE code ('what is it'), repeated across instances; uid = internal instance uniqueness
  lifts: [],      // {id, sectorId, floors:[{name,x,y}]} — floors[] holds only real floors; the zero floor is the sector itself, its key is zeroEntityId/zeroEntityType
  triggers: [],   // {id, tid, type, ticks, x1, y1, x2, y2}
  _idc: 1
};

// Defaults a newly created sector is born with (they used to come from the old sidebar inputs)
const DEFAULT_FLOOR_TEX = "floor_01";
const DEFAULT_WALL_TEX = "wall_01";
const DEFAULT_SECTOR_HEIGHT = 128;

// ================= ID LOOKUP CACHES =================
// Map id -> object, so getV/getLineById/getSector/thingByUid are O(1) instead of O(n).
// A slot is rebuilt when the backing array changes identity or length, or when _idc changes
// (lazy uid/vertex-id assignment touches objects in place but always bumps _idc).
const _lookups = {};
function _lookup(slot, arr, keyOf) {
  let s = _lookups[slot];
  if (!s || s.arr !== arr || s.len !== arr.length || s.idc !== mapData._idc) {
    const m = new Map();
    for (const o of arr) {
      const k = keyOf(o);
      if (k != null && !m.has(k)) m.set(k, o);
    }
    s = _lookups[slot] = { arr, len: arr.length, idc: mapData._idc, map: m };
  }
  return s.map;
}

// ================= EDITOR STATE =================
let tool = "point";
let cam = { x: 0, y: 0, zoom: 1 };
// The camera is a desk, not a frame: the position is never clamped, and the zoom runs
// from a bird's eye (0.01 = the whole desk) to a magnifier (48) like in Photoshop.
const CAM_ZOOM_MIN = 0.01, CAM_ZOOM_MAX = 48;
let dragging = false;
let lastMouse = { x: 0, y: 0 };
let sel = { vertex: null, line: null, sector: null, thing: null, trigger: null, triggerCorner: null, floor: null };
let multiSel = [];  // several selected objects: [{kind:'line'|'sector'|'thing'|'vertex'|'floor', id}] — for kind:'thing' this is the instance uid, not the code
let selLift = null;          // currently selected lift (id), works with the lift tool
let selLiftFloor = 0;        // index of the selected lift floor
let pendingFloorBind = null; // { liftId, floorIndex } — floor-to-creature bind mode
let selVertices = [];      // for line: a -> b
let preview = null;        // mouse world pos
let pendingConnect = null; // line id waiting for second click
let hoverLine = null;      // line id currently under cursor (for the hover highlight)
let hoverVertex = null;    // vertex id currently under cursor (for the hover highlight)
let pendingSector = null;  // reserved
let hudText = "";
let warnings = [];

// History (Ctrl+Z / Ctrl+Y) — mapData snapshots (JSON copies)
let undoStack = [];
let redoStack = [];
let histPending = null;      // snapshot taken at gesture start (for before/after comparison)
const HIST_LIMIT = 100;
// Clipboard (Ctrl+C / Ctrl+V)
let clipboard = null;        // {verts, lines, sectors, things, triggers, lifts, minX, minY}

// Action log: duplicated to the browser console and to the 'Log' panel.
// The user can copy it from the console (F12) or read it right in the editor.
function log(msg) {
  const ts = new Date().toTimeString().split(" ")[0];
  console.log("[VLS] " + ts + " " + msg);
  const el = document.getElementById("logList");
  if (el) {
    const div = document.createElement("div");
    div.className = "logrow";
    div.textContent = ts + " " + msg;
    el.appendChild(div);
    while (el.childElementCount > 200) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }
}

// --- selection-marquee (RMB, like on the desktop) ---
let rightDrag = false;
let rectSel = null;        // {sx,sy,ex,ey} world coords while dragging
let rectPreview = null;    // [{kind,id}] live preview selection while dragging with RMB

// --- select tool sub-target ---
let selectTarget = "vertex";   // vertex | line | sector

// --- preset box tool state ---
let boxAnchor = null;          // {x,y} where drag started
let boxSmooth = false;         // smooth (chamfered) corners?
let leftBoxDrag = false;       // currently dragging a box sector
let trigAnchor = null;         // {x,y} trigger drag start
let leftTrigDrag = false;      // currently dragging a trigger rect
let selDrag = null;            // {kind:'trigger'|'floor', ...} drag-move/resize in select
let leftBtnDown = false;       // LMB is currently held down
let shiftHeld = false;
let tildeHeld = false;         // the ~ key held down: RMB deletes (as before)
let spaceHeld = false;         // Space held down: the hand tool (pan the camera)
let mmbDown = null;            // tex mode: middle press {x,y,w,moved} — click picks, drag pans
let rmbDown = null;            // tex mode: right press {x,y,w,moved} — click picks the sprite, drag pans
let animT = 0;

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
let W = canvas.width, H = canvas.height;
let dpr = 1;

// Coalesce redraws: mousemove can fire faster than the screen refreshes.
// Declared before the first resize() call — resize() runs while render.js is not loaded yet.
let _drawQueued = false;
function drawSoon() {
  if (_drawQueued) return;
  _drawQueued = true;
  requestAnimationFrame(() => { _drawQueued = false; draw(); });
}

// ================= CANVAS SIZING =================
function resize() {
  dpr = window.devicePixelRatio || 1;
  const rect = document.getElementById("viewport").getBoundingClientRect();
  W = rect.width; H = rect.height;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(dpr,0,0,dpr,0,0);
  if (typeof draw === "function") draw();
}
window.addEventListener("resize", resize);
resize();

// ================= COORDS =================
function screenToWorld(sx, sy) {
  return {
    x: (sx - W/2) / cam.zoom + cam.x,
    y: (sy - H/2) / cam.zoom + cam.y
  };
}
function worldToScreen(wx, wy) {
  return {
    x: (wx - cam.x) * cam.zoom + W/2,
    y: (wy - cam.y) * cam.zoom + H/2
  };
}


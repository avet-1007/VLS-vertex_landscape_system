"use strict";
// VLS editor - js/keybinds.js: rebindable hotkeys for the settings popup
// A combination is {ctrl, shift, alt, code} and is stored in localStorage["vls_keys"].
// Two fixed aliases exist beside the table and are NOT rebindable:
// Ctrl+Y = redo, Backspace = delete (Backspace only while it is not bound to anything).
const KEYBIND_DEFS = {
  undo:      { ctrl: true,  shift: false, alt: false, code: "KeyZ" },
  redo:      { ctrl: true,  shift: true,  alt: false, code: "KeyZ" },
  copy:      { ctrl: true,  shift: false, alt: false, code: "KeyC" },
  paste:     { ctrl: true,  shift: false, alt: false, code: "KeyV" },
  selectall: { ctrl: true,  shift: false, alt: false, code: "KeyA" },
  delete:    { ctrl: false, shift: false, alt: false, code: "Delete" },
  point:     { ctrl: false, shift: false, alt: false, code: "KeyP" },
  line:      { ctrl: false, shift: false, alt: false, code: "KeyL" },
  sector:    { ctrl: false, shift: false, alt: false, code: "KeyS" },
  connect:   { ctrl: false, shift: false, alt: false, code: "KeyC" },
  thing:     { ctrl: false, shift: false, alt: false, code: "KeyT" },
  select:    { ctrl: false, shift: false, alt: false, code: "KeyV" },
  box:       { ctrl: false, shift: false, alt: false, code: "KeyB" },
  boxsmooth: { ctrl: false, shift: false, alt: false, code: "KeyG" },
  lift:      { ctrl: false, shift: false, alt: false, code: "KeyE" },
  layer_up:   { ctrl: false, shift: false, alt: true, code: "ArrowUp" },
  layer_down: { ctrl: false, shift: false, alt: true, code: "ArrowDown" }
};
// the order rows appear in the settings popup; commands first, then the tools
const KEYBIND_ORDER = [ "undo", "redo", "copy", "paste", "selectall", "delete",
  "point", "line", "sector", "connect", "thing", "select", "box", "boxsmooth", "lift",
  "layer_up", "layer_down" ];
// actions that just call setTool(name)
const KEYBIND_TOOL_SET = [ "point", "line", "sector", "connect", "thing", "select", "box", "boxsmooth", "lift" ];
// fixed extras: matched after the rebindable table, so a rebound key always wins
const KEYBIND_ALIASES = [ { id: "redo", ctrl: true, shift: false, alt: false, code: "KeyY" } ];

let keyBinds = {};
let keyBindCapture = null;   // the action id waiting for the next key press

function keyBindNorm(b) {
  return { ctrl: !!b.ctrl, shift: !!b.shift, alt: !!b.alt, code: String(b.code || "") };
}
function keyBindSame(a, b) {
  return !!a && !!b && !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift &&
         !!a.alt === !!b.alt && a.code === b.code;
}
function keyBindLoad() {
  const def = {};
  for (const id of KEYBIND_ORDER) def[id] = keyBindNorm(KEYBIND_DEFS[id]);
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem("vls_keys") || "null"); } catch (e) { stored = null; }
  if (stored && typeof stored === "object") {
    const used = {};
    for (const id of KEYBIND_ORDER) {
      const b = stored[id];
      if (b && typeof b === "object" && b.code) {
        const n = keyBindNorm(b);
        const k = n.ctrl + "+" + n.shift + "+" + n.alt + "+" + n.code;
        // a duplicated combination (hand-edited storage) falls back to the default
        if (!used[k]) { def[id] = n; used[k] = true; }
      }
    }
  }
  keyBinds = def;
}
function keyBindSave() {
  try { localStorage.setItem("vls_keys", JSON.stringify(keyBinds)); } catch (e) { }
}
function keyBindReset() {
  for (const id of KEYBIND_ORDER) keyBinds[id] = keyBindNorm(KEYBIND_DEFS[id]);
  keyBindSave();
}
function keyBindMatch(e, b) {
  if (!b || !b.code) return false;
  return !!b.ctrl === !!(e.ctrlKey || e.metaKey) && !!b.shift === !!e.shiftKey &&
         !!b.alt === !!e.altKey && b.code === e.code;
}
// the action the event belongs to; rebindable table first, fixed aliases after
function keyBindHit(e) {
  for (const id of KEYBIND_ORDER) if (keyBindMatch(e, keyBinds[id])) return id;
  for (const a of KEYBIND_ALIASES) if (keyBindMatch(e, a)) return a.id;
  return null;
}
// hand a combination to an action; an action that already owns it swaps — nothing is lost
function keyBindSet(id, bind) {
  const n = keyBindNorm(bind);
  for (const other of KEYBIND_ORDER) {
    if (other !== id && keyBindSame(n, keyBinds[other])) keyBinds[other] = keyBinds[id];
  }
  keyBinds[id] = n;
  keyBindSave();
}
function keyBindKeyName(code) {
  if (code.indexOf("Key") === 0) return code.slice(3);
  if (code.indexOf("Digit") === 0) return code.slice(5);
  if (code.indexOf("Numpad") === 0) return "Num" + code.slice(6);
  if (code === "Backquote") return "`";
  if (code === "Minus") return "-";
  if (code === "Equal") return "=";
  if (code === "BracketLeft") return "[";
  if (code === "BracketRight") return "]";
  if (code === "Semicolon") return ";";
  if (code === "Quote") return "'";
  if (code === "Comma") return ",";
  if (code === "Period") return ".";
  if (code === "Slash") return "/";
  if (code === "Backslash") return "\\";
  return code;
}
function keyBindLabel(b) {
  if (!b || !b.code) return "\u2014";
  let s = "";
  if (b.ctrl) s += "Ctrl+";
  if (b.alt) s += "Alt+";
  if (b.shift) s += "Shift+";
  return s + keyBindKeyName(b.code);
}

// ---- capture: click a row, press the new combination ----
// Registered BEFORE tools.js (this file loads earlier): while a capture runs,
// stopImmediatePropagation keeps the pressed key away from every other handler.
document.addEventListener("keydown", e => {
  if (!keyBindCapture) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.key === "Escape") { keyBindCapture = null; renderKeybinds(); return; }
  // a lone modifier is not a combination yet — wait for the real key
  if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
  keyBindSet(keyBindCapture, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey, code: e.code });
  keyBindCapture = null;
  renderKeybinds();
}, true);

function renderKeybinds() {
  const host = document.getElementById("kbRows");
  if (!host) return;
  host.textContent = "";
  for (const id of KEYBIND_ORDER) {
    const row = document.createElement("div");
    row.className = "sp-row";
    const lb = document.createElement("label");
    lb.textContent = tr("kb_" + id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn kbbind" + (keyBindCapture === id ? " listening" : "");
    btn.textContent = keyBindCapture === id ? tr("kb_press") : keyBindLabel(keyBinds[id]);
    btn.addEventListener("click", () => {
      keyBindCapture = keyBindCapture === id ? null : id;
      renderKeybinds();
    });
    row.appendChild(lb);
    row.appendChild(btn);
    host.appendChild(row);
  }
}

keyBindLoad();
const kbResetBtn = document.getElementById("kbReset");
if (kbResetBtn) kbResetBtn.addEventListener("click", () => {
  keyBindReset();
  keyBindCapture = null;
  renderKeybinds();
});

"use strict";
// VLS editor - js/Atlas/panel.js: the sidebar panel: context, layers and the world rectangles
// Split out of js/textures.js - the very same script, only in pieces; load order matters.
// ================= PANEL =================
function texEl(id) { return document.getElementById(id); }

function refreshTexPanel() {
  // the context sector may have been deleted — drop it instead of drawing ghosts
  if (texHasSector() && !getSector(texCtxSector)) texCtxSector = null;
  const target = texTarget();
  for (const t of texTools) if (t.update) t.update(target, t.el);

  if (!texMode()) return;
  const hasCtx = texHasSector();

  // sector selected -> its layers; nothing selected -> the world rectangles
  const eEmpty = texEl("texEmpty"), eSector = texEl("texSectorBlock"),
        eWorld = texEl("texWorldBlock");
  if (eEmpty) eEmpty.hidden = !(texTools.length === 0 && !hasCtx);
  if (eSector) eSector.hidden = !hasCtx;
  if (eWorld) eWorld.hidden = hasCtx;

  if (hasCtx) texRenderLayers(); else texRenderWorldList();

  // deletion acts on the whole group of selected layers (one sprite = one layer)
  const hasSel = hasCtx && texSelectedItems().length > 0;
  const del = texEl("btnTexDel");
  if (del) del.classList.toggle("off", !hasSel);

  paintRegionBox();
  updateRegionLabel();
}

// The editor has no selection event, so the department watches the selection itself —
// but only while it is open, so it costs nothing in normal geometry editing.
function watchTexSelection() {
  if (_texTimer) return;
  _texTimer = setInterval(() => {
    const panel = document.getElementById("panelTextures");
    if (!panel || panel.hidden) return;
    let sig = "r" + texRegion.x + "," + texRegion.y + "," + texRegion.w + "," + texRegion.h + ":" + texSel + ":" + texSelWorld + ":";
    if (texCtxSector != null) {
      const ls = texLayerList(texCtxSector, false) || [];
      sig += "p" + texCtxSector + ":" + texLayerIdx + ":" + texSelLayers.join("+") + ":"
           + ls.map(L => (L && L.visible === false ? "0" : "1") + "/" + (L && L.items ? L.items.length : 0)
                        + (L && L.items && L.items[0]
                           ? "@" + Math.round(L.items[0].pw || L.items[0].rw) + "x" + Math.round(L.items[0].ph || L.items[0].rh)
                           : "")).join(",");
    }
    for (const m of selItems()) sig += m.kind + ":" + m.id + ";";
    sig += "|" + texData().world.length;
    if (sig !== _texSig) { _texSig = sig; refreshTexPanel(); }
  }, 120);
}
watchTexSelection();

// --- layer stack: index 0 is the bottom layer (drawn first), the last one sits on top ---
// ONE SPRITE = ONE LAYER. Every row carries a small copy of the sprite that lives on it —
// the way the layer panel of an image editor shows its layers. Click a row to take that
// layer, Shift — to add it to / drop it from the group; the group is what moves together,
// what gets deleted together and what stays opaque when the transparency switch is on.
function texRenderLayers() {
  const host = texEl("texLayers");
  if (!host) return;
  const layers = texLayerList(texCtxSector, false) || [];
  if (texLayerIdx >= layers.length) texLayerIdx = layers.length - 1;
  if (texLayerIdx < 0) texLayerIdx = 0;
  host.textContent = "";
  if (!layers.length) {
    const e = document.createElement("div");
    e.className = "muted";
    e.textContent = tr("tex_layers_empty");
    host.appendChild(e);
    return;
  }
  for (let i = layers.length - 1; i >= 0; i--) {
    const L = layers[i];
    const row = document.createElement("div");
    row.className = "texlayer" + (texLayerSelected(L.id) ? " active" : "");
    const vis = document.createElement("button");
    vis.type = "button";
    vis.className = "texlayvis";
    vis.textContent = L.visible === false ? "○" : "●";
    vis.title = tr("tex_toggle_layer");
    vis.onclick = (ev) => {
      ev.stopPropagation();
      histPush();   // the snapshot must hold the state BEFORE the flip, or undo does nothing
      L.visible = (L.visible === false);
      log(tr(L.visible ? "log_tex_vis_on" : "log_tex_vis_off", texCtxSector, L.name || "?"));
      texRenderLayers(); draw(); saveMap();
    };
    // the small copy of the sprite itself
    const th = document.createElement("canvas");
    th.className = "texlayersw";
    th.width = 36; th.height = 36;
    try {
      const g = th.getContext("2d");
      g.imageSmoothingEnabled = true;
      g.clearRect(0, 0, 36, 36);
      const it0 = (L.items && L.items[0]) || null;
      if (it0 && it0.rw > 0 && it0.rh > 0) {
        const k = Math.min(36 / it0.rw, 36 / it0.rh);
        const w = Math.max(1, Math.round(it0.rw * k)), h = Math.max(1, Math.round(it0.rh * k));
        g.drawImage(regionCanvas(it0.rx, it0.ry, it0.rw, it0.rh), (36 - w) / 2, (36 - h) / 2, w, h);
      } else {
        g.fillStyle = L.color || "#4a7fd4";
        g.fillRect(0, 0, 36, 36);
      }
    } catch (e) { /* a tainted region simply leaves the thumbnail empty */ }
    const nm = document.createElement("span");
    nm.className = "texlayname";
    nm.textContent = L.name || String(i + 1);
    const cnt = document.createElement("span");
    cnt.className = "texlaycount";
    // the sprite's size in pixels — the only number worth showing for a single sprite
    cnt.textContent = (L.items && L.items[0])
      ? Math.round(L.items[0].pw || L.items[0].rw) + "×" + Math.round(L.items[0].ph || L.items[0].rh)
      : "";
    // raise / lower: swap this row with the one above / below (dead at the stack edge)
    const up = document.createElement("button");
    up.type = "button";
    up.className = "texlaymove";
    up.textContent = "\u2191";
    up.title = tr("tex_layer_up");
    up.disabled = (i >= layers.length - 1);
    up.onclick = (ev) => { ev.stopPropagation(); texMoveLayer(1, i); };
    const dn = document.createElement("button");
    dn.type = "button";
    dn.className = "texlaymove";
    dn.textContent = "\u2193";
    dn.title = tr("tex_layer_down");
    dn.disabled = (i <= 0);
    dn.onclick = (ev) => { ev.stopPropagation(); texMoveLayer(-1, i); };
    const del = document.createElement("button");
    del.type = "button";
    del.className = "texlaydel";
    del.textContent = "✕";
    del.title = tr("tex_del_layer");
    del.onclick = (ev) => {
      ev.stopPropagation();
      histPush();
      layers.splice(i, 1);
      texSelLayers = texSelLayers.filter(id => id !== L.id);
      if (texLayerIdx >= layers.length) texLayerIdx = layers.length - 1;
      if (texLayerIdx < 0) texLayerIdx = 0;
      texSel = null;
      _texSig = null;
      refreshTexPanel(); draw(); saveMap();
    };
    row.appendChild(vis); row.appendChild(th); row.appendChild(nm); row.appendChild(cnt);
    row.appendChild(up); row.appendChild(dn); row.appendChild(del);
    row.onclick = (ev) => {
      // click — take that layer and its sprite; Shift — toggle the layer in the group
      if (ev && ev.shiftKey) texToggleLayer(L.id);
      else texSelectLayer(L.id);
      const it0 = (L.items && L.items[0]) || null;
      texSel = it0 ? it0.id : null;
      _texSig = null;
      refreshTexPanel(); updateHud(); draw();
    };
    host.appendChild(row);
  }
}

// --- world rectangles list (void) ---
function texRenderWorldList() {
  const host = texEl("texWorldList");
  if (!host) return;
  const world = texData().world;
  host.textContent = "";
  if (!world.length) {
    const e = document.createElement("div");
    e.className = "muted";
    e.textContent = tr("tex_world_empty");
    host.appendChild(e);
    return;
  }
  for (let i = world.length - 1; i >= 0; i--) {
    const r = world[i];
    const row = document.createElement("div");
    row.className = "texlayer" + (r.id === texSelWorld ? " active" : "");
    const sw = document.createElement("canvas");
    sw.className = "texlayersw";
    sw.width = 36; sw.height = 36;
    try {
      // drawn, not exported: a file:// atlas taints the region, exporting would throw
      const sg = sw.getContext("2d");
      sg.imageSmoothingEnabled = true;
      sg.clearRect(0, 0, 36, 36);
      sg.drawImage(regionCanvas(r.rx, r.ry, r.rw, r.rh), 0, 0, 36, 36);
    } catch (e) { /* leave the swatch empty */ }
    const nm = document.createElement("span");
    nm.className = "texlayname";
    nm.textContent = (r.name || "") + "  " + Math.round(r.w) + "×" + Math.round(r.h);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "texlaydel";
    del.textContent = "✕";
    del.title = tr("tex_del_world");
    del.onclick = (e) => {
      e.stopPropagation();
      histPush();
      world.splice(i, 1);
      if (texSelWorld === r.id) texSelWorld = null;
      _texSig = null;
      texRenderWorldList(); draw(); saveMap();
    };
    row.appendChild(sw); row.appendChild(nm); row.appendChild(del);
    // clicking a row selects that rectangle on the map (it can then be moved or resized)
    row.onclick = () => { texSelWorld = r.id; texSel = null; _texSig = null; refreshTexPanel(); updateHud(); draw(); };
    host.appendChild(row);
  }
}


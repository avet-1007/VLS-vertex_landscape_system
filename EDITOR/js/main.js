"use strict";
// VLS editor - js/main.js: init
// ================= INIT =================
const restoredMap = restoreMap();
if (restoredMap) {
  document.getElementById("mapName").value = mapData.name || "map01";
  hudText = tr("restore_ok");
  log(tr("restore_log", mapData.vertices.length, mapData.lines.length, mapData.sectors.length, mapData.things.length, (mapData.triggers||[]).length));
}
setTool("point");
drawCurve();
updateThingPanel();
updateTriggerPanel();
updateLiftPanel();
updateHud();
updateChecks();
draw();

console.log("VLS editor build v5 — key/call-button unbinding, join modifier removed from lines, lift converted to a regular sector");



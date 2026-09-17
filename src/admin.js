import { Engine } from "./engine.js";
import { Walk } from "./session.js";
import { Poi } from "./poi.js";
import { Play } from "./play.js";
import { Pack } from "./pack.js";
import { GAME } from "./game.js";
import { BUILD, KEY, store, state, save, feed, hooks, ui, map, pins, rings, onFix, styleRing, styleLocation, mapStatus, setMapSource, rebuildLocations,
  $, render, renderClock, renderSheet, renderReveal, checkReveal, activateLocation, finishActive, locationById,
  msLeft, startReal, stopReal, showStart, hideStart } from "./app.js";

/* ════════════════════════════════════════════════════════════════════
   ADMIN & DEV TOOLS — only in the admin file (chinatown-hunt-admin.html).
   Setting up the game (locations, radii), exporting the participant file,
   and testing: the location emulator, walk recorder and replay.
   The participant file is built without this module.
   ════════════════════════════════════════════════════════════════════ */
const ADMIN_KEY = "chinatown-hunt-m1";          // where earlier versions kept edits and recordings; kept so they survive

// Preview: the same file opened with ?preview shows the game as participants see it (see PREVIEW below).
const PREVIEW = BUILD === "preview";
if (!PREVIEW) { ui.startScreen = false; hideStart(); }
document.body.classList.add(PREVIEW ? "preview" : "dev");
document.title = `${GAME.title} · ${PREVIEW ? "Preview" : "Admin"}`;
// Testing in the admin file runs the clock from each load, so an old test session never
// opens straight onto the clues screen. Reset progress restarts it too.
if (!PREVIEW) { state.startedAt = Date.now(); save(); renderClock(); }

/* ════════════════════════════════════════════════════════════════════
   THE DRAFT — the game as the admin is building it: locations, radii,
   arrival text and challenges. Saved in this browser on every change and
   never overwritten by an update to the default game; Export publishes it,
   Import game file loads a published game back in.
   ════════════════════════════════════════════════════════════════════ */
const DRAFT_KEY = ADMIN_KEY + ":draft";
const POI_KEY = ADMIN_KEY + ":poi";                // location moves saved by earlier versions, carried into the draft once
const DEFAULT_GAME = structuredClone(GAME);
const draft = { notice:"", error:"" };
const defaultLocation = id => DEFAULT_GAME.locations.find(l => l.id === id);

// Put saved content into the live game. The pins are redrawn once the admin tools are wired up (see LOCATIONS).
function applyContent(game){
  GAME.locations = game.locations.map(l => ({
    ...structuredClone(l), radius: l.radius ?? undefined, arrivalText: l.arrivalText ?? "", tasks: structuredClone(l.tasks || []),
  }));
  for (const k of ["title", "intro", "revealIntro"]) if (typeof game[k] === "string") GAME[k] = game[k];
  // Drafts saved before clues & timing existed keep the defaults for those.
  for (const k of ["durationMinutes", "revealMinutes"]) if (Number.isFinite(game[k])) GAME[k] = game[k];
  for (const k of ["clues", "suspects"]) if (Array.isArray(game[k])) GAME[k] = structuredClone(game[k]);
  if (game.map && typeof game.map === "object") GAME.map = { ...GAME.map, ...game.map };
  state.clockMinutes = GAME.durationMinutes;
  fitToLocations();
}
function fitToLocations(){
  if (GAME.locations.length) map.fitBounds(GAME.locations.map(l => [l.lat, l.lng]), { padding:[40, 40], maxZoom:18 });
}
function saveDraft(){
  try { store.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), game: gameForExport() })); draft.error = ""; }
  catch(e){ draft.error = "Couldn't save your changes in this browser (storage full?). Export the game file now to keep them."; }
  renderExport();
}
{
  let saved = null;
  try { saved = JSON.parse(store.getItem(DRAFT_KEY)); } catch(e){}
  if (saved?.game?.id === GAME.id && Array.isArray(saved.game.locations)) {
    applyContent(saved.game);
  } else {
    let old = {};
    try { old = JSON.parse(store.getItem(POI_KEY)) || {}; } catch(e){}
    const r = Poi.apply(DEFAULT_GAME.locations, old);
    if (r.applied.length) { applyContent({ ...DEFAULT_GAME, locations: r.locations }); queueMicrotask(saveDraft); }
  }
}

/* Walk recording: every fix the engine sees, kept apart from game progress so that
   resetting progress never loses a walk. Flushed every few seconds and when the page
   hides, so a crash or a killed tab loses at most the last few fixes. */
const WALK_KEY = ADMIN_KEY + ":walk";
const walk = { log: [], dirty: false, savedAt: null, error: null };
try { const saved = JSON.parse(store.getItem(WALK_KEY)); if (Array.isArray(saved)) walk.log = saved; } catch(e){}
function flushWalk(){
  if (!walk.dirty) return;
  try { store.setItem(WALK_KEY, JSON.stringify(walk.log)); walk.dirty = false; walk.savedAt = Date.now(); walk.error = null; }
  catch(e){ walk.error = "Couldn't save the recording on this device (storage full?). Download it now."; }
}
setInterval(flushWalk, 5000);
addEventListener("pagehide", flushWalk);
hooks.hidden.push(flushWalk);

/* ════════════════════════════════════════════════════════════════════
   HOOKS INTO THE GAME
   ════════════════════════════════════════════════════════════════════ */
let poiMode = false;       // placing a location by hand (see LOCATIONS)
let drawerOpen = false;
const fixLog = [];

// Replayed fixes aren't re-recorded, so exporting after a replay doesn't duplicate the walk.
hooks.fix.push((fix, out, src) => {
  if (src !== "replay" && !PREVIEW) { Walk.record(walk.log, fix, src); walk.dirty = true; }
  logFix(fix, out, src);
});
hooks.render.push(ranges => { setSrcButtons(); if (drawerOpen) renderState(ranges); });
hooks.beforeSource.push(next => { if (next !== "sim") stopSim(); if (next !== "replay") pauseReplay(); });
hooks.ringStyle = id => poiMode && id === capSel.value
  ? { color:"#8A6D2F", fillColor:"#8A6D2F", fillOpacity:.15, weight:2, dashArray:null } : null;
hooks.status = () =>
  feed.frozen ? { dot:"dead", text:"feed frozen" } :
  feed.source === "sim" ? { dot:"sim", text:"simulated" } :
  feed.source === "replay" ? { dot:"sim", text:`replay ${replaySpeed()}×` } : null;

function logFix(fix, out, src){
  const g = out.ranges[0];
  const streak = g ? (out.streaks[g.id] || 0) : 0;
  fixLog.unshift({
    t: new Date(fix.t).toLocaleTimeString([], {hour12:false}),
    ok: out.screen.ok,
    why: out.screen.why,
    acc: Math.round(fix.accuracy),
    near: g ? `${g.name} ${Math.round(g.d)}m/${g.r}m` : "—",
    streak: `${streak}/${state.cfg.consecutiveFixes}`,
    fired: out.fired.length > 0,
    src
  });
  fixLog.length = Math.min(fixLog.length, 20);
  if (drawerOpen) { renderWalk(); renderLog(); }
}

function renderLog(){
  $("log").innerHTML = fixLog.map(e =>
    `<div class="${e.fired ? "hit" : e.ok ? "" : "rej"}">${e.t} ${e.src.padEnd(4)} ±${String(e.acc).padStart(3)}m  ${e.ok ? "✓" : "✕"} ${e.why}\n         ${e.near}  streak ${e.streak}${e.fired ? "  ► OPENED" : ""}</div>`
  ).join("") || `<div style="color:var(--slate)">No fixes yet. Choose a position source above.</div>`;
}

function renderState(ranges){
  const f = state.fix;
  $("state").innerHTML =
    `fix    ${f ? f.lat.toFixed(6)+", "+f.lng.toFixed(6) : "—"}\n` +
    `acc    ${f ? "±"+Math.round(f.accuracy)+" m" : "—"}\n` +
    `source ${feed.source}${feed.frozen ? " (frozen)" : ""}\n` +
    `fixes  ${state.fixes}\n` +
    `done   ${state.progress.completed.length} / ${GAME.locations.length}   active ${state.progress.active || "—"}   ${state.progress.revealed ? "clues shown" : ""}\n` +
    `ceil   ${state.cfg.accuracyCeiling} m   streak ${state.cfg.consecutiveFixes}   radius ${state.cfg.radius} m\n\n` +
    (ranges||[]).slice(0,4).map(g =>
      `${state.progress.completed.includes(g.id) ? "●" : "○"} ${g.name.padEnd(24).slice(0,24)} ${String(Math.round(g.d)).padStart(5)}m  ${(state.streaks[g.id]||0)}/${state.cfg.consecutiveFixes}`
    ).join("\n");
}

/* ════════════════════════════════════════════════════════════════════
   SIMULATOR
   ════════════════════════════════════════════════════════════════════ */
const sim = { at:null, timer:null, path:[], playing:false, travelled:0, line:null, marks:[] };
const M_PER_DEG = 111320;

function setSim(lat, lng){
  sim.at = { lat, lng };
  hooks.beforeSource.forEach(h => h("sim"));
  stopSim(); stopReal();
  feed.source = "sim"; feed.gpsIssue = null; setSrcButtons();
  sim.timer = setInterval(emitSim, +$("interval").value);
  emitSim();
}
function stopSim(){ if (sim.timer) { clearInterval(sim.timer); sim.timer = null; } sim.playing = false; $("pathPlay").classList.remove("on"); }

function emitSim(){
  if (!sim.at) return;
  if (sim.playing) stepWalk();
  const j = +$("jitter").value;
  const dLat = j ? (Math.random()-.5)*2*j/M_PER_DEG : 0;
  const dLng = j ? (Math.random()-.5)*2*j/(M_PER_DEG*Math.cos(sim.at.lat*Math.PI/180)) : 0;
  onFix({ lat:sim.at.lat+dLat, lng:sim.at.lng+dLng, accuracy:+$("fakeAcc").value });
}

function stepWalk(){
  if (sim.path.length < 2) { sim.playing = false; $("pathPlay").classList.remove("on"); return; }
  sim.travelled += (+$("speed").value) * (+$("interval").value/1000);
  let acc = 0;
  for (let i = 0; i < sim.path.length-1; i++){
    const a = sim.path[i], b = sim.path[i+1];
    const seg = Engine.haversine(a[0],a[1],b[0],b[1]);
    if (acc + seg >= sim.travelled){
      const t = seg ? (sim.travelled-acc)/seg : 0;
      sim.at = { lat:a[0]+(b[0]-a[0])*t, lng:a[1]+(b[1]-a[1])*t };
      return;
    }
    acc += seg;
  }
  sim.at = { lat:sim.path.at(-1)[0], lng:sim.path.at(-1)[1] };
  sim.playing = false; $("pathPlay").classList.remove("on");
}

/* map clicking: place a location, place the simulated position, or add a path waypoint */
let tapMode = false, pathMode = false;
map.on("click", e => {
  if (poiMode){
    setPoi(capSel.value, { lat:e.latlng.lat, lng:e.latlng.lng });
  } else if (pathMode){
    sim.path.push([e.latlng.lat, e.latlng.lng]);
    sim.marks.push(L.circleMarker(e.latlng, { radius:4, color:"#8A6D2F", weight:2, fillOpacity:1, fillColor:"#8A6D2F" }).addTo(map));
    if (sim.line) map.removeLayer(sim.line);
    sim.line = L.polyline(sim.path, { color:"#8A6D2F", weight:2, dashArray:"5 5" }).addTo(map);
  } else if (tapMode){
    setSim(e.latlng.lat, e.latlng.lng);
  }
});

/* ════════════════════════════════════════════════════════════════════
   DRAWER WIRING
   On a computer screen the drawer is a panel docked beside the map, so admin
   work never hides the map. On a phone it is a full-screen sheet that gets out
   of the way whenever the map is needed.
   ════════════════════════════════════════════════════════════════════ */
const wideScreen = matchMedia("(min-width: 960px)");
function toggleDrawer(open){
  drawerOpen = open;
  $("drawer").classList.toggle("up", open);
  layoutPanel();
  if (open){ renderLog(); renderWalk(); renderReplay(); renderPoi(); render(); }
}
function layoutPanel(){
  document.body.classList.toggle("panel", drawerOpen && wideScreen.matches);
  map.invalidateSize();
  syncPinDragging();
}
wideScreen.addEventListener("change", layoutPanel);
// After a drawer action that needs the map: close the sheet on a phone, stay open beside the map on a computer.
function makeRoomForMap(){ if (!wideScreen.matches) toggleDrawer(false); }
$("devbtn").onclick = () => toggleDrawer(true);
$("drawerclose").onclick = () => toggleDrawer(false);
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && poiMode) { e.preventDefault(); $("poiDone").click(); }
});

function setSrcButtons(){
  $("srcReal").classList.toggle("on", feed.source === "real");
  $("srcSim").classList.toggle("on", feed.source === "sim");
  $("tapMode").classList.toggle("on", tapMode);
  $("freeze").classList.toggle("on", feed.frozen);
  $("pathMode").classList.toggle("on", pathMode);
  $("poiPlace").classList.toggle("on", poiMode);
}
$("srcReal").onclick = startReal;
$("srcSim").onclick = () => { const c = map.getCenter(); setSim(sim.at?.lat ?? c.lat, sim.at?.lng ?? c.lng); makeRoomForMap(); };
$("tapMode").onclick = () => { tapMode = !tapMode; if (tapMode) { pathMode = false; endPlacing(); } setSrcButtons(); if (tapMode) makeRoomForMap(); };
$("freeze").onclick = () => { feed.frozen = !feed.frozen; setSrcButtons(); render(); };

/* jump controls */
const jumpSel = $("jump"), capSel = $("capTarget");
// Both location lists, numbered as the pins are. Keeps (or sets) the selected location.
function refreshLocationSelects(selectId = capSel.value){
  const opts = () => GAME.locations.map((l, i) => new Option(`${i + 1}. ${l.name?.trim() || "(unnamed)"}`, l.id));
  capSel.replaceChildren(...opts());
  capSel.value = GAME.locations.some(l => l.id === selectId) ? selectId : (GAME.locations[0]?.id ?? "");
  const jumpValue = jumpSel.value;
  jumpSel.replaceChildren(new Option("Jump to a location…", ""), ...opts());
  jumpSel.value = GAME.locations.some(l => l.id === jumpValue) ? jumpValue : "";
}
refreshLocationSelects();
function jumpTo(id, offsetM){
  const l = GAME.locations.find(x => x.id === id); if (!l) return;
  const d = (offsetM || 0) / M_PER_DEG;
  setSim(l.lat + d, l.lng);
  map.setView([l.lat, l.lng], 18);
}
jumpSel.onchange = e => { if (e.target.value){ jumpTo(e.target.value, 0); makeRoomForMap(); } };
$("jumpIn").onclick  = () => { const id = jumpSel.value || GAME.locations[0].id; const l = GAME.locations.find(x=>x.id===id); jumpTo(id, Engine.radiusOf(l,state.cfg)-4); makeRoomForMap(); };
$("jumpOut").onclick = () => { const id = jumpSel.value || GAME.locations[0].id; const l = GAME.locations.find(x=>x.id===id); jumpTo(id, Engine.radiusOf(l,state.cfg)+12); makeRoomForMap(); };

/* path controls */
$("pathMode").onclick = () => { pathMode = !pathMode; if (pathMode) { tapMode = false; endPlacing(); } setSrcButtons(); if (pathMode) makeRoomForMap(); };
$("pathPlay").onclick = () => {
  if (sim.path.length < 2) { alert("Draw a path first: tap 'Draw path', then tap two or more points on the map."); return; }
  sim.travelled = 0; sim.at = { lat:sim.path[0][0], lng:sim.path[0][1] };
  setSim(sim.at.lat, sim.at.lng);
  sim.playing = true; $("pathPlay").classList.add("on");
  makeRoomForMap();
};
$("pathClear").onclick = () => {
  sim.path = []; sim.playing = false;
  sim.marks.forEach(m => map.removeLayer(m)); sim.marks = [];
  if (sim.line) { map.removeLayer(sim.line); sim.line = null; }
  setSrcButtons();
};

/* sliders — each starts at the value the app is already using and only acts when moved.
   Applying on load would push the HTML defaults over GAME.defaults and restart the countdown. */
function slider(id, fmt, apply, initial){
  const el = $(id), out = $(id+"O");
  if (initial != null) el.value = initial;
  out.textContent = fmt(initial ?? el.value);
  el.addEventListener("input", () => { out.textContent = fmt(el.value); apply && apply(el.value); });
}
slider("speed",    v => (+v).toFixed(1)+" m/s");
slider("fakeAcc",  v => v+" m");
slider("jitter",   v => v+" m");
slider("interval", v => (v/1000).toFixed(1)+" s", v => { if (sim.timer){ clearInterval(sim.timer); sim.timer = setInterval(emitSim, +v); } });
slider("ceil",     v => v+" m",  v => { state.cfg.accuracyCeiling = +v; render(); }, state.cfg.accuracyCeiling);
slider("streakN",  v => v,       v => { state.cfg.consecutiveFixes = +v; render(); }, state.cfg.consecutiveFixes);
slider("defRad",   v => v+" m",  v => {
  state.cfg.radius = +v;
  GAME.locations.forEach(l => { if (l.radius == null) rings[l.id].setRadius(+v); });
  render();
}, state.cfg.radius);
slider("capRad",   v => v+" m",  v => setPoi(capSel.value, { radius:+v }),
  Engine.radiusOf(GAME.locations.find(l => l.id === capSel.value) || {}, state.cfg));
$("clockSet").max = Math.max(GAME.durationMinutes, 1);
slider("clockSet", v => v+" min", v => { state.clockMinutes = +v; state.startedAt = Date.now(); renderClock(); checkReveal(); }, state.clockMinutes);

$("blowAcc").onclick = () => {
  const p = sim.at || map.getCenter();
  onFix({ lat:p.lat, lng:p.lng, accuracy:80 }, "sim");
  renderLog();
};

$("forceOpen").onclick = () => {
  const ranges = state.fix ? Engine.ranges(state.fix, GAME.locations, state.cfg) : Engine.ranges({lat:map.getCenter().lat,lng:map.getCenter().lng,accuracy:10}, GAME.locations, state.cfg);
  const next = ranges.find(g => !state.progress.completed.includes(g.id)); if (!next) return;
  if (activateLocation(next.id)) makeRoomForMap();
};
// Testing shortcuts: move to the next challenge, or finish the open location outright.
$("solveOne").onclick = () => {
  const l = locationById(state.progress.active); if (!l) { alert("No location is open."); return; }
  if (Play.canFinish(l, state.progress)) { finishActive(); return; }
  state.progress = Play.next(state.progress, l); save(); renderSheet();
};
$("solveAll").onclick = () => {
  const l = locationById(state.progress.active); if (!l) { alert("No location is open."); return; }
  state.progress = Play.goTo(state.progress, l, (l.tasks || []).length - 1);
  finishActive();
};
$("reset").onclick = () => {
  if (!confirm("Clear all game progress? Location edits and the walk recording are kept.")) return;
  clearProgress();
  state.clockMinutes = GAME.durationMinutes; $("clockSet").value = state.clockMinutes; $("clockSetO").textContent = state.clockMinutes + " min";
  state.startedAt = Date.now(); save(); renderClock(); renderReveal();
};

/* ════════════════════════════════════════════════════════════════════
   LOCATIONS — set each POI by hand: drag any pin (computer), place it on
   the map, paste coordinates, or use the current position; the radius
   slider applies at once. Edits take effect in the engine immediately and
   go into the participant file on export.
   ════════════════════════════════════════════════════════════════════ */
const round6 = x => Math.round(x * 1e6) / 1e6;
function setPoi(id, changes){
  const l = GAME.locations.find(x => x.id === id); if (!l) return;
  if ("lat" in changes) l.lat = round6(changes.lat);
  if ("lng" in changes) l.lng = round6(changes.lng);
  if ("radius" in changes) l.radius = changes.radius ?? undefined;
  pins[id].setLatLng([l.lat, l.lng]);
  rings[id].setLatLng([l.lat, l.lng]).setRadius(Engine.radiusOf(l, state.cfg));
  saveDraft(); renderPoi(); render();
}
const isMoved = l => { const d = defaultLocation(l.id); return !d || d.lat !== l.lat || d.lng !== l.lng || (d.radius ?? null) !== (l.radius ?? null); };

function renderPoi(){
  const l = GAME.locations.find(x => x.id === capSel.value); if (!l) return;
  const r = Engine.radiusOf(l, state.cfg), i = GAME.locations.indexOf(l), isNew = !defaultLocation(l.id);
  if (document.activeElement !== $("locName")) $("locName").value = l.name ?? "";
  $("locCount").textContent = `${GAME.locations.length}, pins numbered in this order`;
  $("locUp").disabled = i === 0;
  $("locDown").disabled = i === GAME.locations.length - 1;
  $("locDelete").disabled = GAME.locations.length < 2;
  $("poiInfo").textContent =
    `${l.lat.toFixed(6)}, ${l.lng.toFixed(6)} · radius ${r} m · ${isNew ? "new location" : isMoved(l) ? "moved" : "as in the default game"}` +
    (wideScreen.matches ? "\nDrag any pin on the map to move it." : "") +
    (draft.notice ? `\n${draft.notice}` : "");
  $("capRad").value = r; $("capRadO").textContent = r + " m";
  $("poiRevert").disabled = isNew || !isMoved(l);
  renderTasks();
  $("poibarText").textContent = `Placing ${l.name} · radius ${r} m`;
  renderExport();
}

function startPlacing(){
  const id = capSel.value;
  poiMode = true; tapMode = false; pathMode = false;
  document.body.classList.add("placing");
  syncPinDragging();
  styleRing(id); setSrcButtons(); renderPoi();
  $("poibar").hidden = false;
  map.setView(pins[id].getLatLng(), Math.max(map.getZoom(), 18));
  makeRoomForMap();
}
function endPlacing(){
  if (!poiMode) return;
  poiMode = false;
  document.body.classList.remove("placing");
  syncPinDragging();
  GAME.locations.forEach(l => styleRing(l.id));
  $("poibar").hidden = true; setSrcButtons();
}
/* Which pins can be dragged: every pin while the admin panel is open on a computer, so a
   location can be moved by simply dragging it; on a phone only the one being placed, so
   panning the map in the field never moves a location by accident. */
function syncPinDragging(){
  const all = document.body.classList.contains("panel");
  GAME.locations.forEach(l => {
    const on = all || (poiMode && l.id === capSel.value);
    on ? pins[l.id].dragging.enable() : pins[l.id].dragging.disable();
  });
}
// Every pin, including ones drawn later for added or reordered locations, gets the editing handlers.
hooks.pinCreated.push((l, pin) => {
  pin.on("dragstart", () => {
    if (capSel.value !== l.id) { capSel.value = l.id; renderPoi(); }
  });
  pin.on("drag", e => rings[l.id].setLatLng(e.latlng));      // the geofence follows the pin
  pin.on("dragend", () => {
    const ll = pin.getLatLng();
    setPoi(l.id, { lat:ll.lat, lng:ll.lng });
  });
  // With the panel open, clicking a pin selects that location for editing (not while placing another).
  pin.on("click", () => {
    if (!drawerOpen || poiMode || capSel.value === l.id) return;
    capSel.value = l.id; renderPoi();
  });
});
rebuildLocations();
fitToLocations();

// After adding, removing or reordering locations: redraw pins, relist, save.
function locationsChanged(selectId){
  endPlacing();
  rebuildLocations(); syncPinDragging();
  refreshLocationSelects(selectId);
  save(); saveDraft(); renderSheet(); renderPoi(); render();
}
$("locAdd").onclick = () => {
  const c = map.getCenter();
  const l = { id: Play.newLocationId(GAME), name: `New location ${GAME.locations.length + 1}`,
    lat: round6(c.lat), lng: round6(c.lng), radius: GAME.defaults.radius, arrivalText: "", tasks: [] };
  GAME.locations.push(l);
  locationsChanged(l.id);
  draft.notice = "Added at the centre of the map. Drag its pin into place.";
  renderPoi();
  $("locName").focus(); $("locName").select();
};
$("locDelete").onclick = () => {
  const i = GAME.locations.findIndex(l => l.id === capSel.value); if (i < 0 || GAME.locations.length < 2) return;
  const l = GAME.locations[i], n = (l.tasks || []).length;
  if (!confirm(`Delete ${l.name || "this location"}${n ? ` and its ${n} challenge${n === 1 ? "" : "s"}` : ""}? Export first if you might want it back.`)) return;
  GAME.locations.splice(i, 1);
  locationsChanged(GAME.locations[Math.min(i, GAME.locations.length - 1)].id);
};
for (const [id, dir] of [["locUp", -1], ["locDown", +1]]) {
  $(id).onclick = () => {
    const i = GAME.locations.findIndex(l => l.id === capSel.value), j = i + dir;
    if (i < 0 || j < 0 || j >= GAME.locations.length) return;
    [GAME.locations[i], GAME.locations[j]] = [GAME.locations[j], GAME.locations[i]];
    locationsChanged(capSel.value);
  };
}
$("locName").addEventListener("input", e => {
  const l = GAME.locations.find(x => x.id === capSel.value); if (!l) return;
  l.name = e.target.value;
  pins[l.id]?.setTooltipContent(document.createTextNode(l.name?.trim() || "(unnamed)"));
  refreshLocationSelects(l.id);
  saveDraft(); render();
});

// Game title, start screen and clues screen wording.
function renderGameText(){
  for (const [id, key] of [["titleEdit", "title"], ["introEdit", "intro"], ["revealIntroEdit", "revealIntro"]])
    if (document.activeElement !== $(id)) $(id).value = GAME[key] ?? "";
}
for (const [id, key] of [["titleEdit", "title"], ["introEdit", "intro"], ["revealIntroEdit", "revealIntro"]]) {
  $(id).addEventListener("input", e => {
    GAME[key] = e.target.value;
    if (key === "title") document.title = `${GAME.title} · Admin`;
    saveDraft(); renderReveal();
  });
}

capSel.onchange = () => {
  const wasPlacing = poiMode;
  endPlacing(); renderPoi();
  const l = GAME.locations.find(x => x.id === capSel.value);
  if (l) map.setView([l.lat, l.lng], 18);
  if (wasPlacing) startPlacing();
};
$("poiPlace").onclick = startPlacing;
$("poiCoords").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("poiApply").click(); } });
$("poiDone").onclick = () => { endPlacing(); toggleDrawer(true); };
$("poiApply").onclick = () => {
  const id = capSel.value;
  let p;
  try { p = Poi.parseCoords($("poiCoords").value); }
  catch(e){ alert(`Couldn't read those coordinates: ${e.message}.`); return; }
  const before = GAME.locations.find(l => l.id === id);
  const km = Engine.haversine(before.lat, before.lng, p.lat, p.lng) / 1000;
  setPoi(id, p);
  $("poiCoords").value = "";
  draft.notice = km > 2 ? `Heads up: that is ${km.toFixed(1)} km from where this location was. Check latitude comes first.` : "";
  renderPoi();
  map.setView([p.lat, p.lng], 18);
};
$("capHere").onclick = () => {
  if (!state.fix) { alert("No position yet. Start Real GPS or place a simulated position first."); return; }
  setPoi(capSel.value, { lat:state.fix.lat, lng:state.fix.lng });
  const l = GAME.locations.find(x => x.id === capSel.value);
  $("capOut").value = `Set ${l.name} to your position (±${Math.round(state.fix.accuracy)} m accuracy).`;
};
$("poiRevert").onclick = () => {
  const base = defaultLocation(capSel.value); if (!base) return;
  setPoi(base.id, { lat:base.lat, lng:base.lng, radius:base.radius ?? null });
};

function locationsJson(){
  return JSON.stringify(GAME.locations.map(l => ({
    id:l.id, name:l.name, lat:l.lat, lng:l.lng, radius:Engine.radiusOf(l, state.cfg), arrivalText:l.arrivalText
  })), null, 2);
}
$("capExport").onclick = () => {
  const json = locationsJson();
  $("capOut").value = json;
  if (navigator.clipboard) navigator.clipboard.writeText(json).catch(()=>{});
  $("capOut").select?.();
};
$("poiDownload").onclick = () => {
  const stamp = Walk.filename().replace("chinatown-walk-", "chinatown-locations-");
  downloadFile(new File([locationsJson()], stamp, { type:"application/json" }));
};

/* ════════════════════════════════════════════════════════════════════
   EXPORT GAME FILE — the file participants play. The build embeds the
   participant page (no admin module, game content as a placeholder);
   the Export button seals the game as currently set up here into it.
   ════════════════════════════════════════════════════════════════════ */
const PARTICIPANT_TEMPLATE = "__PARTICIPANT_TEMPLATE__";
const GAME_PACK_SLOT = '"__GAME_PACK__"';
const canExport = PARTICIPANT_TEMPLATE.split(GAME_PACK_SLOT).length === 2;

// The game exactly as it should reach participants: current locations and radii, default engine settings.
function gameForExport(){
  const game = structuredClone(GAME);
  game.locations = GAME.locations.map(l => {
    const out = { ...l };
    if (out.radius == null) delete out.radius;
    // Challenges are text and a picture only; drop answer fields left over from earlier drafts.
    out.tasks = (l.tasks || []).map(t => ({ id: t.id, prompt: t.prompt ?? "", ...(t.image ? { image: t.image } : {}) }));
    return out;
  });
  return game;
}
function participantHtml(game = gameForExport()){
  return PARTICIPANT_TEMPLATE.split(GAME_PACK_SLOT).join(JSON.stringify(Pack.seal(game)));
}
function renderExport(){
  const game = gameForExport();
  const problems = Play.validateGame(game);
  const moved = GAME.locations.filter(isMoved).length;
  const challenges = game.locations.reduce((n, l) => n + (l.tasks || []).length, 0);
  $("exportInfo").textContent = !canExport
    ? "Export works in the built admin file (dist/chinatown-hunt-admin.html). Run node build.js."
    : problems.length
      ? `Fix ${problems.length === 1 ? "this" : "these"} before exporting:\n${problems.map(p => "• " + p).join("\n")}`
      : `${game.locations.length} locations${moved ? `, ${moved} moved from the default` : ""} · ${challenges} challenges. ` +
        `The file has no admin tools and its content is scrambled. Upload it to your host; participants open the plain link.`;
  $("exportInfo").classList.toggle("bad", canExport && problems.length > 0);
  $("draftInfo").textContent = draft.error || "Your changes are saved in this browser as you go.";
  $("draftInfo").classList.toggle("bad", !!draft.error);
  $("exportGame").disabled = !canExport || problems.length > 0;
  if (canExport && !problems.length && mapStatus.kind !== "google")
    $("exportInfo").textContent += "\nNote: this file will show OpenStreetMap, not Google Maps. Add a working Google Maps key under Map first.";
}
$("exportGame").onclick = () => {
  if (Play.validateGame(gameForExport()).length) return;
  downloadFile(new File([participantHtml()], "chinatown-hunt.html", { type:"text/html" }));
};

// Load a previously exported game file back in as the draft: the way to move work between computers
// or recover it after browser data was cleared.
$("importGame").onchange = async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  let game;
  try {
    const m = /Pack\.open\("(cth1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+)"\)/.exec(await file.text());
    if (!m) throw new Error("it isn't an exported game file");
    game = Pack.open(m[1]);
    if (game.id !== GAME.id || !Array.isArray(game.locations)) throw new Error("it is a different game");
  } catch(err){ alert(`Couldn't import ${file.name}: ${err.message}.`); return; }
  if (!confirm(`Replace the game you're building here with the one in ${file.name}?`)) return;
  try { store.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), game })); }
  catch(err){ alert("Couldn't save the imported game in this browser (storage full?)."); return; }
  location.reload();
};
$("resetDraft").onclick = () => {
  if (!confirm("Throw away all your changes (locations, text and challenges) and start again from the default game? Export first if you might want them.")) return;
  store.removeItem(DRAFT_KEY); store.removeItem(POI_KEY);
  location.reload();
};

/* ════════════════════════════════════════════════════════════════════
   CHALLENGES — the arrival text and the ordered challenges for the
   selected location. Add, edit, reorder (↑ ↓) and delete; each challenge
   is checked with Play.validateTask before it can be saved.
   ════════════════════════════════════════════════════════════════════ */
let editing = null;       // { locId, index } of the challenge in the form; index -1 for a new one

const selectedLocation = () => GAME.locations.find(l => l.id === capSel.value);

function renderTasks(){
  const l = selectedLocation(); if (!l) return;
  const arrival = $("arrivalEdit");
  if (document.activeElement !== arrival) arrival.value = l.arrivalText || "";
  const tasks = l.tasks || [];
  $("taskCount").textContent = tasks.length ? `${tasks.length} challenge${tasks.length === 1 ? "" : "s"}, played in this order` : "No challenges yet";
  $("taskList").replaceChildren(...tasks.map((t, i) => {
    const problems = Play.validateTask(t);
    const li = document.createElement("li");
    li.dataset.id = t.id;
    li.className = problems.length ? "bad" : "";
    li.innerHTML = `<div class="tsum"><span class="tnum"></span><span class="tpts"></span></div><div class="tprompt"></div><div class="tprob"></div>
      <div class="tbtns"><button class="btn tup" title="Move up">↑</button><button class="btn tdown" title="Move down">↓</button><button class="btn tedit">Edit</button><button class="btn warn tdel">Delete</button></div>`;
    li.querySelector(".tnum").textContent = i + 1;
    li.querySelector(".tpts").textContent = t.image ? "image" : "";
    li.querySelector(".tprompt").textContent = t.prompt || (t.image ? "(picture only)" : "(empty)");
    li.querySelector(".tprob").textContent = problems.join(" · ");
    li.querySelector(".tup").disabled = i === 0;
    li.querySelector(".tdown").disabled = i === tasks.length - 1;
    li.querySelector(".tup").onclick = () => moveTask(l, i, -1);
    li.querySelector(".tdown").onclick = () => moveTask(l, i, +1);
    li.querySelector(".tedit").onclick = () => openTaskForm(l, i);
    li.querySelector(".tdel").onclick = () => deleteTask(l, i);
    return li;
  }));
  if (editing && editing.locId !== l.id) closeTaskForm();
}

$("arrivalEdit").addEventListener("input", e => {
  const l = selectedLocation(); if (!l) return;
  l.arrivalText = e.target.value;
  saveDraft();
});

function moveTask(l, i, dir){
  const j = i + dir, tasks = l.tasks;
  if (j < 0 || j >= tasks.length) return;
  [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
  if (editing?.locId === l.id) closeTaskForm();
  saveDraft(); renderTasks();
}
function deleteTask(l, i){
  if (!confirm(`Delete challenge ${i + 1} at ${l.name}? Teams who already answered it keep their points.`)) return;
  l.tasks.splice(i, 1);
  if (editing?.locId === l.id) closeTaskForm();
  saveDraft(); renderTasks();
}

// The form works on a copy; nothing changes until Save succeeds.
function openTaskForm(l, index){
  const t = index >= 0 ? structuredClone(l.tasks[index]) : { prompt:"" };
  editing = { locId: l.id, index };
  $("tfTitle").textContent = index >= 0 ? `Edit challenge ${index + 1}` : "New challenge";
  $("tfPrompt").value = t.prompt || "";
  $("tfImage").value = t.image || "";
  showImagePreview($("tfImagePrev"), t.image);
  $("tfErrors").textContent = "";
  $("taskForm").hidden = false; $("taskAdd").hidden = true;
  $("tfPrompt").focus();
}
function closeTaskForm(){
  editing = null;
  $("taskForm").hidden = true; $("taskAdd").hidden = false;
}
// A challenge is its text and an optional picture; teams answer it in LoQuiz.
function readTaskForm(){
  const t = { prompt: $("tfPrompt").value.trim() };
  const image = $("tfImage").value.trim();
  if (image) t.image = image;
  return t;
}

$("tfImage").addEventListener("input", e => showImagePreview($("tfImagePrev"), e.target.value));
$("taskAdd").onclick = () => { const l = selectedLocation(); if (l) openTaskForm(l, -1); };
$("tfCancel").onclick = closeTaskForm;
$("tfSave").onclick = () => {
  const l = GAME.locations.find(x => x.id === editing?.locId); if (!l) return;
  const t = readTaskForm();
  const problems = Play.validateTask(t);
  if (problems.length) { $("tfErrors").textContent = "Can't save yet: " + problems.join(" · "); return; }
  l.tasks = l.tasks || [];
  if (editing.index >= 0) l.tasks[editing.index] = { id: l.tasks[editing.index].id, ...t };   // fields from older versions are dropped
  else l.tasks.push({ id: Play.newTaskId(GAME), ...t });
  closeTaskForm(); saveDraft(); renderTasks();
};

/* ════════════════════════════════════════════════════════════════════
   CLUES & SUSPECTS — the game length, when the clues appear, and the two
   lists. Every field saves as you type; ↑ ↓ set the order they're shown in.
   ════════════════════════════════════════════════════════════════════ */
function wholeNumber(v){ return v.trim() === "" ? NaN : Number(v); }
function renderMystery(){
  const d = $("durationEdit"), r = $("revealEdit");
  if (document.activeElement !== d) d.value = GAME.durationMinutes;
  if (document.activeElement !== r) r.value = GAME.revealMinutes;
  const ok = Number.isInteger(GAME.durationMinutes) && Number.isInteger(GAME.revealMinutes) && GAME.revealMinutes <= GAME.durationMinutes;
  $("timingInfo").textContent = ok
    ? `Each team's clock starts when they tap Begin. Clues appear ${GAME.durationMinutes - GAME.revealMinutes} minutes in, or as soon as a team has finished every location.`
    : "";
  editableList("clueEdit", "clueCount", GAME.clues, "clue", c => [
    field("textarea", c.text, "What the teams read", v => { c.text = v; }),
    ...imageField(c),
  ]);
  editableList("suspectEdit", "suspectCount", GAME.suspects, "suspect", s => [
    field("input", s.name, "Name", v => { s.name = v; }),
    field("textarea", s.blurb || "", "One line about them (optional)", v => { s.blurb = v; }),
    ...imageField(s),
  ]);
}
// An optional image link with a live preview; an empty link removes the image.
function imageField(item){
  const prev = document.createElement("div");
  prev.className = "imgprev";
  const input = field("input", item.image || "", "Image link (optional): https://…", v => {
    const url = v.trim();
    if (url) item.image = url; else delete item.image;
    showImagePreview(prev, url);
  });
  input.classList.add("imglink");
  input.inputMode = "url";
  showImagePreview(prev, item.image);
  return [input, prev];
}
function field(tag, value, placeholder, set){
  const el = document.createElement(tag);
  if (tag === "input") el.type = "text"; else el.rows = 2;
  el.className = "prose"; el.value = value; el.placeholder = placeholder;
  el.addEventListener("input", () => { set(el.value); saveDraft(); });
  return el;
}
// A list of rows, each with its fields, ↑ ↓ and Delete. Rebuilt on add, move and delete only.
function editableList(listId, countId, items, noun, fields){
  $(countId).textContent = items.length ? `${items.length}, shown in this order` : "none yet";
  const list = $(listId);
  if (list.dataset.n === String(items.length) && list.dataset.ids === items.map(x => x.id).join()) return;   // keep focus while typing
  list.dataset.n = items.length; list.dataset.ids = items.map(x => x.id).join();
  list.replaceChildren(...items.map((item, i) => {
    const li = document.createElement("li");
    li.dataset.id = item.id;
    const btns = document.createElement("div");
    btns.className = "tbtns";
    btns.innerHTML = `<button class="btn tup" title="Move up">↑</button><button class="btn tdown" title="Move down">↓</button><button class="btn warn tdel">Delete</button>`;
    btns.querySelector(".tup").disabled = i === 0;
    btns.querySelector(".tdown").disabled = i === items.length - 1;
    const move = dir => { [items[i], items[i + dir]] = [items[i + dir], items[i]]; saveDraft(); renderMystery(); };
    btns.querySelector(".tup").onclick = () => move(-1);
    btns.querySelector(".tdown").onclick = () => move(+1);
    btns.querySelector(".tdel").onclick = () => {
      if (!confirm(`Delete ${noun} ${i + 1}?`)) return;
      items.splice(i, 1); saveDraft(); renderMystery();
    };
    li.append(...fields(item), btns);
    return li;
  }));
}
function addItem(key, prefix, blank){
  const all = [...(GAME.clues || []), ...(GAME.suspects || [])].map(x => x.id);
  GAME[key] = GAME[key] || [];
  GAME[key].push({ id: Play.newId(prefix, all), ...blank });
  saveDraft(); renderMystery();
  $(key === "clues" ? "clueEdit" : "suspectEdit").querySelector("li:last-child .prose")?.focus();
}
$("clueAdd").onclick = () => addItem("clues", "c", { text: "" });
$("suspectAdd").onclick = () => addItem("suspects", "s", { name: "", blurb: "" });
for (const [id, key] of [["durationEdit", "durationMinutes"], ["revealEdit", "revealMinutes"]]) {
  $(id).addEventListener("input", e => {
    GAME[key] = wholeNumber(e.target.value);
    if (key === "durationMinutes" && Number.isInteger(GAME[key]) && GAME[key] > 0) {
      $("clockSet").max = GAME[key];
      state.clockMinutes = GAME[key]; $("clockSet").value = GAME[key]; $("clockSetO").textContent = GAME[key] + " min";
      state.startedAt = Date.now(); save(); renderClock();
    }
    saveDraft(); renderMystery(); checkReveal();
  });
}

// Preview the clues screen as teams will see it, without touching this session's progress.
const previewClose = document.createElement("button");
previewClose.id = "revealClose"; previewClose.className = "btn primary"; previewClose.hidden = true;
previewClose.textContent = "Close preview (admin)";
$("reveal").querySelector(".revealcard").prepend(previewClose);
$("previewReveal").onclick = () => { renderReveal(true); previewClose.hidden = false; makeRoomForMap(); };
previewClose.onclick = () => { previewClose.hidden = true; renderReveal(); };

/* ════════════════════════════════════════════════════════════════════
   MAP — the Google Maps key. It is saved with the draft and goes into the
   exported file (any web map's key is visible to its users; Google's
   website restriction on the key is what protects it).
   ════════════════════════════════════════════════════════════════════ */
function renderMap(){
  const input = $("mapKey"), key = String(GAME.map?.googleKey ?? "").trim();
  if (document.activeElement !== input) input.value = key;
  const info = $("mapInfo");
  const text =
    mapStatus.kind === "google" ? `Google Maps is on (${mapStatus.type === "satellite" ? "satellite" : "map"} view). Teams will see Google's map.` :
    mapStatus.problem ? `Using OpenStreetMap because Google didn't work: ${mapStatus.problem}.` :
    key ? "Connecting to Google…" :
    "No key: the map uses OpenStreetMap. That's fine for testing, but not allowed for paid events.";
  info.textContent = text;
  info.classList.toggle("bad", mapStatus.kind !== "google" && !!(mapStatus.problem || !key));
}
function applyMapKey(){
  const key = $("mapKey").value.trim();
  GAME.map = { ...(GAME.map || {}), googleKey: key };
  saveDraft();
  mapStatus.problem = null;
  renderMap();
  setMapSource();
}
$("mapKeyApply").onclick = applyMapKey;
$("mapKey").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); applyMapKey(); } });
hooks.mapSource.push(() => { renderMap(); renderExport(); });

/* ════════════════════════════════════════════════════════════════════
   IMAGE LINKS — previews while typing, and a check that every link in the
   game actually loads, since a typo would only show up on a team's phone.
   ════════════════════════════════════════════════════════════════════ */
function showImagePreview(box, url){
  const s = String(url ?? "").trim();
  const problem = Play.imageProblem(s);
  box.replaceChildren();
  box.className = "imgprev";
  if (!s) return;
  if (problem) { box.textContent = problem; box.classList.add("bad"); return; }
  const img = document.createElement("img");
  img.alt = "Preview"; img.src = s;
  img.onerror = () => { box.textContent = "This link doesn't load an image. Check the address."; box.classList.add("bad"); };
  box.append(img);
}
function loads(url, timeout = 15000){
  return new Promise(resolve => {
    const img = new Image();
    const t = setTimeout(() => resolve(false), timeout);
    img.onload = () => { clearTimeout(t); resolve(true); };
    img.onerror = () => { clearTimeout(t); resolve(false); };
    img.src = url;
  });
}
// Where each link is used, for the report: "Thian Hock Keng Temple, challenge 2", "Clue 3", "Suspect: Tan Boon Seng".
function imageUses(){
  const uses = [];
  for (const l of GAME.locations) (l.tasks || []).forEach((t, i) => t.image && uses.push({ url: t.image.trim(), where: `${l.name}, challenge ${i + 1}` }));
  (GAME.clues || []).forEach((c, i) => c.image && uses.push({ url: c.image.trim(), where: `Clue ${i + 1}` }));
  (GAME.suspects || []).forEach(s => s.image && uses.push({ url: s.image.trim(), where: `Suspect: ${s.name || "(no name)"}` }));
  return uses.filter(u => u.url && !Play.imageProblem(u.url));
}
$("checkImages").onclick = async () => {
  const uses = imageUses(), info = $("imageInfo");
  info.classList.remove("bad");
  if (!uses.length) { info.textContent = "No images in the game yet."; return; }
  $("checkImages").disabled = true;
  info.textContent = `Checking ${uses.length} image link${uses.length === 1 ? "" : "s"}…`;
  const urls = [...new Set(uses.map(u => u.url))];
  const ok = new Map(await Promise.all(urls.map(async u => [u, await loads(u)])));
  const broken = uses.filter(u => !ok.get(u.url));
  info.textContent = broken.length
    ? `${broken.length} image${broken.length === 1 ? "" : "s"} didn't load:\n${broken.map(b => `• ${b.where}: ${b.url}`).join("\n")}`
    : `All ${urls.length} image link${urls.length === 1 ? "" : "s"} load.`;
  info.classList.toggle("bad", broken.length > 0);
  $("checkImages").disabled = false;
};

/* ════════════════════════════════════════════════════════════════════
   WALK RECORDER — export
   Download uses a blob link, which iOS Safari 13+ saves to Files; the URL is
   kept alive for a minute because iOS reads it after the click returns.
   Share hands the file to the system share sheet (AirDrop, Mail, Save to
   Files) where the browser supports sharing files.
   ════════════════════════════════════════════════════════════════════ */
function walkFile(type){
  flushWalk();
  const data = Walk.toWalk(walk.log, {
    title: GAME.title, cfg: state.cfg,
    locations: GAME.locations.map(l => ({ ...l, radius: Engine.radiusOf(l, state.cfg) })),
  });
  return new File([JSON.stringify(data)], Walk.filename(), { type });
}
function renderWalk(){
  const s = Walk.summary(walk.log);
  const dur = s.count ? fmtDuration(s.last - s.first) : "0:00:00";
  const sources = Object.entries(s.bySource).map(([k, n]) => `${k} ${n}`).join(", ");
  const saved = walk.savedAt ? `saved ${Math.max(0, Math.round((Date.now() - walk.savedAt)/1000))}s ago` : (walk.dirty ? "not saved yet" : "saved");
  $("walkStatus").textContent = walk.error ||
    `${s.count} fixes recorded · ${dur}${sources ? ` · ${sources}` : ""}\n${s.count ? saved : "Starts automatically with any position source."}`;
  $("walkStatus").classList.toggle("bad", !!walk.error);
}
function fmtDuration(ms){
  const t = Math.max(0, Math.round(ms/1000));
  return `${Math.floor(t/3600)}:${String(Math.floor(t%3600/60)).padStart(2,"0")}:${String(t%60).padStart(2,"0")}`;
}

$("walkDownload").onclick = () => {
  if (!walk.log.length) { alert("Nothing recorded yet."); return; }
  downloadFile(walkFile("application/json"));
};
function downloadFile(file){
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement("a"), { href:url, download:file.name, rel:"noopener" });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
// text/plain is the file type share sheets accept most widely; the .json name is kept.
const canShareFiles = (() => { try { return !!navigator.canShare?.({ files:[new File(["{}"], "x.json", { type:"text/plain" })] }); } catch(e){ return false; } })();
$("walkShare").hidden = !canShareFiles;
$("walkShare").onclick = async () => {
  if (!walk.log.length) { alert("Nothing recorded yet."); return; }
  const file = walkFile("text/plain");
  try { await navigator.share({ files:[file], title:file.name }); }
  catch(e){ if (e.name !== "AbortError") alert(`Sharing failed (${e.message}). Try Download instead.`); }
};
$("walkClear").onclick = () => {
  if (!walk.log.length || !confirm(`Delete the ${walk.log.length} recorded fixes on this device? Download them first if you need them.`)) return;
  walk.log = []; walk.dirty = true; flushWalk(); renderWalk();
};

/* ════════════════════════════════════════════════════════════════════
   REPLAY — play a walk file back through onFix, exactly like a live feed.
   Each fix keeps its recorded t, so the engine's timing (the override dwell)
   matches the original walk at any speed. Only the real-time wait between
   fixes is scaled, and capped so long pauses in the recording don't stall.
   ════════════════════════════════════════════════════════════════════ */
const SPEEDS = [1, 2, 5, 10, 30, 60, 120];
const MAX_WAIT_MS = 3000;
const replay = { fixes:[], i:0, timer:null, playing:false, name:"", skipped:0 };
function replaySpeed(){ return SPEEDS[+$("replaySpeed").value] || 1; }

$("replayFile").onchange = async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  try {
    const w = Walk.parse(await file.text());
    stopReplay();
    Object.assign(replay, { fixes:w.fixes, i:0, name:file.name, skipped:w.skipped });
  } catch(err){ alert(`Couldn't load ${file.name}: ${err.message}.`); }
  renderReplay();
};

function playReplay(){
  if (!replay.fixes.length) return;
  if (replay.i === 0) {
    const progress = state.progress.active || state.progress.completed.length || Object.values(state.streaks).some(Boolean);
    if (progress && !confirm("Replay from a clean slate? This clears opened locations and streaks on this device.")) return;
    clearProgress();
  }
  hooks.beforeSource.forEach(h => h("replay"));
  stopReal();
  feed.source = "replay"; feed.gpsIssue = null; replay.playing = true;
  setSrcButtons(); renderReplay(); stepReplay();
}
function stepReplay(){
  if (!replay.playing) return;
  const f = replay.fixes[replay.i++];
  onFix({ lat:f.lat, lng:f.lng, accuracy:f.accuracy, t:f.t }, "replay");
  if (replay.i >= replay.fixes.length) { replay.playing = false; renderReplay(); render(); return; }
  const gap = Math.max(0, replay.fixes[replay.i].t - f.t);
  replay.timer = setTimeout(stepReplay, Math.min(gap / replaySpeed(), MAX_WAIT_MS));
  if (drawerOpen) renderReplay();
}
function pauseReplay(){
  replay.playing = false; clearTimeout(replay.timer); replay.timer = null;
  if (feed.source === "replay") feed.source = "none";
  renderReplay();
}
function stopReplay(){ pauseReplay(); replay.i = 0; renderReplay(); render(); }

function renderReplay(){
  const n = replay.fixes.length, done = replay.i >= n && n > 0;
  $("replayStatus").textContent = !n ? "No walk loaded." :
    `${replay.name}\nfix ${replay.i} of ${n} · ${fmtDuration((replay.fixes[Math.max(0, replay.i-1)].t) - replay.fixes[0].t)} of ${fmtDuration(replay.fixes[n-1].t - replay.fixes[0].t)}` +
    (replay.skipped ? ` · ${replay.skipped} unusable entries skipped` : "") + (done ? " · finished" : "");
  $("replayPlay").disabled = !n;
  $("replayPlay").textContent = replay.playing ? "Pause" : done ? "Replay again" : replay.i ? "Resume" : "Play";
  $("replayStop").disabled = !n || (!replay.playing && replay.i === 0);
}
$("replayPlay").onclick = () => {
  if (replay.playing) { pauseReplay(); render(); return; }
  if (replay.i >= replay.fixes.length) replay.i = 0;
  playReplay();
};
$("replayStop").onclick = stopReplay;
slider("replaySpeed", v => (SPEEDS[+v] || 1) + "×", () => render());

// Clears opened locations, streaks and override timers, on screen and in storage.
function clearProgress(){
  Object.assign(state, { progress: Play.emptyProgress(), streaks:{}, nearSince:{}, overrideReady:[] });
  GAME.locations.forEach(l => styleLocation(l.id));
  save(); renderSheet(); render(); renderReveal();
}

/* ════════════════════════════════════════════════════════════════════
   PREVIEW AS PARTICIPANT — opens this file with ?preview in a phone-sized
   window: the game exactly as participants see it, built from the draft,
   with its own progress. Location is faked like LoQuiz's fake location:
   the preview replaces the browser's geolocation, so positions still go
   through the game's real GPS path (watchPosition → onFix → engine).
   ════════════════════════════════════════════════════════════════════ */
$("previewGame").onclick = () => {
  saveDraft();
  const w = window.open(`${location.pathname}?preview`, "chinatown-preview", "width=430,height=880");
  if (!w) alert("Your browser blocked the preview window. Allow pop-ups for this page and try again.");
  else w.focus();
};

function startPreview(){
  // Fake geolocation: every watcher gets the chosen position now and every second after, at ±5 m.
  const fake = { at: null, watchers: new Map(), next: 1 };
  const position = () => ({ coords: { latitude: fake.at.lat, longitude: fake.at.lng, accuracy: 5,
    altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
  const emit = () => { if (fake.at) for (const ok of fake.watchers.values()) ok(position()); };
  const geo = {
    watchPosition(ok){ const id = fake.next++; fake.watchers.set(id, ok); setTimeout(emit, 0); return id; },
    clearWatch(id){ fake.watchers.delete(id); },
    getCurrentPosition(ok){ if (fake.at) setTimeout(() => ok(position()), 0); },
  };
  try { Object.defineProperty(navigator, "geolocation", { value: geo, configurable: true }); } catch(e){}
  setInterval(emit, 1000);

  const marker = L.circleMarker([0, 0], { radius: 9, color: "#8A6D2F", weight: 3, fillColor: "#FFF8E6", fillOpacity: 1 });
  function place(lat, lng){
    fake.at = { lat, lng };
    marker.setLatLng([lat, lng]).addTo(map);
    emit();
    renderBar();
  }
  map.on("click", e => place(e.latlng.lat, e.latlng.lng));
  // Pins catch their own clicks; clicking one puts you on it.
  for (const pin of Object.values(pins)) pin.on("click", () => { const ll = pin.getLatLng(); place(ll.lat, ll.lng); });

  const bar = $("devbanner");
  bar.id = "previewbar";
  bar.innerHTML = `<strong>Preview</strong>
    <select id="pvGo" aria-label="Go to a location"></select>
    <button type="button" id="pvClues">Skip to clues</button>
    <button type="button" id="pvRestart">Restart</button>
    <span id="pvHint"></span>`;
  const go = $("pvGo");
  go.replaceChildren(new Option("Go to…", ""), ...GAME.locations.map((l, i) => new Option(`${i + 1}. ${l.name}`, l.id)));
  go.onchange = () => {
    const l = GAME.locations.find(x => x.id === go.value); go.value = "";
    if (l) { place(l.lat, l.lng); map.setView([l.lat, l.lng], Math.max(map.getZoom(), 18)); }
  };
  $("pvClues").onclick = () => {
    if (!state.startedAt) { alert("Tap Begin first: the clock starts then."); return; }
    state.startedAt = Date.now() - (state.clockMinutes - GAME.revealMinutes) * 60000;
    save(); renderClock(); checkReveal();
  };
  $("pvRestart").onclick = () => {
    if (!confirm("Restart the preview from the start screen?")) return;
    store.removeItem(KEY);
    location.reload();
  };
  function renderBar(){
    $("pvHint").textContent = !state.startedAt ? "Tap Begin, then click the map to set your location."
      : state.progress.revealed ? "The clues are showing. Restart to play again."
      : state.progress.active ? "A location is open. Finish it to see the map again."
      : fake.at ? "You're where you clicked. Click elsewhere to move." : "Click the map to set your location.";
  }
  hooks.render.push(renderBar);
  $("startBtn").addEventListener("click", () => setTimeout(renderBar, 0));
  renderBar();
}

/* ════════════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════════════ */
// The game drew its screens before the draft was applied above; redraw them with the admin's content.
renderSheet();
setMapSource(); renderMap();
document.title = `${GAME.title} · ${PREVIEW ? "Preview" : "Admin"}`;
renderGameText(); renderPoi(); renderMystery(); renderExport(); setSrcButtons(); renderLog(); render(); checkReveal();
if (PREVIEW) startPreview();
else if (wideScreen.matches) toggleDrawer(true);      // on a computer, open with the tools showing

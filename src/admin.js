import { Engine } from "./engine.js";
import { Walk } from "./session.js";
import { Poi } from "./poi.js";
import { Pack } from "./pack.js";
import { GAME } from "./game.js";
import { store, state, save, feed, hooks, ui, map, pins, rings, onFix, markReached, styleRing,
  $, render, renderClock, openSheet, startReal, stopReal, hideStart } from "./app.js";

/* ════════════════════════════════════════════════════════════════════
   ADMIN & DEV TOOLS — only in the admin file (chinatown-hunt-admin.html).
   Setting up the game (locations, radii), exporting the participant file,
   and testing: the location emulator, walk recorder and replay.
   The participant file is built without this module.
   ════════════════════════════════════════════════════════════════════ */
const ADMIN_KEY = "chinatown-hunt-m1";          // where earlier versions kept edits and recordings; kept so they survive

ui.startScreen = false; hideStart();
document.body.classList.add("dev");
document.title = `${GAME.title} · Admin`;
// Testing in the admin file runs the clock from first load, as the field rig always has.
if (!state.startedAt) { state.startedAt = Date.now(); save(); renderClock(); }

/* ════════════════════════════════════════════════════════════════════
   LOCATION EDITS — stored on this device as edits over GAME. An edit is
   dropped once GAME no longer has the coordinates it was made against.
   ════════════════════════════════════════════════════════════════════ */
const POI_KEY = ADMIN_KEY + ":poi";
const GAME_BASE = structuredClone(GAME.locations);
const poi = { edits:{}, notice:"" };
{
  let stored = {};
  try { stored = JSON.parse(store.getItem(POI_KEY)) || {}; } catch(e){}
  const r = Poi.apply(GAME_BASE, stored);
  r.locations.forEach(l => {
    const live = GAME.locations.find(x => x.id === l.id);
    Object.assign(live, { lat:l.lat, lng:l.lng, radius:l.radius });
    pins[l.id].setLatLng([l.lat, l.lng]);
    rings[l.id].setLatLng([l.lat, l.lng]).setRadius(Engine.radiusOf(live, state.cfg));
  });
  poi.edits = r.edits;
  if (r.applied.length) map.fitBounds(GAME.locations.map(l => [l.lat, l.lng]), { padding:[40, 40], maxZoom:18 });
  if (r.stale.length) poi.notice = `Dropped edits for ${r.stale.map(id => GAME_BASE.find(l => l.id === id).name).join(", ")}: the game's coordinates changed since they were made.`;
  if (r.stale.length || r.unknown.length) { try { store.setItem(POI_KEY, JSON.stringify(poi.edits)); } catch(e){} }
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
  if (src !== "replay") { Walk.record(walk.log, fix, src); walk.dirty = true; }
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
    `opened ${state.opened.length} / ${GAME.locations.length}\n` +
    `ceil   ${state.cfg.accuracyCeiling} m   streak ${state.cfg.consecutiveFixes}   radius ${state.cfg.radius} m\n\n` +
    (ranges||[]).slice(0,4).map(g =>
      `${state.opened.includes(g.id) ? "●" : "○"} ${g.name.padEnd(24).slice(0,24)} ${String(Math.round(g.d)).padStart(5)}m  ${(state.streaks[g.id]||0)}/${state.cfg.consecutiveFixes}`
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
GAME.locations.forEach(l => {
  jumpSel.insertAdjacentHTML("beforeend", `<option value="${l.id}">${l.name}</option>`);
  capSel.insertAdjacentHTML("beforeend", `<option value="${l.id}">${l.name}</option>`);
});
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
slider("clockSet", v => v+" min", v => { state.clockMinutes = +v; state.startedAt = Date.now(); renderClock(); }, state.clockMinutes);

$("blowAcc").onclick = () => {
  const p = sim.at || map.getCenter();
  onFix({ lat:p.lat, lng:p.lng, accuracy:80 }, "sim");
  renderLog();
};

$("forceOpen").onclick = () => {
  const ranges = state.fix ? Engine.ranges(state.fix, GAME.locations, state.cfg) : Engine.ranges({lat:map.getCenter().lat,lng:map.getCenter().lng,accuracy:10}, GAME.locations, state.cfg);
  const next = ranges.find(g => !state.opened.includes(g.id)); if (!next) return;
  state.opened.push(next.id); markReached(next.id); save(); makeRoomForMap(); openSheet(next.id); render();
};
$("openAll").onclick = () => { GAME.locations.forEach(l => { if(!state.opened.includes(l.id)) state.opened.push(l.id); markReached(l.id); }); save(); render(); };
$("reset").onclick = () => {
  if (!confirm("Clear all game progress? Location edits and the walk recording are kept.")) return;
  clearProgress();
  state.startedAt = Date.now(); save(); renderClock();
};

/* ════════════════════════════════════════════════════════════════════
   LOCATIONS — set each POI by hand: drag any pin (computer), place it on
   the map, paste coordinates, or use the current position; the radius
   slider applies at once. Edits take effect in the engine immediately and
   go into the participant file on export.
   ════════════════════════════════════════════════════════════════════ */
function setPoi(id, changes){
  const base = GAME_BASE.find(l => l.id === id), l = GAME.locations.find(x => x.id === id);
  if (!base || !l) return;
  poi.edits = Poi.edit(poi.edits, base, changes);
  const v = poi.edits[id]?.value ?? { lat:base.lat, lng:base.lng, radius:base.radius };
  Object.assign(l, { lat:v.lat, lng:v.lng, radius:v.radius ?? undefined });
  pins[id].setLatLng([l.lat, l.lng]);
  rings[id].setLatLng([l.lat, l.lng]).setRadius(Engine.radiusOf(l, state.cfg));
  try { store.setItem(POI_KEY, JSON.stringify(poi.edits)); } catch(e){ poi.notice = "Couldn't save location edits on this device."; }
  renderPoi(); render();
}

function renderPoi(){
  const l = GAME.locations.find(x => x.id === capSel.value); if (!l) return;
  const n = Object.keys(poi.edits).length, r = Engine.radiusOf(l, state.cfg);
  $("poiInfo").textContent =
    `${l.lat.toFixed(6)}, ${l.lng.toFixed(6)} · radius ${r} m · ${poi.edits[l.id] ? "moved" : "as in the default game"}` +
    (wideScreen.matches ? "\nDrag any pin on the map to move it." : "") +
    (n ? `\n${n} of ${GAME.locations.length} locations moved. Saved in this browser; Export game file to publish them.` : "") +
    (poi.notice ? `\n${poi.notice}` : "");
  $("capRad").value = r; $("capRadO").textContent = r + " m";
  $("poiRevert").disabled = !poi.edits[l.id];
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
GAME.locations.forEach(l => {
  pins[l.id].on("dragstart", () => {
    if (capSel.value !== l.id) { capSel.value = l.id; renderPoi(); }
  });
  pins[l.id].on("drag", e => rings[l.id].setLatLng(e.latlng));      // the geofence follows the pin
  pins[l.id].on("dragend", () => {
    const ll = pins[l.id].getLatLng();
    setPoi(l.id, { lat:ll.lat, lng:ll.lng });
  });
});

capSel.onchange = () => {
  const wasPlacing = poiMode;
  endPlacing(); renderPoi();
  const l = GAME.locations.find(x => x.id === capSel.value);
  if (l) map.setView([l.lat, l.lng], 18);
  if (wasPlacing) startPlacing();
};
$("poiPlace").onclick = startPlacing;
$("poiCoords").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("poiApply").click(); } });
// With the panel open, clicking a pin selects that location for editing (not while placing another).
GAME.locations.forEach(l => pins[l.id].on("click", () => {
  if (!drawerOpen || poiMode || capSel.value === l.id) return;
  capSel.value = l.id; renderPoi();
}));
$("poiDone").onclick = () => { endPlacing(); toggleDrawer(true); };
$("poiApply").onclick = () => {
  const id = capSel.value;
  let p;
  try { p = Poi.parseCoords($("poiCoords").value); }
  catch(e){ alert(`Couldn't read those coordinates: ${e.message}.`); return; }
  const base = GAME_BASE.find(l => l.id === id);
  const km = Engine.haversine(base.lat, base.lng, p.lat, p.lng) / 1000;
  setPoi(id, p);
  $("poiCoords").value = "";
  if (km > 2) { poi.notice = `Heads up: that is ${km.toFixed(1)} km from where this location was. Check latitude comes first.`; renderPoi(); }
  map.setView([p.lat, p.lng], 18);
};
$("capHere").onclick = () => {
  if (!state.fix) { alert("No position yet. Start Real GPS or place a simulated position first."); return; }
  setPoi(capSel.value, { lat:state.fix.lat, lng:state.fix.lng });
  const l = GAME.locations.find(x => x.id === capSel.value);
  $("capOut").value = `Set ${l.name} to your position (±${Math.round(state.fix.accuracy)} m accuracy).`;
};
$("poiRevert").onclick = () => {
  const base = GAME_BASE.find(l => l.id === capSel.value); if (!base) return;
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
    return out;
  });
  return game;
}
function participantHtml(game = gameForExport()){
  return PARTICIPANT_TEMPLATE.split(GAME_PACK_SLOT).join(JSON.stringify(Pack.seal(game)));
}
function renderExport(){
  const moved = Object.keys(poi.edits).length;
  $("exportInfo").textContent = !canExport
    ? "Export works in the built admin file (dist/chinatown-hunt-admin.html). Run node build.js."
    : `${GAME.locations.length} locations${moved ? `, ${moved} moved from the default` : ""}. ` +
      `The file has no admin tools and its content is scrambled. Upload it to your host; participants open the plain link.`;
  $("exportGame").disabled = !canExport;
}
$("exportGame").onclick = () => {
  downloadFile(new File([participantHtml()], "chinatown-hunt.html", { type:"text/html" }));
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
    const progress = state.opened.length || Object.values(state.streaks).some(Boolean);
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
  Object.assign(state, { opened:[], streaks:{}, nearSince:{}, overrideReady:[] });
  GAME.locations.forEach(l => {
    pins[l.id]?.getElement()?.querySelector(".pin")?.classList.remove("reached");
    styleRing(l.id);
  });
  $("sheet").classList.remove("up");
  save(); render();
}

/* ════════════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════════════ */
renderPoi(); renderExport(); setSrcButtons(); renderLog(); render();
if (wideScreen.matches) toggleDrawer(true);      // on a computer, open with the tools showing

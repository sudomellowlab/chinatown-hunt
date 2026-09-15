import { Engine } from "./engine.js";
import { Walk } from "./session.js";

/* ════════════════════════════════════════════════════════════════════
   GAME CONTENT
   Everything a non-developer needs to edit lives in this one object.
   COORDINATES BELOW ARE APPROXIMATE PLACEHOLDERS. Walk the route with
   ?dev=1, use the capture tool at the bottom of the drawer, and paste
   the exported array back over GAME.locations.
   ════════════════════════════════════════════════════════════════════ */
const GAME = {
  title: "Historical Hunt — Chinatown",
  durationMinutes: 120,
  defaults: { radius: 25, accuracyCeiling: 50, consecutiveFixes: 3 },
  locations: [
    { id:"telok-ayer-green", name:"Telok Ayer Green", lat:1.28035, lng:103.84705, radius:25,
      arrivalText:"You are standing on what was once the shoreline. Telok Ayer means 'water bay' — every step east of here was sea until the reclamation of the 1880s." },
    { id:"thian-hock-keng", name:"Thian Hock Keng Temple", lat:1.28092, lng:103.84760, radius:22,
      arrivalText:"The Temple of Heavenly Happiness. Hokkien immigrants came here first to give thanks for surviving the crossing." },
    { id:"nagore-dargah", name:"Nagore Dargah", lat:1.28065, lng:103.84740, radius:22,
      arrivalText:"Built by Tamil Muslims from the Coromandel Coast. Note how its upper storey imitates a palace and its lower one a mosque." },
    { id:"al-abrar", name:"Al-Abrar Mosque", lat:1.27990, lng:103.84690, radius:22,
      arrivalText:"Once a thatched hut known as Masjid Chulia. The shophouse frontage hides a much older foundation." },
    { id:"ying-fo-fui-kun", name:"Ying Fo Fui Kun", lat:1.28150, lng:103.84800, radius:22,
      arrivalText:"A Hakka clan house, and one of the oldest surviving associations in the settlement." },
    { id:"amoy-street", name:"Amoy Street", lat:1.28000, lng:103.84650, radius:28,
      arrivalText:"Named for the port the Hokkiens sailed from. Look up: the five-foot way was a legal requirement of the Town Plan." },
    { id:"club-street", name:"Club Street", lat:1.28120, lng:103.84590, radius:28,
      arrivalText:"The clan associations and social clubs sat up this slope, above the noise of the trading streets." },
    { id:"ann-siang-hill", name:"Ann Siang Hill", lat:1.28050, lng:103.84600, radius:28,
      arrivalText:"Once a nutmeg and clove plantation, later the address of letter-writers and remittance houses." }
  ]
};

/* ════════════════════════════════════════════════════════════════════
   STORAGE — falls back to memory where localStorage is unavailable
   (sandboxed previews, private mode). Never throws.
   ════════════════════════════════════════════════════════════════════ */
const store = (() => {
  try { localStorage.setItem("__t","1"); localStorage.removeItem("__t"); return localStorage; }
  catch(e){ const m={}; return { getItem:k=>(k in m?m[k]:null), setItem:(k,v)=>{m[k]=String(v)}, removeItem:k=>{delete m[k]} }; }
})();
const KEY = "chinatown-hunt-m1";


/* ════════════════════════════════════════════════════════════════════
   STATE
   ════════════════════════════════════════════════════════════════════ */
const state = {
  cfg: { ...GAME.defaults },
  streaks: {},
  opened: [],
  startedAt: null,
  clockMinutes: GAME.durationMinutes,
  fix: null,
  fixes: 0,
  log: [],
  nearSince: {},         // locId -> fix.t first seen within override range (engine-owned)
  overrideReady: []      // locIds eligible for the manual override, as of the last fix
};
function save(){ try{ store.setItem(KEY, JSON.stringify({ opened:state.opened, startedAt:state.startedAt, locations:GAME.locations })); }catch(e){} }
function load(){
  try{
    const raw = store.getItem(KEY); if(!raw) return;
    const d = JSON.parse(raw);
    if (Array.isArray(d.opened)) state.opened = d.opened;
    if (d.startedAt) state.startedAt = d.startedAt;
    if (Array.isArray(d.locations) && d.locations.length === GAME.locations.length) {
      d.locations.forEach((l,i) => { if(l.id === GAME.locations[i].id){ GAME.locations[i].lat=l.lat; GAME.locations[i].lng=l.lng; GAME.locations[i].radius=l.radius; } });
    }
  }catch(e){}
}
load();
if (!state.startedAt) { state.startedAt = Date.now(); save(); }

/* Walk recording: every fix the engine sees, kept apart from game progress so that
   resetting progress never loses a walk. Flushed every few seconds and when the page
   hides, so a crash or a killed tab loses at most the last few fixes. */
const WALK_KEY = KEY + ":walk";
const walk = { log: [], dirty: false, savedAt: null, error: null };
try { const saved = JSON.parse(store.getItem(WALK_KEY)); if (Array.isArray(saved)) walk.log = saved; } catch(e){}
function flushWalk(){
  if (!walk.dirty) return;
  try { store.setItem(WALK_KEY, JSON.stringify(walk.log)); walk.dirty = false; walk.savedAt = Date.now(); walk.error = null; }
  catch(e){ walk.error = "Couldn't save the recording on this device (storage full?). Download it now."; }
}
setInterval(flushWalk, 5000);
addEventListener("pagehide", flushWalk);

/* ════════════════════════════════════════════════════════════════════
   MAP
   ════════════════════════════════════════════════════════════════════ */
const map = L.map("map", { zoomControl:false, attributionControl:true })
  .setView([1.28055, 103.84690], 17);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "© OpenStreetMap"
}).addTo(map);
L.control.zoom({ position:"topright" }).addTo(map);

const pins = {}, rings = {};
GAME.locations.forEach((l, i) => {
  rings[l.id] = L.circle([l.lat, l.lng], {
    radius: Engine.radiusOf(l, state.cfg),
    color:"#16202B", weight:1, opacity:.55, fillColor:"#16202B", fillOpacity:.05, dashArray:"3 5"
  }).addTo(map);
  pins[l.id] = L.marker([l.lat, l.lng], {
    icon: L.divIcon({ className:"", html:`<div class="pin" data-id="${l.id}">${i+1}</div>`, iconSize:[26,26], iconAnchor:[13,13] })
  }).addTo(map).bindTooltip(l.name, { direction:"top", offset:[0,-14] });
});

let youMarker = null, youAcc = null;
function drawYou(fix, simulated){
  const ll = [fix.lat, fix.lng];
  if (!youMarker) {
    youMarker = L.marker(ll, { icon:L.divIcon({ className:"", html:`<div class="you"></div>`, iconSize:[16,16], iconAnchor:[8,8] }), zIndexOffset:1000 }).addTo(map);
    youAcc = L.circle(ll, { radius:fix.accuracy, color:"#16202B", weight:1, opacity:.35, fillColor:"#16202B", fillOpacity:.07 }).addTo(map);
  } else {
    youMarker.setLatLng(ll); youAcc.setLatLng(ll).setRadius(fix.accuracy);
  }
  const el = youMarker.getElement()?.querySelector(".you");
  if (el) el.classList.toggle("sim", !!simulated);
}

/* ════════════════════════════════════════════════════════════════════
   FIX INTAKE — the single entry point
   ════════════════════════════════════════════════════════════════════ */
let source = "none";      // none | real | sim | replay
let frozen = false;

/* src labels the fix for the recorder, the log and the map marker only; the engine never sees it.
   Replayed fixes aren't re-recorded, so exporting after a replay doesn't duplicate the walk. */
function onFix(fix, src = source){
  if (frozen) return;
  // Stamp with time of receipt unless the fix already carries one (a replay does).
  fix = { ...fix, t: fix.t ?? Date.now() };
  if (src !== "replay") { Walk.record(walk.log, fix, src); walk.dirty = true; }
  state.fix = fix; state.fixes++;

  const out = Engine.ingest(fix, GAME.locations, state.cfg,
    { streaks:state.streaks, opened:state.opened, nearSince:state.nearSince });
  state.streaks = out.streaks;
  const grew = out.opened.length !== state.opened.length;
  state.opened = out.opened;
  state.nearSince = out.nearSince;
  state.overrideReady = out.overrideReady;

  logFix(fix, out, src);
  drawYou(fix, src !== "real");
  if (out.fired.length) { out.fired.forEach(markReached); openSheet(out.fired[0]); }
  if (grew) save();
  render(out);
}

function markReached(id){
  const el = pins[id]?.getElement()?.querySelector(".pin");
  if (el) el.classList.add("reached");
  const ring = rings[id];
  if (ring) ring.setStyle({ color:"#2E6B5E", fillColor:"#2E6B5E", fillOpacity:.1, dashArray:null });
}
state.opened.forEach(markReached);

/* ════════════════════════════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

function render(out){
  const cfg = state.cfg;
  const ranges = out?.ranges || (state.fix ? Engine.ranges(state.fix, GAME.locations, cfg) : []);
  const next = ranges.find(g => !state.opened.includes(g.id));

  $("target").textContent = next ? next.name : (state.opened.length ? "All eight reached" : "—");
  $("metres").textContent = next && state.fix ? Math.round(next.d) : "—";
  $("reached").textContent = state.opened.length;
  $("total").textContent = GAME.locations.length;
  $("acc").textContent = state.fix ? Math.round(state.fix.accuracy) : "—";
  $("fixcount").textContent = state.fixes;

  const dot = $("srcdot"), txt = $("srctxt");
  const trouble = source === "real" && gpsIssue;
  dot.className = "dot " + (frozen || trouble ? "dead" : source === "real" ? "live" : source === "sim" || source === "replay" ? "sim" : "");
  txt.textContent = frozen ? "feed frozen" : trouble ? `live GPS · ${gpsIssue}` : source === "real" ? "live GPS"
    : source === "sim" ? "simulated" : source === "replay" ? `replay ${replaySpeed()}×` : "no position";

  // override button
  const ob = $("override");
  const eligible = next && state.overrideReady.includes(next.id);
  ob.classList.toggle("show", !!eligible);
  ob.dataset.id = next ? next.id : "";

  if (drawerOpen) renderState(ranges);
}

function renderClock(){
  const total = state.clockMinutes*60000;
  const left = Math.max(0, total - (Date.now() - state.startedAt));
  const h = Math.floor(left/3600000), m = Math.floor(left%3600000/60000), s = Math.floor(left%60000/1000);
  $("clock").textContent = `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
setInterval(renderClock, 1000); renderClock();

function logFix(fix, out, src){
  const g = out.ranges[0];
  const streak = g ? (out.streaks[g.id] || 0) : 0;
  state.log.unshift({
    t: new Date(fix.t).toLocaleTimeString([], {hour12:false}),
    ok: out.screen.ok,
    why: out.screen.why,
    acc: Math.round(fix.accuracy),
    near: g ? `${g.name} ${Math.round(g.d)}m/${g.r}m` : "—",
    streak: `${streak}/${state.cfg.consecutiveFixes}`,
    fired: out.fired.length > 0,
    src
  });
  if (drawerOpen) renderWalk();
  state.log = state.log.slice(0, 20);
  if (drawerOpen) renderLog();
}

function renderLog(){
  $("log").innerHTML = state.log.map(e =>
    `<div class="${e.fired ? "hit" : e.ok ? "" : "rej"}">${e.t} ${e.src.padEnd(4)} ±${String(e.acc).padStart(3)}m  ${e.ok ? "✓" : "✕"} ${e.why}\n         ${e.near}  streak ${e.streak}${e.fired ? "  ► OPENED" : ""}</div>`
  ).join("") || `<div style="color:var(--slate)">No fixes yet. Choose a position source above.</div>`;
}

function renderState(ranges){
  const f = state.fix;
  $("state").innerHTML =
    `fix    ${f ? f.lat.toFixed(6)+", "+f.lng.toFixed(6) : "—"}\n` +
    `acc    ${f ? "±"+Math.round(f.accuracy)+" m" : "—"}\n` +
    `source ${source}${frozen ? " (frozen)" : ""}\n` +
    `fixes  ${state.fixes}\n` +
    `opened ${state.opened.length} / ${GAME.locations.length}\n` +
    `ceil   ${state.cfg.accuracyCeiling} m   streak ${state.cfg.consecutiveFixes}   radius ${state.cfg.radius} m\n\n` +
    (ranges||[]).slice(0,4).map(g =>
      `${state.opened.includes(g.id) ? "●" : "○"} ${g.name.padEnd(24).slice(0,24)} ${String(Math.round(g.d)).padStart(5)}m  ${(state.streaks[g.id]||0)}/${state.cfg.consecutiveFixes}`
    ).join("\n");
}

/* ════════════════════════════════════════════════════════════════════
   ARRIVAL SHEET
   ════════════════════════════════════════════════════════════════════ */
function openSheet(id){
  const l = GAME.locations.find(x => x.id === id); if (!l) return;
  $("sheetplace").textContent = "reached";
  $("sheetname").textContent = l.name;
  $("sheettext").textContent = l.arrivalText || "";
  $("sheet").classList.add("up");
  if (navigator.vibrate) { try{ navigator.vibrate([40,60,40]); }catch(e){} }
}
$("sheetclose").onclick = () => $("sheet").classList.remove("up");

$("override").onclick = e => {
  const id = e.target.dataset.id; if (!id) return;
  if (!state.opened.includes(id)) state.opened.push(id);
  markReached(id); save(); openSheet(id); render();
};

/* ════════════════════════════════════════════════════════════════════
   REAL GPS
   ════════════════════════════════════════════════════════════════════ */
let watchId = null;
let gpsIssue = null;      // transient trouble shown in the strip; the next real fix clears it
function startReal(){
  if (!navigator.geolocation) { alert("This browser has no geolocation."); return; }
  stopSim(); pauseReplay(); source = "real"; gpsIssue = null; setSrcButtons();
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    p => { gpsIssue = null; onFix({ lat:p.coords.latitude, lng:p.coords.longitude, accuracy:p.coords.accuracy ?? 999 }); },
    err => {
      if (err.code === 1) {
        // Permission refused: this watch will never deliver. Stop it and say so, once.
        navigator.geolocation.clearWatch(watchId); watchId = null;
        source = "none"; gpsIssue = null; setSrcButtons(); render();
        alert("Location permission was refused. Allow it in the browser's site settings, then tap Real GPS again.");
      } else {
        // Unavailable (2) or timeout (3) is routine among tall buildings, and the watch keeps
        // running. Show it in the strip without interrupting; never alert mid-walk.
        gpsIssue = err.code === 2 ? "no signal" : "waiting for fix";
        render();
      }
    },
    { enableHighAccuracy:true, maximumAge:0, timeout:15000 }
  );
  render();
}

/* ════════════════════════════════════════════════════════════════════
   SIMULATOR
   ════════════════════════════════════════════════════════════════════ */
const sim = { at:null, timer:null, path:[], playing:false, travelled:0, line:null, marks:[] };
const M_PER_DEG = 111320;

function setSim(lat, lng){
  sim.at = { lat, lng };
  stopSim(); pauseReplay(); source = "sim"; setSrcButtons();
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
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

/* map tapping: place position, or add a path waypoint */
let tapMode = false, pathMode = false;
map.on("click", e => {
  if (pathMode){
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
   ════════════════════════════════════════════════════════════════════ */
let drawerOpen = false;
function toggleDrawer(open){
  drawerOpen = open;
  $("drawer").classList.toggle("up", open);
  document.body.classList.toggle("dev", open || devFlag);
  if (open){ renderLog(); renderWalk(); renderReplay(); render(); }
}
$("devbtn").onclick = () => toggleDrawer(true);
$("drawerclose").onclick = () => toggleDrawer(false);

const devFlag = new URLSearchParams(location.search).get("dev") === "1";
if (devFlag) document.body.classList.add("dev");

function setSrcButtons(){
  $("srcReal").classList.toggle("on", source === "real");
  $("srcSim").classList.toggle("on", source === "sim");
  $("tapMode").classList.toggle("on", tapMode);
  $("freeze").classList.toggle("on", frozen);
  $("pathMode").classList.toggle("on", pathMode);
}
$("srcReal").onclick = startReal;
$("srcSim").onclick = () => { const c = map.getCenter(); setSim(sim.at?.lat ?? c.lat, sim.at?.lng ?? c.lng); toggleDrawer(false); };
$("tapMode").onclick = () => { tapMode = !tapMode; if (tapMode) pathMode = false; setSrcButtons(); if (tapMode) toggleDrawer(false); };
$("freeze").onclick = () => { frozen = !frozen; setSrcButtons(); render(); };

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
jumpSel.onchange = e => { if (e.target.value){ jumpTo(e.target.value, 0); toggleDrawer(false); } };
$("jumpIn").onclick  = () => { const id = jumpSel.value || GAME.locations[0].id; const l = GAME.locations.find(x=>x.id===id); jumpTo(id, Engine.radiusOf(l,state.cfg)-4); toggleDrawer(false); };
$("jumpOut").onclick = () => { const id = jumpSel.value || GAME.locations[0].id; const l = GAME.locations.find(x=>x.id===id); jumpTo(id, Engine.radiusOf(l,state.cfg)+12); toggleDrawer(false); };

/* path controls */
$("pathMode").onclick = () => { pathMode = !pathMode; if (pathMode) tapMode = false; setSrcButtons(); if (pathMode) toggleDrawer(false); };
$("pathPlay").onclick = () => {
  if (sim.path.length < 2) { alert("Draw a path first: tap 'Draw path', then tap two or more points on the map."); return; }
  sim.travelled = 0; sim.at = { lat:sim.path[0][0], lng:sim.path[0][1] };
  sim.playing = true; $("pathPlay").classList.add("on");
  setSim(sim.at.lat, sim.at.lng); sim.playing = true;
  toggleDrawer(false);
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
slider("capRad",   v => v+" m",  v => { const id = capSel.value; if (rings[id]) rings[id].setRadius(+v); },
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
  state.opened.push(next.id); markReached(next.id); save(); toggleDrawer(false); openSheet(next.id); render();
};
$("openAll").onclick = () => { GAME.locations.forEach(l => { if(!state.opened.includes(l.id)) state.opened.push(l.id); markReached(l.id); }); save(); render(); };
$("reset").onclick = () => {
  if (!confirm("Clear all progress and captured coordinates?")) return;
  store.removeItem(KEY); location.reload();
};

/* capture tool */
capSel.onchange = () => {
  const l = GAME.locations.find(x => x.id === capSel.value); if (!l) return;
  $("capRad").value = Engine.radiusOf(l, state.cfg);
  $("capRadO").textContent = $("capRad").value + " m";
  map.setView([l.lat, l.lng], 18);
};
$("capHere").onclick = () => {
  if (!state.fix) { alert("No position yet. Start Real GPS or place a simulated position first."); return; }
  const l = GAME.locations.find(x => x.id === capSel.value); if (!l) return;
  l.lat = +state.fix.lat.toFixed(6); l.lng = +state.fix.lng.toFixed(6); l.radius = +$("capRad").value;
  pins[l.id].setLatLng([l.lat, l.lng]);
  rings[l.id].setLatLng([l.lat, l.lng]).setRadius(l.radius);
  save(); exportCoords();
  $("capOut").value = `Captured ${l.name} at ±${Math.round(state.fix.accuracy)}m accuracy.\n\n` + $("capOut").value;
};
function exportCoords(){
  const json = JSON.stringify(GAME.locations.map(l => ({
    id:l.id, name:l.name, lat:l.lat, lng:l.lng, radius:Engine.radiusOf(l, state.cfg), arrivalText:l.arrivalText
  })), null, 2);
  $("capOut").value = json;
  return json;
}
$("capExport").onclick = () => {
  const json = exportCoords();
  if (navigator.clipboard) navigator.clipboard.writeText(json).catch(()=>{});
  $("capOut").select?.();
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
  const file = walkFile("application/json");
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement("a"), { href:url, download:file.name, rel:"noopener" });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};
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
  stopSim();
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  source = "replay"; gpsIssue = null; replay.playing = true;
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
  if (source === "replay") source = "none";
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
    rings[l.id]?.setStyle({ color:"#16202B", fillColor:"#16202B", fillOpacity:.05, dashArray:"3 5" });
  });
  $("sheet").classList.remove("up");
  save(); render();
}

/* ════════════════════════════════════════════════════════════════════
   WAKE LOCK + VISIBILITY
   Position updates stop entirely while the page is backgrounded, so the
   first thing on return must be a fresh fix, not a stale one.
   ════════════════════════════════════════════════════════════════════ */
let wl = null;
async function wake(){ try { if ("wakeLock" in navigator) wl = await navigator.wakeLock.request("screen"); } catch(e){} }
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible"){ wake(); if (source === "real") startReal(); }
  else flushWalk();      // iOS may kill a hidden tab without firing pagehide
});
wake();

/* ════════════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════════════ */
setSrcButtons(); renderLog(); render();
if (devFlag) toggleDrawer(true);

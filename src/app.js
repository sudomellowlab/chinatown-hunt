import { Engine } from "./engine.js";

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
let source = "none";      // none | real | sim
let frozen = false;

function onFix(fix){
  if (frozen) return;
  // Stamp with time of receipt unless the fix already carries one (a replay will).
  fix = { ...fix, t: fix.t ?? Date.now() };
  state.fix = fix; state.fixes++;

  const out = Engine.ingest(fix, GAME.locations, state.cfg,
    { streaks:state.streaks, opened:state.opened, nearSince:state.nearSince });
  state.streaks = out.streaks;
  const grew = out.opened.length !== state.opened.length;
  state.opened = out.opened;
  state.nearSince = out.nearSince;
  state.overrideReady = out.overrideReady;

  logFix(fix, out);
  drawYou(fix, source === "sim");
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
  dot.className = "dot " + (frozen ? "dead" : source === "real" ? "live" : source === "sim" ? "sim" : "");
  txt.textContent = frozen ? "feed frozen" : source === "real" ? "live GPS" : source === "sim" ? "simulated" : "no position";

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

function logFix(fix, out){
  const g = out.ranges[0];
  const streak = g ? (out.streaks[g.id] || 0) : 0;
  state.log.unshift({
    t: new Date().toLocaleTimeString([], {hour12:false}),
    ok: out.screen.ok,
    why: out.screen.why,
    acc: Math.round(fix.accuracy),
    near: g ? `${g.name} ${Math.round(g.d)}m/${g.r}m` : "—",
    streak: `${streak}/${state.cfg.consecutiveFixes}`,
    fired: out.fired.length > 0,
    src: source
  });
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
function startReal(){
  if (!navigator.geolocation) { alert("This browser has no geolocation."); return; }
  stopSim(); source = "real"; setSrcButtons();
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    p => onFix({ lat:p.coords.latitude, lng:p.coords.longitude, accuracy:p.coords.accuracy ?? 999 }),
    err => {
      source = "none"; setSrcButtons(); render();
      const msg = err.code === 1
        ? "Location permission was refused. Allow it in the browser's site settings, then tap Real GPS again."
        : err.code === 2 ? "No position available. Move into the open and try again."
        : "Timed out waiting for a fix.";
      alert(msg);
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
  stopSim(); source = "sim"; setSrcButtons();
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
  if (open){ renderLog(); render(); }
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

/* sliders */
function slider(id, fmt, apply){
  const el = $(id), out = $(id+"O");
  const upd = () => { out.textContent = fmt(el.value); apply && apply(el.value); };
  el.addEventListener("input", upd); upd();
}
slider("speed",    v => (+v).toFixed(1)+" m/s");
slider("fakeAcc",  v => v+" m");
slider("jitter",   v => v+" m");
slider("interval", v => (v/1000).toFixed(1)+" s", v => { if (sim.timer){ clearInterval(sim.timer); sim.timer = setInterval(emitSim, +v); } });
slider("ceil",     v => v+" m",  v => { state.cfg.accuracyCeiling = +v; render(); });
slider("streakN",  v => v,       v => { state.cfg.consecutiveFixes = +v; render(); });
slider("defRad",   v => v+" m",  v => {
  state.cfg.radius = +v;
  GAME.locations.forEach(l => { if (l.radius == null) rings[l.id].setRadius(+v); });
  render();
});
slider("capRad",   v => v+" m",  v => { const id = capSel.value; if (rings[id]) rings[id].setRadius(+v); });
slider("clockSet", v => v+" min", v => { state.clockMinutes = +v; state.startedAt = Date.now(); renderClock(); });

$("blowAcc").onclick = () => {
  const p = sim.at || map.getCenter();
  onFix({ lat:p.lat ?? p.lat, lng:p.lng ?? p.lng, accuracy:80 });
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
   WAKE LOCK + VISIBILITY
   Position updates stop entirely while the page is backgrounded, so the
   first thing on return must be a fresh fix, not a stale one.
   ════════════════════════════════════════════════════════════════════ */
let wl = null;
async function wake(){ try { if ("wakeLock" in navigator) wl = await navigator.wakeLock.request("screen"); } catch(e){} }
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible"){ wake(); if (source === "real") startReal(); }
});
wake();

/* ════════════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════════════ */
setSrcButtons(); renderLog(); render();
if (devFlag) toggleDrawer(true);

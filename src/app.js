import { Engine } from "./engine.js";
import { Play } from "./play.js";
import { GAME } from "./game.js";

/* ════════════════════════════════════════════════════════════════════
   THE GAME — what participants run on their phones.
   The participant file contains this and nothing else from the tools:
   the admin module (admin.js) is left out of it entirely, and plugs in
   through `hooks` only in the admin file.
   ════════════════════════════════════════════════════════════════════ */
const BUILD = document.documentElement.dataset.build === "play" ? "play" : "admin";

/* ════════════════════════════════════════════════════════════════════
   STORAGE — falls back to memory where localStorage is unavailable
   (sandboxed previews, private mode). Never throws.
   ════════════════════════════════════════════════════════════════════ */
const store = (() => {
  try { localStorage.setItem("__t","1"); localStorage.removeItem("__t"); return localStorage; }
  catch(e){ const m={}; return { getItem:k=>(k in m?m[k]:null), setItem:(k,v)=>{m[k]=String(v)}, removeItem:k=>{delete m[k]} }; }
})();
// Progress is keyed by the game's permanent id, and kept apart between the admin and participant files.
const KEY = `chinatown-hunt${BUILD === "admin" ? "-admin" : ""}:${GAME.id}`;

/* ════════════════════════════════════════════════════════════════════
   STATE
   ════════════════════════════════════════════════════════════════════ */
const state = {
  cfg: { ...GAME.defaults },
  progress: Play.emptyProgress(),   // active location, completed locations, answers, hints (see play.js)
  streaks: {},
  startedAt: null,       // set when the team taps Begin
  clockMinutes: GAME.durationMinutes,
  fix: null,
  fixes: 0,
  nearSince: {},         // locId -> fix.t first seen within override range (engine-owned)
  overrideReady: []      // locIds eligible for the manual override, as of the last fix
};
function save(){
  try{ store.setItem(KEY, JSON.stringify({ startedAt:state.startedAt, progress:state.progress })); }catch(e){}
}
function load(){
  try{
    const raw = store.getItem(KEY); if(!raw) return;
    const d = JSON.parse(raw);
    state.progress = Play.reconcile(d.progress || {}, GAME);
    if (d.startedAt) state.startedAt = d.startedAt;
  }catch(e){}
}
load();

const locationById = id => GAME.locations.find(l => l.id === id);
// The engine's "opened" set: every location that can no longer be opened by walking into it.
const openedIds = () => [...state.progress.completed, ...(state.progress.active ? [state.progress.active] : [])];

/* The position feed. The admin module adds simulated and replayed sources; the game itself only knows real GPS. */
const feed = { source:"none", frozen:false, gpsIssue:null, watchId:null };

/* Extension points for the admin module. In the participant file nothing registers. */
const hooks = {
  fix: [],            // (fix, engineOutput, src) after every fix
  render: [],         // (ranges) after every render
  beforeSource: [],   // (newSource) before the position source changes
  hidden: [],         // () when the page is hidden
  ringStyle: null,    // (id) → Leaflet path style, or null for the default look
  status: null,       // () → { dot, text } for the status strip, or null for the default
  mapSource: [],      // (mapStatus) whenever the base map changes or fails
  pinCreated: [],     // (location, marker) each time a location's pin is (re)drawn
};

/* ════════════════════════════════════════════════════════════════════
   MAP
   ════════════════════════════════════════════════════════════════════ */
// Opens framed on the game's own locations, wherever they have been set.
const map = L.map("map", { zoomControl:false, attributionControl:true })
  .fitBounds(GAME.locations.map(l => [l.lat, l.lng]), { padding:[40, 40], maxZoom:18 });
map.attributionControl.setPrefix(false);
L.control.zoom({ position:"topright" }).addTo(map);

/* ════════════════════════════════════════════════════════════════════
   BASE MAP — Google's map through the Map Tiles API when the game has a
   key, OpenStreetMap otherwise or whenever Google refuses. Tiles need a
   session token, valid about two weeks, which each device reuses.
   Google requires "Google Maps" and the data copyright on the map; the
   copyright comes from the viewport endpoint and changes as the map moves.
   ════════════════════════════════════════════════════════════════════ */
const GOOGLE = "https://tile.googleapis.com";
const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const mapStatus = { kind:"none", type:"roadmap", problem:null };   // kind: google | osm
let baseLayer = null, mapGen = 0, credit = "";
const mapKey = () => String(GAME.map?.googleKey ?? "").trim();
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
try { if (store.getItem("chinatown-hunt:maptype") === "satellite") mapStatus.type = "satellite"; } catch(e){}

async function googleSession(key, mapType){
  const cacheKey = `chinatown-hunt:gsession:${mapType}`;
  try {
    const c = JSON.parse(store.getItem(cacheKey));
    if (c && c.key === key && Number(c.expiry) * 1000 > Date.now() + 3600000) return c.session;
  } catch(e){}
  let res;
  try {
    res = await fetch(`${GOOGLE}/v1/createSession?key=${encodeURIComponent(key)}`, {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ mapType, language:"en-GB", region:"SG" }),
    });
  } catch(e){ throw new Error("couldn't reach Google (no connection?)"); }
  if (!res.ok) throw new Error(res.status === 403 || res.status === 400
    ? `Google refused the key (${res.status}). Check it, and that its restrictions allow this website and the Map Tiles API`
    : `Google map service error (${res.status})`);
  const d = await res.json().catch(() => ({}));
  if (!d.session) throw new Error("Google sent no map session");
  try { store.setItem(cacheKey, JSON.stringify({ key, session:d.session, expiry:d.expiry })); } catch(e){}
  return d.session;
}
function forgetGoogleSessions(){
  for (const t of ["roadmap", "satellite"]) { try { store.removeItem(`chinatown-hunt:gsession:${t}`); } catch(e){} }
}

function swapLayer(layer){
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = layer.addTo(map);
  baseLayer.bringToBack();
}
function useOsm(problem){
  mapStatus.kind = "osm"; mapStatus.problem = problem;
  swapLayer(L.tileLayer(OSM_URL, { maxZoom:19, attribution:"© OpenStreetMap" }));
  map.setMaxZoom(19);
  setCredit("");
  typeControl.remove();
  hooks.mapSource.forEach(h => h(mapStatus));
}
function useGoogle(key, session, gen){
  mapStatus.kind = "google"; mapStatus.problem = null;
  let loaded = 0, failed = 0;
  const layer = L.tileLayer(`${GOOGLE}/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(key)}`,
    { maxZoom:21, maxNativeZoom:21 });
  layer.on("tileload", () => { loaded++; });
  // Tiles refused outright (e.g. the key doesn't allow this website): fall back rather than show a blank map.
  layer.on("tileerror", () => {
    if (++failed >= 4 && !loaded && gen === mapGen) {
      forgetGoogleSessions();
      useOsm("Google map images didn't load. Check the key's website and API restrictions");
    }
  });
  swapLayer(layer);
  map.setMaxZoom(21);
  typeControl.addTo(map);
  typeControl.sync();
  updateCredit(key, session, gen);
  hooks.mapSource.forEach(h => h(mapStatus));
}
// Apply the game's map settings: Google when there's a working key, OpenStreetMap otherwise.
async function setMapSource(){
  const gen = ++mapGen, key = mapKey();
  if (!key) return useOsm(null);
  try {
    const session = await googleSession(key, mapStatus.type);
    if (gen === mapGen) useGoogle(key, session, gen);
  } catch(e){
    if (gen === mapGen) { forgetGoogleSessions(); useOsm(e.message); }
  }
}

function setCredit(text){
  map.attributionControl.setPrefix(mapStatus.kind === "google" ? '<span class="gmaps">Google Maps</span>' : false);
  if (credit) map.attributionControl.removeAttribution(credit);
  credit = text ? escapeHtml(text) : "";
  if (credit) map.attributionControl.addAttribution(credit);
}
let creditTimer = null, creditHandler = null;
function updateCredit(key, session, gen){
  setCredit("");
  const fetchCredit = async () => {
    if (gen !== mapGen || mapStatus.kind !== "google") return;
    const b = map.getBounds();
    const q = new URLSearchParams({ session, key, zoom: String(Math.round(map.getZoom())),
      north: b.getNorth().toFixed(6), south: b.getSouth().toFixed(6), east: b.getEast().toFixed(6), west: b.getWest().toFixed(6) });
    try {
      const res = await fetch(`${GOOGLE}/tile/v1/viewport?${q}`);
      const d = res.ok ? await res.json() : null;
      if (gen === mapGen && d?.copyright != null) setCredit(d.copyright);
    } catch(e){}
  };
  if (creditHandler) map.off("moveend", creditHandler);
  creditHandler = () => { clearTimeout(creditTimer); creditTimer = setTimeout(fetchCredit, 400); };
  map.on("moveend", creditHandler);
  fetchCredit();
}

// Map / Satellite switch, shown only with Google's map.
const typeControl = L.control({ position:"topright" });
typeControl.onAdd = () => {
  const box = L.DomUtil.create("div", "maptype leaflet-bar");
  box.innerHTML = '<button type="button" data-type="roadmap">Map</button><button type="button" data-type="satellite">Satellite</button>';
  L.DomEvent.disableClickPropagation(box);
  box.addEventListener("click", e => {
    const type = e.target.dataset?.type;
    if (!type || type === mapStatus.type) return;
    mapStatus.type = type;
    try { store.setItem("chinatown-hunt:maptype", type); } catch(err){}
    typeControl.sync();
    setMapSource();
  });
  return box;
};
typeControl.sync = () => {
  typeControl.getContainer()?.querySelectorAll("button").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.type === mapStatus.type)));
};
setMapSource();

// One numbered pin and one geofence ring per location, in list order. The participant file
// draws them once; the admin file redraws them whenever locations are added, removed or reordered.
const pins = {}, rings = {};
function rebuildLocations(){
  for (const id of Object.keys(pins)) { map.removeLayer(pins[id]); map.removeLayer(rings[id]); delete pins[id]; delete rings[id]; }
  GAME.locations.forEach((l, i) => {
    rings[l.id] = L.circle([l.lat, l.lng], {
      radius: Engine.radiusOf(l, state.cfg),
      color:"#16202B", weight:1, opacity:.55, fillColor:"#16202B", fillOpacity:.05, dashArray:"3 5"
    }).addTo(map);
    const pin = document.createElement("div");
    pin.className = "pin"; pin.dataset.id = l.id; pin.textContent = i + 1;
    pins[l.id] = L.marker([l.lat, l.lng], {
      icon: L.divIcon({ className:"", html:pin, iconSize:[26,26], iconAnchor:[13,13] })
    }).addTo(map).bindTooltip(document.createTextNode(l.name?.trim() || "(unnamed)"), { direction:"top", offset:[0,-14] });
    hooks.pinCreated.forEach(fn => fn(l, pins[l.id]));
  });
  state.progress = Play.reconcile(state.progress, GAME);
  GAME.locations.forEach(l => styleLocation(l.id));
}
rebuildLocations();

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
/* src labels the fix for the admin tools and the map marker only; the engine never sees it.
   Only locations that may open right now are given to the engine: while a team is at a
   location, no other can open (Play.openable). */
function onFix(fix, src = feed.source){
  if (feed.frozen) return;
  // Stamp with time of receipt unless the fix already carries one (a replay does).
  fix = { ...fix, t: fix.t ?? Date.now() };
  state.fix = fix; state.fixes++;

  const out = Engine.ingest(fix, Play.openable(GAME.locations, state.progress, revealDue()), state.cfg,
    { streaks:state.streaks, opened:openedIds(), nearSince:state.nearSince });
  state.streaks = out.streaks;
  state.nearSince = out.nearSince;
  state.overrideReady = out.overrideReady;

  hooks.fix.forEach(h => h(fix, out, src));
  drawYou(fix, src !== "real");
  // Two overlapping geofences can fire together: only the first opens; the other waits its turn.
  if (out.fired.length) activateLocation(out.fired[0]);
  render(out);
}

// Time left on the team's clock, or null before Begin.
function msLeft(){
  return state.startedAt ? state.clockMinutes * 60000 - (Date.now() - state.startedAt) : null;
}
const revealDue = () => Play.revealDue(GAME, state.progress, msLeft());

// Open a location: it becomes the team's active location until every challenge is answered.
function activateLocation(id){
  if (revealDue() && !state.progress.active) return false;
  const next = Play.activate(state.progress, id);
  if (next === state.progress) return false;
  state.progress = next;
  styleLocation(id); save(); renderSheet(); render();
  if (navigator.vibrate) { try{ navigator.vibrate([40,60,40]); }catch(e){} }
  return true;
}

function markReached(id){ styleLocation(id); }
function styleLocation(id){
  const el = pins[id]?.getElement()?.querySelector(".pin");
  if (el) {
    el.classList.toggle("reached", state.progress.completed.includes(id));
    el.classList.toggle("active", state.progress.active === id);
  }
  styleRing(id);
}
// Ring look: jade once done, brass while active, dashed ink otherwise (the admin tools may override while editing).
function styleRing(id){
  const ring = rings[id]; if (!ring) return;
  const custom = hooks.ringStyle?.(id);
  if (custom) ring.setStyle(custom);
  else if (state.progress.completed.includes(id)) ring.setStyle({ color:"#2E6B5E", fillColor:"#2E6B5E", fillOpacity:.1, weight:1, dashArray:null });
  else if (state.progress.active === id) ring.setStyle({ color:"#8A6D2F", fillColor:"#8A6D2F", fillOpacity:.12, weight:2, dashArray:null });
  else ring.setStyle({ color:"#16202B", fillColor:"#16202B", fillOpacity:.05, weight:1, dashArray:"3 5" });
}

/* ════════════════════════════════════════════════════════════════════
   RENDER
   ════════════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

function render(out){
  const cfg = state.cfg, p = state.progress;
  const closed = revealDue();
  const ranges = out?.ranges || (state.fix ? Engine.ranges(state.fix, Play.openable(GAME.locations, p, closed), cfg) : []);
  const active = p.active && locationById(p.active);
  const next = active || closed ? null : ranges.find(g => !p.completed.includes(g.id));

  $("targetLabel").textContent = active ? "you are at" : closed ? "" : "nearest location";
  $("target").textContent = active ? active.name : closed ? "Time for the clues" : next ? next.name : "—";
  $("metres").textContent = next && state.fix ? Math.round(next.d) : "—";
  $("reached").textContent = p.completed.length;
  $("total").textContent = GAME.locations.length;
  $("acc").textContent = state.fix ? Math.round(state.fix.accuracy) : "—";
  $("fixcount").textContent = state.fixes;

  const trouble = feed.source === "real" && feed.gpsIssue;
  const status = hooks.status?.() || {
    dot: trouble ? "dead" : feed.source === "real" ? "live" : "",
    text: trouble ? `live GPS · ${feed.gpsIssue}` : feed.source === "real" ? "live GPS" : "no position",
  };
  $("srcdot").className = "dot " + status.dot;
  $("srctxt").textContent = status.text;

  // override button: never while a location is in progress, nor once the clues are due
  const ob = $("override");
  const eligible = next && state.overrideReady.includes(next.id);
  ob.classList.toggle("show", !!eligible);
  ob.dataset.id = next ? next.id : "";

  hooks.render.forEach(h => h(ranges));
}

function renderClock(){
  const total = state.clockMinutes*60000;
  const left = state.startedAt ? Math.max(0, total - (Date.now() - state.startedAt)) : total;
  const h = Math.floor(left/3600000), m = Math.floor(left%3600000/60000), s = Math.floor(left%60000/1000);
  $("clock").textContent = `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
setInterval(() => { renderClock(); checkReveal(); }, 1000); renderClock();

/* ════════════════════════════════════════════════════════════════════
   LOCATION SHEET — arrival text, then each challenge in order, then a
   summary. It stays up until the location is finished: there is no way
   to leave a location part-way.
   ════════════════════════════════════════════════════════════════════ */
const ui = {
  startScreen: true,     // the admin file turns this off
};

// Tiny element builder; text always goes in as textContent, never as HTML.
function h(tag, props = {}, ...children){
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

/* A linked picture. If it can't load (usually no signal), say so and offer a retry instead of
   leaving a gap. Images come from the organiser's server; nothing is embedded. */
function picture(url, cls, alt){
  if (!Play.imageProblem(url) && String(url ?? "").trim()) {
    const src = String(url).trim();
    const wrap = h("figure", { class: `pic ${cls}` });
    const img = h("img", { src, alt, decoding:"async" });
    const fail = h("div", { class:"picfail", hidden:true },
      h("span", {}, "Image didn't load. Check your signal."),
      h("button", { class:"secondary picretry", onclick: () => {
        fail.hidden = true; img.hidden = false;
        img.src = src + (src.includes("?") ? "&" : "?") + "retry=" + Date.now();
      } }, "Try again"));
    img.addEventListener("error", () => { img.hidden = true; fail.hidden = false; });
    img.addEventListener("load", () => { fail.hidden = true; img.hidden = false; });
    wrap.append(img, fail);
    return wrap;
  }
  return null;
}
// Fetch every picture in the game up front, so teams have them before walking into a dead spot.
// Keeping them relies on the image server's normal caching.
const preloaded = [];
function preloadImages(){
  if (preloaded.length) return;
  for (const url of Play.imageUrls(GAME)) { const img = new Image(); img.src = url; preloaded.push(img); }
}

// replaceChildren prints null as the text "null"; this skips anything that isn't there.
function fill(el, ...children){ el.replaceChildren(...children.flat().filter(c => c != null && c !== false)); }

function renderSheet(){
  const l = state.progress.active && locationById(state.progress.active);
  if (!l) { $("sheet").classList.remove("up"); return; }
  const stage = Play.stage(l, state.progress);
  const body = $("stage");
  $("sheetname").textContent = l.name;

  const closingNote = revealDue()
    ? h("p", { id:"closingNote", class:"hint" }, "Time is nearly up. Finish this location to see the clues.") : null;
  // Finishing the last location, or finishing once the clues are due, leads straight to the clues.
  const finishLabel = Play.revealDue(GAME, Play.finish(state.progress, l), msLeft()) ? "Finish location and see the clues" : "Finish location";
  const move = fn => { state.progress = fn(state.progress, l); save(); renderSheet(); $("sheet").scrollTop = 0; };

  if (stage.kind === "arrival") {
    $("sheetplace").textContent = "you have arrived";
    const n = stage.total;
    fill(body,
      closingNote,
      h("p", { id:"sheettext" }, l.arrivalText || ""),
      n ? h("p", { class:"small" }, `${n} challenge${n === 1 ? "" : "s"} here. Answer them in LoQuiz, then finish this location before moving on.`) : null,
      h("div", { class:"navrow" },
        n ? h("button", { id:"nextBtn", class:"primary", onclick: () => move(Play.next) }, "Start the challenges")
          : h("button", { id:"finishBtn", class:"primary", onclick: finishActive }, finishLabel)),
    );
  } else {
    const { task, index, total, last } = stage;
    $("sheetplace").textContent = `challenge ${index + 1} of ${total}`;
    fill(body,
      closingNote,
      picture(task.image, "qimg", "Picture for this challenge"),
      task.prompt ? h("p", { id:"prompt", class:"prompt" }, task.prompt) : null,
      h("div", { class:"navrow" },
        h("button", { id:"backBtn", class:"secondary", onclick: () => move(Play.back) }, "Back"),
        last ? h("button", { id:"finishBtn", class:"primary", onclick: finishActive }, finishLabel)
             : h("button", { id:"nextBtn", class:"primary", onclick: () => move(Play.next) }, "Next")),
    );
  }
  $("sheet").classList.add("up");
}

function finishActive(){
  const l = locationById(state.progress.active); if (!l) return;
  const next = Play.finish(state.progress, l);
  if (next === state.progress) return;
  state.progress = next;
  styleLocation(l.id); save(); renderSheet(); render();
  checkReveal();
}

/* ════════════════════════════════════════════════════════════════════
   CLUES & SUSPECTS — shown on one screen from the reveal point on the
   team's clock (or once every location is done), after any location in
   progress is finished. It stays for the rest of the game.
   ════════════════════════════════════════════════════════════════════ */
function checkReveal(){
  const next = Play.reveal(GAME, state.progress, msLeft());
  if (next !== state.progress) {
    state.progress = next;
    save(); stopReal(); renderSheet(); render();
    if (navigator.vibrate) { try{ navigator.vibrate([60,80,60]); }catch(e){} }
  } else if (!state.progress.revealed && revealDue()) {
    render();                         // closing: the HUD and sheet say the clues are coming
    // Add the note in place rather than re-rendering, so a half-typed answer isn't lost.
    if (state.progress.active && !$("closingNote") && $("sheet").classList.contains("up"))
      $("stage").prepend(h("p", { id:"closingNote", class:"hint" }, "Time is nearly up. Finish this location to see the clues."));
  }
  renderReveal();
}
// preview: the admin file can show the screen without changing the team's progress.
function renderReveal(preview = false){
  const show = state.progress.revealed || preview;
  $("reveal").hidden = !show;
  if (!show) return;
  $("revealTitle").textContent = GAME.title;
  $("revealLead").textContent = GAME.revealIntro ?? "";
  $("clueList").replaceChildren(...(GAME.clues || []).map((c, i) =>
    h("li", {}, h("p", {}, c.text), picture(c.image, "clueimg", `Picture for clue ${i + 1}`))));
  $("suspectList").replaceChildren(...(GAME.suspects || []).map(s =>
    h("li", { class: s.image ? "withpic" : "" }, picture(s.image, "portrait", `Portrait of ${s.name}`),
      h("div", { class:"who" }, h("strong", {}, s.name), s.blurb ? h("span", {}, s.blurb) : null))));
}

$("override").onclick = e => {
  const id = e.target.dataset.id; if (id) activateLocation(id);
};

/* ════════════════════════════════════════════════════════════════════
   REAL GPS
   ════════════════════════════════════════════════════════════════════ */
function startReal(){
  if (!navigator.geolocation) { alert("This browser has no geolocation."); return; }
  hooks.beforeSource.forEach(h => h("real"));
  feed.source = "real"; feed.gpsIssue = null;
  stopReal();
  feed.watchId = navigator.geolocation.watchPosition(
    p => { feed.gpsIssue = null; onFix({ lat:p.coords.latitude, lng:p.coords.longitude, accuracy:p.coords.accuracy ?? 999 }); },
    err => {
      if (err.code === 1) {
        // Permission refused: this watch will never deliver. Stop it and say so, once.
        stopReal(); feed.source = "none"; feed.gpsIssue = null; render();
        alert("Location permission was refused. Allow location access for this site in your browser settings, then try again.");
        if (ui.startScreen) showStart();
      } else {
        // Unavailable (2) or timeout (3) is routine among tall buildings, and the watch keeps
        // running. Show it in the strip without interrupting; never alert mid-walk.
        feed.gpsIssue = err.code === 2 ? "no signal" : "waiting for fix";
        render();
      }
    },
    { enableHighAccuracy:true, maximumAge:0, timeout:15000 }
  );
  render();
}
function stopReal(){
  if (feed.watchId !== null) { navigator.geolocation.clearWatch(feed.watchId); feed.watchId = null; }
}

/* ════════════════════════════════════════════════════════════════════
   START SCREEN — location permission is only asked for on this tap.
   Begin starts the clock; after a reload the same screen offers Continue.
   ════════════════════════════════════════════════════════════════════ */
function showStart(){
  $("startTitle").textContent = GAME.title;
  $("startIntro").textContent = GAME.intro ?? "";
  $("startBtn").textContent = state.startedAt ? "Continue" : "Begin";
  $("start").hidden = false;
}
function hideStart(){ $("start").hidden = true; }
$("startBtn").onclick = () => {
  if (!state.startedAt) { state.startedAt = Date.now(); save(); renderClock(); }
  hideStart();
  preloadImages();
  checkReveal();
  if (!state.progress.revealed) startReal();      // the clues screen needs no location
};

/* ════════════════════════════════════════════════════════════════════
   WAKE LOCK + VISIBILITY
   Position updates stop entirely while the page is backgrounded, so the
   first thing on return must be a fresh fix, not a stale one.
   ════════════════════════════════════════════════════════════════════ */
async function wake(){ try { if ("wakeLock" in navigator) await navigator.wakeLock.request("screen"); } catch(e){} }
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible"){ wake(); if (feed.source === "real") startReal(); }
  else hooks.hidden.forEach(h => h());      // iOS may kill a hidden tab without firing pagehide
});
wake();

/* ════════════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════════════ */
document.title = GAME.title;
render();
renderSheet();          // a reload mid-location goes straight back to it
renderReveal();
showStart();

export { BUILD, store, state, save, feed, hooks, ui, map, pins, rings, onFix, markReached, styleRing, styleLocation,
  mapStatus, setMapSource, rebuildLocations,
  $, render, renderClock, renderSheet, renderReveal, checkReveal, activateLocation, finishActive, locationById,
  startReal, stopReal, hideStart };

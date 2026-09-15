import { Engine } from "./engine.js";
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
  streaks: {},
  opened: [],
  startedAt: null,       // set when the team taps Begin
  clockMinutes: GAME.durationMinutes,
  fix: null,
  fixes: 0,
  nearSince: {},         // locId -> fix.t first seen within override range (engine-owned)
  overrideReady: []      // locIds eligible for the manual override, as of the last fix
};
function save(){ try{ store.setItem(KEY, JSON.stringify({ opened:state.opened, startedAt:state.startedAt })); }catch(e){} }
function load(){
  try{
    const raw = store.getItem(KEY); if(!raw) return;
    const d = JSON.parse(raw);
    if (Array.isArray(d.opened)) state.opened = d.opened.filter(id => GAME.locations.some(l => l.id === id));
    if (d.startedAt) state.startedAt = d.startedAt;
  }catch(e){}
}
load();

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
};

/* ════════════════════════════════════════════════════════════════════
   MAP
   ════════════════════════════════════════════════════════════════════ */
// Opens framed on the game's own locations, wherever they have been set.
const map = L.map("map", { zoomControl:false, attributionControl:true })
  .fitBounds(GAME.locations.map(l => [l.lat, l.lng]), { padding:[40, 40], maxZoom:18 });
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
/* src labels the fix for the admin tools and the map marker only; the engine never sees it. */
function onFix(fix, src = feed.source){
  if (feed.frozen) return;
  // Stamp with time of receipt unless the fix already carries one (a replay does).
  fix = { ...fix, t: fix.t ?? Date.now() };
  state.fix = fix; state.fixes++;

  const out = Engine.ingest(fix, GAME.locations, state.cfg,
    { streaks:state.streaks, opened:state.opened, nearSince:state.nearSince });
  state.streaks = out.streaks;
  const grew = out.opened.length !== state.opened.length;
  state.opened = out.opened;
  state.nearSince = out.nearSince;
  state.overrideReady = out.overrideReady;

  hooks.fix.forEach(h => h(fix, out, src));
  drawYou(fix, src !== "real");
  if (out.fired.length) { out.fired.forEach(markReached); openSheet(out.fired[0]); }
  if (grew) save();
  render(out);
}

function markReached(id){
  const el = pins[id]?.getElement()?.querySelector(".pin");
  if (el) el.classList.add("reached");
  styleRing(id);
}
// Ring look: jade once reached, dashed ink otherwise (the admin tools may override while editing).
function styleRing(id){
  const ring = rings[id]; if (!ring) return;
  const custom = hooks.ringStyle?.(id);
  if (custom) ring.setStyle(custom);
  else if (state.opened.includes(id)) ring.setStyle({ color:"#2E6B5E", fillColor:"#2E6B5E", fillOpacity:.1, weight:1, dashArray:null });
  else ring.setStyle({ color:"#16202B", fillColor:"#16202B", fillOpacity:.05, weight:1, dashArray:"3 5" });
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

  $("target").textContent = next ? next.name : (state.opened.length === GAME.locations.length ? "All eight reached" : "—");
  $("metres").textContent = next && state.fix ? Math.round(next.d) : "—";
  $("reached").textContent = state.opened.length;
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

  // override button
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
setInterval(renderClock, 1000); renderClock();

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
const ui = { startScreen: true };      // the admin file turns this off
function showStart(){
  $("startTitle").textContent = GAME.title;
  $("startBtn").textContent = state.startedAt ? "Continue" : "Begin";
  $("start").hidden = false;
}
function hideStart(){ $("start").hidden = true; }
$("startBtn").onclick = () => {
  if (!state.startedAt) { state.startedAt = Date.now(); save(); renderClock(); }
  hideStart();
  startReal();
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
showStart();

export { BUILD, store, state, save, feed, hooks, ui, map, pins, rings, onFix, markReached, styleRing,
  $, render, renderClock, openSheet, startReal, stopReal, hideStart };

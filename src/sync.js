import { Play } from "./play.js";
import { LoQuiz } from "./loquiz.js";
import { HOSTED, hostedRelay, GAME } from "./hosted.js";
import { store, state, save, hooks, render, renderClock, renderSheet, checkReveal, styleLocation, openStart, showStart, h, $ } from "./app.js";

/* ════════════════════════════════════════════════════════════════════
   LOQUIZ SYNC — the hosted participant file only. Follows the team's
   LoQuiz answers through the sync relay and moves this phone on with them
   (the rules are in loquiz.js):
     · the starting challenge's LoQuiz question unlocks it, its answer
       being the password;
     · a location's LoQuiz question opens it, as walking into it would;
     · a challenge's LoQuiz question moves the team past it.
   Which event: ?game=<LoQuiz game id> in the address, else the event the
   relay has as current for this game; a phone part-way through an event
   stays on it while that event is switched on. Which team: picked once.
   Each LoQuiz answer is acted on once, in the order LoQuiz took them.

   SYNCHRO MODE (game.sync.synchroMode, set on the editors site): on a phone
   synced to a team, a challenge linked to LoQuiz shows no Next or Finish
   and no answer box; LoQuiz moves the team on. Unlinked challenges, and
   phones playing without syncing, work exactly as before.
   ════════════════════════════════════════════════════════════════════ */
const SYNC_KEY = "chinatown-hunt:sync";
const relay = hostedRelay();
const anyLinks = () => !!GAME.start?.loquizUnlock?.length
  || GAME.locations.some(l => LoQuiz.linked(l, "loquizOpen") || (l.tasks || []).some(t => LoQuiz.linked(t)))
  || (GAME.start?.tasks || []).some(t => LoQuiz.linked(t));

const sync = (() => {
  let S = {};
  try { S = JSON.parse(store.getItem(SYNC_KEY) || "{}") || {}; } catch(e){}
  return { gameId: S.gameId || null, teamId: S.teamId || null, teamName: S.teamName || null, applied: Array.isArray(S.applied) ? S.applied : [] };
})();
const saveSync = () => { try { store.setItem(SYNC_KEY, JSON.stringify(sync)); } catch(e){} };
const synced = () => !!sync.teamId && sync.teamId !== "__none__";
const synchro = () => !!GAME.sync?.synchroMode && synced() && link.live;
const link = { ws: null, ping: null, retry: 0, timer: null, live: false, teams: new Map(), queue: Promise.resolve() };

/* ── screens: a line in the readout, the team picker, a toast ── */
const css = h("style", {}, `
#syncLine{display:flex;justify-content:space-between;gap:10px;margin-top:8px;font:12px/1.4 var(--mono);color:var(--slate)}
#syncLine .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--mark);margin-right:6px;vertical-align:1px}
#syncLine.ok .dot{background:var(--jade)}
#syncLine button{background:none;border:0;padding:0;font:inherit;color:var(--jade);text-decoration:underline;cursor:pointer}
#teamPick{position:fixed;inset:0;z-index:960;background:var(--linen);overflow:auto;display:none}
#teamPick.show{display:block}
#teamPick .card{max-width:520px;margin:0 auto;padding:44px 20px calc(env(safe-area-inset-bottom) + 30px)}
#teamPick h2{font-size:27px;line-height:1.1;margin:0 0 8px;font-weight:600}
#teamPick p{color:var(--slate);line-height:1.5;margin:0 0 18px}
#teamPick .team{display:block;width:100%;text-align:left;background:var(--sheet);border:1px solid var(--ink);border-radius:6px;padding:14px 16px;margin-bottom:10px;font:inherit;cursor:pointer}
#teamPick .team b{display:block;font-size:19px;font-weight:600}
#teamPick .team span{font-size:13px;color:var(--slate)}
#teamPick .none{border:1px dashed var(--slate);border-radius:6px;padding:20px;text-align:center;color:var(--slate)}
#teamPick .skip{margin-top:18px;background:none;border:0;color:var(--slate);text-decoration:underline;font:inherit;cursor:pointer}
#syncToast{position:fixed;left:50%;top:calc(env(safe-area-inset-top) + 14px);transform:translateX(-50%);z-index:980;background:var(--ink);color:var(--linen);padding:10px 16px;border-radius:6px;font-size:15px;opacity:0;transition:opacity .3s;pointer-events:none;max-width:90vw;text-align:center}
#syncToast.show{opacity:1}
#syncWait{margin:18px 0 6px;padding:14px 16px;border:1px dashed var(--jade);border-radius:6px;text-align:center;color:var(--slate);line-height:1.45}
#syncWait b{display:block;color:var(--jade);font-size:17px;margin-bottom:2px}
`);
const line = h("div", { id: "syncLine" }, h("span", {}, h("span", { class: "dot" }), h("span", { id: "syncText" }, "LoQuiz sync")),
  h("button", { id: "syncBtn", type: "button" }, "Change team"));
const list = h("div", { id: "teamList" });
const picker = h("div", { id: "teamPick" }, h("div", { class: "card" },
  h("h2", {}, "Choose your team"),
  h("p", {}, "Pick the team name your Coordinator is playing as in LoQuiz. This phone then follows their answers, so you move on together."),
  list,
  h("button", { class: "skip", id: "teamSkip", type: "button" }, "Continue without syncing")));
const toastBox = h("div", { id: "syncToast", role: "status" });
let toastTimer;
function toast(text){
  toastBox.textContent = text; toastBox.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastBox.classList.remove("show"), 2800);
}

function renderLine(){
  const off = sync.teamId === "__none__";
  line.classList.toggle("ok", link.live && !off);
  $("syncText").textContent = off ? "LoQuiz sync off" : !sync.teamId ? "LoQuiz sync · choose your team"
    : `${link.live ? "Synced" : "Reconnecting"} · ${sync.teamName || "your team"}`;
  $("syncBtn").textContent = off ? "Turn on" : "Change team";
}
function renderPicker(){
  picker.classList.toggle("show", !sync.teamId);
  if (sync.teamId) return;
  const cutoff = Date.now() / 1000 - 12 * 3600;           // older teams are from earlier runs
  const teams = [...link.teams.values()].filter(t => !t.startTime || t.startTime > cutoff).sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
  list.replaceChildren(...(teams.length ? teams.map(t => {
    const mins = t.startTime ? Math.max(0, Math.round((Date.now() / 1000 - t.startTime) / 60)) : null;
    return h("button", { class: "team", type: "button", onclick: () => setTeam(t.id, t.name) },
      h("b", {}, t.name), h("span", {}, mins === null ? "" : mins < 1 ? "started just now" : `started ${mins} min ago`));
  }) : [h("div", { class: "none" }, link.live ? "No teams yet. Your Coordinator's team shows up here as soon as they start the game in LoQuiz." : "Connecting…")]));
}
function setTeam(id, name){
  sync.teamId = id; sync.teamName = name; sync.applied = []; saveSync();
  renderPicker(); renderLine(); renderSheet(); connect();     // reconnect for just this team; its answers so far are replayed
}
picker.querySelector("#teamSkip").onclick = () => {
  if (confirm("Play without syncing? You'll move through each location on this phone yourselves.")) setTeam("__none__", null);
};
line.querySelector("#syncBtn").onclick = () => {
  if (synced() && !confirm("Change team? Only do this if you picked the wrong team. Your progress on this phone is kept.")) return;
  sync.teamId = null; sync.teamName = null; saveSync(); renderPicker(); renderLine(); renderSheet(); connect();
};

/* Synchro Mode: a linked challenge waits for LoQuiz. */
hooks.sheet.push(() => {
  if (!synchro()) return;
  let task = null;
  if (GAME.start && Play.startPending(state.progress)) {
    if (state.progress.start === "open" && Array.isArray(GAME.start.tasks)) {
      const s = Play.startStage(GAME.start, state.progress);
      if (s.kind === "task") task = s.task;
    }
  } else if (state.progress.active) {
    const l = GAME.locations.find(x => x.id === state.progress.active);
    const s = l && Play.stage(l, state.progress);
    if (s?.kind === "task") task = s.task;
  }
  if (!task || !LoQuiz.linked(task)) return;
  for (const id of ["nextBtn", "finishBtn"]) $(id)?.remove();
  const box = $("answerBox");
  if (box && !box.classList.contains("solved")) box.remove();
  const nav = $("stage").querySelector(".navrow");
  $("stage").insertBefore(h("p", { id: "syncWait" }, h("b", {}, "Waiting for LoQuiz"),
    "Your Coordinator moves you on by answering this in LoQuiz."), nav);
});

/* ── applying answers, one at a time and in order ── */
const nameOf = id => id === Play.START ? GAME.start?.name : GAME.locations.find(l => l.id === id)?.name;
async function applyAnswer(ev){
  if (sync.applied.includes(ev.key)) return null;
  sync.applied = [...sync.applied, ev.key].slice(-500);
  const before = state.progress;
  let said = null;
  for (const hit of LoQuiz.hits(GAME, ev.answer.taskId)) {
    if (!LoQuiz.counts(hit.link, ev.answer)) continue;
    if (hit.kind === "unlock") {
      if (state.progress.start !== "locked") continue;
      try {                                             // LoQuiz's answer is the password
        await openStart(String(ev.answer.answer ?? ""));
        state.progress = Play.unlockStart(state.progress);
        said = `${GAME.start.name || "Starting challenge"} unlocked`;
      } catch(e){ said = "Type the password your Coordinator gives you"; }
    } else if (hit.kind === "open") {
      const next = LoQuiz.open(state.progress, GAME, hit.locId);
      if (next !== state.progress) { state.progress = next; said = `${nameOf(hit.locId)} opened`; }
    } else {
      const next = LoQuiz.pass(state.progress, GAME, hit.locId, hit.index);
      if (next !== state.progress) {
        const finished = hit.locId === Play.START ? next.start === "done" : next.completed.includes(hit.locId);
        state.progress = next;
        said = finished ? `${nameOf(hit.locId)} finished` : "Synced with LoQuiz";
      }
    }
  }
  if (state.progress !== before) {
    save();
    for (const l of GAME.locations) styleLocation(l.id);
  }
  return said;
}
function apply(events){
  link.queue = link.queue.then(async () => {
    let said = null;
    for (const ev of events) said = (await applyAnswer(ev)) || said;
    saveSync();
    if (said) { renderSheet(); render(); checkReveal(); toast(said); }
  }).catch(e => console.error("LoQuiz sync", e));
}

/* ── the relay connection ── */
let gameId = null;
function connect(){
  if (link.ws) { link.ws.onclose = null; try { link.ws.close(); } catch(e){} }
  clearInterval(link.ping); link.live = false;
  if (sync.teamId === "__none__") { renderLine(); return; }
  const qs = `game=${encodeURIComponent(gameId)}${sync.teamId ? `&team=${encodeURIComponent(sync.teamId)}` : ""}`;
  let ws;
  try { ws = link.ws = new WebSocket(`${relay.replace(/^http/i, "ws")}/ws?${qs}`); } catch(e){ reconnectLater(); return; }
  ws.onopen = () => {
    link.retry = 0; link.live = true; renderLine(); renderPicker(); renderSheet();
    link.ping = setInterval(() => { if (ws.readyState === 1) ws.send("ping"); }, 25000);
  };
  ws.onmessage = e => {
    if (e.data === "pong") return;
    let msg; try { msg = JSON.parse(e.data); } catch(err){ return; }
    const d = msg.data;
    if (msg.type === "init") {
      link.teams = new Map((d.teams || []).map(t => [t.id, t]));
      renderPicker();
      if (synced()) {
        const t = link.teams.get(sync.teamId);
        if (t && t.name !== sync.teamName) { sync.teamName = t.name; saveSync(); renderLine(); }
        apply((d.answers || []).filter(ev => ev.team?.id === sync.teamId).sort((a, b) => (a.answer.time || 0) - (b.answer.time || 0)));
      }
    } else if (msg.type === "team") {
      link.teams.set(d.id, d); renderPicker();
    } else if (msg.type === "answer") {
      if (d.team?.id === sync.teamId) apply([d]);
    }
  };
  ws.onclose = () => { clearInterval(link.ping); link.live = false; renderLine(); renderSheet(); reconnectLater(); };
}
function reconnectLater(){
  clearTimeout(link.timer);
  link.timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** link.retry++));
}
async function resolveGame(){
  const valid = id => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
  let fromUrl = null;
  try { fromUrl = new URLSearchParams(location.search).get("game"); } catch(e){}
  if (valid(fromUrl)) return fromUrl;
  try {
    const res = await fetch(`${relay}/api/current-event?game=${HOSTED.game}${sync.gameId ? `&have=${encodeURIComponent(sync.gameId)}` : ""}`, { cache: "no-store" });
    const d = await res.json();
    if (sync.gameId && d.haveLive) return sync.gameId;      // mid-event: stay put even if another event became current
    return valid(d.gameId) ? d.gameId : null;
  } catch(e){
    return sync.gameId;                                      // relay unreachable: keep the event this phone already has
  }
}

if (relay && anyLinks()) {
  (async () => {
    gameId = await resolveGame();
    if (!gameId) return;                                     // no current event: play without sync
    if (sync.gameId && sync.gameId !== gameId) {
      // A phone from an earlier event: start this one fresh, team, clock and all.
      sync.teamId = null; sync.teamName = null; sync.applied = [];
      state.progress = Play.emptyProgress(); state.startedAt = null;
      save(); renderClock(); renderSheet(); render();
      for (const l of GAME.locations) styleLocation(l.id);
      showStart();
    }
    sync.gameId = gameId; saveSync();
    document.head.append(css);
    $("hud").append(line);
    document.body.append(picker, toastBox);
    renderLine(); renderPicker(); connect();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && (!link.ws || link.ws.readyState > 1)) { link.retry = 0; connect(); }
    });
  })();
}

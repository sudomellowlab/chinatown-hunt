/* ════════════════════════════════════════════════════════════════════
   FIELD TOOLS — the developer panel inside an exported game, for the
   organiser on the day or testing on a real phone. It never ships as
   readable code: Export encrypts this file with the password set in the
   admin panel (see vault.js), and unlock.js runs it once the right
   password is typed. `app` is the game's own functions and state; the
   panel's markup and styles are built here, so none of it is in the file.
   Pretend positions go through onFix like any other fix.
   ════════════════════════════════════════════════════════════════════ */
function fieldTools(app){
  const { GAME, Engine, Play, state, save, feed, hooks, map, onFix, render, renderClock, renderSheet,
    checkReveal, activateLocation, finishActive, locationById, msLeft, startReal, stopReal, store, KEY, h, $ } = app;

  const style = document.createElement("style");
  style.textContent = `
#ftPanel{position:fixed;inset:0;z-index:2000;overflow-y:auto;background:var(--sheet,#F4F1EA);color:var(--ink,#16202B);
  padding:calc(env(safe-area-inset-top) + 12px) 16px calc(env(safe-area-inset-bottom) + 24px);font-size:14px}
#ftPanel header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
#ftPanel h3{margin:0;font-size:18px}
#ftPanel h4{margin:18px 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--brass,#8A6D2F)}
#ftPanel .ftrow{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}
#ftPanel button,#ftPanel select,#ftPanel input{font:inherit;min-height:40px;padding:6px 12px;border:1px solid var(--ink,#16202B);
  background:#fff;color:var(--ink,#16202B);border-radius:6px;width:auto}
#ftPanel button.on{background:var(--ink,#16202B);color:#fff}
#ftPanel button.warn{border-color:#9B2C2C;color:#9B2C2C}
#ftPanel select{flex:1;min-width:0}
#ftPanel input{width:6em}
#ftPanel pre{white-space:pre-wrap;font:12px/1.45 ui-monospace,Menlo,monospace;margin:0;background:#fff;padding:8px;border-radius:6px}
#ftPanel .ftnote{font-size:12px;color:var(--slate,#5A6570);margin:4px 0}
#ftLog div{border-bottom:1px solid #0001}
#ftLog .rej{color:#9B2C2C}#ftLog .hit{color:#2E6B5E;font-weight:bold}
body.fttap #map{cursor:crosshair}`;
  document.head.append(style);

  /* ── pretend positions: every second, through the game's own fix intake ── */
  const sim = { at: null, timer: null, tapping: false };
  function pretend(lat, lng){
    sim.at = { lat, lng };
    if (feed.source !== "sim") { hooks.beforeSource.forEach(fn => fn("sim")); stopReal(); feed.source = "sim"; feed.gpsIssue = null; }
    clearInterval(sim.timer);
    sim.timer = setInterval(emit, 1000);
    emit();
    draw();
  }
  function emit(){ if (sim.at) onFix({ lat: sim.at.lat, lng: sim.at.lng, accuracy: 5 }, "sim"); }
  function stopPretending(){ clearInterval(sim.timer); sim.timer = null; sim.at = null; sim.tapping = false; document.body.classList.remove("fttap"); }
  hooks.beforeSource.push(next => { if (next !== "sim") stopPretending(); });
  const prevStatus = hooks.status;
  hooks.status = () => feed.source === "sim" ? { dot: "sim", text: "pretend position" } : prevStatus?.() ?? null;
  map.on("click", e => { if (sim.tapping) pretend(e.latlng.lat, e.latlng.lng); });

  /* ── fix log ── */
  const log = [];
  hooks.fix.push((fix, out, src) => {
    const g = out.ranges[0];
    log.unshift({ t: new Date(fix.t).toLocaleTimeString([], { hour12: false }), src, ok: out.screen.ok, why: out.screen.why,
      acc: Math.round(fix.accuracy), near: g ? `${g.name} ${Math.round(g.d)}m/${g.r}m` : "—", fired: out.fired.length > 0 });
    log.length = Math.min(log.length, 20);
    if (!panel.hidden) drawLog();
  });

  /* ── panel ── */
  const btn = (id, text, onclick, cls = "") => h("button", { id, type: "button", class: cls, onclick }, text);
  const go = h("select", { id: "ftGo", "aria-label": "Pretend to be at a location" });
  const minutes = h("input", { id: "ftMinutes", type: "number", min: "0", step: "1", inputmode: "numeric", "aria-label": "Minutes left" });
  const panel = h("div", { id: "ftPanel", hidden: true, role: "dialog", "aria-label": "Field tools" },
    h("header", {}, h("h3", {}, "Field tools"), btn("ftClose", "Close", () => close())),
    h("p", { class: "ftnote" }, "For the organiser only. Changes here affect this phone only."),
    h("pre", { id: "ftState" }),
    h("h4", {}, "Position"),
    h("div", { class: "ftrow" }, btn("ftReal", "Real GPS", () => { stopPretending(); startReal(); draw(); }),
      btn("ftTap", "Tap the map to move", () => {
        sim.tapping = !sim.tapping; document.body.classList.toggle("fttap", sim.tapping); draw();
        if (sim.tapping) close();
      })),
    h("div", { class: "ftrow" }, go),
    h("p", { class: "ftnote" }, "Pretend positions replace GPS until you tap Real GPS."),
    h("h4", {}, "Game"),
    h("div", { class: "ftrow" },
      btn("ftOpen", "Open nearest location", () => {
        const at = state.fix || { ...map.getCenter(), accuracy: 10 };
        const next = Engine.ranges(at, GAME.locations, state.cfg).find(g => !state.progress.completed.includes(g.id));
        if (!next) { alert("Every location is already finished."); return; }
        if (activateLocation(next.id)) close(); else alert(state.progress.active ? "A location is already open. Finish it first." : "No new location can open now: it's time for the clues.");
      }),
      btn("ftFinish", "Finish open location", () => {
        const l = locationById(state.progress.active); if (!l) { alert("No location is open."); return; }
        state.progress = Play.goTo(state.progress, l, (l.tasks || []).length - 1);
        finishActive(); close();
      })),
    h("div", { class: "ftrow" },
      h("label", {}, "Minutes left ", minutes),
      btn("ftSetClock", "Set", () => {
        const m = Number(minutes.value);
        if (!state.startedAt) { alert("Tap Begin first: the clock starts then."); return; }
        if (!Number.isFinite(m) || m < 0) { alert("Enter the number of minutes left."); return; }
        state.startedAt = Date.now() - (state.clockMinutes * 60000 - m * 60000);
        save(); renderClock(); checkReveal(); draw();
      }),
      btn("ftClues", "Show clues now", () => {
        if (!state.startedAt) { alert("Tap Begin first: the clock starts then."); return; }
        state.startedAt = Math.min(state.startedAt, Date.now() - (state.clockMinutes - GAME.revealMinutes) * 60000);
        save(); renderClock(); checkReveal(); close();
      })),
    h("p", { class: "ftnote" }, "If a location is open, the clues come once it's finished."),
    h("div", { class: "ftrow" },
      btn("ftRestart", "Restart this phone", () => {
        if (!confirm("Clear this phone's progress and clock, and go back to the start screen?")) return;
        store.removeItem(KEY);
        location.reload();
      }, "warn")),
    h("h4", {}, "Fix log, last 20"),
    h("div", { id: "ftLog" }, h("pre", {})),
  );
  document.body.append(panel);

  go.onchange = () => {
    const l = locationById(go.value); go.value = "";
    if (l) { pretend(l.lat, l.lng); map.setView([l.lat, l.lng], Math.max(map.getZoom(), 18)); close(); }
  };

  function fmt(ms){
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  function draw(){
    if (panel.hidden) return;
    const f = state.fix, p = state.progress, left = msLeft();
    const ranges = f ? Engine.ranges(f, GAME.locations, state.cfg).slice(0, 4) : [];
    $("ftState").textContent =
      `position ${f ? `${f.lat.toFixed(6)}, ${f.lng.toFixed(6)} ±${Math.round(f.accuracy)} m` : "—"}\n` +
      `source   ${feed.source === "sim" ? "pretend" : feed.source}${feed.gpsIssue ? ` (${feed.gpsIssue})` : ""} · ${state.fixes} fixes\n` +
      `done     ${p.completed.length} of ${GAME.locations.length}${p.active ? ` · open: ${locationById(p.active)?.name}` : ""}\n` +
      `clock    ${left == null ? "not started" : `${fmt(left)} left`}${p.revealed ? " · clues shown" : ""}\n` +
      ranges.map(g => `${p.completed.includes(g.id) ? "●" : "○"} ${g.name.slice(0, 26).padEnd(26)} ${String(Math.round(g.d)).padStart(5)} m  ${state.streaks[g.id] || 0}/${state.cfg.consecutiveFixes}`).join("\n");
    $("ftReal").classList.toggle("on", feed.source === "real");
    $("ftTap").classList.toggle("on", sim.tapping);
    if (document.activeElement !== minutes) minutes.value = left == null ? "" : Math.max(0, Math.floor(left / 60000));
  }
  function drawLog(){
    $("ftLog").replaceChildren(...(log.length ? log.map(e => h("div", { class: e.fired ? "hit" : e.ok ? "" : "rej" },
      `${e.t} ${e.src} ±${e.acc}m ${e.ok ? "✓" : "✕"} ${e.why} · ${e.near}${e.fired ? " · OPENED" : ""}`))
      : [h("div", { class: "ftnote" }, "No positions yet.")]));
  }
  hooks.render.push(draw);
  setInterval(draw, 1000);

  function open(){
    go.replaceChildren(new Option("Pretend to be at…", ""), ...GAME.locations.map(l => new Option(l.name, l.id)));
    panel.hidden = false;
    draw(); drawLog();
  }
  function close(){ panel.hidden = true; render(); }
  return { open };
}

export { fieldTools };

/* ════════════════════════════════════════════════════════════════════
   WALK SESSIONS
   Pure functions, no DOM, no imports. The app records every fix it feeds
   the engine into a compact log, exports it as a walk file, and loads
   walk files back for replay; scripts/replay.js reads the same files.

   Walk file (JSON):
     { format:"chinatown-hunt-walk", version:1, title, exportedAt,
       cfg:{ radius, accuracyCeiling, consecutiveFixes },
       locations:[{ id, name, lat, lng, radius }],      // as configured during the walk
       fixes:[{ t, lat, lng, accuracy, source }] }       // t = ms since epoch, in recorded order
   A bare array of fixes is accepted too.
   ════════════════════════════════════════════════════════════════════ */
const Walk = {
  FORMAT: "chinatown-hunt-walk",
  VERSION: 1,
  CAP: 10000,           // ~2h45m at 1 Hz; the oldest entries are dropped beyond this

  // Append one fix to a compact log of [t, lat, lng, accuracy, source] rows. Mutates and returns log.
  record(log, fix, source, cap = Walk.CAP){
    const r = (x, dp) => Number.isFinite(x) ? Math.round(x * 10**dp) / 10**dp : x;
    log.push([fix.t, r(fix.lat, 7), r(fix.lng, 7), r(fix.accuracy, 1), source]);
    if (log.length > cap) log.splice(0, log.length - cap);
    return log;
  },

  summary(log){
    const bySource = {};
    for (const row of log) bySource[row[4]] = (bySource[row[4]] || 0) + 1;
    return { count: log.length, first: log[0]?.[0] ?? null, last: log.at(-1)?.[0] ?? null, bySource };
  },

  toWalk(log, { title, cfg, locations, exportedAt = new Date() }){
    return {
      format: Walk.FORMAT, version: Walk.VERSION, title,
      exportedAt: new Date(exportedAt).toISOString(),
      cfg: { radius: cfg.radius, accuracyCeiling: cfg.accuracyCeiling, consecutiveFixes: cfg.consecutiveFixes },
      locations: locations.map(({ id, name, lat, lng, radius }) => ({ id, name, lat, lng, radius })),
      fixes: log.map(([t, lat, lng, accuracy, source]) => ({ t, lat, lng, accuracy, source })),
    };
  },

  // chinatown-walk-2026-09-16-0932.json, in the device's local time.
  filename(date = new Date()){
    const p = n => String(n).padStart(2, "0");
    return `chinatown-walk-${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.json`;
  },

  /* Parse a walk file (text or already-parsed JSON). Throws with a readable message if it
     isn't one. Entries without a numeric t can't be placed in time and are skipped; everything
     else is passed through untouched, because judging lat/lng/accuracy is the engine's job. */
  parse(input){
    let data = input;
    if (typeof input === "string") {
      try { data = JSON.parse(input); } catch (e) { throw new Error("not valid JSON"); }
    }
    const fixesIn = Array.isArray(data) ? data : data?.fixes;
    if (!Array.isArray(fixesIn)) throw new Error("no fixes array found");
    if (!Array.isArray(data)) {
      if (data.format != null && data.format !== Walk.FORMAT) throw new Error(`unknown format "${data.format}"`);
      if (data.version > Walk.VERSION) throw new Error(`walk file version ${data.version} is newer than this app understands`);
    }
    const fixes = [];
    let skipped = 0;
    for (const f of fixesIn) {
      if (f && typeof f === "object" && Number.isFinite(f.t))
        fixes.push({ t: f.t, lat: f.lat, lng: f.lng, accuracy: f.accuracy, source: typeof f.source === "string" ? f.source : "unknown" });
      else skipped++;
    }
    if (!fixes.length) throw new Error("the walk contains no usable fixes");
    return {
      fixes, skipped,
      title: Array.isArray(data) ? null : data.title ?? null,
      cfg: Array.isArray(data) ? null : data.cfg ?? null,
      locations: Array.isArray(data) ? null : (Array.isArray(data.locations) ? data.locations : null),
    };
  },
};

export { Walk };

/* ════════════════════════════════════════════════════════════════════
   GEOFENCE ENGINE
   Pure functions only. No DOM, no map, no globals, no clock — time
   arrives on each fix as fix.t (ms since epoch).
   Real fixes and simulated fixes both enter through ingest() and are
   treated identically — if this ever branches on source, the emulator
   stops proving anything about live behaviour.
   ════════════════════════════════════════════════════════════════════ */
const Engine = {
  haversine(aLat, aLng, bLat, bLng){
    const R = 6371000, r = Math.PI/180;
    const dLat = (bLat-aLat)*r, dLng = (bLng-aLng)*r;
    const s = Math.sin(dLat/2)**2 + Math.cos(aLat*r)*Math.cos(bLat*r)*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(s));
  },

  // Is this fix trustworthy enough to act on?
  screen(fix, cfg){
    if (!isFinite(fix.lat) || !isFinite(fix.lng)) return { ok:false, why:"malformed" };
    if (fix.accuracy > cfg.accuracyCeiling)
      return { ok:false, why:`±${Math.round(fix.accuracy)}m over ${cfg.accuracyCeiling}m ceiling` };
    return { ok:true, why:"accepted" };
  },

  radiusOf(loc, cfg){ return loc.radius ?? cfg.radius; },

  // Distance to every location, nearest first.
  ranges(fix, locations, cfg){
    return locations
      .map(l => ({ id:l.id, name:l.name, d:Engine.haversine(fix.lat, fix.lng, l.lat, l.lng), r:Engine.radiusOf(l, cfg) }))
      .sort((a,b) => a.d - b.d);
  },

  /* Manual-override eligibility: within overrideRange (default 60m) of an
     unopened location for longer than overrideDwellMs (default 90s).
     nearSince maps location id -> fix.t when the walker first came in range;
     leaving range or the location opening clears it. Timing comes from the
     fixes, never the wall clock, so a replay at any speed reaches the same
     verdict as the live walk. A fix without a usable t can't measure time,
     so it leaves the timers as they were.
     Carried over from the M1 rig as-is: this runs on every fix, including
     ones screen() rejected. */
  dwell(fix, ranges, opened, prev, cfg){
    if (!isFinite(fix.t)) return { nearSince:{ ...prev }, ready:[] };
    const range = cfg.overrideRange ?? 60, wait = cfg.overrideDwellMs ?? 90000;
    const nearSince = {}, ready = [];
    for (const g of ranges) {
      if (opened.has(g.id) || !(g.d <= range)) continue;
      nearSince[g.id] = prev[g.id] ?? fix.t;
      if (fix.t - nearSince[g.id] > wait) ready.push(g.id);
    }
    return { nearSince, ready };
  },

  /* Returns the streaks, any locations that just opened, and the override
     timers. A rejected fix carries no information, so it leaves streaks
     untouched rather than resetting them — a single bad reading must never
     undo progress made by good ones. Opened locations never re-lock. */
  ingest(fix, locations, cfg, prev){
    const streaks = { ...prev.streaks };
    const opened  = new Set(prev.opened);
    const screen  = Engine.screen(fix, cfg);
    const ranges  = Engine.ranges(fix, locations, cfg);
    const fired   = [];

    if (screen.ok) {
      for (const g of ranges) {
        if (opened.has(g.id)) continue;
        if (g.d <= g.r) {
          streaks[g.id] = (streaks[g.id] || 0) + 1;
          if (streaks[g.id] >= cfg.consecutiveFixes) { opened.add(g.id); fired.push(g.id); }
        } else {
          streaks[g.id] = 0;
        }
      }
    }
    const dwell = Engine.dwell(fix, ranges, opened, prev.nearSince || {}, cfg);
    return { screen, ranges, streaks, opened:[...opened], fired,
             nearSince:dwell.nearSince, overrideReady:dwell.ready };
  }
};

export { Engine };

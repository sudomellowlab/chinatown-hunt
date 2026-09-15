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
  // Number.isFinite, not isFinite: the global one coerces, so null became 0°,0°.
  screen(fix, cfg){
    const { lat, lng, accuracy } = fix;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      return { ok:false, why:"malformed" };
    if (!Number.isFinite(accuracy)) return { ok:false, why:"no accuracy reported" };
    if (accuracy > cfg.accuracyCeiling)
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
     verdict as the live walk.
     As with streaks, a rejected fix says nothing about where the walker is:
     it neither starts nor clears a timer, though its timestamp still counts
     toward timers already running. A fix without a usable t can't measure
     time, so it leaves the timers as they were. */
  dwell(fix, ranges, opened, prev, cfg, trusted){
    if (!Number.isFinite(fix.t)) return { nearSince:{ ...prev }, ready:[] };
    const range = cfg.overrideRange ?? 60, wait = cfg.overrideDwellMs ?? 90000;
    const nearSince = {};
    if (trusted) {
      for (const g of ranges)
        if (!opened.has(g.id) && g.d <= range) nearSince[g.id] = prev[g.id] ?? fix.t;
    } else {
      for (const id in prev) if (!opened.has(id)) nearSince[id] = prev[id];
    }
    const ready = Object.keys(nearSince).filter(id => fix.t - nearSince[id] > wait);
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
    const dwell = Engine.dwell(fix, ranges, opened, prev.nearSince || {}, cfg, screen.ok);
    return { screen, ranges, streaks, opened:[...opened], fired,
             nearSince:dwell.nearSince, overrideReady:dwell.ready };
  }
};

export { Engine };

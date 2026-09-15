/* ════════════════════════════════════════════════════════════════════
   GEOFENCE ENGINE
   Pure functions only. No DOM, no map, no globals beyond GAME.
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

  /* Returns the streaks and any locations that just opened.
     A rejected fix carries no information, so it leaves streaks untouched
     rather than resetting them — a single bad reading must never undo
     progress made by good ones. Opened locations never re-lock. */
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
    return { screen, ranges, streaks, opened:[...opened], fired };
  }
};

export { Engine };

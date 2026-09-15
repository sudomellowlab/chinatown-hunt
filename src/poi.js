/* ════════════════════════════════════════════════════════════════════
   POI EDITS
   Pure functions, no DOM, no imports. Locations placed by hand in the dev
   drawer are stored on the device as edits over GAME.locations.

   Each edit remembers the GAME values it started from (base). An edit is
   applied only while GAME still has those values; once new coordinates
   have been pasted into GAME and deployed, older edits on a phone no
   longer match and are dropped instead of silently overriding the code.
   ════════════════════════════════════════════════════════════════════ */
const Poi = {
  // Accepts "1.28092, 103.84760", "1.28092 103.84760", or a Google Maps URL
  // containing @lat,lng, ?q=lat,lng or !3dlat!4dlng. Throws a readable Error otherwise.
  parseCoords(text){
    const s = String(text ?? "").trim();
    const num = "(-?\\d{1,3}(?:\\.\\d+)?)";
    const patterns = [
      new RegExp(`!3d${num}!4d${num}`),                  // Google Maps place data (the pin itself)
      new RegExp(`@${num},${num}`),                      // Google Maps URL (map centre)
      new RegExp(`[?&](?:q|query|ll)=${num},\\s*${num}`),
      new RegExp(`^${num}\\s*[,\\s]\\s*${num}$`),       // plain "lat, lng"
    ];
    const m = patterns.map(p => p.exec(s)).find(Boolean);
    if (!m) throw new Error("expected decimal coordinates like 1.28092, 103.84760");
    const lat = +m[1], lng = +m[2];
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error("latitude must be within ±90 and longitude within ±180");
    return { lat, lng };
  },

  same(a, b){
    return a.lat === b.lat && a.lng === b.lng && (a.radius ?? null) === (b.radius ?? null);
  },

  /* Returns a new edits object with `changes` applied to the location whose original
     GAME values are `base`. An edit that brings a location back to its base is removed. */
  edit(edits, base, changes){
    const round = x => Math.round(x * 1e6) / 1e6;             // ~11 cm, as GAME stores them
    const prev = edits[base.id]?.value ?? { lat: base.lat, lng: base.lng, radius: base.radius ?? null };
    const value = { ...prev, ...changes };
    value.lat = round(value.lat); value.lng = round(value.lng);
    const out = { ...edits };
    const baseValue = { lat: base.lat, lng: base.lng, radius: base.radius ?? null };
    if (Poi.same(value, baseValue)) delete out[base.id];
    else out[base.id] = { base: baseValue, value };
    return out;
  },

  /* Apply stored edits to the GAME locations. Returns new location objects plus which
     edits were applied, which were stale (GAME changed since), and which name no location. */
  apply(locations, edits){
    const applied = [], stale = [], unknown = [];
    const byId = new Map(locations.map(l => [l.id, l]));
    for (const id of Object.keys(edits || {})) if (!byId.has(id)) unknown.push(id);
    const out = locations.map(l => {
      const e = edits?.[l.id];
      if (!e) return { ...l };
      if (!e.base || !e.value || !Poi.same(e.base, l)) { stale.push(l.id); return { ...l }; }
      applied.push(l.id);
      return { ...l, lat: e.value.lat, lng: e.value.lng, radius: e.value.radius ?? undefined };
    });
    const kept = Object.fromEntries(applied.map(id => [id, edits[id]]));
    return { locations: out, applied, stale, unknown, edits: kept };
  },
};

export { Poi };

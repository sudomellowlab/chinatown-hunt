# Claude Code Prompt — Chinatown Historical Hunt (v1, single-device prototype)

> Paste everything below the line into Claude Code as your opening message.
> This supersedes the earlier full spec for now. Keep that document as the v2 roadmap — do not build from it.

---

Build me a working, self-contained GPS treasure hunt that runs in a phone browser. **No backend, no build step, no framework, no accounts, no multi-device sync.** One HTML file I can drop on a static host and open on my phone.

Read this whole brief, ask me anything unclear, then follow the build order at the bottom. Stop at the end of each milestone.

## 1. What it does

A team walks around Telok Ayer / Ann Siang Hill in Singapore with one phone. A live map shows where they need to go. When they walk within a set radius of a location, that location **opens automatically** and presents its tasks one at a time. They answer, score points, and collect a clue. Then it's back to the map for the next location. After all 8 locations, a deduction phase where they name a culprit.

The mechanic is modelled on Loquiz, minus the native app.

**Fixed parameters:**
- 8 locations around Telok Ayer and Ann Siang Hill, starting at Telok Ayer Green
- Each location holds **more than one task** — an ordered sequence
- 2 hours, hard stop
- Outdoors, daytime, dense urban area with tall shophouses and some tall towers
- One phone per team

## 2. Constraints

- **Single HTML file.** Everything inline — CSS, JS, game content. Leaflet from CDN. No npm, no bundler, no server.
- **Static hosting.** Must work served from Netlify / GitHub Pages / Cloudflare Pages. Geolocation requires HTTPS, so assume that.
- **Leaflet 1.9.x** from unpkg, OpenStreetMap raster tiles. Keep the tile URL in one clearly-marked constant so it can be swapped for a keyed provider (MapTiler, Stadia) before a real event — OSM's public tile policy isn't meant for production load.
- **Progress in `localStorage`**, keyed by game id. A refresh, an accidental tab close, or a phone locking and unlocking must resume exactly where they were. This is the single most important robustness requirement.
- No PWA or service worker in v1. Note where they'd slot in later, but don't build them.

## 3. Game content shape

All content lives in one `const GAME = {...}` object at the very top of the file, fenced with a big comment banner so a non-developer can edit it without scrolling through logic. Use this shape:

```js
const GAME = {
  title: "Historical Hunt — Chinatown",
  durationMinutes: 120,
  defaults: {
    radius: 25,              // metres
    accuracyCeiling: 50,     // discard GPS fixes worse than this
    consecutiveFixes: 3      // fixes inside radius before a location opens
  },
  locations: [
    {
      id: "telok-ayer-green",
      name: "Telok Ayer Green",
      lat: 0, lng: 0,        // PLACEHOLDER — captured on site, see §7
      radius: 25,            // optional per-location override
      arrivalText: "Shown when the location opens.",
      clue: { id: "clue-1", text: "Evidence released when all tasks here are done." },
      tasks: [
        { id: "t1", type: "multiple_choice", prompt: "...", options: ["A","B","C","D"],
          answer: 2, points: 100, hint: "...", hintPenalty: 25 },
        { id: "t2", type: "text", prompt: "...", accept: ["hokkien", "hokkien people"],
          points: 100 },
        { id: "t3", type: "number", prompt: "...", answer: 1839, tolerance: 0, points: 100 }
      ]
    }
  ],
  suspects: [ { id: "s1", name: "...", blurb: "..." } ],
  eliminations: { "clue-1": ["s3", "s5"] },   // which suspects each clue rules out
  culprit: "s2"
};
```

I will supply the real puzzle content, suspects, and elimination matrix. Build against plausible placeholder content in exactly this shape so I can swap it wholesale.

**Task types:** `multiple_choice`, `text`, `number`. Text answers normalise before comparing — lowercase, trim, collapse internal whitespace, strip punctuation — and match against any entry in `accept`. Number answers honour `tolerance`.

(A `photo` type is nice-to-have and belongs in the last milestone if at all: capture via `<input type="file" capture>`, downscale to ~800px, store in IndexedDB not localStorage, show in an end-of-game gallery. It cannot upload anywhere without a backend, so treat it as a keepsake, not a scored task.)

## 4. The geofence engine — the part that must be right

Put this in one clearly-separated, well-commented section. It decides whether the product works.

- `navigator.geolocation.watchPosition()` with `enableHighAccuracy: true`, `maximumAge: 0`, `timeout: 15000`
- Haversine distance to every incomplete location on each fix
- **Discard any fix where `coords.accuracy > accuracyCeiling`.** Telok Ayer's buildings produce wild outliers, and a bad fix that teleports the team 200m is worse than no fix at all
- **Require `consecutiveFixes` qualifying fixes inside the radius** before opening. Never trigger on a single reading
- **No re-locking.** Once a location has opened, it stays open permanently regardless of GPS wobble
- Show the accuracy circle on the map and a live "**Xm to Thian Hock Keng**" readout for the nearest incomplete location. When people can see why nothing has happened, they stop blaming the app

**Manual override, mandatory:** after the phone has been within 60m of a location for 90 seconds, show an "I'm standing right here" button that opens it. Without this, one bad GPS day ruins a paid event.

**Wake lock:** request `navigator.wakeLock` while the map is visible so the screen doesn't sleep mid-walk. Release it on `visibilitychange`, re-acquire on return, and immediately re-run the geofence check when the page becomes visible again — position updates stop entirely while the page is backgrounded, so the first thing on return must be a fresh fix.

## 5. Flow and screens

**Start** → title, premise, "Begin" button. Geolocation permission requested **only on that tap**, never on page load. Timer starts.

**Map** → all 8 locations pinned (incomplete / completed), own position, accuracy circle, distance to nearest, score and countdown always visible.

**Location** → opens automatically on arrival. Shows `arrivalText`, then task 1 of N. Answering advances to the next task. Completing the last one awards the location's points, releases its clue, shows a brief summary, and returns to the map.

- Wrong answers: allow retries. Decide a sane penalty (first attempt full points, subsequent attempts reduced) and tell me what you chose.
- **Skip task** — available on every task, awards zero, advances. This is the pressure valve against the 2-hour clock.
- **Leave location** — returns to the map with the location incomplete; it can be re-entered later, resuming at the first unanswered task.

**Clue log** → overlay available from any screen, listing clues collected so far.

**Deduction** → unlocks once all locations are done or the timer hits 15 minutes remaining. Suspect grid; each collected clue crosses out the suspects it eliminates. One final accusation, no changing it.

**End** → final score, time taken, correct/incorrect verdict, breakdown by location.

## 6. Dev mode — location emulator

**This is a first-class feature, not a debug afterthought.** Without it I cannot test a single line of geofence logic without physically walking to Telok Ayer. Build it in Milestone 1, alongside the map, before anything else. It must work on a phone as well as a desktop browser.

Gate it behind `?dev=1`, persist that state so a refresh doesn't drop out of it, and show a permanent, unmissable banner across the top whenever it's active. This must never be mistakable for a live game.

### Position emulation

- **Toggle: real GPS ↔ simulated.** Flip either way mid-session without reloading. The geofence engine must not know the difference — simulated fixes go through exactly the same code path, filters and debounce as real ones.
- **Tap to place.** Tap anywhere on the map to put the fake player there.
- **Jump to location.** Dropdown of all 8 locations; select one to teleport to its exact coordinates, plus "just outside radius" and "just inside radius" variants for boundary testing.
- **Simulated walking.** Draw a path by tapping waypoints, then play it back at an adjustable speed (default ~1.4 m/s, real walking pace). This is the only way to properly exercise the `consecutiveFixes` debounce and to feel what arrival actually looks like — a teleport tests none of that.
- **Freeze / resume.** Stop emitting fixes entirely, to simulate walking into a dead spot or the phone backgrounding.

### Signal quality emulation

The filters in §4 are the most likely thing to be subtly wrong, and they're invisible until they misbehave in the field:

- **Accuracy override.** Set the `accuracy` value attached to simulated fixes. Setting it above `accuracyCeiling` must visibly cause fixes to be discarded — that's the test.
- **Jitter.** Add random metre-scale noise to each fix to imitate urban GPS wobble against tall shophouses. Verify it neither false-triggers nor causes a location to flicker.
- **Fix interval.** Adjust how often simulated fixes arrive, to imitate a slow or struggling receiver.

### Inspector

A collapsible panel showing:

- Current score, open locations, completed tasks, collected clues
- The raw last fix: lat, lng, accuracy, timestamp
- **A rolling log of the last 20 fixes**, each with its computed distance to the nearest location, whether it was accepted or discarded, **and why** — plus the current consecutive-qualifying-fix count per location

That log is the single most valuable thing here. When a location doesn't open while I'm standing on top of it in Chinatown, it is the only thing that will tell me whether the radius is too tight, the accuracy ceiling is rejecting everything, or the coordinates are simply wrong.

### Shortcuts

- **Force-open a location** regardless of position
- **Complete current task** / **complete current location**
- **Time controls** — set the countdown to any value. I need to test the 15-minute deduction unlock and the hard stop without sitting through 105 minutes each time.
- **Reset progress** — clear localStorage and start over

## 7. Coordinate capture tool

Also behind `?dev=1`. I am going to walk this route to set it up and I don't want to read coordinates off Google Maps by hand.

- Stand at a real spot on my phone, tap **Capture**, and it records the current lat/lng against a chosen location id
- A radius slider drawn as a live circle on the map so I can size each geofence in situ
- **Export** button that dumps the updated `locations` array as JSON to the clipboard, ready to paste back into `GAME`

## 8. Design

Period 1920s Singapore investigation dossier — aged paper, ink, stamped evidence, restrained serif display type. But it is read **outdoors in Singapore daylight**, so legibility beats atmosphere every time:

- High contrast above all. No thin light-grey type on cream, however handsome it looks on a monitor
- Minimum 48px tap targets, primary actions thumb-reachable at the bottom
- Minimal motion — it drains battery and stutters on mid-range Android

## 9. Build order

Stop after each milestone.

1. **Map + position + the full dev mode from §6.** Leaflet map centred on Telok Ayer, live blue dot with accuracy circle, hard-coded pins, distance readout, and the complete location emulator including the fix log. Nothing else. Two goals: I take this outside and find out whether 25m radii are workable in Telok Ayer, and everything after this milestone becomes testable from my desk.
2. **Geofence + locations + tasks.** The engine from §4, auto-open on arrival, ordered task sequences, all three task types, scoring, skip and leave, localStorage persistence, manual override, wake lock.
3. **Clues, deduction, end screen.**
4. **Coordinate capture tool, polish, field test.** Photo tasks here if at all.

## 10. Working preferences

- Ask before adding any dependency beyond Leaflet
- Keep the geofence logic in one self-contained section with no DOM access — pure functions in, decisions out. It is the heart of the product and I want to read it end to end
- Real and simulated fixes must enter that logic through the same single entry point. If dev mode ever branches around the engine, the emulator stops proving anything
- Hold all progress in a single `state` object with one `save()` / `load()` pair. A backend and multi-device sync are planned for v2, and that boundary is what will make it possible without a rewrite
- Commit at each milestone
- Flag anything in this brief you think is wrong before implementing it

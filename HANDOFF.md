# Claude Code Handoff — Chinatown Historical Hunt

You should now have three files. Put them in one folder:

```
chinatown-hunt/
├── chinatown-hunt-m1.html                    ← working Milestone 1
├── chinatown-hunt-v1-prototype-prompt.md     ← the spec. Rename to SPEC.md
└── HANDOFF.md                                ← this file
```

Then `cd chinatown-hunt`, run `claude`, and paste the block below.

---

## Opening message for Claude Code

I have a working Milestone 1 of a GPS treasure hunt in `chinatown-hunt-m1.html` — a single self-contained file with a Leaflet map, a pure geofence engine, a location emulator, a fix log and a coordinate capture tool. `SPEC.md` is the full brief for the finished product; read both before doing anything.

I'm changing the order of work. **Do not start Milestone 2 yet.** I need to walk the real route in Chinatown to capture coordinates and test GPS behaviour, and I want that walk to produce reusable data rather than just impressions. So build the test and recording infrastructure first — it's small, and it makes everything after it cheaper.

Work through these in order and stop after each for review.

### Step 1 — Restructure into testable modules

The single-file constraint in SPEC.md was there because I was working without a development machine. I'm not any more, so relax it *slightly*:

```
src/engine.js      ← the geofence engine, pure functions, ES module, zero imports
src/app.js         ← map, UI, dev drawer, everything else
src/styles.css
build.js           ← ~20 lines of Node, inlines all three into one HTML file
dist/chinatown-hunt.html
```

**The deliverable stays a single file I can double-click or drag onto a static host.** `build.js` must be plain Node with no dependencies — no bundler, no framework, no npm install required to produce the artefact. The point of splitting is that tests can import `engine.js` directly, not that we're adopting a toolchain.

Lift the engine across unchanged. Its behaviour is already what I want.

### Step 2 — Unit tests on the engine

Use `node --test` (zero dependencies) unless you have a strong reason for Vitest. Cover:

- `haversine` against a few known distances, including a short one (~20m) where floating-point error would matter
- `screen()` accepting and rejecting either side of the accuracy ceiling, and rejecting malformed coordinates
- `ingest()` streak behaviour: incrementing inside the radius, resetting on a fix outside it, firing at exactly `consecutiveFixes`
- **A rejected fix must leave streaks untouched** — not reset them. One bad reading must never undo progress from good ones. This is deliberate; there should be a test that would fail if someone "fixed" it.
- **Opened locations never re-lock**, regardless of subsequent distance
- Per-location radius overriding the default

### Step 3 — Browser tests with real geolocation

Playwright, using `context.grantPermissions(['geolocation'])` and `setGeolocation({latitude, longitude, accuracy})`. These exercise the genuine `watchPosition` path, which the emulator by design does not.

- A scripted approach to a location opens it, and only after the debounce
- A fix with accuracy above the ceiling opens nothing
- Arrival shows the sheet with the right location name
- Progress survives a page reload
- The manual override appears after 90s within 60m and not before (fake the clock)

### Step 4 — Fix recorder and replay harness

**This is the important one. Build it before I walk the route.**

**Record.** Every fix entering `onFix` — real or simulated — appends to a session log: `{t, lat, lng, accuracy, source}`. Keep it in memory and persist periodically so a crash mid-walk doesn't lose it. Cap it sensibly; two hours at 1Hz is about 7,000 entries, which is fine.

**Export.** A button in the dev drawer that downloads the session as JSON, named with the date. It must work on iOS Safari — test that, since it's where I'll actually be pressing it.

**Replay in-app.** Load a recorded file back into the emulator and play it through the engine at adjustable speed, exactly as if walking it live.

**Replay on the CLI.** A script I can point at a recorded walk and a set of parameters:

```
node scripts/replay.js walks/2026-09-16-telok-ayer.json --radius 25 --ceiling 50 --streak 3
```

It should report, per location: whether it opened, at what timestamp, how many metres past the boundary the walker was when it fired, the closest approach if it never opened, and what fraction of fixes were rejected by the ceiling. Add a sweep mode that runs a grid of radius and ceiling values and prints which combinations open all eight locations — that's the output I actually want, because it turns parameter tuning into a table instead of a walk.

### Step 5 — Then Milestone 2 from SPEC.md

Geofence-driven auto-open, ordered task sequences per location, the three task types, scoring, skip and leave, localStorage persistence. By then I'll have real coordinates and a real track to test against.

## Working notes

- Ask before adding any dependency. Leaflet and Playwright are agreed; nothing else is.
- `src/engine.js` must have no DOM access and no imports. Real fixes, simulated fixes, and replayed fixes all enter through one function. If anything ever branches on the source of a fix, the tests stop proving anything about live behaviour.
- Commit at each step.
- Flag anything here you think is wrong before implementing it.

---

## Getting it onto my phone

Real GPS needs HTTPS. `http://192.168.x.x` is not a secure context, so serving it on the LAN from this PC will not work without a certificate. Easiest options:

- Drag `dist/chinatown-hunt.html` onto Netlify Drop for a throwaway HTTPS URL
- Or a Cloudflare tunnel to a local server, if you'd rather keep it off the public web

Ask me which I want before setting either up.

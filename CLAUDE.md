# Chinatown Historical Hunt

A GPS treasure hunt for one phone per team, walking eight locations around Telok Ayer and Ann Siang Hill in Singapore. Walking into a location's geofence opens it, and each location presents a sequence of tasks. It ships as one self-contained HTML file on a static HTTPS host: no backend, no accounts, progress stored in `localStorage`.

**Two audiences.** Participants play on phones. Admins set locations, replay walks and export data in a desktop browser, where the drawer docks as a panel beside the map (960 px and wider); on a phone it is a full-screen sheet. Design admin features for a computer first. The tools only exist behind `?dev=1`, which the device remembers; `?dev=0` turns them off. Participants get the plain link.

## Layout

```
src/engine.js        geofence engine: pure functions, ES module
src/session.js       walk recording and walk-file format: pure, shared by the app and the CLI
src/poi.js           hand-placed location edits and coordinate parsing: pure
src/app.js           map (Leaflet from CDN), UI, dev drawer, GAME content at the top
src/styles.css
src/index.html       markup; links styles.css and app.js
build.js             zero-dependency Node script, inlines src/ into dist/
scripts/replay.js    CLI: replay a recorded walk through the engine, report per location, sweep parameters
dist/chinatown-hunt.html   the deliverable (gitignored, built locally or by CI)
test/*.test.js       unit tests: engine, session, replay CLI (node --test picks up everything under test/)
e2e/*.spec.mjs       Playwright tests of the built file via real geolocation emulation; shared setup in e2e/fixtures.mjs
playwright.config.mjs, package.json   npm is only for Playwright; the package is ESM ("type": "module")
.claude/launch.json  preview server config
.github/workflows/ci.yml   tests, build, uploads the HTML as an artifact
.devcontainer/, .nvmrc     Codespace setup: Node 22 + Playwright Chromium
```

## Commands

```bash
node --test          # unit tests, no install needed
node build.js        # writes dist/chinatown-hunt.html
npm ci && npx playwright install chromium   # once, for browser tests
npx playwright test  # browser tests; builds first
node scripts/replay.js walks/x.json --radius 25 --ceiling 50 --streak 3   # replay a walk (--sweep for a grid, --help)
python3 -m http.server 8765 --bind 127.0.0.1   # preview: /src/index.html?dev=1 or /dist/chinatown-hunt.html?dev=1
```

Playwright runs two projects: `phone` (Pixel 7: the game, recorder) and `desktop` (1440×900: the location editor, recorder and replay). Browser tests read location coordinates from the page and pick test positions geometrically, so they survive real coordinates replacing the placeholders. Chromium's geolocation emulation sends a code-2 "position unavailable" error before every emulated update, which conveniently exercises the app's transient-error handling; any alert a test doesn't expect fails it.

`src/` needs a local server because it loads modules; `dist/` also opens by double-clicking. `?dev=1` turns on the location emulator. Ask before adding any dependency; Leaflet and Playwright are the only ones agreed.

## Invariants — these look like bugs but aren't

- **`src/engine.js` has no DOM access and no imports.** Tests import it directly; keep it pure.
- **Every fix enters through one function** (`onFix` → `Engine.ingest`), whether it's real, simulated or replayed. Nothing branches on a fix's source; if it did, the tests and emulator would stop proving anything about live behaviour.
- **A rejected fix leaves streaks untouched.** It doesn't reset them. One bad reading must never undo progress from good ones, and tests fail if this is "fixed".
- **Opened locations never re-lock**, however far the walker goes afterwards.
- **Location edits made in the drawer are per-device, and yield to GAME.** Each edit stores the GAME values it started from and is dropped once GAME differs, so a phone never overrides coordinates deployed in the code. Only `GAME.locations` in `src/app.js` reaches every phone; export from the drawer and paste it there.
- **Replayed fixes aren't recorded.** The recorder skips `source === "replay"`, so exporting after a replay doesn't duplicate the walk. This is recorder bookkeeping, not engine logic; the engine never sees `source`.
- **The manual-override dwell timer uses each fix's `t`, never the wall clock**, so replays at any speed reach the same verdict as a live walk. Rejected fixes neither start nor clear a timer.
- **The built artifact stays a single self-contained file.** No bundler, no framework, no npm install needed to produce it.

Walk files hold timestamped GPS tracks and the repo is public, so `walks/` is gitignored.

## Docs

- `SPEC.md`: the full product brief (game content shape, engine rules, screens, dev mode, design). Its "single HTML file, no build step" constraint has been relaxed to the `src/` + `build.js` layout above.
- `HANDOFF.md`: the current order of work, which overrides SPEC.md's build order. Steps 1–4 (modules, engine tests, Playwright, recorder and replay) are done; next is Milestone 2. Stop for review after each step, and commit at each step.

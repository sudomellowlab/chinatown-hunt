# Chinatown Historical Hunt

A GPS treasure hunt for one phone per team, walking eight locations around Telok Ayer and Ann Siang Hill in Singapore. Walking into a location's geofence opens it, and each location presents a sequence of tasks. It ships as one self-contained HTML file on a static HTTPS host: no backend, no accounts, progress stored in `localStorage`.

## Layout

```
src/engine.js        geofence engine: pure functions, ES module
src/app.js           map (Leaflet from CDN), UI, dev drawer, GAME content at the top
src/styles.css
src/index.html       markup; links styles.css and app.js
build.js             zero-dependency Node script, inlines src/ into dist/
dist/chinatown-hunt.html   the deliverable (gitignored, built locally or by CI)
test/engine.test.js  unit tests for the engine (node --test picks up everything under test/)
e2e/geofence.spec.mjs      Playwright tests of the built file via real geolocation emulation
playwright.config.mjs, package.json   npm is only for Playwright
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
python3 -m http.server 8765 --bind 127.0.0.1   # preview: /src/index.html?dev=1 or /dist/chinatown-hunt.html?dev=1
```

Browser tests read location coordinates from the page and pick test positions geometrically, so they survive real coordinates replacing the placeholders. Chromium's geolocation emulation sends a code-2 "position unavailable" error before every emulated update, which conveniently exercises the app's transient-error handling; any alert a test doesn't expect fails it.

`src/` needs a local server because it loads modules; `dist/` also opens by double-clicking. `?dev=1` turns on the location emulator. Ask before adding any dependency; Leaflet and Playwright are the only ones agreed.

## Invariants — these look like bugs but aren't

- **`src/engine.js` has no DOM access and no imports.** Tests import it directly; keep it pure.
- **Every fix enters through one function** (`onFix` → `Engine.ingest`), whether it's real, simulated or replayed. Nothing branches on a fix's source; if it did, the tests and emulator would stop proving anything about live behaviour.
- **A rejected fix leaves streaks untouched.** It doesn't reset them. One bad reading must never undo progress from good ones, and tests fail if this is "fixed".
- **Opened locations never re-lock**, however far the walker goes afterwards.
- **The manual-override dwell timer uses each fix's `t`, never the wall clock**, so replays at any speed reach the same verdict as a live walk. Rejected fixes neither start nor clear a timer.
- **The built artifact stays a single self-contained file.** No bundler, no framework, no npm install needed to produce it.

## Docs

- `SPEC.md`: the full product brief (game content shape, engine rules, screens, dev mode, design). Its "single HTML file, no build step" constraint has been relaxed to the `src/` + `build.js` layout above.
- `HANDOFF.md`: the current order of work, which overrides SPEC.md's build order. Steps 1–3 (modules, engine tests, Playwright) are done; next is Step 4 (fix recorder and replay), then Milestone 2. Stop for review after each step, and commit at each step.
